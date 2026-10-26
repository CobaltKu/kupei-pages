/*
 * KuPei Pages 前端橋接層（2026-10-26）。
 * 完整 UI（public/legacy/app.js，來自 Python/kupei_3/ui_web）原本讀私人 API /api/v1；Pages 版改讀後端 Server API：
 *   評分與明細  /data/<run>/…（summary、details、tr、vparams，選用 valuation、help）
 *   行情        /api/market/latest、/api/market/history（每日收盤，非即時）
 *   帳號與同步  /api/auth/*、/api/store/<key>（依帳號分開的雲端文件）
 * 這一層把它們轉成 UI 原本要的形狀（window.KupeiAPI），不重算任何分數、名次或 Gate；缺的資料就回「尚未提供」。
 * 自選、新聞與報告設定仍存本機（kupei3_*）；登入後以雲端文件同步（見下方 sync）。
 */
import './bridge.css'
import { createKupeiClient, KupeiError, quoteOf } from './kupei-client'
import type { Dataset } from './kupei-client'
import type { History as Hist, LatestResponse, TreeNode } from './kupei-types'

declare const __BUILD__: string

const BASE = import.meta.env.VITE_KUPEI_BASE || 'https://kupei-dashboard.tmac19920626.workers.dev'
const READ_TOKEN = import.meta.env.VITE_KUPEI_TOKEN || ''

type Json = Record<string, any>
type Reply = { ok: boolean; status: number; data: any }

/* 帳號視窗與同步狀態（放在最前面，避免 client 建立過程觸發 onSessionChange 時還沒初始化） */
let syncMsg = ''
let pushTimer = 0
let mode: 'login' | 'register' = 'login'
let acctOpen = false
let formMsg = ''
/** 註冊要不要邀請碼：null＝還不知道（config 沒回來或失敗時不擋，等後端回 INVITE_REQUIRED 再顯示欄位） */
let inviteRequired: boolean | null = null
let inviteLoading = false
let pwMsg = ''
let pwOk = false
let pwOpen = false
/** 改密碼成功後下一次重畫不還原輸入框（舊密碼不該留在畫面上） */
let wipeInputs = false

const client = createKupeiClient({
  baseUrl: BASE,
  token: READ_TOKEN,
  onSessionChange: (s) => {
    renderAcct()
    // 登入，或登入權杖失效／登出後改用寫入權杖：都走同一套換帳號判斷（pullAll 比對 owner）
    if (canSync()) void onLogin()
  },
})

/* ---------------- 資料轉換：Dataset → UI 形狀 ---------------- */

const DONE: Record<string, 1> = { MISSING_ROW: 1, NOT_ASSESSED: 1 }

function adaptHome(ds: Dataset): Json {
  const h = ds.head
  const rows = ds.companies.map((c) => {
    const assessed = !c.maj.every((m) => DONE[m.st])
    return {
      id: c.id, name: c.name, ind: c.ind, market: null,
      assessed, noteNA: assessed ? '' : '尚無足夠已驗收財報',
      fin: c.fin, rank: c.rank, rankCode: null, pc: c.pc,
      maj: c.maj.map((m) => ({ s: m.s, code: '', st: m.st, mr: m.mr, pol: m.pol, per: null })),
      veto: c.veto, finrev: c.finrev, vetoFeatures: c.vetoFrom, finSources: c.finSrc,
      p2: null, p2zh: null, p2cat: null, p2status: null,
      period: h.requested_period, annual: h.annual_period,
    }
  })
  return {
    head: {
      requested_period: h.requested_period, annual_period: h.annual_period, as_of: h.as_of,
      rank_population: h.rank_population, spec_version: h.spec_version,
    },
    majors: ds.majors.map((m) => ({ id: m.id, en: m.en })),
    rows,
  }
}

function gateNote(ds: Dataset, t: any[]): Json {
  const tr = (x: unknown) => (typeof x === 'string' ? (ds.tr[x] ?? x) : '')
  return {
    rule_id: t[0], reason_code: t[1], reason_zh: ds.tr[t[1]] ?? undefined,
    warning_channel_zh: tr(t[2]), severity_zh: tr(t[3]), action_zh: tr(t[4]),
    observation_period: t[9], feature_id: t[8],
  }
}

