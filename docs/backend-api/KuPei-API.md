# KuPei 唯讀 API（給外部前端）

給串接 KuPei 評分資料與行情的前端開發者。機器可讀版本是同資料夾的 `openapi.json`；串接規則與範圍見《2026-10-23_KuPei前端串接規範.md》；部署流程見《KuPei-前端部署指南-GitHub-Pages.md》；可直接使用的客戶端程式在 `starter/`（`kupei-client.ts`、`kupei-types.ts`）（OpenAPI 3.0，可匯入 Postman、openapi-typescript 等工具）。

## 連線

| 項目 | 值 |
| --- | --- |
| Base URL | `https://kupei-dashboard.tmac19920626.workers.dev` |
| 驗證 | 標頭 `Authorization: Bearer <權杖>`（權杖由維護者另外給你，不要放進版控） |
| 權限 | **使用者帳號（2026-10-28 起前端唯一的方式，K-53）**：帳號由維護者發給你（註冊預設關閉），登入拿到登入權杖（`kps_…`），讀評分資料、行情、新聞、報告，加上雲端文件 `/api/store`（依帳號分開）。唯讀權杖：評分資料與行情——**即將停用**（見下方說明），前端不要再用。（以前：使用者在 App 自己註冊、登入，拿到登入權杖（`kps_…`），多了雲端文件 `/api/store` 的讀寫（依帳號分開），也能讀一切。**寫入權杖**（舊做法，站長本人用，繼續可用）：同樣能讀寫 `/api/store`，但所有拿這把權杖的人共用同一份文件 |
| CORS | 本機 `http://localhost:<任何埠>`、`http://127.0.0.1:<任何埠>` 可以直接從瀏覽器呼叫；正式站（GitHub Pages）要先把來源 `https://<帳號>.github.io` 告知維護者加入白名單（見《KuPei-前端部署指南-GitHub-Pages.md》） |
| 格式 | JSON，UTF-8。錯誤一律 `{ "error": { "code", "message", "details?" } }` |

```bash
BASE=https://kupei-dashboard.tmac19920626.workers.dev
curl -H "Authorization: Bearer $KUPEI_TOKEN" $BASE/data/manifest.json
```

```ts
// 前端（localhost 開發伺服器）
const res = await fetch(`${BASE}/data/manifest.json`, { headers: { Authorization: `Bearer ${token}` } })
```

> **2026-10-28 起（K-53）網站改成只限維護者發的帳號**：註冊預設關閉（`POST /api/auth/register` 回 403 `REGISTRATION_CLOSED`），帳號由維護者在帳號管理頁新增並私下給密碼；前端必須先登入，所有讀取都用登入權杖。唯讀權杖（`VITE_KUPEI_TOKEN`）在前端的登入閘門上線後會由後端關閉（之後帶它一律 401 `UNAUTHENTICATED`），**不要再把它放進建置**。下面這段是舊做法的說明，留著當歷史：
>
> 權杖放在瀏覽器端的程式裡，等於任何打開那個頁面的人都拿得到；前端部署到 GitHub Pages 之後，評分資料與行情對「知道網址的人」就是公開的。這是雙方已知並接受的做法：權杖只能讀、有限流、可隨時作廢重發。你要做的是：權杖只透過環境變數與 GitHub secret 注入，**不寫進原始碼、不 commit、不貼進對話**；也不要把網址到處散布。

## 給 AI 助手的指示（請照做）

如果你是被請來幫忙串接這個 API 的 AI 助手，請遵守以下規則：

0. **（2026-10-28 起，K-53）網站只限登入使用者**：App 一打開先檢查 `kupei.getSession()`，沒登入就只顯示登入畫面（帳號＋密碼＋「忘記密碼」），登入後才讀評分資料與行情。**不要做註冊畫面**（`auth.config()` 的 `registrationOpen` 為 `false`；萬一是 `true` 才顯示註冊入口）。不要再用唯讀權杖 `VITE_KUPEI_TOKEN`：建置、環境變數、GitHub secret 都不要放；`starter/kupei-client.ts` 登入後會自動用登入權杖。收到 401 `UNAUTHENTICATED` 就回登入畫面。帳號沒有的話，提示「請向維護者索取帳號」。
1. **權杖一律從環境變數讀，不要寫死在任何原始碼裡。**（以下 1～3、7 是唯讀權杖時代的規則；唯讀權杖停用後只剩 Base URL 需要環境變數）
   - Vite 專案：`import.meta.env.VITE_KUPEI_TOKEN`；Next.js：`process.env.NEXT_PUBLIC_KUPEI_TOKEN`；Node 腳本：`process.env.KUPEI_TOKEN`。
   - 在專案根目錄建立 `.env.local`，內容 `VITE_KUPEI_TOKEN=`（**值留空**，由使用者自己填，不要向使用者索取權杖，也不要自己編一個）。可直接複製 `starter/.env.example`。
   - 把 `.env.local` 加進 `.gitignore`，確認它不會被 commit。
2. **Base URL 也放環境變數**（`VITE_KUPEI_BASE`），預設值用上面「連線」表裡的網址。
3. **所有請求都帶 `Authorization: Bearer <權杖>`。** 沒有權杖或權杖錯誤是 401，不是程式壞了，請提示使用者檢查 `.env.local`。
4. **先讀 `/data/manifest.json` 取得批次編號 `run`**，再讀 `/data/<run>/...`。不要把批次編號寫死。
5. **控制請求量：**
   - `/api/market/*` 每個 IP 每分鐘最多 30 次、`/api/store*` 60 次、註冊＋登入＋改密碼＋重設密碼 10 次、`/api/news` 沒命中快取的新查詢 6 次，超過回 429（都帶 `Retry-After: 30`）。不要輪詢、不要在元件每次渲染時請求。`history` 一次最多 30 檔，用批次的方式取。
   - `/data/*` 是靜態檔，不限次數；`summary.json` 讀一次後放在記憶體，不要每個畫面重抓。
6. **遇到錯誤時：**
   - 429：等 `Retry-After` 秒數後再試，不要立刻重送。
   - 403 `FORBIDDEN`：這個權杖不能用這個路徑（唯讀權杖打 `/api/store`、任何權杖打站長的 `/api/watchlist` 等），不要想辦法繞過。403 `QUOTA_EXCEEDED`：雲端文件額度滿了，提示使用者，不要自動重試。
   - 瀏覽器出現 CORS 錯誤：本機要是 `http://localhost:<埠>` 或 `http://127.0.0.1:<埠>`；GitHub Pages 要先把 `https://<帳號>.github.io` 給維護者加白名單。不要改用 `no-cors` 之類的方式硬解。
