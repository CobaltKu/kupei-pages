// D-11 手機預檢：iPhone SE／14／Pro Max 寬度（模擬 iOS Safari UA、觸控），不寫入任何資料。
// 每頁檢查：沒有橫向捲動、沒有 JS 錯誤；輸入框字級 ≥16px（iOS 小於 16px 會在點進去時自動放大）。
// 網站必須登入（2026-10-28）：登入畫面另外檢查；其他頁用假的已登入 session＋fixture 資料（或 KUPEI_TEST_SESSION 讀線上），見 tests/_kupei_test.mjs。
// BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_mobile.mjs（SHOTS=<資料夾> 另存 iPhone 14 截圖）
import { chromium } from 'playwright'
import { routeBackend, seedSession } from './_kupei_test.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const PAGES = [['首頁', ''], ['個股（有明細）', '#/stock/2330/home'], ['個股（未評估）', '#/stock/1589/home'], ['自選', '#/watch'], ['新聞', '#/news'], ['新聞設定', '#/news-settings'], ['報告設定', '#/report-settings'], ['狀態', '#/status'], ['說明', '#/help']]
for (const [nm, w, h] of [['iPhone SE', 375, 667], ['iPhone 14', 390, 844], ['iPhone Pro Max', 430, 932]]) {
  const opts = { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA }
  await check(`${nm}｜登入畫面：不橫向捲動、卡片不超出畫面、輸入框 ≥16px`, async () => {
    const g = await b.newContext(opts); await routeBackend(g)
    const q = await g.newPage(); q.on('pageerror', (e) => errs.push(nm + ' JS 錯誤：' + e.message))
    await q.goto(BASE); await q.waitForSelector('#kp-gate #acct-user'); await q.waitForTimeout(500)
    const m = await q.evaluate(() => { const r = document.querySelector('.gate-card').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, l: r.left, r: r.right, iw: innerWidth, fs: ['acct-user', 'acct-pass'].map((i) => parseFloat(getComputedStyle(document.getElementById(i)).fontSize)) } })
    if (nm === 'iPhone 14' && process.env.SHOTS) await q.screenshot({ path: `${process.env.SHOTS}/m_login.png` })
    await g.close()
    must(m.sw <= m.iw && m.l >= 0 && m.r <= m.iw, `超出 ${m.l}～${m.r}／${m.iw}（scrollWidth ${m.sw}）`); must(m.fs.every((x) => x >= 16), '字級 ' + m.fs); return ''
  })
  const ctx = await b.newContext(opts)
  await routeBackend(ctx); await seedSession(ctx)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push(nm + ' JS 錯誤：' + e.message))
  for (const [k, hash] of PAGES) {
    await check(`${nm}｜${k}：不橫向捲動、輸入框 ≥16px`, async () => {
      await p.goto(BASE + hash)
      if (hash === '') await p.waitForFunction(() => document.querySelectorAll('#h-mlist .mrow').length > 100, null, { timeout: 40000 })
      await p.waitForTimeout(2000)
      const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, small: [...document.querySelectorAll('input,select,textarea')].filter((e) => e.getBoundingClientRect().width > 0 && !/checkbox|radio/.test(e.type) && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id || e.type) }))
      must(m.sw <= m.iw, `scrollWidth ${m.sw} > ${m.iw}`); must(!m.small.length, '輸入框字級小於 16px：' + m.small.join(',')); return ''
    })
    if (nm === 'iPhone 14' && process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/m_${PAGES.findIndex((x) => x[0] === k)}.png` })
  }
  if (nm === 'iPhone 14') await check(`${nm}｜首頁新增自選後維持目前個股位置`, async () => {
    await p.goto(BASE); await p.waitForFunction(() => document.querySelectorAll('#h-mlist .mrow').length > 100, null, { timeout: 40000 })
    await p.waitForTimeout(2000) // 等全市場清單分批繪製完成，再模擬使用者捲動與操作
    const id = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('#h-mlist .mrow')]
      const row = rows.slice(40).find((x) => x.querySelector('.madd:not(.on)'))
      if (!row) return null
      const list = document.getElementById('h-mlist'); list.scrollTop = row.offsetTop - 120
      return row.id.slice(3)
    })
    must(id, '找不到可加入自選的測試個股')
    const before = await p.$eval(`#mr-${id}`, (x) => x.getBoundingClientRect().top)
    // DOM click 模擬已在可視範圍內的手指點按；Playwright click 會先自動置中元素，反而改變被測的捲動位置。
    await p.$eval(`#mr-${id} [data-menu="${id}"]`, (x) => x.click()); await p.$eval(`[data-setg][data-id="${id}"]`, (x) => x.click())
    await p.waitForFunction((sid) => document.querySelector(`#mr-${sid} .madd.on`), id)
    await p.waitForTimeout(1000) // 首頁分批補完其餘公司後才會還原較深的捲動位置
    const after = await p.$eval(`#mr-${id}`, (x) => x.getBoundingClientRect().top)
    must(Math.abs(after - before) <= 2, `新增自選後個股位置 ${before} → ${after}`)
    return id
  })
  await check(`${nm}｜帳號視窗（已登入、改密碼展開）：不超出畫面、輸入框 ≥16px`, async () => {
    await p.goto(BASE); await p.waitForTimeout(1500); await p.click('[data-acct]'); await p.waitForSelector('#acct-pw-box')
    await p.evaluate(() => { document.getElementById('acct-pw-box').open = true })
    const m = await p.evaluate(() => { const r = document.querySelector('.acct-modal').getBoundingClientRect(); return { l: r.left, r: r.right, iw: innerWidth, fs: ['acct-pw-cur', 'acct-pw-new'].map((i) => parseFloat(getComputedStyle(document.getElementById(i)).fontSize)) } })
    must(m.l >= 0 && m.r <= m.iw, `視窗超出 ${m.l}～${m.r}／${m.iw}`); must(m.fs.every((x) => x >= 16), '字級 ' + m.fs); return ''
  })
  await ctx.close()
}
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
