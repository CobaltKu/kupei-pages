// 資料橋接修正（2026-10-28）：估價不擋首頁、新聞停用來源依媒體名稱、休市日不把前一天快照當盤中價、個股頁延遲載入與快取、
// 報告請求 id、新欄位結構驗證、summary.json 只讀一次、FinMind 來源標示。
// 評分與收盤行情用 fixture（或 KUPEI_TEST_SESSION 讀線上；部分測試在回應上改欄位）；盤中、新聞、報告、帳號全部用假的回應。不建立真實帳號。
// 網站必須登入（2026-10-28）：每個裝置都放假的已登入 session（kps_mock_1）。見 tests/_kupei_test.mjs。
// BASE=http://127.0.0.1:5442/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_wiring.mjs
import { chromium } from 'playwright'
import { routeBackend, resolveData } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }
const tpDay = (off = 0) => new Date(Date.now() + 8 * 3600e3 + off * 864e5).toISOString().slice(0, 10)

/* ---- 假的後端狀態 ---- */
const M = {
  calls: [],
  intraday: { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} },
  valDelay: 0, valArrived: 0, // 估價檔延遲（毫秒）、送達時間
  summaryMut: null, valMut: null, latestMut: null, // 改線上回應的函式
  postMode: 'new', requests: [],
}
const OPEN = (day, stale) => ({
  phase: 'OPEN', stale, ttlSeconds: 300,
  markets: { L: { at: `${day}T10:15:00+08:00`, receivedAt: '', source: 'twse-mis' }, O: { at: `${day}T10:14:00+08:00`, receivedAt: '', source: 'tpex-mis' } },
  quotes: { 2330: [1234.5, 12.5, 12345000, '10:15:00'] },
})
const ITEMS = [
  { title: '台積電 法說會', url: 'https://news.example.com/a', source: '經濟日報', publishedAt: '2026-10-27T01:00:00Z' },
  { title: '自由時報的新聞', url: 'https://news.example.com/b', source: '自由時報', publishedAt: '2026-10-26T23:00:00Z' },
  { title: '聚合器名稱當來源', url: 'https://news.example.com/c', source: 'Google 新聞', publishedAt: '2026-10-26T22:00:00Z' },
]
async function mockApi(route) {
  const r = route.request(), u = new URL(r.url()), path = u.pathname, auth = r.headers().authorization || ''
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  M.calls.push({ method: r.method(), path, qs: u.search, auth, t: Date.now() })
  const json = (status, body) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) })
  if (path === '/api/market/intraday') return json(200, M.intraday)
  if (path === '/api/news/sources') return json(200, { sources: [{ id: 'google-news', name: 'Google 新聞', url: 'https://news.google.com/' }, { id: 'bing-news', name: 'Bing 新聞', url: 'http://www.bing.com/news' }] })
  if (path === '/api/news') return json(200, { items: ITEMS, fetchedAt: '2026-10-27T01:30:00Z', source: 'google-news-rss' })
  let m
  if ((m = path.match(/^\/api\/reports\/(\d{4})\/requests$/))) {
    if (!auth.startsWith('Bearer kps_')) return json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })
    if (r.method() === 'GET') return json(200, { requests: M.requests })
    return json(M.postMode === 'dup' ? 200 : 202, { id: 42, status: 'QUEUED', createdAt: new Date().toISOString() })
  }
  if ((m = path.match(/^\/api\/reports\/(\d{4})$/))) return json(200, { reports: [{ period: '2026Q2', rev: 1, status: 'PUBLISHED', title: 't', generatedAt: '2026-10-20T03:00:00Z', url: null, files: [] }] })
  if ((m = path.match(/^\/api\/reports\/(\d{4})\/([^/]+)\/([^/]+)$/))) return json(200, { period: m[2], rev: +m[3], status: 'PUBLISHED', title: 't', generatedAt: '2026-10-20T03:00:00Z', url: null, files: [], summary: '摘要' })
  return json(404, { error: { code: 'NOT_FOUND', message: 'x' } })
}
/** 評分與收盤資料（fixture 或 KUPEI_TEST_SESSION 讀線上）；summary／valuation／latest 可改內容或延遲 */
async function live(route) {
  const r = route.request()
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const url = r.url()
  M.calls.push({ method: r.method(), path: new URL(url).pathname, t: Date.now() })
  const isVal = /\/valuation\.json/.test(url), isSum = /\/summary\.json/.test(url), isLatest = /\/api\/market\/latest/.test(url)
  const res = await resolveData(route)
  let body = res.body
  if (res.status === 200 && ((isSum && M.summaryMut) || (isVal && M.valMut) || (isLatest && M.latestMut))) {
    const j = JSON.parse(body)
    if (isSum && M.summaryMut) M.summaryMut(j)
    if (isVal && M.valMut) M.valMut(j)
    if (isLatest && M.latestMut) M.latestMut(j)
    body = JSON.stringify(j)
  }
  if (isVal && M.valDelay) await sleep(M.valDelay)
  if (isVal) M.valArrived = Date.now()
  return route.fulfill({ status: res.status, headers: { ...CORS, 'content-type': res.ct }, body })
}

