# KuPei 前端部署指南（GitHub Pages）

給 KuPei 前端的開發者。前端由 KuPei 自行部署到 GitHub Pages，後端由後端窗口提供（`KuPei-API.md`）。串接規則見《2026-10-23_KuPei前端串接規範.md》。

## 先知道的兩件事

1. **GitHub Pages 的網站一律公開。** repo 可以設私人（需 GitHub Pro），但發布出去的網頁任何人都打得開。
2. **權杖會在建置後的前端程式裡。** 任何打開網頁的人都拿得到，等於評分資料與行情對「知道網址的人」公開。這是雙方已知且接受的做法；後端有每分鐘 30 次限流，權杖可隨時作廢重發。所以：不要把網址到處散布；權杖只透過 GitHub secret 注入，**不寫進原始碼、不 commit**。

## 流程

### 1. 專案與路由
- Vite 專案（Vue／React 都可）。路由用 **hash 模式**（`#/home`），GitHub Pages 不支援 history 模式的子路徑重新整理。
- `vite.config.ts` 照 `starter/vite.config.example.ts` 設 `base`。

### 2. 串接程式
- 把 `starter/kupei-client.ts`、`starter/kupei-types.ts` 複製進專案（例如 `src/api/`）。
- 用 `createKupeiClient({ baseUrl: import.meta.env.VITE_KUPEI_BASE, token: import.meta.env.VITE_KUPEI_TOKEN })`。
- 本機開發：複製 `starter/.env.example` 成 `.env.local`，填權杖；確認 `.gitignore` 有 `.env.local`。
- 用 `localhost` 開發不需要任何設定，後端已放行。

### 3. 建 repo 並推上去
```bash
git init && git add -A && git commit -m "Initial frontend"
gh repo create <repo> --private --source . --push     # 或在網頁建 repo 再 push
```

### 4. 放工作流程
- 複製 `starter/.github/workflows/deploy-pages.yml` 到專案的 `.github/workflows/`。
- repo 名稱是 `<帳號>.github.io` 的話，把檔內 `PAGES_BASE` 改成 `/`。

### 5. repo 設定（Settings）
| 位置 | 設定 |
| --- | --- |
| Pages → Build and deployment → Source | **GitHub Actions** |
| Secrets and variables → Actions → **Secrets** | `VITE_KUPEI_TOKEN` ＝ 後端窗口給的權杖 |
| Secrets and variables → Actions → **Variables** | `VITE_KUPEI_BASE` ＝ `https://kupei-dashboard.tmac19920626.workers.dev` |

### 6. 第一次部署
- push 到 `main` → Actions 分頁看 `deploy-pages` 跑完 → 網址是 `https://<帳號>.github.io/<repo>/`。
- **此時打開會看到 CORS 錯誤，是正常的**：後端還沒把你的來源加入白名單。

### 7. 向後端窗口登記來源
- 把 **來源** 告訴後端窗口：`https://<帳號>.github.io`（只到 `.io`，不含 repo 路徑；同帳號底下所有 repo 共用）。
- 後端窗口加入白名單並重新部署後，網站就能讀到資料。這一步沒做之前，網站不會動。

### 8. 驗收
照《串接規範》第 5 節六項跑一次；特別是 Network 面板沒有 429、沒有打到未列出的端點。

## 寫入權杖（雲端同步）

- **不是 GitHub secret、不是環境變數。** 它只能在 CoKu 自己的裝置上，所以 App 要有一個設定畫面讓使用者貼上，呼叫 `kupei.setWriteToken(token)`；客戶端會存在該裝置的 `localStorage`，之後自動使用。
- 沒輸入前 App 走本機模式（自選等只存本機、顯示「未連上雲端」），輸入後改走 `kupei.store`。
- 換權杖：後端窗口重發後，在每台裝置的設定畫面重新貼上。
- 建置產物裡**不應**出現寫入權杖；驗收第 6 項會查。

## 之後

- **更新**：push 到 `main` 就自動重新部署。
- **回滾**：`git revert` 後 push，或在 Actions 重跑上一次成功的工作流程。
- **換權杖**：後端窗口重發後，更新 repo secret `VITE_KUPEI_TOKEN`，再 push 一次（或手動 Run workflow）讓它重新建置。
- **換網址**（例如自訂網域）：先告知後端窗口新來源，加白名單後再切。

## 常見問題

| 現象 | 原因 | 處理 |
| --- | --- | --- |
| 頁面空白、資源 404 | `base` 沒設或 repo 名不符 | 檢查 `PAGES_BASE` 與 repo 名稱 |
| console 顯示 CORS 錯誤 | 來源還沒加白名單 | 第 7 步 |
| 全部請求 401 | secret 沒設、名稱打錯、或建置時沒注入 | 檢查 `VITE_KUPEI_TOKEN`，重新 Run workflow |
| 偶爾 429 | 請求太頻繁 | 不要輪詢；`marketLatest()` 讀一次放著 |
| 重新整理後 404 | 用了 history 路由 | 改 hash 路由 |
