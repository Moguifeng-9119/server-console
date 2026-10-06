# ServerConsole

**找到顯存足夠的 GPU，看清使用者，從同一個桌面開啟監控、終端與檔案管理。**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[下載桌面版](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.12.2) · [回報問題](https://github.com/Moguifeng-9119/server-console/issues)

**0.12.2：**遠端命令失敗判斷、原生與介面語言保存、更新回應驗證及直傳金鑰清理已修正。兩台真實伺服器已通過 rsync、整個主程序強制終止後的恢復及 SHA-256 驗證。

**Windows 套件尚未簽署，SmartScreen 可能顯示警告。請核對 Release 的 SHA-256 檔案。**

![GPU 資源工作台：模擬資料](assets/screenshots/workbench-en.png)

**0.12.0 更新**

新增任務暫存檔持久記錄、崩潰恢復及重新連線清理；SHA-256 前綴驗證有獨立進度，舊任務提供明確說明。補齊檔案與互傳鍵盤操作、未儲存文字保護及 ESLint/Hooks。十語言各 678 個鍵，機器輔助初稿仍需完整母語審校。

0.12.2 已在兩台真實 Linux 伺服器驗證 16 MiB 上傳與 rsync、整個桌面主程序崩潰恢復、前綴進度及精確金鑰/目錄清理。下列 0.11.1 數字為歷史結果，最新範圍見 [0.12.2](docs/VALIDATION-0.12.2.md)。

![27-second simulated workflow](assets/demo/workflow.gif)

<p><img src="assets/screenshots/relay-en.png" alt="Simulated server relay" width="49%"> <img src="assets/screenshots/transfer-en.png" alt="Simulated resume verification" width="49%"></p>

截圖來自 v0.12.0，使用模擬資料。v0.12.0 提供 Windows x64 便攜版、Linux x86_64 AppImage、macOS 通用 DMG 和 SHA-256 校驗檔。套件未簽署，macOS 未公證；各系統驗證範圍見[最新紀錄](docs/VALIDATION-0.12.2.md)。

[Detailed usage and recovery (English)](docs/USER-GUIDE.md) · [简体中文](docs/USER-GUIDE.zh-CN.md)

## 適合解決什麼問題？

ServerConsole 是面向共用 **Linux / NVIDIA GPU 伺服器**的個人桌面工作台。透過 SSH 整合資源查詢、終端、雙欄 SFTP 和伺服器間傳輸，遠端不需要安裝監控代理程式。

- 依每張卡的空閒 GiB、型號及使用者篩選，按空閒最多優先排序，直接開啟監控、終端或檔案。
- 查看 GPU／程序指標、同一 PID 的多卡關聯、Linux CPU 時間差與實際採樣時刻。
- 傳輸佇列、已驗證的斷點續傳、跨重啟恢復、rsync 直傳或 SFTP 中繼。
- SSH config 匯入、群組、ProxyJump、快速指令、連接埠轉送、活躍／已恢復告警與最多兩則可關閉提示；示範模式不發外部異常通知。

目前沒有團隊帳號、資源預約、叢集排程、AMD/Intel GPU 遙測或完整 NVML 診斷。空閒顯存是觀測值，不代表可以獨占。

## 開始使用

從[發布頁](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.12.2)下載適用套件。在伺服器管理中測試連線後新增，或匯入 SSH config。GPU 指標需要遠端能執行 nvidia-smi；系統指標讀取 Linux /proc。從原始碼執行需要 Node.js 22 與 npm：

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

瀏覽器是明確標示模擬資料的示範。真實 SSH、憑據、終端與 SFTP 需要桌面程序：

```sh
npm run electron:dev
```

填入每張卡所需的空閒 GiB，選擇型號或搜尋使用者，再開啟監控、終端或檔案。設定分為外觀、監控、安全、工作流程及記錄與說明。Ctrl/Cmd+K 開啟指令面板；主要對話框支援 Tab、Shift+Tab、Escape 與焦點恢復。

## 傳輸與憑據

- 任意既有目標不會被當作斷點。上傳、下載與本機中繼使用任務專屬暫存檔，完整 SHA-256 前綴比對後才續傳。
- SFTP 檢查位元組數及來源大小／修改時間，再替換目標；衝突路徑排入佇列。失敗保留暫存以重試；取消或移除清理追蹤檔案，清理失敗則保留恢復紀錄並回報。
- 可選 MD5 在單檔上傳／下載替換前執行；目錄及中繼不宣稱已通過 MD5。
- 直傳需要兩端 rsync 與來源到目標可達，使用臨時 SSH 金鑰和已信任指紋；否則回退分階段 SFTP。已停用直接覆寫的 tar/scp 回退。
- 安全系統金鑰庫可用時加密密碼與私鑰口令；不可用或為 Linux basic_text 時，新憑據只留在記憶體，重啟後需重輸。安全設定顯示實際後端；私鑰留在原有路徑。

大小與修改時間不能鎖定並行改寫的來源。見 [安全說明](SECURITY.md)；真實雙伺服器 rsync 與崩潰清理已在隔離測試中通過。

## 已完成的驗證

v0.11.1 的 Windows、Linux、macOS CI 各通過 84 項回歸測試、SFTP 冒煙、型別檢查、建置與 22 項瀏覽器檢查。打包後的應用程式各通過 16 項原生檢查，涵蓋真實 IPC、本機 SSH shell、尺寸同步、轉送及認證重啟。Windows 驗證實際 DPAPI；macOS 自動化使用 MockKeychain，未驗證真實 Keychain；Linux 無安全金鑰庫時驗證僅限會話的策略。macOS 在 arm64 上執行，Intel 分支尚未執行。

實體 GPU/MIG、完整遠端 PTY、正式環境 rsync／網路吞吐、真實 macOS/Linux 金鑰庫、安裝器與更新仍需獨立驗證。本機 10／30 個模擬 SSH 會話基準不代表真實叢集效能或節省比例。詳見[驗證紀錄](docs/VALIDATION-0.11.1.md)與[基準方法](docs/BENCHMARKS.md)。

## 開發與建置

技術棧為 React、TypeScript、Electron、Vite 和 ssh2，確切版本見 [package.json](package.json)與鎖定檔。常用檢查：

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npx playwright-core install chromium
npm run test:ui
npm run test:workflow
npm run benchmark
```

將 SC_ELECTRON_PATH 指向目前解包執行檔，再執行 npm run e2e:terminal。建置命令為 dist:win:lite、dist:win:nsis、dist:linux、dist:mac；均關閉自動發布。[打包 CI](.github/workflows/package.yml)先驗證原生應用，再上傳未簽署構建。尚未配置 ESLint/Hooks 已設定，CI 執行 npm run lint。

## 語言與貢獻

README 和介面資源提供十語言，語言按需載入；全部非中英文文字的母語審校仍待完成。 [LOCALIZATION](docs/LOCALIZATION.md).

[架構](docs/ARCHITECTURE.md) · [貢獻指南](CONTRIBUTING.md) · [路線圖](docs/ROADMAP.md) · [變更紀錄](CHANGELOG.md) · [MIT 授權](LICENSE)
