import './style.css'
import { createKupeiClient, fmtPrice, hasScore, KupeiError, quoteOf, rankPercentile } from './kupei-client'
import type { Dataset } from './kupei-client'
import type { Company, LatestResponse, SessionInfo } from './kupei-types'

const client = createKupeiClient({
  baseUrl: import.meta.env.VITE_KUPEI_BASE || 'https://kupei-dashboard.tmac19920626.workers.dev',
  token: import.meta.env.VITE_KUPEI_TOKEN || '',
  // 登入、登出、登入權杖被後端判定失效（過期、在別處登出）都會通知
  onSessionChange: (s) => onSessionChange(s),
})
// 評分與行情同時開跑（彼此不等）；回訪時先用快取的批次還原畫面，背景核對到新批次再換
client.preload({ onUpdate: onBatchUpdate })

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// 排序：'rank'（預設）、'price'、或大項索引。方向 -1＝高→低、1＝低→高（欄頭點擊循環，見 KuPei-API.md 附錄 B）
let ds: Dataset
let latest: LatestResponse | null = null
let sortKey: 'rank' | 'price' | number = 'rank'
let sortDir: -1 | 1 = -1
let keyword = ''
let onlyWatch = false

// ── 自選：本機永遠有一份（localStorage）；登入（或有寫入權杖）時以雲端為準並同步（KuPei-API.md「帳號」「雲端文件」）──
const WATCH_LOCAL = 'kupei-pages:watchlist'
const WATCH_KEY = 'watchlist'
interface Watch {
  ids: string[]
}
let watch: Watch = readLocalWatch()

function readLocalWatch(): Watch {
  try {
    const raw = localStorage.getItem(WATCH_LOCAL)
    const v = raw ? (JSON.parse(raw) as Partial<Watch>) : null
    return { ids: Array.isArray(v?.ids) ? v!.ids.filter((x) => typeof x === 'string') : [] }
  } catch {
    return { ids: [] }
  }
}
function saveLocalWatch() {
  try {
    localStorage.setItem(WATCH_LOCAL, JSON.stringify(watch))
  } catch {
    /* 隱私模式等情況存不進去 */
  }
}
function toggled(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

let toastTimer = 0
function toast(msg: string) {
  const el = $('notice')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000)
}

/** 有沒有雲端可同步：登入帳號，或進階的寫入權杖 */
const cloudOn = () => client.getSession() !== null || client.hasWriteToken()

/** 右上角的狀態：未登入顯示「登入」；登入顯示帳號名＋登出；只有寫入權杖時顯示「寫入權杖」 */
function renderAccount() {
  const s = client.getSession()
  const label = $('sync-state')
  label.textContent = s ? s.username : client.hasWriteToken() ? '雲端同步：寫入權杖' : '登入'
  label.title = s ? `已登入 ${s.username}` : ''
  $('auth-form').hidden = !!s
  $('account-in').hidden = !s
  $('account-name').textContent = s?.username ?? ''
  $('logout').hidden = !s
  if (!cloudOn()) syncState('off', '未登入，自選只存在這台裝置。')
}

function syncState(state: 'off' | 'on' | 'err', msg = '') {
  $('sync-state').className = `sync ${state === 'off' ? '' : state}`
  $('sync-msg').textContent = msg
}

/** 登入：雲端有資料就以雲端為準；雲端沒有、本機有就把本機帶上去 */
async function pullWatch() {
  if (!cloudOn()) {
    renderAccount()
    return
  }
  const viaSession = client.getSession() !== null
  try {
    const cloud = await client.store.get<Watch>(WATCH_KEY)
    if (cloud.data) {
      watch = { ids: Array.isArray(cloud.data.ids) ? cloud.data.ids : [] }
      saveLocalWatch()
    } else if (watch.ids.length) {
      await client.store.put(WATCH_KEY, watch, 0)
      toast(viaSession ? '已把這台裝置的自選存到帳號' : '已把這台裝置的自選上傳到雲端')
    }
    syncState('on', `雲端版本 ${cloud.data ? cloud.version : 1}，${new Date().toLocaleTimeString()} 同步`)
  } catch (e) {
    if (e instanceof KupeiError && e.unauthenticated) {
      // 登入權杖失效：客戶端已清掉 session，onSessionChange 會處理提示
      if (!viaSession) syncState('err', '寫入權杖無效：請重新貼上正確的寫入權杖。自選暫時只存在這台裝置。')
    } else syncState('err', `同步失敗：${e instanceof Error ? e.message : String(e)}。自選暫時只存在這台裝置。`)
  }
  if (ds) renderBody()
}

