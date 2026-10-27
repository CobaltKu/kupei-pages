/*
 * KuPei Pages 前端橋接層（2026-10-26）。
 * 完整 UI（public/legacy/app.js，來自 Python/kupei_3/ui_web）原本讀私人 API /api/v1；Pages 版改讀後端 Server API：
 *   評分與明細  /data/<run>/…（summary、details、tr、vparams，選用 valuation、help）
 *   行情        /api/market/latest、/api/market/history（每日收盤）；/api/market/intraday（盤中快照，約 10 分鐘更新）
 *   新聞        /api/news、/api/news/sources（Google 新聞 RSS，關鍵字來自本機新聞設定）
 *   報告        /api/reports/<代號>…（列表、單篇、產生請求；請求只限登入帳號）
 *   帳號與同步  /api/auth/*、/api/store/<key>（依帳號分開的雲端文件）
 * 這一層把它們轉成 UI 原本要的形狀（window.KupeiAPI），不重算任何分數、名次或 Gate；缺的資料就回「尚未提供」。
 * 自選、新聞與報告設定、個股問題存本機（kupei3_*）；登入後以雲端文件同步（見下方 sync）。
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
let mode: 'login' | 'register' | 'reset' = 'login'
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
/** 重新載入後要顯示在帳號視窗的提示（重設密碼成功、匯入完成；經 sessionStorage 帶過重新載入） */
let notice = ''
/* 匯入舊的寫入權杖資料：權杖只在 impRead() 的區域變數裡用一次，這裡只留讀到的內容 */
let impOpen = false
let impMsg = ''
let impErr = false
let impBusy = false
let impDocs: { lk: string; dk: string; updatedAt: string | null; value: string }[] | null = null
let impOther = 0

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

/* 轉換結果依來源物件記憶化：同一個 Dataset／同一份 latest 只轉一次（換批次、行情更新時來源物件不同，自然重算） */
const homeMemo = new WeakMap<Dataset, Json>()
const quotesMemo = new WeakMap<LatestResponse, Json>()
const companyMemo = new WeakMap<Dataset, Map<string, Json>>()

function adaptHome(ds: Dataset): Json {
  const hit = homeMemo.get(ds)
  if (hit) return hit
  const out = adaptHomeOnce(ds)
  homeMemo.set(ds, out)
  return out
}

function adaptHomeOnce(ds: Dataset): Json {
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

/** /api/market/latest → UI 的 /quotes 形狀。dates.L／O 一起帶出去，畫面標示上市、上櫃各自的收盤日 */
function adaptQuotes(latest: LatestResponse): Json {
  const hit = quotesMemo.get(latest)
  if (hit) return hit
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
  const out = {
    market_status: 'CLOSED', last_success_at: day ? `${day}T13:30:00+08:00` : null, trading_date: day, seq: 0,
    dates: { L: latest.dates.L ?? null, O: latest.dates.O ?? null }, quotes,
  }
  quotesMemo.set(latest, out)
  return out
}

/**
 * 盤中（phase=OPEN）：用 /api/market/intraday 的價格蓋過每日收盤（漲跌、時間一起換），stale 時照樣顯示但標示延遲。
 * 盤前、收盤後（PRE／CLOSED）或拿不到盤中資料：維持每日收盤。盤中 tuple 的價格是 null（今天還沒成交）就顯示「—」，不拿收盤補。
 * 同一份 latest＋同一份盤中快照只轉一次（app.js 用 quotes 物件是否相同判斷要不要重畫）。
 */
let mergedMemo: { latest: LatestResponse; intra: unknown; out: Json } | null = null
function adaptQuotesLive(latest: LatestResponse, intra: Intraday | null): Json {
  const base = adaptQuotes(latest)
  if (!intra || intra.phase !== 'OPEN') return base
  if (mergedMemo && mergedMemo.latest === latest && mergedMemo.intra === intra) return mergedMemo.out
  const quotes: Json = { ...base.quotes }
  for (const [id, t] of Object.entries(intra.quotes)) {
    if (!/^\d{4}$/.test(id) || !Array.isArray(t)) continue
    const price = num(t[0]), change = num(t[1]), volume = num(t[2])
    const prev = price != null && change != null ? price - change : null
    quotes[id] = {
      price, prev_close: prev, change, change_pct: prev ? (change! / prev) * 100 : null, volume,
      status: 'INTRADAY', source_time: typeof t[3] === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(t[3]) ? t[3] : null,
    }
  }
  const ats = (['L', 'O'] as const).map((m) => intra.markets?.[m]?.at).filter((x) => typeof x === 'string' && !Number.isNaN(Date.parse(x))) as string[]
  const at = ats.sort((a, b) => Date.parse(a) - Date.parse(b)).pop() ?? null
  const out = {
    ...base, market_status: 'OPEN', last_success_at: at, seq: 0, quotes,
    intraday: { phase: intra.phase, stale: intra.stale, ttl: intra.ttlSeconds, hm: taipeiHm(at ?? (intra.markets?.L?.at || intra.markets?.O?.at)) },
  }
  mergedMemo = { latest, intra, out }
  return out
}

/*
 * 後端選用檔（valuation.json、help.json）：走 kupei-client 的 loadValuation／loadHelp。
 * manifest.hashes 沒有該鍵＝這個批次沒交付 → 不打網路直接回 null（原本每次都打一次 404）；有就帶雜湊抓一次、同批次共用。
 */
async function optionalFile(load: () => Promise<unknown>): Promise<Reply> {
  try {
    const data = await load()
    return data == null ? no(404) : ok(data)
  } catch (e) {
    return no(e instanceof KupeiError ? e.status : 0)
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

/* ---------------- 新端點：盤中行情、新聞、報告（2026-10-27） ----------------
 * 後端會在 starter 加 marketIntraday()／news()／newsSources()／reports()／report()／requestReport()／reportRequests()。
 * 那之前 kupei-client.ts 不能手改（串接規範 §1、§8），所以先用這個小 helper；合併 starter 後改呼叫 client 的方法，整段刪掉。
 * 權杖選擇照 kupei-client：登入權杖 ＞ 寫入權杖 ＞ 建置時的唯讀權杖。client 不公開權杖本身，
 * 這裡依 client.getSession()／hasWriteToken() 判斷要用哪一種，再從 client 用的同一個 storage key 讀出來（不另存、不印出）。
 * 錯誤一律轉成 KupeiError（{ error: { code, message, details } }）；429 只有 GET 依 Retry-After 重試一次；每個請求 20 秒逾時。
 */
const SESSION_KEY = 'kupei:session'
const WRITE_TOKEN_KEY = 'kupei:write-token'

function tokenFor(loginOnly: boolean): string | null {
  if (client.getSession()) {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
      if (s && typeof s.token === 'string' && s.token) return s.token
    } catch { /* 壞掉當作沒登入 */ }
  }
  if (loginOnly) return null
  if (client.hasWriteToken()) {
    try { const w = localStorage.getItem(WRITE_TOKEN_KEY); if (w) return w } catch { /* ignore */ }
  }
  return READ_TOKEN || null
}

async function apiCall<T>(method: 'GET' | 'POST', path: string, body?: unknown, loginOnly = false, retried = false): Promise<{ status: number; data: T }> {
  const token = tokenFor(loginOnly)
  if (loginOnly && !token) throw new KupeiError(401, 'UNAUTHENTICATED', '需要登入帳號', null)
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: method === 'GET' ? 'default' : 'no-store',
    signal: AbortSignal.timeout(20000),
  })
  if (res.ok) return { status: res.status, data: (await res.json()) as T }
  let e: Json = {}
  try { const j = await res.json(); if (j && typeof j.error === 'object' && j.error) e = j.error } catch { /* 不是 JSON */ }
  const ra = res.headers.get('Retry-After')
  const err = new KupeiError(
    res.status,
    typeof e.code === 'string' ? e.code : res.status === 401 ? 'UNAUTHENTICATED' : res.status === 404 ? 'NOT_FOUND' : `HTTP_${res.status}`,
    typeof e.message === 'string' ? e.message : `HTTP ${res.status}`,
    ra && /^\d+$/.test(ra.trim()) ? Number(ra) : null,
    e.details,
  )
  // 登入權杖被拒：交給 client 確認一次（auth.me() 收到 401 會自己清掉 session、通知畫面）
  if (err.status === 401 && err.code === 'UNAUTHENTICATED' && client.getSession()) void client.auth.me().catch(() => {})
  if (err.status === 429 && method === 'GET' && !retried) {
    await new Promise((r) => setTimeout(r, Math.min(err.retryAfter ?? 30, 60) * 1000))
    return apiCall<T>(method, path, body, loginOnly, true)
  }
  throw err
}
const apiGet = async <T>(path: string, loginOnly = false) => (await apiCall<T>('GET', path, undefined, loginOnly)).data

