// FinMind 盤中價（登入後每 30 秒，/api/market/live）與退回證交所 MIS 快照。後端端點全部用假的回應，不打線上、不建立帳號。
// 用 starter 的 kupei.marketLive()（2026-10-28 已同步），dev server 或建置後的 preview 都可以跑。
// BASE=http://127.0.0.1:5401/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_finmind.mjs（SHOTS=<資料夾> 另存 kp-live-*.png）
import { chromium } from 'playwright'
import { routeBackend, seedSession, CORS } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const SHOTS = process.env.SHOTS || ''
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }

const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const MIS = {
  phase: 'OPEN', stale: false, ttlSeconds: 300,
  markets: { L: { at: `${TODAY}T10:15:00+08:00`, receivedAt: `${TODAY}T02:15:20Z`, source: 'twse' }, O: { at: `${TODAY}T10:14:00+08:00`, receivedAt: `${TODAY}T02:14:30Z`, source: 'tpex' } },
  quotes: { 2330: [1234.5, 12.5, 12345000, '10:15:00'] },
}
const LIVE = (hms = '10:20:30', price = 1500, extra = {}) => ({
  source: 'finmind', phase: 'OPEN', at: `${TODAY}T${hms}+08:00`, fetchedAt: new Date().toISOString(), stale: false, intervalSeconds: 30,
  quotes: { 2330: [price, 20, 9999000, hms], 2317: [null, null, null, hms] }, ...extra,
})
/* 假的後端狀態：live 是物件＝200；{ status, code, retryAfter } ＝錯誤 */
const M = { live: LIVE(), intraday: MIS, calls: [] }
const liveCalls = () => M.calls.filter((c) => c === 'live').length
const misCalls = () => M.calls.filter((c) => c === 'intraday').length

async function open(hash = '', { clock = true, vp = { width: 1280, height: 900 }, seed = {} } = {}) {
  const ctx = await b.newContext({ viewport: vp })
  await routeBackend(ctx)
  await seedSession(ctx, 't-user', { kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330', '2317'] }], cur: 1 }), ...seed })
  await ctx.route(/\/api\/market\/(intraday|live)(\?|$)/, (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const live = new URL(r.url()).pathname.endsWith('/live')
    M.calls.push(live ? 'live' : 'intraday')
    if (!/^Bearer kps_/.test(r.headers().authorization || '')) return route.fulfill({ status: 401, headers: CORS, body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '需要登入' } }) })
    if (!live) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(M.intraday) })
    const x = M.live
    if (x.status) {
      const headers = { ...CORS, 'access-control-expose-headers': 'Retry-After', ...(x.retryAfter ? { 'retry-after': String(x.retryAfter) } : {}) }
      return route.fulfill({ status: x.status, headers, body: JSON.stringify({ error: { code: x.code, message: x.code } }) })
    }
    return route.fulfill({ status: 200, headers: { ...CORS, 'cache-control': 'private, no-store' }, body: JSON.stringify(x) })
  })
  await ctx.route(/\/api\/(news|reports)/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } }) }))
  const p = await ctx.newPage()
  if (clock) await p.clock.install()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && /\S/.test(document.getElementById('h-upd')?.textContent || '') && document.querySelector('.page.on'), null, { timeout: 40000 })
  await p.waitForTimeout(800)
  return p
}
const go = async (p, h, ms = 1200) => { await p.evaluate((x) => { location.hash = x }, h); await p.waitForTimeout(ms) }
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }) }
const upd = (p) => p.innerText('#h-upd')
const ff = async (p, ms) => { await p.clock.fastForward(ms); await p.waitForTimeout(900) }
const setVisible = (p, vis) => p.evaluate((v) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'visible' : 'hidden') })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !v })
  document.dispatchEvent(new Event('visibilitychange'))
}, vis)
const priceOf = (p, id) => p.$eval(`#h-body td[data-q="${id}"]`, (td) => td.innerText)

