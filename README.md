# 數據分析實戰線上互動遊戲 (Data Analysis Interactive Quiz Game)

一套專為數據分析新手設計的課堂互動教學系統，支援 30 人實體課堂或線上即時互動。

## 🌟 核心特色

1. **雙螢幕延伸架構**：
   - **教師主控台 (`console.html`)**：主螢幕操作，具備 120 題題庫篩選抽題、預覽答案與解析、計時控制與個人/小組模式切換。
   - **題目投影大畫面 (`projector.html`)**：延伸投影螢幕，**支援 16:9 與 4:3 滿版自適應與自動切換**，高對比大字體、Python 代碼高亮、作答長條圖統計。
   - **學員手機端 (`play.html`)**：手機直式介面，支援個人學號登入或「第 1 至 6 組組長代表作答（C 方案）」，具備極簡四色大按鈕與搶答大蜂鳴器。
2. **四大分析模組題庫 (共 120 題)**：
   - 模組一：數據抓取 (30 題)
   - 模組二：資料清理 (30 題)
   - 模組三：資料視覺化 (30 題)
   - 模組四：分析流程與思維 (30 題)
3. **雙模即時同步機制 (`sync-channel.js`)**：
   - **本地模式**：透過 HTML5 `BroadcastChannel`，同台電腦多開分頁（延伸螢幕）**零設定、免連網、零延遲即時同步**。
   - **雲端模式**：整合 Firebase Realtime Database，支援跨網際網路 30 支手機即時連線搶答。

---

## 🚀 GitHub Pages 部署步驟

本專案為純靜態前端架構，可直接發布至 GitHub Pages：

### 方式一：Git 命令列推送
```bash
# 1. 在 GitHub 上新建一個公開 (Public) 儲存庫，名稱如 data-analysis-game
# 2. 在本機專案目錄內執行：
git remote add origin https://github.com/<您的GitHub帳號>/data-analysis-game.git
git branch -M main
git push -u origin main
```

### 方式二：GitHub 網頁端直接上傳
1. 登入 GitHub，點擊 **New repository** 建立新儲存庫（如 `data-analysis-game`）。
2. 點擊 **uploading an existing file**，將本專案目錄下的所有檔案（`index.html`, `console.html`, `projector.html`, `play.html`, `questions.json`, `sync-channel.js`）拖曳上傳並 Commit。
3. 進入儲存庫的 **Settings** -> **Pages**：
   - **Source** 選擇 `Deploy from a branch`
   - **Branch** 選擇 `main` / `root`，點擊 **Save**。
4. 約 1~2 分鐘後，即可透過 `https://<您的GitHub帳號>.github.io/data-analysis-game/` 於全班手機與教室投影機開啟使用！

---

## 📂 檔案目錄結構

```text
├── index.html        # 系統入口導覽頁
├── console.html      # 教師端出題與抽題主控台
├── projector.html    # 題目投影大螢幕 (16:9 / 4:3 自適應)
├── play.html         # 學員手機作答端
├── sync-channel.js   # 雙向即時通訊中繼器 (BroadcastChannel / Firebase)
├── questions.json    # 120 題完整結構化題庫
└── README.md         # 專案說明與部署指南
```