7. **正式部署只到雙方約定的 GitHub Pages**（流程見《KuPei-前端部署指南-GitHub-Pages.md》），權杖用 GitHub Actions secret `VITE_KUPEI_TOKEN` 在建置時注入；不要把權杖貼進 issue、commit 訊息或對話。
8. 目前沒有即時串流：盤中價只有定時快照（`/api/market/intraday`，`stale` 為 `true` 時不要當成即時價），新聞與報告見第 12 條；不要為沒有的資料做空欄位或假資料。**估價**（`valuation.json`）、**說明頁**（`help.json`）、**節點完整定義**（`node_info.json`）是批次的可選檔：只在 `kupei.loadValuation()`／`loadHelp()`／`loadNodeInfo()` 回傳不是 `null` 時顯示，`null` 就是這個批次沒有，不要補空欄位或假資料，也不要自己去猜網址請求。
9. **寫入一律走 `kupei.store`**（自選、個股問題、設定、排程設定各一個 key），用 `store.update(key, fn)` 做讀改寫，`fn` 要是純函式。**雲端同步靠使用者帳號**：做登入／註冊畫面，呼叫 `kupei.auth.login()`（2026-10-28 起註冊預設關閉：`kupei.auth.config()` 的 `registrationOpen` 為 `true` 時才顯示註冊入口、呼叫 `kupei.auth.register()`，`inviteRequired` 為 true 才顯示「邀請碼」欄位，傳給 `register` 第三個參數）；設定畫面可以放「改密碼」（`kupei.auth.changePassword(目前密碼, 新密碼)`，成功後其他裝置全部登出、這台不用重登）；登入畫面可以放「忘記密碼」（輸入帳號、維護者給的重設碼、新密碼，呼叫 `kupei.auth.resetPassword(帳號, 重設碼, 新密碼)`，成功後直接是登入狀態；失敗一律提示「帳號或重設碼不對，請向維護者重新索取」）；用 `kupei.getSession()` 判斷有沒有登入（同步、不打網路），登出用 `kupei.auth.logout()`。~~沒登入時 App 退回本機模式、評分與行情不需要登入~~（2026-10-28 起改成：沒登入就只顯示登入畫面，見第 0 條）。
10. **密碼與登入權杖不要自己存、不要印出、不要送去任何其他地方**：客戶端已經把登入權杖存在 `localStorage`（key `kupei:session`），密碼只在送出登入表單時用一次。不要做「記住密碼」。寫入權杖同理：不得放進建置、環境變數、repo secret 或原始碼（`kupei.setWriteToken()` 只留給站長本人的設定畫面）。
11. 收到 401 `UNAUTHENTICATED` 而且當時是登入狀態 → 客戶端已自動登出（`getSession()` 變 `null`，`onSessionChange` 會通知），畫面回到登入頁即可，不要用存起來的密碼自動重登。
12. **新聞與報告**（2026-10-27 起）：新聞用 `kupei.news({ q, exclude, days })`（後端代抓 Google 新聞，只有標題、來源、時間、原文連結，點了開原文；`stale: true` 表示來源暫時抓不到、這是較舊的結果，可以小字提示）；報告用 `kupei.reports(code)` 列出、`kupei.report(code, period, rev)` 讀單一份（含 `summary`）。報告檔案只有外部連結（`url`、`files[].url`），後端不存報告檔案。使用者要給報告管線的**參考檔**（PDF、圖片、試算表、文字檔）用 `kupei.reportInputs.upload(code, file)` 上傳（2026-10-28 起，只限登入；見「報告參考檔」一節），不要自己組上傳請求、不要把檔案轉 base64 放進 JSON 或雲端文件。「產生報告」按鈕只在登入時顯示，呼叫 `kupei.requestReport(code, period)`，進度用 `kupei.reportRequests(code)` 看——**不要輪詢**，使用者回到頁面或手動重新整理時再查即可。報告是外部管線產生的，後端不會自己產生。

## 端點

### 評分資料 `/data/*`（靜態 JSON）

先讀 manifest 取得目前的批次編號 `run`，其餘檔案都在 `/data/<run>/` 底下。**批次資料夾發布後內容不變**，換批次只會改 manifest 的 `run`；所以 manifest 每次都要重新讀，批次內的檔案可以放心快取。

| 路徑 | 內容 |
| --- | --- |
| `GET /data/manifest.json` | `run`（批次編號）、`published_at`、`details`（有明細的代號清單）、`hashes`（各批次檔的內容雜湊，見下）、`status_notes` |
| `GET /data/<run>/summary.json` | `head`（期別、規格版本、母體、筆數）、`majors`（12 個大項）、`rows`（全部公司，緊湊陣列） |
| `GET /data/<run>/details/<代號>.json` | 單一公司的分數樹，最多三層。只有 manifest 的 `details` 列出的代號才有 |
| `GET /data/<run>/nodes.json` | 節點 id → 英文名稱（字串）。批次交付的若是 id → 字串，直接用交付版 |
| `GET /data/<run>/tr.json` | 原因碼 → 中文 |
| `GET /data/<run>/vparams.json` | 估價參數表 |
| `GET /data/<run>/help.json` | **可選**。說明頁定義，任意 JSON（形狀由批次交付方決定） |
| `GET /data/<run>/valuation.json` | **可選**。估價，JSON 物件，原樣發布（後端不計算、不檢查內部形狀） |
| `GET /data/<run>/node_info.json` | **可選**。節點 id → 完整定義物件（批次交付的節點是物件形時才有；英文名仍在 `nodes.json`） |

回應帶 `ETag`，請求時可用 `If-None-Match` 換 304。

**`manifest.hashes`：四個固定鍵＋可選鍵。**

- 固定鍵 `summary`、`vparams`、`tr`、`nodes` **永遠在**，對應的檔案一定存在。
- 可選鍵 `help`、`valuation`、`node_info`：該批次有交付對應檔案才有。**沒有這個鍵＝檔案不存在**（請求會 404），不要打。
- 每個鍵的值是該檔的內容雜湊，請求時帶 `?v=<雜湊>`（例如 `/data/<run>/valuation.json?v=<manifest.hashes.valuation>`），可長期快取（見「快取與載入」）。
- 之後可能再加鍵；不認得的鍵忽略即可。
- `starter/kupei-client.ts` 已包好：`loadHelp()`、`loadValuation()`、`loadNodeInfo()` 沒有鍵回 `null`（不打網路），有就抓一次、同一個批次之後回記憶體，換批次才重抓。

**批次可帶的額外欄位。** 評分批次可以在既有的檔案裡多帶欄位，後端**原樣保留**、不檢查形狀；沒交付就沒有這些鍵，前端用之前自己檢查型別、缺了要能正常顯示：

- `summary.json` 的頂層鍵（例如 `company_meta`：公司層級的額外資料）。
- 明細樹 `details/<代號>.json` 每個 TreeNode 的新鍵（例如 `goal`、`definition`、`peer_rank`）。
- **`summary.rows` 不會加欄位**：每列固定 11 欄、大項格固定 8 欄（順序見下）。新的公司層級資料一律放 `company_meta`，節點層級的放 TreeNode 新鍵。

**`summary.rows` 每列是一個陣列**（欄位順序固定）：

```
[代號, 名稱, 產業, 金融業(0|1), 總名次|null, 政策分大項數|null, 大項[12], 否決(0|1), 否決來源[], 財務複核(0|1), 複核來源[]]
```

大項的每一格也是陣列：