/** 後端還沒開通（唯讀權杖打未開放的路徑是 403 FORBIDDEN、路徑不存在 404）→ UI 顯示「尚未提供」 */
const notProvided = (e: unknown) => e instanceof KupeiError && (e.code === 'FORBIDDEN' || e.status === 404)
/** 錯誤 → UI 的回應形狀（app.js 讀 data.error_code／data.message_zh） */
function errReply(e: unknown, notFound = 'NOT_PROVIDED'): Reply {
  if (!(e instanceof KupeiError)) return { ok: false, status: 0, data: null }
  const code = e.code === 'FORBIDDEN' ? 'NOT_PROVIDED' : e.status === 404 ? notFound : e.code
  return { ok: false, status: e.status, data: { error_code: code, message_zh: e.message, details: e.details ?? null } }
}

const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '')
/** 只放行 https 網址；其他（http、javascript:、相對路徑）一律不給連結 */
function httpsUrl(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 2000) return null
  try { const u = new URL(x); return u.protocol === 'https:' ? u.href : null } catch { return null }
}
const isoOrNull = (x: unknown) => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null)
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

/* ---- 盤中行情 ---- */
interface Intraday { phase: 'PRE' | 'OPEN' | 'CLOSED'; stale: boolean; ttlSeconds: number; markets: Json; quotes: Record<string, unknown> }
let intraCache: { at: number; value: Intraday | null } | null = null
let intraInFlight: Promise<Intraday | null> | null = null
let intraOff = false // 後端沒開通：這次開頁面不再問

/** 盤中快照；任何錯誤都回 null（行情退回每日收盤）。60 秒內共用同一份，與 marketLatest 一致 */
function marketIntraday(): Promise<Intraday | null> {
  if (intraOff) return Promise.resolve(null)
  if (intraCache && Date.now() - intraCache.at < 60000) return Promise.resolve(intraCache.value)
  if (intraInFlight) return intraInFlight
  intraInFlight = apiGet<Json>('/api/market/intraday')
    .then((v): Intraday | null => {
      if (!v || !['PRE', 'OPEN', 'CLOSED'].includes(v.phase) || typeof v.quotes !== 'object' || !v.quotes) return null
      const ttl = num(v.ttlSeconds)
      return { phase: v.phase, stale: v.stale === true, ttlSeconds: ttl && ttl >= 60 && ttl <= 3600 ? ttl : 300, markets: v.markets && typeof v.markets === 'object' ? v.markets : {}, quotes: v.quotes }
    }, (e) => { if (notProvided(e)) intraOff = true; return null })
    .then((v) => { intraCache = { at: Date.now(), value: v }; return v })
    .finally(() => (intraInFlight = null))
  return intraInFlight
}

/** 'HH:MM:SS' 或 ISO 時間 → 台灣時間 HH:MM */
function taipeiHm(x: unknown): string | null {
  if (typeof x !== 'string') return null
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(x)) return x.slice(0, 5)
  const t = Date.parse(x)
  return Number.isNaN(t) ? null : new Date(t).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
}

/* ---- 新聞 ---- */
/** 本機新聞設定（kupei3_news；可能被雲端同步改寫過，照 app.js cleanNS 的規則再驗一次） */
function newsSettings(): { span: number; groups: { id: string; kw: string[]; ex: string[] }[]; stock: Record<string, { kw: string[]; ex: string[] }>; disabled: string[] } {
  let raw: any = null
  try { raw = JSON.parse(localStorage.getItem('kupei3_news') || 'null') } catch { /* 壞掉當作沒有 */ }
  const list = (a: unknown, max: number) => {
    const out: string[] = []
    if (Array.isArray(a)) for (const s of a) { if (typeof s !== 'string') continue; const t = s.trim().slice(0, 50); if (t && !out.includes(t) && out.length < max) out.push(t) }
    return out
  }
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const groups = (Array.isArray(o.groups) ? o.groups : []).filter((g: any) => g && typeof g === 'object' && (typeof g.id === 'number' || typeof g.id === 'string'))
    .map((g: any) => ({ id: String(g.id), kw: list(g.kw, 5), ex: list(g.ex, 5) }))
  const stock: Record<string, { kw: string[]; ex: string[] }> = {}
  if (o.stock && typeof o.stock === 'object') for (const [id, v] of Object.entries(o.stock as Json)) if (/^\d{4}$/.test(id) && v && typeof v === 'object') stock[id] = { kw: list(v.kw, 5), ex: list(v.ex, 5) }
  return { span: o.span === 3 ? 3 : 1, groups, stock, disabled: list(o.disabled, 200) }
}
/** 後端規則：q 1～5 個、exclude 0～5 個、每個 1～50 字，以逗號分隔（關鍵字裡的逗號換成空白） */
const terms = (a: string[]) => a.map((s) => s.replace(/[,，]/g, ' ').trim().slice(0, 50)).filter(Boolean).slice(0, 5)

