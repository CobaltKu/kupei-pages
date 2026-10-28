// 個股問題（Pages 版：存本機 kupei3_questions，登入後以雲端文件 ui-questions 同步）。
// 帳號與雲端文件端點用假的（不建立真實帳號）；評分與行情用 fixture（或 KUPEI_TEST_SESSION 讀線上），見 tests/_kupei_test.mjs。
// 網站必須登入（2026-10-28）：「未登入只存本機」的情境已不存在，一開始就在登入畫面登入；「首次登入上傳本機問題」改用預先放在本機的資料模擬。
// BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_questions.mjs（SHOTS=<資料夾> 另存截圖）
import { chromium } from 'playwright'
import fs from 'node:fs'
import { routeBackend, seedSession, gateLogin } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const SHOTS = process.env.SHOTS || ''
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const X = (n) => `<img src=x onerror="window.__xss=(window.__xss||[]).concat(${n})">`

// ── 假的雲端（同 e2e_pages_sync.mjs）：文件依帳號分開，有版本，版本不符回 409 ──
const stores = new Map()
const storeOf = (u) => { if (!stores.has(u)) stores.set(u, new Map()); return stores.get(u) }
const log = []
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }
async function mock(ctx) {
  await routeBackend(ctx)
  // 報告、新聞、盤中：假的空回應
  await ctx.route(/\/api\/(reports|news|market\/intraday)/, (route) => {
    const r = route.request(), path = new URL(r.url()).pathname
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = path.startsWith('/api/reports') ? (path.endsWith('/requests') ? { requests: [] } : { reports: [] })
      : path === '/api/news/sources' ? { sources: [] } : path === '/api/news' ? { items: [], fetchedAt: new Date().toISOString(), source: 'google-news-rss' }
      : { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(body) })
  })
  await ctx.route('**/api/auth/**', async (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (r.url().endsWith('/api/auth/login')) { const u = JSON.parse(r.postData() || '{}').username; return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ user: { id: 1, username: u }, token: 'kps_' + u, expiresAt: new Date(Date.now() + 864e5).toISOString() }) }) }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
  await ctx.route('**/api/store/**', async (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const key = new URL(r.url()).pathname.split('/').pop()
    const tok = (r.headers().authorization || '').replace('Bearer ', '')
    const user = tok.startsWith('kps_') ? tok.slice(4) : null
    if (!user) return route.fulfill({ status: 401, headers: CORS, body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'no' } }) })
    const st = storeOf(user)
    const cur = st.get(key) || { version: 0, updatedAt: null, data: null }
    if (r.method() === 'GET') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key, ...cur }) })
    if (r.method() === 'PUT') {
      const body = JSON.parse(r.postData() || '{}')
      log.push(`PUT ${user}/${key} base=${body.baseVersion} cloud=${cur.version}`)
      if (body.baseVersion !== cur.version) return route.fulfill({ status: 409, headers: CORS, body: JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'conflict', ...(cur.data ? { details: { key, ...cur } } : {}) } }) })
      if (JSON.stringify(body.data).length > 256 * 1024) return route.fulfill({ status: 413, headers: CORS, body: JSON.stringify({ error: { code: 'TOO_LARGE', message: 'too large' } }) })
      const next = { version: cur.version + 1, updatedAt: new Date().toISOString(), data: body.data }
      st.set(key, next)
      return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ key, version: next.version, updatedAt: next.updatedAt }) })
    }
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ ok: true }) })
  })
}
/** user：放一個已登入的 session（不給＝停在登入畫面，由測試自己登入） */
async function device(seed, user) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
  await mock(ctx)
  if (user) await seedSession(ctx, user)
  if (seed) await ctx.addInitScript((data) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, seed)
  const p = await ctx.newPage()
  await p.route('**/fonts.g*/**', (r) => r.abort())
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  p.on('dialog', (d) => { errs.push('跳出對話框：' + d.message()); d.dismiss() })
  return p
}
const STOCK = '#/stock/2330/home'
async function openStock(p, hash = STOCK) {
  // 只差 hash 的 goto 不會重新載入頁面：先離開再回來，才是真正的重新整理
  await p.goto('about:blank'); await p.goto(BASE + hash)
  await p.waitForSelector('#q-body [data-qadd]', { timeout: 40000 })
}
const local = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('kupei3_questions')) } catch { return 'BROKEN' } })
const rows = (p) => p.$$eval('#q-body .q', (x) => x.map((e) => e.innerText.replace(/\s+/g, ' ')))
async function add(p, text, maj = 0) {
  await p.click('#q-body [data-qadd]'); await p.waitForSelector('#q-text')
  await p.fill('#q-text', text)
  for (let i = 0; i < maj; i++) await p.click(`#q-maj label:nth-child(${i + 1}) input`)
  await p.click('#q-body [data-qsave]'); await p.waitForTimeout(400)
}
/** 在登入畫面登入，等到個股頁的問題區塊出現 */
async function login(p, user = 'q-user', hash = STOCK) {
  await p.goto('about:blank'); await p.goto(BASE + hash)
  await gateLogin(p, user)
  await p.waitForSelector('#q-body [data-qadd]', { timeout: 40000 })
}
const noInject = async (p) => {
  const r = await p.evaluate(() => ({ x: window.__xss || null, n: document.querySelectorAll('#q-body [onerror],#q-body [onload],#q-body img,#q-body svg').length }))
  must(!r.x, '注入的程式被執行：' + JSON.stringify(r.x)); must(r.n === 0, '問題區塊出現 ' + r.n + ' 個注入的元素')
}
const toastText = (p) => p.innerText('#toast-msg').catch(() => '')
const cloudQ = (u) => { const d = storeOf(u).get('ui-questions'); return d && d.data ? JSON.parse(d.data.value) : null }