async function toggleWatch(id: string) {
  watch = { ids: toggled(watch.ids, id) }
  saveLocalWatch()
  renderBody()
  if (!cloudOn()) return
  try {
    // 讀→改→寫：拿雲端最新的清單套用同一個切換，別台裝置剛改過也不會被蓋掉
    const doc = await client.store.update<Watch>(WATCH_KEY, (cur) => ({ ids: toggled(cur?.ids ?? [], id) }))
    watch = doc.data ?? watch
    saveLocalWatch()
    renderBody()
    syncState('on', `雲端版本 ${doc.version}，${new Date().toLocaleTimeString()} 同步`)
  } catch (e) {
    if (e instanceof KupeiError && e.unauthenticated && !client.getSession() && !client.hasWriteToken()) return // 已由 onSessionChange 提示
    syncState('err', `寫入失敗：${e instanceof KupeiError ? `${e.message}（${e.status}）` : String(e)}`)
  }
}

// ── 登入／註冊 ──
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/
let authMode: 'login' | 'register' = 'login'
let authBusy = false
/** 自己按登出時為 true；onSessionChange(null) 用它分辨「登出」與「被後端判定失效」 */
let selfLogout = false

function setAuthMode(mode: 'login' | 'register') {
  authMode = mode
  const reg = mode === 'register'
  $('mode-login').setAttribute('aria-pressed', String(!reg))
  $('mode-register').setAttribute('aria-pressed', String(reg))
  $('auth-confirm').hidden = !reg
  $<HTMLInputElement>('auth-pass').autocomplete = reg ? 'new-password' : 'current-password'
  $('auth-submit').textContent = reg ? '建立帳號' : '登入'
  authError('')
}

function authError(msg: string, field?: 'auth-user' | 'auth-pass' | 'auth-pass2') {
  $('auth-err').textContent = msg
  for (const id of ['auth-user', 'auth-pass', 'auth-pass2']) {
    if (id === field) $(id).setAttribute('aria-invalid', 'true')
    else $(id).removeAttribute('aria-invalid')
  }
  if (field) $(field).focus()
}

/** 後端錯誤碼 → 中文提示（KuPei-API.md「帳號」） */
function authErrorText(e: unknown): string {
  if (e instanceof KupeiError) {
    if (e.code === 'USERNAME_TAKEN') return '這個帳號已被使用，請換一個。'
    if (e.code === 'INVALID_CREDENTIALS') return '帳號或密碼錯誤。'
    if (e.code === 'RATE_LIMITED' || e.rateLimited) return `嘗試太頻繁，請 ${e.retryAfter ?? 30} 秒後再試。`
    if (e.code === 'BAD_REQUEST') return '帳號或密碼格式不對。'
    return `登入服務發生錯誤（${e.status}），請稍後再試。`
  }
  return '網路錯誤，無法連線到登入服務，請檢查網路後再試。'
}

async function submitAuth() {
  if (authBusy) return
  const userEl = $<HTMLInputElement>('auth-user')
  const passEl = $<HTMLInputElement>('auth-pass')
  const pass2El = $<HTMLInputElement>('auth-pass2')
  const username = userEl.value.trim().toLowerCase()
  userEl.value = username
  const password = passEl.value
  if (username.length < 3 || username.length > 32) return authError('帳號要 3～32 字。', 'auth-user')
  if (!USERNAME_RE.test(username)) return authError('帳號只能用小寫英文、數字與 _ . -，而且開頭要是英文或數字。', 'auth-user')
  if (password.length < 8 || password.length > 128) return authError('密碼要 8～128 字。', 'auth-pass')
  if (authMode === 'register' && pass2El.value !== password) return authError('兩次輸入的密碼不一樣。', 'auth-pass2')
  authError('')
  authBusy = true
  const btn = $<HTMLButtonElement>('auth-submit')
  btn.disabled = true
  btn.textContent = authMode === 'register' ? '建立中…' : '登入中…'
  try {
    if (authMode === 'register') await client.auth.register(username, password)
    else await client.auth.login(username, password)
    passEl.value = ''
    pass2El.value = ''
    toast(authMode === 'register' ? `帳號 ${username} 已建立並登入` : `已登入 ${username}`)
    setAuthMode('login')
    ;($('settings') as HTMLDetailsElement).open = false
    syncState('off', '同步中…')
    await pullWatch()
  } catch (e) {
    authError(authErrorText(e))
  } finally {
    authBusy = false
    btn.disabled = false
    btn.textContent = authMode === 'register' ? '建立帳號' : '登入'
  }
}

function onSessionChange(s: SessionInfo | null) {
  renderAccount()
  if (s || selfLogout) return
  // 不是自己按登出：登入權杖過期、在別處登出或帳號被停用 → 回到未登入
  syncState('err', '登入已過期，請重新登入。自選暫時只存在這台裝置。')
  toast('登入已過期，請重新登入')
  if (client.hasWriteToken()) void pullWatch()
}