const SEED = {
  kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330', '2317', '2454', '2308', '2303'] }], cur: 1 }),
  kupei3_news: JSON.stringify({ span: 1, groups: [{ id: 1, kw: ['半導體'], ex: [] }], stock: {} }),
}
const LOGIN = { 'kupei:session': JSON.stringify({ token: 'kps_mock_1', username: 't-user', expiresAt: new Date(Date.now() + 864e5).toISOString() }) }
async function open(hash = '', seed = SEED, wait = true) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await routeBackend(ctx)
  seed = { ...LOGIN, ...seed } // 網站必須登入：一律帶 session
  await ctx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, seed)
  await ctx.route(/\/(data\/|api\/market\/(latest|history))/, live)
  await ctx.route(/\/api\/(market\/intraday|news|reports)/, mockApi)
  let ver = 0
  await ctx.route('**/api/store**', (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (r.method() === 'PUT') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key: 'x', version: ++ver, updatedAt: new Date().toISOString() }) })
    if (/\/api\/store$/.test(r.url())) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ docs: [] }) })
    return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }) })
  })
  await ctx.route('**/api/auth/**', (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ user: { id: 1, username: 't-user' }, inviteRequired: false }) }))
  const p = await ctx.newPage()
  await p.route('**/fonts.g*/**', (r) => r.abort())
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  p.on('dialog', (d) => { errs.push('跳出對話框：' + d.message()); d.dismiss() })
  M.calls.length = 0
  await p.goto(BASE + hash)
  if (wait) await p.waitForFunction(() => document.getElementById('loading')?.hidden && /\S/.test(document.getElementById('h-upd')?.textContent || '') && document.querySelector('.page.on'), null, { timeout: 40000 })
  return p
}
const go = async (p, h, ms = 1200) => { await p.evaluate((x) => { location.hash = x }, h); await p.waitForTimeout(ms) }
const calls = (re, since = 0) => M.calls.filter((c) => re.test(c.path) && c.t >= since)

/* ---------------- 1. 估價檔不擋首頁 ---------------- */
await check('估價檔延遲 6 秒：首頁先畫好（不等估價），狀態頁估價基準日在估價載入後補上', async () => {
  M.valDelay = 6000; M.valArrived = 0
  const t0 = Date.now()
  const p = await open('', SEED, false)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && document.querySelectorAll('#h-body tr').length > 100, null, { timeout: 30000, polling: 50 })
  const ready = Date.now() - t0
  must(!M.valArrived, `首頁等到估價檔送達才畫（${ready} ms）`)
  await go(p, '#/status', 300)
  const before = await p.innerText('#st-kv')
  must(/全市場估價\s*啟用｜估價基準日 載入中/.test(before), '估價載入前狀態頁：' + (before.match(/全市場估價[^\n]*\n?[^\n]*/) || [''])[0])
  await p.waitForFunction(() => /估價基準日 \d{4}-\d{2}-\d{2}/.test(document.getElementById('st-kv')?.innerText || ''), null, { timeout: 20000 })
  M.valDelay = 0
  await p.context().close()
  return `首頁 ${ready} ms 可用，估價 ${M.valArrived - t0} ms 才送達`
})

