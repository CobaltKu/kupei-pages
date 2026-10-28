// 瀏覽器測試共用（2026-10-28 登入閘門）：網站必須登入、建置不帶唯讀權杖，測試不再需要 VITE_KUPEI_TOKEN。
//
// 資料來源兩種模式：
//   - 預設（fixture）：/data/*、/api/market/*、新聞、報告都由 tests/fixtures/kupei-data.json 回應（合成資料，150 家），
//     完全不連線上後端。和線上後端一樣：沒帶登入權杖（Bearer kps_…）的資料請求回 401。
//   - KUPEI_TEST_SESSION=<登入權杖>（live）：資料請求改帶這個登入權杖讀線上後端。權杖只在記憶體裡用、不輸出。
//     線上後端限流每分鐘 30 次，整套跑完要一段時間；帳號、雲端文件一律仍是假的（不寫線上資料）。
//
// 跑法：playwright 裝在共用的 /Users/adem/vue.tools/qa/，把測試檔和本檔一起複製過去執行，KP_FIXTURE 指到這裡的 fixture：
//   cp tests/e2e_pages_gate.mjs tests/_kupei_test.mjs ../qa/ && cd ../qa && \
//   BASE=http://127.0.0.1:5381/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_gate.mjs
// 用法：
//   import { routeBackend, seedSession, MODE, MIN_ROWS } from './_kupei_test.mjs'
//   await routeBackend(ctx)               // 先掛：資料端點＋假的帳號／雲端文件預設值；測試自己的 route 之後再掛會蓋過它
//   await seedSession(ctx, 't-user')      // 這個 context 第一次開頁面時就是已登入（之後登出不會再自動登入）
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
export const SESSION = process.env.KUPEI_TEST_SESSION || ''
export const MODE = SESSION ? 'live' : 'fixture'
const FX = MODE === 'fixture' ? JSON.parse(fs.readFileSync(process.env.KP_FIXTURE || path.join(here, 'fixtures/kupei-data.json'), 'utf8')) : null
/** 首頁至少要有幾列才算載入完成（fixture 150 家、首頁約 148 列；線上約 1,979 家） */
export const MIN_ROWS = MODE === 'fixture' ? FX.files.summary.rows.length - 10 : 1900
export const FIXTURE = FX
export const API = /^https:\/\/kupei-dashboard\.tmac19920626\.workers\.dev\//
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }
/** 讀資料的路徑（沒登入時一個都不該出現） */
export const READ_PATH = /\/(data\/|api\/market\/|api\/news|api\/reports)/

const json = (route, status, body) => route.fulfill({ status, headers: CORS, body: typeof body === 'string' ? body : JSON.stringify(body) })
const authed = (r) => /^Bearer kps_\S+/.test(r.headers().authorization || '')
const CLOSED = { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }

/** fixture 模式：一個資料請求的回應 { status, ct, body（字串） } */
function fixtureResolve(r) {
  const u = new URL(r.url()), p = u.pathname
  const ok = (body, status = 200) => ({ status, ct: 'application/json', body: JSON.stringify(body) })
  const text = (status, body) => ({ status, ct: 'text/plain', body })
  if (!authed(r)) return p.startsWith('/data/') ? text(401, 'unauthorized') : ok({ error: { code: 'UNAUTHENTICATED', message: '需要登入' } }, 401)
  if (p === '/data/manifest.json') return ok(FX.manifest)
  let m = /^\/data\/([^/]+)\/details\/(\d{4})\.json$/.exec(p)
  if (m) return m[1] === FX.manifest.run && FX.details[m[2]] ? ok(FX.details[m[2]]) : text(404, 'not found')
  m = /^\/data\/([^/]+)\/([a-z_]+)\.json$/.exec(p)
  if (m) return m[1] === FX.manifest.run && FX.files[m[2]] ? ok(FX.files[m[2]]) : text(404, 'not found')
  if (p === '/api/market/latest') return ok(FX.latest)
  if (p === '/api/market/history') {
    const codes = (u.searchParams.get('codes') || '').split(',').filter(Boolean)
    if (!codes.length || codes.length > 30 || codes.some((c) => !/^\d{4}$/.test(c))) return ok({ error: { code: 'BAD_REQUEST', message: 'codes' } }, 400)
    const pickOf = (o) => Object.fromEntries(codes.filter((c) => o[c]).map((c) => [c, o[c]]))
    return ok({ quotes: pickOf(FX.history.quotes), revenue: pickOf(FX.history.revenue) })
  }
  if (p === '/api/market/intraday') return ok(CLOSED)
  if (p === '/api/news') return ok({ items: [], fetchedAt: new Date().toISOString(), source: 'google-news-rss' })
  if (p === '/api/news/sources') return ok({ sources: [{ id: 'google-news', name: 'Google 新聞', url: 'https://news.google.com/' }] })
  if (/^\/api\/reports\/\d{4}\/requests$/.test(p)) return r.method() === 'POST' ? ok({ id: 1, status: 'QUEUED', createdAt: new Date().toISOString() }, 202) : ok({ requests: [] })
  if (/^\/api\/reports\/\d{4}$/.test(p)) return ok({ reports: [] })
  return ok({ error: { code: 'NOT_FOUND', message: 'fixture 沒有這個路徑' } }, 404)
}

/**
 * 一個資料請求（/data/*、/api/market/*…）的回應內容 { status, ct, body（字串） }：fixture 模式查 fixture，
 * live 模式帶 KUPEI_TEST_SESSION 向線上抓。給要改回應內容或延遲回應的測試用（見 e2e_pages_wiring.mjs）。
 */
