// KuPei 唯讀 API 客戶端。不依賴任何框架（Vue／React／原生都能用）。
// 載入策略（實測後設計；數字見 KuPei-API.md「快取與載入」）：
//   1. 批次檔網址帶 ?v=<manifest.hashes>，伺服器回 immutable 一年 → 第二次打開完全不碰網路。
//   2. 第一次打開：manifest（1 KB，no-cache）→ summary＋tr＋vparams＋nodes 並行。
//      之後打開：先用上次記住的批次直接從快取還原畫面，同時在背景核對 manifest；換批次才重載並通知。
//   3. 行情與評分資料彼此獨立，preload() 同時起跑，不要一個等一個。
//   4. /api 有每分鐘 30 次限流：latest 在記憶體留 60 秒並共用進行中的請求；history 同一個 tick 的呼叫合併成一次。
//   5. 429 依 Retry-After 自動重試一次（只限 GET）；每個請求 20 秒逾時。
//   6. 雲端文件（store）：整包 JSON＋版本號；update() 讀改寫並自動處理 409。
//   7. 使用者帳號：auth.register／login 拿登入權杖（存在 storage key kupei:session），之後所有請求都用它，
//      雲端文件依帳號分開存。權杖優先順序：登入權杖 ＞ 寫入權杖 ＞ 建置時的唯讀權杖。
//      用登入權杖時收到 401 UNAUTHENTICATED（過期、在別處登出、帳號被停用、在別台裝置改了密碼）→ 自動清掉 session，前端回到未登入。
//      註冊前先呼叫 auth.config()：inviteRequired 為 true 時註冊畫面要多一個邀請碼欄位。
//      auth.changePassword() 成功後這個帳號所有裝置的舊權杖都失效，這台自動換成新權杖。
//      忘記密碼：使用者向維護者拿一次性重設碼（24 小時、只能用一次），auth.resetPassword(帳號, 重設碼, 新密碼)
//      成功後所有裝置的舊權杖失效，這台直接是登入狀態（同 login）。
//   8. 可選批次檔（help.json 說明頁、valuation.json 估價、node_info.json 節點完整定義）：不在 loadDataset 裡，
//      要用時才呼叫 loadHelp()／loadValuation()／loadNodeInfo()。這個批次沒交付（manifest.hashes 沒有該鍵）→ 回 null、
//      不打網路；有就帶 ?v=<雜湊> 抓一次，同一個批次之後直接回記憶體，換批次才重抓。內容形狀由批次交付方決定，用前自己檢查。
//   9. 新聞與報告：news() 後端代抓 Google 新聞（瀏覽器可留 5 分鐘）；reports()／report() 讀報告 metadata（檔案只有外部連結）。
//      requestReport()／reportRequests() 只限登入（沒登入丟 401 UNAUTHENTICATED、不打網路）；報告由外部管線產生，不要輪詢進度。
//  10. 報告參考檔（2026-10-28）：reportInputs.upload／list／download／remove 只限登入（沒登入丟 401、不打網路）。
//      upload 在瀏覽器算 SHA-256、依副檔名決定 Content-Type（不靠瀏覽器猜），本文是檔案原始位元組；只看得到自己上傳的。
//
// 用法：
//   const kupei = createKupeiClient({ baseUrl: import.meta.env.VITE_KUPEI_BASE, token: import.meta.env.VITE_KUPEI_TOKEN })
//   kupei.preload()                                      // app 一啟動就呼叫，評分與行情同時開跑
//   const ds = await kupei.loadDataset({ onUpdate })     // 可能先回快取的舊批次，換批次時 onUpdate 會再給新的
//   const latest = await kupei.marketLatest()
//   const q = quoteOf(latest, '2330')
//   const intra = await kupei.marketIntraday()           // 盤中快照（每 10 分鐘更新）；intra.stale 為 true 時改顯示收盤價
//   const valuation = await kupei.loadValuation()         // 這個批次沒有估價就是 null → 不要顯示估價欄位
//   const help = await kupei.loadHelp()                   // 說明頁；null ＝ 沒交付
//   const nodeInfo = await kupei.loadNodeInfo()           // 節點完整定義；null ＝ 沒交付（英文名仍看 ds.nodeName）
//   const { inviteRequired } = await kupei.auth.config()  // 註冊要不要邀請碼
//   await kupei.auth.register(username, password, inviteCode)   // 或 kupei.auth.login(...)；成功回 { user }
//   await kupei.auth.changePassword(current, next)       // 其他裝置全部登出，這台換新權杖
//   await kupei.auth.resetPassword(username, resetCode, next)   // 忘記密碼：用維護者給的重設碼設新密碼，成功即登入
//   kupei.getSession()                                   // { username, expiresAt } | null，同步、不打網路
//   await kupei.store.update('watchlist', (cur) => ({ ...(cur ?? {}), groups }))   // 跨裝置同步（依帳號）
//   await kupei.auth.logout()
//   const { items, stale } = await kupei.news({ q: ['台積電', '2330'], exclude: ['廣告'], days: 3 })
//   const reports = await kupei.reports('2330')           // 列表（不含 summary）；kupei.report('2330', '2026Q2', 1) 含 summary
//   await kupei.requestReport('2330', '2026Q2')           // 登入後才能送；進度看 kupei.reportRequests('2330')
//   const input = await kupei.reportInputs.upload('2330', file)   // <input type="file"> 的 File；≤ 20 MiB、pdf/txt/md/csv/xlsx/png/jpg
//   const blob = await kupei.reportInputs.download('2330', input.id)   // 只限自己上傳的；kupei.reportInputs.remove(...) 刪除
import type {
  ApiErrorBody,
  AuthConfig,
  AuthResponse,
  AuthUser,
  Company,
  Doc,
  DocMeta,
  Head,
  HelpDoc,
  History,
  IntradayResponse,
  LatestResponse,
  Major,
  Manifest,
  MarketStatus,
  NewsQuery,
  NewsResponse,
  NewsSource,
  NodeInfo,
  Quote,
  RawRow,
  RawSummary,
  Report,
  ReportMeta,
  ReportInput,
  ReportInputMime,
  ReportRequest,
  ReportRequestCreated,
  ResetPasswordBody,
  SessionInfo,
  StoredSession,
  Translations,
  TreeNode,
  Valuation,
  ValuationParam,
} from './kupei-types'

