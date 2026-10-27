import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

if (process.env.ALLOW_LIVE_ACCOUNT !== '1') throw new Error('Set ALLOW_LIVE_ACCOUNT=1 to create a disposable test account on the live Server')

const base = (process.env.KUPEI_API_BASE || 'https://kupei-dashboard.tmac19920626.workers.dev').replace(/\/$/, '')
const suffix = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
const username = `test-codex-${suffix}`.slice(0, 32)
const password = `${crypto.randomBytes(18).toString('base64url')}Aa1!`
const key = 'codex-smoke'
const extraKey = 'codex-smoke-extra'
const runFile = promisify(execFile)
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kupei-live-account-'))
const backup = path.join(temp, 'backup.json')
let tokenA = null
let tokenB = null

async function api(urlPath, token, init = {}) {
  const response = await fetch(base + urlPath, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { /* keep null */ }
  return { response, body, text }
}

async function ok(urlPath, token, init) {
  const result = await api(urlPath, token, init)
  if (!result.response.ok) throw new Error(`${urlPath}: ${result.response.status} ${result.body?.error?.code || result.text}`)
  return result.body
}

async function put(docKey, token, baseVersion, data) {
  return ok(`/api/store/${docKey}`, token, { method: 'PUT', body: JSON.stringify({ baseVersion, data }) })
}

async function removeIfPresent(docKey, token) {
  if (!token) return
  const doc = await ok(`/api/store/${docKey}`, token)
  if (doc.version > 0) await ok(`/api/store/${docKey}?baseVersion=${doc.version}`, token, { method: 'DELETE' })
}

try {
  const config = await ok('/api/auth/config')
  assert.equal(config.inviteRequired, false, 'live registration currently requires an invite code')

  const registered = await ok('/api/auth/register', null, { method: 'POST', body: JSON.stringify({ username, password }) })
  tokenA = registered.token
  assert.equal(registered.user.username, username)

  const loggedIn = await ok('/api/auth/login', null, { method: 'POST', body: JSON.stringify({ username, password }) })
  tokenB = loggedIn.token
  assert.notEqual(tokenA, tokenB, 'two devices should receive distinct session tokens')

  await put(key, tokenA, 0, { marker: 'device-a' })
  const seenByB = await ok(`/api/store/${key}`, tokenB)
  assert.equal(seenByB.data.marker, 'device-a')
  await put(key, tokenB, seenByB.version, { marker: 'device-b' })

  const conflict = await api(`/api/store/${key}`, tokenA, { method: 'PUT', body: JSON.stringify({ baseVersion: seenByB.version, data: { marker: 'stale-a' } }) })
  assert.equal(conflict.response.status, 409)
  assert.equal(conflict.body.error.code, 'VERSION_CONFLICT')
  assert.equal(conflict.body.error.details.data.marker, 'device-b')

  await runFile(process.execPath, ['tools/store-backup.mjs', 'export', '--out', backup, '--base', base], { cwd: path.resolve('.'), env: { ...process.env, KUPEI_SESSION_TOKEN: tokenA } })
  const current = await ok(`/api/store/${key}`, tokenB)
  await put(key, tokenB, current.version, { marker: 'after-backup' })
  await put(extraKey, tokenB, 0, { marker: 'remove-on-restore' })

  await runFile(process.execPath, ['tools/store-backup.mjs', 'restore', '--in', backup, '--base', base, '--apply', '--replace'], { cwd: path.resolve('.'), env: { ...process.env, KUPEI_SESSION_TOKEN: tokenA } })
  const restored = await ok(`/api/store/${key}`, tokenB)
  assert.equal(restored.data.marker, 'device-b')
  const list = await ok('/api/store', tokenB)
  assert.deepEqual(list.docs.map((x) => x.key), [key])

  console.log(`PASS live account cross-session, conflict, backup and replace restore: ${username}`)
} finally {
  try { await removeIfPresent(extraKey, tokenA || tokenB) } catch { /* best effort */ }
  try { await removeIfPresent(key, tokenA || tokenB) } catch { /* best effort */ }
  try { if (tokenA) await ok('/api/auth/logout', tokenA, { method: 'POST' }) } catch { /* best effort */ }
  try { if (tokenB) await ok('/api/auth/logout', tokenB, { method: 'POST' }) } catch { /* best effort */ }
  await fs.rm(temp, { recursive: true, force: true })
}
