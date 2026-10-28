// 盤中行情、新聞、報告：後端新端點全部用假的回應（route mock），評分與收盤行情用 fixture（或 KUPEI_TEST_SESSION 讀線上）。不建立真實帳號。
// 網站必須登入（2026-10-28）：每個裝置都放假的已登入 session（kps_mock_1）；「未登入引導登入」的情境已不存在。見 tests/_kupei_test.mjs。
// BASE=http://127.0.0.1:5382/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_live.mjs（SHOTS=<資料夾> 另存截圖）
import { chromium } from 'playwright'
import { routeBackend } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const SHOTS = process.env.SHOTS || ''
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }
const XSS = '<img src=x onerror="window.__xss=1">'

/* ---- 假的後端狀態（各項測試改這裡） ---- */
const M = {
  intraday: { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} },
  calls: [],
  news: { stale: false },
  postMode: 'new', // new → 202、dup → 200 同一筆、quota → 403 QUOTA_EXCEEDED
  requests: [],
}
// 快照時間用今天（台灣）：stale 且快照不是今天＝休市日，橋接層會退回收盤價（見 e2e_pages_wiring.mjs）
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const OPEN = (stale, ttl = 300) => ({
  phase: 'OPEN', stale, ttlSeconds: ttl,
  markets: { L: { at: `${TODAY}T10:15:00+08:00`, receivedAt: `${TODAY}T02:15:20Z`, source: 'twse' }, O: { at: `${TODAY}T10:14:00+08:00`, receivedAt: `${TODAY}T02:14:30Z`, source: 'tpex' } },
  quotes: { 2330: [1234.5, 12.5, 12345000, '10:15:00'], 2317: [null, null, null, null] },
})
const ITEMS = [
  { title: '台積電 法說會 ' + XSS, url: 'https://news.example.com/a', source: '經濟日報', publishedAt: '2026-10-27T01:00:00Z' },
  { title: '非 https 的新聞', url: 'http://news.example.com/b', source: '自由時報', publishedAt: '2026-10-26T23:00:00Z' },
  { title: 'javascript 連結', url: 'javascript:window.__xss=2', source: '自由時報', publishedAt: '2026-10-26T22:00:00Z' },
]
const REPORTS = [
  { period: '2026Q2', rev: 1, status: 'PUBLISHED', title: '第二季報告 ' + XSS, generatedAt: '2026-10-20T03:00:00Z', url: 'https://r.example.com/2330/2026Q2/1', files: [{ name: 'full.pdf', url: 'https://r.example.com/full.pdf' }, { name: 'bad.pdf', url: 'http://r.example.com/bad.pdf' }] },
  { period: '2026Q2', rev: 2, status: 'DRAFT', title: '草稿', generatedAt: '2026-10-25T03:00:00Z', url: null, files: [] },
  { period: '2026Q1', rev: 1, status: 'FAILED', title: '失敗', generatedAt: '2026-07-20T03:00:00Z', url: null, files: [] },
]
const SUMMARY = '第一行 **不是粗體**\n<script>window.__xss=3</script>\n[連結](javascript:alert(1))'

async function mockApi(route) {
  const r = route.request(), u = new URL(r.url()), path = u.pathname, auth = r.headers().authorization || ''
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  M.calls.push({ method: r.method(), path, qs: u.search, auth, body: r.postData() })
  const json = (status, body) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) })
  const err = (status, code) => json(status, { error: { code, message: code } })
  if (path === '/api/market/intraday') return json(200, M.intraday)
  if (path === '/api/news/sources') return json(200, { sources: [{ id: 'google-news', name: 'Google 新聞', url: 'https://news.google.com/' }, { id: 'x', name: '壞來源' + XSS, url: 'http://bad.example.com/' }] })
  if (path === '/api/news') return json(200, { items: ITEMS, fetchedAt: '2026-10-27T01:30:00Z', source: 'google-news-rss', ...(M.news.stale ? { stale: true } : {}) })
  let m
  if ((m = path.match(/^\/api\/reports\/(\d{4})\/requests$/))) {
    if (!auth.startsWith('Bearer kps_')) return err(401, 'UNAUTHENTICATED')
    if (r.method() === 'GET') return json(200, { requests: M.requests })
    if (M.postMode === 'quota') return err(403, 'QUOTA_EXCEEDED')
    const q = { id: 'req1', status: 'QUEUED', createdAt: '2026-10-27T02:00:00Z' }
    return json(M.postMode === 'dup' ? 200 : 202, q)
  }
  if ((m = path.match(/^\/api\/reports\/(\d{4})$/))) return json(200, { reports: m[1] === '2330' ? REPORTS : [] })
  if ((m = path.match(/^\/api\/reports\/(\d{4})\/([^/]+)\/([^/]+)$/))) {
    const rep = REPORTS.find((x) => x.period === m[2] && String(x.rev) === m[3])
    return rep ? json(200, { ...rep, summary: SUMMARY }) : err(404, 'NOT_FOUND')
  }
  return err(404, 'NOT_FOUND')
}

