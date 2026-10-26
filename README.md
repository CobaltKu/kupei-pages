# KuPei（GitHub Pages）

靜態前端：完整 UI（排名、個股、自選、新聞與報告設定、狀態、說明共 9 個頁面）放在 GitHub Pages，資料來自後端 Server API（Cloudflare Workers）。每日收盤資料，非即時；分數為試算版本，模型效度尚未完全驗證，不是投資建議。

## 結構

| 位置 | 內容 |
| --- | --- |
| `index.html` | 頁面結構（來自 KuPei 的 `Python/kupei_3/ui_web`），加一顆「帳號」按鈕 |
| `public/legacy/app.js`、`styles.css` | 完整 UI。由 `ui_web` 複製（來源提交 `0dcd1f3`），以 `PAGES` 旗標加了 Pages 版差異（行情只有每日收盤、新聞與報告顯示「尚未提供」、說明文字）；**之後 UI 只改這一份** |
| `src/bridge.ts` | 資料橋接：把後端的 `/data/…`、`/api/market/…` 轉成 UI 要的形狀（`window.KupeiAPI`）；帳號視窗；本機資料與雲端文件的同步 |
| `src/kupei-client.ts`、`src/kupei-types.ts` | 後端交付的 starter 客戶端，**不要手改**，更新時整檔覆蓋 |
| `tests/` | 瀏覽器測試（見下） |
| `docs/` | 後端技術回覆與需求；新需求只寫 `docs/後端建議.md` |

UI 不重算任何分數、名次或 Gate；後端沒有的資料（估價、第二階段處置、同業名次、說明定義、新聞、報告、盤中行情）顯示「尚未提供」。

## 本機開發

1. 複製 `.env.example` 為 `.env.local`，填入 `VITE_KUPEI_TOKEN`（權杖由維護者另外提供；`.env.local` 已被 `.gitignore` 排除，不要 commit）。
2. `npm install`
3. `npm run dev`（瀏覽器開 `http://localhost:5173/`；本機網址已在後端 CORS 白名單）

## 測試

需要 Node 與 Playwright（Codex 的 Node 工具目錄已內建），Edge 以 `CHR` 指定。先啟動 `npm run dev`（或建置後的 `vite preview`）。

- `tests/e2e_pages.mjs`：對線上 Workers 資料跑完整 UI（首頁、個股、自選、各設定頁、狀態、說明、帳號視窗、手機寬度），18 項。`BASE=http://127.0.0.1:5173/ node tests/e2e_pages.mjs`
- `tests/e2e_pages_account.mjs`：用假的帳號端點測邀請碼欄位（依 `/api/auth/config`）與改密碼，6 項；不建立真實帳號。需 `ENVFILE`（同下）。
- `tests/e2e_pages_xss.mjs`：在 `localStorage` 預先放入惡意或結構錯誤的 `kupei3_watch`／`kupei3_news`／`kupei3_report`（模擬被改寫的雲端文件）後載入各頁，確認注入的程式沒有執行、不合格的群組與欄位被丟棄、頁面仍正常顯示，8 項；不需登入。`BASE=http://127.0.0.1:5173/ node tests/e2e_pages_xss.mjs`
- `tests/e2e_pages_sync.mjs`：用假的帳號與雲端文件端點測同步邏輯（跨裝置、版本衝突、舊寫入權杖、登出），7 項；不建立真實帳號。需 `ENVFILE=<.env.local 完整路徑>`（資料請求改帶唯讀權杖，只在記憶體使用）。

## 部署

推到 `main` 會由 `.github/workflows/deploy-pages.yml` 建置並部署到 GitHub Pages（Git 與推送由 Codex 統整）。

repo 設定：

- Settings → Pages → Source：GitHub Actions
- Settings → Secrets and variables → Actions → Secrets：`VITE_KUPEI_TOKEN`
- Settings → Secrets and variables → Actions → Variables：`VITE_KUPEI_BASE`

權杖只在建置時注入，部署後的網頁程式碼內會含有權杖（唯讀、有限流、可作廢），請勿散布網址。

## 自選、設定與帳號同步

- 自選群組（5 組、每組 50 家）、新聞與報告設定存在這個瀏覽器（`localStorage` 的 `kupei3_watch`、`kupei3_news`、`kupei3_report`）。評分與行情**不需要登入**。
- 左側「帳號」：登入，或切到「建立帳號」自己註冊（帳號 3～32 字、英數與 `_` `.` `-`、開頭英數，自動轉小寫；密碼 8～128 字，註冊要輸入兩次）。登入後這三份資料以雲端文件（`ui-watch`、`ui-news`、`ui-report`，依帳號分開，每份 ≤ 256 KB）同步，換裝置登入同一帳號就一致。
- 同步規則：登入時雲端是空的就把本機資料帶上去；雲端已有資料就以雲端為準（本機原本的那份保留在 `*_conflict`）；之後本機每次修改約 1.5 秒後寫入，版本不符（另一台先寫入）時以雲端為準並重新載入，未同步的本機內容保留在 `*_conflict`。登出後資料保留在本機、不再同步。
- 登入權杖與密碼：由 `kupei-client.ts` 存在 `localStorage`（`kupei:session`），密碼只在送出表單時用一次。目前沒有忘記密碼、改密碼功能。
- 「進階：使用寫入權杖」是舊做法，保留相容；以帳號為準，兩者資料彼此分開。
- **個股問題、新聞設定的伺服器端擷取、報告流程**目前沒有後端，UI 顯示「尚未提供」。

## 給後端的需求

2026-10-26 分工：Codex 統整 API／資料、分支合併、部署整合與 Git 推送；Claude 僅修改前端 UI；Server 變更由 Adem 依本節指定文件接手。新需求只在 `docs/後端建議.md` 一處維護，完成列移除，回覆與證據以 Git 歷程追溯。本 repo 不管理正式發布之後的工作排程。

要改後端或回報後端問題，寫在 `docs/後端建議.md`（一列一件事，不要貼任何權杖或密碼）。後端窗口會統一處理並回覆在同一份文件。
