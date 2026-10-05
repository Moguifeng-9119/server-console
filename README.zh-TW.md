# ServerConsole

找到顯存足夠的 GPU，查看使用者，直接進入終端與檔案管理。

[下載桌面版本](https://github.com/Moguifeng-9119/server-console/releases) · [English guide](README.md) · [中文指南](README.zh-CN.md)

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

![Resource workbench — simulated metrics](assets/screenshots/workbench-en.png)

截圖為 v0.11.0 原始碼與模擬資料。已發布安裝包可能較早；請確認版本與實際附件。

新版工作台優先維護英文與簡體中文，其餘新文字回退英文；尚非十種語言完整翻譯。

[Architecture](docs/ARCHITECTURE.md) · [Validation](docs/VALIDATION.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [MIT](LICENSE)

## Source demo

Node.js 22 / npm:

```sh
npm ci
npm run dev
# Desktop SSH / SFTP:
npm run electron:dev
```

Browser mode uses simulated data. Real connections require the desktop process and a Linux SSH host; GPU telemetry requires nvidia-smi. Platform package availability must be checked in the release attachments.
