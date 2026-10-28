# KuPei（GitHub Pages）

靜態前端：完整 UI（排名、個股、自選、新聞與報告設定、狀態、說明共 9 個頁面）放在 GitHub Pages，資料來自後端 Server API（Cloudflare Workers）。每日收盤資料，非即時；分數為試算版本，模型效度尚未完全驗證，不是投資建議。

**網站必須登入（2026-10-28 起）**：只給站長發的帳號使用，沒有開放註冊。沒登入時整頁只有登入畫面，不讀任何資料；帳號、忘記密碼的重設碼都找站長。公開建置不帶任何權杖，所有資料請求都用登入後的登入權杖（`kps_…`）。

## 結構

| 位置 | 內容 |
| --- | --- |
| `index.html` | 頁面結構（來自 KuPei 的 `Python/kupei_3/ui_web`），加一顆「帳號」按鈕 |
| `public/legacy/app.js`、`styles.css` | 完整 UI。由 `ui_web` 複製（來源提交 `0dcd1f3`），以 `PAGES` 旗標加了 Pages 版差異（行情只有每日收盤、新聞與報告顯示「尚未提供」、說明文字）；**之後 UI 只改這一份** |
| `src/bridge.ts` | 登入閘門（沒登入只有登入畫面）；資料橋接：把後端的 `/data/…`、`/api/market/…` 轉成 UI 要的形狀（`window.KupeiAPI`）；帳號視窗；本機資料與雲端文件的同步 |
| `src/kupei-client.ts`、`src/kupei-types.ts` | 後端交付的 starter 客戶端，**不要手改**，更新時整檔覆蓋 |
| `tests/` | 瀏覽器測試（見下）；`tests/fixtures/kupei-data.json` 是合成的固定測試資料（`node tests/fixtures/make-fixture.mjs` 產生） |
| `tools/check-dist-secrets.mjs` | 建置後檢查：`dist/` 裡不能有任何權杖（`npm run build` 最後自動跑） |
| `docs/` | 後端技術回覆與需求；新需求只寫 `docs/後端建議.md` |

UI 不重算任何分數、名次或 Gate；後端沒有交付的資料顯示「尚未提供」。正式 r8 批次（`server_v3_0_30_r8_r2_20261027`）已含估價（`valuation.json`）、說明（`help.json`）、`summary.json` 的 `company_meta`（評估狀態、第二階段處置、複核來源）與分數樹節點的 `goal`／`definition`／`peer_*`，橋接層（`src/bridge.ts`）直接轉成畫面欄位，沒有的批次維持空值。新聞（`/api/news`，Google／Bing 新聞 RSS）、報告（`/api/reports`，由 KuPei 管線推送）、盤中快照（`/api/market/intraday`，盤中約每 10 分鐘）已接後端（2026-10-27）。

## 本機開發

1. `npm install`
2. `npm run dev`（瀏覽器開 `http://localhost:5173/`；本機網址已在後端 CORS 白名單）
3. 用自己的帳號登入（帳號找站長）。**不需要唯讀權杖**：`.env.local` 不用再放 `VITE_KUPEI_TOKEN`（放了也不會進建置）；要指到別的後端才在 `.env.local` 設 `VITE_KUPEI_BASE`。

## 測試

需要 Node 與 Playwright（Codex 的 Node 工具目錄已內建），Edge 以 `CHR` 指定。先啟動 `npm run dev`（或建置後的 `vite preview`）。

網站必須登入（2026-10-28）後，測試**不再需要唯讀權杖（`ENVFILE`）**，共用 `tests/_kupei_test.mjs`：
- 預設用 fixture：`/data/*`、`/api/market/*`、新聞、報告都由 `tests/fixtures/kupei-data.json`（合成資料 150 家、約 550 KB）回應，完全不連線上；跟線上一樣，沒帶登入權杖的資料請求回 401。帳號與雲端文件一律是假的端點，測試用假的已登入 session（`kps_<帳號>`）或在登入畫面登入。
- 設 `KUPEI_TEST_SESSION=<登入權杖>`：資料請求改帶這個登入權杖讀線上（權杖只在記憶體、不輸出；線上限流每分鐘 30 次）。`e2e_pages_r8.mjs`、`e2e_pages_perf.mjs` 比對線上真實資料，沒設就略過。
- 測試檔與 `_kupei_test.mjs` 要放同一個資料夾執行（例如一起複製到有 Playwright 的資料夾），`KP_FIXTURE=<repo>/tests/fixtures/kupei-data.json` 指到 fixture。
- `npm run test:dist`：就算環境裡設了 `VITE_KUPEI_TOKEN`，建置產物也不含它；檢查器抓得到權杖、像權杖的字串常值、`kps_` 權杖、寫死的 Bearer，4 項。