export interface KupeiConfig {
  /** 例如 https://kupei-dashboard.tmac19920626.workers.dev（結尾不要斜線） */
  baseUrl: string
  /** 唯讀權杖；從環境變數讀，不要寫死 */
  token: string
  /**
   * 寫入權杖（雲端文件用）。不要放進建置或環境變數：由使用者在 App 的設定畫面輸入一次，
   * 客戶端會存在 storage（key kupei:write-token）。設了之後所有請求都用它（它是唯讀權杖的超集）。
   */
  writeToken?: string | null
  /** 自訂 fetch（測試時替換） */
  fetch?: typeof fetch
  /** 記住上次批次、寫入權杖與登入狀態用；預設 localStorage，傳 null 關閉（登入只留在記憶體） */
  storage?: (Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>) | null
  /** 單一請求逾時（毫秒），預設 20000 */
  timeoutMs?: number
  /** 登入狀態改變時呼叫（登入、登出、權杖失效被清掉）；null ＝ 未登入 */
  onSessionChange?: (session: SessionInfo | null) => void
}

// 只用「可擦除」的 TypeScript 語法（不用建構子參數屬性、enum），Node 直接執行 .ts 或任何只去型別的工具都吃得下
export class KupeiError extends Error {
  status: number
  code: string
  /** 429 時伺服器要求等待的秒數 */
  retryAfter: number | null
  details: unknown
  constructor(status: number, code: string, message: string, retryAfter: number | null = null, details?: unknown) {
    super(message)
    this.name = 'KupeiError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
    this.details = details
  }
  /** 權杖沒帶或不對 → 請使用者檢查 .env.local；登入權杖失效時客戶端已自動登出，請回到登入畫面 */
  get unauthenticated() {
    return this.status === 401
  }
  /** 這個路徑不開放，不要重試、不要繞 */
  get forbidden() {
    return this.status === 403
  }
  get rateLimited() {
    return this.status === 429
  }
}

export interface Dataset {
  manifest: Manifest
  head: Head
  majors: Major[]
  companies: Company[]
  byId: Map<string, Company>
  /** 排名母體：排除金融保險業 */
  market: Company[]
  /** 節點 id → 英文名稱（否決／複核來源顯示用） */
  nodeName: Map<string, string>
  tr: Translations
  vparams: ValuationParam[]
}

export interface LoadOptions {
  /** 背景核對發現換了批次時呼叫（第一次打開、或批次沒變時不會呼叫） */
  onUpdate?: (ds: Dataset) => void
  /** 設 false 就不用上次記住的批次，一律先等 manifest */
  allowStale?: boolean
}

/** 緊湊陣列 → 具名欄位。欄位順序見 KuPei-API.md 附錄 A */
export function decodeRow(r: RawRow): Company {
  return {
    id: r[0],
    name: r[1],
    ind: r[2],
    fin: r[3] === 1,
    rank: r[4],
    pc: r[5],
    maj: r[6].map((m) => ({ s: m[0], mr: m[2], pol: m[3] === 1, cpol: m[4] === 1, st: m[5], below: m[6] })),
    veto: r[7] === 1,
    vetoFrom: r[8],
    finrev: r[9] === 1,
    finSrc: r[10],
  }
}

/** 這一格算不算有分數（排序與底色都只看這個） */
export function hasScore(cell: { s: number | null; st: string }): boolean {
  return cell.s != null && (cell.st === 'TRIAL_SCORE' || cell.st === 'POLICY_SCORE')
}

/** 名次百分位：第一名 1、最後一名 0；沒有名次或母體不足回 null */
export function rankPercentile(rank: number | null, population: number): number | null {
  if (rank == null || population <= 1) return null
  return 1 - (rank - 1) / (population - 1)
}

/** 從 /api/market/latest 取某家公司的行情，並算漲跌幅 */
export function quoteOf(latest: LatestResponse | null, code: string): Quote | null {
  const q = latest?.quotes[code]
  if (!q) return null
  const [close, change, volume] = q
  const prev = close != null && change != null ? close - change : null
  return { close, change, volume, pct: prev ? (change! / prev) * 100 : null }
}

