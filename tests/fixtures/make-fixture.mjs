// 產生瀏覽器測試用的固定測試資料 tests/fixtures/kupei-data.json（2026-10-28 登入閘門）。
//   node tests/fixtures/make-fixture.mjs
// 內容是「合成」的：150 家公司（含測試會點到的 2330、2317、1101…）、12 個大項、6 家有三層明細樹，
// 形狀照 docs/backend-api/KuPei-API.md 附錄 A（manifest、summary、tr、vparams、nodes、help、valuation、
// details、/api/market/latest、/api/market/history）。數字是固定亂數種子產生的假資料，不是線上資料，也不含任何權杖。
// 需要對線上真實資料跑的測試，改用 KUPEI_TEST_SESSION（見 tests/_kupei_test.mjs）。
import fs from 'node:fs'
import path from 'node:path'

let seed = 20261028
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (a) => a[Math.floor(rnd() * a.length)]
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d

const RUN = 'fixture_v3_0_30_20261027'
const MAJORS = [
  ['DAR-L', '償債能力', 'Debt And Repayment - Long'], ['PRF', '獲利能力', 'Profitability'], ['GRW', '成長性', 'Growth'],
  ['CSH', '現金流量', 'Cash Flow'], ['LEV', '財務槓桿', 'Leverage'], ['EFF', '經營效率', 'Efficiency'],
  ['VAL', '評價水準', 'Valuation'], ['DIV', '股利政策', 'Dividend'], ['GOV', '公司治理', 'Governance'],
  ['RSK', '風險', 'Risk'], ['MOM', '動能', 'Momentum'], ['STB', '穩定性', 'Stability'],
].map(([id, zh]) => ({ id, en: id, zh, goal: `評估公司的${zh}` })) // en 用代碼（同線上：分數格提示顯示「DAR-L：…」）

const NAMED = {
  2330: ['台積電', '半導體業'], 2317: ['鴻海', '其他電子業'], 2454: ['聯發科', '半導體業'], 2308: ['台達電', '電子零組件業'],
  2303: ['聯電', '半導體業'], 1101: ['台泥', '水泥工業'], 1102: ['亞泥', '水泥工業'], 1103: ['嘉泥', '水泥工業'],
  1589: ['永冠-KY', '電機機械'], 3718: ['碩天', '電機機械'], 2882: ['國泰金', '金融保險業'], 2881: ['富邦金', '金融保險業'],
  6505: ['台塑化', '油電燃氣業'], 5274: ['信驊', '半導體業'], 3526: ['凡甲', '電子零組件業'], 1799: ['易威', '生技醫療業'],
  1410: ['南染', '紡織纖維'], 2412: ['中華電', '通信網路業'], 1301: ['台塑', '塑膠工業'], 2002: ['中鋼', '鋼鐵工業'],
}
const IND = ['半導體業', '電子零組件業', '其他電子業', '水泥工業', '食品工業', '塑膠工業', '紡織纖維', '電機機械', '生技醫療業', '航運業']
const codes = Object.keys(NAMED)
for (let n = 1200; codes.length < 150; n += 37) if (!codes.includes(String(n))) codes.push(String(n))
codes.sort()
const nameOf = (c, i) => NAMED[c]?.[0] ?? (i % 4 === 0 ? `台測${i}` : `測試${i}`)
const indOf = (c) => NAMED[c]?.[1] ?? pick(IND)
const UNASSESSED = new Set(['1589', '3718'])
const FIN = (ind) => ind === '金融保險業'
const DETAILS = ['2330', '2317', '1101', '2454', '2308', '6505', '5274']

/* ---- 樹（每家明細都同一棵：12 大項 × 3 中項 × 2 小項） ---- */
const tree = [] // [{ id, en, zh, w, c: [...] }]
for (const m of MAJORS) {
  const kids = []
  for (let j = 1; j <= 3; j++) {
    const leaves = []
    for (let k = 1; k <= 2; k++) leaves.push({ id: `${m.id}.${j}.${k}`, en: `${m.en} ${j}.${k}`, zh: `${m.zh}指標 ${j}-${k}`, w: 0.5 })
    kids.push({ id: `${m.id}.${j}`, en: `${m.en} ${j}`, zh: `${m.zh}子項 ${j}`, w: round(1 / 3, 4), c: leaves })
  }
  tree.push({ id: m.id, en: m.en, zh: m.zh, w: round(1 / 12, 4), c: kids })
}
const allNodes = []
const walk = (n, parent, lv) => { allNodes.push({ ...n, parent, lv }); for (const c of n.c || []) walk(c, n.id, lv + 1) }
tree.forEach((n) => walk(n, null, 1))

