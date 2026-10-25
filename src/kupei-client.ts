// KuPei 唯讀 API 客戶端。不依賴任何框架（Vue／React／原生都能用）。
// 載入策略（實測後設計；數字見 KuPei-API.md「快取與載入」）：
//   1. 批次檔網址帶 ?v=<manifest.hashes>，伺服器回 immutable 一年 → 第二次打開完全不碰網路。
//   2. 第一次打開：manifest（1 KB，no-cache）→ summary＋tr＋vparams＋nodes 並行。
//      之後打開：先用上次記住的批次直接從快取還原畫面，同時在背景核對 manifest；換批次才重載並通知。
//   3. 行情與評分資料彼此獨立，preload() 同時起跑，不要一個等一個。
//   4. /api 有每分鐘 30 次限流：latest 在記憶體留 60 秒並共用進行中的請求；history 同一個 tick 的呼叫合併成一次。
//   5. 429 依 Retry-After 自動重試一次（只限 GET）；每個請求 20 秒逾時。
//   6. 雲端文件（store）：整包 JSON＋版本號；update() 讀改寫並自動處理 409。寫入權杖由使用者在 App 輸入。
//
// 用法：
//   const kupei = createKupeiClient({ baseUrl: import.meta.env.VITE_KUPEI_BASE, token: import.meta.env.VITE_KUPEI_TOKEN })
//   kupei.preload()                                      // app 一啟動就呼叫，評分與行情同時開跑
//   const ds = await kupei.loadDataset({ onUpdate })     // 可能先回快取的舊批次，換批次時 onUpdate 會再給新的
//   const latest = await kupei.marketLatest()
//   const q = quoteOf(latest, '2330')
//   kupei.setWriteToken(userInput)                       // 設定畫面輸入一次
//   await kupei.store.update('watchlist', (cur) => ({ ...(cur ?? {}), groups }))   // 跨裝置同步
import type {
  ApiErrorBody,
  Company,
  Doc,
  DocMeta,
  Head,
  History,
  LatestResponse,
  Major,
  Manifest,
  MarketStatus,
  Quote,
  RawRow,
  RawSummary,
  Translations,
  TreeNode,
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
  /** 記住上次批次與寫入權杖用；預設 localStorage，傳 null 關閉 */
  storage?: (Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>) | null
  /** 單一請求逾時（毫秒），預設 20000 */
  timeoutMs?: number
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
  /** 權杖沒帶或不對 → 請使用者檢查 .env.local */
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
const LATEST_TTL_MS = 60_000
const HISTORY_BATCH = 30

type BatchName = 'summary' | 'tr' | 'vparams' | 'nodes'

/** manifest 裡有雜湊的用雜湊，沒有的（details）用發布時間；網址一變，瀏覽器就當成新檔案 */
function versionOf(m: Manifest, name?: BatchName): string {
  return encodeURIComponent((name && m.hashes[name]) || m.published_at)
}

function sameBatch(a: Manifest, b: Manifest): boolean {
  return a.run === b.run && a.published_at === b.published_at && JSON.stringify(a.hashes) === JSON.stringify(b.hashes)
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
  const bearer = () => `Bearer ${writeToken || cfg.token}`

  interface GetOpts {
    method?: 'GET' | 'PUT' | 'DELETE'
    body?: unknown
    cache?: RequestCache
    signal?: AbortSignal
    /** 瀏覽器支援時降低優先序（預先載入用） */
    low?: boolean
    retried?: boolean
  }

  async function get<T>(path: string, opts: GetOpts = {}): Promise<T> {
    const signals = [AbortSignal.timeout(timeoutMs), ...(opts.signal ? [opts.signal] : [])]
    const signal = typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0]
    const init: RequestInit & { priority?: 'low' | 'auto' } = {
      method: opts.method ?? 'GET',
      headers: { Authorization: bearer(), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      cache: opts.cache ?? 'default',
      signal,
    }
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body)
    if (opts.low) init.priority = 'low'
    const res = await doFetch(base + path, init)
    if (res.ok) return (await res.json()) as T
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      /* /data/* 的 401、404 是純文字 */
    }
    const ra = res.headers.get('Retry-After')
    const err = new KupeiError(
      res.status,
      body?.error.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : res.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR'),
      body?.error.message ?? `${path}：HTTP ${res.status}`,
      ra ? Number(ra) : null,
      body?.error.details,
    )
    // 被限流：依伺服器要求等待後重試一次（只限 GET；寫入重送可能撞版本，交給呼叫端）；再失敗就丟出去讓畫面處理
    if (err.rateLimited && !opts.retried && (opts.method ?? 'GET') === 'GET') {
      await new Promise((r) => setTimeout(r, Math.min(err.retryAfter ?? 30, 60) * 1000))
      return get<T>(path, { ...opts, retried: true })
    }
    throw err
  }

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
  const histories = new Map<string, History>()

  // ── 行情：共用進行中的請求＋ 60 秒記憶體快取（和伺服器的快取時間一致） ──
  let latestCache: { at: number; value: LatestResponse } | null = null
  let latestInFlight: Promise<LatestResponse> | null = null

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

    /** 行情資料範圍與最近抓取結果（資料新不新用） */
    marketStatus: () => get<MarketStatus>('/api/market/status', { cache: 'no-store' }),

    // ── 雲端文件：前端改的任何資料整包存雲端，跨裝置同步。需要寫入權杖 ──

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