/* ---------------- 3. 休市日 ---------------- */
await check('休市日：phase=OPEN、stale、快照是前一天 → 退回收盤價、不標盤中', async () => {
  M.intraday = OPEN(tpDay(-1), true)
  const p = await open('#/stock/2330/home'); await p.waitForTimeout(1200)
  const lbl = await p.innerText('#h-upd')
  must(/收盤價/.test(lbl) && !/盤中/.test(lbl), '標示：' + lbl)
  must((await p.innerText('#s-val .k')).trim() === '成交價', '價格欄名稱依規格 B2 固定為「成交價」')
  must(!(await p.innerText('#s-valcard')).includes('1,234.5'), '不該用前一天的盤中快照價格')
  await go(p, '', 800)
  must(await p.isHidden('#h-alert'), '休市日不該出現盤中延遲警示')
  await p.context().close(); return lbl
})
await check('今天的快照但延遲（stale）→ 顯示盤中價並標「盤中資料延遲」', async () => {
  M.intraday = OPEN(tpDay(0), true)
  const p = await open('#/stock/2330/home'); await p.waitForTimeout(1200)
  const lbl = await p.innerText('#h-upd'); must(/盤中資料延遲/.test(lbl), '標示：' + lbl)
  must((await p.innerText('#s-valcard')).includes('1,234.5'), '今天延遲的快照仍要顯示價格')
  M.intraday = { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }
  await p.context().close(); return lbl
})

/* ---------------- 5. FinMind 來源標示 ---------------- */
await check('latest.source 有 finmind：首頁行情標示、個股估價卡、狀態頁標「資料來源：FinMind」；exchange 不標', async () => {
  M.latestMut = (j) => { j.source = { L: 'finmind', O: 'exchange' } }
  let p = await open('#/stock/2330/home'); await p.waitForTimeout(800)
  must(/資料來源：FinMind/.test(await p.innerText('#h-upd')), '首頁行情標示：' + await p.innerText('#h-upd'))
  must(/資料來源：FinMind/.test(await p.innerText('#s-vbase')), '估價卡：' + await p.innerText('#s-vbase'))
  await go(p, '#/status', 600)
  must(/資料來源 FinMind/.test(await p.innerText('#st-kv')) && /收盤資料來源：FinMind/.test(await p.innerText('#st-src')), '狀態頁沒有標示')
  await go(p, '', 600)
  must(/資料來源：FinMind/.test(await p.innerText('#h-banner')), '首頁說明列沒有標示')
  await p.context().close()
  M.latestMut = (j) => { j.source = { L: 'exchange', O: 'exchange' } }
  p = await open('')
  must(!/FinMind/.test(await p.innerText('#h-upd')) && !/FinMind/.test(await p.innerText('#h-banner')), 'exchange 不該標 FinMind')
  M.latestMut = null
  await p.context().close()
})

/* ---------------- 2. 新聞停用來源 ---------------- */
await check('新聞來源：清單＝新聞中出現的媒體（可停用）＋聚合器（只列出）；停用依媒體名稱過濾', async () => {
  const p = await open('#/news/g1'); await p.waitForTimeout(1500)
  await go(p, '#/news-settings', 1500)
  const ids = await p.$$eval('#ns-src [data-nsrc]', (x) => x.map((i) => i.dataset.nsrc))
  must(JSON.stringify(ids.sort()) === JSON.stringify(['經濟日報', '自由時報'].sort()), '可停用的來源：' + JSON.stringify(ids))
  const t = await p.innerText('#ns-src'); must(t.includes('Google 新聞') && t.includes('Bing 新聞') && /聚合來源/.test(t), '聚合器沒有列出：' + t.slice(0, 200))
  const hrefs = await p.$$eval('#ns-src a', (x) => x.map((a) => a.getAttribute('href'))); must(hrefs.length === 1 && hrefs[0] === 'https://news.google.com/', '連結：' + JSON.stringify(hrefs))
  await p.uncheck('#ns-src [data-nsrc="自由時報"]'); await p.waitForTimeout(300)
  const n0 = calls(/^\/api\/news$/).length
  await go(p, '#/news/g1', 1200)
  const main = await p.innerText('#n-main')
  must(!main.includes('自由時報的新聞') && main.includes('台積電 法說會'), '停用後：' + main.slice(0, 200))
  must(calls(/^\/api\/news$/).length === n0, '停用來源不該重打新聞 API（5 分鐘快取）')
  await p.reload(); await p.waitForFunction(() => document.getElementById('loading')?.hidden, null, { timeout: 30000 })
  await go(p, '#/news-settings', 2000)
  const st = await p.$$eval('#ns-src [data-nsrc]', (x) => x.map((i) => [i.dataset.nsrc, i.checked]))
  must(st.some(([n, c]) => n === '自由時報' && !c) && st.some(([n, c]) => n === '經濟日報' && c), '直接打開設定頁（重新載入後）：' + JSON.stringify(st))
  await p.context().close()
  return ids.join('、')
})

