// 數據顯示效能量測＋防退化門檻（對線上 Workers 資料）。
// BASE=http://127.0.0.1:5173/ node e2e_pages_perf.mjs
//   RUNS=3（每種情況跑幾次，取中位數）  OUT=<路徑>（量測結果另存 JSON）  NOGATE=1（只量不判門檻，量舊版用）
// 量什麼：首次載入／回訪到首頁第一列與全部列、首頁整表重畫次數、排序／篩選／搜尋跳至／個股頁／自選頁的耗時、
// 主執行緒長任務（>50ms）總長、行情請求次數。桌機 1440 與手機 390（裝置模擬）各量。
import { chromium } from 'playwright'
import fs from 'node:fs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const RUNS = +(process.env.RUNS || 3)
const GATE = !process.env.NOGATE
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null }

// 30 家常見上市櫃代號當自選（不在資料集裡的會被 UI 丟掉，回報實際家數）
const WATCH = '2330 2317 2454 2308 2382 2303 2412 3711 2357 2395 3008 2379 3034 2345 6505 1301 1303 1326 2002 1216 2207 2603 2609 2615 3045 4904 2327 3231 2474 4938'.split(' ')
const DESKTOP = { viewport: { width: 1440, height: 900 } }
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }

// 頁面內的量測器：長任務、清單容器的子節點異動（整表重畫＝一次移除 100 個以上子節點）。
// 「全部完成」取最後一次異動後下一幀畫完（requestAnimationFrame＋setTimeout），包含排版與繪製；
// 「第一屏」取第一次異動後的下一個 requestAnimationFrame（該幀接著排版、繪製，約略低估幾十毫秒）
const PROBE = () => {
  const P = (window.__perf = { lt: [], last: 0, first: null, fm: null, resets: 0, mark: 0 })
  const painted = (f) => requestAnimationFrame(() => setTimeout(() => f(performance.now()), 0))
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true }) } catch { /* 不支援 */ }
  const mo = new MutationObserver((recs) => {
    const t = performance.now()
    for (const r of recs) {
      if (r.removedNodes.length >= 100) P.resets++
      if ((r.target.id === 'h-body' || r.target.id === 'h-mlist') && P.first == null && r.addedNodes.length) { P.first = -1; requestAnimationFrame(() => (P.first = performance.now())) }
    }
    if (P.mark && P.fm === null) { P.fm = -1; requestAnimationFrame(() => (P.fm = performance.now())) }
    P.last = t
    P.pending = (P.pending || 0) + 1
    painted((x) => { P.last = Math.max(P.last, x); P.pending-- })
  })
  const hook = () => { for (const id of ['h-body', 'h-mlist', 's-tree', 'w-body', 'w-mlist']) { const el = document.getElementById(id); if (el) mo.observe(el, { childList: true }) } }
  // 首頁第一列出現收盤價（不是「—」）的那一幀
  const pricePoll = () => { const c = document.querySelector('#h-body td[data-q],#h-mlist [data-q2]'); if (c && /\d/.test(c.textContent)) P.price = performance.now(); else if (performance.now() < 60000) requestAnimationFrame(pricePoll) }
  requestAnimationFrame(pricePoll)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook()
}
const ltSince = (p, from) => p.evaluate((f) => { let s = 0, n = 0, mx = 0; for (const [t, d] of __perf.lt) if (t + d > f) { s += d; n++; mx = Math.max(mx, d) } return { lt: Math.round(s), ltN: n, ltMax: Math.round(mx) } }, from)

