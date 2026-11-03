// C-07／C-08／C-11：個股問題小字說明精簡；評分樹展開後大項、中項（lv2）、小項（lv3）以暖色底色與左側色條分群（2026-11-03 改橘黃→琥珀→紅褐），大項未展開時外觀不變。
// 評分用 fixture（或 KUPEI_TEST_SESSION 讀線上），後端其他端點用假的；不建立帳號。測試檔要和 _kupei_test.mjs 放同一個資料夾執行。
// BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_tree_style.mjs
import { chromium } from 'playwright'
import { routeBackend, seedSession, CORS } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }

async function open(hash, vp) {
  const ctx = await b.newContext({ viewport: vp })
  await routeBackend(ctx); await seedSession(ctx)
  await ctx.route(/\/api\/(reports|news|market\/intraday|store)/, (route) => {
    const r = route.request(), path = new URL(r.url()).pathname
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (path.startsWith('/api/store')) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nf' } }) })
    const body = path.startsWith('/api/reports') ? (path.endsWith('/requests') ? { requests: [] } : { reports: [] })
      : path.startsWith('/api/news') ? { items: [], fetchedAt: new Date().toISOString(), source: 'google-news-rss' }
      : { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(body) })
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && document.querySelectorAll('#s-tree tr').length >= 12, null, { timeout: 40000 })
  await p.waitForTimeout(300)
  return p
}
const bg = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e.querySelector('td')).backgroundColor : null }, sel)
const bar = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e.querySelector('td')).boxShadow : null }, sel)
const rl = (c) => { const m = c.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] }
const ratio = (a, b) => { const x = rl(a), y = rl(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

for (const [label, vp] of [['桌機', { width: 1440, height: 900 }], ['手機（iPhone 14）', { width: 390, height: 844 }]]) {
  await check(`${label}：收合時沒有 lv2／lv3 列，大項底色不變`, async () => {
    const p = await open('#/stock/2330/home', vp)
    const n = await p.evaluate(() => ({ lv2: document.querySelectorAll('#s-tree tr.lv2').length, lv3: document.querySelectorAll('#s-tree tr.lv3').length }))
    must(n.lv2 === 0 && n.lv3 === 0, '收合時不該有子列：' + JSON.stringify(n))
    must((await bg(p, '#s-tree tr.lv1')) === 'rgb(25, 29, 33)', '大項底色：' + await bg(p, '#s-tree tr.lv1'))
    must((await bar(p, '#s-tree tr.lv1')) === 'none', '收合的大項不該有色條：' + await bar(p, '#s-tree tr.lv1')); await p.context().close()
  })
  await check(`${label}：展開大項→中項有 lv2，展開中項→小項有 lv3，底色各不相同且樣式生效`, async () => {
    const p = await open('#/stock/2330/home', vp)
    await p.click('#s-tree tr.lv1 [data-tog]'); await p.waitForSelector('#s-tree tr.lv2', { timeout: 5000 })
    await p.mouse.move(0, 0)
    const c1 = await bg(p, '#s-tree tr.lv1'), c2 = await bg(p, '#s-tree tr.lv2')
    must(c1 === 'rgb(42, 35, 24)' && c2 === 'rgb(58, 43, 24)', `展開的大項 ${c1}、中項 ${c2}`)
    must(/rgb\(224, 162, 58\)/.test(await bar(p, '#s-tree tr.lv1.open')), '展開的大項沒有橘黃色條：' + await bar(p, '#s-tree tr.lv1.open'))
    must(/rgb\(240, 162, 58\)/.test(await bar(p, '#s-tree tr.lv2')), '中項沒有色條：' + await bar(p, '#s-tree tr.lv2'))
    must((await p.$$('#s-tree tr.lv3')).length === 0, '只展開大項時不該有 lv3')
    const tog = await p.$('#s-tree tr.lv2 [data-tog]'); must(!!tog, '中項沒有可展開的按鈕（資料沒有小項）')
    await tog.click(); await p.waitForSelector('#s-tree tr.lv3', { timeout: 5000 })
    await p.mouse.move(0, 0); const c3 = await bg(p, '#s-tree tr.lv3'); must(c3 === 'rgb(52, 31, 29)' && new Set([c1, c2, c3]).size === 3, `小項 ${c3}`)
    const b3 = await bar(p, '#s-tree tr.lv3'); must(/rgb\(217, 101, 79\)/.test(b3) && /rgb\(232, 131, 106\)/.test(b3), '小項沒有紅橘色條與內側細條：' + b3)
    const OLD = ['rgb(25, 29, 33)', 'rgb(27, 35, 43)', 'rgb(20, 27, 34)', 'rgb(31, 44, 57)', 'rgb(24, 34, 44)']
    must([c1, c2, c3].every((c) => !OLD.includes(c)), '展開狀態不該再用灰藍底色：' + [c1, c2, c3].join(' / '))
    for (const [sel, c] of [['#s-tree tr.lv1', c1], ['#s-tree tr.lv2', c2], ['#s-tree tr.lv3', c3]]) {
      const fg = await p.evaluate((s) => getComputedStyle(document.querySelector(s).querySelector('td')).color, sel)
      must(ratio(fg, c) >= 7, `${sel} 文字對比不足 ${ratio(fg, c).toFixed(1)}`)
    }
    const m = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth); must(m, '不該橫向捲動')
    await p.context().close()
  })
  await check(`${label}：再收合後子列消失`, async () => {
    const p = await open('#/stock/2330/home', vp)
    await p.click('#s-tree tr.lv1 [data-tog]'); await p.waitForSelector('#s-tree tr.lv2', { timeout: 5000 })
    await p.click('#s-tree tr.lv1 [data-tog]'); await p.waitForFunction(() => !document.querySelector('#s-tree tr.lv2'), null, { timeout: 5000 }); await p.context().close()
  })
  await check(`${label}：個股問題卡片小字說明精簡，狀態列不重複`, async () => {
    const p = await open('#/stock/2330/home', vp)
    await p.waitForFunction(() => /個股問題|記錄需外部/.test(document.getElementById('q-body')?.innerText || ''), null, { timeout: 15000 })
    const t = await p.innerText('#q-body')
    must(t.includes('記錄需外部資訊或公司說明的問題；每則最多 1,000 字、每家公司最多 100 則，已刪除可恢復。'), '說明：' + t.slice(0, 200))
    must(!/評分內容在報告 2a|已刪除最多保留 50 則|只收需要外部資訊/.test(t), '舊說明還在：' + t.slice(0, 200))
    must((t.match(/各裝置同步|登入帳號/g) || []).length <= 1, '登入／同步說明重複：' + t.slice(0, 200))
    await p.context().close()
  })
}
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
process.exit(fail ? 1 : 0)
