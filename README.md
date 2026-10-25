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
