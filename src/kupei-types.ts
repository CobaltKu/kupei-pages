// KuPei 唯讀 API 的資料型別。與線上批次格式一致（2026-10-23；10-27 加可選批次檔 help／valuation／node_info）；欄位只增不減。
// 來源說明見 KuPei-API.md 附錄 A。

export interface Manifest {
  run: string
  published_at: string
  source_file: string
  /** 有明細樹的公司代號 */
  details: string[]
  hashes: ManifestHashes
  status_notes: { translations: string; spec_current: string; sources: string[] }
}

/**
 * 批次檔的內容雜湊（網址帶 ?v=<雜湊>）。summary、vparams、tr、nodes 四個鍵永遠在；
 * help、valuation、node_info 是可選鍵：該批次有交付對應檔案才有，沒有這個鍵就代表檔案不存在（不要請求，會 404）。
 * 之後可能再加鍵。
 */
export interface ManifestHashes {
  summary: string
  vparams: string
  tr: string
  nodes: string
  help?: string
  valuation?: string
  node_info?: string
  [key: string]: string | undefined
}

// ── 可選批次檔（/data/<run>/help.json、valuation.json、node_info.json） ──
// 這三個檔的內部形狀由評分批次交付方決定，後端原樣發布、不計算也不檢查，所以這裡刻意不寫死欄位。
// 用之前自己檢查形狀（缺欄位、型別不對都要能退回「沒有資料」的畫面）。

/** help.json：說明頁定義，任意 JSON */
export type HelpDoc = unknown

/** valuation.json：估價，JSON 物件（例如依公司代號或依欄位分組，以交付方說明為準） */
export type Valuation = Record<string, unknown>

/** node_info.json：節點 id → 完整定義物件（交付的 nodes 是物件形時才有；英文名仍在 nodes.json） */
export type NodeInfo = Record<string, Record<string, unknown>>

export interface Head {
  requested_period: string
  annual_period: string
  spec_version: string
  as_of: string
  source_run: string
  /** 各大項的排名母體人數（排除金融保險業），順序同 majors */
  rank_population: number[]
  counts: { records: number; ranked: number; NR: number; veto: number; fin_review: number }
  gate_overlay: { execution_mode: string; production_enabled: boolean; source: string; policy: string }
}

export interface Major {
  id: string
  en: string
  zh: string
  goal: string
}

export type ScoreStatus =
  | 'TRIAL_SCORE'
  | 'POLICY_SCORE'
  | 'UNAVAILABLE'
  | 'NOT_APPLICABLE'
  | 'OUT_OF_SCOPE_FINANCIAL'
  | 'CONFIGURATION_PENDING'
  | 'NOT_ENABLED'
  | 'SCOPE_UNVERIFIED'
  | 'NOT_ANNUAL_PERIOD'
  | 'DIAGNOSTIC'
  | 'ADJUSTMENT'
  | 'ADJUSTMENT_NOT_EVALUATED'
  | 'MISSING_ROW'
  | (string & {})

/** [分數, 標記字, 大項名次, 是否政策分, 是否含政策分成分, 狀態, 下層觸發數, own] */
export type RawMajorCell = [number | null, string, number | null, 0 | 1, 0 | 1, ScoreStatus, number, number]

/** [代號, 名稱, 產業, 金融業, 總名次, 政策分大項數, 大項[12], 否決, 否決來源[], 財務複核, 複核來源[]] */
export type RawRow = [string, string, string, 0 | 1, number | null, number | null, RawMajorCell[], 0 | 1, string[], 0 | 1, string[]]

export interface RawSummary {
  head: Head
  majors: Major[]
  /** 每列固定 11 欄、大項格固定 8 欄；批次不會在這裡加欄位（新資料放 company_meta 或其他頂層鍵） */
  rows: RawRow[]
  /** 批次可帶的公司層級額外資料（形狀由批次交付方決定，後端原樣保留）；沒交付就沒有這個鍵 */
  company_meta?: unknown
  /** 批次可能帶其他頂層鍵，後端原樣保留 */
  [key: string]: unknown
}

