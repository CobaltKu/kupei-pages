// 登入閘門（2026-10-28）：網站只給站長發的帳號使用。沒登入只有登入畫面、零個讀資料請求；登入後才載入資料；
// 登出、登入失效回到登入畫面並清掉畫面上的資料；沒有註冊。帳號端點是假的，資料用 fixture（或 KUPEI_TEST_SESSION 讀線上）。
// 跑法見 tests/_kupei_test.mjs：BASE=http://127.0.0.1:5381/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json CHR=<Chrome> node e2e_pages_gate.mjs
// SHOTS=<資料夾> 另存登入畫面截圖（375 與 1280 寬）
import { chromium } from 'playwright'
import fs from 'node:fs'
import { routeBackend, seedSession, gateLogin, ready, MIN_ROWS, READ_PATH, API, CORS } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const SHOTS = process.env.SHOTS || ''
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 開一個裝置：記下所有打到後端的請求（路徑、方法、Authorization 種類）與 console 警告 */
async function device({ vp = { width: 1280, height: 900 }, session = null, loginDelay = 0, loginFail = false } = {}) {
  const ctx = await b.newContext({ viewport: vp })
  await routeBackend(ctx)
  const calls = { login: 0, logout: 0 }
  await ctx.route(/\/api\/auth\/(login|logout)$/, async (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (r.url().endsWith('/logout')) { calls.logout++; return route.fulfill({ status: 200, headers: CORS, body: '{"ok":true}' }) }
    calls.login++
    if (loginDelay) await sleep(loginDelay)
    const u = JSON.parse(r.postData() || '{}')
    if (loginFail || u.password !== 'password-123') return route.fulfill({ status: 401, headers: CORS, body: JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'bad' } }) })
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ user: { id: 1, username: u.username }, token: 'kps_' + u.username, expiresAt: new Date(Date.now() + 864e5).toISOString() }) })
  })
  if (session) await seedSession(ctx, session)
  const p = await ctx.newPage()
  const reqs = [], warns = [], scripts = []
  p.on('request', (r) => {
    const u = r.url()
    if (API.test(u) && r.method() !== 'OPTIONS') reqs.push({ path: new URL(u).pathname, method: r.method(), auth: (r.headers().authorization || '').replace(/^Bearer (kps_|\S).*$/, (_, x) => (x === 'kps_' ? 'kps' : 'other')) })
    if (/legacy\/app\.js/.test(u)) scripts.push(u)
  })
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()) })
  return { p, ctx, reqs, warns, scripts, calls }
}
const reads = (reqs) => reqs.filter((r) => READ_PATH.test(r.path) || /\/api\/store/.test(r.path))
const allowedWhileLocked = (r) => r.path === '/api/auth/login' || r.path === '/api/auth/config'
const gateShown = (p) => p.evaluate(() => {
  const g = document.getElementById('kp-gate'), app = document.querySelector('.app')
  return { gate: !!g && g.getBoundingClientRect().height > 0, app: !!app && getComputedStyle(app).display !== 'none', api: typeof window.KupeiAPI, rows: document.querySelectorAll('#h-body tr').length }
})

