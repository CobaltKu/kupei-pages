import './style.css'
import { createKupeiClient, fmtPrice, hasScore, KupeiError, quoteOf, rankPercentile } from './kupei-client'
import type { Dataset } from './kupei-client'
import type { Company, LatestResponse } from './kupei-types'

const client = createKupeiClient({
  baseUrl: import.meta.env.VITE_KUPEI_BASE || 'https://kupei-dashboard.tmac19920626.workers.dev',
  token: import.meta.env.VITE_KUPEI_TOKEN || '',
})

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// 排序：'rank'（預設）、'price'、或大項索引。方向 -1＝高→低、1＝低→高（欄頭點擊循環，見 KuPei-API.md 附錄 B）
let ds: Dataset
let latest: LatestResponse | null = null
let sortKey: 'rank' | 'price' | number = 'rank'
let sortDir: -1 | 1 = -1
let keyword = ''

function fail(e: unknown) {
  const box = $('error')
  let msg = '資料載入失敗。'
  if (e instanceof KupeiError) {
    if (e.unauthenticated) msg = '權杖無效或未設定（401）：請檢查部署用的 GitHub secret VITE_KUPEI_TOKEN。'
    else if (e.rateLimited) msg = `請求太頻繁（429），請 ${e.retryAfter ?? 30} 秒後重新整理。`
    else if (e.forbidden) msg = '這個路徑不開放（403）。'
    else msg = `${e.message}（HTTP ${e.status}）`
  } else if (e instanceof TypeError) {
    msg = '無法連線到資料服務：可能是網路中斷，或這個網址尚未加入後端 CORS 白名單。'
  } else if (e instanceof Error) {
    msg = e.message
  }
  box.textContent = msg
  box.hidden = false
  $('meta').textContent = ''
}

function majorValue(c: Company, i: number): number | null {
  const m = c.maj[i]
  return m && hasScore(m) ? m.s : null
}

function sorted(list: Company[]): Company[] {
  const out = [...list]
  const byRank = (a: Company, b: Company) =>
    (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id)
  if (sortKey === 'rank') return out.sort(byRank)
  const val = (c: Company) =>
    sortKey === 'price' ? (quoteOf(latest, c.id)?.close ?? null) : majorValue(c, sortKey as number)
  return out.sort((a, b) => {
    const x = val(a), y = val(b)
    if (x == null && y == null) return byRank(a, b)
    if (x == null) return 1 // 沒有值的永遠排最後
    if (y == null) return -1
    return (x - y) * sortDir || byRank(a, b)
  })
}

function renderHead() {
  const th = (label: string, key: 'rank' | 'price' | number, cls = '', title = '') =>
    `<th class="${cls}${sortKey === key ? ' on' : ''}" data-k="${key}" title="${esc(title)}">${esc(label)}${
      sortKey === key && key !== 'rank' ? (sortDir === -1 ? ' ↓' : ' ↑') : ''
    }</th>`
  $('thead').innerHTML =
    '<tr>' +
    th('名次', 'rank') +
    '<th class="l id">代號</th><th class="l">名稱</th><th class="l">產業</th>' +
    ds.majors.map((m, i) => th(m.zh, i, '', `${m.en}｜${m.goal}`)).join('') +
    th('收盤', 'price') +
    '<th>漲跌幅</th></tr>'
}

function cell(c: Company, i: number): string {
  const m = c.maj[i]
  if (!m || !hasScore(m)) return '<td class="flat">—</td>'
  const pct = rankPercentile(m.mr, ds.head.rank_population[i] ?? 0)
  const alpha = pct == null ? 0.08 + 0.52 * Math.min(Math.max(((m.s as number) - 30) / 70, 0), 1) : 0.08 + 0.52 * pct
  const top = m.mr != null && ds.head.rank_population[i] ? m.mr <= ds.head.rank_population[i] * 0.1 : false
  return `<td class="${top ? 'top' : ''}" style="background:rgba(58,128,228,${alpha.toFixed(2)})" title="大項名次 ${m.mr ?? 'NR'}${m.pol ? '｜政策分' : ''}">${(m.s as number).toFixed(1)}</td>`
}

function renderBody() {
  const k = keyword.trim().toLowerCase()
  const list = sorted(
    ds.market.filter((c) => !k || c.id.includes(k) || c.name.toLowerCase().includes(k) || c.ind.toLowerCase().includes(k)),
  )
  $('count').textContent = `${list.length.toLocaleString()} 家`
  $('tbody').innerHTML = list
    .map((c) => {
      const q = quoteOf(latest, c.id)
      const cls = q?.pct == null ? 'flat' : q.pct > 0.005 ? 'up' : q.pct < -0.005 ? 'down' : 'flat'
      const tags = (c.veto ? '<span class="tag" title="資格否決">否決</span>' : '') + (c.finrev ? '<span class="tag" title="財務複核">複核</span>' : '')
      return (
        `<tr><td>${c.rank ?? 'NR'}</td><td class="l id">${esc(c.id)}</td><td class="l">${esc(c.name)}${tags}</td><td class="l">${esc(c.ind)}</td>` +
        ds.majors.map((_, i) => cell(c, i)).join('') +
        `<td>${fmtPrice(q?.close)}</td><td class="${cls}">${q?.pct == null ? '—' : (q.pct > 0 ? '+' : '') + q.pct.toFixed(2) + '%'}</td></tr>`
      )
    })
    .join('')
}

function render() {
  renderHead()
  renderBody()
}

$('thead').addEventListener('click', (e) => {
  const th = (e.target as HTMLElement).closest('th[data-k]') as HTMLElement | null
  if (!th) return
  const key = th.dataset.k === 'rank' ? 'rank' : th.dataset.k === 'price' ? 'price' : Number(th.dataset.k)
  if (key === 'rank') { sortKey = 'rank'; sortDir = -1 }
  else if (sortKey !== key) { sortKey = key; sortDir = -1 }
  else if (sortDir === -1) sortDir = 1
  else { sortKey = 'rank'; sortDir = -1 } // 高→低、低→高、回總名次
  render()
})
$('q').addEventListener('input', (e) => { keyword = (e.target as HTMLInputElement).value; renderBody() })

async function main() {
  try {
    ds = await client.loadDataset()
    // 行情是加值：失敗不擋評分表
    try { latest = await client.marketLatest() } catch (e) { console.warn('[kupei] 行情載入失敗', e) }
    const h = ds.head
    const d = latest?.dates
    $('meta').textContent =
      `規格 ${h.spec_version}｜分析期別 ${h.requested_period}（年報 ${h.annual_period}）｜資料可得日 ${h.as_of}｜批次 ${ds.manifest.run}｜` +
      `${h.counts.records.toLocaleString()} 家（可排名 ${h.counts.ranked.toLocaleString()}）｜` +
      `收盤 ${d ? [d.L && `上市 ${d.L}`, d.O && `上櫃 ${d.O}`].filter(Boolean).join('、') : '行情未載入'}`
    render()
  } catch (e) {
    fail(e)
  }
}
void main()
