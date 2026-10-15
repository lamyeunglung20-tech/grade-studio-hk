# 成績分析室（Grade Studio HK）

[開啟公開網站](https://grade-studio-hk.grassystone9.chatgpt.site/) · [GitHub Pages 入口](https://lamyeunglung20-tech.github.io/grade-studio-hk/)

成績分析室可用 Google 登入，管理班別、學生名單及多次考試；輸入分數後顯示統計、預測等級和趨勢，並可下載 PDF。考試次序可以自行調整。每班可儲存 Grading 分界預設，新考試自動帶入，亦可逐次修改。學生登入後只可查看與自己電郵配對的紀錄，也可下載個人趨勢 PDF；老師可下載所選學生的趨勢 PDF。

這個倉庫公開保存網站程式碼，不包含學生姓名、分數或雲端資料庫內容。公開版已把管理員電郵改為 `admin@example.com` 佔位值；如自行部署，請在 `lib/grade.ts` 設定自己的管理員電郵。Firebase 設定與雲端資料庫需在部署環境中設定。

網站使用 Cloudflare Worker 和 D1 資料庫。GitHub Pages 只提供通往現有網站的公開入口，不能執行登入或資料庫 API；實際應用程式在上述 Sites 網址運行。

本機需要 Node.js 22.13+ 和 pnpm。執行 `pnpm install`、`pnpm dev`；測試可用 `node --test tests/*.test.mjs`。部署時須準備自己的 Sites 專案、Firebase Authentication 和 D1。
