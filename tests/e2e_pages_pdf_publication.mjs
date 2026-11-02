// C-10（2026-11-02）PDF 發布契約前端：發布 metadata＋六類白名單章節放在報告 summary（format = kupei-report-publication/1）。
// 驗證：OK／PARTIAL 顯示、PARTIAL 缺漏警示、fail-closed（各種不合格都整份不顯示）、章節白名單、XSS、新聞摘要獨立且失敗不擋報告。
// 後端 /api/reports/* 與 /api/news 全部用假的回應；評分與行情用 fixture（或 KUPEI_TEST_SESSION 讀線上）。不建立真實帳號。
// 測試檔要和 _kupei_test.mjs 放同一個資料夾執行。BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_pdf_publication.mjs
import { chromium } from 'playwright'
import { routeBackend, CORS } from './_kupei_test.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }

const SECTIONS = [
  ['short_term_check', '短期投資條件檢核'], ['valuation', '中心價位與本益比預估'], ['growth_driver', '主力成長動能'],
  ['thesis_counter', '論點與反證'], ['limits', '資料限制與待確認事項'], ['report_info', '報告資訊與最新簽章'],
]
const sign = (role, signer, result) => ({ role, signer, signed_at: '2026-11-02 08:30', report_version: 'V2.1', evidence: '2026-11-02／abc123def456', result })
const meta = (o = {}) => ({
  stock_id: '2330', company_name: '台積電', report_period: '2026Q2', revision: 3, report_version: 'V2.1', generated_at: '2026-11-02T00:10:00Z',
  financial_period: '2026Q2', score_period: '2026Q2', valuation_date: '2026-11-02', price_date: '2026-11-02', evidence_date: '2026-11-02',
  evidence_sha256: 'a'.repeat(64), evidence_status: 'OK', partial_reasons: [], pdf_sha256: 'b'.repeat(64), pipeline_version: 'REPORT_PIPE_V2',
  malware_scan_status: 'PASSED', claude_signoff: sign('報告產生', 'Claude', 'PASS'), codex_signoff: sign('數字複查', 'Codex', 'PASS'), publication_status: 'PUBLISHED', ...o,
})
const secs = (f = (x) => x) => f(SECTIONS.map(([id, title]) => ({ id, title: '不該被採用的標題', text: `${title}內文：第一行\n第二行` })))
const env = (o = {}) => JSON.stringify({ format: 'kupei-report-publication/1', publication: meta(o.m), sections: o.s || secs() })

const M = { reports: [], news: 'ok' }
const put = (rev, summary, title = '2330 台積電 2026Q2 正式報告') => { M.reports = M.reports.filter((r) => r.rev !== rev); M.reports.push({ period: '2026Q2', rev, status: 'PUBLISHED', title, generatedAt: '2026-11-02T00:10:00Z', url: null, files: [], summary }) }
async function mock(route) {
  const r = route.request(), url = new URL(r.url()), path = url.pathname
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const json = (status, body) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) })
  if (path === '/api/news') {
    if (M.news === 'fail') return json(500, { error: { code: 'INTERNAL', message: 'x' } })
    return json(200, { items: [{ title: 'NEWSTITLE 台積電法說會', url: 'https://news.example.com/a', source: '經濟日報', media: '經濟日報', via: 'google', publishedAt: new Date().toISOString(), summary: 'RSS摘要', matchedKeywords: ['台積電', '法說會'] }], fetchedAt: new Date().toISOString(), source: 'news-aggregate', kind: 'stock' })
  }
  if (/\/inputs$/.test(path)) return json(200, { inputs: [] })
  if (/\/requests$/.test(path)) return json(200, { requests: [] })
  const m = path.match(/^\/api\/reports\/(\d{4})\/([^/]+)\/(\d+)$/)
  if (m) { const x = M.reports.find((q) => q.period === m[2] && String(q.rev) === m[3]); return x ? json(200, x) : json(404, { error: { code: 'NOT_FOUND', message: 'nf' } }) }
  if (/^\/api\/reports\/\d{4}$/.test(path)) return json(200, { reports: M.reports.map(({ summary, ...x }) => x) })
  return json(404, { error: { code: 'NOT_FOUND', message: 'nf' } })
}
const SEED = {
  kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330'] }], cur: 1 }),
  kupei3_news: JSON.stringify({ groups: [{ id: 1, kw: ['半導體', 'AI'], ex: [] }], stock: { 2330: { kw: ['法說會'], ex: [] } } }),
}
async function open(hash, vp = { width: 1280, height: 900 }) {
  const ctx = await b.newContext({ viewport: vp })
  const seed = { 'kupei:session': JSON.stringify({ token: 'kps_mock_1', username: 't-user', expiresAt: new Date(Date.now() + 864e5).toISOString() }), ...SEED }
  await ctx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, seed)
  await routeBackend(ctx)
  await ctx.route(/\/api\/(market\/intraday|news|reports)/, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (path === '/api/market/intraday') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }) })
    return mock(route)
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && document.querySelector('.page.on'), null, { timeout: 40000 })
  return p
}
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText || '', sel)
const waitBody = (p, re) => p.waitForFunction((s) => new RegExp(s).test(document.getElementById('r-body')?.innerText || ''), re.source, { timeout: 15000 })