const SEED = {
  kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330', '2317'] }], cur: 1 }),
  kupei3_news: JSON.stringify({ span: 1, groups: [{ id: 1, kw: ['半導體', 'AI'], ex: ['廣告'] }], stock: { 2317: { kw: ['鴻海 電動車'], ex: ['謠言'] } } }),
}
async function open(hash = '', seed = SEED, clock = false) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  seed = { 'kupei:session': JSON.stringify({ token: 'kps_mock_1', username: 't-user', expiresAt: new Date(Date.now() + 864e5).toISOString() }), ...seed }
  await ctx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, seed)
  // 評分與收盤行情：fixture 或 KUPEI_TEST_SESSION 讀線上；新端點全部假的（下面的 route 後掛、優先）
  await routeBackend(ctx)
  await ctx.route(/\/api\/(market\/intraday|news|reports)/, mockApi)
  await ctx.route('**/api/auth/**', (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (r.url().endsWith('/login')) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ user: { id: 1, username: 't-user' }, token: 'kps_mock_1', expiresAt: new Date(Date.now() + 864e5).toISOString() }) })
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
  let ver = 0
  await ctx.route('**/api/store/**', (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (r.method() === 'PUT') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key: 'x', version: ++ver, updatedAt: new Date().toISOString() }) })
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key: 'x', version: 0, updatedAt: null, data: null }) })
  })
  const p = await ctx.newPage()
  if (clock) await p.clock.install()
  await p.route('**/fonts.g*/**', (r) => r.abort())
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  p.on('dialog', (d) => { errs.push('跳出對話框：' + d.message()); d.dismiss() })
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && /\S/.test(document.getElementById('h-upd')?.textContent || '') && document.querySelector('.page.on'), null, { timeout: 40000 })
  return p
}
const noInject = async (p) => {
  const r = await p.evaluate(() => ({ x: window.__xss || null, n: document.querySelectorAll('[onerror],[onload],script:not([src])').length, js: [...document.querySelectorAll('a[href]')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href'))).length }))
  must(!r.x, '注入的程式被執行：' + r.x); must(r.n === 0, '頁面出現 ' + r.n + ' 個帶事件屬性或內嵌 script 的元素'); must(r.js === 0, '出現 javascript: 連結')
}
const go = async (p, h, ms = 1200) => { await p.evaluate((x) => { location.hash = x }, h); await p.waitForTimeout(ms) }
const shot = async (p, name, sel) => { if (SHOTS) await (sel ? p.locator(sel) : p).screenshot({ path: `${SHOTS}/${name}.png` }) }
const calls = (re) => M.calls.filter((c) => re.test(c.path))

/* ---------------- 盤中行情 ---------------- */
await check('盤中 CLOSED：維持「收盤價 M/D・非即時」與收盤價', async () => {
  M.intraday = { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: { 2330: [1234.5, 1, 1, '13:30:00'] } }
  const p = await open('#/stock/2330/home'); await p.waitForTimeout(1500)
  const lbl = await p.innerText('#h-upd'); must(/收盤價 .*\d+\/\d+.*非即時/.test(lbl), '標示：' + lbl)
  const t = await p.innerText('#s-valcard'); must(!t.includes('1,234.5'), 'CLOSED 不該用盤中價格')
  must((await p.innerText('#s-val .k')).trim() === '成交價', '價格欄名稱依規格 B2 固定為「成交價」')
  must(calls(/intraday/).length >= 1, '沒有讀盤中端點')
  await p.context().close(); return lbl
})
await check('盤中 OPEN（證交所 MIS 快照）：價格覆蓋收盤、標示「證交所・約 10 分鐘延遲・HH:MM」、沒成交顯示「—」', async () => {
  M.intraday = OPEN(false)
  const p = await open('#/stock/2330/home'); await p.waitForTimeout(1500)
  const lbl = await p.innerText('#h-upd'); must(lbl.includes('證交所・約 10 分鐘延遲・10:15') && !/FinMind/.test(lbl), '標示：' + lbl)
  const t = await p.innerText('#s-valcard'); must(t.includes('1,234.5'), '個股頁沒有盤中價格：' + t.slice(0, 120))
  must(/證交所・約 10 分鐘延遲・10:15/.test(await p.innerText('#s-vbase')), '個股頁基準列沒有盤中時間')
  must((await p.innerText('#s-val .k')).trim() === '成交價', '價格欄名稱依規格 B2 固定為「成交價」（盤中時間由標示線說明）')
  must(await p.isHidden('#h-alert'), '不延遲時不該有警示')
  await shot(p, 'intraday_open_stock')
  await go(p, '#/stock/2317/home', 1500)
  const v2 = await p.innerText('#s-val .v'); must(v2.trim() === '—', '盤中沒成交應顯示「—」：' + v2)
  await go(p, '', 1500); await shot(p, 'intraday_open_home')
  await p.context().close(); return lbl
})
await check('盤中 stale：標示「盤中資料延遲」、價格仍顯示、出現延遲警示', async () => {
  M.intraday = OPEN(true)
  const p = await open('#/stock/2330/home'); await p.waitForTimeout(1500)
  const lbl = await p.innerText('#h-upd'); must(lbl.includes('盤中資料延遲'), '標示：' + lbl)
  must((await p.innerText('#s-valcard')).includes('1,234.5'), 'stale 也要顯示價格')
  await go(p, '', 1200)
  must(await p.isVisible('#h-alert') && /盤中資料延遲/.test(await p.innerText('#h-alert')), '沒有延遲警示')
  await shot(p, 'intraday_stale_home', '.meta')
  await p.context().close(); return lbl
})
await check('盤中只在 OPEN 時依 ttlSeconds 重抓（分頁可見）；CLOSED 不排程', async () => {
  M.intraday = OPEN(false, 300)
  const p = await open('', SEED, true); await p.waitForTimeout(1500)
  const n0 = calls(/intraday/).length
  await p.clock.fastForward(301000); await p.waitForTimeout(1500)
  const n1 = calls(/intraday/).length; must(n1 === n0 + 1, `OPEN：5 分鐘後應再抓 1 次（${n0} → ${n1}）`)
  M.intraday = { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: {}, quotes: {} }
  await p.clock.fastForward(301000); await p.waitForTimeout(1500) // 這次抓到 CLOSED → 不再排程
  const n2 = calls(/intraday/).length
  must(/收盤價/.test(await p.innerText('#h-upd')), '收盤後標示沒有改回收盤價')
  await p.clock.fastForward(601000); await p.waitForTimeout(1500)
  const n3 = calls(/intraday/).length; must(n3 === n2, `CLOSED 後不該再排程（${n2} → ${n3}）`)
  await p.context().close(); return `${n0}→${n1}→${n2}→${n3}`
})

/* ---------------- 新聞 ---------------- */
M.intraday = { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }
let P
await check('產業新聞：關鍵字與排除字來自本機設定、days=span、惡意標題不執行、非 https 不可點', async () => {
  P = await open('#/news/g1'); await P.waitForTimeout(1500)
  const c = calls(/^\/api\/news$/).map((x) => new URLSearchParams(x.qs))
  must(c.some((q) => q.get('q') === '半導體,AI' && q.get('exclude') === '廣告' && q.get('days') === '1'), '請求參數：' + c.map((q) => q.toString()).join(' | '))
  const main = await P.innerText('#n-main'); must(main.includes('<img src=x onerror'), '惡意標題沒有以文字顯示')
  await noInject(P)
  const links = await P.$$eval('#n-main a[target=_blank]', (x) => x.map((a) => a.getAttribute('href')))
  must(links.length === 1 && links[0] === 'https://news.example.com/a', '連結：' + JSON.stringify(links))
  must(main.includes('非 https 的新聞') && main.includes('javascript 連結'), '非 https 的新聞仍要列出標題')
  const bn = await P.innerText('#n-banner2'); must(/Google／Bing 新聞（每 30 分鐘更新）/.test(bn) && !/尚未提供/.test(bn), '標示：' + bn)
  must(!/尚未提供/.test(await P.innerText('#pg-news')), '新聞頁還有「尚未提供」')
  await shot(P, 'news_industry')
  return links.length + ' 個 https 連結'
})
await check('產業新聞 span=3 → days=3；stale 顯示「暫時無法更新」', async () => {
  M.news.stale = true; M.calls.length = 0
  await P.click('#n-seg [data-nspan="3"]'); await P.waitForTimeout(1500)
  must(calls(/^\/api\/news$/).some((x) => new URLSearchParams(x.qs).get('days') === '3'), '沒有用 days=3')
  must(/暫時無法更新/.test(await P.innerText('#n-main')), '沒有 stale 標示')
  M.news.stale = false
})
await check('個股新聞：預設「公司名稱,代號」days=5；有設定時用設定的關鍵字與排除字', async () => {
  M.calls.length = 0
  await go(P, '#/news/s2330', 1500)
  const q1 = calls(/^\/api\/news$/).map((x) => new URLSearchParams(x.qs))
  must(q1.some((q) => q.get('q') === '台積電,2330' && q.get('days') === '5' && !q.get('exclude')), '2330 請求：' + q1.map((q) => q.toString()).join(' | '))
  await noInject(P)
  await shot(P, 'news_stock')
  M.calls.length = 0
  await go(P, '#/stock/2317/home', 2000)
  const q2 = calls(/^\/api\/news$/).map((x) => new URLSearchParams(x.qs))
  must(q2.some((q) => q.get('q') === '鴻海 電動車' && q.get('exclude') === '謠言' && q.get('days') === '5'), '2317 請求：' + q2.map((q) => q.toString()).join(' | '))
  const sn = await P.innerText('#s-news'); must(sn.includes('台積電 法說會'), '個股頁新聞卡：' + sn.slice(0, 80))
  await noInject(P)
  await shot(P, 'news_stock_card', '#s-news')
})
await check('新聞來源：可停用的是新聞中出現的媒體；聚合器（/api/news/sources）只列出、名稱跳脫、只有 https 有連結', async () => {
  await go(P, '#/news-settings', 1500)
  const t = await P.innerText('#ns-src'); must(t.includes('經濟日報') && t.includes('Google 新聞') && t.includes('壞來源<img'), '來源：' + t.slice(0, 120))
  const ids = await P.$$eval('#ns-src [data-nsrc]', (x) => x.map((i) => i.dataset.nsrc)); must(ids.length === 2 && ids.includes('經濟日報') && ids.includes('自由時報'), '可停用：' + JSON.stringify(ids))
  const hrefs = await P.$$eval('#ns-src a', (x) => x.map((a) => a.getAttribute('href'))); must(hrefs.length === 1 && hrefs[0] === 'https://news.google.com/', '連結：' + JSON.stringify(hrefs))
  must(!/尚未提供/.test(await P.innerText('#ns-store')), '設定頁標示仍有「尚未提供」')
  await noInject(P)
  await shot(P, 'news_settings')
})
await check('停用來源後該來源的新聞不顯示', async () => {
  await P.uncheck('#ns-src [data-nsrc="經濟日報"]'); await P.waitForTimeout(300)
  await go(P, '#/news/g1', 1500)
  must(!(await P.innerText('#n-main')).includes('台積電 法說會'), '停用的來源仍顯示')
  await P.context().close()
})

/* ---------------- 報告 ---------------- */
await check('報告：個股頁列出已產生報告（含草稿）與摘要', async () => {
  P = await open('#/stock/2330/home'); await P.waitForTimeout(2500)
  const opts = await P.$$eval('#s-period option', (x) => x.map((o) => o.textContent))
  must(opts.length === 2 && opts.some((o) => /2026Q2 2（草稿）/.test(o)) && opts.some((o) => o === '2026Q2 1'), '期別：' + JSON.stringify(opts))
  must(calls(/requests$/).every((c) => c.method === 'GET' && c.auth === 'Bearer kps_mock_1'), '請求紀錄應只用登入權杖讀：' + JSON.stringify(calls(/requests$/).map((c) => c.auth)))
  await noInject(P)
  await shot(P, 'report_stock_card', '#s-report')
})
await check('報告單篇：summary 以純文字呈現（不解析 markdown、不執行 script）、連結只放 https', async () => {
  await go(P, '#/report/2330/2026Q2/1', 2000)
  const body = await P.innerText('#r-body')
  must(body.includes('**不是粗體**') && body.includes('<script>window.__xss=3</script>') && body.includes('[連結](javascript:alert(1))'), '摘要沒有原樣顯示：' + body.slice(0, 160))
  must(!(await P.$('#r-body p b')), 'markdown 被轉成粗體')
  const hrefs = await P.$$eval('#r-body a', (x) => x.map((a) => a.getAttribute('href')))
  must(hrefs.length === 2 && hrefs.every((h) => h.startsWith('https://')), '連結：' + JSON.stringify(hrefs))
  must((await P.innerText('#r-sub')).includes('第二季報告 <img'), '標題沒有跳脫顯示')
  await noInject(P)
  await shot(P, 'report_page')
})
await check('報告設定：歷次報告與自己的請求（已登入），不顯示上傳參考資料', async () => {
  await go(P, '#/report-settings', 2000)
  const hist = await P.innerText('#rs-history'); must(/2026Q2 1/.test(hist) && /失敗/.test(hist) && !/登入帳號後顯示/.test(hist), '歷次報告：' + hist.slice(0, 160))
  must(!(await P.isVisible('#rs-infield')) && !/inputs\//.test(await P.innerText('#rs-panel')), 'Pages 不支援上傳參考資料：整欄應隱藏、不顯示內部路徑')
  must(/產生報告/.test(await P.innerText('[data-repgen]')) && !/需登入/.test(await P.innerText('[data-repgen]')), '按鈕：' + await P.innerText('[data-repgen]'))
})
await check('報告設定：送出 202、重複回同一筆、超過上限提示 QUOTA_EXCEEDED', async () => {
  await go(P, '#/watch', 300); await go(P, '#/report-settings', 1500) // 重新畫報告設定（重讀自己的請求）
  must(calls(/requests$/).some((c) => c.method === 'GET' && c.auth === 'Bearer kps_mock_1'), '登入後沒有用登入權杖讀請求紀錄')
  const toast = async () => { await P.waitForFunction(() => document.getElementById('toast').style.display === 'flex', null, { timeout: 5000 }); return P.innerText('#toast-msg') }
  M.postMode = 'new'; M.calls.length = 0
  await P.click('[data-repgen]'); const t1 = await toast()
  const post = calls(/requests$/).find((c) => c.method === 'POST')
  must(post && post.auth === 'Bearer kps_mock_1' && JSON.parse(post.body).trigger === 'MANUAL' && /^\d{4}/.test(JSON.parse(post.body).period), 'POST：' + JSON.stringify(post))
  must(/已送出報告請求/.test(t1), '202 提示：' + t1)
  await P.waitForTimeout(2500)
  M.postMode = 'quota'
  await P.click('[data-repgen]'); const t3 = await toast(); must(/上限/.test(t3), '額度提示：' + t3)
  await P.waitForTimeout(2500)
  // 重複送出同期別：後端回 200 同一筆；重讀後自己的請求是排隊中 → 按鈕停用、顯示請求狀態
  M.postMode = 'dup'
  M.requests = [{ id: 'req1', period: '2026Q2', trigger: 'MANUAL', status: 'QUEUED', createdAt: '2026-10-27T02:00:00Z', updatedAt: '2026-10-27T02:00:00Z', message: '排隊 ' + XSS }]
  await P.click('[data-repgen]'); const t2 = await toast(); must(/沿用同一筆/.test(t2), '重複提示：' + t2)
  await P.waitForFunction(() => document.querySelector('[data-repgen]')?.disabled && /排隊中/.test(document.getElementById('rs-reqstate')?.textContent || ''), null, { timeout: 5000 })
  must((await P.innerText('#rs-history')).includes('排隊 <img'), '自己的請求沒有列出（或沒跳脫）')
  await noInject(P)
  await shot(P, 'report_settings')
  await P.context().close()
  return [t1, t2, t3].join('｜')
})
await check('頁面沒有 JS 錯誤', async () => { must(!errs.length, [...new Set(errs)].join(' | ')) })
await b.close()
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
process.exit(fail ? 1 : 0)