function adaptCompany(ds: Dataset, id: string, tree: TreeNode[] | null): Json {
  const row = ds.byId.get(id)
  const out: Json = {
    id, company: {}, assessed: true, noteNA: '',
    p2: null, p2zh: null, p2cat: null, p2status: null, p2reasons: [],
    vetoFeatures: row?.vetoFrom ?? [], finSources: row?.finSrc ?? [],
    majors: {}, tree: null, notesBy: {}, readyBy: {}, zhName: {}, parentOf: {},
  }
  if (!tree || !tree.length) return out
  const conv = (n: TreeNode, lv: number, parent: string | null): Json => {
    out.zhName[n.id] = n.zh
    out.parentOf[n.id] = parent
    if (n.src?.length) out.notesBy[n.id] = n.src.map((t) => gateNote(ds, t as any[]))
    if (n.rd?.length) out.readyBy[n.id] = n.rd.map((t) => gateNote(ds, t as any[]))
    if (lv === 1) out.majors[n.id] = { feature_id: n.id, market_rank: n.mr ?? null, inherited_triggered_count: n.below || 0 }
    return {
      id: n.id, en: n.en, zh: n.zh, goal: null, def: null, lv, w: n.w, p: n.p, st: n.st,
      s: n.s == null ? null : +n.s, code: '', stx: '', r: n.r || [], diag0: false,
      peer: { group: null, rank: null, pop: null, status: null, has: false }, pn: [],
      c: (n.c || []).map((x) => conv(x, lv + 1, n.id)),
    }
  }
  out.tree = tree.map((n) => conv(n, 1, null))
  return out
}

function adaptStatus(ds: Dataset, latest: LatestResponse | null): Json {
  const g = ds.head.gate_overlay
  const d = latest?.dates
  const day = d ? [d.L, d.O].filter(Boolean).sort().pop() : null
  return {
    status: 'PUBLISHED_UI', published: true,
    data_calculation_version: ds.head.spec_version, presentation_spec_version: ds.head.spec_version,
    gate_execution_mode: g?.execution_mode ?? null, production_enabled: g?.production_enabled ?? null,
    manifest_sha256: null,
    quotes: { enabled: !!latest, market_status: 'CLOSED', last_success_at: day ? `${day}T13:30:00+08:00` : null, calendar_basis: '每日收盤（非即時）' },
    history: { enabled: true, last_success_at: day ? `${day}T13:30:00+08:00` : null },
    valuation: { enabled: false },
    news: { enabled: false }, reports: { enabled: false }, backup: { enabled: false },
    ui_note_translations_version: ds.manifest.status_notes?.translations ?? null,
    batch: ds.manifest.run, published_at: ds.manifest.published_at,
  }
}