const NEWS_LIMITS = ['TITLE_ONLY']
async function fetchNews(kw: string[], ex: string[], days: 1 | 3 | 5): Promise<Reply> {
  const q = terms(kw)
  if (!q.length) return { ok: false, status: 400, data: { error_code: 'NEWS_NO_KEYWORDS', message_zh: '尚未設定關鍵字' } }
  const x = terms(ex)
  const qs = `q=${encodeURIComponent(q.join(','))}${x.length ? `&exclude=${encodeURIComponent(x.join(','))}` : ''}&days=${days}`
  let d: Json
  try { d = await apiGet<Json>(`/api/news?${qs}`) } catch (e) { return errReply(e) }
  const off = new Set(newsSettings().disabled)
  const articles = (Array.isArray(d?.items) ? d.items : []).slice(0, 50).filter((i: any) => i && typeof i === 'object' && typeof i.title === 'string' && i.title)
    .map((i: any) => ({
      title: str(i.title, 300), url: httpsUrl(i.url), source_name: str(i.source, 100), source_id: str(i.source, 100),
      published_at_utc: isoOrNull(i.publishedAt), timezone_basis: 'SOURCE_RFC822',
    }))
    .filter((a: Json) => !off.has(a.source_name)) // 新聞設定裡停用的來源（依來源名稱比對）
  return ok({
    articles, excluded: [], generated_at: isoOrNull(d?.fetchedAt), source: str(d?.source, 40),
    retrieval_limitations: d?.stale === true ? [...NEWS_LIMITS, 'STALE'] : NEWS_LIMITS,
  })
}

/* ---- 報告 ---- */
const SAFE_SEG = /^[A-Za-z0-9._-]{1,32}$/
const REPORT_ST = ['DRAFT', 'PUBLISHED', 'FAILED']
const REQ_ST = ['QUEUED', 'RUNNING', 'DONE', 'FAILED']
function adaptReportItem(r: any): Json | null {
  if (!r || typeof r !== 'object') return null
  const period = typeof r.period === 'string' ? r.period : null
  const rev = typeof r.rev === 'number' || typeof r.rev === 'string' ? String(r.rev) : null
  if (!period || !rev || !SAFE_SEG.test(period) || !SAFE_SEG.test(rev)) return null
  return {
    period, revision: rev, status: REPORT_ST.includes(r.status) ? r.status : 'UNKNOWN', title: str(r.title, 200),
    published_at: isoOrNull(r.generatedAt), url: httpsUrl(r.url),
    files: (Array.isArray(r.files) ? r.files : []).slice(0, 50).filter((f: any) => f && typeof f.name === 'string')
      .map((f: any) => ({ name: str(f.name, 200), url: httpsUrl(f.url) })),
  }
}
function adaptRequest(q: any): Json | null {
  if (!q || typeof q !== 'object' || typeof q.period !== 'string') return null
  return {
    id: str(q.id, 64), period: str(q.period, 32), trigger: str(q.trigger, 20), status: REQ_ST.includes(q.status) ? q.status : 'UNKNOWN',
    created_at: isoOrNull(q.createdAt), updated_at: isoOrNull(q.updatedAt), message: str(q.message, 500),
  }
}
async function reportList(code: string): Promise<Reply> {
  // 自己的請求只有登入權杖讀得到；沒登入就不問（不是錯誤）
  const reqP = client.getSession()
    ? apiGet<Json>(`/api/reports/${code}/requests`, true).then((d) => (Array.isArray(d?.requests) ? d.requests : []), () => null)
    : Promise.resolve(null)
  let d: Json
  try { d = await apiGet<Json>(`/api/reports/${code}`) } catch (e) { void reqP; return errReply(e) }
  const all = (Array.isArray(d?.reports) ? d.reports : []).map(adaptReportItem).filter(Boolean) as Json[]
  const time = (x: Json, k: string) => (x[k] ? Date.parse(x[k]) : 0)
  all.sort((a, b) => time(b, 'published_at') - time(a, 'published_at'))
  const rq = await reqP
  const requests = rq ? (rq.map(adaptRequest).filter(Boolean) as Json[]).sort((a, b) => time(b, 'created_at') - time(a, 'created_at')) : null
  return ok({
    periods: all.filter((r) => r.status === 'PUBLISHED' || r.status === 'DRAFT'),
    failed: all.filter((r) => r.status === 'FAILED'),
    requests, current_request: requests ? requests.find((q) => q.status === 'QUEUED' || q.status === 'RUNNING') ?? null : null,
  })
}
async function reportOne(code: string, period: string, rev: string): Promise<Reply> {
  if (!SAFE_SEG.test(period) || !SAFE_SEG.test(rev)) return { ok: false, status: 400, data: { error_code: 'REPORT_NOT_FOUND' } }
  let d: Json
  try { d = await apiGet<Json>(`/api/reports/${code}/${encodeURIComponent(period)}/${encodeURIComponent(rev)}`) } catch (e) { return errReply(e, 'REPORT_NOT_FOUND') }
  const r = adaptReportItem(d)
  if (!r) return { ok: false, status: 502, data: { error_code: 'REPORT_NOT_FOUND' } }
  // summary 原樣當純文字交給 UI（UI 跳脫後只把換行轉 <br>，不解析 markdown）
  return ok({ ...r, summary: str(d.summary, 100000), pointer: { published_at: r.published_at }, meta: null })
}
async function requestReport(code: string, body: any): Promise<Reply> {
  const period = typeof body?.period === 'string' && SAFE_SEG.test(body.period) ? body.period : null
  if (!period) return { ok: false, status: 400, data: { error_code: 'REPORT_PERIOD_UNAVAILABLE' } }
  try {
    const r = await apiCall<Json>('POST', `/api/reports/${code}/requests`, { period, trigger: 'MANUAL' }, true)
    return { ok: true, status: r.status, data: adaptRequest({ ...r.data, period: r.data?.period ?? period }) }
  } catch (e) {
    return errReply(e)
  }
}

/* ---- 個股問題（後端沒有對應端點：存本機 kupei3_questions，登入後以雲端文件 ui-questions 同步，見 SYNC） ---- */
/*
 * 本機格式：{ "<代號>": [問題…] }，整份一個雲端文件（不每家公司一份，避免超過每人 50 份）。
 * 問題物件沿用原 FastAPI 版的欄位：question_id、body、status、manual_locked、first_seen、updated_at、
 * related_items、evidence、status_reason、deleted、deleted_at。
 * 內容可能被雲端同步改寫（任何持有該帳號權杖的人都能寫），每次讀取都重新驗證，不合格的丟掉。
 */
