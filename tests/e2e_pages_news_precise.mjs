// C-06（NEWS-03／04，2026-10-30 上線）：產業新聞改走後端精準查詢 kind=industry。
// 同組至少 2 個不同關鍵字才收錄；不足 2 個詞不送出請求、畫面講清楚；顯示 matchedKeywords 與實際發布媒體／抓取來源；
// 個股新聞仍是舊版查詢（等 NEWS-05），詞數不超過 5。後端 /api/news 全用假的回應，評分與行情用 fixture；不建立帳號。
// 測試檔要和 _kupei_test.mjs 放同一個資料夾執行。BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_news_precise.mjs
import { chromium } from 'playwright'
import { routeBackend, seedSession, CORS } from './_kupei_test.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const XSS = '<img src=x onerror="window.__xss=1">'

const M = { calls: [], items: [], status: 200, errorCode: '', partial: false, stale: false }
const ITEMS = [
  { title: '台積電 3 奈米擴產', url: 'https://technews.tw/a', source: '科技新報', media: '科技新報', via: 'technews', publishedAt: '2026-10-30T01:00:00Z', summary: 'RSS 摘要一', matchedKeywords: ['AI', '半導體'] },
  { title: '散熱模組需求升溫', url: 'https://news.example.com/b', source: '經濟日報', media: '經濟日報', via: 'google', publishedAt: '2026-10-30T00:00:00Z', summary: '', matchedKeywords: ['半導體', '散熱'] },
  { title: '先進封裝報導', url: 'https://news.example.com/c', source: '工商時報', media: '工商時報', via: 'bing', publishedAt: '2026-10-29T23:00:00Z', summary: '', matchedKeywords: ['AI', '封裝', XSS] },
]
async function open(hash, { groups, stock = {} }, vp = { width: 1280, height: 900 }) {
  const ctx = await b.newContext({ viewport: vp })
  await routeBackend(ctx); await seedSession(ctx)
  await ctx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, {
    kupei3_news: JSON.stringify({ span: 1, groups, stock }),
    kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330'] }], cur: 1 }),
  })
  await ctx.route(/\/api\/(reports|news|market\/intraday|store)/, (route) => {
    const r = route.request(), u = new URL(r.url()), path = u.pathname
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const json = (status, body) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) })
    if (path.startsWith('/api/store')) return json(404, { error: { code: 'NOT_FOUND', message: 'nf' } })
    if (path.startsWith('/api/reports')) return json(200, path.endsWith('/requests') ? { requests: [] } : { reports: [] })
    if (path === '/api/news/sources') return json(200, { sources: [{ id: 'google-news', name: 'Google 新聞', url: 'https://news.google.com/' }, { id: 'technews', name: '科技新報', url: 'https://technews.tw/' }] })
    if (path === '/api/news') {
      M.calls.push(Object.fromEntries(u.searchParams))
      if (M.status !== 200) return json(M.status, { error: { code: M.errorCode, message: 'x' } })
      const precise = u.searchParams.get('kind')
      return json(200, { items: M.items, fetchedAt: '2026-10-30T01:30:00Z', source: precise ? 'news-aggregate' : 'google-news-rss', ...(precise ? { kind: precise } : {}), ...(M.partial ? { partial: true } : {}), ...(M.stale ? { stale: true } : {}) })
    }
    return json(200, { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} })
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && document.querySelector('.page.on'), null, { timeout: 40000 })
  await p.waitForTimeout(1200)
  return p
}
const reset = (o = {}) => { M.calls.length = 0; M.items = ITEMS; M.status = 200; M.errorCode = ''; M.partial = false; M.stale = false; Object.assign(M, o) }
const G2 = [{ id: 1, kw: ['AI', '半導體'], ex: ['廣告'] }]
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText || '', sel)

