// 雲端同步邏輯測試：用假的帳號與雲端文件端點（不建立真實帳號、不碰線上資料）。
// 評分與行情仍讀線上 Workers。BASE=http://127.0.0.1:5173/ node e2e_pages_sync.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
// 假權杖打不進線上資料端點（會被判 401 而清掉登入），所以資料請求改帶 KuPei 本機的唯讀權杖（只在記憶體中使用，不輸出）
const ENV = Object.fromEntries(fs.readFileSync(process.env.ENVFILE, 'utf8').split(String.fromCharCode(10)).map((l) => l.replace(String.fromCharCode(13), '')).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 假的雲端：帳號 t-user，文件有版本；寫入版本不符回 409 ──
const store = new Map() // key -> {version, updatedAt, data}
const log = []
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }
async function mock(ctx) {
  await ctx.route(/\/(data|api\/market)\//, (route) => route.request().method() === 'OPTIONS' ? route.continue() : route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer ' + ENV.VITE_KUPEI_TOKEN } }))
  await ctx.route('**/api/auth/**', async (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (r.url().endsWith('/api/auth/login')) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ user: { id: 1, username: 't-user' }, token: 'kps_mock', expiresAt: new Date(Date.now() + 864e5).toISOString() }) })
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
  await ctx.route('**/api/store/**', async (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const key = new URL(r.url()).pathname.split('/').pop()
    const cur = store.get(key) || { version: 0, updatedAt: null, data: null }
    if (r.method() === 'GET') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key, ...cur }) })
    if (r.method() === 'PUT') {
      const body = JSON.parse(r.postData() || '{}')
      log.push(`PUT ${key} base=${body.baseVersion} cloud=${cur.version}`)
      if (body.baseVersion !== cur.version) return route.fulfill({ status: 409, headers: CORS, body: JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'conflict', details: { key, ...cur } } }) })
      const next = { version: cur.version + 1, updatedAt: new Date().toISOString(), data: body.data }
      store.set(key, next)
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key, version: next.version, updatedAt: next.updatedAt }) })
    }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
}
async function device() {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await mock(ctx)
  const p = await ctx.newPage()
  await p.route('**/fonts.g*/**', (r) => r.abort())
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  return p
}
const ready = (p) => p.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100, null, { timeout: 40000 })
async function addStar(p, n) {
  await p.goto(BASE); await ready(p)
  await p.click(`#h-body tr:nth-child(${n}) [data-menu]`); await p.click('.menu [data-setg]'); await p.waitForTimeout(600)
}
async function login(p) {
  await p.click('[data-acct]'); await p.waitForSelector('#acct-user')
  await p.fill('#acct-user', 't-user'); await p.fill('#acct-pass', 'password-123'); await p.click('[data-acct-submit]')
}
const watchIds = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('kupei3_watch')).groups.flatMap((g) => g.ids) } catch { return null } })

const A = await device()
await check('裝置 A：先加自選，再登入 → 雲端是空的，本機資料帶上去', async () => {
  await addStar(A, 2); const ids = await watchIds(A); must(ids?.length === 1, '本機自選 ' + JSON.stringify(ids))
  await login(A); await A.waitForFunction(() => !document.getElementById('acct-host') || /已登入/.test(document.getElementById('acct-host').innerText), null, { timeout: 15000 })
  await sleep(2500)
  const doc = store.get('ui-watch'); must(doc && doc.version === 1, '雲端 ui-watch：' + JSON.stringify(doc && doc.version))
  must(JSON.parse(doc.data.value).groups[0].ids.length === 1, '雲端內容不對')
  return log.join('；')
})
const B = await device()
await check('裝置 B：登入 → 載入 A 的自選', async () => {
  await B.goto(BASE); await ready(B)
  await login(B); await B.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100, null, { timeout: 30000 }).catch(() => {})
  await B.waitForTimeout(3500); await ready(B)
  const ids = await watchIds(B); must(ids && ids.length === 1, 'B 的自選 ' + JSON.stringify(ids)); return ids.join(',')
})
await check('裝置 B：再加一家 → 雲端版本 2', async () => {
  await B.goto(BASE); await ready(B)
  await B.click('#h-body tr:nth-child(3) [data-menu]'); await B.click('.menu [data-setg]'); await B.waitForTimeout(2800)
  const dbg = await B.evaluate(() => ({ meta: localStorage.getItem('kupei3_sync'), watch: localStorage.getItem('kupei3_watch'), sess: !!localStorage.getItem('kupei:session') }))
  const doc = store.get('ui-watch'); must(doc && doc.version === 2, '版本 ' + (doc && doc.version) + ' ' + JSON.stringify(dbg)); return log.slice(-1)[0]
})
await check('裝置 A：重新整理 → 取得 B 的變更', async () => {
  await A.goto(BASE); await ready(A); await A.waitForTimeout(500)
  const ids = await watchIds(A); must(ids && ids.length === 2, 'A 的自選 ' + JSON.stringify(ids)); return ids.join(',')
})
await check('版本衝突：A 與 B 同時改，後寫入者載入雲端並保留本機副本', async () => {
  await B.goto(BASE); await ready(B)
  await B.click('#h-body tr:nth-child(4) [data-menu]'); await B.click('.menu [data-setg]'); await B.waitForTimeout(2800) // 雲端版本 3
  await A.click('#h-body tr:nth-child(5) [data-menu]'); await A.click('.menu [data-setg]') // A 以版本 2 為底
  await A.waitForTimeout(5000); await ready(A)
  const conflict = await A.evaluate(() => localStorage.getItem('kupei3_watch_conflict')); must(conflict, 'A 沒有保留本機副本')
  const ids = await watchIds(A); must(ids && ids.length === 3, 'A 載入雲端後的自選 ' + JSON.stringify(ids)); return ids.join(',')
})
await check('舊寫入權杖相容：貼上後載入雲端自選', async () => {
  const C = await device(); await C.goto(BASE); await ready(C)
  await C.click('[data-acct]'); await C.waitForSelector('#acct-wt', { state: 'attached' }); await C.evaluate(() => { document.querySelector('.acct-adv').open = true })
  await C.fill('#acct-wt', 'wt-mock'); await C.click('[data-acct-wt-save]')
  await C.waitForTimeout(3500); await ready(C)
  const ids = await watchIds(C); must(ids && ids.length === 3, 'C 的自選 ' + JSON.stringify(ids)); return ids.join(',')
})
await check('登出後資料保留在本機、不再同步', async () => {
  await A.click('[data-acct]'); await A.click('[data-acct-logout]'); await A.waitForTimeout(800)
  const ids = await watchIds(A); must(ids && ids.length === 3, '登出後本機自選 ' + JSON.stringify(ids))
  const before = store.get('ui-watch').version
  await A.goto(BASE); await ready(A); await A.click('#h-body tr:nth-child(6) [data-menu]'); await A.click('.menu [data-setg]'); await A.waitForTimeout(2800)
  must(store.get('ui-watch').version === before, '登出後仍有寫入雲端'); return ''
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
console.log('雲端寫入紀錄：' + log.join(' / '))
