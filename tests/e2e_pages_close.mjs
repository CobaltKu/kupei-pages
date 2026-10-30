// 收盤後 FinMind 收盤快照與正式收盤切換（MARKET-05）。/api/market/live、/api/market/latest 全部用假的回應＋Playwright 假時鐘，不打線上、不建立帳號。
// 後端契約：phase=CLOSED 且快照是今天 → 200、stale:false、closing:true、officialClose:{ L, O }（該市場每日收盤是否已是快照那天）。
// BASE=http://localhost:5421/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_close.mjs（SHOTS=<資料夾> 另存 kp-close-*.png）
import { chromium } from 'playwright'
import { routeBackend, seedSession, CORS, FIXTURE } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const SHOTS = process.env.SHOTS || ''
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }

/* 固定的交易日：今天 10/30（台灣時間），前一交易日 10/29 */
const TODAY = '2026-10-30', YDAY = '2026-10-29'
const at = (hm) => new Date(`${TODAY}T${hm}+08:00`)
/* 前一交易日的每日收盤（fixture 的價格，日期改成 10/29）：2330 收 1,552、5274 收 3,985 */
const LATEST_Y = { ...FIXTURE.latest, dates: { L: YDAY, O: YDAY }, source: { L: 'finmind', O: 'finmind' } }
/* FinMind 快照（今天）：2330 1,565（漲 13，昨收 1,552）、5274 4,000（漲 15，昨收 3,985） */
const SNAP = (hms) => ({ 2330: [1565, 13, 30000000, hms], 5274: [4000, 15, 2000000, hms], 2317: [640, 5.14, 12000000, hms] })
/* 今天的正式收盤（與快照差一點，看得出有切換）：上市 2330 1,566、上櫃 5274 4,002 */
const offL = { 2330: [1566, 14, 30500000], 2317: [641, 6.14, 12100000] }
const offO = { 5274: [4002, 17, 2100000] }
const latestWith = ({ L = false, O = false }) => ({
  ...LATEST_Y, dates: { L: L ? TODAY : YDAY, O: O ? TODAY : YDAY },
  quotes: { ...LATEST_Y.quotes, ...(L ? offL : {}), ...(O ? offO : {}) },
})
const OPEN = (hms) => ({ source: 'finmind', phase: 'OPEN', at: `${TODAY}T${hms}+08:00`, fetchedAt: new Date().toISOString(), stale: false, intervalSeconds: 30, quotes: SNAP(hms) })
const CLOSING = (L, O, hms = '13:30:00', extra = {}) => ({
  source: 'finmind', phase: 'CLOSED', at: `${TODAY}T${hms}+08:00`, fetchedAt: new Date().toISOString(), stale: false, intervalSeconds: 30,
  closing: true, officialClose: { L, O }, quotes: SNAP(hms), ...extra,
})
/* 舊後端：CLOSED 沒有 closing／officialClose */
const OLD_CLOSED = () => { const x = CLOSING(false, false); delete x.closing; delete x.officialClose; return x }
const MIS_CLOSED = { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }

const M = { live: OPEN('13:28:55'), latest: LATEST_Y, calls: [] }
const n = (k) => M.calls.filter((c) => c === k).length

async function open(time, hash = '', { vp = { width: 1280, height: 900 } } = {}) {
  const ctx = await b.newContext({ viewport: vp })
  await routeBackend(ctx)
  await seedSession(ctx, 't-user', { kupei3_watch: JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330', '5274'] }], cur: 1 }) })
  await ctx.route(/\/api\/market\/(intraday|live|latest)(\?|$)/, (route) => {
    const r = route.request()
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const k = new URL(r.url()).pathname.split('/').pop()
    M.calls.push(k)
    if (!/^Bearer kps_/.test(r.headers().authorization || '')) return route.fulfill({ status: 401, headers: CORS, body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '需要登入' } }) })
    if (k === 'intraday') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(MIS_CLOSED) })
    if (k === 'latest') return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(M.latest) })
    const x = M.live
    if (x.status) return route.fulfill({ status: x.status, headers: CORS, body: JSON.stringify({ error: { code: x.code, message: x.code } }) })
    return route.fulfill({ status: 200, headers: { ...CORS, 'cache-control': 'private, no-store' }, body: JSON.stringify(x) })
  })
  await ctx.route(/\/api\/(news|reports)/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } }) }))
  const p = await ctx.newPage()
  await p.clock.install({ time })
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
const priceOf = (p, id) => p.$eval(`#h-body td[data-q="${id}"]`, (td) => td.innerText)
/** 記下狀態列與兩檔價格每一次變動（看轉場中間有沒有閃過前一天的價格、或一半新一半舊） */
const watch = (p) => p.evaluate(() => {
  window.__seen = []
  const rec = () => {
    const q = (id) => document.querySelector(`#h-body td[data-q="${id}"]`)?.innerText || ''
    window.__seen.push({ upd: document.getElementById('h-upd')?.innerText || '', a: q('2330'), b: q('5274') })
  }
  rec()
  new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, characterData: true })
})
const seen = (p) => p.evaluate(() => window.__seen)

