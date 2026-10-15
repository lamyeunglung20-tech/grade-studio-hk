# 成績分析室

公開網站：[grade-studio-hk.firebaseapp.com](https://grade-studio-hk.firebaseapp.com/)。管理員和學生均以 Google 帳戶登入；學生只可查看與名單中電郵地址相符的個人紀錄。

公開網站，登入後保存班別、學生名單、考試與分數。每班名單只需輸入一次；新增考試時沿用名單。每班亦可把一次考試的 U 至 5** 分界儲存為預設，新考試自動帶入，之後仍可獨立修改。網站即時計算分數區間、預測等級及分佈；老師可下載班別考試及個別學生趨勢 PDF，學生 Google 帳戶也可下載自己的趨勢報告。舊版瀏覽器資料可在登入後手動匯入。

## 本機開發

需要 Node.js 22.13 或以上及 pnpm。安裝後執行 `pnpm dev`；本機登入使用 Sites 開發模擬帳戶。首次使用 D1 時，先執行 `pnpm build`，再按順序套用 `drizzle/` 內的 SQL：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_same_alice.sql
```

`pnpm build` 產生可發佈的 Worker；`node --test tests/*.test.mjs` 驗證成績及身份檢查。D1 migration 在發佈時套用。ChatGPT 登入使用 Sites 提供的帳戶 ID；API 不接受匿名讀寫。

## Google 登入

可選用獨立 Firebase Authentication 專案，啟用 Google 登入方式，並在 Firebase Authentication 的授權網域加入網站主機名稱。為網站建立 Firebase Web App 後，把以下公開設定加入 Sites 的執行環境變數：

- `FIREBASE_PROJECT_ID`
- `FIREBASE_API_KEY`
- `FIREBASE_APP_ID`
- `FIREBASE_AUTH_DOMAIN`

四項齊備時，登入頁會顯示「使用 Google 登入」及原有 ChatGPT 選項。Google 登入使用彈出視窗；每次讀寫 D1 時，API 都驗證 Firebase ID token 的 Google 簽名、專案、簽發者、有效期及登入方式。Google 與 ChatGPT 帳戶使用不同資料空間，不會自動合併成績。未設定 Firebase 時，原有 ChatGPT 登入保持可用。

## Firebase Hosting 手機版

`pnpm build:mobile` 會建立獨立的靜態網站到 `firebase-dist/`。這個版本使用同一個 Firebase Authentication 專案登入，並把班別、考試和每位學生各自可讀的紀錄儲存在 Cloud Firestore，不依賴 Sites 的網域或 D1。它會在手機上以 Google 重新導向登入，桌面則使用彈出視窗。

首次發佈前，請在 Firebase 控制台啟用 Google 登入，建立 Standard 版 Firestore（正式版模式），確認 Firebase Hosting 的預設網域在 Authentication 授權網域內，並把 `lib/grade.ts` 與 `firestore.rules` 中的管理員電郵設成同一個 Google 帳戶。先在 Firebase 規則模擬器測試：未登入者拒絕讀取、學生只可讀與其電郵相同的 `student_views` 文件、管理員可讀寫 `grade_documents`。然後在專案根目錄執行：

```sh
pnpm build:mobile
firebase deploy --project grade-studio-hk --only hosting,firestore:rules
```

從舊網站按「下載 JSON 備份」，再以管理員登入新網站並按「匯入舊版 JSON 備份」。匯入成功後才通知學生使用新網址。`firebase-dist/` 及任何成績備份不得提交到公開 GitHub 儲存庫。
