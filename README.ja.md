# ServerConsole

**空き GPU メモリと利用者を確認し、同じデスクトップから実験・端末・ファイルを開けます。**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[ダウンロード](https://github.com/Moguifeng-9119/server-console/releases/latest) · [Issues](https://github.com/Moguifeng-9119/server-console/issues) · [Changelog](CHANGELOG.md)

![CI](https://github.com/Moguifeng-9119/server-console/actions/workflows/ci.yml/badge.svg)
![MIT](https://img.shields.io/badge/license-MIT-0891b2)

## 0.19.0 の更新

- 永続化された学習 Run にコマンド、パラメーター、終了コード、JSONL／テキストの指標、曲線と診断の根拠を保存します。ホームでリソースと実験を切り替えられます。学習指標は30日後に自動削除されます。

- GPU・システム・プロセスの段階的収集を実際のスケジューラーに接続。未取得値は不明のまま保持し、時刻と欠測を記録します。GPU メーターは各行4個です。

- 実験ワークスペースにサーバー、ディレクトリ、GPU、tmux、ログ、サービスを保存。端末検索、分割画面、ファイルへの移動で作業状況を保持します。

- タスク終了コードと停止結果を実際の処理に合わせ、プロセス開始識別子で PID 再利用を確認。オフライン状態を通知ルールとモバイル要約へ反映します。

- 履歴は30分・1時間・12時間・1日・1週間。GPU 比較、ディスク・ネットワーク、エクスポート、イベント表示に対応。生データ24時間、分集計30日で自動削除します。

- タスク、増分学習ログ、GPU 空き通知、ルール、コンテナー、サービス転送を利用できます。Slurm はジョブ・詳細・ログの読み取り専用で、ホストの対応が必要です。

- 同期の変更と除外を適用前に確認。保存時アップロードは待機・転送中・成功・失敗を区別し、完了後に成功時刻を更新します。

- 診断と認証情報を含まない設定バックアップで移行を支援。HTTPS Webhook は初期無効。別途起動するヘッドレス収集器はデスクトップ終了後も履歴を保存します。

[0.19.0 release notes](docs/RELEASE-v0.19.0.md) · [Validation](docs/VALIDATION-0.19.0.md) · [Workspaces / tools guide](docs/WORKBENCH-GUIDE.md)

## はじめに

Release に添付されたパッケージを選択。Windows は未署名で SmartScreen 警告が出る場合があります。同じリリースの SHA-256 を確認してください。macOS/Linux は実際のワークフローと公開成果物で判断します。

SSH 接続を追加・読み込みし、指紋を確認して概要またはワークベンチを開きます。GPU は nvidia-smi、システムは Linux /proc が必要。空きメモリは予約ではありません。

[Detailed usage and recovery](docs/USER-GUIDE.md) · [Security](SECURITY.md) · [Headless collector](docs/HEADLESS-MONITOR.md)

## 開発

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

ブラウザーは明示された模擬デモです。実 SSH、端末、SFTP は Electron デスクトップで動作します。

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

## 検証範囲

最新台帳にコマンド、結果、未検証項目を記録。実 Linux 2台で GPU ストリーム、3収集層、資源カウンター、終了コード7の専用タスクを確認しました。大規模運用、100GB 転送、Slurm/MIG、全 OS インストーラーの保証ではありません。

[Current validation ledger](docs/VALIDATION-0.19.0.md) · [Packaging workflow](.github/workflows/package.yml) · [Benchmark methodology](docs/BENCHMARKS.md)

## 言語とガイド

アプリと README は10言語。機械支援翻訳は母語確認が必要です。リモート出力は原語のまま。以下は旧版の模擬画像です。

![GPU overview — historical simulated example](assets/screenshots/gpu-even-0.13.1-en.png)

[Localization](docs/LOCALIZATION.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