await check('① 13:29 OPEN → 13:30 CLOSED（latest 還是 10/29）：顯示 10/30 FinMind 收盤快照與「正式收盤待更新」，不出現前一天的價格', async () => {
  M.live = OPEN('13:28:55'); M.latest = LATEST_Y; M.calls = []
  const p = await open(at('13:29:00'))
  must((await upd(p)).includes('FinMind・13:28:55'), '盤中標示：' + await upd(p))
  must((await priceOf(p, '2330')).includes('1,565'), '盤中價格：' + await priceOf(p, '2330'))
  await watch(p)
  M.live = CLOSING(false, false)
  await ff(p, 30500)
  const lbl = await upd(p)
  must(lbl.includes('10/30 FinMind 收盤快照・正式收盤待更新') && lbl.includes('資料來源：FinMind'), '收盤快照標示：' + lbl)
  must(!lbl.includes('10/29') && !lbl.includes('⚠'), '不該標前一天或延遲：' + lbl)
  must((await priceOf(p, '2330')).includes('1,565') && (await priceOf(p, '5274')).includes('4,000'), '價格應是快照：' + await priceOf(p, '2330') + '／' + await priceOf(p, '5274'))
  const s = await seen(p)
  const bad = s.find((x) => /1,552|3,985/.test(x.a + x.b) || /收盤價 10\/29/.test(x.upd))
  must(!bad, '轉場中間出現前一天的價格或標示：' + JSON.stringify(bad))
  must(await p.isHidden('#h-alert'), '15:30 前不該有延遲警示')
  must(/FinMind 收盤快照/.test(await p.innerText('#h-banner')), '說明列：' + await p.innerText('#h-banner'))
  await go(p, '#/stock/2330/home')
  must((await p.innerText('#s-valcard')).includes('1,565'), '個股價格：' + (await p.innerText('#s-valcard')).slice(0, 120))
  must(/正式收盤待更新/.test(await p.innerText('#s-vbase')), '個股基準列：' + await p.innerText('#s-vbase'))
  await go(p, '#/watch')
  must((await p.innerText('#w-body td[data-wq="5274"]')).includes('4,000'), '自選頁價格：' + await p.innerText('#w-body td[data-wq="5274"]'))
  await go(p, '')
  await shot(p, 'kp-close-pending')
  // 每 5 分鐘重讀 live
  const n0 = n('live')
  await ff(p, 250000); must(n('live') === n0, `5 分鐘內不該再讀（${n0} → ${n('live')}）`)
  await ff(p, 51000); must(n('live') === n0 + 1, `5 分鐘後應讀 1 次（${n0} → ${n('live')}）`)
  must((await upd(p)).includes('正式收盤待更新'), '還沒更新時維持快照：' + await upd(p))
  // ② officialClose 變 true、latest 推進到 10/30 → 切換成正式收盤、標示消失
  await watch(p)
  M.latest = latestWith({ L: true, O: true }); M.live = CLOSING(true, true)
  const l0 = n('latest')
  await ff(p, 300500)
  const l2 = await upd(p)
  must(l2.includes('收盤價 10/30') && !/待更新|FinMind 收盤快照/.test(l2), '正式收盤標示：' + l2)
  must((await priceOf(p, '2330')).includes('1,566') && (await priceOf(p, '5274')).includes('4,002'), '價格應是正式收盤：' + await priceOf(p, '2330') + '／' + await priceOf(p, '5274'))
  must(n('latest') > l0, '沒有重讀 latest')
  const s2 = await seen(p)
  const half = s2.find((x) => (x.a.includes('1,566') && x.b.includes('4,000')) || (x.a.includes('1,565') && x.b.includes('4,002')) || /1,552|3,985/.test(x.a + x.b))
  must(!half, '切換不是一次換完：' + JSON.stringify(half))
  await shot(p, 'kp-close-official')
  // 全部 true 後停止 5 分鐘重讀（回到收盤後 10 分鐘檢查）
  const n1 = n('live')
  await ff(p, 300500); must(n('live') === n1, `正式收盤後 5 分鐘不該再讀（${n1} → ${n('live')}）`)
  await ff(p, 300500); must(n('live') === n1 + 1, `之後照 10 分鐘檢查（${n1} → ${n('live')}）`)
  must((await upd(p)).includes('收盤價 10/30'), '維持正式收盤：' + await upd(p))
  await p.context().close(); return `${lbl} → ${l2}`
})

