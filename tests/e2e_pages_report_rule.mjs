// C-07 規則式報告的畫面語意：報告不得冒充 AI、管線狀態與代碼要看得懂、設定與排程目前不會生效要講清楚、參考檔 V1 只列索引。
// 後端 /api/reports/* 全部用假的回應（route mock），評分與行情用 fixture（或 KUPEI_TEST_SESSION 讀線上）。不建立真實帳號。
// 測試檔要和 _kupei_test.mjs 放同一個資料夾執行。BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_report_rule.mjs
import { chromium } from 'playwright'
import { routeBackend, CORS } from './_kupei_test.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }

const RULE_MD = '# 2330 台積電｜2026Q2 規則式分析報告\n\n- 管線版本：`REPORT_RULE_V1`\n\n## 限制\n- 參考檔只列索引與雜湊；規則式管線不解析附件內容。\n| 大項 | 分數 |\n| --- | --- |\n| DAR-L | 63.6 |'
const M = {
  reports: [
    { period: '2026Q2', rev: 3, status: 'PUBLISHED', title: '2330 台積電 2026Q2 規則式分析報告', generatedAt: '2026-10-28T06:00:00Z', url: null, files: [], summary: RULE_MD },
    { period: '2026Q2', rev: 1, status: 'PUBLISHED', title: '第二季人工報告', generatedAt: '2026-10-20T03:00:00Z', url: null, files: [], summary: '人工撰寫的摘要' },
  ],
  requests: [],
}
async function mockReports(route) {
  const r = route.request(), path = new URL(r.url()).pathname
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const json = (status, body) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) })
  if (/\/inputs$/.test(path)) return json(200, { inputs: [] })
  if (/\/requests$/.test(path)) return json(200, { requests: M.requests })
  let m = path.match(/^\/api\/reports\/(\d{4})\/([^/]+)\/(\d+)$/)
  if (m) { const x = M.reports.find((q) => q.period === m[2] && String(q.rev) === m[3]); return x ? json(200, x) : json(404, { error: { code: 'NOT_FOUND', message: 'nf' } }) }
  if (/^\/api\/reports\/\d{4}$/.test(path)) return json(200, { reports: M.reports.map(({ summary, ...x }) => x) })
  return json(404, { error: { code: 'NOT_FOUND', message: 'nf' } })
}
const SEED = { kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330'] }], cur: 1 }) }
async function open(hash, vp = { width: 1280, height: 900 }) {
  const ctx = await b.newContext({ viewport: vp })
  const seed = { 'kupei:session': JSON.stringify({ token: 'kps_mock_1', username: 't-user', expiresAt: new Date(Date.now() + 864e5).toISOString() }), ...SEED }
  await ctx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, seed)
  await routeBackend(ctx)
  await ctx.route(/\/api\/(market\/intraday|news|reports)/, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (path.startsWith('/api/reports')) return mockReports(route)
    if (path === '/api/market/intraday') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }) })
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ items: [], fetchedAt: new Date().toISOString(), source: 'google-news-rss' }) })
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && document.querySelector('.page.on'), null, { timeout: 40000 })
  return p
}
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText || '', sel)