const QKEY = 'kupei3_questions'
const Q_CODE = /^[0-9A-Za-z]{4}$/
const Q_ID = /^Q-\d{1,6}$/
const Q_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/
const Q_STATUS = ['NEW', 'STILL_VALID', 'RESOLVED', 'UNDETERMINED']
const Q_LIMITS = { text: 1000, perCompany: 100, deletedKept: 50, bytes: 200_000, items: 20, itemLen: 50, reason: 200 }
interface Question {
  question_id: string; body: string; status: string; manual_locked: boolean; first_seen: string; updated_at: string
  related_items: string[]; evidence: string[]; status_reason: string | null; deleted: boolean; deleted_at: string | null
}
type QStore = Record<string, Question[]>

const qTime = (x: unknown): string | null => (typeof x === 'string' && Q_TIME.test(x) && !Number.isNaN(Date.parse(x)) ? x : null)
const qList = (a: unknown): string[] => {
  const out: string[] = []
  if (Array.isArray(a)) for (const s of a) { if (typeof s !== 'string') continue; const t = s.trim().slice(0, Q_LIMITS.itemLen); if (t && !out.includes(t) && out.length < Q_LIMITS.items) out.push(t) }
  return out
}
function cleanQuestion(q: any): Question | null {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return null
  if (typeof q.question_id !== 'string' || !Q_ID.test(q.question_id)) return null
  if (typeof q.body !== 'string') return null
  const body = q.body.trim().slice(0, Q_LIMITS.text)
  const first = qTime(q.first_seen)
  if (!body || !first) return null
  return {
    question_id: q.question_id, body, status: Q_STATUS.includes(q.status) ? q.status : 'NEW', manual_locked: q.manual_locked === true,
    first_seen: first, updated_at: qTime(q.updated_at) ?? first, related_items: qList(q.related_items), evidence: qList(q.evidence),
    status_reason: typeof q.status_reason === 'string' && q.status_reason ? q.status_reason.slice(0, Q_LIMITS.reason) : null,
    deleted: q.deleted === true, deleted_at: q.deleted === true ? qTime(q.deleted_at) : null,
  }
}
/** 讀本機並驗證；壞掉或形狀不對 → 空的 */
function qRead(): QStore {
  let raw: any = null
  try { raw = JSON.parse(localStorage.getItem(QKEY) || 'null') } catch { /* 壞掉當作沒有 */ }
  const out: QStore = Object.create(null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [code, list] of Object.entries(raw)) {
    if (!Q_CODE.test(code) || !Array.isArray(list)) continue
    const seen = new Set<string>()
    const qs: Question[] = []
    for (const x of list.slice(0, Q_LIMITS.perCompany + Q_LIMITS.deletedKept)) {
      const q = cleanQuestion(x)
      if (q && !seen.has(q.question_id)) { seen.add(q.question_id); qs.push(q) }
    }
    if (qs.length) out[code.toUpperCase()] = qs
  }
  return out
}
/** 整份存成雲端文件後大約的大小（UTF-8 位元組；雲端文件是 { savedAt, value: <這份 JSON 字串> }） */
const qBytes = (s: string) => new TextEncoder().encode(JSON.stringify({ savedAt: new Date().toISOString(), value: s })).length
/** 版本＝該公司問題內容的雜湊：另一個分頁或同步改過就對不上，回 409 讓 UI 重新載入 */
function qVersion(list: Question[] | undefined): number {
  const s = JSON.stringify(list || [])
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return list && list.length ? (h >>> 0) + 1 : 0
}
/** 台灣時間 ISO（+08:00），首次日期（first_seen 前 10 碼）才會是台灣的日期 */
function qNow(): string {
  const d = new Date(Date.now() + 8 * 3600e3)
  return d.toISOString().slice(0, 19) + '+08:00'
}
const qErr = (status: number, code: string, msg: string): Reply => ({ ok: false, status, data: { error_code: code, message_zh: msg } })
const qOut = (code: string, list: Question[] | undefined, all: boolean): Reply =>
  ok({ company_id: code, version: qVersion(list), questions: (list || []).filter((q) => all || !q.deleted).map((q) => ({ ...q })) })
const qIdem = new Map<string, string>() // Idempotency-Key → 已新增的 question_id（這次開頁面內有效）

/** check＝這次會讓內容變大（新增、改長）才檢查總量；刪除、恢復、改短一定要能存（已超過上限的資料也要能整理） */
function qSave(st: QStore, check: boolean): Reply | null {
  const s = JSON.stringify(st)
  if (check && qBytes(s) > Q_LIMITS.bytes) return qErr(413, 'Q_TOO_LARGE', `個股問題總量已達上限（約 ${Math.round(Q_LIMITS.bytes / 1000)} KB），請刪減內容後再試`)
  try { localStorage.setItem(QKEY, s) } catch { return qErr(507, 'Q_STORAGE_FULL', '瀏覽器儲存空間不足，無法儲存') }
  return null
}

