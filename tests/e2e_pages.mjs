// Pages 版完整 UI 的瀏覽器測試。網站必須登入（2026-10-28）：假的已登入 session＋fixture 資料，或設 KUPEI_TEST_SESSION 對線上資料跑。
// BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages.mjs（見 tests/_kupei_test.mjs）
import { chromium } from 'playwright'
import { routeBackend, seedSession, MIN_ROWS } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
async function page(vp) {
  const ctx = await b.newContext({ viewport: vp || { width: 1440, height: 900 } })
  await routeBackend(ctx); await seedSession(ctx)
  const p = await ctx.newPage()
  p.on('pageerror', e => errs.push('JS 錯誤：' + e.message))
  p.on('console', m => { if (m.type() === 'error' && !/fonts|favicon|Failed to load resource/.test(m.text())) errs.push('console：' + m.text().slice(0, 160)) })
  return p
}
const p = await page()
await p.goto(BASE)
await p.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100, null, { timeout: 40000 })
await check('首頁載入並列出公司', async () => {
  await p.waitForFunction((min) => document.querySelectorAll('#h-body tr').length >= min, MIN_ROWS, { timeout: 40000 })
  const n = await p.$$eval('#h-body tr', x => x.length); must(n >= MIN_ROWS, '列數 ' + n); return n + ' 列'
})
await check('首頁基準列與行情', async () => {
  const t = await p.innerText('.meta'); must(/資料計算 V/.test(t), '基準列：' + t.slice(0, 80))
  const px = await p.$eval('#h-body tr td[data-q]', x => x.innerText); must(px && px !== '—', '沒有收盤價')
  return t.replace(/\s+/g, ' ').slice(0, 90)
})
await check('搜尋：跳至 2330 並找得到', async () => {
  await p.fill('#h-q', '2330'); await p.click('#h-jump'); await p.waitForTimeout(1200)
  const msg = await p.innerText('#h-msg'); must(!/找不到|沒有/.test(msg), '訊息：' + msg)
  await p.fill('#h-q', '9999x'); await p.click('#h-jump'); await p.waitForTimeout(600)
  must(/找不到|沒有/.test(await p.innerText('#h-msg')), '不存在的代號沒有提示'); return ''
})
await check('個股頁（有明細）：分數樹與展開', async () => {
  await p.goto(BASE + '#/stock/2330/home')
  await p.waitForFunction(() => document.querySelectorAll('#s-tree tr').length >= 12, null, { timeout: 30000 })
  await p.click('#s-tree tr.lv1 .tog'); await p.waitForTimeout(400)
  const n = await p.$$eval('#s-tree tr', x => x.length); must(n > 12, '展開後列數 ' + n); return n + ' 列'
})
await check('個股頁：收盤價與正式估價區塊（V3.0.30 r3）', async () => {
  await p.goto(BASE + '#/stock/2330/home'); await p.waitForFunction(() => /中心\s*[\d,.]+/.test(document.querySelector('#s-valcard')?.innerText || ''), null, { timeout: 30000 })
  const t = await p.innerText('#s-valcard'); must(!/估價尚未提供/.test(t), '仍顯示估價尚未提供')
  must(/收盤價 \d+\/\d+/.test(t) && /估價基準日 \d+\/\d+/.test(t), '沒有收盤價或估價基準日'); return ''
})
await check('個股頁（任一公司）有明細，不再顯示尚未提供', async () => {
  await p.goto(BASE + '#/stock/1101/home'); await p.waitForFunction(() => document.querySelectorAll('#s-tree tr').length >= 12, null, { timeout: 30000 })
  const t = await p.innerText('#s-tree'); must(!/尚未提供|載入失敗/.test(t), t.slice(0, 120)); return ''
})
await check('個股頁沒有 undefined／NaN', async () => { const t = await p.innerText('#pg-stock'); must(!/undefined|NaN/.test(t), '畫面含 undefined／NaN'); return '' })
await check('自選：加入、重新整理後仍在（本機）', async () => {
  await p.goto(BASE); await p.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100)
  await p.click('#h-body tr:nth-child(2) [data-menu]'); await p.click('.menu [data-setg]'); await p.waitForTimeout(800)
  const ls = await p.evaluate(() => localStorage.getItem('kupei3_watch')); must(/"ids":\["\d{4}"/.test(ls || ''), 'localStorage：' + ls)
  await p.reload(); await p.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100)
  await p.goto(BASE + '#/watch'); await p.waitForTimeout(1500)
  const n = await p.$$eval('#w-body tr[data-row]', x => x.length); must(n === 1, '自選列數 ' + n); return ''
})
await check('自選頁：近 20 日小圖', async () => {
  await p.waitForFunction(() => document.querySelectorAll('#w-body td[data-spark] svg').length > 0, null, { timeout: 20000 }); return ''
})
for (const [h, sel, label] of [['#/news-settings', '#pg-news-settings', '新聞設定'], ['#/report-settings', '#pg-report-settings', '報告設定'], ['#/status', '#pg-status', '狀態'], ['#/help', '#pg-help', '說明'], ['#/news', '#pg-news', '新聞']]) {
  await check(label + '頁可開啟、沒有 undefined', async () => {
    await p.goto(BASE + h); await p.waitForTimeout(1500)
    const t = await p.innerText(sel); must(t.length > 20 && !/undefined|NaN/.test(t), t.slice(0, 100)); return ''
  })
}
await check('狀態頁：版本、行情、儲存位置', async () => {
  await p.goto(BASE + '#/status'); await p.waitForTimeout(1200)
  const t = await p.innerText('#pg-status'); must(/V0\.0\.|V3\.0\./.test(t) && /每日收盤/.test(t) && /這台瀏覽器/.test(t), t.slice(0, 200)); return ''
})
await check('新聞頁接上後端（不再顯示後端未承接）', async () => {
  await p.goto(BASE + '#/news'); await p.waitForTimeout(1500); const t = await p.innerText('#pg-news'); must(!/後端未承接|新聞擷取功能尚未提供/.test(t) && !/undefined|NaN/.test(t), t.slice(0, 120)); return ''
})
await check('帳號視窗：已登入、可登出與改密碼、沒有註冊；Esc 關閉', async () => {
  await p.goto(BASE); await p.waitForTimeout(1500); await p.click('[data-acct]'); await p.waitForSelector('.acct-modal')
  const t = await p.innerText('.acct-modal')
  must(/已登入/.test(t) && await p.$('[data-acct-logout]') && await p.$('#acct-pw-box'), '帳號視窗：' + t.slice(0, 120))
  must(!/建立帳號|邀請碼/.test(t) && !(await p.$('[data-acct-mode], #acct-wt')), '還有註冊或寫入權杖登入')
  await p.keyboard.press('Escape'); must(!(await p.$('#acct-host')), '視窗沒關'); return ''
})
await check('手機寬度：首頁與底部工作列', async () => {
  const m = await page({ width: 390, height: 844 }); await m.goto(BASE)
  await m.waitForFunction((min) => document.querySelectorAll('#h-mlist .mrow').length >= min, MIN_ROWS, { timeout: 40000 }); await m.waitForTimeout(1500)
  const n = await m.$$eval('#h-mlist .mrow', x => x.length); const rail = await m.$eval('.rail', x => getComputedStyle(x).position); must(rail === 'fixed', 'rail ' + rail)
  if (process.env.SHOTS) await m.screenshot({ path: process.env.SHOTS + '/mobile_home.png' })
  return n + ' 列'
})
if (process.env.SHOTS) {
  for (const [h, f] of [['', 'home'], ['#/stock/2330/home', 'stock'], ['#/status', 'status'], ['#/help', 'help']]) {
    await p.goto(BASE + h); await p.waitForTimeout(2500); await p.screenshot({ path: process.env.SHOTS + '/desktop_' + f + '.png' })
  }
}
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter(r => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