- `tests/e2e_pages_gate.mjs`：登入閘門，15 項：沒登入只有登入畫面（工作區藏起來、不建立 `KupeiAPI`、不載入 `app.js`）、零個讀資料請求（只允許 `/api/auth/login`、`/api/auth/config`）、沒有註冊（寫「帳號由站長發放」）、忘記密碼可切換、空白不送出、密碼錯提示並清掉密碼欄、送出中防連點（連點＋Enter 只送一次）、登入後不重新整理就載入資料且資料請求都帶登入權杖、重新整理仍登入、登出通知後端並回到登入畫面清掉資料、再登入重新載入、資料請求 401（登入失效）回到登入畫面並提示、console 沒有要求設 `VITE_KUPEI_TOKEN` 的警告、375／1280 寬不橫向捲動且輸入框 ≥16px。`SHOTS=<資料夾>` 另存 `kp-login-375.png`、`kp-login-1280.png`。

- `tests/e2e_pages.mjs`：完整 UI（首頁、個股、自選、各設定頁、狀態、說明、帳號視窗〔已登入、沒有註冊〕、手機寬度），18 項。`BASE=http://127.0.0.1:5173/ node tests/e2e_pages.mjs`
- `tests/e2e_pages_r8.mjs`：正式 r8 擴充欄位（對線上 Workers 資料，不寫入任何資料；要 `KUPEI_TEST_SESSION`，沒設就略過），10 項：第二階段處置與複核原因、否決／複核來源、未評估公司、同業名次、估價（有中心值、只有中心值、不適用）、109 個節點的目的／定義、首頁 1,979 列的處置分布、說明頁 109 項、狀態頁估價啟用。
- `tests/e2e_pages_mobile.mjs`：手機預檢（iPhone SE／14／Pro Max 寬度，模擬 iOS Safari），33 項：登入畫面與 9 個頁面不橫向捲動、無 JS 錯誤、輸入框字級 ≥16px（避免 iOS 點進去自動放大），帳號視窗（改密碼展開）不超出畫面。實機 iPhone 仍須人工看。
- `tests/e2e_pages_account.mjs`：用假的帳號端點測沒有註冊（登入畫面與帳號視窗都沒有建立帳號、不打 `/api/auth/config`、`/register`）與改密碼，4 項；不建立真實帳號。
- `tests/e2e_pages_account2.mjs`：用假的帳號與雲端文件端點測「忘記密碼」（登入畫面連結切換、欄位驗證、重設碼錯 401 的訊息、成功後已登入且 `kupei:session` 換新並提示其他裝置已登出）與「匯入舊的寫入權杖資料」（權杖錯、沒有資料可匯入、摘要與確認後寫進帳號雲端、本機換新且 `kupei3_*_prev` 有備份、409 重讀版本重試一次、額度已滿不重試、權杖不進網址與 storage），13 項；不建立真實帳號。`SHOTS=<資料夾>` 另存截圖。
- `tests/e2e_pages_xss.mjs`：在 `localStorage` 預先放入惡意或結構錯誤的 `kupei3_watch`／`kupei3_news`／`kupei3_report`（模擬被改寫的雲端文件）後載入各頁，確認注入的程式沒有執行、不合格的群組與欄位被丟棄、頁面仍正常顯示，8 項；不需登入。`BASE=http://127.0.0.1:5173/ node tests/e2e_pages_xss.mjs`
- `tests/e2e_pages_sync.mjs`：用假的帳號與雲端文件端點測同步邏輯（首次登入上傳（閘門前已存在的本機資料）、跨裝置、版本衝突、只有寫入權杖時停在登入畫面不同步、登出、換帳號不混資料、版本號巧合、409 無文件、啟動同步逾時），11 項；不建立真實帳號。
- `tests/e2e_pages_live.mjs`：盤中行情、新聞、報告（後端新端點全部用假的回應），14 項：盤中 CLOSED／OPEN／stale 三種標示與價格覆蓋（盤中沒成交顯示「—」、價格欄名稱改「盤中價」）、只有盤中依 `ttlSeconds` 重抓（用 Playwright 假時鐘）、產業與個股新聞的請求參數（關鍵字與排除字來自本機新聞設定、`days`）、惡意標題不執行、非 https 連結不可點、新聞來源與停用來源、報告列表與單篇（summary 原樣以文字顯示、不解析 markdown）、產生報告請求（未登入引導登入、登入後 202、重複回同一筆、`QUOTA_EXCEEDED` 提示）；不建立真實帳號。`SHOTS=<資料夾>` 另存截圖。
- `tests/e2e_pages_wiring.mjs`：資料橋接修正（2026-10-28），10 項：估價檔延遲 6 秒時首頁不等它、狀態頁估價基準日晚到再補；休市日（phase=OPEN、stale、快照是前一天）退回收盤價不標盤中，今天的快照延遲才標「盤中資料延遲」；`latest.source` 有 finmind 時首頁、個股估價卡、狀態頁標「資料來源：FinMind」；新聞停用來源依媒體名稱（聚合器不能停用，重新載入後直接開設定頁也列得出來）；個股頁快速翻 4 家只替停下來的那家打報告與新聞、回到看過的 5 分鐘內不重打、卡片在畫面內約 0.6 秒就載入、新聞頁不延遲；報告請求的整數 id 轉成字串、202／200 分得出來；`company_meta`／`valuation.json` 欄位結構不對時丟掉不合格的、不卡在載入中；`summary.json` 只讀一次。盤中、新聞、報告、帳號用假的回應，評分與收盤行情用線上資料（部分在回應上改欄位）。
- `tests/e2e_pages_ui.mjs`：畫面修正的回歸測試（盤中端點用假的回應），6 項：手機排序每個選項（含「安全邊際」）不報錯、會重排、點列能展開；盤中轉收盤時桌機表頭、手機排序選單從「盤中價」改回「收盤價」（Playwright 假時鐘，含換頁再回首頁）；不存在的代號不顯示上一家的估價與問題卡；估價卡旗標不重複、數值在 1440 與 390 寬都不截斷、估價格與股價位置有滑鼠提示；搜尋多筆相符提示「找到 N 筆」、代號完全相符直接跳、首頁分數格滑鼠提示；狀態頁、說明頁、報告與新聞設定不外露內部備忘與原始 ISO 時間。`SHOTS=<資料夾>` 另存截圖。
- `tests/e2e_pages_questions.mjs`：個股問題（用假的帳號與雲端文件端點），14 項（設 `SHOTS` 時 15 項）：登入後新增（含相關大項）並寫入雲端、改狀態、刪除／顯示已刪除／恢復、重新整理後仍在、惡意內容以文字顯示不執行、Idempotency-Key 相同只新增一次、If-Match 舊版本回 409、上限提示（每則 1,000 字、每家 100 則、整份約 200 KB）、本機被改寫成惡意或錯誤結構時丟棄不合格的、登入後上傳 `ui-questions`、修改後寫入雲端、另一台裝置登入讀得到、換帳號不上傳上一個帳號的問題；不建立真實帳號。`SHOTS=<資料夾>` 另存截圖。
- `tests/e2e_pages_perf.mjs`：數據顯示效能量測與防退化門檻（對線上 Workers 資料；要 `KUPEI_TEST_SESSION`，沒設就略過），桌機 1440 與手機 390 各跑 `RUNS` 次（預設 3）取中位數：首次／回訪到首頁第一屏、出現收盤價、全部列畫完的時間，排序、篩選、搜尋跳至、個股頁、自選頁的耗時，主執行緒長任務，行情請求次數；另檢查首頁啟動只整表畫一次、latest／history 不重複打、選用檔（valuation、help）不 404 且每次載入最多讀一次、桌機排序重用列的結果正確、自選頁小圖載入中顯示「…」，8 項。`BASE=http://127.0.0.1:5173/ node tests/e2e_pages_perf.mjs`（`OUT=<檔案>` 另存 JSON；`NOGATE=1` 只量不判門檻，量舊版用）。門檻是寬鬆的上限（回訪全部列 < 3 秒、排序與篩選 < 1.5 秒），數字會隨機器負載浮動。