await check('有 FinMind（stale=false）：價格用 FinMind、標示「FinMind・HH:MM:SS」、狀態列／頁尾／說明列「資料來源：FinMind」', async () => {
  M.live = LIVE(); M.intraday = MIS; M.calls = []
  const p = await open('#/stock/2330/home')
  const lbl = await upd(p)
  must(lbl.includes('FinMind・10:20:30') && lbl.includes('資料來源：FinMind'), '標示：' + lbl)
  must(!/證交所/.test(lbl), 'FinMind 時不該標證交所')
  const card = await p.innerText('#s-valcard'); must(card.includes('1,500') && !card.includes('1,234.5'), '個股價格不是 FinMind：' + card.slice(0, 160))
  must(/FinMind・10:20:30/.test(await p.innerText('#s-vbase')), '個股基準列：' + await p.innerText('#s-vbase'))
  await go(p, '#/stock/2317/home'); must((await p.innerText('#s-val .v')).trim() === '—', 'FinMind 價格 null 應顯示「—」')
  await go(p, '')
  must((await priceOf(p, '2330')).includes('1,500'), '首頁價格：' + await priceOf(p, '2330'))
  must(/資料來源：FinMind/.test(await p.innerText('#h-banner')), '說明列：' + await p.innerText('#h-banner'))
  must(/資料來源：FinMind/.test(await p.$eval('#h-mfoot', (e) => e.textContent)), '頁尾沒有資料來源')
  must(await p.isHidden('#h-alert'), '不該有延遲警示')
  await go(p, '#/status'); must(/FinMind/.test(await p.innerText('#st-src')), '狀態頁沒有標示 FinMind')
  await go(p, ''); await shot(p, 'kp-live-finmind')
  const r = `${lbl}｜live ${liveCalls()} 次`
  await p.context().close(); return r
})

await check('每 30 秒更新一次、只換價格格（首頁與自選頁的列不重建）', async () => {
  M.live = LIVE(); M.calls = []
  const p = await open('')
  await p.evaluate(() => { document.querySelector('#h-body tr').dataset.mark = '1'; document.querySelector('#h-body td[data-q="2330"]').dataset.mark = '1' })
  const n0 = liveCalls()
  M.live = LIVE('10:21:00', 1510)
  await ff(p, 15000); must(liveCalls() === n0, `15 秒內不該再讀（${n0} → ${liveCalls()}）`)
  await ff(p, 15500)
  must(liveCalls() === n0 + 1, `30 秒後應讀 1 次（${n0} → ${liveCalls()}）`)
  must((await upd(p)).includes('FinMind・10:21:00'), '標示沒更新：' + await upd(p))
  must((await priceOf(p, '2330')).includes('1,510'), '價格沒更新：' + await priceOf(p, '2330'))
  must(await p.evaluate(() => document.querySelector('#h-body tr').dataset.mark === '1' && document.querySelector('#h-body td[data-q="2330"]').dataset.mark === '1'), '首頁列被重建（整表重畫）')
  // 自選頁
  await go(p, '#/watch')
  must((await p.innerText('#w-body td[data-wq="2330"]')).includes('1,510'), '自選頁價格：' + await p.innerText('#w-body td[data-wq="2330"]'))
  await p.evaluate(() => { document.getElementById('wr-2330').dataset.mark = '1' })
  M.live = LIVE('10:21:30', 1520)
  await ff(p, 30500)
  must((await p.innerText('#w-body td[data-wq="2330"]')).includes('1,520'), '自選頁價格沒更新')
  must(await p.evaluate(() => document.getElementById('wr-2330')?.dataset.mark === '1'), '自選頁列被重建（整頁重畫）')
  must(/FinMind/.test(await p.innerText('#w-legend3')), '自選頁說明：' + await p.innerText('#w-legend3'))
  const r = `live ${n0} → ${liveCalls()}`
  await p.context().close(); return r
})

