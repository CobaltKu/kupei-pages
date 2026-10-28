// GitHub Pages 的網址是 https://<帳號>.github.io/<repo>/，資源路徑要帶 /<repo>/ 前綴。
// deploy-pages.yml 會用 PAGES_BASE 環境變數帶進來；本機開發沒有這個變數就是 "/"。
// 如果 repo 名稱正好是 <帳號>.github.io，網址沒有子路徑，PAGES_BASE 要設成 "/"。
import { defineConfig } from 'vite'

// 建置編號：app.js（bridge.ts 用 __BUILD__）與 index.html 的 styles.css（?v=__BUILD__）共用，換版後瀏覽器不會用到舊快取
const BUILD = process.env.GITHUB_SHA?.slice(0, 7) ?? Date.now().toString(36)

export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  define: {
    __BUILD__: JSON.stringify(BUILD),
    // 登入閘門（2026-10-28）：網站必須登入，建置一律不帶唯讀權杖。就算環境裡還有 VITE_KUPEI_TOKEN，也換成空字串、不進 JS
    'import.meta.env.VITE_KUPEI_TOKEN': '""',
  },
  // define 只作用在 JS；index.html 裡的 __BUILD__ 在這裡換掉
  plugins: [{ name: 'kupei-build-id', transformIndexHtml: (html) => html.replaceAll('__BUILD__', BUILD) }],
})