function questionsReq(m: string, seg: string[], qs: string, body: any, headers: Record<string, string>): Reply {
  const code = seg[2].toUpperCase()
  const st = qRead()
  const list = st[code] || []
  const all = new URLSearchParams(qs).get('include_deleted') === 'true'
  if (m === 'GET' && seg.length === 4) return qOut(code, st[code], all)
  // 寫入：If-Match 帶的版本要等於目前內容的版本（其他分頁、雲端同步改過 → 409，UI 會重新載入）
  const im = headers['If-Match'] ?? headers['if-match']
  if (im != null && im !== '' && Number(im) !== qVersion(st[code])) return qErr(409, 'VERSION_CONFLICT', '資料已在其他分頁或裝置更新')
  const b = body && typeof body === 'object' ? body : {}
  const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  if (m === 'POST' && seg.length === 4) {
    const idem = headers['Idempotency-Key'] ?? headers['idempotency-key']
    if (idem && qIdem.has(idem) && list.some((q) => q.question_id === qIdem.get(idem))) return qOut(code, list, true) // 重複送出：不再新增
    const t = text(b.text)
    if (!t) return qErr(400, 'Q_EMPTY', '請輸入問題內容')
    if (t.length > Q_LIMITS.text) return qErr(400, 'Q_TOO_LONG', `每則問題最多 ${Q_LIMITS.text.toLocaleString()} 字（目前 ${t.length.toLocaleString()} 字）`)
    if (list.filter((q) => !q.deleted).length >= Q_LIMITS.perCompany) return qErr(400, 'Q_LIMIT', `每家公司最多 ${Q_LIMITS.perCompany} 則問題，請先刪除不需要的`)
    const n = list.reduce((mx, q) => Math.max(mx, Number(q.question_id.slice(2)) || 0), 0) + 1
    const now = qNow()
    const q: Question = {
      question_id: 'Q-' + String(n).padStart(3, '0'), body: t, status: 'NEW', manual_locked: true, first_seen: now, updated_at: now,
      related_items: qList(b.related_items), evidence: qList(b.evidence), status_reason: null, deleted: false, deleted_at: null,
    }
    st[code] = [...list, q]
    const e = qSave(st, true)
    if (e) return e
    if (idem) qIdem.set(idem, q.question_id)
    return qOut(code, st[code], true)
  }
  const qid = seg[4] || ''
  const i = list.findIndex((q) => q.question_id === qid)
  if (i < 0) return qErr(404, 'QUESTION_NOT_FOUND', '找不到這則問題（可能已在其他裝置更新），請重新整理')
  const cur = list[i]
  const now = qNow()
  let next: Question
  if ((m === 'PUT' || m === 'PATCH') && seg.length === 5) {
    if (cur.deleted) return qErr(400, 'QUESTION_DELETED', '已刪除的問題要先恢復才能修改')
    const t = b.text === undefined && m === 'PATCH' ? cur.body : text(b.text)
    if (!t) return qErr(400, 'Q_EMPTY', '請輸入問題內容')
    if (t.length > Q_LIMITS.text) return qErr(400, 'Q_TOO_LONG', `每則問題最多 ${Q_LIMITS.text.toLocaleString()} 字（目前 ${t.length.toLocaleString()} 字）`)
    const status = b.status === undefined && m === 'PATCH' ? cur.status : b.status
    if (!Q_STATUS.includes(status)) return qErr(400, 'Q_BAD_STATUS', '狀態不正確')
    next = {
      ...cur, body: t, status, manual_locked: true, updated_at: now,
      related_items: b.related_items === undefined ? cur.related_items : qList(b.related_items),
      evidence: b.evidence === undefined ? cur.evidence : qList(b.evidence),
      status_reason: b.status_reason === undefined ? cur.status_reason : typeof b.status_reason === 'string' && b.status_reason ? b.status_reason.slice(0, Q_LIMITS.reason) : null,
    }
  } else if (m === 'DELETE' && seg.length === 5) {
    next = { ...cur, deleted: true, deleted_at: now, updated_at: now }
  } else if (m === 'POST' && seg.length === 6 && seg[5] === 'restore') {
    if (cur.deleted && list.filter((q) => !q.deleted).length >= Q_LIMITS.perCompany) return qErr(400, 'Q_LIMIT', `每家公司最多 ${Q_LIMITS.perCompany} 則問題，請先刪除不需要的`)
    next = { ...cur, deleted: false, deleted_at: null, updated_at: now }
  } else return { ok: false, status: 404, data: { error_code: 'NOT_PROVIDED' } }
  let out = list.map((q, k) => (k === i ? next : q))
  // 已刪除的只保留最近 deletedKept 則（最舊的永久移除），整份大小才有上限
  const del = out.filter((q) => q.deleted).sort((a, c) => String(c.deleted_at).localeCompare(String(a.deleted_at)))
  if (del.length > Q_LIMITS.deletedKept) { const drop = new Set(del.slice(Q_LIMITS.deletedKept)); out = out.filter((q) => !drop.has(q)) }
  st[code] = out
  if (!out.length) delete st[code]
  const grows = JSON.stringify(next.body).length + JSON.stringify(next.related_items).length + JSON.stringify(next.status_reason).length >
    JSON.stringify(cur.body).length + JSON.stringify(cur.related_items).length + JSON.stringify(cur.status_reason).length
  const e = qSave(st, grows)
  if (e) return e
  return qOut(code, st[code], true)
}

/* ---------------- window.KupeiAPI（UI 的資料層介面） ---------------- */

const ok = (data: any): Reply => ({ ok: true, status: 200, data })
const no = (status = 404): Reply => ({ ok: false, status, data: null })
let datasetP: Promise<Dataset> | null = null
const loadDs = () => (datasetP ??= client.loadDataset())

async function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Reply> {
  const m = method.toUpperCase()
  const [p, qs = ''] = path.split('?')
  const seg = p.split('/').map((s) => { try { return decodeURIComponent(s) } catch { return '' } })
  try {
    if (m === 'GET' && p === '/quotes') {
      const [latest, intra] = await Promise.all([client.marketLatest(), marketIntraday()])
      return ok(adaptQuotesLive(latest, intra))
    }
    // 新聞：關鍵字來自本機新聞設定；產業依 span（1／3 天），個股固定近 5 日。date 參數後端不支援，忽略
    if (m === 'GET' && p === '/news/industry') {
      const gid = new URLSearchParams(qs).get('group') || ''
      const g = newsSettings().groups.find((x) => x.id === gid)
      if (!g) return { ok: false, status: 404, data: { error_code: 'NEWS_GROUP_NOT_FOUND' } }
      const span = Number(new URLSearchParams(qs).get('span')) === 3 ? 3 : 1
      return await fetchNews(g.kw, g.ex, span)
    }
    if (m === 'GET' && seg[1] === 'news' && seg[2] === 'stock' && seg.length === 4) {
      const id = seg[3]
      if (!/^\d{4}$/.test(id)) return { ok: false, status: 400, data: { error_code: 'COMPANY_NOT_FOUND' } }
      const ds = await loadDs()
      const name = ds.byId.get(id)?.name
      if (!name) return { ok: false, status: 404, data: { error_code: 'COMPANY_NOT_FOUND' } }
      const s = newsSettings().stock[id]
      // 沒設定過 → 預設「公司名稱、代號」（與 app.js stockKw 的預設相同）；設過就用設定的關鍵字與排除字
      return await fetchNews(s && s.kw.length ? s.kw : [name, id], s ? s.ex : [], 5)
    }
    if (m === 'GET' && p === '/news/sources') {
      try {
        const d = await apiGet<Json>('/api/news/sources')
        const sources = (Array.isArray(d?.sources) ? d.sources : []).filter((s: any) => s && typeof s.name === 'string' && s.name)
          .slice(0, 100).map((s: any) => ({
            // 停用比對新聞的 source（來源名稱），所以 source_id 用 name
            source_id: str(s.name, 100), id: str(s.id, 64), name: str(s.name, 100), url: httpsUrl(s.url), enabled: true, content_scope: 'TITLE_ONLY', usage: '',
          }))
        return ok({ sources })
      } catch (e) { return errReply(e) }
    }
    // 個股問題：/companies/<代號>/questions[?include_deleted=true]、/<問題>（PUT／PATCH／DELETE）、/<問題>/restore（POST）；存本機 kupei3_questions
    if (seg[1] === 'companies' && seg[3] === 'questions' && seg.length >= 4 && seg.length <= 6) {
      if (!Q_CODE.test(seg[2] || '')) return { ok: false, status: 400, data: { error_code: 'COMPANY_NOT_FOUND' } }
      return questionsReq(m, seg, qs, body, headers && typeof headers === 'object' ? headers : {})
    }
    // 報告：/reports/<代號>、/reports/<代號>/<期別>/<版次>、POST /reports/<代號>/requests；/inputs（上傳參考資料）後端不支援
    if (seg[1] === 'reports' && /^\d{4}$/.test(seg[2] || '')) {
      const code = seg[2]
      if (m === 'GET' && seg.length === 3) return await reportList(code)
      if (m === 'GET' && seg.length === 5) return await reportOne(code, seg[3], seg[4])
      if (m === 'POST' && seg.length === 4 && seg[3] === 'requests') return await requestReport(code, body)
      return { ok: false, status: 404, data: { error_code: 'NOT_PROVIDED' } }
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
      const r = await optionalFile(() => client.loadValuation())
      return r.ok ? ok(adaptValuation(ds, r.data)) : no(r.status || 404)
    }
    if (m === 'GET' && p === '/help') {
      const r = await optionalFile(() => client.loadHelp())
      return r.ok && r.data?.features ? r : no(404)
    }
  } catch (e) {
    return no(e instanceof KupeiError ? e.status : 502)
  }
  // 自選、設定、登入、報告參考資料：Pages 版沒有對應的後端端點，UI 走本機模式或顯示「尚未提供」
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
    let memo = companyMemo.get(ds)
    if (!memo) companyMemo.set(ds, (memo = new Map()))
    const hit = memo.get(id)
    if (hit) return hit
    let tree: TreeNode[] | null = null
    try { tree = await client.loadDetail(id) } catch (e) { if (!(e instanceof KupeiError && e.status === 404)) throw e }
    const out = adaptCompany(ds, id, tree)
    memo.set(id, out)
    return out
  },
}