/** 股價格式：1,000 以上整數不帶小數、非整數一位；1,000 以下兩位 */
export function fmtPrice(x: number | null | undefined): string {
  if (x == null) return '—'
  const digits = x >= 1000 ? (Number.isInteger(x) ? 0 : 1) : 2
  return x.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

const STORAGE_KEY = 'kupei:last-manifest'
const WRITE_TOKEN_KEY = 'kupei:write-token'
const SESSION_KEY = 'kupei:session'
const LATEST_TTL_MS = 60_000
const HISTORY_BATCH = 30

type BatchName = 'summary' | 'tr' | 'vparams' | 'nodes'
/** 可選批次檔：manifest.hashes 有這個鍵才有檔案 */
type OptionalBatchName = 'help' | 'valuation' | 'node_info'

/** manifest 裡有雜湊的用雜湊，沒有的（details）用發布時間；網址一變，瀏覽器就當成新檔案 */
function versionOf(m: Manifest, name?: BatchName | OptionalBatchName): string {
  return encodeURIComponent((name && m.hashes[name]) || m.published_at)
}

/** Retry-After 可以是秒數或 HTTP 日期；無效回 null（呼叫端用預設等待時間） */
function retryAfterSeconds(v: string | null): number | null {
  if (!v) return null
  if (/^\s*\d+\s*$/.test(v)) return Number(v)
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - Date.now()) / 1000))
}

function sameBatch(a: Manifest, b: Manifest): boolean {
  return a.run === b.run && a.published_at === b.published_at && JSON.stringify(a.hashes) === JSON.stringify(b.hashes)
}

/** 報告參考檔單檔上限（同後端） */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024

/** 副檔名 → 上傳時的 Content-Type（同後端白名單；不在表上＝不支援） */
export const INPUT_MIME_BY_EXT: Readonly<Record<string, ReportInputMime>> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

/** 檔名 → Content-Type；不支援的副檔名回 null */
export function inputMimeOf(fileName: string): ReportInputMime | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName.trim())
  return (m && INPUT_MIME_BY_EXT[(m[1] ?? '').toLowerCase()]) || null
}

