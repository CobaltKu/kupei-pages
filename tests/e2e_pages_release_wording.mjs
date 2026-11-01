// C-09：V3.0.30 r8 已是正式資料（Gate Production）。畫面、說明頁、頁尾與 README 不再把現行分數叫「試算版本／試算分數」，
// 改為「正式計算版本 V3.0.30／模型分數」；仍保留「模型效度持續驗證中、供篩選與分析參考、不是投資建議」，不得寫成已完全驗證。
// 評分用 fixture（或 KUPEI_TEST_SESSION 讀線上），其他端點用假的回應；不建立帳號。測試檔要和 _kupei_test.mjs 放同一個資料夾執行。
// BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_release_wording.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routeBackend, seedSession, CORS } from './_kupei_test.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const here = path.dirname(fileURLToPath(import.meta.url))
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }

async function open(hash, vp) {
  const ctx = await b.newContext({ viewport: vp })
  await routeBackend(ctx); await seedSession(ctx)
  await ctx.route(/\/api\/(reports|news|market\/intraday|store)/, (route) => {
    const r = route.request(), p = new URL(r.url()).pathname
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = p.startsWith('/api/store') ? null : p.startsWith('/api/reports') ? (p.endsWith('/requests') ? { requests: [] } : { reports: [] })
      : p.startsWith('/api/news') ? { items: [], fetchedAt: new Date().toISOString(), source: 'google-news-rss' }
      : { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }
    return body ? route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(body) }) : route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nf' } }) })
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && document.querySelector('.page.on'), null, { timeout: 40000 })
  await p.waitForTimeout(1200)
  return p
}
const all = (p) => p.evaluate(() => document.body.innerText)
const html = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText || '', sel)

for (const [label, vp] of [['桌機', { width: 1280, height: 900 }], ['手機（iPhone 14）', { width: 390, height: 844 }]]) {
  await check(`${label}：首頁橫幅與頁尾寫「正式計算版本 V3.0.30」「模型分數」，沒有「試算」`, async () => {
    const p = await open('#/', vp)
    const bn = await html(p, '#h-banner'), ft = await html(p, '#h-mfoot')
    must(/正式計算版本 V3\.0\.30/.test(bn) && /不是投資建議/.test(bn) && /模型效度持續驗證中/.test(bn), '橫幅：' + bn.slice(0, 160))
    must(/模型分數/.test(ft), '頁尾：' + ft.slice(0, 160))
    must(!/試算/.test(await all(p)), '首頁還有「試算」：' + (await all(p)).match(/.{0,20}試算.{0,20}/)?.[0])
    must(!/已完全驗證|驗證完成|已驗證完成/.test(await all(p)), '不得寫成已完全驗證'); await p.context().close()
  })
  await check(`${label}：說明頁寫「正式計算版本」「模型分數」，保留效度驗證中與非投資建議，分數說明不再是「試算分數」`, async () => {
    const p = await open('#/help', vp)
    const t = await all(p)
    must(/目前分數為正式計算版本 V3\.0\.30 的模型分數/.test(t) && /模型效度持續驗證中/.test(t) && /供篩選與分析參考，不是投資建議/.test(t), '說明頁：' + t.slice(t.indexOf('模型限制'), t.indexOf('模型限制') + 160))
    must(!/試算/.test(t), '說明頁還有「試算」：' + t.match(/.{0,20}試算.{0,20}/)?.[0])
    must(!/尚未完全驗證/.test(t) || /持續驗證/.test(t), '效度描述'); await p.context().close()
  })
  await check(`${label}：狀態頁與個股頁沒有「試算」`, async () => {
    for (const h of ['#/status', '#/stock/2330/home']) {
      const p = await open(h, vp); const t = await all(p); must(!/試算/.test(t), h + ' 還有「試算」：' + t.match(/.{0,20}試算.{0,20}/)?.[0])
      must(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), h + ' 橫向捲動'); await p.context().close()
    }
  })
}
await check('README 與前端程式碼沒有把現行分數稱為「試算版本／試算分數」', async () => {
  const root = process.env.KP_ROOT || path.join(here, '..')
  for (const f of ['README.md', 'index.html', 'public/legacy/app.js']) {
    const t = fs.readFileSync(path.join(root, f), 'utf8'); const m = t.match(/.{0,16}試算.{0,16}/)
    must(!m, f + ' 還有「試算」：' + (m && m[0]))
  }
  must(/正式計算版本/.test(fs.readFileSync(path.join(root, 'README.md'), 'utf8')), 'README 沒有「正式計算版本」')
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
