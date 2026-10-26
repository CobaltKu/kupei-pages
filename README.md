# KuPei 唯讀評分（GitHub Pages）

靜態前端，資料來自 KuPei 的唯讀 API（Cloudflare Workers）。每日收盤資料，非即時；分數為試算版本，模型效度尚未完全驗證，不是投資建議。

## 本機開發

1. 複製 `.env.example` 為 `.env.local`，填入 `VITE_KUPEI_TOKEN`（權杖由維護者另外提供；`.env.local` 已被 `.gitignore` 排除，不要 commit）。
2. `npm install`
3. `npm run dev`（瀏覽器開 `http://localhost:5173/`；本機網址已在後端 CORS 白名單）

## 部署

推到 `main` 會由 `.github/workflows/deploy-pages.yml` 建置並部署到 GitHub Pages。

repo 設定：

- Settings → Pages → Source：GitHub Actions
- Settings → Secrets and variables → Actions → Secrets：`VITE_KUPEI_TOKEN`
- Settings → Secrets and variables → Actions → Variables：`VITE_KUPEI_BASE`

權杖只在建置時注入，部署後的網頁程式碼內會含有權杖（唯讀、有限流、可作廢），請勿散布網址。

## 自選與帳號登入

- 表格最左欄 ★ 加入／移出自選，「只看自選」只列自選公司。評分與行情**不需要登入**；沒登入時自選只存在這個瀏覽器（`localStorage`）。
- 右上「登入」：可以登入，或切到「建立帳號」自己註冊（帳號 3～32 字、小寫英數與 `_` `.` `-`、開頭要英數，輸入時自動轉小寫；密碼 8～128 字，建立時要再輸入一次確認）。註冊完直接是登入狀態。
- 登入後右上顯示帳號名與「登出」，自選存在帳號的雲端文件（`/api/store/watchlist`，依帳號分開），換裝置登入同一個帳號就同步；兩台同時改也不會互相覆蓋（讀→改→寫、版本鎖）。
- 第一次登入時若帳號的雲端是空的、本機有自選，會把本機的帶上去。
- 登出後回到只存本機（本機那份保留）。登入有效 30 天，過期、在別處被作廢時會回到未登入並提示「登入已過期，請重新登入」。重新整理會直接還原登入狀態（不等網路）。
- 登入權杖由 `kupei-client.ts` 存在 `localStorage`（`kupei:session`），密碼只在送出表單時用一次，不會另外保存。目前沒有忘記密碼、改密碼功能，忘記密碼請找維護者。

### 進階：寫入權杖（舊做法，保留相容）

- 登入表單底下「進階：使用寫入權杖」貼上**寫入權杖**（由維護者另外提供、只給本人）→ 自選存到寫入權杖的那份雲端文件。登入帳號時以帳號為準；帳號與寫入權杖的資料彼此分開、互相看不到。
- 寫入權杖只存在貼上的那台裝置，**不是** GitHub secret、不在原始碼、不在建置產物。「清除」就回到只存本機。

## 載入

`src/kupei-client.ts` 與 `src/kupei-types.ts` 來自後端交付包 `starter/`，不要手改；更新時整檔覆蓋。它負責：批次檔帶版本參數長期快取、回訪先用快取還原再背景核對（換批次會提示）、行情 60 秒共用、429 自動退避。
