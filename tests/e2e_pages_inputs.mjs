// C-05 報告參考檔 UI（上傳、列出、下載、刪除）：後端 /api/reports/<代號>/inputs 全部用假的回應（route mock），評分與行情用 fixture
// （或 KUPEI_TEST_SESSION 讀線上）。不建立真實帳號、不寫任何線上資料。測試檔要和 _kupei_test.mjs 放同一個資料夾執行。
// BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_inputs.mjs（SHOTS=<資料夾> 另存截圖）
import { chromium } from 'playwright'
import crypto from 'node:crypto'
import { routeBackend, gateLogin, CORS } from './_kupei_test.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const SHOTS = process.env.SHOTS || ''
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const XSS = '<img src=x onerror="window.__xss=1">'
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/* ---- 假的後端：記憶體裡的參考檔清單，與每個請求的紀錄 ---- */
const S = { files: [], calls: [], postFail: null, deleteFail: null, listFail: null, downloadFail: null, seq: 0 }
const reset = () => { S.files = []; S.calls = []; S.postFail = S.deleteFail = S.listFail = S.downloadFail = null; S.seq = 0 }
const MIME = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg' }
const addFile = (o) => { const f = { id: 'in' + ++S.seq, code: '2330', name: 'a.md', mime: 'text/markdown', bytes: 10, sha256: sha(o.name || 'a.md'), createdAt: '2026-10-28T02:00:00Z', createdBy: 'u:1', owner: 'Bearer kps_mock_1', locked: false, body: Buffer.from('hello'), ...o }; S.files.push(f); return f }
const pub = (f) => ({ id: f.id, code: f.code, name: f.name, mime: f.mime, bytes: f.bytes, sha256: f.sha256, createdAt: f.createdAt, createdBy: f.createdBy, locked: f.locked })

async function mockInputs(route) {
  const r = route.request(), u = new URL(r.url()), path = u.pathname
  if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  const h = r.headers()
  S.calls.push({ method: r.method(), path, qs: u.search, auth: h.authorization || '', ct: h['content-type'] || '', sha: h['x-content-sha256'] || '', body: r.postDataBuffer() })
  const json = (status, body) => route.fulfill({ status, headers: CORS, body: JSON.stringify(body) })
  const err = (status, code) => json(status, { error: { code, message: code } })
  if (!/^Bearer kps_/.test(h.authorization || '')) return err(401, 'UNAUTHENTICATED')
  let m
  if ((m = path.match(/^\/api\/reports\/(\d{4})\/inputs$/))) {
    if (r.method() === 'GET') return S.listFail ? err(S.listFail[0], S.listFail[1]) : json(200, { inputs: S.files.filter((f) => f.code === m[1] && f.owner === h.authorization).map(pub) })
    if (r.method() === 'POST') {
      if (S.postFail) return err(S.postFail[0], S.postFail[1])
      const body = r.postDataBuffer() || Buffer.alloc(0)
      const f = addFile({ code: m[1], owner: h.authorization, name: u.searchParams.get('name'), mime: h['content-type'], bytes: body.length, sha256: sha(body), body, createdAt: '2026-10-28T03:00:00Z' })
      return json(201, pub(f))
    }
  }
  if ((m = path.match(/^\/api\/reports\/(\d{4})\/inputs\/([^/]+)$/))) {
    const f = S.files.find((x) => x.id === m[2] && x.code === m[1])
    if (r.method() === 'GET') {
      if (S.downloadFail) return err(S.downloadFail[0], S.downloadFail[1])
      return f ? route.fulfill({ status: 200, headers: { ...CORS, 'content-type': f.mime, 'content-disposition': 'attachment; filename="x"' }, body: f.body }) : err(404, 'NOT_FOUND')
    }
    if (r.method() === 'DELETE') {
      if (S.deleteFail) return err(S.deleteFail[0], S.deleteFail[1])
      if (!f) return err(404, 'NOT_FOUND')
      if (f.locked) return err(409, 'INPUT_LOCKED')
      S.files = S.files.filter((x) => x !== f); return json(200, { status: 'ok' })
    }
  }
  return err(404, 'NOT_FOUND')
}