/* ---------------- 雲端同步：本機四份資料 ⇄ 帳號的雲端文件 ---------------- */

/** 可以同步＝已登入帳號，或使用舊的寫入權杖（相容保留，Adem 說明之後以登入取代） */
const canSync = () => !!client.getSession() || client.hasWriteToken()
const syncUser = () => client.getSession()?.username ?? '寫入權杖'

const SYNC: Record<string, string> = { kupei3_watch: 'ui-watch', kupei3_news: 'ui-news', kupei3_report: 'ui-report', kupei3_questions: 'ui-questions' }
const META = 'kupei3_sync'
/**
 * owner＝本機這幾份資料屬於哪個帳號（最後一次同步的帳號；寫入權杖算「寫入權杖」）。登出時不清，
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
        // 雲端被 PUT null 清空時版本不是 0，baseVersion 要帶雲端目前的版本，否則必定 409
        const r = await client.store.put(dk, { savedAt: new Date().toISOString(), value: local } as CloudDoc, cloud.version)
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
    window.clearTimeout(pushTimer)
    // 太大、超過額度：重試也不會成功（串接規範 §3），只提示，等使用者下次修改再推
    if (e instanceof KupeiError && e.status === 413) return setSyncMsg('同步失敗：資料太大（單份上限 256 KB），請減少內容')
    if (e instanceof KupeiError && e.code === 'QUOTA_EXCEEDED') return setSyncMsg('同步失敗：雲端空間已滿（每人 50 份、2 MB），請刪除不用的資料')
    setSyncMsg('同步失敗，稍後會再試')
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
/** 重設密碼的錯誤訊息（後端碼錯、過期、用過、帳號停用一律回 401 INVALID_CREDENTIALS） */
const RESET_ERR: Record<string, string> = {
  ...ERR, INVALID_CREDENTIALS: '帳號或重設碼不正確，或重設碼已過期',
  BAD_REQUEST: '格式不符：帳號 3～32 字（英數與 _ . -，開頭英數），新密碼 8～128 字', NOT_FOUND: '重設密碼功能尚未開通，請稍後再試',
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const USER_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/
const FLASH_KEY = 'kupei:acct-flash'
/** 存一段提示，重新載入後打開帳號視窗顯示 */
const flash = (t: string) => { try { sessionStorage.setItem(FLASH_KEY, t) } catch { /* ignore */ } }
const taipeiTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '時間不明')
const DOC_LABEL: Record<string, string> = { kupei3_watch: '自選群組', kupei3_news: '新聞設定', kupei3_report: '報告設定', kupei3_questions: '個股問題' }

/** 非 2xx 回應 → KupeiError（形狀同 kupei-client：{ error: { code, message, details } }） */
async function errFrom(res: Response): Promise<KupeiError> {
  let e: Json = {}
  try { const j = await res.json(); if (j && typeof j.error === 'object' && j.error) e = j.error } catch { /* 不是 JSON */ }
  const ra = res.headers.get('Retry-After')
  return new KupeiError(
    res.status,
    typeof e.code === 'string' ? e.code : res.status === 401 ? 'UNAUTHENTICATED' : res.status === 404 ? 'NOT_FOUND' : `HTTP_${res.status}`,
    typeof e.message === 'string' ? e.message : `HTTP ${res.status}`,
    ra && /^\d+$/.test(ra.trim()) ? Number(ra) : null,
    e.details,
  )
}

/* ---- 忘記密碼（K-33） ----
 * POST /api/auth/reset { username, code, newPassword }：成功回應同 login（{ user, token, expiresAt }），等同登入；
 * 失敗 401 INVALID_CREDENTIALS（碼錯、過期、用過、帳號停用都一樣）、400 BAD_REQUEST、429 RATE_LIMITED。
 * 用 starter 的 client.auth.resetPassword：成功即登入（client 寫入 session）；呼叫端再重新載入，走一次啟動同步。
 */
async function resetPassword(username: string, code: string, newPassword: string): Promise<void> {
  await client.auth.resetPassword(username, code, newPassword)
}

