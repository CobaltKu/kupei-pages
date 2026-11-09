// C-13（2026-11-04 CoKu 實機回報）首頁捲動位置回歸：
// ① 桌機在全市場清單深處把公司加入／移出自選，該列畫面位置不變（只換單列，不整表重畫）；排序之後仍正確。
// ② 手機搜尋跳到深處公司後，頁首搜尋框仍在可視範圍、window 與所有外層容器都沒有被捲動（只設 #h-mlist 的 scrollTop），命中列在清單中間。
// 評分與行情用 fixture（或 KUPEI_TEST_SESSION 讀線上），後端其他端點用假的；不建立帳號。測試檔要和 _kupei_test.mjs 放同一個資料夾執行。
// BASE=http://127.0.0.1:5173/ KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json node e2e_pages_home_scroll.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 內建 fixture 只有 150 家，不足以重現「整表縮成 120 列」造成的跑位；執行時複製成 900 列的暫存 fixture（代號 5000 起，不寫回專案）
const here = path.dirname(fileURLToPath(import.meta.url))
const fx = JSON.parse(fs.readFileSync(process.env.KP_FIXTURE || path.join(here, 'fixtures/kupei-data.json'), 'utf8'))
if (!process.env.KUPEI_TEST_SESSION) {
  const rows = fx.files.summary.rows, base = rows.length
  for (let k = 0; rows.length < 900; k++) { const r = JSON.parse(JSON.stringify(rows[k % base])); r[0] = String(5000 + k); r[1] = r[1] + k; rows.push(r) }
  const tmp = path.join(os.tmpdir(), 'kupei_home_scroll_fixture.json'); fs.writeFileSync(tmp, JSON.stringify(fx)); process.env.KP_FIXTURE = tmp
}
const { routeBackend, seedSession } = await import('./_kupei_test.mjs')

const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

async function open(opts, rowSel) {
  const ctx = await b.newContext(opts)
  await routeBackend(ctx); await seedSession(ctx)
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
  await p.goto(BASE)
  await p.waitForFunction((s) => document.querySelectorAll(s).length > 400, rowSel, { timeout: 40000 })
  await p.waitForTimeout(2500) // 等全市場清單分批畫完
  return p
}
const top = (p, sel) => p.$eval(sel, (x) => x.getBoundingClientRect().top)