const rowsSel = (mobile) => (mobile ? '#h-mlist .mrow' : '#h-body tr')
/** 等到清單容器 quiet 毫秒內沒有異動，且 cond 成立 */
async function settle(p, cond, quiet = 600, timeout = 30000) {
  const t0 = Date.now()
  for (;;) {
    const ok = await p.evaluate(([c, q]) => (c ? !!new Function('return (' + c + ')')() : true) && !__perf.pending && __perf.first !== -1 && __perf.fm !== -1 && performance.now() - __perf.last >= q, [cond, quiet])
    if (ok) return
    if (Date.now() - t0 > timeout) throw new Error('逾時：' + cond)
    await p.waitForTimeout(100)
  }
}
/** 執行動作，回傳「動作開始 → 第一屏（first）／全部畫完（ms）」的毫秒數與期間長任務 */
async function timed(p, act, cond, quiet) {
  const mark = await p.evaluate(() => { __perf.fm = null; return (__perf.mark = performance.now()) })
  await act()
  await settle(p, cond, quiet)
  const [dur, fm] = await p.evaluate(() => [Math.max(0, __perf.last - __perf.mark), __perf.fm == null ? 0 : Math.max(0, __perf.fm - __perf.mark)])
  return { ms: Math.round(dur), first: Math.round(fm), ...(await ltSince(p, mark)) }
}

async function load(p, mobile, reload) {
  const sel = rowsSel(mobile)
  if (reload) await p.reload(); else await p.goto(BASE)
  await p.waitForFunction((s) => document.querySelectorAll(s).length >= 1900, sel, { timeout: 60000 })
  await settle(p, null, 1500)
  await p.waitForFunction(() => __perf.price, null, { timeout: 20000 }).catch(() => {})
  return p.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    let s = 0, mx = 0; for (const [, d] of __perf.lt) { s += d; mx = Math.max(mx, d) }
    return { first: Math.round(__perf.first), price: Math.round(__perf.price || 0), all: Math.round(__perf.last), renders: 1 + __perf.resets, lt: Math.round(s), ltMax: Math.round(mx), dcl: Math.round(nav.domContentLoadedEventEnd) }
  })
}

const runs = { desktop: [], mobile: [] }
for (const [label, opts] of [['desktop', DESKTOP], ['mobile', MOBILE]]) {
  const mobile = label === 'mobile'
  for (let i = 0; i < RUNS; i++) {
    const ctx = await b.newContext(opts)
    await ctx.route('**/fonts.g*/**', (r) => r.abort())
    await ctx.addInitScript(PROBE)
    await ctx.addInitScript((ids) => { if (!localStorage.getItem('kupei3_watch')) localStorage.setItem('kupei3_watch', JSON.stringify({ groups: [{ id: 1, name: '自選1', ids }], cur: 1 })) }, WATCH)
    const reqs = []
    ctx.on('request', (r) => reqs.push(r.url()))
    const p = await ctx.newPage()
    p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
    p.on('console', (m) => { if (m.type() === 'error' && !/fonts|favicon|Failed to load resource/.test(m.text())) errs.push('console：' + m.text().slice(0, 160)) })
    const r = {}
    r.cold = await load(p, mobile, false)
    r.warm = await load(p, mobile, true)
    const n0 = reqs.length
    const sel = rowsSel(mobile)
    const full = `document.querySelectorAll('${sel}').length>=1900`
    if (mobile) {
      r.sort = await timed(p, () => p.selectOption('#h-msort', 'm0'), full)
      r.sortBack = await timed(p, () => p.selectOption('#h-msort', 'total'), full)
    } else {
      r.sort = await timed(p, () => p.click('[data-sort="m0"]'), full)
      // 重用列排序後：每列都只有第 1 大項那格標成目前排序欄，分數由高到低（前 200 列；未排名組另排在後面）
      r.sortCheck = await p.evaluate(() => {
        const rows = [...document.querySelectorAll('#h-body tr')], act = document.querySelectorAll('#h-body td.act').length
        const sc = rows.slice(0, 200).map((tr) => parseFloat(tr.children[3].querySelector('.s1')?.textContent ?? 'NaN')).filter((x) => !isNaN(x))
        return { rows: rows.length, act, desc: sc.every((x, i) => i === 0 || sc[i - 1] >= x), actCol: rows.every((tr) => !tr.children[3] || tr.children[3].classList.contains('act')) }
      })
      r.sortBack = await timed(p, () => p.click('#h-reset'), full)
      r.resetAct = await p.evaluate(() => document.querySelectorAll('#h-body td.act').length)
    }
    r.filter = await timed(p, () => p.click('#h-hideveto'), `document.querySelectorAll('${sel}').length>100`)
    await timed(p, () => p.click('#h-hideveto'), full)
    r.jump = await timed(p, async () => { await p.fill('#h-q', '2330'); await p.click('#h-jump') }, `!!document.getElementById('${mobile ? 'mr-' : 'hr-'}2330')`)
    r.stock = await timed(p, () => p.evaluate(() => (location.hash = '#/stock/2330/home')), "document.querySelectorAll('#s-tree tr.lv1').length>=12", 400)
    r.stockText = await p.innerText('#pg-stock')
    r.watch = await timed(p, () => p.evaluate(() => (location.hash = '#/watch')),
      mobile ? "document.querySelectorAll('#w-mlist .mrow').length>0" : "document.querySelectorAll('#w-body tr[data-row]').length>0 && document.querySelectorAll('#w-body td[data-spark] svg').length>0", 800)
    r.watchRows = await p.evaluate((m) => document.querySelectorAll(m ? '#w-mlist .mrow' : '#w-body tr[data-row]').length, mobile)
    r.watchText = await p.innerText('#pg-watch')
    r.home = await timed(p, () => p.evaluate(() => (location.hash = '#/home')), full)
    r.homeText = await p.innerText('#pg-home')
    const cnt = (re) => reqs.filter((u) => re.test(u)).length
    r.req = { latest: cnt(/\/api\/market\/latest/), history: cnt(/\/api\/market\/history/), data: cnt(/\/data\//), missing: cnt(/\/(valuation|help)\.json/), afterWarm: reqs.length - n0 }
    runs[label].push(r)
    console.log(label, i + 1, JSON.stringify({ cold: r.cold, warm: r.warm, sort: [r.sort.first, r.sort.ms], filter: [r.filter.first, r.filter.ms], jump: r.jump.ms, stock: r.stock.ms, watch: r.watch.ms, home: r.home.ms, req: r.req }))
    await ctx.close()
  }
}
await b.close()
const b2 = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})

