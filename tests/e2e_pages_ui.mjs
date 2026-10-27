// 畫面修正的回歸測試（2026-10-28 線上實測找到的 bug）。評分與收盤行情用線上資料，盤中端點用假的回應；不寫入任何資料、不建立帳號。
// BASE=http://127.0.0.1:5432/（無權杖版建置）ENVFILE=<含 VITE_KUPEI_TOKEN 的檔> node e2e_pages_ui.mjs（SHOTS=<資料夾> 另存截圖）
import { chromium } from 'playwright'
import fs from 'node:fs'
const ENV = Object.fromEntries(fs.readFileSync(process.env.ENVFILE, 'utf8').split('\n').map((l) => l.replace('\r', '')).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const SHOTS = process.env.SHOTS || ''
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', 'content-type': 'application/json' }
const CLOSED = { phase: 'CLOSED', stale: false, ttlSeconds: 300, markets: { L: null, O: null }, quotes: {} }
const OPEN = { phase: 'OPEN', stale: false, ttlSeconds: 300, markets: { L: { at: '2026-10-27T05:20:00Z', receivedAt: '2026-10-27T05:20:20Z', source: 'twse' }, O: { at: '2026-10-27T05:20:00Z', receivedAt: '2026-10-27T05:20:30Z', source: 'tpex' } }, quotes: { 2330: [1234.5, 12.5, 12345000, '13:20:00'] } }
const M = { intraday: CLOSED }

async function open(hash = '', vp = { width: 1440, height: 900 }, clock = false) {
  const ctx = await b.newContext({ viewport: vp })
  await ctx.route(/\/(data\/|api\/market\/(latest|history))/, (route) => route.request().method() === 'OPTIONS' ? route.continue() : route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer ' + ENV.VITE_KUPEI_TOKEN } }))
  await ctx.route(/\/api\/market\/intraday/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(M.intraday) }))
  await ctx.route(/\/api\/(news|reports|auth|store)/, (route) => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 404, headers: CORS, body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'NOT_FOUND' } }) }))
  const p = await ctx.newPage()
  if (clock) await p.clock.install()
  await p.route('**/fonts.g*/**', (r) => r.abort())
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE + hash)
  await p.waitForFunction(() => document.getElementById('loading')?.hidden && /\S/.test(document.getElementById('h-upd')?.textContent || '') && document.querySelector('.page.on'), null, { timeout: 40000 })
  return p
}
const go = async (p, h, ms = 1200) => { await p.evaluate((x) => { location.hash = x }, h); await p.waitForTimeout(ms) }
const shot = async (p, name, sel) => { if (SHOTS) await (sel ? p.locator(sel) : p).screenshot({ path: `${SHOTS}/${name}.png` }) }
const waitVal = (p) => p.waitForFunction(() => /中心\s*[\d,.]+/.test(document.querySelector('#s-valcard')?.innerText || ''), null, { timeout: 40000 })

/* 1. 手機排序：每個選項都不報錯、確實重排，之後點列展開正常 */
await check('手機排序：所有選項（含安全邊際）不報錯、會重排、展開正常', async () => {
  const p = await open('', { width: 390, height: 844 })
  await p.waitForFunction(() => document.querySelectorAll('#h-mlist .mrow').length > 100, null, { timeout: 40000 })
  const opts = await p.$$eval('#h-msort option', (xs) => xs.map((x) => x.value))
  must(opts.includes('margin') && opts.includes('price') && opts.includes('m0'), '排序選項：' + opts.join(','))
  const e0 = errs.length, firsts = {}
  for (const v of opts) {
    await p.selectOption('#h-msort', v); await p.waitForTimeout(400)
    firsts[v] = await p.$eval('#h-mlist .mrow', (x) => x.id)
    must((await p.inputValue('#h-msort')) === v, v + '：選單沒停在所選項目')
  }
  must(errs.length === e0, '排序時有 JS 錯誤：' + errs.slice(e0).join('；'))
  must(firsts.margin !== firsts.total && firsts.price !== firsts.total, '安全邊際／價格排序後第一列沒變：' + JSON.stringify(firsts))
  await p.selectOption('#h-msort', 'margin'); await p.waitForTimeout(400)
  must(/排序：安全邊際/.test(await p.innerText('#h-sort')), '排序說明：' + await p.innerText('#h-sort'))
  await p.click('#h-mlist .mrow:first-child .mhead'); await p.waitForTimeout(300)
  must(await p.$('#h-mlist .mrow.open .mdet .mval'), '點列後沒有展開')
  must(errs.length === e0, '展開時有 JS 錯誤：' + errs.slice(e0).join('；'))
  await shot(p, 'mobile_sort_margin')
  await p.context().close(); return opts.length + ' 個選項'
})