const SEED = { kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330'] }], cur: 1 }) }
let confirmAnswer = true
async function open(vp = { width: 1280, height: 900 }, hash = '#/report-settings', wait = '#rs-inputs') {
  const ctx = await b.newContext({ viewport: vp, acceptDownloads: true })
  const seed = { 'kupei:session': JSON.stringify({ token: 'kps_mock_1', username: 't-user', expiresAt: new Date(Date.now() + 864e5).toISOString() }), ...SEED }
  await ctx.addInitScript((data) => { if (!sessionStorage.getItem('seeded')) { for (const k in data) localStorage.setItem(k, data[k]); sessionStorage.setItem('seeded', '1') } }, seed)
  await routeBackend(ctx)
  await ctx.route(/\/api\/(market\/intraday|news|reports)/, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (/\/inputs(\/|$)/.test(path)) return mockInputs(route)
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (path === '/api/market/intraday') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }) })
    if (/\/requests$/.test(path)) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ requests: [] }) })
    if (/^\/api\/reports\/\d{4}$/.test(path)) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ reports: [] }) })
    return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ items: [], fetchedAt: new Date().toISOString(), source: 'google-news-rss' }) })
  })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  p.on('dialog', (d) => { if (d.type() === 'confirm') { p.__confirm = d.message(); return confirmAnswer ? d.accept() : d.dismiss() } errs.push('非預期的對話框：' + d.message()); d.dismiss() })
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && document.querySelector('.page.on'), null, { timeout: 40000 })
  await p.waitForSelector(wait, { timeout: 15000 })
  return p
}
const toastText = async (p) => { await p.waitForFunction(() => document.getElementById('toast').style.display === 'flex', null, { timeout: 6000 }); return p.innerText('#toast-msg') }
const inputsBox = (p) => p.innerText('#rs-inputs')
const waitList = (p, re) => p.waitForFunction((s) => new RegExp(s).test(document.getElementById('rs-inputs')?.innerText || ''), re.source, { timeout: 8000 })
const pick = (p, name, buf) => p.setInputFiles('#rs-file', { name, mimeType: 'application/octet-stream', buffer: buf })
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }) }
const calls = (method, re) => S.calls.filter((c) => c.method === method && re.test(c.path))

