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

## 自選與雲端同步

- 表格最左欄 ★ 加入／移出自選，「只看自選」只列自選公司。沒有設定時自選只存在這個瀏覽器（`localStorage`）。
- 右上「雲端同步」貼上**寫入權杖**（由維護者另外提供、只給本人）→ 自選存到雲端（`/api/store/watchlist`），換裝置同步；兩台同時改也不會互相覆蓋（讀→改→寫、版本鎖）。
- 寫入權杖只存在貼上的那台裝置，**不是** GitHub secret、不在原始碼、不在建置產物。「清除」就回到只存本機。
- 第一次連線時若雲端是空的、本機有自選，會把本機的帶上去。

## 載入

`src/kupei-client.ts` 與 `src/kupei-types.ts` 來自後端交付包 `starter/`，不要手改；更新時整檔覆蓋。它負責：批次檔帶版本參數長期快取、回訪先用快取還原再背景核對（換批次會提示）、行情 60 秒共用、429 自動退避。

## 給後端的需求

要改後端或回報後端問題，寫在 `docs/後端建議.md`（一列一件事，不要貼任何權杖或密碼）。後端窗口會統一處理並回覆在同一份文件。