for (const [label, vp] of [['桌機', { width: 1280, height: 900 }], ['手機（iPhone 14）', { width: 390, height: 844 }]]) {
  await check(`${label}：2 個詞的產業組 → 送 kind=industry、q、exclude；顯示命中詞、實際媒體與抓取來源`, async () => {
    reset(); const p = await open('#/news/g1', { groups: G2 })
    const c = M.calls.filter((q) => q.kind === 'industry'); must(c.length >= 1 && c[0].q === 'AI,半導體' && c[0].exclude === '廣告', '請求：' + JSON.stringify(M.calls))
    must(!M.calls.some((q) => !q.kind), '產業新聞不該再送舊版 OR 查詢：' + JSON.stringify(M.calls))
    const t = await text(p, '#n-main')
    must(/命中：AI、半導體/.test(t) && /命中：半導體、散熱/.test(t), '命中詞：' + t.slice(0, 300))
    must(/科技新報（經科技新報 RSS）/.test(t) && /經濟日報（經Google 新聞）/.test(t) && /工商時報（經Bing 新聞）/.test(t), '媒體與來源：' + t.slice(0, 400))
    must(/RSS 摘要一/.test(t), 'RSS 摘要沒顯示')
    must(!(await p.evaluate(() => window.__xss)), '命中詞裡的標籤被執行'); must(t.includes('<img src=x'), '命中詞要以文字顯示')
    must(/科技新報 RSS/.test(await text(p, '#n-banner2')), '橫幅：' + await text(p, '#n-banner2'))
    must(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '不該橫向捲動'); await p.context().close()
  })
  await check(`${label}：只有 1 個詞 → 不送出請求，新聞頁與首頁都說明至少 2 個詞`, async () => {
    reset(); const p = await open('#/news/g1', { groups: [{ id: 1, kw: ['半導體'], ex: [] }] })
    must(M.calls.length === 0, '不該送出請求：' + JSON.stringify(M.calls))
    must(/至少要 2 個關鍵字/.test(await text(p, '#n-main')), '新聞頁：' + (await text(p, '#n-main')).slice(0, 160))
    await p.goto(BASE + '#/'); await p.waitForTimeout(1200)
    must(M.calls.length === 0 && /至少要 2 個關鍵字/.test(await text(p, '#pg-home')), '首頁：' + M.calls.length); await p.context().close()
  })
  await check(`${label}：設定頁在只有 1 個詞的組別旁提示，補到 2 個詞後提示消失`, async () => {
    reset(); const p = await open('#/news-settings', { groups: [{ id: 1, kw: ['半導體'], ex: [] }, { id: 2, kw: ['AI', '散熱'], ex: [] }] })
    const warn = await p.$$eval('#ns-groups [role=status]', (x) => x.map((e) => e.innerText))
    must(warn.length === 1 && /只有 1 個關鍵字/.test(warn[0]) && /不會產生新聞/.test(warn[0]), '提示：' + JSON.stringify(warn))
    must(/命中其中至少 2 個不同關鍵字/.test(await text(p, '#pg-news-settings')), '規則說明')
    await p.fill('#ns-groups .kwrow:first-child input[data-chipadd]', 'AI'); await p.press('#ns-groups .kwrow:first-child input[data-chipadd]', 'Enter'); await p.waitForTimeout(300)
    must((await p.$$('#ns-groups [role=status]')).length === 0, '補到 2 個詞後提示還在'); await p.context().close()
  })
  await check(`${label}：後端回 400 NOT_ENOUGH_KEYWORDS → 顯示提示，不退回舊版 OR`, async () => {
    reset({ status: 400, errorCode: 'NOT_ENOUGH_KEYWORDS' }); const p = await open('#/news/g1', { groups: G2 })
    must(/至少要 2 個關鍵字/.test(await text(p, '#n-main')), '畫面：' + (await text(p, '#n-main')).slice(0, 160))
    must(M.calls.length >= 1 && M.calls.every((q) => q.kind === 'industry'), '不該改送舊版：' + JSON.stringify(M.calls)); await p.context().close()
  })
  await check(`${label}：沒有同時命中 2 個詞的結果 → 空狀態寫明門檻；聚合暫時抓不到顯示 partial 說明`, async () => {
    reset({ items: [], partial: true }); const p = await open('#/news/g1', { groups: G2 })
    const t = await text(p, '#n-main'); must(/沒有同時命中至少 2 個關鍵字的新聞/.test(t) && /只有科技新報的結果/.test(t), t.slice(0, 200)); await p.context().close()
  })
}
await check('個股新聞：仍走舊版查詢（沒有 kind），詞數不超過 5，不宣稱雙詞規則', async () => {
  reset(); const p = await open('#/stock/2330/home', { groups: G2, stock: { 2330: { kw: ['台積電', '2330', '法說會', '外資', '先進製程', '多餘第六個'], ex: [] } } })
  await p.waitForFunction(() => /個股新聞/.test(document.getElementById('s-news')?.innerText || ''), null, { timeout: 15000 }); await p.waitForTimeout(1500)
  const c = M.calls.filter((q) => !q.kind); must(c.length >= 1, '沒有舊版查詢：' + JSON.stringify(M.calls))
  must(c.every((q) => q.q.split(',').length <= 5), '個股詞數超過 5：' + JSON.stringify(c))
  must(!M.calls.some((q) => q.kind === 'stock' || q.topics), '新契約上線前不得送 kind=stock／topics'); await p.context().close()
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
process.exit(fail ? 1 : 0)