await check('stale=true → 退回證交所 MIS、標「證交所・約 10 分鐘延遲・HH:MM」；FinMind 恢復後自動切回', async () => {
  M.live = LIVE('10:20:30', 1500, { stale: true }); M.calls = []
  const p = await open('')
  const lbl = await upd(p)
  must(lbl.includes('證交所・約 10 分鐘延遲・10:15') && !/FinMind/.test(lbl), '標示：' + lbl)
  must((await priceOf(p, '2330')).includes('1,234.5'), 'stale 應用 MIS 價格：' + await priceOf(p, '2330'))
  must(!/FinMind/.test(await p.innerText('#h-banner')), '說明列不該把 MIS 標成 FinMind')
  must(misCalls() >= 1, '沒有讀 MIS 快照')
  await shot(p, 'kp-live-mis')
  M.live = LIVE('10:21:00', 1510)
  await ff(p, 30500)
  const l2 = await upd(p); must(l2.includes('FinMind・10:21:00'), '恢復後沒切回 FinMind：' + l2)
  must((await priceOf(p, '2330')).includes('1,510'), '恢復後價格：' + await priceOf(p, '2330'))
  await p.context().close(); return `${lbl} → ${l2}`
})

await check('503 LIVE_UNAVAILABLE → MIS；連續失敗間隔加倍（30→60 秒），不加快', async () => {
  M.live = { status: 503, code: 'LIVE_UNAVAILABLE' }; M.calls = []
  const p = await open('')
  must((await upd(p)).includes('證交所・約 10 分鐘延遲'), '標示：' + await upd(p))
  const n0 = liveCalls(); must(n0 === 1, '開頁面應讀 1 次：' + n0)
  await ff(p, 30500); const n1 = liveCalls(); must(n1 === 2, '第 1 次失敗後 30 秒重試：' + n1)
  await ff(p, 30500); must(liveCalls() === 2, '第 2 次失敗後 30 秒不該重試：' + liveCalls())
  await ff(p, 30500); const n2 = liveCalls(); must(n2 === 3, '第 2 次失敗後 60 秒重試：' + n2)
  await ff(p, 90500); must(liveCalls() === 3, '第 3 次失敗後 90 秒不該重試：' + liveCalls())
  await ff(p, 30500); must(liveCalls() === 4, '第 3 次失敗後 120 秒重試：' + liveCalls())
  M.live = LIVE('10:30:00', 1600)
  await ff(p, 240500); must((await upd(p)).includes('FinMind・10:30:00'), '恢復後沒切回：' + await upd(p))
  await p.context().close(); return '1→2→3→4→恢復'
})

await check('429 → 依 Retry-After（120 秒）退避', async () => {
  M.live = { status: 429, code: 'RATE_LIMITED', retryAfter: 120 }; M.calls = []
  const p = await open('')
  must(liveCalls() === 1, '開頁面應讀 1 次：' + liveCalls())
  await ff(p, 61000); must(liveCalls() === 2, 'starter 依 Retry-After（最多 60 秒）重試 1 次：' + liveCalls())
  await ff(p, 100000); must(liveCalls() === 2, 'Retry-After 120 秒內不該再讀：' + liveCalls())
  must((await upd(p)).includes('證交所'), '限流時應退回 MIS：' + await upd(p))
  M.live = LIVE('10:40:00', 1700)
  await ff(p, 21000); must(liveCalls() === 3, '120 秒後應再讀：' + liveCalls())
  must((await upd(p)).includes('FinMind・10:40:00'), '恢復後：' + await upd(p))
  await p.context().close(); return 'ok'
})

await check('分頁隱藏不輪詢、回來立刻補一次', async () => {
  M.live = LIVE(); M.calls = []
  const p = await open('')
  const n0 = liveCalls()
  await setVisible(p, false)
  await ff(p, 30500); await ff(p, 30500); await ff(p, 30500)
  must(liveCalls() === n0, `隱藏時不該讀（${n0} → ${liveCalls()}）`)
  M.live = LIVE('10:25:00', 1550)
  await setVisible(p, true); await p.waitForTimeout(1200)
  must(liveCalls() === n0 + 1, `回到分頁應立刻讀 1 次（${n0} → ${liveCalls()}）`)
  must((await upd(p)).includes('FinMind・10:25:00'), '回來後標示：' + await upd(p))
  await ff(p, 30500); must(liveCalls() === n0 + 2, '之後照 30 秒繼續：' + liveCalls())
  await p.context().close(); return `${n0} → ${liveCalls()}`
})

