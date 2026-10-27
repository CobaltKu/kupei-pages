import fs from 'node:fs/promises'
import path from 'node:path'

const argv = process.argv.slice(2)
const command = argv.shift()

function option(name, fallback = null) {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback
}

const has = (name) => argv.includes(name)
const base = option('--base', process.env.KUPEI_API_BASE || 'https://kupei-dashboard.tmac19920626.workers.dev').replace(/\/$/, '')
const token = process.env.KUPEI_SESSION_TOKEN?.trim()

function usage(message) {
  if (message) console.error(message)
  console.error('Usage:')
  console.error('  node tools/store-backup.mjs export --out <file> [--base <url>]')
  console.error('  node tools/store-backup.mjs restore --in <file> [--base <url>] [--apply] [--replace]')
  console.error('Set KUPEI_SESSION_TOKEN in the current process. Never put it in a file or command argument.')
  process.exitCode = 2
}

function validBase(value) {
  const u = new URL(value)
  if (u.protocol === 'https:') return true
  return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(u.hostname)
}

async function api(urlPath, init = {}) {
  const response = await fetch(base + urlPath, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { /* keep null */ }
  if (!response.ok) {
    const code = body?.error?.code || `HTTP_${response.status}`
    throw new Error(`${code}: ${body?.error?.message || text || response.statusText}`)
  }
  return body
}

function checkBackup(value) {
  if (!value || value.schema !== 'kupei-store-backup/v1' || !Array.isArray(value.docs)) throw new Error('Unsupported backup schema')
  const keys = new Set()
  for (const doc of value.docs) {
    if (!doc || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(doc.key) || keys.has(doc.key) || !('data' in doc)) throw new Error(`Invalid backup document: ${doc?.key ?? '(missing key)'}`)
    keys.add(doc.key)
  }
  return value
}

async function exportBackup() {
  const output = option('--out')
  if (!output) return usage('Missing --out')
  const list = await api('/api/store')
  const docs = []
  for (const item of list.docs || []) docs.push(await api(`/api/store/${encodeURIComponent(item.key)}`))
  const backup = {
    schema: 'kupei-store-backup/v1',
    exportedAt: new Date().toISOString(),
    docs: docs.map(({ key, version, updatedAt, data }) => ({ key, version, updatedAt, data })),
  }
  const target = path.resolve(output)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx' })
  console.log(`Exported ${docs.length} documents to ${target}`)
}

async function restoreBackup() {
  const input = option('--in')
  if (!input) return usage('Missing --in')
  const backup = checkBackup(JSON.parse(await fs.readFile(path.resolve(input), 'utf8')))
  const currentList = await api('/api/store')
  const currentKeys = new Set((currentList.docs || []).map((x) => x.key))
  const backupKeys = new Set(backup.docs.map((x) => x.key))
  const remove = has('--replace') ? [...currentKeys].filter((key) => !backupKeys.has(key)).sort() : []
  console.log(`Plan: write ${backup.docs.length} documents; delete ${remove.length} unlisted documents${has('--replace') ? ' (replace mode)' : ''}.`)
  if (!has('--apply')) {
    console.log('Dry run only. Add --apply to perform the restore.')
    return
  }
  for (const saved of backup.docs) {
    const current = await api(`/api/store/${encodeURIComponent(saved.key)}`)
    await api(`/api/store/${encodeURIComponent(saved.key)}`, { method: 'PUT', body: JSON.stringify({ baseVersion: current.version, data: saved.data }) })
  }
  for (const key of remove) {
    const current = await api(`/api/store/${encodeURIComponent(key)}`)
    if (current.version > 0) await api(`/api/store/${encodeURIComponent(key)}?baseVersion=${current.version}`, { method: 'DELETE' })
  }
  console.log(`Restored ${backup.docs.length} documents; deleted ${remove.length}.`)
}

if (!['export', 'restore'].includes(command)) usage('Choose export or restore')
else if (!token) usage('KUPEI_SESSION_TOKEN is not set')
else if (!validBase(base)) usage('API base must use HTTPS (HTTP is allowed only for localhost)')
else {
  try {
    if (command === 'export') await exportBackup()
    else await restoreBackup()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
