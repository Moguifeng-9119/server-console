# ServerConsole

**找到顯存足夠的 GPU，確認使用者，在同一桌面開啟實驗、終端與檔案。**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[下載](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## 0.19.0 更新

- 持久化訓練 Run 串聯啟動命令、參數、結束碼、JSONL／文字指標、曲線與異常證據。首頁可切換「資源」和「實驗」；訓練指標保留 30 天並自動清理。

- GPU、系統與程序分層採集已接入實際排程。未知指標維持未知，保留時間戳與中斷區間；首頁固定每列四個 GPU 圓形儀表。

- 實驗工作區儲存伺服器、目錄、GPU、tmux、日誌與服務資訊；終端搜尋、分割版面與檔案捷徑保留操作情境。

- 任務退出碼與停止結果反映遠端實際執行；停止前核對程序啟動識別，防止 PID 重用誤殺。離線狀態同步至警示規則與手機摘要。

- 歷史提供 30 分鐘、1 小時、12 小時、1 天、1 週，以及多卡比較、磁碟與網路指標、匯出及事件標記。原始資料保留 24 小時，分鐘彙總保留 30 天並自動清理。

- 提供任務卡、增量訓練日誌、GPU 可用提醒、警示、容器與服務通道範本。Slurm 工作、詳情與日誌僅供讀取，需主機支援。

- 檔案同步先預覽變更與排除規則。儲存即上傳區分排隊、上傳、成功與失敗，完成後才更新成功時間。

- 診斷與不含憑據的設定備份協助復原及遷移。HTTPS Webhook 預設關閉；另行啟動的無介面採集器可在桌面關閉後保存歷史。

[0.19.0 release notes](docs/RELEASE-v0.19.0.md) · [Validation](docs/VALIDATION-0.19.0.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## 開始使用

從 Release 選擇實際附帶的安裝檔。Windows 未簽署，SmartScreen 可能警告；請比對該版本的 SHA-256。macOS/Linux 支援以工作流程及已上傳附件為準。

新增或匯入 SSH，確認主機指紋，再開啟首頁或工作台。GPU 需要遠端 nvidia-smi，系統指標讀取 Linux /proc。空閒顯存不代表預約或獨占。

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## 開發

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

瀏覽器是已標示的模擬展示；真實 SSH、終端與 SFTP 需要 Electron 桌面程序。

```sh
npm run electron:dev
```

React 18 · TypeScript · Electron · Vite · ssh2 · SQLite. [package.json](package.json) · [Architecture](docs/ARCHITECTURE.md)

```sh
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
npm run test:ui
npm run test:workflow
```

## 驗證與範圍

本版驗證記錄列出命令、結果與待驗項目。兩台真實 Linux 主機已驗證 GPU 流、三類採集、資源計數及退出碼 7 的專用任務；不代表大型叢集、100GB 傳輸、Slurm/MIG 或所有系統安裝均已驗證。

[Current validation ledger](docs/VALIDATION-0.19.0.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## 語言與指南

應用及 README 提供十種語言，機器輔助翻譯仍需母語審校；遠端輸出維持原語言。下方為舊版模擬截圖，不是目前效能證據。

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
