# 後端 API 文件（從後端 repo 同步）

後端（Adem）的對外契約，跟著後端更新。程式端的 client 在 `src/kupei-client.ts`、`src/kupei-types.ts`。

- `KuPei-API.md`：端點、格式、錯誤碼
- `openapi.json`：機器可讀版本
- 其餘為串接規範與部署指南

權杖不放在任何檔案裡，由 Adem 另外給。

## kupei-pages 前端現況：網站必須登入（2026-10-28）

本資料夾的文件從後端 repo 同步，內容（例如串接規範 §1、§5.1、§6 說唯讀權杖放在建置裡、評分與行情不需要登入）以後端為準、這裡不改；kupei-pages 前端目前的做法是：

- **網站必須登入**：只給站長發的帳號使用，沒有註冊畫面。沒登入時整頁只有登入畫面，不發任何讀資料的請求（只會有 `/api/auth/login`；忘記密碼時 `/api/auth/reset`）。帳號、重設碼都找站長。
- **建置不帶唯讀權杖**：`src/bridge.ts` 不讀 `VITE_KUPEI_TOKEN`（`vite.config.ts` 也把它固定換成空字串），GitHub Actions 不注入權杖 secret；所有資料請求都用登入權杖（`kps_…`）。`npm run build` 最後的 `tools/check-dist-secrets.mjs` 確認 `dist/` 裡沒有任何權杖。
- **本機開發也用帳號登入**：`.env.local` 不再需要 `VITE_KUPEI_TOKEN`。
- 登出、登入失效（starter 收到 401 清掉 session，`onSessionChange(null)`）→ 重新載入回到登入畫面，畫面上的資料一併清掉。
- 寫入權杖不能再用來登入或同步；舊資料登入後用帳號視窗的「匯入舊的寫入權杖資料」搬進帳號。
- starter（`src/kupei-client.ts`）沒有改。沒有唯讀權杖時 starter 會 `console.warn` 要人設定 `VITE_KUPEI_TOKEN`，這句在 `bridge.ts` 建立 client 的當下濾掉（只濾這一則）。