## 部署

推到 `main` 會由 `.github/workflows/deploy-pages.yml` 建置並部署到 GitHub Pages（Git 與推送由 Codex 統整）。

repo 設定：

- Settings → Pages → Source：GitHub Actions
- Settings → Secrets and variables → Actions → Variables：`VITE_KUPEI_BASE`

不需要權杖 secret（2026-10-28 起）：網站必須登入，建置不帶任何權杖；`npm run build` 最後的 `tools/check-dist-secrets.mjs` 在 `dist/` 裡發現權杖或像權杖的值就讓建置失敗、不部署。舊的 secret `VITE_KUPEI_TOKEN` 已不再使用，可以刪除（後端停用唯讀權杖後也會失效）。

## 自選、設定與帳號同步

- 自選群組（5 組、每組 50 家）、新聞與報告設定、個股問題存在這個瀏覽器（`localStorage` 的 `kupei3_watch`、`kupei3_news`、`kupei3_report`、`kupei3_questions`）。網站必須登入才看得到。
- 個股問題：`kupei3_questions` 是一份 `{ "<代號>": [問題…] }`（整份一個雲端文件，不是每家一份，避免超過每人 50 份）。每則最多 1,000 字、每家公司最多 100 則（不含已刪除）、已刪除每家最多保留 50 則（最舊的永久移除）、整份存成雲端文件約 200 KB 以內（超過時拒絕新增並提示；刪除、恢復、改短不受限）。資料由 `src/bridge.ts` 的 `/companies/<代號>/questions…` 路由讀寫，每次讀取都重新驗證（代號 4 碼英數、`Q-<數字>` 編號、文字限長、時間格式），不合格的丟掉。
- 登入畫面：帳號、密碼（帳號由站長發放，沒有註冊；忘記密碼向站長索取重設碼，在登入畫面按「忘記密碼？」）。左側「帳號」可改密碼、登出（登出後回到登入畫面）。登入後這四份資料以雲端文件（`ui-watch`、`ui-news`、`ui-report`、`ui-questions`，依帳號分開，每份 ≤ 256 KB）同步，換裝置登入同一帳號就一致。