/* ---- summary ---- */
const companies = codes.map((c, i) => {
  const ind = indOf(c)
  const fin = FIN(ind)
  const assessed = !UNASSESSED.has(c)
  const maj = MAJORS.map(() => {
    if (!assessed) return [null, '', null, 0, 0, 'MISSING_ROW', 0, 0]
    if (fin) return [null, '', null, 0, 0, 'OUT_OF_SCOPE_FINANCIAL', 0, 0]
    return [round(30 + rnd() * 70, 1), '', null, 0, 0, rnd() < 0.08 ? 'POLICY_SCORE' : 'TRIAL_SCORE', Math.floor(rnd() * 3), 0]
  })
  return { c, i, name: nameOf(c, i), ind, fin, assessed, maj, total: assessed && !fin ? maj.reduce((a, m) => a + (m[0] ?? 0), 0) : null }
})
const ranked = companies.filter((x) => x.total != null).sort((a, b) => b.total - a.total || a.c.localeCompare(b.c))
ranked.forEach((x, r) => (x.rank = r + 1))
MAJORS.forEach((_, mi) => {
  const by = companies.filter((x) => x.maj[mi][0] != null).sort((a, b) => b.maj[mi][0] - a.maj[mi][0])
  by.forEach((x, r) => (x.maj[mi][2] = r + 1))
})
const veto = (x) => x.assessed && !x.fin && x.i % 17 === 3
const finrev = (x) => x.assessed && !x.fin && x.i % 13 === 5
const rows = companies.map((x) => [
  x.c, x.name, x.ind, x.fin ? 1 : 0, x.rank ?? null, x.maj.filter((m) => m[3] === 1).length,
  x.maj, veto(x) ? 1 : 0, veto(x) ? ['RSK.1'] : [], finrev(x) ? 1 : 0, finrev(x) ? ['CSH.2'] : [],
])
const P2 = [['Allow', '允許'], ['Allow with Warning', '允許（附警示）'], ['Review Required', '需要複核']]
const company_meta = Object.fromEntries(companies.map((x) => {
  const [a, zh] = x.assessed ? P2[x.i % 3] : ['NA', '無法評估']
  return [x.c, {
    assessment_status: x.assessed ? 'ASSESSED' : 'NOT_ASSESSED', phase2_company_action: a, phase2_company_action_zh: zh,
    phase2_assessment_status: x.assessed ? 'ASSESSED' : 'NOT_ASSESSED', phase2_review_category: a === 'Review Required' ? 'FIN' : null,
    phase2_review_reasons: a === 'Review Required' ? [{ code: 'R_FIN_REVIEW', message_zh: '財務數據需要人工複核' }] : [],
    financial_review_sources: finrev(x) ? ['CSH.2'] : [], eligibility_veto_features: veto(x) ? ['RSK.1'] : [],
  }]
}))
const nonFin = companies.filter((x) => !x.fin && x.assessed).length
const summary = {
  head: {
    requested_period: '2026Q2', annual_period: '2025', spec_version: 'V3.0.30', as_of: '2026-10-27', source_run: RUN,
    rank_population: MAJORS.map(() => nonFin),
    counts: { records: companies.length, ranked: ranked.length, NR: companies.length - ranked.length, veto: companies.filter(veto).length, fin_review: companies.filter(finrev).length },
    gate_overlay: { execution_mode: 'ADVISORY', production_enabled: false, source: 'fixture', policy: 'fixture' },
  },
  majors: MAJORS, rows, company_meta,
}

/* ---- 其他批次檔 ---- */
const tr = { R_LOW: '分數低於同業', R_MISSING: '資料不足', R_FIN_REVIEW: '財務數據需要人工複核', WARN: '警示', HIGH: '高', REVIEW: '複核' }
const vparams = [
  ['center', '估價中心', 'Center', '依現金流折現', '元', '', '', '', '', ''],
  ['margin', '安全邊際', 'Margin of safety', '（中心−股價）÷中心', '%', '', '', '', '', ''],
]
const nodes = Object.fromEntries(allNodes.map((n) => [n.id, n.en]))
const help = {
  calculation_spec_version: 'V3.0.30', presentation_spec_version: 'P-2026-10',
  features: allNodes.map((n) => ({
    feature_id: n.id, item: n.en, definition_zh: n.zh, full_name: `${n.en}（${n.zh}）`, goal_zh: `衡量${n.zh}`,
    formula_display: `${n.id} = A ÷ B`, direction: 'HIGHER_BETTER', benchmark: '同業中位數', parent_id: n.parent, parent_weight: n.parent ? n.w : null,
  })),
}