const pick = (rs, f) => med(rs.map(f))
const summary = {}
for (const k of ['desktop', 'mobile']) {
  const rs = runs[k]
  summary[k] = {
    coldFirst: pick(rs, (r) => r.cold.first), coldPrice: pick(rs, (r) => r.cold.price), coldAll: pick(rs, (r) => r.cold.all), coldRenders: pick(rs, (r) => r.cold.renders), coldLongTask: pick(rs, (r) => r.cold.lt), coldLongMax: pick(rs, (r) => r.cold.ltMax),
    warmFirst: pick(rs, (r) => r.warm.first), warmPrice: pick(rs, (r) => r.warm.price), warmAll: pick(rs, (r) => r.warm.all), warmRenders: pick(rs, (r) => r.warm.renders), warmLongTask: pick(rs, (r) => r.warm.lt), warmLongMax: pick(rs, (r) => r.warm.ltMax),
    sortFirst: pick(rs, (r) => r.sort.first), sort: pick(rs, (r) => r.sort.ms), sortLongTask: pick(rs, (r) => r.sort.lt), sortLongMax: pick(rs, (r) => r.sort.ltMax), sortBack: pick(rs, (r) => r.sortBack.ms),
    filterFirst: pick(rs, (r) => r.filter.first), filter: pick(rs, (r) => r.filter.ms), jump: pick(rs, (r) => r.jump.ms), stock: pick(rs, (r) => r.stock.ms), watch: pick(rs, (r) => r.watch.ms), backHome: pick(rs, (r) => r.home.ms),
    latestReq: pick(rs, (r) => r.req.latest), historyReq: pick(rs, (r) => r.req.history), missingReq: pick(rs, (r) => r.req.missing), watchRows: pick(rs, (r) => r.watchRows),
  }
}
console.log('\n中位數（毫秒；首次＝新瀏覽器、回訪＝同一個瀏覽器重新整理）')
console.table(summary)
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ summary, runs: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, v.map(({ stockText, watchText, homeText, ...x }) => x)])) }, null, 2))