async function logout() {
  selfLogout = true
  try {
    await client.auth.logout()
  } finally {
    selfLogout = false
  }
  renderAccount()
  toast('已登出；自選改為只存在這台裝置')
  if (client.hasWriteToken()) void pullWatch()
}

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
    '<tr><th class="star" title="自選">★</th>' +
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
  const set = new Set(watch.ids)
  const list = sorted(
    ds.market.filter(
      (c) => (!onlyWatch || set.has(c.id)) && (!k || c.id.includes(k) || c.name.toLowerCase().includes(k) || c.ind.toLowerCase().includes(k)),
    ),
  )
  $('count').textContent = `${list.length.toLocaleString()} 家${watch.ids.length ? `｜自選 ${watch.ids.length}` : ''}`
  $('tbody').innerHTML = list
    .map((c) => {
      const q = quoteOf(latest, c.id)
      const cls = q?.pct == null ? 'flat' : q.pct > 0.005 ? 'up' : q.pct < -0.005 ? 'down' : 'flat'
      const tags = (c.veto ? '<span class="tag" title="資格否決">否決</span>' : '') + (c.finrev ? '<span class="tag" title="財務複核">複核</span>' : '')
      const on = set.has(c.id)
      return (
        `<tr><td class="star${on ? ' on' : ''}" data-id="${esc(c.id)}" title="${on ? '移出自選' : '加入自選'}">${on ? '★' : '☆'}</td>` +
        `<td>${c.rank ?? 'NR'}</td><td class="l id">${esc(c.id)}</td><td class="l">${esc(c.name)}${tags}</td><td class="l">${esc(c.ind)}</td>` +
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

function renderMeta() {
  const h = ds.head
  const d = latest?.dates
  $('meta').textContent =
    `規格 ${h.spec_version}｜分析期別 ${h.requested_period}（年報 ${h.annual_period}）｜資料可得日 ${h.as_of}｜批次 ${ds.manifest.run}｜` +
    `${h.counts.records.toLocaleString()} 家（可排名 ${h.counts.ranked.toLocaleString()}）｜` +
    `收盤 ${d ? [d.L && `上市 ${d.L}`, d.O && `上櫃 ${d.O}`].filter(Boolean).join('、') : '行情未載入'}`
}

/** 背景核對發現換了批次（loadDataset 的 onUpdate） */
function onBatchUpdate(next: Dataset) {
  ds = next
  renderMeta()
  render()
  toast(`評分資料已更新到批次 ${next.manifest.run}`)
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
$('tbody').addEventListener('click', (e) => {
  const td = (e.target as HTMLElement).closest('td.star') as HTMLElement | null
  if (td?.dataset.id) void toggleWatch(td.dataset.id)
})
$('q').addEventListener('input', (e) => { keyword = (e.target as HTMLInputElement).value; renderBody() })
$('only-watch').addEventListener('change', (e) => { onlyWatch = (e.target as HTMLInputElement).checked; renderBody() })
$('token-save').addEventListener('click', () => {
  const v = $<HTMLInputElement>('write-token').value.trim()
  if (!v) return
  client.setWriteToken(v)
  $<HTMLInputElement>('write-token').value = ''
  renderAccount()
  syncState('off', client.getSession() ? '已存寫入權杖；登入帳號時以帳號為準。' : '連線中…')
  if (!client.getSession()) void pullWatch()
})
$('token-clear').addEventListener('click', () => {
  client.setWriteToken(null)
  renderAccount()
  if (!client.getSession()) syncState('off', '已清除這台裝置的寫入權杖；自選改為只存本機。')
})
$('mode-login').addEventListener('click', () => setAuthMode('login'))
$('mode-register').addEventListener('click', () => setAuthMode('register'))
$('auth-form').addEventListener('submit', (e) => {
  e.preventDefault()
  void submitAuth()
})
// 帳號不分大小寫，一律轉小寫（保留游標位置）
$('auth-user').addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement
  const lower = el.value.toLowerCase()
  if (lower !== el.value) {
    const pos = el.selectionStart
    el.value = lower
    if (pos != null) el.setSelectionRange(pos, pos)
  }
})
$('settings').addEventListener('toggle', () => {
  if (($('settings') as HTMLDetailsElement).open && !client.getSession()) $('auth-user').focus()
})
$('logout').addEventListener('click', () => void logout())

// 重新整理：用本機記住的登入狀態直接還原（不等網路），自選在評分資料載入後背景同步
renderAccount()

async function main() {
  try {
    // 行情是加值：失敗不擋評分表
    const [data] = await Promise.all([
      client.loadDataset({ onUpdate: onBatchUpdate }),
      client.marketLatest().then((l) => (latest = l)).catch((e) => console.warn('[kupei] 行情載入失敗', e)),
    ])
    ds = data
    renderMeta()
    render()
    void pullWatch()
  } catch (e) {
    fail(e)
  }
}
void main()