await check('列出：空清單、只讀自己的（帶登入權杖）、欄位不含上傳者', async () => {
  reset(); addFile({ name: 'a.md', bytes: 1536 }); addFile({ name: 'locked.pdf', mime: 'application/pdf', bytes: 3 * 1048576, locked: true })
  const p = await open(); await waitList(p, /a\.md/)
  const t = await inputsBox(p)
  must(/a\.md/.test(t) && /locked\.pdf/.test(t), '清單：' + t.slice(0, 160))
  must(/2 KB|1 KB|2\.0 KB/.test(t) || /KB/.test(t), '沒有檔案大小：' + t.slice(0, 160)); must(/SHA-256 [0-9a-f]{12}…/.test(t), '沒有 SHA-256 摘要'); must(/10\/28/.test(t), '沒有時間')
  must(!/u:1|createdBy|pipeline/.test(await p.content()), '畫面含上傳者資訊（createdBy）')
  must(calls('GET', /\/inputs$/).every((c) => c.auth === 'Bearer kps_mock_1'), '列清單沒帶登入權杖')
  must(/PDF、TXT、MD、CSV、XLSX、PNG、JPEG/.test(t) && /20 MiB/.test(t), '限制說明')
  const acc = await p.$eval('#rs-file', (x) => x.accept); must(['.pdf', '.txt', '.md', '.csv', '.xlsx', '.png', '.jpg', '.jpeg'].every((e) => acc.includes(e)) && !acc.includes('.docx'), 'accept：' + acc)
  await shot(p, 'inputs_list'); await p.context().close()
})
await check('空清單顯示「尚無參考檔」', async () => {
  reset(); const p = await open(); await waitList(p, /尚無參考檔/); await p.context().close()
})
await check('上傳：Content-Type 依副檔名、帶 SHA-256、本文是原始位元組、成功後清單出現', async () => {
  reset(); const p = await open(); await waitList(p, /尚無參考檔/)
  const body = Buffer.from('# 筆記\n參考內容 ' + 'x'.repeat(2000))
  await pick(p, 'note.md', body); await p.click('[data-pin-add]')
  const t = await toastText(p); must(/已加入 note\.md/.test(t), 'toast：' + t)
  await waitList(p, /note\.md/)
  const post = calls('POST', /\/inputs$/)[0]
  must(post, '沒有上傳請求'); must(post.auth === 'Bearer kps_mock_1', '上傳沒帶登入權杖')
  must(post.ct === 'text/markdown', 'Content-Type：' + post.ct); must(post.sha === sha(body), 'X-Content-SHA256 不符'); must(Buffer.compare(post.body, body) === 0, '本文不是原始位元組')
  must(decodeURIComponent(new URL('http://x' + post.path + post.qs).searchParams.get('name')) === 'note.md', '檔名參數：' + post.qs)
  must(/SHA-256 [0-9a-f]{12}…/.test(await inputsBox(p)), '清單沒有摘要')
  await p.context().close()
})
await check('下載：檔案內容與檔名正確（attachment）、使用登入權杖', async () => {
  reset(); const f = addFile({ name: 'data.csv', mime: 'text/csv', body: Buffer.from('a,b\n1,2\n'), bytes: 8 })
  const p = await open(); await waitList(p, /data\.csv/)
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click(`[data-pin-dl="${f.id}"]`)])
  must(dl.suggestedFilename() === 'data.csv', '檔名：' + dl.suggestedFilename())
  const path = await dl.path(); const fs = await import('node:fs'); must(fs.readFileSync(path, 'utf8') === 'a,b\n1,2\n', '下載內容不符')
  must(calls('GET', /\/inputs\/in\d+$/)[0].auth === 'Bearer kps_mock_1', '下載沒帶登入權杖')
  await p.context().close()
})
await check('刪除：先確認；取消不送出；確認後刪除並更新清單', async () => {
  reset(); const f = addFile({ name: 'del.txt', mime: 'text/plain' })
  const p = await open(); await waitList(p, /del\.txt/)
  confirmAnswer = false; await p.click(`[data-pin-rm="${f.id}"]`); await p.waitForTimeout(500)
  must(/del\.txt/.test(p.__confirm || '') && /無法復原/.test(p.__confirm || ''), '確認訊息：' + p.__confirm); must(!calls('DELETE', /./).length, '取消後仍送出刪除')
  confirmAnswer = true; await p.click(`[data-pin-rm="${f.id}"]`)
  const t = await toastText(p); must(/已刪除 del\.txt/.test(t), 'toast：' + t)
  await waitList(p, /尚無參考檔/); must(calls('DELETE', /\/inputs\/in\d+$/).length === 1, '刪除請求數'); await p.context().close()
})
await check('locked：刪除鈕停用、有說明；就算按了也不送出；伺服器回 INPUT_LOCKED 顯示訊息', async () => {
  reset(); const f = addFile({ name: 'used.pdf', mime: 'application/pdf', locked: true })
  const p = await open(); await waitList(p, /used\.pdf/)
  must(await p.isDisabled(`[data-pin-rm="${f.id}"]`), '刪除鈕應停用'); must(/已鎖定/.test(await inputsBox(p)), '沒有「已鎖定」標示')
  must(/報告引用/.test(await p.$eval(`[data-pin-rm="${f.id}"]`, (x) => x.title)), '停用沒有說明')
  await p.evaluate((id) => document.querySelector(`[data-pin-rm="${id}"]`).dispatchEvent(new MouseEvent('click', { bubbles: true })), f.id); await p.waitForTimeout(400)
  must(!calls('DELETE', /./).length, 'locked 仍送出刪除'); await p.context().close()
  // 清單說沒鎖、刪除時才被報告引用
  reset(); const g = addFile({ name: 'race.txt', mime: 'text/plain' }); S.deleteFail = [409, 'INPUT_LOCKED']
  const q = await open(); await waitList(q, /race\.txt/); await q.click(`[data-pin-rm="${g.id}"]`)
  const t = await toastText(q); must(/已被報告引用，不能刪除/.test(t), 'toast：' + t); await q.context().close()
})
await check('前端先擋：不支援的副檔名、超過 20 MiB，都不送出請求', async () => {
  reset(); const p = await open(); await waitList(p, /尚無參考檔/)
  await pick(p, 'run.exe', Buffer.from('MZ')); await p.click('[data-pin-add]'); must(/不支援的檔案類型：\.exe/.test(await toastText(p)), '.exe')
  await p.waitForFunction(() => document.getElementById('toast').style.display !== 'flex', null, { timeout: 8000 }).catch(() => {})
  await pick(p, 'big.pdf', Buffer.alloc(20 * 1048576 + 1, 1)); await p.click('[data-pin-add]'); must(/超過單檔 20 MiB/.test(await toastText(p)), '超大')
  await p.click('[data-pin-add]').catch(() => {})
  must(!calls('POST', /./).length, '被擋的檔案仍送出了上傳'); await p.context().close()
})
await check('沒選檔案就按加入：提示先選檔案', async () => {
  reset(); const p = await open(); await waitList(p, /尚無參考檔/); await p.click('[data-pin-add]')
  must(/請先選擇檔案/.test(await toastText(p)), 'toast'); must(!calls('POST', /./).length, '送出了空上傳'); await p.context().close()
})
for (const [status, code, re, label] of [
  [415, 'UNSUPPORTED_TYPE', /不支援的檔案類型或內容/, 'UNSUPPORTED_TYPE'],
  [413, 'TOO_LARGE', /超過單檔 20 MiB/, 'TOO_LARGE'],
  [413, 'QUOTA_EXCEEDED', /已達上限（每人最多 50 個或 200 MiB）/, 'QUOTA_EXCEEDED'],
  [400, 'CHECKSUM_MISMATCH', /傳輸時損毀，請重新上傳/, 'CHECKSUM_MISMATCH'],
  [429, 'RATE_LIMITED', /請求太頻繁/, '429'],
  [500, 'INTERNAL', /操作失敗（500）/, '其他錯誤'],
]) {
  await check(`上傳錯誤 ${label}：顯示對應訊息、清單不變、頁面不當掉`, async () => {
    reset(); S.postFail = [status, code]; const p = await open(); await waitList(p, /尚無參考檔/)
    await pick(p, 'ok.txt', Buffer.from('hi')); await p.click('[data-pin-add]')
    const t = await toastText(p); must(re.test(t), 'toast：' + t)
    await waitList(p, /尚無參考檔/); must(!(await p.isDisabled('[data-pin-add]')), '上傳鈕卡在上傳中')
    await p.context().close()
  })
}
await check('404：下載、刪除一個已不存在的檔案 → 「找不到」並重新整理清單', async () => {
  reset(); const f = addFile({ name: 'gone.txt', mime: 'text/plain' })
  const p = await open(); await waitList(p, /gone\.txt/)
  S.files = [] // 別的裝置已刪除
  await p.click(`[data-pin-dl="${f.id}"]`); must(/找不到這個檔案/.test(await toastText(p)), '下載 404 訊息')
  await waitList(p, /尚無參考檔/); await p.context().close()
  reset(); const g = addFile({ name: 'gone2.txt', mime: 'text/plain' })
  const q = await open(); await waitList(q, /gone2\.txt/); S.files = []
  await q.click(`[data-pin-rm="${g.id}"]`); must(/找不到這個檔案/.test(await toastText(q)), '刪除 404 訊息'); await waitList(q, /尚無參考檔/); await q.context().close()
})
await check('讀清單失敗（500）：顯示錯誤與重試；重試後恢復', async () => {
  reset(); S.listFail = [500, 'INTERNAL']; addFile({ name: 'back.md' })
  const p = await open(); await waitList(p, /操作失敗（500）/)
  S.listFail = null; await p.click('[data-pin-retry]'); await waitList(p, /back\.md/); await p.context().close()
})
await check('登入過期（401）：清單請求被拒時回到登入畫面，不顯示清單內容、無 JS 錯誤', async () => {
  reset(); addFile({ name: 'secret.md' })
  const p = await open({ width: 1280, height: 900 }, '#/watch', '.page.on')
  S.listFail = [401, 'UNAUTHENTICATED']
  await p.evaluate(() => { location.hash = '#/report-settings' })
  await p.waitForSelector('#kp-gate', { timeout: 10000 }) // starter 收到 401 會清掉登入，閘門把頁面收回登入畫面
  must(!/secret\.md/.test(await p.content()), '登入畫面出現清單內容'); await p.context().close()
})
await check('檔名含惡意字串：只當文字顯示（跳脫），不執行', async () => {
  reset(); addFile({ name: 'x' + XSS + '.md' })
  const p = await open(); await waitList(p, /onerror/)
  const r = await p.evaluate(() => ({ x: window.__xss || null, imgs: document.querySelectorAll('#rs-inputs img').length })); must(!r.x && r.imgs === 0, '注入被執行：' + JSON.stringify(r)); await p.context().close()
})
await check('換帳號：登出再登入另一個帳號，看不到上一位的參考檔（後端只回自己的）', async () => {
  reset(); addFile({ name: 'mine.md' })
  const p = await open(); await waitList(p, /mine\.md/)
  await p.click('[data-acct]'); await p.click('[data-acct-logout]'); await p.waitForSelector('#kp-gate', { timeout: 10000 })
  await gateLogin(p, 'other-user'); await p.waitForFunction(() => document.getElementById('loading')?.hidden && document.querySelector('.page.on'), null, { timeout: 30000 })
  // 登出會清掉這個瀏覽器的本機自選；新帳號的雲端也是空的，所以自己加一家再看報告設定
  await p.evaluate((w) => { localStorage.setItem('kupei3_watch', w); location.hash = '#/report-settings' }, SEED.kupei3_watch); await p.reload()
  await p.waitForSelector('#rs-inputs', { timeout: 20000 }); await waitList(p, /尚無參考檔/)
  must(!/mine\.md/.test(await p.content()), '換帳號後仍看到上一位的檔案')
  const g = calls('GET', /\/inputs$/).map((c) => c.auth); must(g.includes('Bearer kps_other-user'), '沒有用新帳號的權杖重讀：' + g.join(','))
  await p.context().close()
})
await check('手機寬度（iPhone 14）：長檔名不橫向捲動、輸入框 ≥16px、按鈕可點', async () => {
  reset(); addFile({ name: '很長很長的檔名'.repeat(8) + '.pdf', mime: 'application/pdf', bytes: 5 * 1048576 }); addFile({ name: 'b.md', locked: true })
  const p = await open({ width: 390, height: 844 }); await waitList(p, /b\.md/); await p.waitForTimeout(500)
  const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, fs: parseFloat(getComputedStyle(document.getElementById('rs-file')).fontSize), btn: [...document.querySelectorAll('#rs-inputs button')].map((e) => Math.round(e.getBoundingClientRect().height)) }))
  must(m.sw <= m.iw, `橫向捲動 ${m.sw} > ${m.iw}`); must(m.fs >= 16, '檔案輸入字級 ' + m.fs); must(m.btn.every((h) => h >= 26), '按鈕太矮 ' + m.btn)
  await shot(p, 'inputs_mobile'); await p.context().close()
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