const all = [...runs.desktop, ...runs.mobile]
await check('桌機排序（重用列）：順序由高到低、排序欄標示正確、回到預設後清掉', async () => {
  for (const r of runs.desktop) {
    const c = r.sortCheck; must(c.rows >= 1900 && c.desc && c.actCol && c.act === c.rows, JSON.stringify(c)); must(r.resetAct === 0, '回到預設後仍有 ' + r.resetAct + ' 格標示')
  }
  return runs.desktop[0].sortCheck.rows + ' 列'
})
await check('自選頁：近 20 日與月營收載入中顯示「…」，回來後換成小圖', async () => {
  const ctx = await b2.newContext(DESKTOP)
  await ctx.route('**/fonts.g*/**', (r) => r.abort())
  await ctx.route('**/api/market/history**', async (r) => { await new Promise((x) => setTimeout(x, 2500)); r.continue() })
  await ctx.addInitScript((ids) => localStorage.setItem('kupei3_watch', JSON.stringify({ groups: [{ id: 1, name: '自選1', ids }], cur: 1 })), WATCH.slice(0, 3))
  const p = await ctx.newPage(); await p.goto(BASE + '#/watch')
  await p.waitForFunction(() => document.querySelectorAll('#w-body tr[data-row]').length === 3, null, { timeout: 40000 })
  const during = await p.$$eval('#w-body td[data-spark],#w-body td[data-rev]', (x) => x.map((td) => td.innerText.trim()))
  must(during.every((t) => t === '…'), '載入中：' + JSON.stringify(during))
  await p.waitForFunction(() => document.querySelectorAll('#w-body td[data-spark] svg').length === 3, null, { timeout: 20000 })
  await ctx.close(); return ''
})
await b2.close()
await check('畫面沒有 undefined／NaN（首頁、個股、自選）', async () => {
  for (const r of all) for (const t of [r.homeText, r.stockText, r.watchText]) must(!/undefined|NaN/.test(t), '含 undefined／NaN：' + t.match(/.{0,30}(undefined|NaN).{0,30}/)?.[0])
  return ''
})
await check('自選頁有載入 30 家內的公司', async () => { must(all.every((r) => r.watchRows > 0), '自選列數 ' + all.map((r) => r.watchRows)); return all[0].watchRows + ' 家' })
if (GATE) {
  const d = summary.desktop, m = summary.mobile
  await check('首頁啟動只整表畫一次（首次與回訪）', async () => { for (const s of [d, m]) must(s.coldRenders === 1 && s.warmRenders === 1, `重畫次數 首次 ${s.coldRenders}、回訪 ${s.warmRenders}`); return '' })
  await check('行情 latest 每次載入最多 1 次、history 30 家 1 次、不打不存在的選用檔', async () => {
    for (const r of all) {
      must(r.req.latest <= 2, 'latest ' + r.req.latest + ' 次（首次＋回訪）')
      must(r.req.history <= 1, 'history ' + r.req.history + ' 次')
      must(r.req.missing === 0, 'valuation／help 404 請求 ' + r.req.missing + ' 次')
    }
    return ''
  })
  await check('回訪到首頁第一列 < 1500ms、全部列 < 3000ms（桌機與手機）', async () => { for (const s of [d, m]) must(s.warmFirst < 1500 && s.warmAll < 3000, `第一列 ${s.warmFirst}、全部 ${s.warmAll}`); return `桌機 ${d.warmFirst}/${d.warmAll}、手機 ${m.warmFirst}/${m.warmAll}` })
  await check('排序與篩選重畫 < 1500ms', async () => { for (const s of [d, m]) must(s.sort < 1500 && s.filter < 1500, `排序 ${s.sort}、篩選 ${s.filter}`); return `桌機 ${d.sort}/${d.filter}、手機 ${m.sort}/${m.filter}` })
}
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
