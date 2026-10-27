import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

const token = 'test-session-token'
const runFile = promisify(execFile)
const store = new Map([
  ['ui-watch', { version: 2, updatedAt: '2026-10-27T00:00:00Z', data: { savedAt: 'a', value: 'watch-a' } }],
  ['ui-news', { version: 1, updatedAt: '2026-10-27T00:00:00Z', data: { savedAt: 'a', value: 'news-a' } }],
])

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: { code: 'UNAUTHENTICATED' } })
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/api/store' && req.method === 'GET') return json(res, 200, { docs: [...store].map(([key, v]) => ({ key, version: v.version, updatedAt: v.updatedAt, bytes: 1 })) })
  const match = url.pathname.match(/^\/api\/store\/([a-z0-9-]+)$/)
  if (!match) return json(res, 404, { error: { code: 'NOT_FOUND' } })
  const key = match[1]
  const current = store.get(key) || { version: 0, updatedAt: null, data: null }
  if (req.method === 'GET') return json(res, 200, { key, ...current })
  if (req.method === 'PUT') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    assert.equal(body.baseVersion, current.version)
    const next = { version: current.version + 1, updatedAt: new Date().toISOString(), data: body.data }
    store.set(key, next)
    return json(res, 200, { key, version: next.version, updatedAt: next.updatedAt })
  }
  if (req.method === 'DELETE') {
    assert.equal(Number(url.searchParams.get('baseVersion')), current.version)
    store.delete(key)
    return json(res, 200, { ok: true })
  }
  return json(res, 405, { error: { code: 'METHOD' } })
})

test('exports, dry-runs, then restores an exact snapshot', async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kupei-store-backup-'))
  const backup = path.join(root, 'backup.json')
  const base = `http://127.0.0.1:${server.address().port}`
  const run = (...args) => runFile(process.execPath, ['tools/store-backup.mjs', ...args, '--base', base], { cwd: path.resolve('.'), encoding: 'utf8', env: { ...process.env, KUPEI_SESSION_TOKEN: token } })
  try {
    await run('export', '--out', backup)
    const saved = JSON.parse(fs.readFileSync(backup, 'utf8'))
    assert.equal(saved.schema, 'kupei-store-backup/v1')
    assert.deepEqual(saved.docs.map((x) => x.key).sort(), ['ui-news', 'ui-watch'])

    store.set('ui-watch', { version: 3, updatedAt: 'later', data: { value: 'changed' } })
    store.set('extra', { version: 1, updatedAt: 'later', data: { value: 'remove-me' } })
    await run('restore', '--in', backup, '--replace')
    assert.equal(store.get('ui-watch').data.value, 'changed')
    assert.ok(store.has('extra'))

    await run('restore', '--in', backup, '--replace', '--apply')
    assert.equal(store.get('ui-watch').data.value, 'watch-a')
    assert.equal(store.get('ui-news').data.value, 'news-a')
    assert.equal(store.has('extra'), false)
  } finally {
    server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