/* 1. 未登入 */
const A = await device()
await check('未登入：整頁只有登入畫面（帳號、密碼、登入鈕、錯誤訊息區），工作區藏起來', async () => {
  await A.p.goto(BASE); await A.p.waitForSelector('#kp-gate #acct-user'); await sleep(2500)
  const g = await gateShown(A.p)
  must(g.gate && !g.app, '畫面 ' + JSON.stringify(g))
  for (const sel of ['#acct-user', '#acct-pass', '#kp-gate [data-acct-submit]', '#acct-err', '#kp-gate [data-acct-forgot]']) must(await A.p.$(sel), '缺 ' + sel)
  must(g.api === 'undefined' && g.rows === 0, '沒登入卻建立了資料層／畫了資料：' + JSON.stringify(g))
  must(!A.scripts.length, '沒登入就載入了 app.js')
  must(await A.p.evaluate(() => document.activeElement?.id) === 'acct-user', '帳號欄位沒有自動聚焦')
})
await check('未登入：零個讀資料請求（只允許 /api/auth/login、/api/auth/config）', async () => {
  const bad = A.reqs.filter((r) => !allowedWhileLocked(r))
  must(!bad.length, '請求了 ' + bad.map((r) => r.method + ' ' + r.path).join('、'))
  return `後端請求 ${A.reqs.length} 個`
})
await check('沒有註冊：沒有建立帳號的入口與欄位；寫「帳號由站長發放」', async () => {
  const t = await A.p.innerText('#kp-gate')
  must(/帳號由站長發放/.test(t), '沒有站長發放的說明：' + t.slice(0, 120))
  must(!/建立帳號|註冊|邀請碼/.test(t.replace('沒有開放註冊', '')), '還有註冊字樣：' + t.slice(0, 160))
  must(!(await A.p.$('#acct-pass2, #acct-invite, [data-acct-mode]')), '還有註冊欄位或切換鈕')
  must(!(await A.p.$('#acct-wt')), '登入畫面不該有寫入權杖欄位')
})
await check('忘記密碼：登入畫面可切到重設表單、再返回登入（保留）', async () => {
  await A.p.click('#kp-gate [data-acct-forgot]'); await A.p.waitForSelector('#kp-gate #acct-code')
  must(/向站長索取重設碼/.test(await A.p.innerText('#kp-gate')), '重設說明')
  await A.p.click('#kp-gate [data-acct-back]'); await A.p.waitForSelector('#kp-gate #acct-pass')
})
await check('欄位空白：提示、不送出', async () => {
  const n = A.calls.login
  await A.p.click('#kp-gate [data-acct-submit]')
  must(/請輸入帳號與密碼/.test(await A.p.innerText('#acct-err')), '沒提示')
  must(A.calls.login === n, '空白也送出了')
})
await check('密碼錯：顯示錯誤、清掉密碼欄、仍在登入畫面、沒有讀資料', async () => {
  await A.p.fill('#acct-user', 'T-User '); await A.p.fill('#acct-pass', 'wrong-password'); await A.p.press('#acct-pass', 'Enter')
  await A.p.waitForFunction(() => /帳號或密碼不正確/.test(document.getElementById('acct-err')?.textContent || ''), null, { timeout: 8000 })
  must(!(await A.p.inputValue('#acct-pass')), '密碼沒清掉')
  must(await A.p.inputValue('#acct-user') === 'T-User ', '帳號欄位被清掉了')
  must((await gateShown(A.p)).gate, '離開了登入畫面')
  must(!A.reqs.filter((r) => !allowedWhileLocked(r)).length, '登入失敗後有其他請求')
})
await A.ctx.close()

/* 2. 防連點、登入成功 */
const B = await device({ loginDelay: 1500 })
await check('防連點：送出中按鈕停用，連點＋Enter 只送一次、不自動重送', async () => {
  await B.p.goto(BASE); await B.p.waitForSelector('#kp-gate #acct-user')
  await B.p.fill('#acct-user', 't-user'); await B.p.fill('#acct-pass', 'password-123')
  await B.p.click('#kp-gate [data-acct-submit]')
  await sleep(150)
  must(await B.p.$eval('#kp-gate [data-acct-submit]', (x) => x.disabled && /登入中/.test(x.textContent)), '送出中按鈕沒停用')
  await B.p.click('#kp-gate [data-acct-submit]', { force: true }).catch(() => {})
  await B.p.press('#acct-pass', 'Enter').catch(() => {})
  await ready(B.p, MIN_ROWS)
  must(B.calls.login === 1, '登入送了 ' + B.calls.login + ' 次')
})
await check('登入成功：不重新整理就載入首頁，資料請求都帶登入權杖', async () => {
  const g = await gateShown(B.p)
  must(!g.gate && g.app && g.api === 'object' && g.rows >= MIN_ROWS, '畫面 ' + JSON.stringify(g))
  const r = reads(B.reqs)
  must(r.some((x) => x.path === '/data/manifest.json') && r.some((x) => x.path === '/api/market/latest'), '沒讀資料：' + r.map((x) => x.path).join('、'))
  const noAuth = r.filter((x) => x.auth !== 'kps')
  must(!noAuth.length, '沒帶登入權杖：' + noAuth.map((x) => x.path + '(' + (x.auth || '無') + ')').join('、'))
  return `${g.rows} 列，讀資料請求 ${r.length} 個`
})
await check('重新整理：仍是登入狀態，直接進首頁', async () => {
  await B.p.reload(); await ready(B.p, MIN_ROWS)
  must(!(await gateShown(B.p)).gate, '又出現登入畫面')
})
await check('登出：通知後端、回到登入畫面、畫面上的資料清掉、之後沒有讀資料', async () => {
  await B.p.click('[data-acct]'); await B.p.waitForSelector('[data-acct-logout]')
  await Promise.all([B.p.waitForEvent('load', { timeout: 10000 }), B.p.click('[data-acct-logout]')])
  await B.p.waitForSelector('#kp-gate #acct-user'); const n = B.reqs.length; await sleep(2000)
  const g = await gateShown(B.p)
  must(g.gate && !g.app && g.rows === 0 && g.api === 'undefined', '畫面 ' + JSON.stringify(g))
  must(B.calls.logout === 1, '登出請求 ' + B.calls.logout + ' 次')
  must(!(await B.p.evaluate(() => localStorage.getItem('kupei:session'))), 'session 沒清掉')
  const after = B.reqs.slice(n).filter((r) => !allowedWhileLocked(r))
  must(!after.length, '登出後還有請求：' + after.map((r) => r.path).join('、'))
})
await check('登出後再登入：資料重新載入', async () => {
  await gateLogin(B.p); await ready(B.p, MIN_ROWS)
  must(!(await gateShown(B.p)).gate, '登入後仍在登入畫面')
})
await B.ctx.close()

