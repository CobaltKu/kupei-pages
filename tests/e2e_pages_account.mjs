// 帳號視窗：改密碼；沒有註冊（2026-10-28 登入閘門：帳號由站長發放）。全部用假的帳號端點，不建立真實帳號。
// 資料用 fixture（或 KUPEI_TEST_SESSION 讀線上），見 tests/_kupei_test.mjs。
// BASE=http://127.0.0.1:5316/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_account.mjs
import { chromium } from 'playwright'
import { routeBackend, seedSession, CORS } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const sess = (n) => ({ user: { id: 1, username: 't-user' }, token: 'kps_mock_' + n, expiresAt: new Date(Date.now() + 864e5).toISOString() })
const calls = []
let token = 0

async function device(loggedIn = true) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await routeBackend(ctx)
  await ctx.route('**/api/auth/**', async (route) => {
    const r = route.request(), path = new URL(r.url()).pathname
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = r.postData() ? JSON.parse(r.postData()) : {}
    calls.push({ path, body, auth: r.headers().authorization })
    const err = (status, code) => route.fulfill({ status, headers: CORS, body: JSON.stringify({ error: { code, message: code } }) })
    if (path.endsWith('/login')) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(sess(++token)) })
    if (path.endsWith('/password')) {
      if (body.currentPassword !== 'old-password-1') return err(401, 'INVALID_CREDENTIALS')
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(sess(++token)) })
    }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
  if (loggedIn) await seedSession(ctx)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE)
  if (loggedIn) await p.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100, null, { timeout: 40000 })
  else await p.waitForSelector('#kp-gate #acct-user')
  return p
}
const openAcct = async (p) => { await p.click('[data-acct]'); await p.waitForSelector('.acct-modal') }

await check('沒有註冊：登入畫面沒有建立帳號，也不問 /api/auth/config、不打 /api/auth/register', async () => {
  const p = await device(false); await p.waitForTimeout(1000)
  must(!(await p.$('[data-acct-mode], #acct-pass2, #acct-invite')), '登入畫面還有註冊元素')
  must(!/建立帳號|邀請碼/.test(await p.innerText('#kp-gate')), '登入畫面還有註冊字樣')
  must(!calls.some((c) => /\/(config|register)$/.test(c.path)), '呼叫了 ' + calls.map((c) => c.path).join('、'))
  await p.context().close()
})
await check('沒有註冊：已登入的帳號視窗也沒有建立帳號', async () => {
  const p = await device(); await openAcct(p)
  const t = await p.innerText('.acct-modal')
  must(/已登入/.test(t) && !/建立帳號|邀請碼/.test(t) && !(await p.$('[data-acct-mode]')), '帳號視窗：' + t.slice(0, 120))
  await p.context().close()
})
await check('改密碼：驗證欄位、目前密碼錯、成功後換新權杖且維持登入', async () => {
  const p = await device(); await openAcct(p)
  await p.waitForSelector('#acct-pw-box')
  const pw = async (cur, n1, n2) => { await p.evaluate(() => (document.getElementById('acct-pw-box').open = true)); await p.fill('#acct-pw-cur', cur); await p.fill('#acct-pw-new', n1); await p.fill('#acct-pw-new2', n2); await p.click('[data-acct-pw]') }
  await pw('old-password-1', 'short', 'short')
  must((await p.textContent('#acct-pw-msg')).includes('8'), '太短沒擋')
  await pw('old-password-1', 'new-password-2', 'different-one')
  must((await p.textContent('#acct-pw-msg')).includes('不一樣'), '不一致沒擋')
  await pw('wrong-password', 'new-password-2', 'new-password-2')
  await p.waitForFunction(() => document.getElementById('acct-pw-msg')?.textContent.includes('目前密碼不正確'))
  const before = await p.evaluate(() => JSON.stringify(localStorage))
  await pw('old-password-1', 'new-password-2', 'new-password-2')
  await p.waitForFunction(() => document.getElementById('acct-pw-msg')?.textContent.includes('已更改'))
  const last = calls.filter((c) => c.path.endsWith('/password')).at(-1)
  must(last.body.currentPassword === 'old-password-1' && last.body.newPassword === 'new-password-2', '送出內容不對：' + JSON.stringify(Object.keys(last.body)))
  must(/已登入/.test(await p.textContent('.acct-modal')), '改完不該登出')
  must((await p.evaluate(() => JSON.stringify(localStorage))) !== before, '本機權杖沒換新')
  await p.context().close()
})
await check('頁面沒有 JS 錯誤', async () => { must(!errs.length, errs.join(' | ')) })
await b.close()
for (const r of results) console.log(r.join('  '))
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0)