export async function resolveData(route) {
  const r = route.request()
  if (MODE === 'fixture') return fixtureResolve(r)
  const res = await route.fetch({ headers: { ...r.headers(), authorization: 'Bearer ' + SESSION } })
  return { status: res.status(), ct: res.headers()['content-type'] || 'application/json', body: await res.text() }
}

/** fixture 模式的資料端點（mutate(path, body) 可在回應前改內容，回傳新的 body） */
function fixtureData(route, mutate) {
  const r = route.request()
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const x = fixtureResolve(r)
  let body = x.body
  if (mutate && x.status === 200 && x.ct.includes('json')) { const j = JSON.parse(body); body = JSON.stringify(mutate(new URL(r.url()).pathname, j) ?? j) }
  return route.fulfill({ status: x.status, headers: { ...CORS, 'content-type': x.ct }, body })
}

/** live 模式：資料請求換成 KUPEI_TEST_SESSION 讀線上 */
async function liveData(route, mutate) {
  const r = route.request()
  if (r.method() === 'OPTIONS') return route.continue()
  const headers = { ...r.headers(), authorization: 'Bearer ' + SESSION }
  if (!mutate) return route.continue({ headers })
  const res = await route.fetch({ headers })
  const ct = res.headers()['content-type'] || ''
  if (!res.ok() || !ct.includes('json')) return route.fulfill({ response: res })
  const body = await res.json()
  return route.fulfill({ response: res, body: JSON.stringify(mutate(new URL(r.url()).pathname, body) ?? body) })
}

/** 假的帳號端點：login 回 kps_<帳號>；logout、me 回成功；其他 404 */
function fakeAuth(route) {
  const r = route.request(), p = new URL(r.url()).pathname
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  if (p.endsWith('/login')) {
    const u = String(JSON.parse(r.postData() || '{}').username || 't-user')
    return json(route, 200, { user: { id: 1, username: u }, token: 'kps_' + u, expiresAt: new Date(Date.now() + 864e5).toISOString() })
  }
  if (p.endsWith('/logout')) return json(route, 200, { ok: true })
  if (p.endsWith('/me')) return json(route, 200, { user: { id: 1, username: 't-user' } })
  return json(route, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
}

/** 假的雲端文件：都是空的、寫入一律成功（要驗同步邏輯的測試自己掛更完整的） */
function fakeStore(route) {
  const r = route.request(), u = new URL(r.url())
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const key = u.pathname.split('/')[3] || null
  if (!key) return json(route, 200, { docs: [] })
  if (r.method() === 'PUT') { const b = JSON.parse(r.postData() || '{}'); return json(route, 200, { key, version: (b.baseVersion || 0) + 1, updatedAt: new Date().toISOString() }) }
  return json(route, 200, { key, version: 0, updatedAt: null, data: null })
}

/**
 * 掛上後端的預設回應（一定要在測試自己的 route 之前掛：Playwright 後掛的 route 優先）。
 *   mutate(path, body)：改資料端點的回應內容（fixture 與 live 都適用）
 */
export async function routeBackend(ctx, { mutate } = {}) {
  // 最後的保險：沒列到的後端路徑一律 404，不會打到線上（live 模式的資料端點除外）
  await ctx.route(API, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : json(route, 404, { error: { code: 'NOT_FOUND', message: 'test: unrouted' } }))
  await ctx.route(/\/api\/auth\//, fakeAuth)
  await ctx.route(/\/api\/store(\/|$|\?)/, fakeStore)
  await ctx.route(READ_PATH, (route) => (MODE === 'live' ? liveData(route, mutate) : fixtureData(route, mutate)))
  await ctx.route('**/fonts.g*/**', (r) => r.abort())
}

/** 這個 context 第一次載入時放一個已登入的 session（假權杖 kps_<帳號>）；登出後不會再被放回去 */
export async function seedSession(ctx, username = 't-user', extra = {}) {
  await ctx.addInitScript(({ u, extra }) => {
    if (!location.protocol.startsWith('http') || localStorage.getItem('kp-test-seeded')) return
    localStorage.setItem('kupei:session', JSON.stringify({ token: 'kps_' + u, username: u, expiresAt: new Date(Date.now() + 864e5).toISOString() }))
    for (const k in extra) localStorage.setItem(k, extra[k])
    localStorage.setItem('kp-test-seeded', '1')
  }, { u: username, extra })
}

/** 在登入畫面登入（帳號、密碼、按登入） */
export async function gateLogin(p, username = 't-user', password = 'password-123') {
  await p.waitForSelector('#kp-gate #acct-user', { timeout: 20000 })
  await p.fill('#acct-user', username); await p.fill('#acct-pass', password); await p.click('#kp-gate [data-acct-submit]')
}

/** 等首頁列出全部公司 */
export const ready = (p, min = Math.min(100, MIN_ROWS)) => p.waitForFunction((n) => document.querySelectorAll('#h-body tr').length >= n, min, { timeout: 40000 })

/** 測試檔開頭：live 專用的測試在 fixture 模式直接略過 */
export function liveOnly(name) {
  if (MODE === 'live') return
  console.log(`略過 ${name}：這組測試比對線上真實資料（筆數、正式批次內容），要設 KUPEI_TEST_SESSION=<登入權杖> 才跑`)
  process.exit(0)
}