/* 後端選用檔：/data/<run>/valuation.json、help.json。沒有就回 404，UI 顯示「尚未提供」 */
async function dataFile(ds: Dataset, name: string): Promise<Reply> {
  try {
    const r = await fetch(`${BASE}/data/${ds.manifest.run}/${name}?v=${encodeURIComponent(ds.manifest.published_at)}`, {
      headers: READ_TOKEN ? { Authorization: `Bearer ${READ_TOKEN}` } : {},
    })
    if (!r.ok) return { ok: false, status: r.status, data: null }
    return { ok: true, status: 200, data: await r.json() }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

/* valuation.json 兩種形狀都收：已是 UI 形狀（含 companies）原樣用；Adem 草案 { 代號: [中心, 安全邊際, 下限, 上限, 隱含成長率, 數據上限, 狀態] } 轉換。 */
function adaptValuation(ds: Dataset, v: Json): Json {
  if (v && typeof v === 'object' && v.companies) return v
  const companies: Json = {}
  for (const [id, a] of Object.entries(v || {})) {
    if (!Array.isArray(a)) continue
    const [center, , lower, upper, growth, cap, status] = a as any[]
    companies[id] = {
      status: status ?? (center == null ? 'UNAVAILABLE' : 'OK'), center, lower, upper, data_cap: cap,
      implied_growth: growth, implied_growth_flag: null, reason_codes: [], flags: [],
    }
  }
  return { valuation_date: ds.head.as_of, companies, dataset_limitations: [], translations: {} }
}

/* ---------------- window.KupeiAPI（UI 的資料層介面） ---------------- */

const ok = (data: any): Reply => ({ ok: true, status: 200, data })
const no = (status = 404): Reply => ({ ok: false, status, data: null })
let datasetP: Promise<Dataset> | null = null
const loadDs = () => (datasetP ??= client.loadDataset())

async function req(method: string, path: string): Promise<Reply> {
  const m = method.toUpperCase()
  const [p, qs = ''] = path.split('?')
  try {
    if (m === 'GET' && p === '/quotes') {
      const latest = await client.marketLatest()
      const day = [latest.dates.L, latest.dates.O].filter(Boolean).sort().pop() ?? null
      const quotes: Json = {}
      for (const id of Object.keys(latest.quotes)) {
        const q = quoteOf(latest, id)
        if (!q) continue
        quotes[id] = {
          price: q.close, prev_close: q.close != null && q.change != null ? q.close - q.change : null,
          change: q.change, change_pct: q.pct, volume: q.volume, status: 'CLOSE', source_time: day ? `${day}T13:30:00+08:00` : null,
        }
      }
      return ok({ market_status: 'CLOSED', last_success_at: day ? `${day}T13:30:00+08:00` : null, trading_date: day, seq: 0, quotes })
    }
    if (m === 'GET' && p === '/market/history') {
      const ids = decodeURIComponent(new URLSearchParams(qs).get('ids') || '').split(',').filter(Boolean)
      const map: Map<string, Hist> = await client.marketHistory(ids)
      const companies: Json = {}
      for (const [id, h] of map) {
        companies[id] = {
          status: h.quotes.length ? 'OK' : 'UNAVAILABLE',
          daily: h.quotes.map(([date, close, vol]) => ({ date, close, volume: vol == null ? null : Math.round(vol / 1000) })),
          monthly_revenue: h.revenue.map(([month, revenue, yoy]) => ({ month, revenue, yoy: yoy == null ? null : yoy / 100 })),
          latest_announced_month: h.revenue.length ? h.revenue[h.revenue.length - 1][0] : null, reason_codes: [],
        }
      }
      return ok({ as_of: null, source: '公開資料（每日收盤）', companies })
    }
    if (m === 'GET' && p === '/valuation') {
      const ds = await loadDs()
      const r = await dataFile(ds, 'valuation.json')
      return r.ok ? ok(adaptValuation(ds, r.data)) : no(r.status || 404)
    }
    if (m === 'GET' && p === '/help') {
      const ds = await loadDs()
      const r = await dataFile(ds, 'help.json')
      return r.ok && r.data?.features ? r : no(404)
    }
  } catch (e) {
    return no(e instanceof KupeiError ? e.status : 502)
  }
  // 自選、設定、登入、新聞、報告、個股問題：Pages 版沒有對應的後端端點，UI 走本機模式或顯示「尚未提供」
  return no(404)
}

const api = {
  base: BASE,
  req,
  home: async () => adaptHome(await loadDs()),
  status: async () => {
    const ds = await loadDs()
    let latest: LatestResponse | null = null
    try { latest = await client.marketLatest() } catch { /* 行情是加值 */ }
    return adaptStatus(ds, latest)
  },
  notes: async () => {
    const ds = await loadDs()
    const m: Record<string, string> = {}
    for (const [k, v] of Object.entries(ds.tr)) if (typeof v === 'string' && v) m[k] = v
    return m
  },
  company: async (id: string) => {
    const ds = await loadDs()
    let tree: TreeNode[] | null = null
    try { tree = await client.loadDetail(id) } catch (e) { if (!(e instanceof KupeiError && e.status === 404)) throw e }
    return adaptCompany(ds, id, tree)
  },
}

/* ---------------- 雲端同步：本機三份資料 ⇄ 帳號的雲端文件 ---------------- */

/** 可以同步＝已登入帳號，或使用舊的寫入權杖（相容保留，Adem 說明之後以登入取代） */
const canSync = () => !!client.getSession() || client.hasWriteToken()
const syncUser = () => client.getSession()?.username ?? '寫入權杖'

const SYNC: Record<string, string> = { kupei3_watch: 'ui-watch', kupei3_news: 'ui-news', kupei3_report: 'ui-report' }
const META = 'kupei3_sync'
/**
 * owner＝本機這三份資料屬於哪個帳號（最後一次同步的帳號；寫入權杖算「寫入權杖」）。登出時不清，
 * 下次換另一個帳號（或寫入權杖）同步時靠它判斷要不要先把本機資料備份並改用雲端那份。
 */
interface Meta { owner?: string; versions: Record<string, number>; dirty: Record<string, boolean> }

function readMeta(): Meta {
  try {
    const v = JSON.parse(localStorage.getItem(META) || 'null')
    if (v && typeof v === 'object') {
      const versions = v.versions || {}
      // 舊版只記 user（登出會清掉）：有 user 就當 owner；沒有但同步過（有版本號）→ 不知道是誰，當成別人的資料
      const owner = v.owner ?? v.user ?? (Object.keys(versions).length ? '?' : undefined)
      return { owner, versions, dirty: v.dirty || {} }
    }
  } catch { /* 壞掉當作沒有 */ }
  return { versions: {}, dirty: {} }
}
const writeMeta = (m: Meta) => { try { localStorage.setItem(META, JSON.stringify(m)) } catch { /* ignore */ } }
const nativeSet = Storage.prototype.setItem

/**
 * frozen＝畫面已經用舊的本機資料開起來，而同步剛用雲端內容改寫了本機、正要重新載入。
 * 這段期間畫面送來的寫入是舊內容（會蓋掉剛載入的雲端資料、再被推上去），一律丟掉，也不推送。
 */
let frozen = false
let uiStarted = false

function installHook() {
  Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
    if (this === localStorage && SYNC[k] && frozen) return
    nativeSet.call(this, k, v)
    if (this === localStorage && SYNC[k] && canSync()) {
      const m = readMeta()
      m.dirty[k] = true
      writeMeta(m)
      window.clearTimeout(pushTimer)
      pushTimer = window.setTimeout(() => void pushDirty(), 1500)
    }
  }
}

interface CloudDoc { savedAt: string; value: string }
/** pullAll 改寫本機：畫面已啟動時先凍結，之後由呼叫端重新載入 */
function setLocal(k: string, v: string | null) {
  if (uiStarted && !k.endsWith('_conflict') && !k.endsWith('_prev')) frozen = true
  if (v == null) localStorage.removeItem(k)
  else nativeSet.call(localStorage, k, v)
}
function reloadSoon(msg: string, ms = 600) {
  frozen = true
  window.clearTimeout(pushTimer)
  setSyncMsg(msg)
  window.setTimeout(() => location.reload(), ms)
}

/** pullAll／pushDirty 一次只跑一個，避免兩邊各自讀寫 meta 互相蓋掉 */
let chain: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn)
  chain = p.catch(() => {})
  return p
}