await check('報告全文頁：規則式報告標明「不是 AI 撰寫」，人工報告不加這句', async () => {
  const p = await open('#/report/2330/2026Q2/3'); await p.waitForFunction(() => /規則式/.test(document.getElementById('r-body')?.innerText || ''), null, { timeout: 15000 })
  const t = await text(p, '#r-body'); must(/不是 AI 撰寫/.test(t) && /不構成買賣建議/.test(t) && /內容未解析/.test(t) && /不自行推算/.test(t), '標示：' + t.slice(0, 200))
  must(/REPORT_RULE_V1/.test(t), '摘要內容（管線版本）應原樣顯示')
  await p.goto(BASE + '#/report/2330/2026Q2/1'); await p.waitForFunction(() => /人工撰寫/.test(document.getElementById('r-body')?.innerText || ''), null, { timeout: 15000 })
  must(!/不是 AI 撰寫/.test(await text(p, '#r-body')), '非規則式報告不應被標成規則式'); await p.context().close()
})
await check('報告全文頁：規則式報告的 markdown 表格以純文字顯示（不注入 HTML）', async () => {
  const p = await open('#/report/2330/2026Q2/3'); await p.waitForFunction(() => /DAR-L/.test(document.getElementById('r-body')?.innerText || ''), null, { timeout: 15000 })
  must((await p.$$('#r-body table')).length === 0, '不應把表格解析成 HTML'); await p.context().close()
})
for (const [status, message, re, label] of [
  ['FAILED', 'REPORT_CONTRACT_INCOMPLETE', /報告管線的設定與資料契約尚未完成.*不是你的操作錯誤/, '契約缺欄位 → 看得懂的說明'],
  ['FAILED', 'REPORT_SETTINGS_OR_MANIFEST_MISSING', /契約尚未完成/, '設定或 manifest 缺少 → 同上'],
  ['RUNNING', 'REPORT_RULE_V1', /產生中.*規則式管線/, 'RUNNING 顯示「產生中」與規則式管線'],
  ['QUEUED', '', /排隊中/, 'QUEUED 顯示排隊中'],
  ['DONE', 'REPORT_RULE_V1; details=12', /已完成.*規則式管線/, 'DONE 顯示已完成，不外露 details 計數'],
]) {
  await check(`請求狀態：${label}`, async () => {
    M.requests = [{ id: 'req1', period: '2026Q2', trigger: 'MANUAL', status, createdAt: '2026-10-28T02:00:00Z', updatedAt: '2026-10-28T02:05:00Z', message }]
    const p = await open('#/report-settings'); await p.waitForFunction(() => /我的請求/.test(document.getElementById('rs-history')?.innerText || ''), null, { timeout: 15000 })
    const t = await text(p, '#rs-panel'); must(re.test(t), '畫面：' + t.slice(t.indexOf('我的請求'), t.indexOf('我的請求') + 140))
    must(!/REPORT_CONTRACT_INCOMPLETE|REPORT_SETTINGS_OR_MANIFEST_MISSING|details=12/.test(t), '代碼不該直接露出給使用者')
    await p.context().close()
  })
}
await check('報告設定：說明設定項目與排程目前不會生效、報告為規則式、參考檔只列索引', async () => {
  M.requests = []; const p = await open('#/report-settings'); await p.waitForSelector('#rs-panel', { timeout: 15000 }); await p.waitForTimeout(800)
  const t = await text(p, '#rs-panel')
  must(/只送出公司與期別/.test(t) && /REPORT-01/.test(t) && /不是 AI 撰寫/.test(t), '設定未生效說明：' + t.slice(0, 220))
  must(/排程時間（尚未啟用/.test(t) && /不會自動產生/.test(t), '排程說明')
  must(/只列出檔名與雜湊，不會讀取檔案內容/.test(t), '參考檔說明'); await p.context().close()
})
await check('狀態頁：報告列寫明規則式（非 AI）與參考檔 V1 只列索引', async () => {
  const p = await open('#/status'); await p.waitForFunction(() => /報告/.test(document.getElementById('st-kv')?.innerText || ''), null, { timeout: 15000 })
  const t = await text(p, '#st-kv'); must(/規則式報告（非 AI）/.test(t) && /V1 只列參考檔索引/.test(t), t.slice(t.indexOf('報告'), t.indexOf('報告') + 120)); await p.context().close()
})
await check('手機寬度（iPhone 14）：報告設定與報告頁不橫向捲動', async () => {
  M.requests = [{ id: 'r', period: '2026Q2', trigger: 'MANUAL', status: 'FAILED', createdAt: '2026-10-28T02:00:00Z', message: 'REPORT_CONTRACT_INCOMPLETE' }]
  for (const h of ['#/report-settings', '#/report/2330/2026Q2/3']) {
    const p = await open(h, { width: 390, height: 844 }); await p.waitForTimeout(1500)
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth })); must(m.sw <= m.iw, `${h} 橫向捲動 ${m.sw} > ${m.iw}`); await p.context().close()
  }
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