await check('PRE／CLOSED：停止 30 秒輪詢、改 10 分鐘檢查一次，畫面不用 FinMind', async () => {
  M.live = LIVE('13:30:00', 1500, { phase: 'CLOSED' }); M.intraday = { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }; M.calls = []
  const p = await open('')
  must(/收盤價/.test(await upd(p)) && !/FinMind・/.test(await upd(p)), '收盤標示：' + await upd(p))
  const n0 = liveCalls()
  await ff(p, 300000); must(liveCalls() === n0, '收盤後 5 分鐘內不該再讀：' + liveCalls())
  await ff(p, 301000); must(liveCalls() === n0 + 1, '10 分鐘後檢查 1 次：' + liveCalls())
  M.intraday = MIS
  await p.context().close(); return `${n0} → ${liveCalls()}`
})

await check('登出：停止輪詢、FinMind 資料清掉（回到登入畫面）', async () => {
  M.live = LIVE(); M.calls = []
  const p = await open('')
  must((await upd(p)).includes('FinMind'), '登入時應有 FinMind')
  await p.click('[data-acct]'); await p.click('[data-acct-logout]')
  await p.waitForSelector('#kp-gate #acct-user', { timeout: 20000 })
  const n0 = liveCalls()
  await ff(p, 30500); await ff(p, 30500); await ff(p, 30500)
  must(liveCalls() === n0, `登出後不該再讀（${n0} → ${liveCalls()}）`)
  must(!(await p.evaluate(() => document.body.innerText)).includes('FinMind・'), '登出後畫面還有 FinMind 資料')
  await p.context().close(); return `live ${n0}`
})

await check('登入失效（live 回 401）：回到登入畫面、不再輪詢', async () => {
  M.live = LIVE(); M.calls = []
  const p = await open('')
  M.live = { status: 401, code: 'UNAUTHENTICATED' }
  await ff(p, 30500)
  await p.waitForSelector('#kp-gate #acct-user', { timeout: 20000 })
  const n0 = liveCalls()
  await ff(p, 30500); await ff(p, 30500)
  must(liveCalls() === n0, `失效後不該再讀（${n0} → ${liveCalls()}）`)
  await p.context().close(); return `live ${n0}`
})

await check('後端沒有 /api/market/live（404）：這次開頁面不再問、照舊顯示證交所 MIS', async () => {
  M.live = { status: 404, code: 'NOT_FOUND' }; M.intraday = MIS; M.calls = []
  const p = await open('')
  const n0 = liveCalls()
  must(n0 <= 1, '最多問一次：' + n0)
  must((await upd(p)).includes('證交所・約 10 分鐘延遲・10:15'), '標示：' + await upd(p))
  await ff(p, 60500); must(liveCalls() === n0, '之後不該再問：' + liveCalls())
  await p.context().close(); return 'ok'
})

await check('手機 390 寬：FinMind 標示與頁尾來源、不橫向捲動', async () => {
  M.live = LIVE(); M.calls = []
  const p = await open('', { vp: { width: 390, height: 844 } })
  must((await upd(p)).includes('FinMind・10:20:30'), '標示：' + await upd(p))
  must(/資料來源：FinMind/.test(await p.innerText('#h-mfoot')), '手機頁尾：' + await p.innerText('#h-mfoot'))
  must(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '橫向捲動')
  await shot(p, 'kp-live-finmind-390')
  await p.context().close(); return 'ok'
})

await b.close()
for (const r of results) console.log(r[0], r[1], r[2] ? '｜' + r[2] : '')
if (errs.length) console.log('錯誤：\n' + [...new Set(errs)].join('\n'))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - fail}/${results.length} 通過`)
process.exit(fail || errs.length ? 1 : 0)