await check('混合：上市已更新、上櫃未更新 → 上市個股用正式收盤、上櫃個股用快照；上櫃到了再切換', async () => {
  M.live = CLOSING(true, false, '13:30:00'); M.latest = latestWith({ L: true }); M.calls = []
  const p = await open(at('14:52:00'))
  const lbl = await upd(p)
  must(lbl.includes('上市 收盤價 10/30') && lbl.includes('上櫃 10/30 FinMind 收盤快照・正式收盤待更新'), '混合標示：' + lbl)
  must((await priceOf(p, '2330')).includes('1,566'), '上市 2330 應是正式收盤 1,566：' + await priceOf(p, '2330'))
  must((await priceOf(p, '2317')).includes('641'), '上市 2317 應是正式收盤 641：' + await priceOf(p, '2317'))
  must((await priceOf(p, '5274')).includes('4,000'), '上櫃 5274 應是快照 4,000：' + await priceOf(p, '5274'))
  await shot(p, 'kp-close-mixed')
  M.live = CLOSING(true, true); M.latest = latestWith({ L: true, O: true })
  await ff(p, 300500)
  const l2 = await upd(p)
  must(l2.includes('收盤價 10/30') && !/待更新/.test(l2), '上櫃到了之後：' + l2)
  must((await priceOf(p, '5274')).includes('4,002'), '上櫃 5274 應換成正式收盤：' + await priceOf(p, '5274'))
  await p.context().close(); return `${lbl} → ${l2}`
})

await check('officialClose 已是 true、但 latest 還是舊的：維持快照，約 65 秒後再讀，日期到了才切換', async () => {
  M.live = CLOSING(false, false); M.latest = LATEST_Y; M.calls = []
  const p = await open(at('14:40:00'))
  must((await upd(p)).includes('正式收盤待更新'), '標示：' + await upd(p))
  M.live = CLOSING(true, true) // 後端說到了，但 latest 還沒推進（快取）
  await ff(p, 300500)
  must((await upd(p)).includes('正式收盤待更新') && (await priceOf(p, '2330')).includes('1,565'), 'latest 還是舊的就不該切換：' + await upd(p))
  const n0 = n('live')
  M.latest = latestWith({ L: true, O: true })
  await ff(p, 66000)
  must(n('live') === n0 + 1, `65 秒後應再讀（${n0} → ${n('live')}）`)
  must((await upd(p)).includes('收盤價 10/30') && (await priceOf(p, '2330')).includes('1,566'), '日期到了應切換：' + await upd(p))
  await p.context().close(); return 'ok'
})