await check('OK 報告：六個白名單章節依序顯示、標題用固定名稱、簽章與 metadata 在報告資訊章', async () => {
  put(3, env()); const p = await open('#/report/2330/2026Q2/3'); await waitBody(p, /報告資訊與最新簽章/)
  const heads = await p.evaluate(() => [...document.querySelectorAll('#r-body h2')].map((h) => h.id + '|' + h.textContent))
  must(heads.length === 7, 'h2 數量：' + heads.join(' / '))
  SECTIONS.forEach(([id, title], i) => must(heads[i] === `rh-${id}|${title}`, `第 ${i + 1} 節：${heads[i]}`))
  const t = await text(p, '#r-body'); must(!/不該被採用的標題/.test(t), '不應採用管線自帶的章節標題')
  must(/短期投資條件檢核內文：第一行/.test(t) && /第 3 版/.test(t) && /台積電/.test(t) && /報告產生/.test(t) && /數字複查/.test(t) && /Claude/.test(t) && /Codex/.test(t), '缺 metadata 或簽章：' + t.slice(-400))
  must(!/資料不完整/.test(t), 'OK 報告不應有 PARTIAL 警示')
  must(/本機產生並掃毒通過的 PDF 為母檔/.test(t) && /不構成買賣建議/.test(t), '缺 PDF 母檔／非建議說明')
  must(/aaaaaaaaaaaaaaaa…/.test(t) && !/a{40}/.test(t), '雜湊只顯示前段')
  must(!/\{"format"/.test(t), 'JSON 不該露出')
  await p.context().close()
})
await check('PARTIAL 報告：固定顯示資料不完整警示與每一項缺漏，副標也標 PARTIAL', async () => {
  put(4, env({ m: { revision: 4, evidence_status: 'PARTIAL', partial_reasons: ['估價無上下緣（PARTIAL）', '月本益比停在 2025-04'] } }))
  const p = await open('#/report/2330/2026Q2/4'); await waitBody(p, /資料不完整/)
  const t = await text(p, '#r-body'); must(/資料不完整（PARTIAL）/.test(t) && /估價無上下緣/.test(t) && /月本益比停在 2025-04/.test(t) && /沒有以其他方法補成 KuPei 正式結果/.test(t), '警示內容：' + t.slice(0, 300))
  must(/PARTIAL/.test(await p.evaluate(() => document.getElementById('r-sub').textContent)), '副標應標 PARTIAL')
  must(/PARTIAL（資料不完整）/.test(t), '報告資訊章的證據包狀態應標 PARTIAL')
  await p.context().close()
})
const BAD = [
  ['掃毒未通過', { m: { malware_scan_status: 'FAILED' } }, 'SCAN_NOT_PASSED'],
  ['發布狀態是 DRAFT', { m: { publication_status: 'DRAFT' } }, 'NOT_PUBLISHED'],
  ['OK 卻列缺漏', { m: { partial_reasons: ['x'] } }, 'OK_WITH_REASONS'],
  ['PARTIAL 沒列缺漏', { m: { evidence_status: 'PARTIAL', partial_reasons: [] } }, 'PARTIAL_WITHOUT_REASONS'],
  ['公司代號與網址不符', { m: { stock_id: '2317' } }, 'STOCK_MISMATCH'],
  ['版次與網址不符', { m: { revision: 9 } }, 'REVISION_MISMATCH'],
  ['簽章仍是待簽', { m: { codex_signoff: sign('數字複查', 'Codex', '待簽') } }, 'SIGNOFF_MISSING'],
  ['簽章 signer 空白', { m: { codex_signoff: { ...sign('數字複查', 'Codex', 'PASS'), signer: '  ' } } }, 'SIGNOFF_MISSING'],
  ['簽章 evidence 缺欄位', { m: { claude_signoff: (({ evidence, ...r }) => r)(sign('報告產生', 'Claude', 'PASS')) } }, 'SIGNOFF_MISSING'],
  ['簽章 role／signed_at／report_version 空白', { m: { claude_signoff: { ...sign('報告產生', 'Claude', 'PASS'), role: '', signed_at: '', report_version: '' } } }, 'SIGNOFF_MISSING'],
  ['簽章報告版本與 metadata 不一致', { m: { codex_signoff: { ...sign('數字複查', 'Codex', 'PASS'), report_version: 'V1.0' } } }, 'SIGNOFF_VERSION_MISMATCH'],
  ['報告期別與網址不符', { m: { report_period: '2026Q1' } }, 'PERIOD_MISMATCH'],
  ['缺 Claude 簽章', { m: { claude_signoff: null } }, 'SIGNOFF_MISSING'],
  ['PDF 雜湊格式錯', { m: { pdf_sha256: 'xyz' } }, 'BAD_PDF_SHA'],
  ['證據包雜湊格式錯', { m: { evidence_sha256: 'A'.repeat(64) } }, 'BAD_EVIDENCE_SHA'],
  ['日期格式錯', { m: { price_date: '11/02' } }, 'BAD_price_date'],
  ['白名單以外的章節', { s: [...secs(), { id: 'raw_evidence', title: '證據包全文', text: 'SECRET_RAW' }] }, 'BAD_SECTION'],
  ['重複章節', { s: [...secs(), { id: 'valuation', title: 'x', text: 'dup' }] }, 'BAD_SECTION'],
  ['白名單章節不齊', { s: secs((a) => a.slice(0, 5)) }, 'SECTION_MISSING'],
  ['章節沒有內容', { s: secs((a) => { a[2].text = '  '; return a }) }, 'EMPTY_SECTION'],
]
for (const [label, o, code] of BAD) {
  await check(`fail-closed：${label} → 整份不顯示，不露出內文`, async () => {
    put(5, env({ ...o, m: { revision: 5, ...o.m } })); const p = await open('#/report/2330/2026Q2/5'); await waitBody(p, /未通過驗證/)
    const t = await text(p, '#r-body'); must(t.includes(code), '應顯示錯誤代碼 ' + code + '：' + t.slice(0, 200))
    must(!/內文：第一行|SECRET_RAW|相關新聞摘要/.test(t), '不合格報告不該顯示任何章節或新聞：' + t.slice(0, 200))
    must(!/\{"format"/.test(t), 'JSON 不該露出'); await p.context().close()
  })
}
await check('XSS：章節文字與缺漏原因全部跳脫，不產生 HTML 元素', async () => {
  put(6, env({ m: { revision: 6, evidence_status: 'PARTIAL', partial_reasons: ['<img src=x onerror=alert(1)>'] }, s: secs((a) => { a[0].text = '<b id="xss">粗體</b><script>window.__x=1</script>\n[連結](javascript:alert(1))'; return a }) }))
  const p = await open('#/report/2330/2026Q2/6'); await waitBody(p, /資料不完整/)
  const r = await p.evaluate(() => ({ b: !!document.querySelector('#r-body #xss'), img: !!document.querySelector('#r-body img'), sc: !!document.querySelector('#r-body script'), x: window.__x, a: !!document.querySelector('#r-body a[href^="javascript"]') }))
  must(!r.b && !r.img && !r.sc && !r.x && !r.a, JSON.stringify(r)); must(/<b id="xss">粗體<\/b>/.test(await text(p, '#r-body')), '應以文字顯示標籤'); await p.context().close()
})
await check('新聞摘要是獨立內容：有標題、來源、命中詞，且不在白名單章節內', async () => {
  put(3, env()); const p = await open('#/report/2330/2026Q2/3'); await waitBody(p, /NEWSTITLE/)
  const t = await text(p, '#r-news'); must(/NEWSTITLE/.test(t) && /經濟日報/.test(t) && /命中：台積電、法說會/.test(t), '新聞內容：' + t)
  must(!/NEWSTITLE/.test(await p.evaluate(() => [...document.querySelectorAll('#r-body > p.rep-text')].map((e) => e.innerText).join('')) ), '新聞不該混進章節文字')
  must(/獨立於報告之外.*不在 PDF 內/.test(await text(p, '#r-body')), '缺獨立性說明'); await p.context().close()
})
await check('新聞載入失敗不影響報告（章節與簽章照常顯示）', async () => {
  M.news = 'fail'; put(3, env()); const p = await open('#/report/2330/2026Q2/3'); await waitBody(p, /報告資訊與最新簽章/)
  await p.waitForFunction(() => /失敗|載入/.test(document.getElementById('r-news')?.innerText || ''), null, { timeout: 15000 })
  const t = await text(p, '#r-body'); must(/短期投資條件檢核內文/.test(t) && /數字複查/.test(t), '報告應照常顯示'); M.news = 'ok'; await p.context().close()
})
await check('舊格式照舊：純文字 summary 原樣顯示；長得像 JSON 但 format 不同也只當文字', async () => {
  put(7, '人工撰寫的摘要'); put(8, '{"format":"other/1","note":"hello"}')
  const p = await open('#/report/2330/2026Q2/7'); await waitBody(p, /人工撰寫的摘要/)
  must(!/相關新聞摘要|資料不完整/.test(await text(p, '#r-body')), '舊格式不該出現發布版面')
  await p.goto(BASE + '#/report/2330/2026Q2/8'); await waitBody(p, /"format":"other\/1"/); await p.context().close()
})
await check('手機寬度：發布版面不橫向捲動', async () => {
  put(4, env({ m: { revision: 4, evidence_status: 'PARTIAL', partial_reasons: ['估價無上下緣'] } }))
  const p = await open('#/report/2330/2026Q2/4', { width: 390, height: 844 }); await waitBody(p, /資料不完整/)
  must(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '橫向溢出'); await p.context().close()
})

await b.close()
let bad = 0
for (const [s, n, d] of results) { console.log(`${s}  ${n}${d ? ' — ' + d : ''}`); if (s === 'FAIL') bad++ }
if (errs.length) { console.log('頁面錯誤：', errs.slice(0, 5)); bad++ }
console.log(`${results.length - bad} / ${results.length} 通過`)
process.exit(bad ? 1 : 0)