/** 解碼後的大項格 */
export interface MajorCell {
  /** 分數；只有 st 是 TRIAL_SCORE／POLICY_SCORE 且 s 非 null 才算有分數 */
  s: number | null
  /** 大項名次 */
  mr: number | null
  /** 是否政策分 */
  pol: boolean
  /** 是否含政策分成分 */
  cpol: boolean
  st: ScoreStatus
  /** 下層觸發數 */
  below: number
}

/** 解碼後的公司 */
export interface Company {
  id: string
  name: string
  /** 產業 */
  ind: string
  /** 金融保險業（不列入排名母體） */
  fin: boolean
  /** 總名次；null ＝ NR（不排名） */
  rank: number | null
  /** 政策分大項數 */
  pc: number | null
  /** 12 個大項，順序同 majors */
  maj: MajorCell[]
  /** 資格否決 */
  veto: boolean
  /** 否決來源（節點 id，名稱查 nodes） */
  vetoFrom: string[]
  /** 財務複核 */
  finrev: boolean
  finSrc: string[]
}

/** Gate 規則列 */
export type GateNote = [string, string, string, string, string, string, string, number, string, string]

/** 明細樹節點（details/<代號>.json 是 TreeNode[]，第一層為 12 個大項，最多三層） */
export interface TreeNode {
  id: string
  en: string
  zh: string
  /** 在上層的權重 */
  w: number | null
  /** 期別 */
  p: string
  s: number | null
  st: ScoreStatus
  /** 原因碼，中文對照查 tr */
  r: string[]
  src: GateNote[]
  below: number
  rd: GateNote[]
  c: TreeNode[]
  /** 只有第一層有：大項名次 */
  mr?: number | null
  /**
   * 批次可帶的額外欄位（例如 goal、definition、peer_rank），後端原樣保留；形狀由批次交付方決定，
   * 沒交付就沒有這些鍵。用之前自己檢查型別
   */
  [key: string]: unknown
}

/** [參數, 用途, 定義, 狀態, 對應項, 備註, 類別, 值, 單位, 其他] */
export type ValuationParam = [string, string, string, string, string, string, string, string, string, string]

export type Translations = Record<string, string | null>

// ── 行情 ──

export type Market = 'L' | 'O'

export interface LatestResponse {
  /** 各市場最新交易日；沒有資料的市場不會出現 */
  dates: Partial<Record<Market, string>>
  /** 代號 → [收盤(null＝當日無成交), 漲跌價差, 成交股數] */
  quotes: Record<string, [number | null, number | null, number | null]>
}

// ── 盤中行情（K-48）──
/** 盤中報價：[成交價(null＝今天還沒有成交), 漲跌（相對昨收）, 累計成交量（股）, 資料時間 "HH:MM:SS"] */
export type IntradayQuote = [number | null, number | null, number | null, string | null]

/** 一個市場的快照資訊；還沒有快照是 null */
export interface IntradayMarketInfo {
  /** 來源資料時間，ISO 8601 台灣時間（+08:00），例如 2026-10-27T10:25:00+08:00 */
  at: string
  /** 後端收到的時間（UTC ISO 8601） */
  receivedAt: string
  /** 來源，例如 twse-mis */
  source: string
}

/** GET /api/market/intraday：外部排程盤中每 10 分鐘推一次的快照（不是即時串流） */
export interface IntradayResponse {
  /** 台灣時間：平日 09:00 前 PRE、09:00～13:30 OPEN、其餘（含週末）CLOSED。國定休市日不知道，看 stale */
  phase: 'PRE' | 'OPEN' | 'CLOSED'
  /** true＝不是今天夠新的資料（任一市場沒有快照、日期不是今天，或開盤中超過 20 分鐘沒更新）→ 顯示收盤價或標示延遲 */
  stale: boolean
  /** 推送頻率（秒），目前 300 */
  ttlSeconds: number
  markets: { L: IntradayMarketInfo | null; O: IntradayMarketInfo | null }
  /** 代號 → 報價（上市、上櫃合併）；沒有快照時是 {} */
  quotes: Record<string, IntradayQuote>
}

export interface Quote {
  close: number | null
  change: number | null
  /** 漲跌幅 %；沒有前一日收盤時 null */
  pct: number | null
  volume: number | null
}

export interface History {
  /** [日期, 收盤, 成交股數]，最多 20 筆，舊→新 */
  quotes: [string, number | null, number | null][]
  /** [年月, 營收（千元）, 年增率 %]，最多 5 筆，舊→新 */
  revenue: [string, number | null, number | null][]
}

