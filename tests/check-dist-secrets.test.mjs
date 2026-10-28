// 公開建置不帶權杖（2026-10-28 登入閘門）。npm run test:dist（＝ node --test tests/check-dist-secrets.test.mjs）
// 1. 就算環境裡設了 VITE_KUPEI_TOKEN，vite build 的產物裡也找不到它，tools/check-dist-secrets.mjs 通過。
// 2. 檢查器本身會抓到：環境變數的權杖值、像權杖的字串常值、kps_ 權杖、寫死的 Bearer；輸出不印完整的值。
// 權杖都是測試時隨機產生的假值，建置輸出放在系統暫存資料夾、跑完刪掉。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const checker = path.join(root, 'tools/check-dist-secrets.mjs')
const fake = () => 'kptest' + crypto.randomBytes(24).toString('hex') // 54 字、英數混合
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `kp-${name}-`))
const check = (dir, env = {}) => spawnSync(process.execPath, [checker, dir], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } })

test('設了 VITE_KUPEI_TOKEN 建置，產物裡也沒有它', () => {
  const token = fake()
  const out = tmp('dist')
  try {
    const r = spawnSync(path.join(root, 'node_modules/.bin/vite'), ['build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, VITE_KUPEI_TOKEN: token },
    })
    assert.equal(r.status, 0, 'vite build 失敗：' + (r.stderr || r.stdout).slice(0, 400))
    const all = [...fs.readdirSync(out, { recursive: true })].map((f) => path.join(out, String(f))).filter((f) => fs.statSync(f).isFile())
    assert.ok(all.some((f) => f.endsWith('.js')), '產物裡沒有 JS')
    for (const f of all) assert.ok(!fs.readFileSync(f, 'utf8').includes(token), `${path.relative(out, f)} 含有權杖`)
    const c = check(out, { VITE_KUPEI_TOKEN: token })
    assert.equal(c.status, 0, '檢查器沒通過：' + c.stderr)
    assert.match(c.stdout, /通過/)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

test('檢查器：環境變數的權杖值出現在產物 → 失敗，且不印出完整的值', () => {
  const token = fake()
  const d = tmp('leak-env')
  try {
    fs.writeFileSync(path.join(d, 'app.js'), `const a=1;const t=${JSON.stringify(token.slice(0, 20))}+${JSON.stringify(token.slice(20))};\nfetch(u,{headers:{x:"${token}"}})`)
    const c = check(d, { VITE_KUPEI_TOKEN: token })
    assert.equal(c.status, 1)
    assert.match(c.stderr, /VITE_KUPEI_TOKEN/)
    assert.ok(!(c.stdout + c.stderr).includes(token), '輸出印出了完整的權杖')
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

test('檢查器：像權杖的字串常值、kps_ 權杖、寫死的 Bearer → 失敗', () => {
  for (const body of [
    `const cfg={token:'${crypto.randomBytes(20).toString('hex')}'}`,
    `localStorage.x="kps_${crypto.randomBytes(12).toString('hex')}"`,
    `h.Authorization="Bearer ${crypto.randomBytes(12).toString('base64url')}"`,
  ]) {
    const d = tmp('leak-lit')
    try {
      fs.writeFileSync(path.join(d, 'index.html'), `<script>${body}</script>`)
      const c = check(d, { VITE_KUPEI_TOKEN: '' })
      assert.equal(c.status, 1, '沒抓到：' + body.slice(0, 30))
    } finally {
      fs.rmSync(d, { recursive: true, force: true })
    }
  }
})

test('檢查器：一般程式（長識別字、網址、短字串）不誤判', () => {
  const d = tmp('clean')
  try {
    fs.writeFileSync(path.join(d, 'app.js'), `const BASE="https://kupei-dashboard.tmac19920626.workers.dev";const k="somethingVeryLongButOnlyLettersAndNoDigitsAtAll";const v="abc123"`)
    const c = check(d, { VITE_KUPEI_TOKEN: '' })
    assert.equal(c.status, 0, c.stderr)
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

test('檢查器：公開網址的設定值（CI 的 VITE_KUPEI_BASE）進了產物不算權杖', () => {
  const dir = tmp('url')
  try {
    const base = 'https://kupei-dashboard.example-account.workers.dev'
    fs.writeFileSync(path.join(dir, 'a.js'), `const b = "${base}";\n`)
    const r = check(dir, { VITE_KUPEI_BASE: base })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    // 名稱像權杖的變數就算值是網址也照樣抓
    const r2 = check(dir, { VITE_KUPEI_TOKEN: base })
    assert.notEqual(r2.status, 0)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