### 使用者雲端文件備份與還原

在 PowerShell 進入本 repo，將登入取得的 session token 只放在目前程序的 `KUPEI_SESSION_TOKEN` 環境變數，勿寫入檔案或指令參數。備份使用 `npm run store:backup -- --out <新檔路徑>`；還原先以 `npm run store:restore -- --in <備份檔>` 預覽，確認後加 `--apply`。若要同時刪除備份中不存在的雲端文件，再明確加 `--replace`。輸出檔含使用者資料，不得提交 Git。
- 同步規則：登入時雲端是空的就把本機資料帶上去；雲端已有資料就以雲端為準（本機原本的那份保留在 `*_conflict`）；之後本機每次修改約 1.5 秒後寫入，版本不符（另一台先寫入）時以雲端為準並重新載入，未同步的本機內容保留在 `*_conflict`。登出後回到登入畫面，資料保留在本機、不再同步；登入失效（權杖過期、在別台改了密碼、帳號被停用）時也回到登入畫面。
- 換帳號：本機記住資料屬於哪個帳號（`kupei3_sync` 的 `owner`，寫入權杖算「寫入權杖」，登出不清）。之後用**另一個**帳號同步時，先把本機各份資料備份到 `*_prev`（覆蓋上一次的備份），再完全以該帳號的雲端為準：雲端有就載入、沒有就清空本機那份，不會把上一個帳號的資料上傳。從沒同步過的瀏覽器（登入閘門上線前就存在的本機資料）第一次登入仍照舊把本機資料帶上去。
- 啟動時最多等雲端 4 秒；逾時就先用本機資料開畫面，雲端晚回來若改寫了本機，會暫停寫入與推送並重新載入畫面。
- 登入權杖與密碼：由 `kupei-client.ts` 存在 `localStorage`（`kupei:session`），密碼只在送出表單時用一次，登入失敗會清掉密碼欄。
- 寫入權杖（舊做法）：2026-10-28 起不能再用來登入或同步（沒登入帳號就只有登入畫面）；以前用寫入權杖存的資料，登入後在帳號視窗「匯入舊的寫入權杖資料」搬進帳號。
- **報告參考資料上傳**目前沒有後端，UI 顯示「尚未提供」。報告內容由 KuPei 的管線產生後推到後端；使用者按「產生報告」只會送出請求，等管線處理。

## 給後端的需求

2026-10-26 分工：Codex 統整 API／資料、分支合併、部署整合與 Git 推送；Claude 僅修改前端 UI；Server 變更由 Adem 依本節指定文件接手。新需求只在 `docs/後端建議.md` 一處維護，完成列移除，回覆與證據以 Git 歷程追溯。本 repo 不管理正式發布之後的工作排程。

要改後端或回報後端問題，寫在 `docs/後端建議.md`（一列一件事，不要貼任何權杖或密碼）。後端窗口會統一處理並回覆在同一份文件。