const A = await device()
await check('登入後：個股問題區塊開放並說明依帳號同步', async () => {
  await login(A)
  const tag = await A.innerText('#s-qtag'); must(!/尚未開放|尚未提供/.test(tag), '標籤：' + tag)
  const t = await A.innerText('#q-body'); must(/存在這台瀏覽器/.test(t) && /已登入 q-user/.test(t) && !/尚未提供|後端未承接/.test(t), t.slice(0, 120))
  must(/目前沒有問題/.test(t), '空狀態：' + t.slice(0, 120))
  return (await A.innerText('#q-store'))
})
await check('新增兩則（含相關大項）：畫面與本機都有，約 1.5 秒後寫入雲端', async () => {
  await add(A, '法說會提到的新產品線，下一季營收是否開始貢獻？', 2)
  await add(A, '海外新廠的折舊何時開始認列？')
  const r = await rows(A); must(r.length === 2, '畫面 ' + JSON.stringify(r))
  must(/Q-001/.test(r[0]) && /新增/.test(r[0]) && /人工/.test(r[0]) && /法說會/.test(r[0]), '第一則：' + r[0])
  const l = await local(A); must(l && Array.isArray(l['2330']) && l['2330'].length === 2, '本機 ' + JSON.stringify(l))
  must(l['2330'][0].related_items.length === 2 && /^\d{4}-\d{2}-\d{2}T/.test(l['2330'][0].first_seen), '欄位 ' + JSON.stringify(l['2330'][0]))
  await sleep(2800)
  const c = cloudQ('q-user'); must(c && c['2330']?.length === 2, '雲端 ' + JSON.stringify(c).slice(0, 120) + '｜' + log.join('；'))
  return r.map((x) => x.slice(0, 30)).join('／')
})
await check('改狀態（編輯）：選「已解除」後畫面與本機更新', async () => {
  await A.selectOption('#q-body [data-qst="Q-002"]', 'RESOLVED'); await A.waitForTimeout(400)
  must(/已改為「已解除」/.test(await toastText(A)), '提示：' + (await toastText(A)))
  const r = await rows(A); must(/已解除/.test(r[1]), '畫面：' + r[1])
  must((await local(A))['2330'][1].status === 'RESOLVED', '本機狀態沒更新'); return ''
})
await check('刪除、顯示已刪除、恢復', async () => {
  await A.click('#q-body [data-qdel="Q-001"]'); await A.waitForTimeout(400)
  must((await rows(A)).length === 1, '刪除後畫面列數 ' + (await rows(A)).length)
  must(await A.isVisible('#q-showdel'), '沒有出現「已刪除」按鈕'); must((await A.innerText('#q-delcount')) === '1', '已刪除數 ' + (await A.innerText('#q-delcount')))
  await A.click('#q-showdel'); await A.waitForTimeout(200)
  const t = await A.innerText('#q-body'); must(/已刪除：/.test(t) && (await A.$('#q-body [data-qrestore="Q-001"]')), '沒有顯示已刪除的問題')
  await A.click('#q-body [data-qrestore="Q-001"]'); await A.waitForTimeout(400)
  must((await rows(A)).length === 2 && !(await A.isVisible('#q-showdel')), '恢復後 ' + JSON.stringify(await rows(A)))
  await A.click('#q-body [data-qdel="Q-002"]'); await A.waitForTimeout(400) // 留一則已刪除給後面的測試
  const l = (await local(A))['2330']; must(l.find((q) => q.question_id === 'Q-002').deleted === true, '本機沒有標記刪除'); return ''
})
await check('重新整理後仍在（含已刪除）', async () => {
  await openStock(A)
  const r = await rows(A); must(r.length === 1 && /Q-001/.test(r[0]), '畫面 ' + JSON.stringify(r))
  must((await A.innerText('#q-delcount')) === '1', '已刪除數 ' + (await A.innerText('#q-delcount')))
  await add(A, '第三則：庫存去化的進度？'); return ''
})
await check('惡意內容以文字顯示、不執行', async () => {
  await add(A, `惡意 ${X(1)} </div><script>window.__xss=2</script>`)
  await noInject(A)
  const r = await rows(A); must(r.some((x) => x.includes('<img src=x onerror=')), '沒有原樣以文字顯示：' + JSON.stringify(r)); return ''
})
await check('Idempotency-Key 相同只新增一次；If-Match 舊版本回 409', async () => {
  const out = await A.evaluate(async () => {
    const api = window.KupeiAPI, P = '/companies/2330/questions'
    const g = await api.req('GET', P + '?include_deleted=true')
    const h = { 'If-Match': String(g.data.version), 'Idempotency-Key': 'same-key-1' }
    const r1 = await api.req('POST', P, { text: '重複送出測試', related_items: [], evidence: ['人工'] }, h)
    const r2 = await api.req('POST', P, { text: '重複送出測試', related_items: [], evidence: ['人工'] }, { 'If-Match': String(r1.data.version), 'Idempotency-Key': 'same-key-1' })
    const stale = await api.req('PUT', P + '/Q-001', { text: 'x', status: 'NEW' }, { 'If-Match': String(g.data.version) })
    const n = r2.data.questions.filter((q) => q.body === '重複送出測試').length
    const last = r2.data.questions.find((q) => q.body === '重複送出測試')
    await api.req('DELETE', P + '/' + last.question_id, null, { 'If-Match': String(r2.data.version) })
    return { v: typeof g.data.version, n, stale: [stale.status, stale.data.error_code], g: Array.isArray(g.data.questions) }
  })
  must(out.v === 'number' && out.g, '形狀 ' + JSON.stringify(out)); must(out.n === 1, '重複新增 ' + out.n + ' 則'); must(out.stale[0] === 409 && out.stale[1] === 'VERSION_CONFLICT', '舊版本 ' + JSON.stringify(out.stale))
  return JSON.stringify(out)
})
await check('上限：每則 1,000 字、每家公司 100 則、整份約 200 KB 都會提示', async () => {
  // 1,001 字：輸入框 maxlength 擋住，直接呼叫也回 Q_TOO_LONG
  const long = await A.evaluate(async () => (await window.KupeiAPI.req('POST', '/companies/2330/questions', { text: 'a'.repeat(1001) })).data.error_code)
  must(long === 'Q_TOO_LONG', '1001 字 ' + long)
  await A.click('#q-body [data-qadd]'); must((await A.getAttribute('#q-text', 'maxlength')) === '1000', '輸入框沒有 maxlength'); await A.click('#q-body [data-qcancel]')
  // 每家 100 則
  const now = '2026-10-27T09:00:00+08:00'
  const mk = (i, body) => ({ question_id: 'Q-' + String(i).padStart(3, '0'), body, status: 'NEW', manual_locked: true, first_seen: now, updated_at: now, related_items: [], evidence: [], status_reason: null, deleted: false, deleted_at: null })
  const full = { '2317': Array.from({ length: 100 }, (_, i) => mk(i + 1, '第 ' + (i + 1) + ' 則')) }
  // 整份接近上限：其他公司塞滿長內容（中文 1,000 字約 3 KB）
  const big = {}; for (let c = 0; c < 70; c++) big[String(3000 + c)] = [mk(1, '問'.repeat(1000))]
  const P = await device({ kupei3_questions: JSON.stringify({ ...full, ...big }) }, 'q-limit')
  await openStock(P, '#/stock/2317/home')
  must((await rows(P)).length === 100, '2317 畫面 ' + (await rows(P)).length)
  await add(P, '第 101 則'); const t1 = await toastText(P); must(/最多 100 則/.test(t1), '100 則提示：' + t1)
  await openStock(P, '#/stock/2330/home')
  await add(P, '問'.repeat(1000)); const t2 = await toastText(P); must(/總量已達上限/.test(t2), '總量提示：' + t2)
  const l = await local(P); must(!l['2330'] && l['2317'].length === 100, '超過上限仍寫入本機')
  // 已超過上限的資料仍可刪除（改小一定可以）
  await openStock(P, '#/stock/2317/home'); await P.click('#q-body [data-qdel="Q-001"]'); await P.waitForTimeout(400)
  must((await local(P))['2317'][0].deleted === true, '超過上限時無法刪除')
  await P.context().close()
  return `${t1}｜${t2}`
})
await check('本機被改寫成惡意或錯誤結構：不合格的丟掉、不執行、頁面正常', async () => {
  const now = '2026-10-27T09:00:00+08:00'
  const evil = {
    '2330': [
      { question_id: 'Q-001', body: `正常 ${X(3)}`, status: `NEW"><img src=x onerror="window.__xss=4">`, manual_locked: true, first_seen: now, related_items: [X(5), 7, '營收'], evidence: [X(6)], status_reason: X(7), deleted: false },
      { question_id: `Q-2"><img src=x onerror="window.__xss=8">`, body: 'id 不合格', first_seen: now },
      { question_id: 'Q-003', body: 12345, first_seen: now },
      { question_id: 'Q-004', body: '時間不合格', first_seen: `2026"><img src=x onerror="window.__xss=9">` },
      { question_id: 'Q-005', body: 'x'.repeat(5000), first_seen: now, deleted: true, deleted_at: now },
      { question_id: 'Q-001', body: '重複 id', first_seen: now },
      null, 'str',
    ],
    [`23"><img src=x onerror="window.__xss=10">`]: [{ question_id: 'Q-001', body: '代號不合格', first_seen: now }],
    '2317': 'not-an-array',
  }
  const P = await device({ kupei3_questions: JSON.stringify(evil) }, 'q-evil')
  await openStock(P)
  await noInject(P)
  const r = await rows(P); must(r.length === 1 && /正常/.test(r[0]) && /新增/.test(r[0]), '畫面 ' + JSON.stringify(r))
  must((await P.innerText('#q-delcount')) === '1', '已刪除數 ' + (await P.innerText('#q-delcount')))
  const g = await P.evaluate(async () => (await window.KupeiAPI.req('GET', '/companies/2330/questions?include_deleted=true')).data.questions)
  must(g.length === 2 && g[1].body.length === 1000, '驗證後 ' + JSON.stringify(g.map((q) => [q.question_id, q.body.length])))
  const broken = await device({ kupei3_questions: '[1,2' }, 'q-broken')
  await openStock(broken); must(/目前沒有問題/.test(await broken.innerText('#q-body')), '壞掉的 JSON 沒有退回空的')
  await P.context().close(); await broken.context().close()
  return ''
})
await check('首次登入：這台瀏覽器原有的問題（閘門上線前存的）上傳到雲端文件 ui-questions', async () => {
  const mine = (await local(A))['2330']
  const S = await device({ kupei3_questions: JSON.stringify({ 2330: mine }) })
  await login(S, 'q-first')
  await sleep(2500)
  const doc = storeOf('q-first').get('ui-questions'); must(doc && doc.version === 1, '雲端 ' + JSON.stringify(doc && doc.version) + '｜' + log.join('；'))
  const c = cloudQ('q-first'); must(c['2330'].length === mine.length && c['2330'][0].body === mine[0].body, '雲端內容 ' + JSON.stringify(c).slice(0, 120))
  must(/已登入 q-first/.test(await S.innerText('#q-store')), '說明 ' + (await S.innerText('#q-store')))
  await S.context().close()
  return `${mine.length} 則`
})
await check('修改 → 約 1.5 秒後寫入雲端（版本＋1）', async () => {
  await openStock(A); const v0 = storeOf('q-user').get('ui-questions').version
  await add(A, '登入後新增的問題'); await sleep(2800)
  const doc = storeOf('q-user').get('ui-questions'); must(doc.version === v0 + 1, '版本 ' + doc.version + '（原 ' + v0 + '）')
  must(cloudQ('q-user')['2330'].some((q) => q.body === '登入後新增的問題'), '雲端沒有新增的那則'); return log.slice(-1)[0]
})
const B = await device()
await check('另一台裝置登入同一帳號 → 讀得到問題（含已刪除）', async () => {
  await login(B); await sleep(1500); await openStock(B)
  const r = await rows(B); const want = cloudQ('q-user')['2330'].filter((q) => !q.deleted).length
  must(r.length === want && r.some((x) => /登入後新增的問題/.test(x)), 'B 畫面 ' + JSON.stringify(r))
  const del = String(cloudQ('q-user')['2330'].filter((q) => q.deleted).length)
  must((await B.innerText('#q-delcount')) === del, 'B 已刪除數 ' + (await B.innerText('#q-delcount')) + '，雲端 ' + del)
  await noInject(B)
  return `${r.length} 則`
})
await check('B 新增 → A 重新整理後看到', async () => {
  const v0 = storeOf('q-user').get('ui-questions').version
  await add(B, '裝置 B 新增的問題'); await sleep(2800)
  must(storeOf('q-user').get('ui-questions').version === v0 + 1, '版本 ' + storeOf('q-user').get('ui-questions').version)
  await openStock(A); await sleep(1500); await openStock(A)
  must((await rows(A)).some((x) => /裝置 B 新增的問題/.test(x)), 'A 畫面 ' + JSON.stringify(await rows(A))); return ''
})
await check('換帳號：另一個帳號登入不上傳上一個帳號的問題（備份到 _prev）', async () => {
  await A.click('[data-acct]'); await Promise.all([A.waitForEvent('load'), A.click('[data-acct-logout]')]); await A.waitForSelector('#kp-gate')
  await login(A, 'q-other'); await sleep(1500); await openStock(A)
  must(!cloudQ('q-other'), 'q-other 雲端混入：' + JSON.stringify(cloudQ('q-other')).slice(0, 80))
  must((await rows(A)).length === 0, 'A 畫面仍是上一個帳號的問題')
  const prev = await A.evaluate(() => JSON.parse(localStorage.getItem('kupei3_questions_prev') || 'null'))
  must(prev && prev['2330'].length >= 4, '_prev ' + JSON.stringify(prev).slice(0, 80)); return ''
})
if (SHOTS) {
  await check('截圖：個股頁問題區塊（含已刪除）', async () => {
    fs.mkdirSync(SHOTS, { recursive: true })
    await openStock(B); await sleep(500)
    await B.click('#q-showdel'); await B.waitForTimeout(300)
    const card = await B.$('#q-body'); const box = await card.evaluateHandle((e) => e.closest('.card') || e.parentElement)
    await box.asElement().scrollIntoViewIfNeeded(); await box.asElement().screenshot({ path: SHOTS + '/questions-card.png' })
    await B.screenshot({ path: SHOTS + '/questions-page.png', fullPage: false })
    const M = await b.newContext({ viewport: { width: 390, height: 844 } }); await mock(M); await seedSession(M, 'q-shot')
    const m = await M.newPage(); await m.route('**/fonts.g*/**', (r) => r.abort())
    await m.goto(BASE); await m.evaluate((v) => localStorage.setItem('kupei3_questions', v), await B.evaluate(() => localStorage.getItem('kupei3_questions')))
    await openStock(m); await m.click('#q-showdel'); await m.waitForTimeout(300)
    const mb = await m.$('#q-body'); await mb.scrollIntoViewIfNeeded(); await m.screenshot({ path: SHOTS + '/questions-mobile.png' })
    await M.close()
    return SHOTS
  })
}
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
console.log('雲端寫入紀錄：' + log.join(' / '))
process.exit(fail ? 1 : 0)
