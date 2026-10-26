// 本機／雲端同步下來的 kupei3_* 被改寫成惡意內容時，畫面不可執行注入的程式，且仍能正常顯示。
// BASE=http://127.0.0.1:5173/ node e2e_pages_xss.mjs（不需登入、不建立帳號）
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const X = (n) => `<img src=x onerror="window.__xss=(window.__xss||[]).concat(${n})">`

const EVIL = {
  kupei3_watch: JSON.stringify({
    groups: [
      { id: `1">${X(1)}`, name: X(2), color: `red">${X(3)}`, ids: ['2330', `x">${X(4)}`] },
      { id: 2, name: `壞${X(5)}`, color: 'x', ids: ['2330', '2317', `2317">${X(6)}`, 2454] },
      { id: 3, name: 12345, ids: 'not-an-array' },
      { id: 2, name: '重複的 id', ids: ['1101'] },
      null,
    ],
    cur: 2,
  }),
  kupei3_news: JSON.stringify({
    span: `3">${X(7)}`,
    groups: [
      { id: `1">${X(8)}`, kw: ['a'], ex: [] },
      { id: 2, kw: [X(9), 'ok', { x: 1 }], ex: 'not-an-array' },
    ],
    stock: { 2330: { kw: [X(10)], ex: [X(11)] }, [`9">${X(12)}`]: { kw: [] }, __proto__x: 5 },
    disabled: [X(13)],
  }),
  kupei3_report: JSON.stringify({
    2330: { kw: [X(14)], time: `"><svg onload="window.__xss=15">`, focus: 'x', news: true, cmp: true, status: X(16) },
    [`2317">${X(17)}`]: { kw: [] },
  }),
}
const BROKEN = { kupei3_watch: '{"groups":"oops","cur":{}}', kupei3_news: '[1,2,3]', kupei3_report: '"str"' }

async function open(ls) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, ls)
  const p = await ctx.newPage()
  p.errs = []
  await p.route('**/fonts.g*/**', (r) => r.abort())
  p.on('pageerror', (e) => p.errs.push('JS 錯誤：' + e.message))
  p.on('dialog', (d) => { p.errs.push('跳出對話框：' + d.message()); d.dismiss() })
  await p.goto(BASE)
  await p.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100, null, { timeout: 40000 })
  return p
}
const noInject = async (p) => {
  const r = await p.evaluate(() => ({ x: window.__xss || null, n: document.querySelectorAll('[onerror],[onload]').length }))
  must(!r.x, '注入的程式被執行：' + JSON.stringify(r.x)); must(r.n === 0, '頁面出現 ' + r.n + ' 個帶事件屬性的元素')
}
const go = async (p, h) => { await p.evaluate((x) => { location.hash = x }, h); await p.waitForTimeout(900) }

const p = await open(EVIL)
await check('惡意資料：首頁正常載入、未執行注入', async () => { await noInject(p); must(!(await p.isVisible('#h-err')), '出現載入失敗'); return '' })
await check('惡意資料：自選頁只留下合格群組並正常顯示', async () => {
  await go(p, '#/watch'); await noInject(p)
  const tabs = await p.$$eval('#w-tabs [data-tab]', (x) => x.map((e) => [e.dataset.tab, e.innerText]))
  must(tabs.length === 2, '群組數 ' + JSON.stringify(tabs))
  must(tabs[0][0] === '2' && /壞<img/.test(tabs[0][1]), '群組 2 名稱應以文字顯示：' + JSON.stringify(tabs[0]))
  must(tabs[1][0] === '3' && tabs[1][1].startsWith('自選3'), '群組 3 名稱應修正為預設：' + JSON.stringify(tabs[1]))
  const rows = await p.$$eval('#w-body tr[data-row]', (x) => x.map((e) => e.dataset.row))
  must(rows.join(',') === '2330,2317', '自選列：' + rows.join(','))
  return tabs.map((t) => t[0]).join('/') + '，' + rows.join(',')
})
await check('惡意資料：自選群組選單與刪除確認', async () => {
  await p.click('#w-tabs [data-gmenu="2"]'); await p.click('.menu [data-gdel]'); await p.waitForTimeout(300); await noInject(p)
  must(/刪除「壞<img/.test(await p.innerText('.modal h2')), '確認視窗標題')
  await p.click('.modal [data-close]')
  await go(p, '#/home'); await p.waitForSelector('#hr-2330 [data-menu]', { timeout: 30000 }); await p.click('#hr-2330 [data-menu]'); await p.waitForTimeout(300); await noInject(p)
  const n = await p.$$eval('.menu [data-setg]', (x) => x.length); must(n === 2, '選單群組數 ' + n); await p.click('.backdrop'); return ''
})
await check('惡意資料：新聞設定頁', async () => {
  await go(p, '#/news-settings'); await noInject(p)
  const t = await p.innerText('#ns-groups'); must(/<img/.test(t) && /ok/.test(t), '關鍵字應以文字顯示：' + t.slice(0, 80))
  const del = await p.$$eval('#ns-groups [data-nsdel]', (x) => x.map((e) => e.dataset.nsdel)); must(del.join() === '2', '關鍵字組：' + del.join())
  return ''
})
await check('惡意資料：報告設定頁', async () => {
  await go(p, '#/report-settings'); await noInject(p)
  const t = await p.innerText('#rs-panel'); must(/2330/.test(t) && /<img/.test(t), '報告設定：' + t.slice(0, 80))
  const list = await p.$$eval('#rs-list [data-rspick]', (x) => x.map((e) => e.dataset.rspick)); must(list.join() === '2330,2317', '報告清單：' + list.join())
  return ''
})
await check('惡意資料：新聞頁、個股頁', async () => {
  await go(p, '#/news/g2'); await noInject(p)
  const opts = await p.$$eval('#n-kw option', (x) => x.map((o) => o.value + ' ' + o.textContent)); must(opts.length === 1 && /^g2 1｜<img/.test(opts[0]), '新聞頁關鍵字組選單：' + JSON.stringify(opts))
  await go(p, '#/stock/2330/home'); await p.waitForTimeout(1500); await noInject(p)
  must(/2330/.test(await p.innerText('#s-title')), '個股頁標題'); return ''
})
await check('惡意資料：沒有 JS 錯誤或對話框', async () => { must(!p.errs.length, p.errs.join('；')); return '' })

const q = await open(BROKEN)
await check('結構錯誤的資料：退回預設、頁面正常', async () => {
  await go(q, '#/watch'); await noInject(q)
  const tabs = await q.$$eval('#w-tabs [data-tab]', (x) => x.map((e) => e.innerText))
  must(tabs.length === 1 && tabs[0].startsWith('自選1'), '群組：' + JSON.stringify(tabs))
  await go(q, '#/news-settings'); must(/尚未建立關鍵字組/.test(await q.innerText('#ns-groups')), '新聞設定')
  await go(q, '#/report-settings'); await noInject(q)
  must(!q.errs.length, q.errs.join('；')); return ''
})

await b.close()
for (const r of results) console.log(r[0], r[1], r[2])
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - fail}/${results.length} 通過`)
process.exit(fail ? 1 : 0)
