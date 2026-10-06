# ServerConsole

**必要な空き GPU メモリを探し、利用者を確認し、同じデスクトップから監視・ターミナル・ファイル管理を開けます。**

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Português (Brasil)](README.pt-BR.md)

[デスクトップ版をダウンロード](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.11.1) · [問題を報告](https://github.com/Moguifeng-9119/server-console/issues)

![GPU リソース画面：模擬データ](assets/screenshots/workbench-en.png)

画像は v0.11.0 の模擬データです。v0.11.1 は Windows x64 ポータブル版、Linux x86_64 AppImage、macOS ユニバーサル DMG と SHA-256 ファイルを提供します。パッケージは未署名、macOS は未公証です。[検証記録](docs/VALIDATION-0.11.1.md)に対象範囲を示しています。

## できること

ServerConsole は共有 **Linux / NVIDIA GPU サーバー**を使う個人向けデスクトップツールです。SSH を介してリソース検索、ターミナル、2 ペイン SFTP、サーバー間転送をまとめます。リモートに監視エージェントを導入する必要はありません。

- GPU ごとの空き GiB、モデル、利用者で絞り込み、空きの多い順に表示。監視・ターミナル・ファイルを直接開く。
- GPU とプロセス、同じ PID の複数 GPU、Linux CPU 時間カウンター、実際の取得時刻を確認。
- 転送キュー、検証付き再開、再起動後の復元、rsync 直接転送または SFTP 中継。
- SSH config 読み込み、グループ、ProxyJump、コマンド、ポート転送、発生中・復旧済みの通知。閉じられるトーストは最大 2 件で、デモでは外部に異常通知しません。

チームアカウント、GPU 予約、クラスタースケジューラー、AMD/Intel GPU、完全な NVML 診断は提供していません。空きメモリは観測値で、予約や占有権を意味しません。

## はじめに

[リリース](https://github.com/Moguifeng-9119/server-console/releases/tag/v0.11.1)から対象 OS のファイルを取得します。サーバー管理で接続を試して追加するか、SSH config を読み込みます。GPU 指標にはリモートの nvidia-smi、システム指標には Linux /proc が必要です。ソースからの起動には Node.js 22 と npm を使います。

```sh
git clone https://github.com/Moguifeng-9119/server-console.git
cd server-console
npm ci
npm run dev
```

ブラウザーは模擬データのデモです。実際の SSH、認証情報、ターミナル、SFTP にはデスクトッププロセスを起動します。

```sh
npm run electron:dev
```

GPU 1 枚に必要な空き GiB を指定し、モデルや利用者を選んで監視・ターミナル・ファイルを開きます。設定は外観、監視、安全、作業、記録・ヘルプに分類されています。Ctrl/Cmd+K はコマンドパレット、主要ダイアログは Tab、Shift+Tab、Escape とフォーカス復元に対応します。

## 転送と認証情報

- 既存の任意の転送先を再開用データとして扱いません。アップロード、ダウンロード、ローカル中継はタスク専用の一時ファイルを使い、SHA-256 で既存部分全体を比較して再開します。
- SFTP はバイト数と送信元のサイズ・更新時刻を確認してから転送先を置換し、重なるパスを直列化します。失敗時は再試行用データを保持し、取消・削除時の清掃に失敗すると復元記録を保持してエラーを表示します。
- 任意の MD5 検証は単一ファイルの置換前に実施。ディレクトリや中継を MD5 検証済みとは表示しません。
- 直接転送には両側の rsync と送信元から転送先への接続が必要です。一時 SSH 鍵と信頼済み指紋を使い、利用できなければ段階的 SFTP 中継に切り替えます。直接上書きする tar/scp の代替経路は無効です。
- 安全な OS キーストアが使える場合にパスワードとパスフレーズを暗号化します。利用不可または Linux basic_text の場合、新しい認証情報はセッション内だけに保持し、再起動後に再入力します。安全設定は実際の保存方式を表示し、秘密鍵は元のパスに残します。

[安全性と制限](SECURITY.md)も確認してください。サイズ・更新時刻の検査は変更中の送信元をロックしません。実サーバー間の rsync は未検証です。

## 検証済みの範囲

v0.11.1 は Windows・Linux・macOS でそれぞれ型検査、84 件の回帰テスト、SFTP スモーク、ビルド、22 件のブラウザー検査を通過しました。パッケージ化したアプリは各 OS で 16 件のネイティブ検査に通過：実 IPC、ローカル SSH shell、サイズ変更、転送、認証付き再起動を確認。Windows DPAPI は実測済み；macOS 自動化は MockKeychain を使用し、実 Keychain は未検証です。Linux CI はキーストアがない場合のセッション限定保存を確認します。macOS の実行は arm64 で、Intel は未実行です。

実 GPU/MIG、実リモート PTY、運用環境での rsync とネットワーク性能、実 macOS/Linux キーストア、インストーラー・更新は別途検証が必要です。ベンチマークはローカルの模擬 SSH 10/30 セッションで、実クラスター性能や削減率を保証しません。[検証](docs/VALIDATION-0.11.1.md)・[測定方法](docs/BENCHMARKS.md)を参照してください。

## 開発とビルド

React、TypeScript、Electron、Vite、ssh2 の正確な版は [package.json](package.json)とロックファイルに記載しています。検査コマンド：

```sh
npm run typecheck
npm test
npm run smoke
npm run build
npx playwright-core install chromium
npm run test:ui
npm run benchmark
```

SC_ELECTRON_PATH に現在の展開済み実行ファイルを指定し、npm run e2e:terminal で検査できます。dist:win:lite、dist:win:nsis、dist:linux、dist:mac は自動公開を無効にしています。[パッケージ CI](.github/workflows/package.yml)はネイティブ検査後に未署名の成果物をアップロードします。ESLint/Hooks lint は未設定です。

## 言語と貢献

README の利用ガイドは 10 言語に対応しています。アプリ画面の翻訳は別で、新画面は英語と簡体字中国語を中心に保守しています。未翻訳の新しい文言は英語にフォールバックし、古い画面には中国語の固定文字列が残ります。[翻訳状況](docs/LOCALIZATION.md)を参照してください。

[構成](docs/ARCHITECTURE.md) · [貢献ガイド](CONTRIBUTING.md) · [ロードマップ](docs/ROADMAP.md) · [変更履歴](CHANGELOG.md) · [MIT ライセンス](LICENSE)
