// C-10（REPORT-01，2026-10-30 後端上線）：報告設定的前端串接。
// 產生報告帶設定快照（keywords、includeNews、focusMajors、comparePrevious、inputIds）；勾選參考檔；排程（once／daily／weekly）建立、列出、刪除，
// 畫面寫「約在設定時間之後排入」不是準點；請求清單顯示版次與觸發方式；關鍵字不足 2 個不能產生或建立排程；報告內容仍是安全純文字。
// 後端 /api/reports/* 全用假的回應，評分與行情用 fixture；不建立帳號。測試檔要和 _kupei_test.mjs 放同一個資料夾執行。
// BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_report_settings.mjs
import { chromium } from 'playwright'
import { routeBackend, seedSession, CORS } from './_kupei_test.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }

const M = { posts: [], schedPosts: [], schedDeletes: [], schedules: [], requests: [], inputs: [], schedStatus: 0, schedError: '', reqStatus: 0, reqError: '' }
let nextId = 100
async function mockReports(route) {
  const r = route.request(), u = new URL(r.url()), path = u.pathname, m = r.method()
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const json = (status, body) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) })
  const err = (status, code) => json(status, { error: { code, message: 'x', details: null } })
  if (path === '/api/reports/schedules') {
    if (m === 'GET') return json(200, { schedules: M.schedules })
    const body = JSON.parse(r.postData() || '{}'); M.schedPosts.push(body)
    if (M.schedStatus) return err(M.schedStatus, M.schedError)
    const s = { id: ++nextId, code: body.code, period: body.period, frequency: body.frequency, time: body.time, weekday: body.weekday ?? null, date: body.date ?? null,
      settings: body.settings ? { includeNews: true, comparePrevious: true, focusMajors: [], inputIds: [], ...body.settings } : null, nextDueAt: '2026-11-03T01:00:00Z', lastDueAt: null, lastRequestId: null, createdAt: '2026-11-01T00:00:00Z' }
    M.schedules.unshift(s); return json(201, s)
  }
  let mm = path.match(/^\/api\/reports\/schedules\/(\d+)$/)
  if (mm && m === 'DELETE') { M.schedDeletes.push(Number(mm[1])); M.schedules = M.schedules.filter((s) => s.id !== Number(mm[1])); return json(200, { status: 'ok' }) }
  mm = path.match(/^\/api\/reports\/(\d{4})\/requests$/)
  if (mm && m === 'POST') {
    const body = JSON.parse(r.postData() || '{}'); M.posts.push(body)
    if (M.reqStatus) return err(M.reqStatus, M.reqError)
    return json(202, { id: ++nextId, status: 'QUEUED', createdAt: '2026-11-01T00:00:00Z', rev: 4, settings: body.settings ? { includeNews: true, comparePrevious: true, focusMajors: [], inputIds: [], ...body.settings } : null, run: 'run1' })
  }
  if (mm && m === 'GET') return json(200, { requests: M.requests })
  if (/\/inputs$/.test(path) && m === 'GET') return json(200, { inputs: M.inputs })
  if (/^\/api\/reports\/\d{4}$/.test(path)) return json(200, { reports: [] })
  return err(404, 'NOT_FOUND')
}
const FILES = [
  { id: 'f1', code: '2330', name: '法說會簡報.pdf', mime: 'application/pdf', bytes: 2048, sha256: 'a'.repeat(64), createdAt: '2026-10-30T01:00:00Z', createdBy: 'u:1', locked: false },
  { id: 'f2', code: '2330', name: '財報附註.csv', mime: 'text/csv', bytes: 1024, sha256: 'b'.repeat(64), createdAt: '2026-10-30T02:00:00Z', createdBy: 'u:1', locked: false },
]
async function open(vp = { width: 1280, height: 900 }, rs = {}) {
  const ctx = await b.newContext({ viewport: vp })
  await routeBackend(ctx); await seedSession(ctx)
  await ctx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, {
    kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330'] }], cur: 1 }),
    kupei3_report: JSON.stringify(rs),
  })
  await ctx.route(/\/api\/(reports|news|market\/intraday|store)/, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (path.startsWith('/api/reports')) return mockReports(route)
    if (path.startsWith('/api/store')) return route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nf' } }) })
    if (path === '/api/market/intraday') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }) })
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ items: [], fetchedAt: new Date().toISOString(), source: 'google-news-rss' }) })
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  p.on('dialog', (d) => d.accept())
  await p.goto(BASE + '#/report-settings')
  await p.waitForSelector('#rs-panel #rs-sched', { timeout: 40000 }); await p.waitForTimeout(1200)
  return p
}
const reset = (o = {}) => { M.posts.length = 0; M.schedPosts.length = 0; M.schedDeletes.length = 0; M.schedules = []; M.requests = []; M.inputs = FILES; M.schedStatus = 0; M.schedError = ''; M.reqStatus = 0; M.reqError = ''; Object.assign(M, o) }
const text = (p, sel) => p.evaluate((s) => document.querySelector(s)?.innerText || '', sel)
const toast = (p) => p.innerText('#toast-msg').catch(() => '')

