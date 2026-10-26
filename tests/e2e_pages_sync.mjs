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

// ── 假的雲端：文件依帳號分開（登入權杖 kps_<帳號>；寫入權杖 wt-mock 共用 t-user 那份），有版本；寫入版本不符回 409 ──
const stores = new Map() // 帳號 -> Map(key -> {version, updatedAt, data})
const storeOf = (u) => { if (!stores.has(u)) stores.set(u, new Map()); return stores.get(u) }
const store = storeOf('t-user')
const log = []
let delayWatchMs = 0 // >0：下一次 GET ui-watch 延遲這麼久（模擬啟動時同步逾時）
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }
async function mock(ctx) {
  await ctx.route(/\/(data|api\/market)\//, (route) => route.request().method() === 'OPTIONS' ? route.continue() : route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer ' + ENV.VITE_KUPEI_TOKEN } }))
  await ctx.route('**/api/auth/**', async (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (r.url().endsWith('/api/auth/login')) { const u = JSON.parse(r.postData() || '{}').username; return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ user: { id: 1, username: u }, token: 'kps_' + u, expiresAt: new Date(Date.now() + 864e5).toISOString() }) }) }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
  await ctx.route('**/api/store/**', async (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const key = new URL(r.url()).pathname.split('/').pop()
    const tok = (r.headers().authorization || '').replace('Bearer ', '')
    const user = tok === 'wt-mock' ? 't-user' : tok.startsWith('kps_') ? tok.slice(4) : null
    if (!user) return route.fulfill({ status: 401, headers: CORS, body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'no' } }) })
    const st = storeOf(user)
    if (r.method() === 'GET' && key === 'ui-watch' && delayWatchMs) { const ms = delayWatchMs; delayWatchMs = 0; await sleep(ms) }
    const cur = st.get(key) || { version: 0, updatedAt: null, data: null }
    if (r.method() === 'GET') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key, ...cur }) })
    if (r.method() === 'PUT') {
      const body = JSON.parse(r.postData() || '{}')
      log.push(`PUT ${user}/${key} base=${body.baseVersion} cloud=${cur.version}`)
      // 雲端文件已被刪（沒有內容）：409 不附 details，客戶端要當作版本 0 重寫
      if (body.baseVersion !== cur.version) return route.fulfill({ status: 409, headers: CORS, body: JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'conflict', ...(cur.data ? { details: { key, ...cur } } : {}) } }) })
      const next = { version: cur.version + 1, updatedAt: new Date().toISOString(), data: body.data }
      st.set(key, next)
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
async function login(p, user = 't-user') {
  await p.click('[data-acct]'); await p.waitForSelector('#acct-user')
  await p.fill('#acct-user', user); await p.fill('#acct-pass', 'password-123'); await p.click('[data-acct-submit]')
}
const metaOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('kupei3_sync') || 'null'))
const prevIds = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('kupei3_watch_prev')).groups.flatMap((g) => g.ids) } catch { return null } })
const cloudIds = (u) => { const d = storeOf(u).get('ui-watch'); return d && d.data ? JSON.parse(d.data.value).groups.flatMap((g) => g.ids) : null }
const star = async (p, n) => { await p.click(`#h-body tr:nth-child(${n}) [data-menu]`); await p.click('.menu [data-setg]') }
const watchIds = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('kupei3_watch')).groups.flatMap((g) => g.ids) } catch { return null } })

