// 帳號視窗：邀請碼欄位（依 /api/auth/config）與改密碼。全部用假的帳號端點，不建立真實帳號。
// BASE=http://127.0.0.1:5316/ ENVFILE=<含 VITE_KUPEI_TOKEN 的檔> node e2e_pages_account.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
const ENV = Object.fromEntries(fs.readFileSync(process.env.ENVFILE, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { await fn(); results.push(['PASS', name]) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }
const sess = (n) => ({ user: { id: 1, username: 't-user' }, token: 'kps_mock_' + n, expiresAt: new Date(Date.now() + 864e5).toISOString() })
const calls = []
let inviteRequired = true, token = 0

async function device() {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route(/\/(data|api\/market)\//, (route) => route.request().method() === 'OPTIONS' ? route.continue() : route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer ' + ENV.VITE_KUPEI_TOKEN } }))
  await ctx.route('**/api/store/**', (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key: 'x', version: 0, updatedAt: null, data: null }) }))
  await ctx.route('**/api/auth/**', async (route) => {
    const r = route.request(), path = new URL(r.url()).pathname
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = r.postData() ? JSON.parse(r.postData()) : {}
    calls.push({ path, body, auth: r.headers().authorization })
    const err = (status, code) => route.fulfill({ status, headers: CORS, body: JSON.stringify({ error: { code, message: code } }) })
    if (path.endsWith('/config')) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ inviteRequired }) })
    if (path.endsWith('/register')) {
      if (inviteRequired && !body.inviteCode) return err(403, 'INVITE_REQUIRED')
      if (inviteRequired && body.inviteCode !== 'good-code') return err(403, 'INVITE_INVALID')
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(sess(++token)) })
    }
    if (path.endsWith('/login')) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(sess(++token)) })
    if (path.endsWith('/password')) {
      if (body.currentPassword !== 'old-password-1') return err(401, 'INVALID_CREDENTIALS')
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(sess(++token)) })
    }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
  const p = await ctx.newPage()
  await p.route('**/fonts.g*/**', (r) => r.abort())
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE)
  await p.waitForFunction(() => document.querySelectorAll('#h-body tr').length > 100, null, { timeout: 40000 })
  return p
}
const openAcct = async (p) => { await p.click('[data-acct]'); await p.waitForSelector('.acct-modal') }
const toRegister = async (p) => { await p.click('[data-acct-mode]'); await p.waitForSelector('#acct-pass2') }

await check('邀請碼開啟：註冊畫面出現邀請碼欄位，登入畫面沒有', async () => {
  inviteRequired = true
  const p = await device(); await openAcct(p)
  must(!(await p.$('#acct-invite')), '登入畫面不該有邀請碼')
  await toRegister(p); await p.waitForSelector('#acct-invite', { timeout: 5000 })
  await p.context().close()
})
await check('邀請碼關閉：註冊畫面沒有邀請碼欄位', async () => {
  inviteRequired = false
  const p = await device(); await openAcct(p); await toRegister(p); await p.waitForTimeout(800)
  must(!(await p.$('#acct-invite')), '不該有邀請碼欄位')
  await p.context().close()
})
await check('邀請碼：空白擋下、錯誤顯示訊息、正確則註冊並登入', async () => {
  inviteRequired = true
  const p = await device(); await openAcct(p); await toRegister(p); await p.waitForSelector('#acct-invite')
  await p.fill('#acct-user', 't-user'); await p.fill('#acct-pass', 'old-password-1'); await p.fill('#acct-pass2', 'old-password-1')
  calls.length = 0
  await p.click('[data-acct-submit]')
  must((await p.textContent('#acct-err')).includes('邀請碼'), '空邀請碼沒擋')
  must(!calls.some((c) => c.path.endsWith('/register')), '空邀請碼不該送出')
  await p.fill('#acct-invite', 'bad'); await p.fill('#acct-pass', 'old-password-1'); await p.fill('#acct-pass2', 'old-password-1')
  await p.click('[data-acct-submit]'); await p.waitForFunction(() => document.getElementById('acct-err')?.textContent.includes('邀請碼不對'))
  await p.fill('#acct-invite', 'good-code'); await p.fill('#acct-pass', 'old-password-1'); await p.fill('#acct-pass2', 'old-password-1')
  await p.click('[data-acct-submit]'); await p.waitForFunction(() => document.querySelector('.acct-modal')?.textContent.includes('已登入'))
  must(calls.at(-1).body.inviteCode === 'good-code' || calls.some((c) => c.body.inviteCode === 'good-code'), '邀請碼沒送到後端')
  await p.context().close()
})
await check('config 失敗不擋註冊：後端回 INVITE_REQUIRED 才顯示欄位', async () => {
  inviteRequired = true
  const p = await device()
  await p.context().route('**/api/auth/config', (r) => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS }) : r.fulfill({ status: 500, headers: CORS, body: '{}' }))
  await openAcct(p); await toRegister(p)
  must(!(await p.$('#acct-invite')), 'config 失敗時不該先顯示欄位')
  await p.fill('#acct-user', 't-user'); await p.fill('#acct-pass', 'old-password-1'); await p.fill('#acct-pass2', 'old-password-1')
  await p.click('[data-acct-submit]'); await p.waitForSelector('#acct-invite', { timeout: 5000 })
  await p.context().close()
})
await check('改密碼：驗證欄位、目前密碼錯、成功後換新權杖且維持登入', async () => {
  inviteRequired = false
  const p = await device(); await openAcct(p)
  await p.fill('#acct-user', 't-user'); await p.fill('#acct-pass', 'old-password-1'); await p.click('[data-acct-submit]')
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
