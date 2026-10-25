// KuPei 唯讀 API 客戶端。不依賴任何框架（Vue／React／原生都能用）。
// 做法照 KuPei-API.md：先讀 manifest 取得批次編號，批次檔讀一次留在記憶體；/api 有每分鐘 30 次限流。
//
// 用法：
//   const kupei = createKupeiClient({
//     baseUrl: import.meta.env.VITE_KUPEI_BASE,
//     token: import.meta.env.VITE_KUPEI_TOKEN,
//   })
//   const ds = await kupei.loadDataset()        // 全部公司、12 個大項、對照表
//   const latest = await kupei.marketLatest()   // 最新收盤
//   const q = quoteOf(latest, '2330')            // { close, change, pct, volume }
import type {
  ApiErrorBody,
  Company,
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
  /** 自訂 fetch（測試時替換） */
  fetch?: typeof fetch
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

export function createKupeiClient(cfg: KupeiConfig) {
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const doFetch = cfg.fetch ?? fetch
  if (!cfg.token) console.warn('[kupei] 沒有權杖：請在 .env.local 設定 VITE_KUPEI_TOKEN')

  async function get<T>(path: string, cache: RequestCache = 'default'): Promise<T> {
    const res = await doFetch(base + path, { headers: { Authorization: `Bearer ${cfg.token}` }, cache })
    if (res.ok) return (await res.json()) as T
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      /* /data/* 的 401、404 是純文字 */
    }
    const ra = res.headers.get('Retry-After')
    throw new KupeiError(
      res.status,
      body?.error.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : res.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR'),
      body?.error.message ?? `${path}：HTTP ${res.status}`,
      ra ? Number(ra) : null,
      body?.error.details,
    )
  }

  let dataset: Promise<Dataset> | null = null
  const details = new Map<string, Promise<TreeNode[]>>()
  const histories = new Map<string, History>()

  return {
    /** 不需權杖；確認服務在線 */
    health: () => get<{ ok: boolean }>('/api/health'),

    /**
     * 讀 manifest（每次 no-cache）→ 該批次的 summary、tr、vparams、nodes。
     * 只載一次；要換批次（manifest.run 變了）呼叫 reload()。
     */
    loadDataset(): Promise<Dataset> {
      if (!dataset) {
        dataset = (async () => {
          const manifest = await get<Manifest>('/data/manifest.json', 'no-cache')
          const run = manifest.run
          const [summary, tr, vparams, nodes] = await Promise.all([
            get<RawSummary>(`/data/${run}/summary.json`),
            get<Translations>(`/data/${run}/tr.json`),
            get<ValuationParam[]>(`/data/${run}/vparams.json`),
            get<Record<string, string>>(`/data/${run}/nodes.json`),
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
        })()
        dataset.catch(() => (dataset = null))
      }
      return dataset
    },

    reload() {
      dataset = null
      details.clear()
      return this.loadDataset()
    },

    /** 明細樹；沒有明細的公司回 null（看 manifest.details） */
    async loadDetail(code: string): Promise<TreeNode[] | null> {
      const ds = await this.loadDataset()
      if (!ds.manifest.details.includes(code)) return null
      let p = details.get(code)
      if (!p) {
        p = get<TreeNode[]>(`/data/${ds.manifest.run}/details/${code}.json`)
        p.catch(() => details.delete(code))
        details.set(code, p)
      }
      return p
    },

    /** 各市場最新收盤。伺服器端快取 60 秒，前端讀一次放著即可，不要輪詢 */
    marketLatest: () => get<LatestResponse>('/api/market/latest', 'no-store'),

    /** 近 20 個交易日與近 5 個月營收。自動分批（每次最多 30 檔）、已載過的不重抓 */
    async marketHistory(codes: string[]): Promise<Map<string, History>> {
      const need = [...new Set(codes)].filter((c) => /^\d{4}$/.test(c) && !histories.has(c))
      for (let i = 0; i < need.length; i += 30) {
        const batch = need.slice(i, i + 30)
        const d = await get<{ quotes: Record<string, History['quotes']>; revenue: Record<string, History['revenue']> }>(
          `/api/market/history?codes=${batch.join(',')}`,
          'no-store',
        )
        for (const c of batch) histories.set(c, { quotes: d.quotes[c] ?? [], revenue: d.revenue[c] ?? [] })
      }
      return new Map(codes.map((c) => [c, histories.get(c) ?? { quotes: [], revenue: [] }]))
    },

    /** 行情資料範圖與最近抓取結果（資料新不新用） */
    marketStatus: () => get<MarketStatus>('/api/market/status', 'no-store'),
  }
}

export type KupeiClient = ReturnType<typeof createKupeiClient>
