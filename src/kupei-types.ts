// KuPei 唯讀 API 的資料型別。與線上批次格式一致（2026-10-23）；欄位只增不減。
// 來源說明見 KuPei-API.md 附錄 A。

export interface Manifest {
  run: string
  published_at: string
  source_file: string
  /** 有明細樹的公司代號 */
  details: string[]
  hashes: Record<string, string>
  status_notes: { translations: string; spec_current: string; sources: string[] }
}

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
  rows: RawRow[]
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