for (const [label, vp] of [['桌機', { width: 1280, height: 900 }], ['手機（iPhone 14）', { width: 390, height: 844 }]]) {
  await check(`${label}：產生報告送出設定快照（關鍵字、納入新聞、比較、重點大項、勾選的參考檔）`, async () => {
    reset(); const p = await open(vp, { 2330: { kw: ['台積電', '2330', '法說會'], time: '', news: false, focus: [], cmp: false, inputs: [] } })
    await p.check('[data-pinsel="f1"]'); await p.waitForTimeout(200)
    await p.click('[data-repgen]'); await p.waitForTimeout(800)
    must(M.posts.length === 1, 'POST 次數 ' + M.posts.length)
    const st = M.posts[0].settings; must(st && st.keywords.join() === '台積電,2330,法說會' && st.includeNews === false && st.comparePrevious === false && st.inputIds.join() === 'f1', '設定：' + JSON.stringify(M.posts[0]))
    await p.context().close()
  })
  await check(`${label}：重點大項勾選會帶入 focusMajors；取消參考檔勾選後不再帶入`, async () => {
    reset(); const p = await open(vp, { 2330: { kw: ['台積電', '2330'], time: '', news: true, focus: [], cmp: true, inputs: ['f1', 'f2'] } })
    await p.check('[data-focus]'); await p.uncheck('[data-pinsel="f1"]'); await p.waitForTimeout(200)
    await p.click('[data-repgen]'); await p.waitForTimeout(800)
    const st = M.posts[0].settings; must(st.focusMajors.length === 1 && st.inputIds.join() === 'f2' && st.includeNews === true && st.comparePrevious === true, '設定：' + JSON.stringify(st)); await p.context().close()
  })
  await check(`${label}：關鍵字不足 2 個 → 產生報告與建立排程都不能送，畫面提示`, async () => {
    reset(); const p = await open(vp, { 2330: { kw: ['法說會'], time: '', news: true, focus: [], cmp: true, inputs: [] } })
    must(await p.isDisabled('[data-repgen]'), '產生報告按鈕應停用')
    must(/至少要 2 個/.test(await text(p, '#rs-panel')), '提示：' + (await text(p, '#rs-panel')).slice(0, 200))
    await p.click('[data-schadd]'); await p.waitForTimeout(400)
    must(M.schedPosts.length === 0 && /至少要 2 個/.test(await toast(p)), '不該送排程：' + JSON.stringify(M.schedPosts)); await p.context().close()
  })
  await check(`${label}：排程每週一 09:30 → POST 排程帶設定快照；列表顯示「下次約…之後排入」；刪除後消失`, async () => {
    reset(); const p = await open(vp, { 2330: { kw: ['台積電', '2330'], time: '', news: true, focus: [], cmp: true, inputs: ['f2'], freq: 'weekly', wd: 1, tm: '09:30', per: 'PREVIOUS_QUARTER' } })
    await p.click('[data-schadd]'); await p.waitForTimeout(1000)
    must(M.schedPosts.length === 1, '排程 POST 次數 ' + M.schedPosts.length)
    const b0 = M.schedPosts[0]; must(b0.code === '2330' && b0.frequency === 'weekly' && b0.weekday === 1 && b0.time === '09:30' && b0.period === 'PREVIOUS_QUARTER' && !b0.date && b0.settings.keywords.join() === '台積電,2330' && b0.settings.inputIds.join() === 'f2', '本文：' + JSON.stringify(b0))
    const t = await text(p, '#rs-schlist'); must(/每週 週一 09:30（台灣時間）｜上一季/.test(t) && /下次約/.test(t) && /之後排入/.test(t), '列表：' + t.slice(0, 200))
    must(/不是準點/.test(await text(p, '#rs-sched')), '要寫明不是準點')
    await p.click('[data-schdel]'); await p.waitForTimeout(900)
    must(M.schedDeletes.length === 1 && /尚無排程/.test(await text(p, '#rs-schlist')), '刪除：' + JSON.stringify(M.schedDeletes) + (await text(p, '#rs-schlist')).slice(0, 80)); await p.context().close()
  })
  await check(`${label}：排程「一次」要先選日期；選日期後 POST date＋time，不帶 weekday；每天只帶 time`, async () => {
    reset(); let p = await open(vp, { 2330: { kw: ['台積電', '2330'], time: '', news: true, focus: [], cmp: true, inputs: [], freq: 'once' } })
    await p.click('[data-schadd]'); await p.waitForTimeout(300)
    must(M.schedPosts.length === 0 && /請先選擇排程日期/.test(await toast(p)), '沒選日期不該送：' + JSON.stringify(M.schedPosts))
    const day = await p.$$('[data-calpick]:not([disabled])'); await day[day.length - 1].click(); await p.waitForTimeout(200)
    await p.click('[data-schadd]'); await p.waitForTimeout(800)
    const o = M.schedPosts[0]; must(o && o.frequency === 'once' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.time === '08:00' && o.weekday === undefined, '一次：' + JSON.stringify(o))
    await p.context().close()
    reset(); p = await open(vp, { 2330: { kw: ['台積電', '2330'], time: '', news: true, focus: [], cmp: true, inputs: [], freq: 'daily', tm: '10:00', per: 'CURRENT_QUARTER' } })
    await p.click('[data-schadd]'); await p.waitForTimeout(800)
    const d = M.schedPosts[0]; must(d && d.frequency === 'daily' && d.time === '10:00' && d.period === 'CURRENT_QUARTER' && d.weekday === undefined && d.date === undefined, '每天：' + JSON.stringify(d)); await p.context().close()
  })
  await check(`${label}：排程錯誤（QUOTA_EXCEEDED、BAD_REQUEST）顯示可讀訊息；請求 403／400 也有訊息`, async () => {
    reset({ schedStatus: 403, schedError: 'QUOTA_EXCEEDED' }); const p = await open(vp, { 2330: { kw: ['台積電', '2330'], time: '', news: true, focus: [], cmp: true, inputs: [], freq: 'daily' } })
    await p.click('[data-schadd]'); await p.waitForTimeout(800); must(/最多 20 個/.test(await toast(p)), '排程上限：' + await toast(p))
    M.schedStatus = 400; M.schedError = 'BAD_REQUEST'; await p.click('[data-schadd]'); await p.waitForTimeout(800); must(/排程格式不合法/.test(await toast(p)), '排程 400：' + await toast(p))
    M.reqStatus = 400; M.reqError = 'BAD_REQUEST'; await p.click('[data-repgen]'); await p.waitForTimeout(800); must(/報告設定不合法/.test(await toast(p)), '請求 400：' + await toast(p)); await p.context().close()
  })
  await check(`${label}：請求清單顯示版次、手動／排程與關鍵字數；不是準點與規則式說明都在`, async () => {
    reset({ requests: [
      { id: 7, period: '2026Q2', trigger: 'SCHEDULED', status: 'DONE', createdAt: '2026-10-31T02:00:00Z', updatedAt: '2026-10-31T02:30:00Z', message: null, rev: 3, scheduleId: 5, run: 'r', settings: { keywords: ['a', 'b', 'c'], includeNews: true, focusMajors: [], comparePrevious: true, inputIds: ['f1'] } },
      { id: 6, period: '2026Q2', trigger: 'MANUAL', status: 'FAILED', createdAt: '2026-10-30T02:00:00Z', updatedAt: '2026-10-30T02:30:00Z', message: 'REPORT_CONTRACT_INCOMPLETE', rev: null, scheduleId: null, run: null, settings: null },
    ] })
    const p = await open(vp, { 2330: { kw: ['台積電', '2330'], time: '', news: true, focus: [], cmp: true, inputs: [] } })
    await p.waitForFunction(() => /我的請求/.test(document.getElementById('rs-history')?.innerText || ''), null, { timeout: 15000 })
    const t = await text(p, '#rs-history'); must(/2026Q2 版次 3｜已完成｜排程｜3 個關鍵字/.test(t) && /2026Q2｜失敗｜手動/.test(t), '請求：' + t.slice(t.indexOf('我的請求'), t.indexOf('我的請求') + 260))
    must(!/要等 REPORT-01|尚未啟用/.test(await text(p, '#rs-panel')), '不該再有「等 REPORT-01／尚未啟用」'); await p.context().close()
  })
}
await check('報告全文仍是安全純文字：markdown 表格與標籤不被解析', async () => {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
  await routeBackend(ctx); await seedSession(ctx)
  await ctx.route(/\/api\/(reports|news|market\/intraday|store)/, async (route) => {
    const r = route.request(), path = new URL(r.url()).pathname
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const js = (x) => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(x) })
    if (/^\/api\/reports\/2330\/2026Q2\/1$/.test(path)) return js({ period: '2026Q2', rev: 1, status: 'PUBLISHED', title: '規則式報告', generatedAt: '2026-10-30T00:00:00Z', url: null, files: [], summary: '| a | b |\n| --- | --- |\n| <b>x</b> | y |' })
    if (path.startsWith('/api/reports')) return js(path.endsWith('/requests') ? { requests: [] } : { reports: [] })
    return js({ items: [], fetchedAt: new Date().toISOString(), source: 'google-news-rss' })
  })
  const p = await ctx.newPage(); await p.goto(BASE + '#/report/2330/2026Q2/1')
  await p.waitForFunction(() => /a \| b/.test(document.getElementById('r-body')?.innerText || ''), null, { timeout: 30000 })
  must((await p.$$('#r-body table')).length === 0 && (await p.innerText('#r-body')).includes('<b>x</b>'), '不該解析成 HTML，標籤要以文字顯示'); await ctx.close()
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