const A = await device()
await check('裝置 A：先加自選，再首次登入 → 雲端是空的，本機資料帶上去', async () => {
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
await check('換帳號：A 登出後 u-other（雲端空）登入 → 不上傳 A 的自選，本機改用雲端並備份到 _prev', async () => {
  const mine = await watchIds(A); must(mine && mine.length === 4, '登出前本機自選 ' + JSON.stringify(mine))
  await login(A, 'u-other'); await A.waitForTimeout(4000); await ready(A); await A.waitForTimeout(2500)
  const cloud = cloudIds('u-other'); must(!cloud || cloud.length === 0, 'u-other 雲端混入 A 的自選 ' + JSON.stringify(cloud))
  const ids = await watchIds(A); must(!ids || ids.length === 0, 'A 本機仍是舊帳號的自選 ' + JSON.stringify(ids))
  const prev = await prevIds(A); must(prev && prev.length === 4, '_prev 備份 ' + JSON.stringify(prev))
  const m = await metaOf(A); must(m.owner === 'u-other', 'owner ' + m.owner)
  must(store.get('ui-watch').data && JSON.parse(store.get('ui-watch').data.value).groups.flatMap((g) => g.ids).length === 3, 't-user 雲端被改到')
  return 'u-other 雲端 ' + JSON.stringify(cloud)
})
await check('換帳號：雲端版本號巧合相同也不蓋掉 u-third 的資料', async () => {
  await A.goto(BASE); await ready(A); await star(A, 7); await A.waitForTimeout(2800)
  const v = (await metaOf(A)).versions['ui-watch']; must(v >= 1, 'u-other 版本 ' + v)
  await A.click('[data-acct]'); await A.click('[data-acct-logout]'); await A.waitForTimeout(800)
  await A.goto(BASE); await ready(A); await star(A, 8); await A.waitForTimeout(800)
  const mine = await watchIds(A)
  const tmpl = JSON.parse(await A.evaluate(() => localStorage.getItem('kupei3_watch')))
  tmpl.groups.forEach((g, i) => (g.ids = i === 0 ? ['1101', '1102', '1103'] : []))
  storeOf('u-third').set('ui-watch', { version: v, updatedAt: new Date().toISOString(), data: { savedAt: '', value: JSON.stringify(tmpl) } })
  const puts = log.length
  await login(A, 'u-third'); await A.waitForTimeout(4000); await ready(A); await A.waitForTimeout(2500)
  const ids = await watchIds(A); must(JSON.stringify(ids) === JSON.stringify(['1101', '1102', '1103']), 'A 本機 ' + JSON.stringify(ids))
  must(storeOf('u-third').get('ui-watch').version === v, 'u-third 雲端被寫入：' + log.slice(puts).join('；'))
  must(JSON.stringify(await prevIds(A)) === JSON.stringify(mine), '_prev 不是換帳號前的本機資料')
  return `版本 ${v}`
})
await check('409 但雲端文件已被刪：當作版本 0 重寫一次就成功', async () => {
  await B.goto(BASE); await ready(B); await B.waitForTimeout(500)
  store.delete('ui-watch')
  const puts = log.length
  await star(B, 9); await B.waitForTimeout(3000)
  const mine = log.slice(puts).filter((l) => l.includes('/ui-watch '))
  must(mine.length === 2 && /base=[1-9]\d* cloud=0/.test(mine[0]) && /base=0 cloud=0/.test(mine[1]), '寫入紀錄 ' + mine.join('；'))
  must(store.get('ui-watch')?.version === 1, '雲端版本 ' + store.get('ui-watch')?.version)
  const ids = await watchIds(B); must(JSON.stringify(cloudIds('t-user')) === JSON.stringify(ids), '雲端內容與本機不同')
  return mine.join('；')
})
await check('啟動同步逾時：晚回來改寫本機就重新載入，之後的修改不會把舊內容推上去', async () => {
  const cur = store.get('ui-watch'); const val = JSON.parse(cur.data.value)
  val.groups[0].ids = val.groups[0].ids.slice(0, 1) // 另一台裝置把自選改成只剩 1 家
  store.set('ui-watch', { version: cur.version + 1, updatedAt: new Date().toISOString(), data: { savedAt: '', value: JSON.stringify(val) } })
  const want = val.groups.flatMap((g) => g.ids)
  delayWatchMs = 6000
  let loads = 0; const onLoad = () => loads++; B.on('load', onLoad)
  await B.goto(BASE); await B.waitForTimeout(9000); await ready(B); B.off('load', onLoad)
  must(loads >= 2, '逾時後沒有重新載入（load ' + loads + ' 次）')
  const ids = await watchIds(B); must(JSON.stringify(ids) === JSON.stringify(want), 'B 本機 ' + JSON.stringify(ids))
  await star(B, 10); await B.waitForTimeout(2800)
  const cloud = cloudIds('t-user'); must(cloud.length === want.length + 1 && cloud[0] === want[0], '雲端 ' + JSON.stringify(cloud) + '，應為 ' + JSON.stringify(want) + ' 加 1 家')
  return `雲端版本 ${store.get('ui-watch').version}`
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
console.log('雲端寫入紀錄：' + log.join(' / '))