/* ---- 行情 ---- */
const DAYS = []
for (let d = new Date('2026-09-28T00:00:00Z'); DAYS.length < 20; d = new Date(d.getTime() + 864e5)) if (d.getUTCDay() % 6) DAYS.push(d.toISOString().slice(0, 10))
const lastDay = DAYS[DAYS.length - 1]
const price0 = Object.fromEntries(codes.map((c) => [c, c === '2330' ? 1450 : c === '5274' ? 4200 : round(10 + rnd() * 600, 2)]))
const history = { quotes: {}, revenue: {} }
const quotes = {}
for (const c of codes) {
  let p = price0[c]
  const q = DAYS.map((d) => { p = round(p * (1 + (rnd() - 0.5) * 0.04), p >= 1000 ? 0 : 2); return [d, p, Math.floor(1e5 + rnd() * 5e7)] })
  history.quotes[c] = q
  history.revenue[c] = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((m) => [m, Math.floor(1e5 + rnd() * 1e8), round((rnd() - 0.4) * 60, 2)])
  const [, close, vol] = q[q.length - 1]
  quotes[c] = c === '1103' ? [null, null, 0] : [close, round(close - q[q.length - 2][1], 2), vol]
}
const latest = { dates: { L: lastDay, O: lastDay }, source: { L: 'exchange', O: 'exchange' }, quotes }

/* ---- 估價（UI 形狀） ---- */
const vcomp = {}
for (const x of companies) {
  if (x.fin) { vcomp[x.c] = { status: 'NOT_APPLICABLE', center: null, lower: null, upper: null, data_cap: null, implied_growth: null, implied_growth_flag: null, reason_codes: ['FINANCIAL_SECTOR'], flags: [] }; continue }
  if (!x.assessed) { vcomp[x.c] = { status: 'UNAVAILABLE', center: null, lower: null, upper: null, data_cap: null, implied_growth: null, implied_growth_flag: null, reason_codes: ['R_MISSING'], flags: [] }; continue }
  const close = quotes[x.c][0] ?? price0[x.c]
  const center = round(close * (0.7 + rnd() * 0.7), close >= 1000 ? 0 : 2)
  vcomp[x.c] = {
    status: 'OK', center, lower: round(center * 0.8, 2), upper: round(center * 1.25, 2), data_cap: round(center * 1.6, 2),
    implied_growth: round(rnd() * 0.2, 4), implied_growth_flag: null, reason_codes: [], flags: x.i % 5 === 0 ? ['HIGH_GROWTH_ASSUMPTION'] : [],
  }
}
const valuation = {
  valuation_date: '2026-10-24', companies: vcomp,
  dataset_limitations: [{ code: 'FIXTURE', message_zh: '測試用的合成資料' }],
  translations: { HIGH_GROWTH_ASSUMPTION: '隱含成長率偏高', FINANCIAL_SECTOR: '金融保險業不適用', R_MISSING: '資料不足' },
}

/* ---- 明細 ---- */
const details = {}
for (const c of DETAILS) {
  const row = companies.find((x) => x.c === c)
  const conv = (n, lv, mi) => {
    const base = lv === 1 ? row.maj[mi][0] : round(30 + rnd() * 70, 1)
    return {
      id: n.id, en: n.en, zh: n.zh, w: n.w, p: '2026Q2', s: base, st: 'TRIAL_SCORE', r: rnd() < 0.2 ? ['R_LOW'] : [], src: [], below: 0,
      rd: lv === 2 && rnd() < 0.15 ? [['G-1', 'R_LOW', 'WARN', 'HIGH', 'REVIEW', '', '', 1, n.id, '2026Q2']] : [],
      goal: `衡量${n.zh}`, definition: `${n.zh}的定義（測試資料）`, display_code: '',
      ...(lv === 1 ? { mr: row.maj[mi][2] } : {}),
      ...(lv <= 2 ? { peer_group: row.ind, peer_rank: 1 + Math.floor(rnd() * 20), peer_rank_population: 20, peer_rank_status: 'RANKED' } : {}),
      c: (n.c || []).map((k) => conv(k, lv + 1, mi)),
    }
  }
  details[c] = tree.map((n, mi) => conv(n, 1, mi))
}

const manifest = {
  run: RUN, published_at: '2026-10-27T10:00:00Z', source_file: 'fixture.json', details: DETAILS,
  hashes: { summary: 'fx-sum-1', vparams: 'fx-vp-1', tr: 'fx-tr-1', nodes: 'fx-nodes-1', help: 'fx-help-1', valuation: 'fx-val-1' },
  status_notes: { translations: 'fixture', spec_current: 'V3.0.30', sources: [] },
}

const out = { _note: '合成的測試資料（tests/fixtures/make-fixture.mjs 產生），不是線上資料', manifest, files: { summary, tr, vparams, nodes, help, valuation }, details, latest, history }
const file = path.join(path.dirname(new URL(import.meta.url).pathname), 'kupei-data.json')
fs.writeFileSync(file, JSON.stringify(out))
console.log(`${path.relative(process.cwd(), file)}：${companies.length} 家、明細 ${DETAILS.length} 家、${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