```
[分數|null, 標記字, 大項名次|null, 是否政策分(0|1), 是否含政策分成分(0|1), 狀態, 下層觸發數, own]
```

- 大項順序與 `majors` 相同。
- `狀態` 只有 `TRIAL_SCORE`、`POLICY_SCORE` 且分數非 null 才算有分數；其餘（`UNAVAILABLE`、`NOT_APPLICABLE`、`OUT_OF_SCOPE_FINANCIAL`…）都沒有。
- 總名次為 `null` ＝ NR（不排名）。排名母體以 `head.rank_population`（各大項各一個）為準，由評分批次交付、後端不重算。
- 完整型別與排序、底色規則見文末附錄。

### 行情 `/api/market/*`

`latest`／`history` 是**每日收盤**（非即時）。**日收盤、月營收、交易日曆資料來源：FinMind**（僅在授權範圍內顯示；FinMind 條款要求標示來源，頁面請標「資料來源：FinMind」）；證交所、櫃買中心與公開資訊觀測站只當備援。盤中快照另見 `/api/market/intraday`（不來自 FinMind）。

| 路徑 | 說明 |
| --- | --- |
| `GET /api/market/latest` | `{ dates: { L, O }, quotes: { "<代號>": [收盤, 漲跌價差, 成交股數] } }`。`L` 上市、`O` 上櫃，各市場最新交易日。`收盤` 為 `null` ＝當日無成交。選填 `source: { L, O }`（K-30，相容新增）：各市場最新交易日的資料來源，`"finmind"` 或 `"exchange"`（證交所／櫃買，含舊資料）；欄位可能不存在，前端要容忍 |
| `GET /api/market/history?codes=2330,2454` | `{ quotes: { "<代號>": [[日期, 收盤, 成交股數], …] }, revenue: { "<代號>": [[年月, 營收(千元), 年增率%], …] } }`。近 20 個交易日、近 5 個月，舊→新。`codes` 要 1～30 個 4 碼代號，任何一個不合法就整個 400（不會默默丟掉壞的） |
| `GET /api/market/status` | `{ counts: { quoteDays, firstDay, lastDay, revenueMonths, firstMonth, lastMonth }, runs: [最近 12 次抓取], source? }`，看資料新不新用。`runs[].message` 看得出來源：`finmind`、`calendar`（FinMind 日曆確定休市）、`證交所（finmind：原因）`＝FinMind 失敗退回交易所；`source` 同 `latest` |

- 漲跌幅 ＝ `漲跌價差 ÷ (收盤 − 漲跌價差)`。
- 只有 4 碼代號；評分名單 1,976 家中有 10 家找不到行情（1516、2067、3625、3632、4155、4804、6142、6167、6173、8047）。
- 盤中價見下一節（每 10 分鐘一份快照，不是即時串流）；新聞、個股報告**還沒有**。估價不在行情這裡，是評分批次的可選檔 `valuation.json`（見上）。

### 盤中行情 `/api/market/intraday`（2026-10-27 新增）

外部排程**盤中每 10 分鐘**抓證交所 MIS 即時報價推進來，這裡讀最新的那一份快照。**不是即時串流**：不要輪詢，畫面打開或使用者手動重新整理時讀一次即可（`starter` 的 `kupei.marketIntraday()` 已包好 60 秒記憶體快取）。

| 路徑 | 說明 |
| --- | --- |
| `GET /api/market/intraday` | `{ phase, stale, ttlSeconds, markets: { L, O }, quotes: { "<代號>": [成交價, 漲跌, 累計成交量(股), "HH:MM:SS"] } }`，上市、上櫃合併。唯讀權杖、登入權杖、寫入權杖都可讀 |
| `POST /api/market/intraday/ingest` | **推送權杖專用，前端不會用到**（排程程式推資料用；唯讀、登入、寫入權杖一律 401） |

- `phase`：台灣時間平日 09:00 前 `PRE`、09:00～13:30 `OPEN`、其餘（含週末）`CLOSED`。國定休市日後端不知道，看 `stale`。
- `stale`：`true` ＝ 這份不是今天夠新的資料——任一市場還沒有快照、快照日期不是今天（休市日、週末、開盤前），或開盤中超過 20 分鐘沒更新。**`stale` 為 `true` 時請改顯示收盤價（`/api/market/latest`）或標明資料時間**，不要當成即時價。
- `markets.L`／`markets.O`：`{ at, receivedAt, source }` 或 `null`（還沒有快照）。`at` 是來源資料時間（ISO 8601、`+08:00`），顯示「資料時間」用它；`receivedAt` 是後端收到的時間（UTC）。
- 報價每格都可能是 `null`：成交價 `null` ＝今天還沒有成交；漲跌 ＝ 成交價 − 昨收；成交量單位是**股**（與 `latest` 相同，不含零股）。漲跌幅 ＝ `漲跌 ÷ (成交價 − 漲跌)`。
- 沒有快照時回 `quotes: {}`、`stale: true`。只有 4 碼代號。
- `ttlSeconds`（目前 300）是推送間隔；伺服器快取 60 秒、`Cache-Control: private, max-age=60`。GitHub 排程常會晚幾分鐘，資料時間可能比現在早 5～15 分鐘。
- 計入 `/api/*` 的每分鐘 30 次。

### 帳號 `/api/auth/*`（不需要權杖）

**2026-10-28 起（K-53）帳號由維護者發**：註冊預設關閉，維護者在帳號管理頁新增帳號（密碼可自訂或由伺服器產生，只顯示一次），私下交給使用者。使用者用 `login` 拿登入權杖，之後評分資料、行情、新聞、報告與雲端文件全部用這把權杖讀（唯讀權杖即將停用）。維護者若重新開放註冊，`config` 的 `registrationOpen` 會是 `true`，下面的 `register` 才能用。

| 方法 | 路徑 | 請求 | 回應 |
| --- | --- | --- | --- |
| `GET` | `/api/auth/config` | — | `{ registrationOpen: boolean, inviteRequired: boolean }`：有沒有開放註冊（2026-10-28 起預設 `false`）、註冊要不要邀請碼（不回傳邀請碼本身） |
| `POST` | `/api/auth/register` | `{ "username", "password", "inviteCode"? }` | **201** `{ user: { id, username }, token, expiresAt }`（註冊完直接是登入狀態）。註冊關閉時一律 **403 `REGISTRATION_CLOSED`** |
| `POST` | `/api/auth/login` | `{ "username", "password" }` | 200，格式同上 |
| `POST` | `/api/auth/logout` | 標頭 `Authorization: Bearer <登入權杖>` | `{ ok: true }`，這個權杖立刻失效（其他裝置的登入不受影響） |
| `GET` | `/api/auth/me` | 標頭 `Authorization: Bearer <登入權杖>` | `{ user: { id, username } }` |
| `POST` | `/api/auth/password` | 標頭 `Authorization: Bearer <登入權杖>`，本文 `{ "currentPassword", "newPassword" }` | 200，格式同 login（**新的**登入權杖） |
| `POST` | `/api/auth/reset` | `{ "username", "code", "newPassword" }`（不需要權杖） | 200，格式同 login（忘記密碼：用維護者給的重設碼設新密碼，成功即登入） |