/* 3. 登入失效（後端 401）→ 回登入畫面 */
const C = await device({ session: 'old-user' })
await check('登入失效：資料請求 401 → 回登入畫面並提示「登入已失效」', async () => {
  let expired = false
  await C.ctx.route(/\/data\/manifest\.json/, (route) => expired
    ? route.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'text/plain' }, body: 'unauthorized' })
    : route.fallback())
  await C.p.goto(BASE); await ready(C.p, MIN_ROWS)
  expired = true
  // 下一次啟動時 manifest 被拒（例如在別台改了密碼、帳號被停用）
  await C.p.evaluate(() => localStorage.removeItem('kupei:last-manifest'))
  await C.p.reload()
  await C.p.waitForSelector('#kp-gate #acct-user', { timeout: 15000 })
  must(/登入已失效/.test(await C.p.innerText('#acct-err')), '沒有提示：' + await C.p.innerText('#acct-err'))
  const g = await gateShown(C.p); must(g.gate && !g.app && g.rows === 0, '畫面 ' + JSON.stringify(g))
  must(!(await C.p.evaluate(() => localStorage.getItem('kupei:session'))), 'session 沒清掉')
})
await check('console：沒有要求設定 VITE_KUPEI_TOKEN 的警告', async () => {
  const w = [...C.warns].filter((t) => /VITE_KUPEI_TOKEN|沒有權杖/.test(t)); must(!w.length, w.join(' | '))
})
await C.ctx.close()

/* 4. 手機寬度與截圖 */
for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
  await check(`登入畫面 ${vp.width} 寬：不橫向捲動、卡片在畫面內、輸入框字級 ≥16px`, async () => {
    const D = await device({ vp })
    await D.p.goto(BASE); await D.p.waitForSelector('#kp-gate #acct-user'); await sleep(800)
    const m = await D.p.evaluate(() => {
      const r = document.querySelector('.gate-card').getBoundingClientRect()
      return { l: r.left, r: r.right, sw: document.documentElement.scrollWidth, iw: innerWidth, fs: ['acct-user', 'acct-pass'].map((i) => parseFloat(getComputedStyle(document.getElementById(i)).fontSize)) }
    })
    must(m.sw <= m.iw && m.l >= 0 && m.r <= m.iw && m.fs.every((x) => x >= 16), JSON.stringify(m))
    if (SHOTS) await D.p.screenshot({ path: `${SHOTS}/kp-login-${vp.width}.png` })
    await D.ctx.close()
    return JSON.stringify(m)
  })
}

await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
process.exitCode = fail ? 1 : 0
