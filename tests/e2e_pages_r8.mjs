// D-10：正式 r8 資料（run server_v3_0_30_r8_r2_20261027）的擴充欄位都有進畫面：第二階段處置、同業名次、定義／目標、估價、說明、狀態頁。
// 對線上 Workers 資料，不建立帳號、不寫任何資料。BASE=http://127.0.0.1:5173/ node e2e_pages_r8.mjs
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:5173/'
const b = await chromium.launch(process.env.CHR ? { executablePath: process.env.CHR } : {})
const results = [], errs = []
const check = async (name, fn) => { try { const n = await fn(); results.push(['PASS', name, n || '']) } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]) } }
const must = (c, m) => { if (!c) throw new Error(m) }
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await p.route('**/fonts.g*/**', (r) => r.abort())
p.on('pageerror', (e) => errs.push('JS 錯誤：' + e.message))
const txt = async (sel) => ((await p.$(sel)) ? (await p.innerText(sel)).replace(/\s+/g, ' ') : '')
const stock = async (id, ready) => { await p.goto(BASE + '#/stock/' + id + '/home'); await p.waitForFunction(ready, null, { timeout: 30000 }); await p.waitForTimeout(400) }
const treeReady = () => document.querySelectorAll('#s-tree tr').length >= 12

await check('2330：第二階段處置、同業名次、估價數值', async () => {
  await stock('2330', treeReady)
  must(/第二階段：可供判讀/.test(await txt('#s-p2')), '第二階段：' + await txt('#s-p2'))
  const t = await txt('#s-tree'); must(/同業名次 \d+／\d+/.test(t), '沒有同業名次'); must(!/同業名次尚未提供/.test(t), '同業名次仍顯示尚未提供')
  const v = await txt('#s-valcard'); must(/中心 [\d,.]+/.test(v) && /安全邊際 [+-]?[\d.]+%/.test(v) && /隱含成長率 [\d.]+%/.test(v), '估價：' + v.slice(0, 120)); return ''
})
await check('3526：需複核（趨勢惡化）列出原因與觸發項目', async () => {
  await stock('3526', treeReady)
  const t = await txt('#s-p2'); must(/需複核/.test(t) && /趨勢惡化/.test(t) && /RGS006/.test(t), t.slice(0, 160)); return ''
})
await check('1799：財務複核標記與來源（規則、項目、期別）', async () => {
  await stock('1799', treeReady)
  const h = await p.$eval('#s-title', (x) => x.innerHTML); must(/b-fin/.test(h) && /RGF003/.test(h) && /2025Q4/.test(h), '標題：' + h.slice(0, 200)); return ''
})
await check('1410：資格否決標記與來源項目', async () => {
  await stock('1410', treeReady)
  const h = await p.$eval('#s-title', (x) => x.innerHTML); must(/b-veto/.test(h) && /K006|DAR-S/.test(h), '標題：' + h.slice(0, 200)); return ''
})
await check('1589／3718：未評估（沒有分數樹）顯示無法評估', async () => {
  for (const id of ['1589', '3718']) {
    await p.goto(BASE + '#/stock/' + id + '/home'); await p.waitForFunction(() => /尚無足夠已驗收財報/.test(document.querySelector('#s-tree')?.innerText || ''), null, { timeout: 30000 })
    must(/第二階段：無法評估/.test(await txt('#s-p2')), id + ' 第二階段：' + await txt('#s-p2'))
    must(!/undefined|NaN/.test(await txt('#pg-stock')), id + ' 含 undefined／NaN')
  } return ''
})
await check('1102 估價只有中心值、1101 不適用、2882 金融業不適用', async () => {
  await stock('1102', treeReady); must(/只提供中心值/.test(await txt('#s-valcard')), '1102：' + (await txt('#s-valcard')).slice(0, 200))
  await stock('1101', treeReady); must(/估價不適用/.test(await txt('#s-valcard')), '1101 沒有「估價不適用」')
  await stock('2882', treeReady); must(/金融保險業/.test(await txt('#s-valcard')), '2882 沒有金融保險業說明'); return ''
})
await check('資料層：節點有分析目的、定義、同業名次（2330 全部 109 個節點）', async () => {
  await p.goto(BASE); await p.waitForFunction(() => window.KupeiAPI, null, { timeout: 30000 })
  const r = await p.evaluate(async () => {
    const c = await window.KupeiAPI.company('2330'); const all = []
    const walk = (n) => { all.push(n); (n.c || []).forEach(walk) }; c.tree.forEach(walk)
    return { n: all.length, goal: all.filter((x) => x.goal).length, def: all.filter((x) => x.def).length, peer: all.filter((x) => x.peer.has).length, ranked: all.filter((x) => x.peer.status === 'RANKED' && x.peer.rank != null && x.peer.pop != null).length }
  })
  must(r.n === 109, '節點數 ' + r.n); must(r.goal === 109 && r.def === 109, '目的 ' + r.goal + '／定義 ' + r.def); must(r.peer === 109 && r.ranked > 50, '同業名次 ' + r.peer + '／' + r.ranked); return JSON.stringify(r)
})
await check('資料層：首頁每列都有第二階段處置（未評估 2 家無）', async () => {
  const r = await p.evaluate(async () => {
    const h = await window.KupeiAPI.home(); const by = {}
    h.rows.forEach((x) => { const k = x.assessed ? x.p2 : 'NA'; by[k] = (by[k] || 0) + 1 }); return { n: h.rows.length, by }
  })
  must(r.n === 1979, '列數 ' + r.n); must(r.by['Review Required'] === 823 && r.by['Allow with Warning'] === 763 && r.by['Allow'] === 391 && r.by['NA'] === 2, JSON.stringify(r.by)); return JSON.stringify(r.by)
})
await check('說明頁：取自 help.json（109 項，含公式與分析目的）', async () => {
  const n = await p.evaluate(async () => { const r = await window.KupeiAPI.req('GET', '/help'); return r.ok ? r.data.features.length : -1 })
  must(n === 109, 'help 項數 ' + n)
  await p.goto(BASE + '#/help'); await p.waitForFunction(() => /V3\.0\.30/.test(document.querySelector('#pg-help')?.innerText || ''), null, { timeout: 30000 })
  must(!/undefined|NaN/.test(await txt('#pg-help')), '說明頁含 undefined／NaN'); return ''
})
await check('狀態頁：估價啟用、第二階段分布、公司數', async () => {
  await p.goto(BASE + '#/status'); await p.waitForFunction(() => /估價基準日 2026/.test(document.querySelector('#st-kv')?.innerText || ''), null, { timeout: 30000 })
  const t = await txt('#st-kv')
  must(/全市場估價 啟用｜估價基準日 2026-10-22/.test(t), '估價列：' + t.slice(t.indexOf('全市場估價'), t.indexOf('全市場估價') + 60))
  must(/需複核 823/.test(t) && /注意警示 763/.test(t) && /可供判讀 391/.test(t), '第二階段分布：' + t.slice(t.indexOf('第二階段處置'), t.indexOf('第二階段處置') + 60))
  must(/1979 家（已評估 1977、未評估 2；可排名 1684/.test(t), '公司數'); return ''
})
await b.close()
for (const e of [...new Set(errs)]) results.push(['FAIL', '瀏覽器錯誤', e])
for (const [s, n, note] of results) console.log(s + '  ' + n + (note ? '｜' + note : ''))
const fail = results.filter((r) => r[0] === 'FAIL').length
console.log(fail ? '\n失敗 ' + fail + ' 項' : '\n全部通過（' + results.length + ' 項）')
