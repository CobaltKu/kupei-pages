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
  /** 各市場最新交易日的資料來源（選填，K-30）：finmind＝FinMind、exchange＝證交所／櫃買。有 finmind 時頁面要標「資料來源：FinMind」 */
  source?: Partial<Record<Market, 'finmind' | 'exchange'>>
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

// ── FinMind 盤中 30 秒（K-54，2026-10-28）──
/** 即時報價：[成交價(null＝今天還沒有成交), 漲跌, 累計成交量（單位照 FinMind）, 資料時間 "HH:MM:SS"（台灣時間）] */
export type LiveQuote = [number | null, number | null, number | null, string]

/**
 * GET /api/market/live：後端盤中每 30 秒抓一次 FinMind 全市場即時快照。**只限登入帳號**（FinMind 條款：即時資料不得對外公開）；
 * 頁面要標「資料來源：FinMind」。抓不到（503 LIVE_UNAVAILABLE）或 stale 為 true 時改用 marketIntraday()（證交所 MIS）。
 */
export interface LiveQuotes {
  source: 'finmind'
  /** 同 IntradayResponse.phase；交易日曆確定今天休市時是 CLOSED */
  phase: 'PRE' | 'OPEN' | 'CLOSED'
  /** 資料時間（各檔最新的那一筆），ISO 8601 台灣時間 +08:00 */
  at: string
  /** 後端抓到這份的時間（UTC ISO 8601） */
  fetchedAt: string
  /** true＝OPEN 時超過 120 秒沒更新，或資料日期不是今天 → 改用 marketIntraday() 或標示資料時間 */
  stale: boolean
  /** 後端抓取間隔（秒），目前 30；前端輪詢不要比這個快 */
  intervalSeconds: number
  /**
   * true＝phase 是 CLOSED 且這份快照是今天（台灣）的＝今天的 FinMind 收盤快照（13:30 收盤後、13:36 再抓一次收盤快照）。
   * 每日收盤（marketLatest）還沒更新到今天時，用這份顯示今天的收盤價，並標「FinMind 收盤快照／正式收盤待更新」（MARKET-05，2026-10-30）。
   * OPEN、PRE 時一律 false
   */
  closing: boolean
  /**
   * 各市場的每日收盤（/api/market/latest 那份）日期是否已經＝這份快照的日期（L 上市、O 上櫃）。
   * closing 為 true 時：該市場 true → 改用 marketLatest() 的正式收盤；false → 繼續用這份快照。
   * 後端最多晚 60 秒反映（快取）；marketLatest() 本身瀏覽器也會留 60 秒
   */
  officialClose: { L: boolean; O: boolean }
  /**
   * 選填：每檔屬於上市（L）還是上櫃（O）的代號清單（已排序），**只在 closing 為 true 時才有**。
   * 用來處理「上市正式收盤已進來、上櫃還沒」的混合狀態：L 清單的代號看 officialClose.L、O 清單的看 officialClose.O。
   * 來源是後端 D1 各市場最新一個交易日的收盤代號（不是 FinMind 即時資料），當天新上市櫃的代號可能兩邊都沒有；
   * 也可能列出這份快照沒有的代號。沒有這個欄位時不要猜，當成兩個市場都還沒更新
   */
  markets?: { L: string[]; O: string[] }
  quotes: Record<string, LiveQuote>
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
  /** 各市場最新交易日的收盤資料來源（選填，K-30），同 LatestResponse.source */
  source?: Partial<Record<Market, 'finmind' | 'exchange'>>
  /** FinMind 盤中 30 秒的監控（K-54，選填；不含資料）。enabled 為 false 時其他欄位不存在 */
  live?: LiveStatus
}