export function createKupeiClient(cfg: KupeiConfig) {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const doFetch = cfg.fetch ?? fetch
  const timeoutMs = cfg.timeoutMs ?? 20_000
  const storage = cfg.storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : cfg.storage
  if (!cfg.token) console.warn('[kupei] 沒有權杖：請在 .env.local 設定 VITE_KUPEI_TOKEN')

  let writeToken: string | null = cfg.writeToken ?? null
  if (writeToken === null && storage) {
    try {
      writeToken = storage.getItem(WRITE_TOKEN_KEY)
    } catch {
      /* ignore */
    }
  }

  // ── 登入狀態：{ token, username, expiresAt } 存在 storage ──
  let session: StoredSession | null = null
  try {
    const raw = storage?.getItem(SESSION_KEY)
    const s = raw ? (JSON.parse(raw) as StoredSession) : null
    if (s && typeof s.token === 'string' && typeof s.username === 'string' && typeof s.expiresAt === 'string') session = s
  } catch {
    /* 壞掉的值當作沒登入 */
  }
  /** 過期的 session 當作沒有（不打網路），並清掉 */
  function liveSession(): StoredSession | null {
    if (session && Date.parse(session.expiresAt) <= Date.now()) setSession(null)
    return session
  }
  function setSession(next: StoredSession | null) {
    const changed = (session?.token ?? null) !== (next?.token ?? null)
    session = next
    try {
      if (next) storage?.setItem(SESSION_KEY, JSON.stringify(next))
      else storage?.removeItem?.(SESSION_KEY)
    } catch {
      /* ignore */
    }
    if (changed) cfg.onSessionChange?.(next ? { username: next.username, expiresAt: next.expiresAt } : null)
  }

  /** 優先順序：登入權杖 ＞ 寫入權杖 ＞ 建置時的唯讀權杖 */
  const currentToken = () => liveSession()?.token || writeToken || cfg.token

  interface GetOpts {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: unknown
    cache?: RequestCache
    signal?: AbortSignal
    /** 瀏覽器支援時降低優先序（預先載入用） */
    low?: boolean
    retried?: boolean
    /** 不帶 Authorization（註冊、登入） */
    anonymous?: boolean
    /** 指定要用的權杖（登出時用當下的登入權杖） */
    token?: string
    /** 原始本文（報告參考檔上傳）：不轉 JSON，Content-Type 等由 headers 給 */
    raw?: Blob | ArrayBuffer
    headers?: Record<string, string>
    /** 成功時回 Blob（下載），不解析 JSON */
    blob?: boolean
  }

  async function get<T>(path: string, opts: GetOpts = {}): Promise<T> {
    const signals = [AbortSignal.timeout(timeoutMs), ...(opts.signal ? [opts.signal] : [])]
    const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0]
    const token = opts.anonymous ? null : (opts.token ?? currentToken())
    const init: RequestInit & { priority?: 'low' | 'auto' } = {
      method: opts.method ?? 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
      cache: opts.cache ?? 'default',
      signal,
    }
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body)
    if (opts.raw !== undefined) init.body = opts.raw
    if (opts.low) init.priority = 'low'
    const res = await doFetch(base + path, init)
    if (res.ok) return (opts.blob ? await res.blob() : await res.json()) as T
    let e: Partial<ApiErrorBody['error']> = {}
    try {
      const body = await res.json()
      // 不是 { error: {...} } 形狀的 JSON（例如代理或閘道回的錯誤）也不能讓這裡丟 TypeError
      if (body && typeof body.error === 'object' && body.error) e = body.error
    } catch {
      /* /data/* 的 401、404 是純文字 */
    }
    const err = new KupeiError(
      res.status,
      typeof e.code === 'string' ? e.code : res.status === 401 ? 'UNAUTHENTICATED' : res.status === 404 ? 'NOT_FOUND' : `HTTP_${res.status}`,
      typeof e.message === 'string' ? e.message : `${path}：HTTP ${res.status}`,
      retryAfterSeconds(res.headers.get('Retry-After')),
      e.details,
    )
    // 用登入權杖被拒（過期、在別處登出、帳號停用）→ 清掉 session，前端回到未登入。下一個請求會改用寫入／唯讀權杖
    if (err.status === 401 && err.code === 'UNAUTHENTICATED' && token && session && token === session.token) setSession(null)
    // 被限流：依伺服器要求等待後重試一次（只限 GET；寫入重送可能撞版本，交給呼叫端）；再失敗就丟出去讓畫面處理
    if (err.rateLimited && !opts.retried && (opts.method ?? 'GET') === 'GET') {
      await new Promise((r) => setTimeout(r, Math.min(err.retryAfter ?? 30, 60) * 1000))
      return get<T>(path, { ...opts, retried: true })
    }
    throw err
  }

  /** 報告參考檔要登入：沒登入丟 401、不打網路 */
  function requireSession(): StoredSession {
    const s = liveSession()
    if (!s) throw new KupeiError(401, 'UNAUTHENTICATED', '還沒登入', null)
    return s
  }
  const inputsPath = (code: string) => `/api/reports/${encodeURIComponent(code)}/inputs`

  const loadManifest = () => get<Manifest>('/data/manifest.json', { cache: 'no-cache' })

  async function loadBatch(manifest: Manifest, low = false): Promise<Dataset> {
    const run = manifest.run
    const url = (name: BatchName, file = `${name}.json`) => `/data/${run}/${file}?v=${versionOf(manifest, name)}`
    const [summary, tr, vparams, nodes] = await Promise.all([
      get<RawSummary>(url('summary'), { low }),
      get<Translations>(url('tr'), { low }),
      get<ValuationParam[]>(url('vparams'), { low }),
      get<Record<string, string>>(url('nodes'), { low }),
    ])
    const companies = summary.rows.map(decodeRow)
    return {
      manifest,
      head: summary.head,
      majors: summary.majors,
      companies,
      byId: new Map(companies.map((c) => [c.id, c])),
      market: companies.filter((c) => !c.fin),
      nodeName: new Map(Object.entries(nodes)),
      tr,
      vparams,
    }
  }

  function remember(m: Manifest) {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(m))
    } catch {
      /* 隱私模式等情況存不進去，無所謂 */
    }
  }
  function recall(): Manifest | null {
    try {
      const raw = storage?.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as Manifest) : null
    } catch {
      return null
    }
  }

  let current: Dataset | null = null
  let loading: Promise<Dataset> | null = null
  const details = new Map<string, Promise<TreeNode[]>>()
  /** 可選批次檔：依「run＋檔名＋雜湊」快取（進行中的請求也共用）；換批次時清掉舊批次的 */
  const extras = new Map<string, Promise<unknown>>()

  async function loadOptional<T>(name: OptionalBatchName, low = false): Promise<T | null> {
    const ds = await client.loadDataset()
    const m = ds.manifest
    const hash = m.hashes[name]
    if (!hash) return null // 這個批次沒交付：檔案不存在，不打網路
    const key = `${m.run}\n${name}\n${hash}`
    let p = extras.get(key)
    if (!p) {
      for (const k of extras.keys()) if (!k.startsWith(`${m.run}\n`)) extras.delete(k) // 舊批次的不留
      p = get<T>(`/data/${m.run}/${name}.json?v=${versionOf(m, name)}`, { low })
      p.catch(() => extras.delete(key)) // 失敗不快取，下次重試
      extras.set(key, p)
    }
    return p as Promise<T>
  }
  const histories = new Map<string, History>()

  // ── 行情：共用進行中的請求＋ 60 秒記憶體快取（和伺服器的快取時間一致） ──
  let latestCache: { at: number; value: LatestResponse } | null = null
  let latestInFlight: Promise<LatestResponse> | null = null
  let intradayCache: { at: number; value: IntradayResponse } | null = null
  let intradayInFlight: Promise<IntradayResponse> | null = null

  // ── history：同一個 tick 內的呼叫合併成一次請求（列表畫面一次要幾十家時特別有用） ──
  let pending: { codes: Set<string>; promise: Promise<void> } | null = null
  function scheduleHistory(codes: string[]): Promise<void> {
    if (!pending) {
      const set = new Set<string>()
      const promise = new Promise<void>((resolve, reject) => {
        setTimeout(async () => {
          pending = null
          try {
            const need = [...set].filter((c) => !histories.has(c))
            for (let i = 0; i < need.length; i += HISTORY_BATCH) {
              const batch = need.slice(i, i + HISTORY_BATCH)
              const d = await get<{ quotes: Record<string, History['quotes']>; revenue: Record<string, History['revenue']> }>(
                `/api/market/history?codes=${batch.join(',')}`,
              )
              for (const c of batch) histories.set(c, { quotes: d.quotes[c] ?? [], revenue: d.revenue[c] ?? [] })
            }
            resolve()
          } catch (e) {
            reject(e)
          }
        }, 0)
      })
      pending = { codes: set, promise }
    }
    for (const c of codes) pending.codes.add(c)
    return pending.promise
  }

  const client = {
    /** 不需權杖；確認服務在線 */
    health: () => get<{ ok: boolean }>('/api/health', { cache: 'no-store' }),

    /** app 一啟動就呼叫：評分資料與行情同時開跑，彼此不等 */
    preload(opts: LoadOptions = {}) {
      void client.loadDataset(opts).catch(() => {})
      void client.marketLatest().catch(() => {})
    },

    /**
     * 取得評分資料集。
     * - 第一次：manifest → 批次檔（並行）。
     * - 之後：有記住的批次就先從瀏覽器快取還原並立刻回傳，同時核對 manifest；換批次才重載並呼叫 onUpdate。
     */
    loadDataset(opts: LoadOptions = {}): Promise<Dataset> {
      if (current) return Promise.resolve(current)
      if (loading) return loading
      const allowStale = opts.allowStale ?? true
      loading = (async () => {
        const remembered = allowStale ? recall() : null
        if (remembered) {
          // 舊批次的檔案帶 ?v=，幾乎一定命中快取；manifest 在背景同時核對
          const manifestP = loadManifest()
          try {
            current = await loadBatch(remembered)
          } catch {
            current = null // 快取被清掉又斷線之類：退回正常流程
          }
          const check = manifestP
            .then(async (fresh) => {
              remember(fresh)
              if (current && sameBatch(fresh, current.manifest)) return
              const next = await loadBatch(fresh)
              details.clear()
              current = next
              opts.onUpdate?.(next)
            })
            .catch(() => {})
          if (current) {
            void check
            return current
          }
          await check
          if (current) return current
        }
        const manifest = await loadManifest()
        remember(manifest)
        current = await loadBatch(manifest)
        return current
      })()
      loading.catch(() => (loading = null))
      return loading
    },

    /** 丟掉記憶體裡的資料集重新載入（例如使用者手動按「更新」） */
    reload(opts: LoadOptions = {}) {
      current = null
      loading = null
      details.clear()
      return client.loadDataset({ ...opts, allowStale: false })
    },

    /** 明細樹；沒有明細的公司回 null（看 manifest.details） */
    async loadDetail(code: string, low = false): Promise<TreeNode[] | null> {
      const ds = await client.loadDataset()
      if (!ds.manifest.details.includes(code)) return null
      let p = details.get(code)
      if (!p) {
        p = get<TreeNode[]>(`/data/${ds.manifest.run}/details/${code}.json?v=${versionOf(ds.manifest)}`, { low })
        p.catch(() => details.delete(code))
        details.set(code, p)
      }
      return p
    },

    /** 說明頁定義（help.json）。這個批次沒交付回 null（不打網路）；同一批次只抓一次 */
    loadHelp: (low = false) => loadOptional<HelpDoc>('help', low),

    /** 估價（valuation.json），原樣、後端不計算。沒交付回 null → 不要顯示估價欄位；同一批次只抓一次 */
    loadValuation: (low = false) => loadOptional<Valuation>('valuation', low),

    /** 節點完整定義（node_info.json，id → 物件）。沒交付回 null（英文名仍看 Dataset.nodeName）；同一批次只抓一次 */
    loadNodeInfo: (low = false) => loadOptional<NodeInfo>('node_info', low),

    /** 低優先序預先載入明細（例如列表捲到附近時），失敗不丟錯 */
    prefetchDetail(code: string) {
      void client.loadDetail(code, true).catch(() => {})
    },

    /** 各市場最新收盤。60 秒內重複呼叫直接回記憶體；進行中的請求共用；過期後瀏覽器用 ETag 換 304 */
    marketLatest(): Promise<LatestResponse> {
      const now = Date.now()
      if (latestCache && now - latestCache.at < LATEST_TTL_MS) return Promise.resolve(latestCache.value)
      if (latestInFlight) return latestInFlight
      latestInFlight = get<LatestResponse>('/api/market/latest')
        .then((v) => {
          latestCache = { at: Date.now(), value: v }
          return v
        })
        .finally(() => (latestInFlight = null))
      return latestInFlight
    },

    /** 近 20 個交易日與近 5 個月營收。同一個 tick 的呼叫合併、每次最多 30 檔、已載過的不重抓 */
    async marketHistory(codes: string[]): Promise<Map<string, History>> {
      const valid = [...new Set(codes)].filter((c) => /^\d{4}$/.test(c))
      if (valid.some((c) => !histories.has(c))) await scheduleHistory(valid)
      return new Map(valid.map((c) => [c, histories.get(c) ?? { quotes: [], revenue: [] }]))
    },

    // ── 盤中行情（K-48）──
    /**
     * 盤中行情快照（上市＋上櫃合併）。後端每 10 分鐘收一次外部推送，不是即時串流：不要輪詢，
     * 畫面打開或使用者手動重新整理時呼叫即可。60 秒內重複呼叫直接回記憶體；進行中的請求共用。
     * stale 為 true（休市、開盤前、推送延遲）時請改顯示收盤價（marketLatest）或標示資料時間。
     */
    marketIntraday(): Promise<IntradayResponse> {
      const now = Date.now()
      if (intradayCache && now - intradayCache.at < LATEST_TTL_MS) return Promise.resolve(intradayCache.value)
      if (intradayInFlight) return intradayInFlight
      intradayInFlight = get<IntradayResponse>('/api/market/intraday')
        .then((v) => {
          intradayCache = { at: Date.now(), value: v }
          return v
        })
        .finally(() => (intradayInFlight = null))
      return intradayInFlight
    },

    /** 行情資料範圍與最近抓取結果（資料新不新用） */
    marketStatus: () => get<MarketStatus>('/api/market/status', { cache: 'no-store' }),

    // ── 雲端文件：前端改的任何資料整包存雲端，跨裝置同步。需要登入（或寫入權杖）；登入時依帳號分開 ──

    /** 使用者在設定畫面輸入寫入權杖後呼叫；傳 null 清除（登出）。會存在 storage，下次打開不用再輸入 */
    setWriteToken(token: string | null) {
      writeToken = token && token.trim() ? token.trim() : null
      try {
        if (writeToken) storage?.setItem(WRITE_TOKEN_KEY, writeToken)
        else storage?.removeItem?.(WRITE_TOKEN_KEY)
      } catch {
        /* ignore */
      }
    },
    hasWriteToken: () => writeToken !== null,

    /** 目前登入的帳號（同步、不打網路）；沒登入或已過期回 null */
    getSession(): SessionInfo | null {
      const s = liveSession()
      return s ? { username: s.username, expiresAt: s.expiresAt } : null
    },

    // ── 使用者帳號：自己註冊、登入後雲端文件依帳號分開存 ──
    auth: {
      /**
       * 註冊並直接登入。帳號 3～32 字（英數與 _ . -，開頭英數，不分大小寫），密碼 8～128 字。
       * inviteCode：config().inviteRequired 為 true 時必填（關閉時會被忽略，帶了也沒關係）。
       * 錯誤：409 USERNAME_TAKEN、400 BAD_REQUEST、403 INVITE_REQUIRED（沒填邀請碼）、403 INVITE_INVALID（邀請碼不對）、
       * 429 RATE_LIMITED（每分鐘 10 次）
       */
      async register(username: string, password: string, inviteCode?: string): Promise<{ user: AuthUser }> {
        const code = inviteCode?.trim()
        const body = { username: username.trim(), password, ...(code ? { inviteCode: code } : {}) }
        const r = await get<AuthResponse>('/api/auth/register', { method: 'POST', body, cache: 'no-store', anonymous: true })
        setSession({ token: r.token, username: r.user.username, expiresAt: r.expiresAt })
        return { user: r.user }
      },

      /** 登入。帳號不存在或密碼錯都是 401 INVALID_CREDENTIALS（同一個訊息） */
      async login(username: string, password: string): Promise<{ user: AuthUser }> {
        const r = await get<AuthResponse>('/api/auth/login', { method: 'POST', body: { username: username.trim(), password }, cache: 'no-store', anonymous: true })
        setSession({ token: r.token, username: r.user.username, expiresAt: r.expiresAt })
        return { user: r.user }
      },

      /** 登出：通知後端作廢這個權杖（失敗也沒關係），並清掉本機的 session */
      async logout(): Promise<void> {
        const s = session
        setSession(null)
        if (!s) return
        try {
          await get<{ ok: true }>('/api/auth/logout', { method: 'POST', cache: 'no-store', token: s.token })
        } catch {
          /* 已經失效或離線：本機已登出即可 */
        }
      },

      /**
       * 改密碼（要已登入）。新密碼 8～128 字。成功後這個帳號所有裝置的登入權杖都失效（包含這台的舊權杖），
       * 這台自動換成伺服器發的新權杖（onSessionChange 會收到同一個帳號、新的 expiresAt）。
       * 錯誤：401 INVALID_CREDENTIALS（目前密碼不對；session 保留、不會被登出）、400 BAD_REQUEST、
       * 401 UNAUTHENTICATED（登入已失效，session 會被清掉）、429 RATE_LIMITED（與註冊、登入合計每分鐘 10 次）
       */
      async changePassword(currentPassword: string, newPassword: string): Promise<{ user: AuthUser }> {
        const s = liveSession()
        if (!s) throw new KupeiError(401, 'UNAUTHENTICATED', '還沒登入', null)
        const r = await get<AuthResponse>('/api/auth/password', {
          method: 'POST',
          body: { currentPassword, newPassword },
          cache: 'no-store',
          token: s.token,
        })
        setSession({ token: r.token, username: r.user.username, expiresAt: r.expiresAt })
        return { user: r.user }
      },

      /**
       * 忘記密碼（不需要登入）：用維護者給的一次性重設碼（XXXX-XXXX-XXXX；大小寫、- 與空白都不影響）設新密碼。
       * 新密碼 8～128 字。成功後這個帳號所有裝置的登入權杖都失效、重設碼作廢，這台直接是登入狀態（回應同 login）。
       * 錯誤：401 INVALID_CREDENTIALS（帳號或重設碼不對、過期、用過、帳號停用——不分是哪一種，請一律提示「帳號或重設碼不對，
       * 請向維護者重新索取」）、400 BAD_REQUEST（帳號或新密碼格式不對）、429 RATE_LIMITED（與註冊、登入合計每分鐘 10 次）
       */
      async resetPassword(username: string, code: string, newPassword: string): Promise<{ user: AuthUser }> {
        const body: ResetPasswordBody = { username: username.trim(), code: code.trim(), newPassword }
        const r = await get<AuthResponse>('/api/auth/reset', { method: 'POST', body, cache: 'no-store', anonymous: true })
        setSession({ token: r.token, username: r.user.username, expiresAt: r.expiresAt })
        return { user: r.user }
      },

      /** 註冊設定（不需要登入）：inviteRequired 為 true 時註冊要填邀請碼。每次打開註冊畫面時呼叫即可，不用快取 */
      async config(): Promise<AuthConfig> {
        return get<AuthConfig>('/api/auth/config', { cache: 'no-store', anonymous: true })
      },

      /** 向後端確認登入還有效（例如 App 啟動時）。失效會丟 KupeiError 401 並自動清掉 session；沒登入回 null */
      async me(): Promise<AuthUser | null> {
        if (!liveSession()) return null
        return (await get<{ user: AuthUser }>('/api/auth/me', { cache: 'no-store' })).user
      },
    },

    // ── 新聞與報告（2026-10-27）：唯讀、寫入、登入權杖都能讀；產生請求只限登入 ──

    /**
     * 新聞（後端代抓 Google 新聞，只有標題、來源、時間、原文連結）。q 1～5 個關鍵字（之間 OR）、exclude 0～5 個排除字（只比對標題），
     * 每個 1～50 字、不能含逗號；days 1、3、5（省略＝3）。不合法 400 BAD_REQUEST；來源抓不到且沒有舊結果 502 UPSTREAM_ERROR。
     * 回應 stale 為 true＝來源暫時抓不到、這是較舊的結果。瀏覽器快取 5 分鐘（伺服器同一查詢 30 分鐘只抓一次）
     */
    news(query: NewsQuery): Promise<NewsResponse> {
      const params = new URLSearchParams({ q: query.q.map((x) => x.trim()).join(',') })
      if (query.exclude?.length) params.set('exclude', query.exclude.map((x) => x.trim()).join(','))
      if (query.days !== undefined) params.set('days', String(query.days))
      return get<NewsResponse>(`/api/news?${params}`)
    },

    /** 新聞來源清單（目前只有 Google 新聞） */
    newsSources: async () => (await get<{ sources: NewsSource[] }>('/api/news/sources')).sources,

    /** 一家公司的報告（不含 summary）：period 新→舊、同期 rev 新→舊。所有狀態（DRAFT／PUBLISHED／FAILED）都會列出 */
    reports: async (code: string) => (await get<{ reports: ReportMeta[] }>(`/api/reports/${encodeURIComponent(code)}`, { cache: 'no-store' })).reports,

    /** 單一份報告（含 summary）。沒有這份丟 KupeiError 404 NOT_FOUND */
    report: (code: string, period: string, rev: number) =>
      get<Report>(`/api/reports/${encodeURIComponent(code)}/${encodeURIComponent(period)}/${rev}`, { cache: 'no-store' }),

    /**
     * 送出「產生報告」請求（要登入；沒登入丟 401 UNAUTHENTICATED、不打網路）。同一期已在排隊就回那一筆。
     * 每個帳號最多 20 筆排隊中，超過 403 QUOTA_EXCEEDED（details: { queued, maxQueued }）。報告由外部管線產生，完成時間不固定
     */
    async requestReport(code: string, period: string): Promise<ReportRequestCreated> {
      const s = liveSession()
      if (!s) throw new KupeiError(401, 'UNAUTHENTICATED', '還沒登入', null)
      return get<ReportRequestCreated>(`/api/reports/${encodeURIComponent(code)}/requests`, {
        method: 'POST',
        body: { period, trigger: 'MANUAL' },
        cache: 'no-store',
        token: s.token,
      })
    },

    /** 自己在這家公司的產生請求（新→舊；要登入，沒登入丟 401、不打網路）。不要輪詢，回到頁面或手動重新整理時再查 */
    async reportRequests(code: string): Promise<ReportRequest[]> {
      const s = liveSession()
      if (!s) throw new KupeiError(401, 'UNAUTHENTICATED', '還沒登入', null)
      return (await get<{ requests: ReportRequest[] }>(`/api/reports/${encodeURIComponent(code)}/requests`, { cache: 'no-store', token: s.token })).requests
    },

    // ── 報告參考檔（2026-10-28）：只限登入；只看得到、下載、刪除自己上傳的 ──
    reportInputs: {
      /** 自己在這家公司上傳的參考檔（新→舊，不含已刪除） */
      async list(code: string): Promise<ReportInput[]> {
        const s = requireSession()
        return (await get<{ inputs: ReportInput[] }>(inputsPath(code), { cache: 'no-store', token: s.token })).inputs
      },

      /**
       * 上傳一個檔（<input type="file"> 的 File，或 Blob＋檔名）。允許 pdf、txt、md、csv、xlsx、png、jpg／jpeg，≤ 20 MiB；
       * 副檔名、內容（檔頭；文字檔要 UTF-8）不對 415 UNSUPPORTED_TYPE、太大 413 TOO_LARGE、每人超過 50 個或 200 MiB 413 QUOTA_EXCEEDED。
       * 在瀏覽器算 SHA-256 帶在 X-Content-SHA256（伺服器交給 R2 驗證，傳壞了 400 CHECKSUM_MISMATCH，重傳即可）。
       * 上傳不是 GET，被限流（429）不會自動重試。
       */
      async upload(code: string, file: Blob, name?: string): Promise<ReportInput> {
        const s = requireSession()
        const fileName = name ?? (file as Blob & { name?: string }).name
        if (!fileName) throw new KupeiError(400, 'BAD_REQUEST', '缺少檔名', null)
        const mime = inputMimeOf(fileName)
        if (!mime) throw new KupeiError(415, 'UNSUPPORTED_TYPE', '只接受 pdf、txt、md、csv、xlsx、png、jpg、jpeg', null)
        if (file.size > MAX_INPUT_BYTES) throw new KupeiError(413, 'TOO_LARGE', '單檔上限 20 MiB', null)
        const bytes = await file.arrayBuffer()
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
        const sha256 = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
        return get<ReportInput>(`${inputsPath(code)}?name=${encodeURIComponent(fileName)}`, {
          method: 'POST',
          raw: bytes,
          headers: { 'Content-Type': mime, 'X-Content-SHA256': sha256 },
          cache: 'no-store',
          token: s.token,
        })
      },

      /** 下載（回 Blob；要存檔就用 URL.createObjectURL 搭配 <a download>）。不是自己的或不存在 404 */
      async download(code: string, id: string): Promise<Blob> {
        const s = requireSession()
        return get<Blob>(`${inputsPath(code)}/${encodeURIComponent(id)}`, { cache: 'no-store', token: s.token, blob: true })
      },

      /** 刪除（R2 物件立即刪掉，無法復原）。已被報告引用 409 INPUT_LOCKED；不是自己的或不存在 404 */
      async remove(code: string, id: string): Promise<{ status: 'ok' }> {
        const s = requireSession()
        return get<{ status: 'ok' }>(`${inputsPath(code)}/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store', token: s.token })
      },
    },

    store: {
      /** 所有文件的 key、版本、大小（不含內容） */
      list: async () => (await get<{ docs: DocMeta[] }>('/api/store', { cache: 'no-store' })).docs,

      /** 沒有這份文件時 version 0、data null */
      get: <T>(key: string) => get<Doc<T>>(`/api/store/${key}`, { cache: 'no-store' }),

      /**
       * 整包寫入。baseVersion 要等於目前雲端版本（第一次是 0）；不符會丟 KupeiError 409，
       * err.details 是雲端最新的 Doc<T>，請載入它後再讓使用者重做。一般情況用 update() 比較省事。
       */
      put: <T>(key: string, data: T, baseVersion: number) =>
        get<{ key: string; version: number; updatedAt: string }>(`/api/store/${key}`, { method: 'PUT', body: { baseVersion, data }, cache: 'no-store' }),

      /** 刪除；版本不符 409、不存在 404 */
      remove: (key: string, baseVersion: number) => get<{ ok: true }>(`/api/store/${key}?baseVersion=${baseVersion}`, { method: 'DELETE', cache: 'no-store' }),

      /**
       * 讀→改→寫，撞到別台裝置剛寫入時自動用最新內容重做（最多 retries 次）。
       * fn 拿到雲端目前的內容（可能 null），回傳要存的新內容；fn 必須是純函式（可能被叫多次）。
       */
      async update<T>(key: string, fn: (current: T | null) => T, retries = 3): Promise<Doc<T>> {
        let doc = await client.store.get<T>(key)
        for (let i = 0; ; i++) {
          const next = fn(doc.data)
          try {
            const r = await client.store.put(key, next, doc.version)
            return { key, version: r.version, updatedAt: r.updatedAt, data: next }
          } catch (e) {
            if (!(e instanceof KupeiError) || e.status !== 409 || i >= retries) throw e
            doc = e.details as Doc<T>
          }
        }
      },
    },
  }
  return client
}

export type KupeiClient = ReturnType<typeof createKupeiClient>