/** 重設碼：去掉空白與 -，12 字元才合格；送出時排成管理頁顯示的 XXXX-XXXX-XXXX（大小寫不動） */
const codeChars = (s: string) => s.replace(/[\s-]/g, '')
const codeFmt = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`

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
      ${notice ? `<p class="acct-ok" id="acct-notice">${esc(notice)}</p>` : ''}
      <p class="acct-muted">自選群組與新聞／報告設定依帳號存到雲端，換裝置登入同一帳號就同步。${esc(syncMsg ? '　' + syncMsg : '')}</p>
      <div class="acct-row"><button class="acct-btn" data-acct-sync="1">立即同步</button><button class="acct-btn ghost" data-acct-logout="1">登出</button><button class="acct-btn ghost" data-acct-close="1">關閉</button></div>
      <details class="acct-adv" id="acct-pw-box"${pwOpen ? ' open' : ''}><summary>改密碼</summary>
        <p class="acct-muted">改完後其他裝置會全部登出，這台維持登入。</p>
        <label>目前密碼<input id="acct-pw-cur" type="password" autocomplete="current-password" maxlength="128"></label>
        <label>新密碼<input id="acct-pw-new" type="password" autocomplete="new-password" maxlength="128"></label>
        <label>再輸入一次新密碼<input id="acct-pw-new2" type="password" autocomplete="new-password" maxlength="128"></label>
        <p class="${pwOk ? 'acct-muted' : 'acct-err'}" id="acct-pw-msg">${esc(pwMsg)}</p>
        <div class="acct-row"><button class="acct-btn" data-acct-pw="1">更改密碼</button></div></details>
      <details class="acct-adv" id="acct-imp-box"${impOpen ? ' open' : ''}><summary>匯入舊的寫入權杖資料</summary>
        <p class="acct-muted">以前用「寫入權杖」同步的自選與設定，可以搬進這個帳號。權杖只用來讀一次，不會存起來；舊的資料不會被刪除。</p>
        ${impDocs ? `<p>找到 ${impDocs.length} 份可匯入的資料：</p><ul class="acct-list" id="acct-imp-list">${impDocs.map((d) => `<li>${esc(DOC_LABEL[d.lk] ?? d.dk)}<span class="acct-muted">更新於 ${esc(taipeiTime(d.updatedAt))}</span></li>`).join('')}</ul>
        ${impOther ? `<p class="acct-muted">另有 ${impOther} 份不是本站同步用的文件，不會匯入。</p>` : ''}
        <p class="acct-muted">匯入後會取代這個帳號目前的這些資料；這台瀏覽器原本的內容會先備份（kupei3_*_prev）。</p>
        <div class="acct-row"><button class="acct-btn" data-acct-imp-go="1"${impBusy ? ' disabled' : ''}>確認匯入</button><button class="acct-btn ghost" data-acct-imp-cancel="1"${impBusy ? ' disabled' : ''}>取消</button></div>`
        : `<input id="acct-imp-wt" type="password" placeholder="寫入權杖" autocomplete="off" spellcheck="false">
        <div class="acct-row"><button class="acct-btn" data-acct-imp-read="1"${impBusy ? ' disabled' : ''}>讀取</button></div>`}
        <p class="${impErr ? 'acct-err' : 'acct-muted'}" id="acct-imp-msg">${esc(impMsg)}</p></details>
      <p class="acct-muted">登出後資料保留在這台瀏覽器。忘記密碼時，請向管理員索取重設碼，在登入畫面按「忘記密碼？」。</p></div>`
  } else if (mode === 'reset') {
    host.innerHTML = `<div class="acct-backdrop" data-acct-close="1"></div><div class="acct-modal" role="dialog" aria-label="重設密碼">
      <h2>重設密碼</h2>
      <p class="acct-muted">請向管理員索取重設碼（24 小時內有效、只能用一次）。重設後會直接登入，其他裝置的登入全部失效。</p>
      <label>帳號<input id="acct-user" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="32"></label>
      <label>重設碼<input id="acct-code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="32" placeholder="XXXX-XXXX-XXXX"></label>
      <label>新密碼<input id="acct-rpass" type="password" autocomplete="new-password" maxlength="128"></label>
      <label>再輸入一次新密碼<input id="acct-rpass2" type="password" autocomplete="new-password" maxlength="128"></label>
      <p class="acct-muted">帳號 3～32 字（英數與 _ . -，開頭英數）；新密碼 8～128 字。</p>
      <p class="acct-err" id="acct-err">${esc(formMsg)}</p>
      <div class="acct-row"><button class="acct-btn" data-acct-submit="1">重設並登入</button><button class="acct-btn ghost" data-acct-back="1">返回登入</button><button class="acct-btn ghost" data-acct-close="1">取消</button></div></div>`
    ;(document.getElementById('acct-user') as HTMLInputElement | null)?.focus()
  } else {
    host.innerHTML = `<div class="acct-backdrop" data-acct-close="1"></div><div class="acct-modal" role="dialog" aria-label="登入">
      <h2>${mode === 'login' ? '登入' : '建立帳號'}</h2>
      <p class="acct-muted">評分與行情不需要登入；登入後自選與設定可跨裝置同步。</p>
      <label>帳號<input id="acct-user" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="32"></label>
      <label>密碼<input id="acct-pass" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" maxlength="128"></label>
      ${mode === 'login' ? '<p class="acct-forgot"><button type="button" class="acct-link" data-acct-forgot="1">忘記密碼？</button></p>' : ''}
      ${mode === 'register' && inviteRequired === true ? '<label>邀請碼<input id="acct-invite" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64"></label>' : ''}
      ${mode === 'register' ? '<label>再輸入一次密碼<input id="acct-pass2" type="password" autocomplete="new-password" maxlength="128"></label><p class="acct-muted">帳號 3～32 字（英數與 _ . -，開頭英數，自動轉小寫）；密碼 8～128 字。忘記密碼時可向管理員索取重設碼。</p>' : ''}
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

async function submitReset() {
  const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''
  const u = val('acct-user').trim().toLowerCase(), code = codeChars(val('acct-code')), p1 = val('acct-rpass'), p2 = val('acct-rpass2')
  if (!USER_RE.test(u)) formMsg = '帳號要 3～32 字（英數與 _ . -，開頭英數）'
  else if (code.length !== 12) formMsg = '重設碼是 12 個字（XXXX-XXXX-XXXX）'
  else if (p1.length < 8 || p1.length > 128) formMsg = '新密碼要 8～128 字'
  else if (p2 !== p1) formMsg = '兩次輸入的新密碼不一樣'
  else {
    formMsg = '處理中…'; renderAcct()
    try {
      await resetPassword(u, codeFmt(code), p1)
      // 重新載入：以新帳號的雲端資料為準走一次啟動同步（換帳號規則 owner／_prev 也在那裡處理）
      flash('密碼已重設，其他裝置已登出')
      frozen = true
      window.clearTimeout(pushTimer)
      location.reload()
      return
    } catch (e) {
      formMsg = e instanceof KupeiError ? RESET_ERR[e.code] || `失敗（${e.status}）` : '無法連線，請稍後再試'
    }
  }
  renderAcct()
}

/* ---- 匯入舊的寫入權杖資料（K-29） ----
 * 以前用寫入權杖同步的資料存在共用的雲端文件（owner kupei）；改用帳號後看不到。
 * 讀：用貼上的權杖 GET /api/store 列表＋SYNC 對照表裡的每份文件。權杖只在這個函式的區域變數裡，讀完就丟（不存、不印、不進網址）。
 * 寫：使用者確認後，先備份本機到 kupei3_*_prev，再以帳號權杖 PUT 到帳號的同名文件（baseVersion＝帳號雲端目前版本，409 重讀後重試一次），
 * 本機換成匯入內容後重新載入。舊文件不刪。
 */
async function impGet(token: string, path: string): Promise<Json> {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw await errFrom(res)
  return (await res.json()) as Json
}

async function impRead() {
  const el = document.getElementById('acct-imp-wt') as HTMLInputElement | null
  const token = el?.value.trim() ?? ''
  if (el) el.value = '' // 重畫時不保留權杖
  impOpen = true; impErr = false
  if (!token) { impErr = true; impMsg = '請貼上寫入權杖'; renderAcct(); return }
  impBusy = true; impMsg = '讀取中…'; renderAcct()
  try {
    const list = await impGet(token, '/api/store')
    const docs: Json[] = (Array.isArray(list?.docs) ? list.docs : []).filter((d: any) => d && typeof d.key === 'string')
    const keys = new Set(Object.values(SYNC))
    const found: NonNullable<typeof impDocs> = []
    for (const [lk, dk] of Object.entries(SYNC)) {
      const meta = docs.find((d) => d.key === dk)
      if (!meta || !(typeof meta.version === 'number' && meta.version > 0)) continue
      const d = await impGet(token, `/api/store/${dk}`)
      const v = d?.data
      if (!v || typeof v !== 'object' || typeof v.value !== 'string') continue
      found.push({ lk, dk, updatedAt: isoOrNull(d.updatedAt) ?? isoOrNull(meta.updatedAt), value: v.value })
    }
    impOther = docs.filter((d) => !keys.has(d.key)).length
    if (found.length) { impDocs = found; impMsg = '' } else { impErr = true; impMsg = '這把權杖沒有資料可匯入' }
  } catch (e) {
    impErr = true
    impMsg = e instanceof KupeiError
      ? e.status === 401 || e.status === 403 ? '權杖不正確' : e.code === 'RATE_LIMITED' ? ERR.RATE_LIMITED : `讀取失敗（${e.status}）`
      : '無法連線，請稍後再試'
  } finally {
    impBusy = false
  }
  renderAcct()
}

const impApply = () => serial(async () => {
  const docs = impDocs
  if (!docs || !client.getSession()) return
  const who = syncUser()
  impBusy = true; impErr = false; impMsg = '匯入中…'; renderAcct()
  window.clearTimeout(pushTimer)
  const meta = readMeta()
  // 先備份這台目前的內容（覆蓋舊備份；本機沒有這份就不動舊備份）
  for (const d of docs) { const cur = localStorage.getItem(d.lk); if (cur != null) setLocal(d.lk + '_prev', cur) }
  let done = 0
  try {
    for (const d of docs) {
      const body: CloudDoc = { savedAt: new Date().toISOString(), value: d.value }
      let r
      try {
        r = await client.store.put(d.dk, body, (await client.store.get<CloudDoc>(d.dk)).version)
      } catch (e) {
        if (!(e instanceof KupeiError && e.status === 409)) throw e
        // 讀到版本後到寫入前被別台裝置改了：重新讀取版本，只重試這一次
        r = await client.store.put(d.dk, body, (await client.store.get<CloudDoc>(d.dk)).version)
      }
      if (syncUser() !== who) throw new Error('帳號已變更')
      setLocal(d.lk, d.value)
      meta.versions[d.dk] = r.version
      meta.dirty[d.lk] = false
      done++
    }
    meta.owner = who
    writeMeta(meta)
    impDocs = null; impBusy = false
    flash(`已匯入 ${done} 份舊資料；這台原本的內容備份在 kupei3_*_prev`)
    reloadSoon('已匯入舊資料，重新整理畫面…')
  } catch (e) {
    impBusy = false; impErr = true
    impMsg = !(e instanceof KupeiError) ? '匯入失敗：無法連線，請稍後再試'
      : e.status === 413 ? '匯入失敗：資料太大（單份上限 256 KB）'
      : e.code === 'QUOTA_EXCEEDED' ? '匯入失敗：雲端空間已滿（每人 50 份、2 MB），請刪除不用的資料'
      : e.status === 409 ? '匯入失敗：雲端資料剛被其他裝置更新，請再試一次'
      : e.code === 'UNAUTHENTICATED' ? ERR.UNAUTHENTICATED
      : `匯入失敗（${e.status}）`
    if (done && syncUser() === who) {
      // 已寫進帳號的那幾份本機也換掉了：存 meta、重新載入，提示帶過去
      meta.owner = who
      writeMeta(meta)
      flash(`只匯入了 ${done}／${docs.length} 份。${impMsg}`)
      reloadSoon('已匯入部分舊資料，重新整理畫面…')
    } else renderAcct()
  }
})

async function submitForm() {
  if (mode === 'reset') return submitReset()
  const u =(document.getElementById('acct-user') as HTMLInputElement).value.trim().toLowerCase()
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
  if (t.closest('[data-acct]')) { acctOpen = true; formMsg = ''; pwMsg = ''; pwOpen = false; notice = ''; if (!impDocs) { impMsg = ''; impErr = false }; renderAcct(); return }
  if (!acctOpen) return
  if (t.closest('[data-acct-close]')) { acctOpen = false; renderAcct() }
  else if (t.closest('[data-acct-forgot]')) { mode = 'reset'; formMsg = ''; renderAcct() }
  else if (t.closest('[data-acct-back]')) { mode = 'login'; formMsg = ''; renderAcct() }
  else if (t.closest('[data-acct-imp-read]')) { if (!impBusy) void impRead() }
  else if (t.closest('[data-acct-imp-go]')) { if (!impBusy) void impApply() }
  else if (t.closest('[data-acct-imp-cancel]')) { if (!impBusy) { impDocs = null; impMsg = ''; impErr = false; renderAcct() } }
  else if (t.closest('[data-acct-mode]')){ mode = mode === 'login' ? 'register' : 'login'; formMsg = ''; if (mode === 'register') loadInviteConfig(); renderAcct() }
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
document.addEventListener('toggle', (e) => {
  const t = e.target as HTMLElement
  if (t.id === 'acct-pw-box') pwOpen = (t as HTMLDetailsElement).open
  else if (t.id === 'acct-imp-box') impOpen = (t as HTMLDetailsElement).open
}, true)
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
  w.KupeiAuth = {
    session: () => client.getSession() ?? (client.hasWriteToken() ? { username: '寫入權杖', expiresAt: '' } : null),
    /** 有登入帳號（寫入權杖不算）：產生報告請求只收登入權杖 */
    loggedIn: () => !!client.getSession(),
    /** 打開帳號視窗的登入畫面（UI 引導登入用） */
    openLogin: () => { acctOpen = true; mode = 'login'; formMsg = ''; pwMsg = ''; pwOpen = false; renderAcct() },
  }
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
  // 重設密碼、匯入完成後重新載入：打開帳號視窗顯示結果
  try {
    const f = sessionStorage.getItem(FLASH_KEY)
    if (f) { sessionStorage.removeItem(FLASH_KEY); notice = f; acctOpen = true }
  } catch { /* ignore */ }
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