/* ---------------- 4. 個股頁延遲載入與快取 ---------------- */
await check('快速翻 4 家（每家 300ms）只替停下來的那家打報告與新聞；回到看過的不重打', async () => {
  const p = await open('#/watch', SEED); await p.waitForTimeout(800)
  const t0 = Date.now()
  for (const id of ['2330', '2317', '2454', '2308']) await go(p, `#/stock/${id}/watch:1`, 300)
  await p.waitForTimeout(2500)
  const rep = calls(/^\/api\/reports\//, t0).map((c) => c.path), news = calls(/^\/api\/news$/, t0)
  must(rep.length >= 1 && rep.every((x) => x.startsWith('/api/reports/2308')), '報告請求：' + JSON.stringify(rep))
  must(news.length === 1, '新聞請求 ' + news.length + ' 次（應只有停下來的 2308）')
  // 回到途經的 2454：停留夠久才抓；再回 2308：5 分鐘快取，不重打
  const t1 = Date.now()
  await go(p, '#/stock/2454/watch:1', 2500)
  must(calls(/^\/api\/reports\/2454/, t1).length >= 1, '停在 2454 超過 1.5 秒後沒有讀報告')
  const t2 = Date.now()
  await go(p, '#/stock/2308/watch:1', 2500)
  must(!calls(/^\/api\/(reports|news)/, t2).length, '回到 2308 不該重打：' + JSON.stringify(calls(/^\/api\/(reports|news)/, t2).map((c) => c.path)))
  must((await p.innerText('#s-report')).includes('閱讀全文'), '2308 報告卡沒有內容')
  // 翻過但沒停下來的 2317 沒有任何請求
  must(!calls(/^\/api\/reports\/2317/, t0).length, '途經的 2317 不該讀報告')
  await p.context().close()
  return `報告 ${rep.length}、新聞 ${news.length}`
})
await check('卡片在畫面內：停留約 0.6 秒就載入（不用等 1.5 秒）；新聞頁不延遲', async () => {
  const p = await open('#/watch', SEED); await p.waitForTimeout(800)
  const vis = await p.evaluate(() => { const r = document.getElementById('s-news')?.getBoundingClientRect(); return r ? [Math.round(r.top), Math.round(r.height)] : null })
  const t0 = Date.now()
  await go(p, '#/stock/2330/watch:1', 0)
  await p.waitForFunction(() => /台積電 法說會|此區間沒有/.test(document.getElementById('s-news')?.innerText || ''), null, { timeout: 5000 })
  const first = calls(/^\/api\/news$/, t0)[0]
  const ms = first ? first.t - t0 : null
  const inView = await p.evaluate(() => { const r = document.getElementById('s-news').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && r.height > 0 })
  if (inView) must(ms != null && ms < 1400, `卡片可見時應在 1.5 秒內載入（${ms} ms）`)
  const t1 = Date.now()
  await go(p, '#/news/s2454', 0)
  await p.waitForFunction(() => /台積電 法說會/.test(document.getElementById('n-main')?.innerText || ''), null, { timeout: 5000 })
  const ms2 = calls(/^\/api\/news$/, t1)[0]?.t - t1
  must(ms2 < 500, `新聞頁不該延遲（${ms2} ms）`)
  await p.context().close()
  return `個股卡 ${ms} ms（卡片${inView ? '在' : '不在'}畫面內，進頁前 ${JSON.stringify(vis)}）、新聞頁 ${ms2} ms`
})

/* ---------------- 7. 報告請求 id ---------------- */
await check('報告請求 id 是整數：列表與送出結果的 id 轉成字串「42」，202／200 分得出來', async () => {
  M.requests = [{ id: 42, period: '2026Q2', trigger: 'MANUAL', status: 'QUEUED', createdAt: '2026-10-27T02:00:00Z', updatedAt: '2026-10-27T02:00:00Z', message: null }]
  const p = await open('#/watch', { ...SEED, ...LOGIN }); await p.waitForTimeout(500)
  const r = await p.evaluate(async () => {
    const list = await window.KupeiAPI.req('GET', '/reports/2330')
    const a = await window.KupeiAPI.req('POST', '/reports/2330/requests', { period: '2026Q2', trigger: 'MANUAL' })
    return { cur: list.data && list.data.current_request && list.data.current_request.id, reqs: list.data && list.data.requests.map((q) => q.id), post: a.data && a.data.id, st: a.status }
  })
  must(r.cur === '42' && r.reqs[0] === '42', '列表 id：' + JSON.stringify(r))
  must(r.post === '42' && r.st === 202, '送出：' + JSON.stringify(r))
  M.postMode = 'dup'
  const st2 = await p.evaluate(async () => (await window.KupeiAPI.req('POST', '/reports/2330/requests', { period: '2026Q2', trigger: 'MANUAL' })).status)
  must(st2 === 200, '同一期已在排隊應回 200：' + st2)
  must(calls(/requests$/).filter((c) => c.method === 'GET').every((c) => c.auth === 'Bearer kps_mock_1'), '請求紀錄沒有用登入權杖')
  M.postMode = 'new'; M.requests = []
  await p.context().close(); return JSON.stringify(r)
})

/* ---------------- 8＋9. 新欄位結構驗證、summary.json 只讀一次 ---------------- */
await check('company_meta／valuation 欄位結構不對：不合格的丟掉，首頁與個股頁照常顯示、沒有 JS 錯誤', async () => {
  const e0 = errs.length
  M.summaryMut = (j) => {
    const cm = j.company_meta || (j.company_meta = {})
    cm['2330'] = { ...(cm['2330'] || {}), assessment_status: 'ASSESSED', phase2_company_action: 'Review Required', eligibility_veto_features: 'oops', financial_review_sources: { x: 1 },
      phase2_review_reasons: [null, 1, 'x', [1], { category: 'TREND', feature_id: 'X', reason_code: 'R', rule_id: 'P2-1' }] }
    cm['2317'] = 'not-an-object'
  }
  M.valMut = (j) => {
    if (!j.companies) return
    j.companies['2330'] = { ...(j.companies['2330'] || {}), flags: 'BAD', reason_codes: 5 }
    j.companies['2317'] = null
    j.dataset_limitations = 'x'
  }
  const p = await open('#/stock/2330/home'); await p.waitForTimeout(2500)
  must(/2330/.test(await p.innerText('#s-title')), '個股頁沒有畫出來')
  const c = await p.evaluate(async () => { const x = await window.KupeiAPI.company('2330'); return { r: x.p2reasons.length, v: Array.isArray(x.vetoFeatures), f: Array.isArray(x.finSources) } })
  must(c.r === 1 && c.v && c.f, '過濾結果：' + JSON.stringify(c))
  await go(p, '#/stock/2317/home', 1500)
  must(/2317/.test(await p.innerText('#s-title')), '2317 個股頁沒有畫出來')
  await go(p, '', 1500)
  must(await p.$$eval('#h-body tr', (x) => x.length) > 100, '首頁沒有畫出來')
  const sum = calls(/\/summary\.json$/).length
  must(sum === 1, 'summary.json 讀了 ' + sum + ' 次（應 1 次）')
  must(errs.length === e0, errs.slice(e0).join(' | '))
  M.summaryMut = M.valMut = null
  await p.context().close(); return `p2reasons ${c.r}、summary.json ${sum} 次`
})
await check('頁面沒有 JS 錯誤', async () => { must(!errs.length, [...new Set(errs)].join(' | ')) })
await b.close()
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
process.exit(fail ? 1 : 0)