- **帳號**：不分大小寫（一律轉小寫存），3～32 字，只能用英文字母、數字與 `_` `.` `-`，開頭要是英數。**密碼** 8～128 字（區分大小寫，前後空白也算）。
- **登入權杖**：`kps_` 開頭的 47 字元字串，有效 **30 天**（`expiresAt`，ISO 8601 UTC），到期要重新登入（沒有自動續期）。之後所有請求用 `Authorization: Bearer <登入權杖>`：能讀評分資料（`/data/*`）、行情（`/api/market/latest|history|status|intraday`）、新聞（`/api/news*`）、報告（`/api/reports*`），加上 `/api/store` 與報告參考檔、報告請求。同一個帳號可以在多台裝置各自登入。
- **權杖存放**：`starter/kupei-client.ts` 存在 `localStorage` 的 `kupei:session`（`{ token, username, expiresAt }`）。伺服器只存權杖的 SHA-256，看不到原本的權杖；密碼以 PBKDF2-SHA256 加鹽雜湊。
- **與寫入權杖的關係**：寫入權杖的文件 owner 是共用的 `kupei`，每個帳號是自己的 `u:<id>`，**彼此看不到**（帳號登入後看不到寫入權杖存的那份，反之亦然；要搬資料由前端讀出再寫進去）。站長的自選（`/api/watchlist`）兩者都碰不到。
- **註冊開關**（2026-10-28，K-53）：預設關閉。關閉時 `register` 不管內容一律 403 `REGISTRATION_CLOSED`（帶 CORS），前端不要顯示註冊入口；`config().registrationOpen` 為 `true` 時才顯示。已經有帳號的人（登入、改密碼、重設密碼）不受影響。
- **邀請碼**（2026-10-26 新增；只在註冊開放時有作用）：維護者可以把「註冊需要邀請碼」打開。打開時 `register` 要帶 `inviteCode`，沒帶 403 `INVITE_REQUIRED`、不對 403 `INVITE_INVALID`；關閉時這個欄位被忽略（帶了也沒關係）。註冊畫面打開時先呼叫 `GET /api/auth/config`，`inviteRequired` 為 `true` 才顯示邀請碼欄位。邀請碼本身不會從任何公開端點回傳，由維護者另外給使用者。
- **改密碼**（2026-10-26 新增）：`POST /api/auth/password`，新密碼規則同註冊（8～128 字）。目前密碼錯 401 `INVALID_CREDENTIALS`（登入權杖不受影響，不要因此把使用者登出）。成功後**這個帳號所有裝置的登入權杖都失效**（包含這台的舊權杖），回應裡是這台的新權杖（30 天）——要立刻換掉存著的權杖；別台裝置下一個請求會收到 401 `UNAUTHENTICATED`，回到未登入。
- **忘記密碼**（2026-10-27 新增）：帳號沒有 Email，所以由維護者在帳號管理頁產生**一次性重設碼**（12 字元，顯示成 `XXXX-XXXX-XXXX`，只用數字與不易混淆的大寫字母），私下交給使用者。使用者在 App 輸入帳號、重設碼、新密碼，呼叫 `POST /api/auth/reset`。重設碼 **24 小時**內有效、**只能用一次**；維護者再產生一組會讓舊的失效。比對時去掉 `-` 與空白、不分大小寫。成功：設新密碼、**這個帳號所有裝置的登入權杖都失效**、回應是這台的新權杖（同 login，直接是登入狀態）。帳號不存在、重設碼不對、過期、已用過、帳號停用 → 一律 401 `INVALID_CREDENTIALS`（不透露是哪一種）；帳號或新密碼格式不對 400 `BAD_REQUEST`（先驗格式）。
- **限流**：註冊＋登入＋改密碼＋重設密碼合計每個 IP 每分鐘 **10 次**（IPv6 以 /64 為一組）；登入與重設密碼另外每個帳號每分鐘 **30 次**（不分 IP，兩者合計；2026-10-28 從 10 次調高，避免別人拿你的帳號名一直打就讓你登不進來），超過 429 `RATE_LIMITED`（`Retry-After: 30`）。`logout`、`me`、`config` 計入 `/api/*` 的每分鐘 30 次。
- 不需要 `X-Requested-With`；CORS 與其他端點相同（預檢允許 `POST`）。
- **錯誤**：格式不對 400 `BAD_REQUEST`；帳號已被使用 409 `USERNAME_TAKEN`；帳號不存在或密碼錯一律 401 `INVALID_CREDENTIALS`（同一個訊息，不透露帳號是否存在；改密碼時＝目前密碼不對；重設密碼時＝帳號或重設碼不對、過期、已用過或帳號停用）；登入權杖無效、過期、已登出、帳號被停用或在別台改了密碼 401 `UNAUTHENTICATED`；註冊關閉 403 `REGISTRATION_CLOSED`；註冊需要邀請碼卻沒填 403 `INVITE_REQUIRED`、邀請碼不對 403 `INVITE_INVALID`。
- **帳號被停用**：維護者可以停用帳號（所有裝置立刻登出、之後登入一律 401 `INVALID_CREDENTIALS`；雲端文件保留，恢復後照舊）。
- **目前沒有**：刪除帳號、Email 驗證、使用者自己申請重設碼（重設碼只能由維護者產生）、使用者自己申請帳號（註冊關閉時帳號只能由維護者新增）。

```ts
await kupei.auth.login('coku', 'password-from-maintainer')   // 帳號由維護者發；成功回 { user }，之後所有讀取都用登入權杖
const { registrationOpen, inviteRequired } = await kupei.auth.config()   // registrationOpen 預設 false → 不顯示註冊入口
// 只有 registrationOpen 為 true 時：await kupei.auth.register('coku', 'my-long-password', inviteCode)
kupei.getSession()                                      // { username: 'coku', expiresAt: '…' } | null
await kupei.store.update('watchlist', (cur) => ({ ...(cur ?? {}), groups }))
await kupei.auth.changePassword('my-long-password', 'new-long-password')   // 其他裝置全部登出，這台自動換新權杖
await kupei.auth.resetPassword('coku', '7K3M-QX9P-2HWD', 'new-long-password') // 忘記密碼：維護者給的重設碼，成功即登入
await kupei.auth.logout()
```

### 雲端文件 `/api/store/*`（寫入，需登入或寫入權杖）