/** 登入、換帳號或啟動時：以雲端為準合併。回傳本機資料是否被改寫（畫面要重新載入） */
const pullAll = () => serial(async (): Promise<boolean> => {
  if (!canSync()) return false
  const who = syncUser()
  let meta = readMeta()
  let changed = false
  if (meta.owner && meta.owner !== who) {
    // 本機資料是上一個帳號的：備份到 *_prev（覆蓋舊備份）後清空，版本歸零，下面只載入雲端、不上傳
    for (const lk of Object.keys(SYNC)) {
      const v = localStorage.getItem(lk)
      setLocal(lk + '_prev', v)
      if (v != null) { setLocal(lk, null); changed = true }
    }
    meta = { owner: who, versions: {}, dirty: {} }
    writeMeta(meta) // 先存起來：中途失敗也不會把上一個帳號的資料當成這個帳號的
  }
  for (const [lk, dk] of Object.entries(SYNC)) {
    const cloud = await client.store.get<CloudDoc>(dk)
    if (syncUser() !== who) throw new Error('帳號已變更') // 同步途中換了帳號：交給下一次 pullAll
    const local = localStorage.getItem(lk)
    const seen = meta.versions[dk] ?? 0
    if (cloud.version === 0 || !cloud.data) {
      if (local != null) {
        // 第一次同步（owner 未知）或這個帳號雲端被清空：本機資料帶上去
        const r = await client.store.put(dk, { savedAt: new Date().toISOString(), value: local } as CloudDoc, 0)
        meta.versions[dk] = r.version
        meta.dirty[lk] = false
      } else meta.versions[dk] = 0
      continue
    }
    if (cloud.version !== seen) {
      if (local != null && local !== cloud.data.value && (meta.dirty[lk] || seen === 0)) setLocal(lk + '_conflict', local) // 保留本機那份供救回
      if (local !== cloud.data.value) { setLocal(lk, cloud.data.value); changed = true }
      meta.versions[dk] = cloud.version
      meta.dirty[lk] = false
    } else if (meta.dirty[lk] && local != null) {
      const r = await client.store.put(dk, { savedAt: new Date().toISOString(), value: local } as CloudDoc, cloud.version)
      meta.versions[dk] = r.version
      meta.dirty[lk] = false
    }
  }
  meta.owner = who
  writeMeta(meta)
  return changed
})