/* 3. 盤中 → 收盤：價格欄名稱、手機排序選單跟著改回「收盤價」 */
await check('盤中轉收盤：桌機表頭與手機排序選單從「盤中價」改回「收盤價」', async () => {
  const out = []
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    M.intraday = OPEN
    const p = await open('', vp, true); await p.waitForTimeout(1500)
    const mob = vp.width < 720
    const label = () => mob ? p.$eval('#h-msort option[value="price"]', (x) => x.textContent) : p.$eval('#h-head [data-sort="price"]', (x) => x.textContent)
    must(/盤中價/.test(await label()), (mob ? '手機' : '桌機') + '盤中時應為「盤中價」：' + await label())
    M.intraday = CLOSED
    await p.clock.fastForward(301000); await p.waitForTimeout(2000)
    must(/收盤價/.test(await p.innerText('#h-upd')), '行情標示沒有改回收盤價')
    const l2 = await label(); must(/收盤價/.test(l2) && !/盤中價/.test(l2), (mob ? '手機排序選單' : '桌機表頭') + '仍是：' + l2)
    if (!mob) { // 到別頁再回首頁，表頭仍正確
      await go(p, '#/status', 800); await go(p, '#/home', 1500)
      const l3 = await label(); must(/收盤價/.test(l3), '回首頁後表頭：' + l3)
    }
    out.push((mob ? '手機 ' : '桌機 ') + l2.replace(/[▲▼]/g, '').replace('排序：', ''))
    await p.context().close()
  }
  M.intraday = CLOSED
  return out.join('、')
})

/* 4. 不存在的代號：隱藏估價、報告、問題、新聞卡片，不留上一家內容 */
await check('不存在代號（9999）：不顯示上一家的估價與問題', async () => {
  const p = await open('#/stock/2330/home'); await waitVal(p); await p.waitForTimeout(800)
  await go(p, '#/stock/9999/home', 1200)
  must(/找不到公司 9999/.test(await p.innerText('#s-title')), '標題：' + await p.innerText('#s-title'))
  for (const id of ['s-valcard', 's-repcard', 's-qcard', 's-news', 's-prev', 's-next']) must(!(await p.isVisible('#' + id)), id + ' 仍顯示')
  const t = await p.innerText('#pg-stock'); must(!/台積電|2330/.test(t), '畫面仍有上一家的內容：' + t.slice(0, 120))
  await shot(p, 'stock_9999')
  await go(p, '#/stock/2330/home', 1500); await waitVal(p)
  must(await p.isVisible('#s-valcard') && await p.isVisible('#s-qcard'), '回到存在的公司後卡片沒恢復')
  await p.context().close(); return ''
})

/* 5. 旗標不重複；2. 估價數值不截斷；10. 估價格與股價位置有提示 */
await check('估價卡：旗標不重複、數值完整（桌機與 390 手機）、有滑鼠提示', async () => {
  const notes = []
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const p = await open('', vp)
    for (const id of ['5274', '2330', '2454', '6505']) {
      await go(p, '#/stock/' + id + '/home', 300); await waitVal(p); await p.waitForTimeout(300)
      const flags = await p.$$eval('#s-flags .flag', (xs) => xs.map((x) => x.textContent.trim()))
      const dup = flags.filter((f, i) => flags.indexOf(f) !== i); must(!dup.length, id + ' 旗標重複：' + dup.join('、'))
      const cut = await p.$$eval('#s-val .v', (xs) => xs.filter((x) => x.scrollWidth > x.clientWidth + 1 || getComputedStyle(x).textOverflow === 'ellipsis').map((x) => x.textContent))
      must(!cut.length, id + ' ' + vp.width + ' 數值被截斷：' + cut.join('、'))
      const tips = await p.$$eval('#s-val > div', (xs) => xs.map((x) => x.title))
      must(tips.length === 7 && tips.every((t) => /：/.test(t)), id + ' 估價格提示：' + tips.join('|'))
      const pos = await p.$('#s-flags .flag[title*="中心"]'); const hasPos = /股價位置/.test(await p.innerText('#s-flags'))
      must(!hasPos || pos, id + ' 股價位置沒有提示')
    }
    await shot(p, 'valcard_' + vp.width, '#s-valcard')
    notes.push(vp.width + ' OK')
    await p.context().close()
  }
  return notes.join('、')
})

