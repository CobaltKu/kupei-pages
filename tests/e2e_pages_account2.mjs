// 帳號（二）：忘記密碼（POST /api/auth/reset，在登入畫面）與「匯入舊的寫入權杖資料」（已登入的帳號視窗）。
// 全部用假的帳號與雲端文件端點，不建立真實帳號；資料用 fixture（或 KUPEI_TEST_SESSION 讀線上），見 tests/_kupei_test.mjs。
// BASE=http://127.0.0.1:5395/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_account2.mjs（SHOTS=<資料夾> 另存截圖）
import { chromium } from 'playwright'
import fs from 'node:fs'
import { routeBackend, seedSession } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const SHOTS = process.env.SHOTS || ''
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }

// ── 假的後端 ──
// 重設碼：t-user 的 ABCD-EFGH-JKLM 有效（只能用一次）；其他一律 401 INVALID_CREDENTIALS
// 雲端文件：登入權杖 kps_<帳號> → 該帳號；寫入權杖 wt-old → 共用的 kupei 那份；wt-empty → 空的；其他權杖 401
const OLD_TOKEN = 'wt-old-' + Math.random().toString(36).slice(2), EMPTY_TOKEN = 'wt-empty-' + Math.random().toString(36).slice(2)
const stores = new Map()
const storeOf = (u) => { if (!stores.has(u)) stores.set(u, new Map()); return stores.get(u) }
const authCalls = [], log = [], urls = []
let codeUsed = false, raceOnce = false, quota = false
async function mock(ctx) {
  await routeBackend(ctx)
  await ctx.route('**/api/auth/**', async (route) => {
    const r = route.request(), path = new URL(r.url()).pathname
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = r.postData() ? JSON.parse(r.postData()) : {}
    authCalls.push({ path, body, auth: r.headers().authorization })
    const err = (status, code) => route.fulfill({ status, headers: CORS, body: JSON.stringify({ error: { code, message: code } }) })
    const sess = (u, t) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ user: { id: 1, username: u }, token: t, expiresAt: new Date(Date.now() + 864e5).toISOString() }) })
    if (path.endsWith('/config')) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ inviteRequired: false }) })
    if (path.endsWith('/login')) return sess(body.username, 'kps_' + body.username)
    if (path.endsWith('/reset')) {
      if (body.username !== 't-user' || body.code !== 'ABCD-EFGH-JKLM' || codeUsed) return err(401, 'INVALID_CREDENTIALS')
      if (typeof body.newPassword !== 'string' || body.newPassword.length < 8) return err(400, 'BAD_REQUEST')
      codeUsed = true
      return sess('t-user', 'kps_t-user')
    }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
  await ctx.route(/\/api\/store(\/|$|\?)/, async (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(r.url())
    const parts = url.pathname.split('/').filter(Boolean) // ['api','store',key?]
    const key = parts[2] || null
    const tok = (r.headers().authorization || '').replace('Bearer ', '')
    const user = tok === OLD_TOKEN ? 'kupei' : tok === EMPTY_TOKEN ? 'empty' : tok.startsWith('kps_') ? tok.slice(4) : null
    if (!user) return route.fulfill({ status: 401, headers: CORS, body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'no' } }) })
    const st = storeOf(user)
    if (!key) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ docs: [...st].map(([k, d]) => ({ key: k, version: d.version, updatedAt: d.updatedAt, bytes: 10 })) }) })
    const cur = st.get(key) || { version: 0, updatedAt: null, data: null }
    if (r.method() === 'GET') {
      await route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key, ...cur }) })
      // 讀到版本之後、寫入之前，另一台裝置先寫了一次（下一個 PUT 會 409）
      if (raceOnce && user !== 'kupei' && key === 'ui-watch') { raceOnce = false; st.set(key, { ...cur, version: cur.version + 1, updatedAt: new Date().toISOString() }) }
      return
    }
    if (r.method() === 'PUT') {
      const body = JSON.parse(r.postData() || '{}')
      if (quota) { log.push(`PUT ${user}/${key} quota`); return route.fulfill({ status: 403, headers: CORS, body: JSON.stringify({ error: { code: 'QUOTA_EXCEEDED', message: 'quota' } }) }) }
      const conflict = body.baseVersion !== cur.version
      log.push(`PUT ${user}/${key} base=${body.baseVersion} cloud=${cur.version}${conflict ? ' 409' : ''}`)
      if (conflict) return route.fulfill({ status: 409, headers: CORS, body: JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'conflict', ...(cur.data ? { details: { key, ...cur } } : {}) } }) })
      const next = { version: cur.version + 1, updatedAt: new Date().toISOString(), data: body.data }
      st.set(key, next)
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key, version: next.version, updatedAt: next.updatedAt }) })
    }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
}
/** user：放一個已登入的 session；不給＝停在登入畫面 */
async function device(width = 1440, user = null) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } })
  await mock(ctx)
  if (user) await seedSession(ctx, user)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  p.on('request', (r) => urls.push(r.url()))
  p.on('console', (m) => { const t = m.text(); if (t.includes(OLD_TOKEN) || t.includes(EMPTY_TOKEN)) errs.push('console 印出權杖') })
  await p.goto(BASE)
  if (!user) await p.waitForSelector('#kp-gate #acct-user', { timeout: 20000 })
  else if (width > 760) await ready(p); else await p.waitForSelector('[data-acct]', { state: 'visible', timeout: 40000 })
  return p
}
const ready = (p) => p.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100, null, { timeout: 40000 })
const openAcct = async (p) => { await p.click('[data-acct]'); await p.waitForSelector('.acct-modal') }
const errText = (p) => p.textContent('#acct-err')
const shot = async (p, name) => { if (SHOTS) await p.locator('.acct-modal, #kp-gate .gate-card').screenshot({ path: `${SHOTS}/${name}.png` }) }
const resetCalls = () => authCalls.filter((c) => c.path.endsWith('/reset'))

