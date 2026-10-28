#!/usr/bin/env node
// 建置後檢查（2026-10-28 登入閘門）：dist/ 是公開的，裡面不能有任何權杖。
//   node tools/check-dist-secrets.mjs [dist 資料夾]（npm run build 最後會自動跑；CI 同一條指令）
// 檢查兩件事，任何一項命中就 exit 1（建置失敗、不部署）：
//   1. 環境變數與 .env* 檔裡的權杖類設定值（VITE_KUPEI_TOKEN、名稱含 TOKEN／SECRET／PASSWORD／KEY 的值，
//      以及任何 32 字以上的 VITE_* 值）原樣出現在 dist/ 裡。
//   2. dist/ 裡有看起來像權杖的字串常值：32 字以上、只由英數與 _ - 組成且英數混合的引號字串，
//      或 kps_／kpw_／kpr_ 開頭的權杖、寫死的 "Bearer xxx"。
// 輸出只列檔名、位置與遮罩後的開頭幾個字，不印出完整的值。
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.argv[2] || 'dist')
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`[check-dist] 找不到資料夾 ${dir}（先 npm run build）`)
  process.exit(2)
}

const mask = (v) => `${v.slice(0, 4)}…（${v.length} 字）`
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|(^|_)KEY($|_)/i

/* ---- 1. 要找的設定值：環境變數＋專案根目錄的 .env* ---- */
function parseEnv(text) {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out.push([m[1], v])
  }
  return out
}
const root = process.cwd()
const sources = [['環境變數', Object.entries(process.env)]]
for (const f of fs.readdirSync(root)) {
  if (!/^\.env(\..+)?$/.test(f) || f === '.env.example') continue
  try { sources.push([f, parseEnv(fs.readFileSync(path.join(root, f), 'utf8'))]) } catch { /* 讀不到就跳過 */ }
}
const wanted = []
for (const [from, entries] of sources) {
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || v.length < 8) continue
    const secretish = k === 'VITE_KUPEI_TOKEN' || SECRET_NAME.test(k)
    const longVite = k.startsWith('VITE_') && v.length >= 32
    if (secretish || longVite) wanted.push({ name: k, from, value: v })
  }
}

/* ---- 2. 掃 dist/ 的文字檔 ---- */
const TEXT = /\.(js|mjs|cjs|css|html?|json|map|txt|svg|xml|webmanifest)$/i
function* walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (TEXT.test(e.name)) yield p
  }
}
const LITERAL = /(["'`])([A-Za-z0-9_-]{32,})\1/g
const PREFIXED = /\bkp[swr]_[A-Za-z0-9_-]{16,}/g
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]{16,}/g
const lineOf = (text, i) => text.slice(0, i).split('\n').length

const findings = []
let files = 0
for (const file of walk(dir)) {
  files++
  const rel = path.relative(root, file)
  const text = fs.readFileSync(file, 'utf8')
  for (const w of wanted) {
    const i = text.indexOf(w.value)
    if (i >= 0) findings.push(`${rel}:${lineOf(text, i)} 含有 ${w.name} 的值（來源：${w.from}，${mask(w.value)}）`)
  }
  for (const m of text.matchAll(LITERAL)) {
    const v = m[2]
    if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) continue // 純字母（例如很長的識別字）或純數字不算
    findings.push(`${rel}:${lineOf(text, m.index)} 看起來像權杖的字串常值 ${mask(v)}`)
  }
  for (const m of text.matchAll(PREFIXED)) findings.push(`${rel}:${lineOf(text, m.index)} 權杖格式的字串 ${mask(m[0])}`)
  for (const m of text.matchAll(BEARER)) findings.push(`${rel}:${lineOf(text, m.index)} 寫死的 Authorization ${mask(m[0])}`)
}

if (findings.length) {
  console.error(`[check-dist] 失敗：${dir} 裡有 ${findings.length} 處像權杖的內容（公開網站不能帶任何權杖）`)
  for (const f of findings) console.error('  - ' + f)
  process.exit(1)
}
console.log(`[check-dist] 通過：掃了 ${files} 個檔案，沒有權杖或像權杖的設定值（比對 ${wanted.length} 個權杖類設定）`)