const putLocal = (dk: string, local: string, base: number) =>
  client.store.put(dk, { savedAt: new Date().toISOString(), value: local } as CloudDoc, base)

const pushDirty = () => serial(async () => {
  if (!canSync() || frozen) return
  const meta = readMeta()
  const who = syncUser()
  if (meta.owner !== undefined && meta.owner !== who) {
    // 本機資料屬於別的帳號（例如登入權杖失效後改用寫入權杖）：不推，先走換帳號流程
    window.setTimeout(() => void onLogin(), 0)
    return
  }
  setSyncMsg('同步中…')
  try {
    for (const [lk, dk] of Object.entries(SYNC)) {
      if (!meta.dirty[lk]) continue
      if (frozen || syncUser() !== who) return // 途中要重新載入或換了帳號：不寫 meta、不再推
      const local = localStorage.getItem(lk)
      if (local == null) { meta.dirty[lk] = false; continue }
      try {
        let r
        try {
          r = await putLocal(dk, local, meta.versions[dk] ?? 0)
        } catch (e) {
          const doc = e instanceof KupeiError && e.status === 409 ? (e.details as { version?: number; data?: CloudDoc | null } | null) : null
          if (!(e instanceof KupeiError && e.status === 409) || doc?.data) throw e
          // 409 但雲端沒有文件（已被刪）：當作雲端版本 0 重新寫一次，只重試這一次
          r = await putLocal(dk, local, typeof doc?.version === 'number' ? doc.version : 0)
        }
        meta.versions[dk] = r.version
        meta.dirty[lk] = false
        meta.owner = who
      } catch (e) {
        if (e instanceof KupeiError && e.status === 409) {
          // 另一台裝置先寫入：雲端為準，本機未同步的內容保留在 *_conflict，重新載入畫面
          const doc = e.details as { version: number; data: CloudDoc | null }
          if (doc?.data) {
            setLocal(lk + '_conflict', local)
            setLocal(lk, doc.data.value)
            meta.versions[dk] = doc.version
            meta.dirty[lk] = false
            writeMeta(meta)
            reloadSoon('另一台裝置較新，已載入雲端內容', 800)
            return
          }
        }
        throw e
      }
    }
    writeMeta(meta)
    setSyncMsg(`已同步 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`)
  } catch (e) {
    if (frozen || syncUser() !== who) return
    writeMeta(meta)
    setSyncMsg(e instanceof KupeiError && e.status === 413 ? '同步失敗：資料太大（單份上限 256 KB）' : '同步失敗，稍後會再試')
    window.clearTimeout(pushTimer)
    pushTimer = window.setTimeout(() => void pushDirty(), 30000)
  }
})

let booted = false
async function onLogin() {
  if (!booted) return // 啟動時已在 boot() 處理
  setSyncMsg('同步中…')
  try {
    const changed = await pullAll()
    setSyncMsg(`已同步 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`)
    if (changed) reloadSoon('已載入帳號的雲端資料，重新整理畫面…')
  } catch (e) {
    if (frozen) reloadSoon('已載入部分雲端資料，重新整理畫面…') // 本機已被改寫一部分，畫面不能再用舊內容
    else setSyncMsg(e instanceof KupeiError ? `同步失敗（${e.status}）` : '同步失敗')
  }
}