/** /api/market/status 的 live（K-54）：給維運看抓取是否正常 */
export interface LiveStatus {
  enabled: boolean
  lastSuccessAt?: string | null
  lastAttemptAt?: string | null
  consecutiveFailures?: number
  /** todayOk／todayFail 是哪一天（台灣日期） */
  day?: string | null
  todayOk?: number
  todayFail?: number
  lastError?: string | null
  lastErrorAt?: string | null
  /** 最近一次處理耗時（毫秒，牆上時間，含等 FinMind；不是 CPU time） */
  lastDurationMs?: number | null
  lastCount?: number | null
  nextAlarmAt?: string | null
  snapshotAt?: string | null
  snapshotCount?: number | null
  /** DO 讀不到時才有 */
  error?: string
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

/** GET /api/auth/config：有沒有開放註冊、註冊要不要邀請碼（不回傳邀請碼本身） */
export interface AuthConfig {
  /** false（2026-10-28 起預設，K-53）＝註冊關閉、帳號由維護者發，不要顯示註冊入口；true 才能 register */
  registrationOpen: boolean
  /** true＝註冊畫面要多一個「邀請碼」欄位（只在 registrationOpen 為 true 時有意義） */
  inviteRequired: boolean
}

/** POST /api/auth/password 的本文。成功回 AuthResponse（新的登入權杖；這個帳號所有舊權杖都失效） */
export interface ChangePasswordBody {
  currentPassword: string
  /** 8～128 字 */
  newPassword: string
}

/**
 * POST /api/auth/reset 的本文（忘記密碼；不需要登入）。成功回 AuthResponse（新的登入權杖；這個帳號所有舊權杖都失效）。
 * 帳號或重設碼不對、過期、已用過、帳號停用一律 401 INVALID_CREDENTIALS；帳號或新密碼格式不對 400 BAD_REQUEST。
 */
export interface ResetPasswordBody {
  username: string
  /** 維護者給的一次性重設碼：12 字元，顯示成 XXXX-XXXX-XXXX；大小寫、- 與空白不影響。24 小時內有效、只能用一次 */
  code: string
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

/** kupei.news() 的舊版參數（沒帶 kind）。每個字 1～50 字、不能含逗號；q 1～5 個（之間是 OR）、exclude 0～5 個（只比對標題）。要精準篩選用 MatchedNewsQuery */
export interface NewsQuery {
  q: string[]
  exclude?: string[]
  /** 省略＝3 */
  days?: 1 | 3 | 5
}

/**
 * kupei.news() 的精準查詢（2026-10-30，NEWS-03／NEWS-04）：Google／Bing＋科技新報三來源合併、依原文網址去重。
 * - 產業 kind: 'industry'：q 2～5 個關鍵字，一則要在標題＋摘要命中**至少 2 個不同的字**。
 * - 個股 kind: 'stock'：要命中公司名稱（name）或代號（code）至少一個，**再**命中 topics 至少一個；名稱與代號不算主題詞。
 * 排除字只比對標題。關鍵字不夠（產業去重後 < 2、個股主題詞去掉名稱／代號後 < 1）→ 400 NOT_ENOUGH_KEYWORDS（不會退回單字 OR）。
 * 每個字 1～50 字、不能含逗號；days 省略＝3。
 */
export interface IndustryNewsQuery {
  kind: 'industry'
  q: string[]
  exclude?: string[]
  days?: 1 | 3 | 5
}
export interface StockNewsQuery {
  kind: 'stock'
  /** 4 碼代號 */
  code: string
  /** 公司名稱（建議帶；沒帶就只認代號） */
  name?: string
  topics: string[]
  exclude?: string[]
  days?: 1 | 3 | 5
}
export type MatchedNewsQuery = IndustryNewsQuery | StockNewsQuery

/** 精準查詢的一則。url 是原文網址（https、已去追蹤參數；Google 解不出原文時是 Google 的轉址連結） */
export interface MatchedNewsItem {
  title: string
  url: string
  /** 發布媒體（＝media，與舊版 source 同義） */
  source: string
  /** 發布媒體，例如「經濟日報」「科技新報」 */
  media: string
  /** 從哪個來源抓到：bing／google（新聞聚合）、technews（科技新報 RSS） */
  via: 'bing' | 'google' | 'technews'
  /** ISO 8601（UTC） */
  publishedAt: string
  /** 來源 RSS 的摘要（去 HTML、最多 200 字；可能是空字串）。不是全文 */
  summary: string
  /** 命中的關鍵字（全形英數轉半形、小寫）；個股先列公司名稱／代號，再列主題詞 */
  matchedKeywords: string[]
}

/** 精準查詢的回應。stale 同舊版；partial 為 true＝新聞聚合暫時抓不到，只有科技新報的結果 */
export interface MatchedNewsResponse {
  items: MatchedNewsItem[]
  fetchedAt: string
  source: 'news-aggregate'
  kind: 'industry' | 'stock'
  stale?: true
  partial?: true
}

/**
 * GET /api/news/sources：預設 3 個（後端會抓的 Google、Bing、科技新報）；?all=1（newsSources({ all: true })）14 個，含不擷取的媒體（2026-10-30）。accessMode：
 * aggregator_rss（Google／Bing，後端代抓）、official_rss（科技新報，後端代抓）、
 * pending_official_feed（等官方 feed，不擷取）、external_link（只列入口，不擷取）。via 只有後端會抓的三個才有。
 */
export interface NewsSource {
  id: string
  name: string
  url: string
  accessMode?: 'aggregator_rss' | 'official_rss' | 'pending_official_feed' | 'external_link'
  via?: 'bing' | 'google' | 'technews'
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

/** GET /api/reports/<code>/<period>/<rev>：多了 summary（純文字或 markdown，可能 null）與引用的參考檔 */
export interface Report extends ReportMeta {
  summary: string | null
  /** 報告引用的參考檔 metadata（2026-10-28 起；沒有引用是空陣列）。下載只限上傳者本人（kupei.reportInputs.download） */
  inputs: ReportInputRef[]
}

/** 報告引用的參考檔（不含上傳者） */
export interface ReportInputRef {
  id: string
  name: string
  mime: ReportInputMime
  bytes: number
  /** 64 位小寫 hex */
  sha256: string
  createdAt: string
}

/** 報告參考檔允許的類型（PDF、TXT、MD、CSV、XLSX、PNG、JPEG） */
export type ReportInputMime =
  | 'application/pdf'
  | 'text/plain'
  | 'text/markdown'
  | 'text/csv'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'image/png'
  | 'image/jpeg'

/** POST／GET /api/reports/<code>/inputs 的一筆（登入權杖只看得到自己上傳的） */
export interface ReportInput extends ReportInputRef {
  code: string
  /** 'u:<帳號 id>'（帳號上傳）或 'pipeline'（報告管線） */
  createdBy: string
  /**
   * 已被報告引用：不能刪（DELETE 回 409 INPUT_LOCKED），也不計入上傳者的配額（每人 50 個／200 MiB）。
   * 報告改版或刪除後不再被任何報告引用時後端自動改回 false；也可以手動 POST …/inputs/<id>/unlock（kupei.reportInputs.unlock）。
   */
  locked: boolean
}

/** POST /api/reports/<code>/inputs/<id>/unlock 被拒（409 INPUT_REFERENCED）時 error.details 的形狀：仍引用它的報告（period 新→舊、rev 新→舊，最多 20 筆） */
export interface ReportInputReferencedDetails {
  reports: { period: string; rev: number }[]
}

export type ReportRequestStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'

/**
 * 產生報告的設定（REPORT-01，2026-10-30）：requestReport／schedules.create 送出時帶，後端驗證後鎖成快照（之後改設定不影響已送出的請求）。
 * keywords 必填 2～10 個（每個 1～50 字，重複的去掉）；其餘省略時：includeNews、comparePrevious＝true，focusMajors、inputIds＝[]。
 * focusMajors：大項 id（summary.majors[].id，例如 K005）或代號（例如 DAR-L），≤ 12 個，後端只檢查格式。
 * inputIds：自己上傳到這家公司、未刪除的參考檔 id（kupei.reportInputs），≤ 20 個；不是的話 400 BAD_REQUEST（details: { missing }）。
 * 不認得的欄位 400（例如 include_news）。
 */
export interface ReportSettingsInput {
  keywords: string[]
  includeNews?: boolean
  focusMajors?: string[]
  comparePrevious?: boolean
  inputIds?: string[]
}

/** 後端存下的設定快照（預設值已補上） */
export interface ReportSettings {
  keywords: string[]
  includeNews: boolean
  focusMajors: string[]
  comparePrevious: boolean
  inputIds: string[]
}

/** MANUAL＝使用者按「產生報告」；SCHEDULED＝排程到期由後端建立（2026-10-30） */
export type ReportRequestTrigger = 'MANUAL' | 'SCHEDULED'

/** POST /api/reports/<code>/requests 的回應（202 新排隊；200 同一期、同樣設定已在排隊，回那一筆） */
export interface ReportRequestCreated {
  id: number
  status: 'QUEUED'
  createdAt: string
  /** 後端配發的報告版號（同 code＋period 遞增）；報告產生後就是 report(code, period, rev) 的 rev（2026-10-30 起） */
  rev: number | null
  /** 鎖定的設定快照；沒帶 settings 是 null */
  settings: ReportSettings | null
  /** 建立當下的正式批次 manifest.run；後端讀不到 manifest 時 null */
  run: string | null
}

/** GET /api/reports/<code>/requests 的一筆（只有自己的） */
export interface ReportRequest {
  id: number
  period: string
  trigger: ReportRequestTrigger
  status: ReportRequestStatus
  createdAt: string
  updatedAt: string
  /** 管線留的說明，可能 null */
  message: string | null
  /** 以下 2026-10-30 起（之前建立的請求都是 null） */
  rev: number | null
  settings: ReportSettings | null
  run: string | null
  /** 排程建立的（trigger SCHEDULED）＝哪個排程；否則 null */
  scheduleId: number | null
}

/** 排程頻率：once＝date＋time 一次；daily＝每天 time；weekly＝每週 weekday 的 time。時間都是台灣時間 */
export type ReportScheduleFrequency = 'once' | 'daily' | 'weekly'

/**
 * POST /api/reports/schedules 的本文（kupei.reportSchedules.create）。
 * period：固定期別（'2026Q2'）或規則（'CURRENT_QUARTER'／'PREVIOUS_QUARTER'，到期時依台灣日期換算）。
 * time 'HH:MM'；weekly 要 weekday（0＝週日 … 6＝週六）；once 要 date（'YYYY-MM-DD'，要在現在之後、366 天內）；其他頻率不能帶這兩個。
 */
export interface ReportScheduleInput {
  code: string
  period: string
  frequency: ReportScheduleFrequency
  time: string
  weekday?: number
  date?: string
  settings?: ReportSettingsInput
}

/** 排程（只看得到自己的；別人的一律 404） */
export interface ReportSchedule {
  id: number
  code: string
  period: string
  frequency: ReportScheduleFrequency
  time: string
  weekday: number | null
  date: string | null
  settings: ReportSettings | null
  /** 下一個到期時段（ISO UTC）；null＝不會再到期（once 已觸發）。實際建立請求是到期後的第一個後端排程時間（不是準點） */
  nextDueAt: string | null
  /** 最近一次到期的時段；還沒到期過是 null */
  lastDueAt: string | null
  /** 最近一次到期建立的請求 id；null＝還沒到期過，或那次沒建立（排隊中已滿 20 筆、同樣設定已在排隊、參考檔已刪除） */
  lastRequestId: number | null
  createdAt: string
}