/* ---------------- 忘記密碼 ---------------- */
const R = await device()
await check('忘記密碼：登入畫面有連結，切到重設表單（四個欄位、說明），可返回登入', async () => {
  await R.click('[data-acct-forgot]'); await R.waitForSelector('#acct-code')
  for (const id of ['#acct-user', '#acct-code', '#acct-rpass', '#acct-rpass2']) must(await R.$(id), '缺欄位 ' + id)
  const txt = await R.textContent('#kp-gate')
  must(txt.includes('向站長索取重設碼') && txt.includes('24 小時') && txt.includes('只能用一次'), '說明文字不對')
  must(!(await R.$('#acct-wt')), '重設表單不該有寫入權杖欄位')
  await shot(R, 'reset-form')
  await R.fill('#acct-user', 'T-User')
  await R.click('[data-acct-back]'); await R.waitForSelector('#acct-pass')
  must(await R.inputValue('#acct-user') === 'T-User', '切換時帳號欄位沒保留')
  must(await R.$('[data-acct-forgot]'), '返回後沒有忘記密碼連結')
  await R.click('[data-acct-forgot]'); await R.waitForSelector('#acct-code')
})
await check('忘記密碼：欄位驗證（帳號、重設碼 12 字、新密碼長度、兩次一致）不送出', async () => {
  const fill = async (u, c, p1, p2) => { await R.fill('#acct-user', u); await R.fill('#acct-code', c); await R.fill('#acct-rpass', p1); await R.fill('#acct-rpass2', p2); await R.click('[data-acct-submit]') }
  const n = resetCalls().length
  await fill('ab', 'ABCD-EFGH-JKLM', 'new-password-1', 'new-password-1'); must((await errText(R)).includes('3～32'), '帳號太短沒擋：' + await errText(R))
  await fill('t-user', 'ABCD-EFGH-JKL', 'new-password-1', 'new-password-1'); must((await errText(R)).includes('12'), '重設碼長度沒擋：' + await errText(R))
  await fill('t-user', 'ABCD-EFGH-JKLM', 'short', 'short'); must((await errText(R)).includes('8～128'), '密碼太短沒擋：' + await errText(R))
  await fill('t-user', 'ABCD-EFGH-JKLM', 'new-password-1', 'new-password-2'); must((await errText(R)).includes('不一樣'), '兩次不同沒擋：' + await errText(R))
  must(resetCalls().length === n, '驗證失敗不該送出')
  // 驗證失敗重畫後輸入值保留
  must(await R.inputValue('#acct-code') === 'ABCD-EFGH-JKLM', '重畫後重設碼沒保留')
})
await check('忘記密碼：重設碼錯 → 401 顯示「帳號或重設碼不正確，或重設碼已過期」；送出內容正規化', async () => {
  await R.fill('#acct-user', ' T-User '); await R.fill('#acct-code', 'zzzz zzzz-zzzz'); await R.fill('#acct-rpass', 'new-password-1'); await R.fill('#acct-rpass2', 'new-password-1')
  await R.click('[data-acct-submit]')
  await R.waitForFunction(() => document.getElementById('acct-err')?.textContent.includes('帳號或重設碼不正確，或重設碼已過期'), null, { timeout: 8000 })
  const c = resetCalls().at(-1)
  must(c.body.username === 't-user' && c.body.code === 'zzzz-zzzz-zzzz' && c.body.newPassword === 'new-password-1', '送出內容 ' + JSON.stringify({ u: c.body.username, c: c.body.code }))
  must(!c.auth, '重設不該帶 Authorization')
  must(!(await R.evaluate(() => localStorage.getItem('kupei:session'))), '失敗不該有 session')
})
await check('忘記密碼：成功 → 已登入、localStorage session 換新、提示「密碼已重設，其他裝置已登出」', async () => {
  await R.evaluate(() => localStorage.setItem('kupei:session', JSON.stringify({ token: 'kps_stale', username: 'old', expiresAt: '2000-01-01T00:00:00Z' })))
  await R.fill('#acct-code', 'abcd efgh jklm'.toUpperCase()); await R.fill('#acct-rpass', 'new-password-1'); await R.fill('#acct-rpass2', 'new-password-1')
  await Promise.all([R.waitForEvent('load', { timeout: 15000 }), R.click('[data-acct-submit]')])
  await ready(R)
  await R.waitForFunction(() => /已登入/.test(document.querySelector('.acct-modal')?.textContent || ''), null, { timeout: 15000 })
  const txt = await R.textContent('.acct-modal')
  must(txt.includes('t-user') && txt.includes('密碼已重設，其他裝置已登出'), '畫面 ' + txt.slice(0, 120))
  const s = await R.evaluate(() => JSON.parse(localStorage.getItem('kupei:session') || 'null'))
  must(s && s.token === 'kps_t-user' && s.username === 't-user', 'session ' + JSON.stringify(s && s.username))
  must(resetCalls().at(-1).body.code === 'ABCD-EFGH-JKLM', '重設碼格式 ' + resetCalls().at(-1).body.code)
  await shot(R, 'reset-done')
  // 再開一次視窗，提示不再出現
  await R.click('.acct-modal [data-acct-close]'); await openAcct(R)
  must(!(await R.textContent('.acct-modal')).includes('密碼已重設'), '提示應只顯示一次')
})
await R.context().close()

