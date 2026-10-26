// GitHub Pages 的網址是 https://<帳號>.github.io/<repo>/，資源路徑要帶 /<repo>/ 前綴。
// deploy-pages.yml 會用 PAGES_BASE 環境變數帶進來；本機開發沒有這個變數就是 "/"。
// 如果 repo 名稱正好是 <帳號>.github.io，網址沒有子路徑，PAGES_BASE 要設成 "/"。
import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  // 讓 app.js 的網址帶建置編號，換版後瀏覽器不會用到舊快取
  define: { __BUILD__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? Date.now().toString(36)) },
})