await check('15:30 後仍未更新：狀態列「⚠ 正式收盤延遲」、仍顯示快照（不退回前一交易日）', async () => {
  M.live = CLOSING(false, false); M.latest = LATEST_Y; M.calls = []
  const p = await open(at('15:29:00'))
  must(!(await upd(p)).includes('⚠'), '15:30 前不該有延遲：' + await upd(p))
  await ff(p, 65000) // 計時器會在 15:30 叫醒
  const lbl = await upd(p)
  must(lbl.includes('⚠ 正式收盤延遲') && lbl.includes('10/30 FinMind 收盤快照・正式收盤待更新'), '延遲標示：' + lbl)
  must((await priceOf(p, '2330')).includes('1,565'), '延遲時仍用快照：' + await priceOf(p, '2330'))
  must(await p.isVisible('#h-alert') && /正式收盤延遲/.test(await p.innerText('#h-alert')), '警示列：' + await p.innerText('#h-alert'))
  await shot(p, 'kp-close-late')
  await p.context().close()
  // 直接在 15:40 打開，上市已到、上櫃未到：只警告上櫃
  M.live = CLOSING(true, false); M.latest = latestWith({ L: true })
  const q = await open(at('15:40:00'))
  const l2 = await upd(q)
  must(l2.includes('⚠ 正式收盤延遲') && l2.includes('上櫃 10/30 FinMind 收盤快照'), '15:40 混合：' + l2)
  must(/上櫃每日收盤仍未更新/.test(await q.innerText('#h-alert')), '警示列：' + await q.innerText('#h-alert'))
  await q.context().close(); return `${lbl}｜${l2}`
})

await check('收盤快照期間 live 暫時 503：維持快照、不退回前一交易日，5 分鐘後再讀', async () => {
  M.live = CLOSING(false, false); M.latest = LATEST_Y; M.calls = []
  const p = await open(at('14:00:00'))
  M.live = { status: 503, code: 'LIVE_UNAVAILABLE' }
  await ff(p, 300500)
  must((await upd(p)).includes('正式收盤待更新') && (await priceOf(p, '2330')).includes('1,565'), '503 後：' + await upd(p))
  const n0 = n('live')
  await ff(p, 250000); must(n('live') === n0, `失敗後 5 分鐘內不該再讀（${n0} → ${n('live')}）`)
  await p.context().close(); return 'ok'
})

await check('舊後端（CLOSED 沒有 closing 欄位）、stale、快照不是今天：維持原本的每日收盤行為、10 分鐘檢查', async () => {
  M.live = OLD_CLOSED(); M.latest = LATEST_Y; M.calls = []
  const p = await open(at('13:31:00'))
  const lbl = await upd(p)
  must(lbl.includes('收盤價 10/29') && !/FinMind 收盤快照|待更新|FinMind・/.test(lbl), '舊後端標示：' + lbl)
  must((await priceOf(p, '2330')).includes('1,552'), '舊後端應用每日收盤：' + await priceOf(p, '2330'))
  const n0 = n('live')
  await ff(p, 300000); must(n('live') === n0, '5 分鐘內不該再讀：' + n('live'))
  await ff(p, 301000); must(n('live') === n0 + 1, '10 分鐘後檢查 1 次：' + n('live'))
  await p.context().close()
  for (const [name, live] of [['stale', CLOSING(false, false, '13:30:00', { stale: true })], ['昨天的快照', CLOSING(false, false, '13:30:00', { at: `${YDAY}T13:30:00+08:00` })]]) {
    M.live = live; M.calls = []
    const q = await open(at('14:00:00'))
    const l = await upd(q)
    must(l.includes('收盤價 10/29') && !/待更新/.test(l), `${name}：` + l)
    must((await priceOf(q, '2330')).includes('1,552'), `${name} 價格：` + await priceOf(q, '2330'))
    await q.context().close()
  }
  return lbl
})

await check('手機 390 寬：收盤快照標示與頁尾來源、不橫向捲動', async () => {
  M.live = CLOSING(false, false); M.latest = LATEST_Y; M.calls = []
  const p = await open(at('14:10:00'), '', { vp: { width: 390, height: 844 } })
  must((await upd(p)).includes('正式收盤待更新'), '標示：' + await upd(p))
  must(/資料來源：FinMind/.test(await p.innerText('#h-mfoot')), '手機頁尾：' + await p.innerText('#h-mfoot'))
  must(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '橫向捲動')
  await shot(p, 'kp-close-pending-390')
  await p.context().close(); return 'ok'
})

await b.close()
for (const r of results) console.log(r[0], r[1], r[2] ? '｜' + r[2] : '')
if (errs.length) console.log('錯誤：\n' + [...new Set(errs)].join('\n'))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - fail}/${results.length} 通過`)
process.exit(fail || errs.length ? 1 : 0)