/* ---------------- 匯入舊的寫入權杖資料 ---------------- */
const A = await device(1440, 't-imp')
const watchOf = (p) => p.evaluate(() => localStorage.getItem('kupei3_watch'))
const ids = (v) => { try { return JSON.parse(v).groups.flatMap((g) => g.ids) } catch { return null } }
let OLD_WATCH = '', MINE = ''
await check('匯入：準備（已登入帳號 t-imp、加一家自選，雲端已有一份）', async () => {
  await A.click('#h-body tr:nth-child(2) [data-menu]'); await A.click('.menu [data-setg]'); await A.waitForTimeout(600)
  MINE = await watchOf(A); must(ids(MINE)?.length === 1, '本機自選 ' + MINE)
  const tmpl = JSON.parse(MINE); tmpl.groups.forEach((g, i) => (g.ids = i === 0 ? ['1101', '1102', '1103'] : []))
  OLD_WATCH = JSON.stringify(tmpl)
  const old = storeOf('kupei')
  old.set('ui-watch', { version: 7, updatedAt: '2026-10-20T06:03:00.000Z', data: { savedAt: '', value: OLD_WATCH } })
  old.set('ui-news', { version: 2, updatedAt: '2026-10-21T01:00:00.000Z', data: { savedAt: '', value: JSON.stringify({ span: 3, groups: [], stock: {}, disabled: [] }) } })
  old.set('legacy-other', { version: 1, updatedAt: null, data: { x: 1 } })
  storeOf('empty').set('something-else', { version: 1, updatedAt: null, data: { x: 1 } })
  await sleep(2500)
  await openAcct(A)
  must(storeOf('t-imp').get('ui-watch')?.version === 1, '帳號雲端 ' + JSON.stringify(storeOf('t-imp').get('ui-watch')?.version))
})
const impBox = async () => { await A.evaluate(() => { const d = document.getElementById('acct-imp-box'); if (d) d.open = true }); await A.waitForSelector('#acct-imp-wt') }
const impMsg = () => A.textContent('#acct-imp-msg')
await check('匯入：權杖錯 → 「權杖不正確」，不寫入', async () => {
  await impBox(); const n = log.length
  await A.fill('#acct-imp-wt', 'wrong-token'); await A.click('[data-acct-imp-read]')
  await A.waitForFunction(() => document.getElementById('acct-imp-msg')?.textContent.includes('權杖不正確'), null, { timeout: 8000 })
  must(log.length === n, '不該寫入')
  must(!(await A.inputValue('#acct-imp-wt')), '讀完應清掉輸入框')
  await shot(A, 'import-box')
})
await check('匯入：權杖沒有同步用的文件 → 「這把權杖沒有資料可匯入」', async () => {
  await A.fill('#acct-imp-wt', EMPTY_TOKEN); await A.click('[data-acct-imp-read]')
  await A.waitForFunction(() => document.getElementById('acct-imp-msg')?.textContent.includes('這把權杖沒有資料可匯入'), null, { timeout: 8000 })
})
await check('匯入：讀到摘要（份數、更新時間）→ 確認後寫進帳號雲端、本機換新、_prev 有備份', async () => {
  await A.fill('#acct-imp-wt', OLD_TOKEN); await A.click('[data-acct-imp-read]')
  await A.waitForSelector('#acct-imp-list', { timeout: 8000 })
  const txt = await A.textContent('#acct-imp-box')
  must(txt.includes('2 份') && txt.includes('自選群組') && txt.includes('新聞設定') && txt.includes('2026/10/20 14:03'), '摘要 ' + txt.slice(0, 200))
  must(txt.includes('另有 1 份'), '沒提示非同步用的文件')
  await shot(A, 'import-summary')
  const n = log.length
  const v0 = { w: storeOf('t-imp').get('ui-watch')?.version ?? 0, n: storeOf('t-imp').get('ui-news')?.version ?? 0 }
  await A.waitForTimeout(300); must(log.length === n, '確認前不該寫入')
  await Promise.all([A.waitForEvent('load', { timeout: 15000 }), A.click('[data-acct-imp-go]')])
  await ready(A); await A.waitForTimeout(800)
  const w = storeOf('t-imp').get('ui-watch'), nw = storeOf('t-imp').get('ui-news')
  must(w?.version === v0.w + 1 && w.data.value === OLD_WATCH, '帳號雲端 ui-watch ' + JSON.stringify(w && w.version))
  must(nw?.version === v0.n + 1 && JSON.parse(nw.data.value).span === 3, '帳號雲端 ui-news')
  must(JSON.stringify(ids(await watchOf(A))) === JSON.stringify(['1101', '1102', '1103']), '本機自選 ' + JSON.stringify(ids(await watchOf(A))))
  must(await A.evaluate(() => localStorage.getItem('kupei3_watch_prev')) === MINE, '_prev 不是匯入前的本機資料')
  must(storeOf('kupei').get('ui-watch').version === 7, '舊文件被動到')
  must((await A.textContent('.acct-modal')).includes('已匯入 2 份'), '重新載入後沒顯示結果')
  await shot(A, 'import-done')
  return log.slice(n).join('；')
})
await check('匯入：帳號雲端在讀版本後被改（409）→ 重新讀取版本重試一次成功', async () => {
  await A.click('.acct-modal [data-acct-close]'); await openAcct(A); await impBox()
  await A.fill('#acct-imp-wt', OLD_TOKEN); await A.click('[data-acct-imp-read]'); await A.waitForSelector('#acct-imp-list', { timeout: 8000 })
  raceOnce = true
  const n = log.length
  await Promise.all([A.waitForEvent('load', { timeout: 15000 }), A.click('[data-acct-imp-go]')])
  await ready(A)
  const mine = log.slice(n).filter((l) => l.includes('/ui-watch '))
  must(mine.length === 2 && mine[0].endsWith('409') && !mine[1].endsWith('409'), '寫入紀錄 ' + mine.join('；'))
  must(storeOf('t-imp').get('ui-watch').data.value === OLD_WATCH, '重試後內容不對')
  return mine.join('；')
})
await check('匯入：雲端額度已滿 → 提示、不重試', async () => {
  await A.click('.acct-modal [data-acct-close]'); await openAcct(A); await impBox()
  await A.fill('#acct-imp-wt', OLD_TOKEN); await A.click('[data-acct-imp-read]'); await A.waitForSelector('#acct-imp-list', { timeout: 8000 })
  quota = true; const n = log.length
  await A.click('[data-acct-imp-go]')
  await A.waitForFunction(() => document.getElementById('acct-imp-msg')?.textContent.includes('雲端空間已滿'), null, { timeout: 8000 })
  quota = false
  must(log.slice(n).length === 1, '不該重試：' + log.slice(n).join('；'))
})
await check('權杖不進網址、不存 localStorage／sessionStorage', async () => {
  must(!urls.some((u) => u.includes(OLD_TOKEN) || u.includes(EMPTY_TOKEN)), '網址含權杖')
  const all = await A.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))
  must(!all.includes(OLD_TOKEN) && !all.includes(EMPTY_TOKEN), 'storage 含權杖')
  must(!(await A.evaluate(() => localStorage.getItem('kupei:write-token'))), '不該設成寫入權杖')
})
const M = await device(390)
await check('手機寬度：重設表單不超出畫面', async () => {
  await M.click('[data-acct-forgot]'); await M.waitForSelector('#acct-code')
  const box = await M.locator('#kp-gate .gate-card').boundingBox(); must(box.x >= 0 && box.x + box.width <= 390, '重設表單 ' + JSON.stringify(box))
  await shot(M, 'reset-form-390')
})
await M.context().close()
await A.context().close()
await check('頁面沒有 JS 錯誤、console 沒印權杖', async () => { must(!errs.length, [...new Set(errs)].join(' | ')) })
await b.close()
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
process.exit(fail ? 1 : 0)