/* ---------------- 帳號視窗 ---------------- */

const ERR: Record<string, string> = {
  INVALID_CREDENTIALS: '帳號或密碼不正確', USERNAME_TAKEN: '這個帳號已被使用', RATE_LIMITED: '嘗試次數太多，請稍後再試',
  BAD_REQUEST: '帳號或密碼格式不符：帳號 3～32 字（英數與 _ . -，開頭英數），密碼 8～128 字', UNAUTHENTICATED: '登入已過期，請重新登入',
  INVITE_REQUIRED: '需要邀請碼，請輸入維護者給你的邀請碼', INVITE_INVALID: '邀請碼不對',
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** 切到「建立帳號」時問一次後端要不要邀請碼（成功就快取，失敗下次再問） */
function loadInviteConfig() {
  if (inviteRequired !== null || inviteLoading) return
  inviteLoading = true
  client.auth.config()
    .then((c) => { if (inviteRequired === null) inviteRequired = c.inviteRequired; if (acctOpen) renderAcct() })
    .catch((e) => console.warn('[kupei] 讀取註冊設定失敗，先不顯示邀請碼欄位', e))
    .finally(() => { inviteLoading = false })
}

function setSyncMsg(t: string) { syncMsg = t; if (acctOpen) renderAcct() }

function renderAcct() {
  const dot = document.getElementById('acct-dot')
  const s = client.getSession()
  if (dot) dot.hidden = !canSync()
  document.querySelector<HTMLElement>('[data-acct]')?.setAttribute('title', s ? `帳號：${s.username}` : client.hasWriteToken() ? '已使用寫入權杖同步' : '帳號與雲端同步')
  let host = document.getElementById('acct-host')
  if (!acctOpen) { host?.remove(); return }
  if (!host) { host = document.createElement('div'); host.id = 'acct-host'; document.body.appendChild(host) }
  // 重畫會清掉輸入框；驗證失敗或背景更新時保留已輸入的內容（欄位 id 相同才還原）
  const kept = new Map([...host.querySelectorAll<HTMLInputElement>('input[id]')].map((i) => [i.id, i.value]))
  if (s) {
    host.innerHTML = `<div class="acct-backdrop" data-acct-close="1"></div><div class="acct-modal" role="dialog" aria-label="帳號">
      <h2>帳號</h2><p>已登入：<b>${esc(s.username)}</b>（有效至 ${esc(s.expiresAt.slice(0, 10))}）</p>
      <p class="acct-muted">自選群組與新聞／報告設定依帳號存到雲端，換裝置登入同一帳號就同步。${esc(syncMsg ? '　' + syncMsg : '')}</p>
      <div class="acct-row"><button class="acct-btn" data-acct-sync="1">立即同步</button><button class="acct-btn ghost" data-acct-logout="1">登出</button><button class="acct-btn ghost" data-acct-close="1">關閉</button></div>
      <details class="acct-adv" id="acct-pw-box"${pwOpen ? ' open' : ''}><summary>改密碼</summary>
        <p class="acct-muted">改完後其他裝置會全部登出，這台維持登入。</p>
        <label>目前密碼<input id="acct-pw-cur" type="password" autocomplete="current-password" maxlength="128"></label>
        <label>新密碼<input id="acct-pw-new" type="password" autocomplete="new-password" maxlength="128"></label>
        <label>再輸入一次新密碼<input id="acct-pw-new2" type="password" autocomplete="new-password" maxlength="128"></label>
        <p class="${pwOk ? 'acct-muted' : 'acct-err'}" id="acct-pw-msg">${esc(pwMsg)}</p>
        <div class="acct-row"><button class="acct-btn" data-acct-pw="1">更改密碼</button></div></details>
      <p class="acct-muted">登出後資料保留在這台瀏覽器；目前沒有忘記密碼功能。</p></div>`
  } else {
    host.innerHTML = `<div class="acct-backdrop" data-acct-close="1"></div><div class="acct-modal" role="dialog" aria-label="登入">
      <h2>${mode === 'login' ? '登入' : '建立帳號'}</h2>
      <p class="acct-muted">評分與行情不需要登入；登入後自選與設定可跨裝置同步。</p>
      <label>帳號<input id="acct-user" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="32"></label>
      <label>密碼<input id="acct-pass" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" maxlength="128"></label>
      ${mode === 'register' && inviteRequired === true ? '<label>邀請碼<input id="acct-invite" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64"></label>' : ''}
      ${mode === 'register' ? '<label>再輸入一次密碼<input id="acct-pass2" type="password" autocomplete="new-password" maxlength="128"></label><p class="acct-muted">帳號 3～32 字（英數與 _ . -，開頭英數，自動轉小寫）；密碼 8～128 字。目前沒有忘記密碼功能。</p>' : ''}
      <p class="acct-err" id="acct-err">${esc(formMsg)}</p>
      <div class="acct-row"><button class="acct-btn" data-acct-submit="1">${mode === 'login' ? '登入' : '建立並登入'}</button><button class="acct-btn ghost" data-acct-mode="1">${mode === 'login' ? '建立帳號' : '改為登入'}</button><button class="acct-btn ghost" data-acct-close="1">取消</button></div>
      <details class="acct-adv"${client.hasWriteToken() ? ' open' : ''}><summary>進階：使用寫入權杖（舊做法，保留相容）</summary>
        <p class="acct-muted">貼上維護者提供的寫入權杖，自選與設定會存到該權杖的雲端文件；權杖只存在這台裝置的瀏覽器。${client.hasWriteToken() ? '<b>目前已設定。</b>' : ''}</p>
        <input id="acct-wt" type="password" placeholder="寫入權杖" autocomplete="off" spellcheck="false">
        <div class="acct-row"><button class="acct-btn" data-acct-wt-save="1">連線</button><button class="acct-btn ghost" data-acct-wt-clear="1">清除</button></div>
        <p class="acct-muted">${esc(syncMsg)}</p></details></div>`
    ;(document.getElementById('acct-user') as HTMLInputElement | null)?.focus()
  }
  if (wipeInputs) { wipeInputs = false; kept.clear() }
  for (const [id, v] of kept) { const el = document.getElementById(id) as HTMLInputElement | null; if (el && v) el.value = v }
}

async function submitPassword() {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''
  const cur = val('acct-pw-cur'), next = val('acct-pw-new'), next2 = val('acct-pw-new2')
  pwOpen = true; pwOk = false
  if (!cur) pwMsg = '請輸入目前密碼'
  else if (next.length < 8 || next.length > 128) pwMsg = '新密碼要 8～128 字'
  else if (next2 !== next) pwMsg = '兩次輸入的新密碼不一樣'
  else {
    pwMsg = '處理中…'; renderAcct()
    try {
      await client.auth.changePassword(cur, next)
      pwOk = true; pwMsg = '密碼已更改，其他裝置已登出'; pwOpen = false; wipeInputs = true
    } catch (e) {
      pwMsg = e instanceof KupeiError ? (e.code === 'INVALID_CREDENTIALS' ? '目前密碼不正確' : ERR[e.code] || `失敗（${e.status}）`) : '無法連線，請稍後再試'
    }
  }
  renderAcct()
}

async function submitForm() {
  const u = (document.getElementById('acct-user') as HTMLInputElement).value.trim().toLowerCase()
  const p = (document.getElementById('acct-pass') as HTMLInputElement).value
  if (!u || !p) { formMsg = '請輸入帳號與密碼'; renderAcct(); return }
  if (mode === 'register' && p !== (document.getElementById('acct-pass2') as HTMLInputElement | null)?.value) { formMsg = '兩次輸入的密碼不一致'; renderAcct(); return }
  const invite = (document.getElementById('acct-invite') as HTMLInputElement | null)?.value.trim() ?? ''
  if (mode === 'register' && inviteRequired === true && !invite) { formMsg = ERR.INVITE_REQUIRED; renderAcct(); return }
  formMsg = '處理中…'; renderAcct()
  try {
    if (mode === 'login') await client.auth.login(u, p)
    else await client.auth.register(u, p, inviteRequired === true ? invite : undefined)
    formMsg = ''
    renderAcct()
  } catch (e) {
    // 註冊設定沒讀到（或剛被打開）時，後端說要邀請碼就把欄位顯示出來
    if (e instanceof KupeiError && (e.code === 'INVITE_REQUIRED' || e.code === 'INVITE_INVALID')) inviteRequired = true
    formMsg = e instanceof KupeiError ? ERR[e.code] || `失敗（${e.status}）` : '無法連線，請稍後再試'
    renderAcct()
  }
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (t.closest('[data-acct]')) { acctOpen = true; formMsg = ''; pwMsg = ''; pwOpen = false; renderAcct(); return }
  if (!acctOpen) return
  if (t.closest('[data-acct-close]')) { acctOpen = false; renderAcct() }
  else if (t.closest('[data-acct-mode]')) { mode = mode === 'login' ? 'register' : 'login'; formMsg = ''; if (mode === 'register') loadInviteConfig(); renderAcct() }
  else if (t.closest('[data-acct-pw]')) void submitPassword()
  else if (t.closest('[data-acct-submit]')) void submitForm()
  else if (t.closest('[data-acct-sync]')) void onLogin().then(() => pushDirty())
  else if (t.closest('[data-acct-wt-save]')) {
    const v = (document.getElementById('acct-wt') as HTMLInputElement | null)?.value.trim() ?? ''
    if (v) { client.setWriteToken(v); setSyncMsg('連線中…'); void onLogin() }
  } else if (t.closest('[data-acct-wt-clear]')) { client.setWriteToken(null); setSyncMsg('已清除寫入權杖；資料保留在這台瀏覽器'); renderAcct() }
  else if (t.closest('[data-acct-logout]')) void client.auth.logout().then(() => { syncMsg = ''; acctOpen = false; renderAcct() }) // meta.owner 保留：下次別的帳號登入時才知道本機資料是誰的
})
// <details> 的 toggle 不冒泡，用捕獲階段記住展開狀態（背景同步訊息觸發重畫時才不會被收起來）
document.addEventListener('toggle', (e) => { const t = e.target as HTMLElement; if (t.id === 'acct-pw-box') pwOpen = (t as HTMLDetailsElement).open }, true)
document.addEventListener('keydown', (e) => {
  if (!acctOpen) return
  if (e.key === 'Escape') { acctOpen = false; renderAcct() }
  else if (e.key === 'Enter' && !canSync() && (document.activeElement as HTMLElement | null)?.id !== 'acct-wt') void submitForm()
})