export interface MarketStatus {
  counts: {
    quoteDays: number
    firstDay: string | null
    lastDay: string | null
    revenueMonths: number
    firstMonth: string | null
    lastMonth: string | null
  }
  runs: { job: string; key: string; status: string; rows: number; message: string | null; at: string }[]
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

// ── 雲端文件（需寫入權杖） ──

export interface DocMeta {
  key: string
  version: number
  updatedAt: string | null
  bytes: number
}

/** 沒有這份文件時 version 0、data null；第一次寫入帶 baseVersion 0 */
export interface Doc<T = unknown> {
  key: string
  version: number
  updatedAt: string | null
  data: T | null
}

// ── 使用者帳號（/api/auth/*） ──

export interface AuthUser {
  id: number
  username: string
}

/** register／login 的回應。token 只在這裡出現一次，客戶端存在 storage（key kupei:session） */
export interface AuthResponse {
  user: AuthUser
  /** kps_ 開頭的登入權杖，有效 30 天 */
  token: string
  /** ISO 8601（UTC） */
  expiresAt: string
}

/** GET /api/auth/config：註冊要不要邀請碼（不回傳邀請碼本身）。打開時註冊畫面要多一個「邀請碼」欄位 */
export interface AuthConfig {
  inviteRequired: boolean
}

/** POST /api/auth/password 的本文。成功回 AuthResponse（新的登入權杖；這個帳號所有舊權杖都失效） */
export interface ChangePasswordBody {
  currentPassword: string
  /** 8～128 字 */
  newPassword: string
}

/** 客戶端存在 storage 的登入狀態（key kupei:session） */
export interface StoredSession {
  token: string
  username: string
  expiresAt: string
}

/** getSession() 的回傳：不含權杖 */
export interface SessionInfo {
  username: string
  expiresAt: string
}

// ── 新聞與報告（/api/news、/api/reports/*；2026-10-27） ──

/** GET /api/news 的一則。url 一定是 https（Google 新聞的轉址連結，打開會到原文）；title 已去掉結尾的「 - 來源」 */
export interface NewsItem {
  title: string
  url: string
  source: string
  /** ISO 8601（UTC） */
  publishedAt: string
}

/** GET /api/news。items 新→舊、最多 50 則。stale 為 true＝來源暫時抓不到，這是較舊的結果 */
export interface NewsResponse {
  items: NewsItem[]
  fetchedAt: string
  source: 'google-news-rss'
  stale?: true
}

/** kupei.news() 的參數。每個字 1～50 字、不能含逗號；q 1～5 個（之間是 OR）、exclude 0～5 個（只比對標題） */
export interface NewsQuery {
  q: string[]
  exclude?: string[]
  /** 省略＝3 */
  days?: 1 | 3 | 5
}

/** GET /api/news/sources */
export interface NewsSource {
  id: string
  name: string
  url: string
}

export type ReportStatus = 'DRAFT' | 'PUBLISHED' | 'FAILED'

/** 報告附的檔案：外部 https 連結（後端不存檔案） */
export interface ReportFile {
  name: string
  url: string
}

/** GET /api/reports/<code> 列表的一筆（不含 summary） */
export interface ReportMeta {
  /** 例如 2026Q2 */
  period: string
  /** 版次，正整數 */
  rev: number
  status: ReportStatus
  title: string
  /** ISO 8601（UTC） */
  generatedAt: string
  /** https 或 null */
  url: string | null
  files: ReportFile[]
}

/** GET /api/reports/<code>/<period>/<rev>：多了 summary（純文字或 markdown，可能 null） */
export interface Report extends ReportMeta {
  summary: string | null
}

export type ReportRequestStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'

/** POST /api/reports/<code>/requests 的回應（202 新排隊；200 同一期已在排隊，回那一筆） */
export interface ReportRequestCreated {
  id: number
  status: 'QUEUED'
  createdAt: string
}

/** GET /api/reports/<code>/requests 的一筆（只有自己的） */
export interface ReportRequest {
  id: number
  period: string
  trigger: 'MANUAL'
  status: ReportRequestStatus
  createdAt: string
  updatedAt: string
  /** 管線留的說明，可能 null */
  message: string | null
}