await check('桌機 1440：深處列加入、再移出自選，列位置差 ≤2px，捲動量不變，只換單列', async () => {
  const p = await open({ viewport: { width: 1440, height: 900 } }, '#h-body tr[id^="hr-"]')
  const id = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#h-body tr[id^="hr-"]')]
    const row = rows.slice(300).find((x) => x.querySelector('.addbtn:not(.on)'))
    if (!row) return null
    const w = document.getElementById('h-wrap'); w.scrollTop = row.offsetTop - 300
    window.__kept = rows[0]; // 其他列的節點必須保持同一個（不重建）
    return row.id.slice(3)
  })
  must(id, '找不到可加入自選的測試個股')
  await p.waitForTimeout(300)
  const before = await top(p, `#hr-${id}`), st0 = await p.$eval('#h-wrap', (w) => w.scrollTop)
  must(st0 > 1000, '測試列不夠深：scrollTop ' + st0)
  await p.$eval(`#hr-${id} [data-menu="${id}"]`, (x) => x.click()); await p.$eval(`[data-setg][data-id="${id}"]`, (x) => x.click())
  await p.waitForFunction((sid) => document.querySelector(`#hr-${sid} .addbtn.on`), id)
  await p.waitForTimeout(1200) // 以前整表重畫會在分批補完後才還原位置
  const after = await top(p, `#hr-${id}`), st1 = await p.$eval('#h-wrap', (w) => w.scrollTop)
  must(Math.abs(after - before) <= 2, `加入自選後列位置 ${before} → ${after}`)
  must(Math.abs(st1 - st0) <= 2, `加入自選後 scrollTop ${st0} → ${st1}`)
  must(await p.evaluate(() => document.querySelector('#h-body tr[id^="hr-"]') === window.__kept), '加入自選不該重建其他列')
  must(await p.$eval(`#hr-${id} .dot`, () => true).catch(() => false), '該列應有自選色點')
  // 移出
  await p.$eval(`#hr-${id} [data-menu="${id}"]`, (x) => x.click())
  const rm = await p.$(`[data-rmg]`); must(!!rm, '找不到「移出」按鈕')
  await rm.evaluate((x) => x.click())
  await p.waitForFunction((sid) => document.querySelector(`#hr-${sid} .addbtn:not(.on)`), id)
  await p.waitForTimeout(1200)
  const after2 = await top(p, `#hr-${id}`)
  must(Math.abs(after2 - before) <= 2, `移出自選後列位置 ${before} → ${after2}`)
  must(await p.evaluate(() => document.querySelector('#h-body tr[id^="hr-"]') === window.__kept), '移出自選不該重建其他列')
  await p.context().close(); return id
})
await check('桌機 1440：加入自選後排序仍正確（列數不變、自選列色點在）', async () => {
  const p = await open({ viewport: { width: 1440, height: 900 } }, '#h-body tr[id^="hr-"]')
  await p.click('#h-head [data-sort="m0"]'); await p.waitForTimeout(2500)
  const n0 = await p.$$eval('#h-body tr[id^="hr-"]', (r) => r.length)
  const id = await p.evaluate(() => { const row = [...document.querySelectorAll('#h-body tr[id^="hr-"]')].slice(200).find((x) => x.querySelector('.addbtn:not(.on)')); return row.id.slice(3) })
  await p.$eval(`#hr-${id} [data-menu="${id}"]`, (x) => x.click()); await p.$eval(`[data-setg][data-id="${id}"]`, (x) => x.click())
  await p.waitForFunction((sid) => document.querySelector(`#hr-${sid} .addbtn.on`), id)
  await p.click('#h-head [data-sort="m0"]'); await p.waitForTimeout(2500)
  const n1 = await p.$$eval('#h-body tr[id^="hr-"]', (r) => r.length)
  must(n1 === n0, `排序後列數 ${n0} → ${n1}`)
  must(await p.$eval(`#hr-${id} .addbtn`, (x) => x.classList.contains('on')), '排序後該列應仍在自選')
  await p.context().close()
})
for (const [nm, w, h] of [['iPhone SE', 375, 667], ['iPhone 14', 390, 844], ['iPhone Pro Max', 430, 932]]) {
  const opts = { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA }
  await check(`${nm}｜搜尋跳到深處公司：搜尋框仍可見、window 與外層容器沒被捲動、命中列在清單中間`, async () => {
    const p = await open(opts, '#h-mlist .mrow')
    const id = await p.evaluate(() => document.querySelectorAll('#h-mlist .mrow')[300].id.slice(3))
    // 模擬 iOS 鍵盤彈出：可視高度縮到約 62%，搜尋框有焦點時送出（真機的跑位只在這種狀態發生）
    await p.setViewportSize({ width: w, height: Math.round(h * 0.62) })
    await p.fill('#h-q', id); await p.press('#h-q', 'Enter')
    await p.waitForSelector(`#mr-${id}.flash`, { timeout: 8000 })
    await p.waitForTimeout(500)
    const m = await p.evaluate((sid) => {
      const q = document.getElementById('h-q'), host = document.getElementById('h-mlist'), row = document.getElementById('mr-' + sid)
      const qr = q.getBoundingClientRect(), hr = host.getBoundingClientRect(), rr = row.getBoundingClientRect()
      const anc = []; for (let e = q; e; e = e.parentElement) if (e.scrollTop) anc.push((e.id || e.className || e.tagName) + ':' + e.scrollTop)
      const mid = document.elementFromPoint(qr.left + qr.width / 2, qr.top + qr.height / 2)
      return { sy: window.scrollY, root: document.scrollingElement.scrollTop, anc, qt: qr.top, qb: qr.bottom, ih: innerHeight, hit: mid === q, rowIn: (rr.top + rr.bottom) / 2 >= hr.top && (rr.top + rr.bottom) / 2 <= hr.bottom, off: Math.abs((rr.top + rr.bottom) / 2 - (hr.top + hr.bottom) / 2), hh: hr.height, st: host.scrollTop }
    }, id)
    must(m.st > 5000, '清單沒有捲到深處：scrollTop ' + m.st)
    must(m.sy === 0 && m.root === 0, `window 被捲動 scrollY=${m.sy} root=${m.root}`)
    must(!m.anc.length, '外層容器被捲動：' + m.anc.join(', '))
    must(m.qt >= 0 && m.qb <= m.ih && m.hit, `搜尋框不可見／被遮住：top ${m.qt} bottom ${m.qb}／${m.ih}`)
    must(m.rowIn && m.off <= m.hh * 0.4, `命中列中心不在清單內或偏離中央：偏離 ${m.off.toFixed(0)}／清單高 ${m.hh.toFixed(0)}`)
    await p.setViewportSize({ width: w, height: h })
    // 可以繼續搜尋：換另一家再跳一次，仍不捲動外層
    const id2 = await p.evaluate(() => document.querySelectorAll('#h-mlist .mrow')[40].id.slice(3))
    await p.fill('#h-q', id2); await p.press('#h-q', 'Enter'); await p.waitForTimeout(600)
    must(await p.evaluate(() => window.scrollY === 0 && document.scrollingElement.scrollTop === 0 && document.getElementById('h-q').getBoundingClientRect().top >= 0), '第二次搜尋後搜尋框跑出畫面')
    await p.context().close(); return id
  })
}
// ---- C-13（2026-11-09 再修）：手機首頁只有一條捲動路徑、外層不可被推走；重新整理只顯示圖示 ----
for (const [nm, w, h] of [['iPhone SE', 375, 667], ['iPhone 14', 390, 844], ['iPhone Pro Max', 430, 932]]) {
  const opts = { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA }
  await check(`${nm}｜首頁單一捲動路徑：只有 #h-mlist 可捲，外層被程式或聚焦推動後搜尋框仍在原位`, async () => {
    const p = await open(opts, '#h-mlist .mrow')
    const sc = await p.evaluate(() => [...document.querySelectorAll('html,body,.app,main,#pg-home,#pg-home *')].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1 && e.getBoundingClientRect().width > 0 }).map((e) => e.id || e.tagName))
    must(sc.length === 1 && sc[0] === 'h-mlist', '可捲動元素應只有 h-mlist：' + sc.join(','))
    // 模擬瀏覽器自動捲動：直接設外層 scrollTop、對頁尾與清單呼叫 scrollIntoView、鍵盤縮小可視高度後聚焦搜尋框
    await p.setViewportSize({ width: w, height: Math.round(h * 0.62) })
    await p.evaluate(() => {
      document.querySelector('main').scrollTop = 300; document.getElementById('pg-home').scrollTop = 300; window.scrollTo(0, 300)
      document.getElementById('h-mfoot').scrollIntoView(); document.getElementById('h-mlist').lastElementChild?.scrollIntoView(); document.getElementById('h-q').focus()
    })
    await p.waitForTimeout(400)
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(400)
    const m = await p.evaluate(() => { const q = document.getElementById('h-q').getBoundingClientRect(); const anc = []; for (let e = document.getElementById('h-q'); e; e = e.parentElement) if (e.scrollTop) anc.push((e.id || e.tagName) + ':' + e.scrollTop); return { anc, top: q.top, bottom: q.bottom, sy: window.scrollY, ih: innerHeight } })
    must(!m.anc.length && m.sy === 0, `外層仍被捲動：${m.anc.join(', ')} scrollY=${m.sy}`)
    must(m.top >= 0 && m.bottom <= m.ih, `搜尋框不在可視範圍：${m.top}～${m.bottom}／${m.ih}`)
    // 清單深處任何位置，搜尋框一直在畫面上、清單自己可以回到頂端
    await p.evaluate(() => { document.getElementById('h-mlist').scrollTop = 99999 }); await p.waitForTimeout(200)
    must(await p.evaluate(() => { const q = document.getElementById('h-q').getBoundingClientRect(); return q.top >= 0 && q.bottom <= innerHeight }), '清單捲到底後搜尋框不見了')
    await p.evaluate(() => { document.getElementById('h-mlist').scrollTop = 0 })
    must(await p.evaluate(() => document.getElementById('h-mlist').scrollTop === 0), '清單回不到頂端')
    await p.context().close()
  })
  await check(`${nm}｜重新整理按鈕只顯示圖示：有 aria-label／title、觸控範圍 ≥44px、點了會重新載入`, async () => {
    const p = await open(opts, '#h-mlist .mrow')
    const m = await p.evaluate(() => { const e = document.getElementById('h-refresh'), r = e.getBoundingClientRect(); return { text: e.textContent.trim(), label: e.getAttribute('aria-label'), title: e.title, svg: !!e.querySelector('svg'), w: r.width, h: r.height, vis: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth } })
    must(m.text === '' && m.svg, `應只有圖示：text="${m.text}" svg=${m.svg}`)
    must(m.label === '重新整理' && m.title === '重新整理', `aria-label／title：${m.label}／${m.title}`)
    must(m.w >= 44 && m.h >= 44, `觸控範圍 ${m.w}×${m.h}`); must(m.vis, '按鈕不在可視範圍')
    await Promise.all([p.waitForNavigation({ timeout: 15000 }), p.click('#h-refresh')])
    await p.context().close()
  })
}
await check('桌機 1440：重新整理只顯示圖示，有 aria-label／title，點了會重新載入', async () => {
  const p = await open({ viewport: { width: 1440, height: 900 } }, '#h-body tr[id^="hr-"]')
  const m = await p.evaluate(() => { const e = document.getElementById('h-refresh'), r = e.getBoundingClientRect(); return { text: e.textContent.trim(), label: e.getAttribute('aria-label'), title: e.title, svg: !!e.querySelector('svg'), w: r.width, h: r.height } })
  must(m.text === '' && m.svg && m.label === '重新整理' && m.title === '重新整理', JSON.stringify(m)); must(m.w >= 26 && m.h >= 26, `按鈕太小 ${m.w}×${m.h}`)
  await Promise.all([p.waitForNavigation({ timeout: 15000 }), p.click('#h-refresh')])
  await p.context().close()
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${fail ? '有 ' + fail + ' 項失敗' : '全部通過（' + results.length + ' 項）'}`)
process.exit(fail ? 1 : 0)