/* 8. 搜尋多筆相符：提示筆數；完全相符的代號直接跳、不提示 */
await check('搜尋：多筆相符顯示「找到 N 筆」，代號完全相符直接跳', async () => {
  const p = await open('')
  await p.waitForFunction(() => document.querySelectorAll('#h-body tr').length >= 1900, null, { timeout: 40000 })
  await p.fill('#h-q', '台'); await p.press('#h-q', 'Enter'); await p.waitForTimeout(1200)
  const msg = await p.innerText('#h-msg'); must(/找到 \d+ 筆，已跳到第一筆/.test(msg), '訊息：' + msg)
  const flash = await p.$eval('#h-body tr.flash', (x) => x.id).catch(() => ''); must(flash, '沒有標示跳到的列')
  await p.fill('#h-q', '2330'); await p.press('#h-q', 'Enter'); await p.waitForTimeout(1000)
  must((await p.innerText('#h-msg')).trim() === '', '完全相符不該提示：' + await p.innerText('#h-msg'))
  must(await p.$('#hr-2330.flash'), '沒有跳到 2330')
  /* 10. 首頁分數格滑鼠提示 */
  await p.hover('#hr-2330 td:nth-child(4)'); await p.waitForTimeout(150)
  const tip = await p.$eval('#hr-2330 td:nth-child(4)', (x) => x.title); must(/DAR-L：/.test(tip), '分數格提示：' + tip)
  await p.context().close(); return msg + '｜' + tip
})

/* 6. 文字：狀態頁不外露內部備忘、說明頁估價參數、報告設定不顯示內部路徑 */
await check('狀態頁、說明頁、報告與新聞設定：不顯示內部備忘與原始 ISO 時間', async () => {
  const p = await open('#/status'); await p.waitForTimeout(1200)
  const st = await p.innerText('#st-kv')
  for (const bad of ['Codex', '待同步', '匯出方式待確認', '未開通時', 'manifest 雜湊', 'T13:30:00', 'PUBLISHED_UI']) must(!st.includes(bad), '狀態頁含「' + bad + '」')
  await shot(p, 'status_desktop', '#pg-status')
  await go(p, '#/help', 1500)
  must(!/全市場估價交付後顯示/.test(await p.innerText('#vp-body')), '說明頁估價參數仍是舊說法')
  await p.evaluate(() => localStorage.setItem('kupei3_watch', JSON.stringify({ groups: [{ id: 1, name: '自選1', ids: ['2330'] }], cur: 1 })))
  await p.reload(); await p.waitForFunction(() => document.getElementById('loading')?.hidden, null, { timeout: 40000 })
  await go(p, '#/report-settings', 1500)
  const rs = await p.innerText('#rs-panel'); must(!/inputs\/|reports\//.test(rs) && !/參考資料上傳尚未提供/.test(rs), '報告設定：' + rs.slice(0, 200))
  await go(p, '#/news-settings', 800)
  const ns = await p.innerText('#ns-store'); must(/Google／Bing 新聞/.test(ns), '新聞設定來源：' + ns)
  await go(p, '#/watch', 800)
  await p.click('[data-gmenu="1"]'); await p.click('[data-gdel="1"]')
  const cf = await p.innerText('.modal'); must(/只存在這台瀏覽器/.test(cf) && !/保存在後端/.test(cf), '刪除確認：' + cf)
  await p.context().close(); return ''
})

await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
process.exitCode = fail ? 1 : 0