前端改的任何資料——自選群組、個股問題、新聞設定、報告排程設定——整包 JSON 存到雲端，換裝置就同步。後端**不認識內容**：每個 key 一份文件，形狀由前端決定，要存新東西不必改後端。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/api/store` | `{ docs: [{ key, version, updatedAt, bytes }] }` 所有文件（不含內容） |
| `GET` | `/api/store/<key>` | `{ key, version, updatedAt, data }`；沒有時 `version: 0, data: null` |
| `PUT` | `/api/store/<key>` | 內容 `{ baseVersion, data }`。`baseVersion` 要等於目前版本（第一次 0）→ `{ key, version, updatedAt }`；不符 **409** `VERSION_CONFLICT`，`error.details` 是雲端最新的整份文件 |
| `DELETE` | `/api/store/<key>?baseVersion=N` | `N` 是 ≥ 1 的整數（缺少或不合法 400）。版本相符才刪 → `{ ok: true }`；不符 409（`details` 是最新文件）、不存在 404 |

- `key`：小寫英數與連字號，1～40 字，開頭英數（例如 `watchlist`、`stock-questions`、`news-settings`、`report-schedule`）。
- `data`：任意 JSON，序列化後最多 **256 KB**（超過 413 `TOO_LARGE`）；整個請求本文最多 300 KB（超過也是 413 `TOO_LARGE`）。`data: null` 也會存成一份（版本照樣 +1、讀回 `data: null` 但 `version` > 0）；要清掉請用 `DELETE`。
- 列表的 `bytes`：目前是 `data` JSON 字串的**字元數**（不是 UTF-8 位元組，中文內容會比實際位元組小）；額度（2 MB）以 UTF-8 位元組計，請不要拿 `bytes` 加總來判斷離上限還多遠，以 `QUOTA_EXCEEDED` 的 `details.bytes` 為準。
- **每個帳號的上限**（2026-10-27 新增）：最多 **50 份**文件、所有文件合計 **2 MB**（UTF-8 位元組；覆寫時以改完後的總量算，改小一定可以）。超過回 **403** `QUOTA_EXCEEDED`，`error.details` 是 `{ docs, bytes, maxDocs, maxBytes }`（目前用量）——請提示使用者刪掉不用的文件，不要自動重試。寫入權杖的那份也適用。
- **樂觀鎖**：每次寫入版本 +1。兩台裝置同時改，後送的會收到 409 和最新內容，載入後重做。`starter/kupei-client.ts` 的 `store.update(key, fn)` 已包好「讀→改→寫、撞到就用最新重做」。
- 回應一律 `no-store`；每個 IP 每分鐘 60 次。
- 後端只負責**存**：報告排程存的是設定，**後端不會跑報告**；新聞設定同理。
- 唯讀權杖打這些路徑一律 403。用登入權杖時，文件屬於該帳號，別的帳號看不到。

**寫入權杖怎麼用**（站長本人用；一般使用者請用帳號）：它不是建置時注入的環境變數——那樣會跟網頁一起公開。做法是 App 提供一個設定畫面讓使用者貼上，`kupei.setWriteToken(token)` 會存在該裝置的 `localStorage`（key `kupei:write-token`），之後所有請求自動改用它。清除就 `setWriteToken(null)`。

### 新聞與報告 `/api/news`、`/api/reports/*`（2026-10-27）

唯讀、寫入、登入權杖都能讀新聞與報告；送出「產生報告」請求只限**登入權杖**（唯讀、寫入權杖 403 `FORBIDDEN`）。計入每分鐘 30 次（同 `/api/market/*`）。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `GET` | `/api/news?q=台積電,2330&exclude=廣告&days=3` | `{ items: [{ title, url, source, publishedAt }], fetchedAt, source: "google-news-rss", stale? }`。`q` 1～5 個關鍵字（之間是 OR）、`exclude` 0～5 個排除字（**只比對標題**）、每個 1～50 字，逗號分隔；`days` 1、3 或 5（省略＝3）。不合法 400。新→舊、最多 50 則、只有 `days` 天內的；`url` 一定是 https（Google 新聞的轉址連結，打開會到原文）；`title` 已去掉結尾的「 - 來源」。伺服器同一個查詢 30 分鐘內只抓一次，瀏覽器可留 5 分鐘（`private, max-age=300`）。來源暫時抓不到時回較舊的結果並帶 `"stale": true`，完全沒有舊結果時 **502** `UPSTREAM_ERROR` |
| `GET` | `/api/news/sources` | `{ sources: [{ id: "google-news", … }, { id: "bing-news", name: "Bing 新聞", … }] }`。後端先抓 Bing 新聞（每個關鍵字各查一次再合併），失敗才改抓 Google 新聞（Google 會擋 Cloudflare 機房 IP）；`source` 欄位目前固定為 `"google-news-rss"`，代表「RSS 聚合來源」，不分是哪一家。每則的 `source` 才是發布媒體名稱 |
| `GET` | `/api/reports/<code>` | `{ reports: [{ period, rev, status, title, generatedAt, url, files }] }`（不含 `summary`）。`code` 4 碼數字。`period` 新→舊、同期 `rev` 新→舊；`status` 是 `DRAFT`／`PUBLISHED`／`FAILED`；`url` 是 https 或 `null`；`files` 是 `[{ name, url }]`（外部 https 連結，後端不存檔案） |
| `GET` | `/api/reports/<code>/<period>/<rev>` | 同一筆加 `summary`（純文字或 markdown，可能是 `null`）與 `inputs: [{ id, name, mime, bytes, sha256, createdAt }]`（報告引用的參考檔，2026-10-28 起；沒有引用是 `[]`；下載只限上傳者本人）。`period` 像 `2026Q2`、`rev` 正整數；沒有 **404** `NOT_FOUND` |
| `POST` | `/api/reports/<code>/requests` | **登入權杖**。本文 `{ "period": "2026Q2", "trigger": "MANUAL" }` → **202** `{ id, status: "QUEUED", createdAt }`。同一期已經在排隊就回那一筆（**200**，同樣形狀）。每個帳號最多 20 筆排隊中，超過 **403** `QUOTA_EXCEEDED`（`details: { queued, maxQueued }`） |
| `GET` | `/api/reports/<code>/requests` | **登入權杖**。`{ requests: [{ id, period, trigger, status, createdAt, updatedAt, message }] }`，只有自己的，新→舊。`status`：`QUEUED`→`RUNNING`→`DONE`／`FAILED`，`message` 是管線留的說明（可能 `null`） |

> 新聞每個查詢快取 30 分鐘。**沒命中快取的新查詢每個 IP 每分鐘最多 6 次**：超過時有舊結果就回舊的並帶 `stale: true`，沒有就回 429 `RATE_LIMITED`。不要一次打很多組關鍵字，也不要把使用者輸入的每個字元都拿去查。

**推送權杖專用**（給產生報告的管線，不是給瀏覽器用；`Authorization: Bearer <INGEST_TOKEN>`，同行情推送的那把，**不要放進前端**）：

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `PUT` | `/api/reports/<code>/<period>/<rev>` | 本文 `{ status: "DRAFT"\|"PUBLISHED"\|"FAILED", title: ≤200 字, generatedAt: ISO 8601（含時區）, summary?: ≤65,536 字, url?: https\|null, files?: [{ name: ≤200 字, url: https }] ≤ 20, inputs?: [參考檔 id] ≤ 20 }`，本文 ≤ 300 KB（超過 413）。同一版再推＝覆寫。成功 `{ status: "ok" }`。`inputs`（2026-10-28 起）：引用的參考檔要是同一家公司、未刪除的，否則 **400** `BAD_REQUEST`（`details: { missing: [id…] }`、報告不寫）；被引用的參考檔會**鎖定**，之後不能刪（409 `INPUT_LOCKED`）；覆寫或刪除報告後，**沒有任何報告再引用**的參考檔自動解鎖（2026-10-28 起） |
| `DELETE` | `/api/reports/<code>/<period>/<rev>` | 成功 `{ status: "ok" }`；沒有這一版 404 |
| `GET` | `/api/reports/requests?status=QUEUED&limit=50` | 所有帳號的請求（不含帳號名），舊→新：`{ requests: [{ id, code, period, trigger, status, createdAt }] }`。`status` 預設 `QUEUED`（可 `RUNNING`／`DONE`／`FAILED`），`limit` 1～200 預設 50 |
| `PATCH` | `/api/reports/requests/<id>` | 本文 `{ status: "RUNNING"\|"DONE"\|"FAILED", message?: ≤500 字 }` → `{ status: "ok" }`；沒有這筆 404。**狀態只能照順序改**（2026-10-28 起）：`QUEUED`→`RUNNING`→`DONE`／`FAILED`，或 `QUEUED`→`FAILED`；`DONE`、`FAILED` 之後不能再改。不合順序（例如 `QUEUED` 直接 `DONE`）**409** `INVALID_TRANSITION`，`details: { from, to }`——管線要先 PATCH `RUNNING`。建立超過 90 天的 `DONE`／`FAILED` 會被自動清掉 |

推送權杖錯或沒帶 → 401（不帶 CORS）。用唯讀、寫入、登入權杖打這四個也是 401。

### 報告參考檔 `/api/reports/<code>/inputs`（2026-10-28）

使用者提供給報告管線的參考資料（財報 PDF、截圖、試算表、筆記）。檔案存在**私人**物件儲存，沒有公開網址；下載一律經後端驗權杖、以附件（attachment）回傳。

**誰能用**：**登入權杖**可以上傳，並且只看得到、下載、刪除**自己上傳的**（別人的一律 404）。唯讀、寫入權杖 **403** `FORBIDDEN`。報告管線用推送權杖可以列出、下載、刪除、解鎖全部，也能上傳（`createdBy: "pipeline"`）。每個 IP 每分鐘 60 次（同 `/api/store`），上傳另外每個帳號每分鐘 60 個檔。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `POST` | `/api/reports/<code>/inputs?name=<原檔名>` | 本文是**檔案的原始位元組**（不是 multipart、不是 JSON）。標頭：`Content-Type` 依副檔名（見下）、`X-Content-SHA256: <檔案的 SHA-256，64 位小寫 hex>`。→ **201** `{ id, code, name, mime, bytes, sha256, createdAt, createdBy, locked }`。`name` 是清理過的檔名（去路徑與控制字元、最多 120 字） |
| `GET` | `/api/reports/<code>/inputs` | `{ inputs: [同上形狀] }`：自己上傳、沒刪除的，新→舊 |
| `GET` | `/api/reports/<code>/inputs/<id>` | 下載檔案本身（`Content-Disposition: attachment`、`Cache-Control: private, no-store`）。不是自己的或不存在 **404** |
| `DELETE` | `/api/reports/<code>/inputs/<id>` | `{ status: "ok" }`。**立即刪除、無法復原**（後端沒有備份）。已被報告引用 **409** `INPUT_LOCKED`；不是自己的或不存在 **404** |
| `POST` | `/api/reports/<code>/inputs/<id>/unlock` | 解鎖（2026-10-28），沒有本文。→ **200** 同上形狀（`locked: false`）；本來就沒鎖也 200（可以重複呼叫）。仍被報告引用 **409** `INPUT_REFERENCED`，`details: { reports: [{ period, rev }] }`（最多 20 筆）；不是自己的或不存在 **404** |

**限制**：單檔 ≤ **20 MiB**（413 `TOO_LARGE`）；每個帳號最多 **50 個檔、合計 200 MiB**（**413** `QUOTA_EXCEEDED`，`details: { files, bytes, maxFiles, maxBytes }`；刪掉舊的就有空間）。**被報告引用（`locked: true`）的檔不算在配額裡**（列表照樣列出），解鎖後重新算進去。只接受下表，**副檔名、`Content-Type`、檔案內容（檔頭；文字檔要 UTF-8、不含 NUL）三者都要對**，否則 **415** `UNSUPPORTED_TYPE`：

| 副檔名 | `Content-Type` |
| --- | --- |
| `pdf` | `application/pdf` |
| `png` | `image/png` |
| `jpg`、`jpeg` | `image/jpeg` |
| `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `csv` | `text/csv`（UTF-8；Big5 的 CSV 會被拒，請先另存成 UTF-8） |
| `txt` | `text/plain`（UTF-8） |
| `md` | `text/markdown`（UTF-8） |

`X-Content-SHA256` 和實際收到的內容不符（傳輸中壞掉、算錯）→ **400** `CHECKSUM_MISMATCH`，檔案沒有存，重傳即可。`starter/kupei-client.ts` 的 `kupei.reportInputs.upload(code, file)` 已經幫你算 SHA-256、依副檔名設 `Content-Type`，**直接用它**。

> 這些檔**沒有備份**：刪除就沒了，物件儲存出問題也救不回來。請提醒使用者自留原檔。被報告引用的檔不能刪（報告發布後的參考資料不會被悄悄換掉）。

**鎖定與解鎖**：報告管線推送報告時會把引用的檔鎖定（`locked: true`）。報告改版不再引用、或那份報告被刪除，**沒有任何報告再引用**的檔會自動解鎖，通常不用做什麼。要手動確認或解開以前留下的鎖，用 `kupei.reportInputs.unlock(code, id)`（`POST …/inputs/<id>/unlock`）：仍被引用就 409 `INPUT_REFERENCED`，`details.reports` 列出是哪幾份報告（可顯示「被 2026Q2 第 1 版引用」）。

### 健康檢查

`GET /api/health` → `{ "ok": true }`。不需要權杖，確認服務在不在線。

## 錯誤

| HTTP | `error.code` | 意思 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | 參數不對（例如 `codes` 不是 1～30 個 4 碼代號） |
| 401 | `UNAUTHENTICATED` | 權杖不對，或登入權杖過期／已登出（JSON，帶 CORS）；唯讀權杖被後端停用後（K-53）也是這個。完全沒帶 `Authorization` 時，`/data/*` 回純文字 `Unauthorized`、`/api/*` 回 JSON 401，兩者都**不帶 CORS 標頭**（瀏覽器跨來源只會看到 CORS 錯誤） |
| 401 | `INVALID_CREDENTIALS` | 登入時帳號不存在或密碼錯（含被停用的帳號）；改密碼時目前密碼不對；重設密碼時帳號或重設碼不對、過期、已用過或帳號停用 |
| 403 | `REGISTRATION_CLOSED` | 註冊關閉（2026-10-28 起預設，K-53）；帳號要向維護者索取。不管本文與邀請碼，`register` 一律回這個 |
| 403 | `INVITE_REQUIRED` | 註冊需要邀請碼但沒填（`GET /api/auth/config` 的 `inviteRequired` 為 true） |
| 403 | `INVITE_INVALID` | 註冊的邀請碼不對 |
| 409 | `USERNAME_TAKEN` | 註冊的帳號已被使用 |
| 403 | `FORBIDDEN` | 權杖有效但這個路徑不開放：唯讀權杖打 `/api/store`、唯讀或寫入權杖打報告參考檔 `/api/reports/<code>/inputs*`、任何權杖打站長的自選／登入狀態／補抓，以及不存在的 `/api/*` 路徑 |
| 409 | `VERSION_CONFLICT` | 寫入或刪除時 `baseVersion` 不是最新；`error.details` 是雲端最新的文件 |
| 403 | `QUOTA_EXCEEDED` | 雲端文件超過每個帳號的上限（50 份或合計 2 MB）；`error.details` 是 `{ docs, bytes, maxDocs, maxBytes }`。報告請求排隊中超過 20 筆時也是這個，`details` 是 `{ queued, maxQueued }`。**報告參考檔超過 50 個或 200 MiB 時是 413**（不是 403），`details` 是 `{ files, bytes, maxFiles, maxBytes }` |
| 409 | `INPUT_LOCKED` | 報告參考檔已被報告引用，不能刪除 |
| 409 | `INPUT_REFERENCED` | 解鎖報告參考檔時仍有報告引用它（`POST …/inputs/<id>/unlock`）；`error.details` 是 `{ reports: [{ period, rev }] }`（最多 20 筆） |
| 400 | `CHECKSUM_MISMATCH` | 報告參考檔上傳的 `X-Content-SHA256` 和收到的內容不符；檔案沒有存，重傳即可 |
| 415 | `UNSUPPORTED_TYPE` | 報告參考檔的副檔名、`Content-Type` 或內容不在允許範圍，或三者對不上 |
| 409 | `INVALID_TRANSITION` | 報告請求的狀態不能這樣改（推送權杖的 `PATCH /api/reports/requests/<id>`）；`error.details` 是 `{ from, to }` |
| 413 | `TOO_LARGE` | 文件超過 256 KB，或請求本文超過上限：雲端文件 300 KB、帳號端點（`/api/auth/*`）4 KB、報告請求 4 KB、報告參考檔單檔 20 MiB |
| 429 | `RATE_LIMITED` | 每個 IP 每分鐘：`/api/market/*`、`/api/auth/logout`／`me`／`config` 與其他帶權杖的 `/api/*` 合計 30 次；`/api/store*` 與 `/api/reports/<code>/inputs*` 各 60 次；註冊＋登入＋改密碼＋重設密碼 10 次（登入與重設另外每個帳號 30 次）；`/api/news` 沒命中快取的新查詢 6 次。IPv6 以 /64 為一組，超過一律帶 `Retry-After: 30`（跨來源時瀏覽器讀不到這個標頭，請預設等 30 秒）。`/data/*` 用唯讀或寫入權杖不受限；用登入權杖時，後端偶爾要查一次登入狀態，那一次計入 30 次 |
| 502 | `UPSTREAM_ERROR` | `/api/news` 的新聞來源暫時抓不到、伺服器也沒有舊結果；稍後再試（不要立刻重送） |
| 404 | `NOT_FOUND` | 刪除不存在的文件、沒有這份報告（JSON）；`/data/*` 的檔案不存在時內文是純文字，只看狀態碼 |

> 瀏覽器 console 出現 CORS 錯誤，多半是來源不在白名單（不是 `localhost`）、`/api/*` 請求沒帶 `Authorization`、送了不允許的請求標頭（預檢只允許 `Authorization`、`Content-Type`、`If-None-Match`、`X-Content-SHA256`），或網址打錯導致 Worker 沒回應。用 curl 打同一個網址可以分辨。回應沒有 `Access-Control-Expose-Headers`，所以跨來源的 JS 讀不到 `Retry-After`、`ETag` 等非基本標頭（瀏覽器自己的快取驗證不受影響）。

## 快取與載入（2026-10-25 實測後的建議；`starter/kupei-client.ts` 已照做）

實測線上：`summary.json` 原始 1 MB、壓縮後約 170 KB（Cloudflare 自動 gzip／brotli，不用自己處理）；每一趟請求往返約 0.3–0.6 秒，冷啟動可到 2–3 秒。所以瓶頸是**往返次數**，不是檔案大小。

| 規則 | 做法 | 效果 |
| --- | --- | --- |
| 批次檔網址帶版本 | `/data/<run>/summary.json?v=<manifest.hashes.summary>`，可選檔同理（`help`、`valuation`、`node_info`）；`details/*.json` 用 `?v=<published_at>` | 伺服器回 `max-age=31536000, immutable`，**第二次打開完全不碰網路** |
| `manifest.json` 永遠重新驗證 | 它是換批次的唯一訊號，`cache: 'no-cache'`（1 KB，用 ETag 換 304） | 換批次一定看得到 |
| 先用上次的批次 | 把 manifest 記在 `localStorage`；下次打開先從快取還原畫面，同時在背景核對 manifest，換了才重載 | 回訪的首次渲染不等任何往返 |
| 評分與行情同時起跑 | app 啟動就呼叫 `preload()`，兩條互不等待 | 少一趟串行 |
| `latest` 不重複 | 伺服器 `max-age=60`＋ETag；客戶端 60 秒內共用同一份、進行中的請求共用 | 多個元件同時要行情也只有 1 次請求 |
| `history` 合併 | 同一個 tick 內的呼叫合併成一次、每次最多 30 檔、已載過的不重抓；伺服器 `max-age=300` | 列表畫面要幾十家只打 1 次 |
| 429 自動退避 | 依 `Retry-After` 等待後重試一次 | 偶發限流不會直接壞畫面 |
| 逾時 | 每個請求 20 秒 | 不會無限等 |

不帶 `?v=` 的批次檔請求仍回 `no-cache`（每次驗證），能用但慢；**請一律帶版本**。

`HEAD`（2026-10-28 起）：所有 `/api/*` 的 `HEAD` 與 `GET` 一樣驗權杖、計入限流、回同樣的狀態碼與標頭，只是沒有本文；`/data/*` 的 `HEAD` 照常。一般不需要用 `HEAD`，直接 `GET` 即可。

## 開發建議

- **先讀 manifest，再讀批次檔。** 不要把批次編號寫死在程式裡。
- **`summary.json` 約 1,976 列、檔案不小**，讀一次放在記憶體或 IndexedDB，不要每個畫面重抓。
- **行情用批次的方式取。** `history` 一次最多 30 檔，不要逐檔打。`/api/*` 每分鐘 30 次，不要放在輪詢或會重複觸發的地方。
- **`/api/market/latest` 伺服器快取 60 秒、瀏覽器 `max-age=60`＋ETag**，行情一天只更新幾次，不需要更頻繁地問。
- **評分資料（`/data/*`）不限次數、不花後端額度**，可以放心讀；盡量把 `summary.json` 留在記憶體。
- **看資料新不新：** 評分看 `summary.head.as_of`、行情看 `/api/market/latest` 的 `dates`。
- 排序與底色規則照文末附錄，免得跟本站的畫面對不上。

---

## 附錄 A：資料型別（TypeScript）

```ts
// /data/manifest.json
interface Manifest {
  run: string
  published_at: string
  source_file: string
  details: string[] // 有明細的公司代號
  hashes: ManifestHashes
  status_notes: { translations: string; spec_current: string; sources: string[] }
}

// 四個固定鍵永遠在；可選鍵只有該批次交付了對應檔案才有（沒有＝檔案不存在）
interface ManifestHashes {
  summary: string
  vparams: string
  tr: string
  nodes: string
  help?: string        // → /data/<run>/help.json
  valuation?: string   // → /data/<run>/valuation.json
  node_info?: string   // → /data/<run>/node_info.json
  [key: string]: string | undefined // 之後可能新增
}

// /data/<run>/summary.json
interface Summary {
  head: {
    requested_period: string
    annual_period: string
    spec_version: string
    as_of: string
    source_run: string
    rank_population: number[] // 各大項的排名母體（由批次交付，後端不重算）
    counts: { records: number; ranked: number; NR: number; veto: number; fin_review: number }
    gate_overlay: { execution_mode: string; production_enabled: boolean; source: string; policy: string }
  }
  majors: { id: string; en: string; zh: string; goal: string }[] // 12 項
  rows: Row[]            // 每列固定 11 欄，不會加欄
  company_meta?: unknown // 可選：公司層級的額外資料，形狀由批次交付方決定
  [key: string]: unknown // 批次可能帶的其他頂層鍵，原樣保留
}

type ScoreStatus =
  | 'TRIAL_SCORE' | 'POLICY_SCORE'                       // 只有這兩種且分數非 null 才算有分數
  | 'UNAVAILABLE' | 'NOT_APPLICABLE' | 'OUT_OF_SCOPE_FINANCIAL' | 'CONFIGURATION_PENDING'
  | 'NOT_ENABLED' | 'SCOPE_UNVERIFIED' | 'NOT_ANNUAL_PERIOD' | 'DIAGNOSTIC'
  | 'ADJUSTMENT' | 'ADJUSTMENT_NOT_EVALUATED' | 'MISSING_ROW'
  | (string & {})                                          // 之後可能新增

// [分數, 標記字, 大項名次, 是否政策分, 是否含政策分成分, 狀態, 下層觸發數, own]
type MajorCell = [number | null, string, number | null, 0 | 1, 0 | 1, ScoreStatus, number, number]

// [代號, 名稱, 產業, 金融業, 總名次, 政策分大項數, 大項[12], 否決, 否決來源[], 財務複核, 複核來源[]]
type Row = [string, string, string, 0 | 1, number | null, number | null, MajorCell[], 0 | 1, string[], 0 | 1, string[]]

// /data/<run>/details/<代號>.json 是 TreeNode[]（第一層是 12 個大項，最多三層）
interface TreeNode {
  id: string
  en: string
  zh: string
  w: number | null      // 在上層的權重
  p: string             // 期別
  s: number | null      // 分數
  st: ScoreStatus
  r: string[]           // 原因碼，中文對照在 tr.json
  src: GateNote[]
  below: number         // 下層觸發數
  rd: GateNote[]        // Gate 規則列
  c: TreeNode[]         // 子節點
  mr?: number | null    // 只有第一層有：大項名次
  [key: string]: unknown // 批次可帶的額外欄位（例如 goal、definition、peer_rank），原樣保留
}
type GateNote = [string, string, string, string, string, string, string, number, string, string]

// 可選批次檔：內部形狀由評分批次交付方決定，後端原樣發布、不檢查
type HelpDoc = unknown                                   // /data/<run>/help.json
type Valuation = Record<string, unknown>                 // /data/<run>/valuation.json
type NodeInfo = Record<string, Record<string, unknown>>  // /data/<run>/node_info.json：節點 id → 定義物件

// GET /api/news
interface NewsItem { title: string; url: string; source: string; publishedAt: string }
interface NewsResponse { items: NewsItem[]; fetchedAt: string; source: 'google-news-rss'; stale?: true }
// GET /api/news/sources
interface NewsSource { id: string; name: string; url: string }

// GET /api/reports/<code>（不含 summary）、GET /api/reports/<code>/<period>/<rev>（含 summary）
type ReportStatus = 'DRAFT' | 'PUBLISHED' | 'FAILED'
interface ReportFile { name: string; url: string }
interface ReportMeta { period: string; rev: number; status: ReportStatus; title: string; generatedAt: string; url: string | null; files: ReportFile[] }
interface Report extends ReportMeta { summary: string | null; inputs: ReportInputRef[] }
// 報告參考檔（登入權杖；GET /api/reports/<code>/<period>/<rev> 的 inputs 是不含 code／createdBy／locked 的 ReportInputRef）
type ReportInputMime = 'application/pdf' | 'text/plain' | 'text/markdown' | 'text/csv' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'image/png' | 'image/jpeg'
interface ReportInputRef { id: string; name: string; mime: ReportInputMime; bytes: number; sha256: string; createdAt: string }
interface ReportInput extends ReportInputRef { code: string; createdBy: string; locked: boolean }
// POST /api/reports/<code>/inputs/<id>/unlock 409 INPUT_REFERENCED 的 error.details
interface ReportInputReferencedDetails { reports: { period: string; rev: number }[] }
// POST／GET /api/reports/<code>/requests（登入權杖）
type ReportRequestStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'
interface ReportRequestCreated { id: number; status: 'QUEUED'; createdAt: string }
interface ReportRequest { id: number; period: string; trigger: 'MANUAL'; status: ReportRequestStatus; createdAt: string; updatedAt: string; message: string | null }
```

## 附錄 B：排序與底色規則（與本站畫面一致）

- **母體：** 排除金融保險業（`row[3] === 1`）。
- **預設排序：** 依總名次（`row[4]`），NR（`null`）排最後，NR 之間依代號。
- **依大項排序：** 只有狀態是 `TRIAL_SCORE` 或 `POLICY_SCORE` 且分數非 null 才算有值，沒有值的排最後；同分依總名次，再依代號。
- **欄頭點擊循環：** 高→低、低→高、回總名次。
- **依成交價排序：** 用 `/api/market/latest` 的最新收盤價；沒有價格（找不到行情、當日無成交）的排最後。
- **大項分數格底色：** `rgba(58,128,228, 0.08 + 0.52 × 名次百分位)`，名次百分位 ＝ `1 − (名次 − 1) ÷ (母體 − 1)`，母體取 `head.rank_population[大項索引]`；沒有名次時退回用分數（30～100 拉開）。名次在前 10% 加粗。
- **漲跌幅：** `漲跌價差 ÷ (收盤 − 漲跌價差)`；漲紅、跌綠、平盤灰。
- **股價格式：** 1,000 以上的整數不帶小數、非整數一位；1,000 以下兩位。
- 估價（中心、安全邊際、上下限…）只在批次有 `valuation.json`（`loadValuation()` 不是 `null`）時顯示；沒有就不要顯示空欄位。