/* ---------------- 啟動 ---------------- */

async function boot() {
  const w = window as any
  w.KUPEI_CONFIG = { mode: 'pages', timeoutMs: 20000, companyCache: 60 }
  w.KupeiAPI = api
  w.KupeiAuth = { session: () => client.getSession() ?? (client.hasWriteToken() ? { username: '寫入權杖', expiresAt: '' } : null) }
  installHook()
  // 回訪且已登入：先把雲端資料合併進本機（最多等 4 秒），UI 才讀 localStorage
  if (canSync()) {
    const pull = pullAll()
    const late = await Promise.race([
      pull.then(() => false),
      new Promise<boolean>((r) => window.setTimeout(() => r(true), 4000)),
    ]).catch(() => null)
    if (late === false) setSyncMsg(`已同步 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`)
    else if (late === null) setSyncMsg('同步失敗，使用本機資料')
    else {
      // 逾時：畫面先用本機資料開起來。之後 pullAll 一旦改寫本機就凍結寫入（見 setLocal），回來後重新載入，
      // 避免畫面上的舊內容在重新載入前後被當成新的修改、用新版本號推上去蓋掉別台的變更
      setSyncMsg('同步較慢，先使用本機資料…')
      pull.then(
        (changed) => (changed ? reloadSoon('已載入帳號的雲端資料，重新整理畫面…') : setSyncMsg(`已同步 ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`)),
        () => (frozen ? reloadSoon('已載入部分雲端資料，重新整理畫面…') : setSyncMsg('同步失敗，使用本機資料')),
      )
    }
  }
  booted = true
  uiStarted = true
  void loadDs().catch(() => {}) // 與 UI 啟動並行
  void client.marketLatest().catch(() => {})
  const s = document.createElement('script')
  s.src = `./legacy/app.js?v=${__BUILD__}`
  document.body.appendChild(s)
  renderAcct()
}
void boot()
