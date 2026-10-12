// 生成 10 语言 README 文件 + 更新全部语言导航链接
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

const LANGS = [
  { code: 'en', file: 'README.md', name: 'English' },
  { code: 'zh-CN', file: 'README.zh-CN.md', name: '简体中文' },
  { code: 'zh-TW', file: 'README.zh-TW.md', name: '繁體中文' },
  { code: 'ja', file: 'README.ja.md', name: '日本語' },
  { code: 'ko', file: 'README.ko.md', name: '한국어' },
  { code: 'es', file: 'README.es.md', name: 'Español' },
  { code: 'fr', file: 'README.fr.md', name: 'Français' },
  { code: 'de', file: 'README.de.md', name: 'Deutsch' },
  { code: 'ru', file: 'README.ru.md', name: 'Русский' },
  { code: 'pt-BR', file: 'README.pt-BR.md', name: 'Português (Brasil)' },
];

// 生成导航链接行
function navLinks(activeCode) {
  return LANGS.map((l) =>
    l.code === activeCode ? l.name : `[${l.name}](./${l.file})`
  ).join(' | ');
}

// ===== 1. 更新已有 README.md 和 README.zh-CN.md 的导航链接 =====
for (const f of ['README.md', 'README.zh-CN.md']) {
  let content = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const activeCode = f === 'README.md' ? 'en' : 'zh-CN';
  const start = content.indexOf('[English]');
  const end = content.indexOf('\n', content.indexOf('Português'));
  if (start >= 0 && end >= 0) {
    content = content.slice(0, start) + navLinks(activeCode) + content.slice(end);
    fs.writeFileSync(path.join(ROOT, f), content);
    console.log(f + ' nav links updated');
  } else {
    console.log(f + ' nav anchor not found (may already be updated)');
  }
}

// ===== 2. 各语言内容翻译 =====

// 翻译表：每个语言的核心文案
const T = {
  'zh-TW': {
    tagline: '一台桌面管理您的 GPU 機群，瀏覽檔案，並以全速在伺服器之間**傳輸資料**——全程 SSH，完全本地。',
    desc: '**ServerConsole** 是一款本地優先的桌面應用，將多台 Linux/GPU 伺服器集中管理：\n即時 GPU 與程序監控、雙面板 SFTP 檔案管理員、上傳/下載，以及\n**高速伺服器間直接傳輸**——基於 Electron、React 和 [`ssh2`](https://github.com/mscdex/ssh2) 構建。\n無雲端、無資料中轉：所有連線都從您的本機直接發起。',
    toc: '目錄', highlights: '✨ 亮點', tech: '🧱 技術棧', getting: '🚀 快速開始', build: '🏗️ 構建打包', usage: '🧭 使用',
    how: '🏛️ 工作原理', security: '🔐 安全與隱私', data: '📁 資料儲存', dev: '🧪 開發與測試', limitations: '⚠️ 已知限制',
    contributing: '🤝 參與貢獻', license: '📄 許可證',
    mgmt: '🧩 多伺服器管理', sshimport: '🔑 一鍵匯入 `~/.ssh/config`', toolkit: '🧰 營運工具箱',
    monitoring: '📊 即時 GPU / 程序監控', sftp: '🗂️ 雙面板 SFTP 檔案管理員', direct: '⚡ 伺服器間直接傳輸',
    transferCenter: '🚦 傳輸中心抽屜', ui: '🎛️ 現代簡約 UI',
    requirements: '需求：', usageSteps: '1. **新增伺服器**——填入主機/連接埠/使用者，選擇密碼或金鑰認證，可先*測試連線*，再儲存。或點擊**從 `~/.ssh/config` 一鍵匯入**。\n2. 在側欄選擇節點，進入**概要 / GPU / 程序 / 檔案**標籤頁。\n3. 在**檔案**頁雙面板間上傳下載，或勾選遠端項目 → **伺服器互傳 ⇄** 並選擇目標伺服器與目錄。\n4. 頂欄**傳輸**按鈕隨時查看即時速度、檔案進度與佇列管理。',
    securityBody: '- **主機指紋驗證（TOFU）**：首次連線記錄主機公鑰指紋，之後每次連線比對，不一致即拒絕並明確告警。\n- 直傳金鑰**一次性、用後即焚**；主私鑰絕不被複製或上傳。\n- 中繼**只複製不刪除**；重試從斷點續傳。\n- 破壞性操作需確認，並寫入**持久化稽核日誌**。\n- 密碼使用作業系統 safeStorage 加密。\n- 所有指標與進度都來自真實命令回應——**不偽造溫度、速度或進度**。',
    dataBody: '所有本地資料都在系統使用者資料目錄（Windows 為 `%AppData%/server-console/`）。\n刪除該目錄即可完全重置。',
    contributingBody: '歡迎 Issue 與 PR。提交 PR 前請執行 `npm run build`，並且絕不能提交真實主機、憑證或金鑰。',
    licenseBody: '基於 **[MIT License](./LICENSE)** 發布。',
    footer: '為管理大量 GPU 伺服器的工程師而生——傳輸要快，資料要真，操作要穩。',
  },
  'ja': {
    tagline: 'GPU フリートを1つのデスクトップで監視、ファイル閲覧、サーバー間で**フルスピードのデータ転送**——すべてSSH経由、完全ローカル。',
    desc: '**ServerConsole** は、複数の Linux/GPU サーバーを一元管理するローカルファーストのデスクトップアプリです：\nリアルタイム GPU & プロセス監視、デュアルペイン SFTP ファイルマネージャー、アップ/ダウンロード、\n**高速サーバー間直接転送**——Electron、React、[`ssh2`](https://github.com/mscdex/ssh2) で構築。\nクラウドなし、データの中継なし：すべての接続はローカルマシンから直接行われます。',
    toc: '目次', highlights: '✨ ハイライト', tech: '🧱 技術スタック', getting: '🚀 はじめに', build: '🏗️ ビルド＆パッケージ', usage: '🧭 使い方',
    how: '🏛️ アーキテクチャ', security: '🔐 セキュリティとプライバシー', data: '📁 データ保存', dev: '🧪 開発とテスト', limitations: '⚠️ 既知の制限',
    contributing: '🤝 コントリビューション', license: '📄 ライセンス',
    mgmt: '🧩 マルチサーバー管理', sshimport: '🔑 `~/.ssh/config` ワンクリックインポート', toolkit: '🧰 運用ツールキット',
    monitoring: '📊 リアルタイム GPU / プロセス監視', sftp: '🗂️ デュアルペイン SFTP ファイルマネージャー', direct: '⚡ サーバー間直接転送',
    transferCenter: '🚦 転送センタードロワー', ui: '🎛️ モダンで静かな UI',
    requirements: '要件：', usageSteps: '1. **サーバーを追加**——ホスト/ポート/ユーザー名を入力し、パスワードまたは鍵認証を選択、*接続テスト*を実行して保存。または **`~/.ssh/config` からインポート**をクリック。\n2. サイドバーでノードを選択し、**概要 / GPU / プロセス / ファイル**タブを開きます。\n3. **ファイル**タブで2つのペイン間でアップ/ダウンロード、またはリモート項目を選択 → **サーバー間転送 ⇄** で宛先サーバーとフォルダを選択。\n4. 上部バーの**転送**ボタンでリアルタイム速度、ファイル進捗、キュー管理を確認。',
    securityBody: '- **ホスト鍵検証（TOFU）**：初回接続時にサーバーのホスト鍵フィンガープリントを記録し、以降の接続で照合、不一致なら明確な警告とともに拒否。\n- 直接転送キーは**使い捨て**；メイン秘密鍵はコピー・アップロードされません。\n- リレーは**コピーのみ**；リトライはブレークポイントから再開。\n- 破壊的操作は確認が必要で、**永続的なローカル監査ログ**に記録されます。\n- パスワードは OS の safeStorage で暗号化されます。\n- すべてのメトリクスと進捗は実際のコマンド応答から取得——**温度・速度・進捗の捏造はありません**。',
    dataBody: 'すべてのローカルデータは OS のユーザーデータディレクトリ（Windows では `%AppData%/server-console/`）に保存されます。\nこのフォルダを削除するとすべてのローカル状態がリセットされます。',
    contributingBody: 'Issue と PR を歓迎します。PR を開く前に `npm run build` を実行し、実際のホスト、認証情報、鍵をコミットしないでください。',
    licenseBody: '**[MIT License](./LICENSE)** の下で配布されています。',
    footer: '多くの GPU サーバーを管理するエンジニアのために——転送は速く、データは正直に、操作は安全に。',
  },
  'ko': {
    tagline: 'GPU 플릿을 하나의 데스크톱에서 모니터링, 파일 탐색, 서버 간 **전속력 데이터 전송** — 모두 SSH, 완전 로컬.',
    desc: '**ServerConsole** 는 여러 Linux/GPU 서버를 중앙 집중화하는 로컬 우선 데스크톱 앱입니다:\n실시간 GPU & 프로세스 모니터링, 듀얼 페인 SFTP 파일 관리자, 업/다운로드,\n**고속 서버 간 직접 전송** — Electron, React, [`ssh2`](https://github.com/mscdex/ssh2) 로 구축.\n클라우드 없음, 데이터 릴레이 없음: 모든 연결은 로컬 머신에서 직접 실행됩니다.',
    toc: '목차', highlights: '✨ 하이라이트', tech: '🧱 기술 스택', getting: '🚀 시작하기', build: '🏗️ 빌드 & 패키징', usage: '🧭 사용법',
    how: '🏛️ 작동 방식', security: '🔐 보안 및 개인정보', data: '📁 데이터 저장', dev: '🧪 개발 및 테스트', limitations: '⚠️ 알려진 제한사항',
    contributing: '🤝 기여하기', license: '📄 라이선스',
    mgmt: '🧩 멀티 서버 관리', sshimport: '🔑 `~/.ssh/config` 원클릭 가져오기', toolkit: '🧰 운영 도구 키트',
    monitoring: '📊 실시간 GPU / 프로세스 모니터링', sftp: '🗂️ 듀얼 페인 SFTP 파일 관리자', direct: '⚡ 서버 간 직접 전송',
    transferCenter: '🚦 전송 센터 드로어', ui: '🎛️ 모던하고 차분한 UI',
    requirements: '요구사항:', usageSteps: '1. **서버 추가** — 호스트/포트/사용자를 입력하고 비밀번호 또는 키 인증을 선택, *연결 테스트* 후 저장. 또는 **`~/.ssh/config`에서 가져오기** 클릭.\n2. 사이드바에서 노드를 선택하여 **개요 / GPU / 프로세스 / 파일** 탭을 엽니다.\n3. **파일** 탭에서 두 패인 간 업/다운로드, 또는 원격 항목 선택 → **서버 릴레이 ⇄** 로 대상 서버 및 폴더 선택.\n4. 상단 바의 **전송** 버튼으로 실시간 속도, 파일 진행률, 큐 관리를 확인.',
    securityBody: '- **호스트 키 검증 (TOFU)**: 첫 연결 시 서버의 호스트 키 지문을 기록하고, 이후 모든 연결에서 대조, 불일치 시 명확한 경고와 함께 거부.\n- 직접 전송 키는 **일회용이며 사용 후 파기**; 메인 개인 키는 복사되거나 업로드되지 않습니다.\n- 릴레이는 **복사 전용** — 원본 데이터는 삭제되지 않음; 재시도는 브레이크포인트에서 재개.\n- 파괴적 작업(프로세스 종료, 파일 삭제)은 확인이 필요하며 **영구 로컬 감사 로그**에 기록됩니다.\n- 비밀번호는 OS safeStorage로 암호화됩니다.\n- 모든 메트릭과 진행률은 실제 명령 응답에서 가져옴 — **온도, 속도, 진행률을 조작하지 않습니다**.',
    dataBody: '모든 로컬 데이터는 OS 사용자 데이터 디렉터리(Windows: `%AppData%/server-console/`)에 저장됩니다.\n해당 폴더를 삭제하면 모든 로컬 상태가 초기화됩니다.',
    contributingBody: 'Issue와 PR을 환영합니다. PR을 열기 전에 `npm run build`(엄격 타입 체크)를 실행하고, 실제 호스트, 자격 증명 또는 키를 커밋하지 마세요.',
    licenseBody: '**[MIT License](./LICENSE)** 하에 배포됩니다.',
    footer: '많은 GPU 서버를 관리하는 엔지니어를 위해 — 전송은 빠르게, 데이터는 정직하게, 작업은 안전하게.',
  },
  'es': {
    tagline: 'Un escritorio para monitorear tu flota de GPUs, navegar archivos y mover datos **entre servidores a máxima velocidad** — todo por SSH, completamente local.',
    desc: '**ServerConsole** es una app de escritorio local-first que centraliza múltiples servidores Linux/GPU:\nmonitoreo en vivo de GPU y procesos, un administrador de archivos SFTP de doble panel, subidas/descargas, y\n**transferencia directa de alta velocidad entre servidores** — construido con Electron, React y [`ssh2`](https://github.com/mscdex/ssh2).\nSin nube, sin relé de datos: cada conexión corre directamente desde tu máquina.',
    toc: 'Índice', highlights: '✨ Destacados', tech: '🧱 Stack tecnológico', getting: '🚀 Primeros pasos', build: '🏗️ Compilar y empaquetar', usage: '🧭 Uso',
    how: '🏛️ Cómo funciona', security: '🔐 Seguridad y privacidad', data: '📁 Almacenamiento de datos', dev: '🧪 Desarrollo', limitations: '⚠️ Limitaciones',
    contributing: '🤝 Contribuir', license: '📄 Licencia',
    mgmt: '🧩 Gestión multi-servidor', sshimport: '🔑 Importación con un clic de `~/.ssh/config`', toolkit: '🧰 Caja de herramientas de operaciones',
    monitoring: '📊 Monitoreo real de GPU y procesos', sftp: '🗂️ Administrador de archivos SFTP de doble panel', direct: '⚡ Transferencia directa entre servidores',
    transferCenter: '🚦 Panel de centro de transferencias', ui: '🎛️ Interfaz moderna y serena',
    requirements: 'Requisitos:', usageSteps: '1. **Agregar un servidor** — ingresa host/puerto/usuario, elige autenticación por contraseña o clave, opcionalmente *Probar conexión*, luego guarda. O haz clic en **Importar de `~/.ssh/config`**.\n2. Selecciona un nodo en la barra lateral para abrir sus pestañas **Resumen / GPU / Procesos / Archivos**.\n3. En **Archivos**, sube/descarga entre los dos paneles, o selecciona elementos remotos → **Relé entre servidores ⇄** y elige el servidor y carpeta de destino en el diálogo de doble panel.\n4. Abre el botón **Transferencias** de la barra superior en cualquier momento para velocidad en vivo, progreso de archivos y gestión de cola.',
    securityBody: '- **Verificación de clave de host (TOFU)**: la primera conexión registra la huella digital del servidor; cada conexión posterior se verifica contra ella y una discrepancia se rechaza con una advertencia clara.\n- Las claves de transferencia directa son **efímeras y destruidas después de usar**; la clave privada principal nunca se copia ni sube.\n- El relé es **solo copia** — los datos de origen nunca se eliminan; **reintentar reanuda desde el punto de interrupción**.\n- Las acciones destructivas requieren confirmación y se registran en un **registro de auditoría local persistente**.\n- Las contraseñas se cifran con el safe-storage del SO; solo se almacena la *ruta* de una clave privada, nunca su contenido.\n- Cada métrica y valor de progreso proviene de una respuesta real de comando — **sin inventar temperatura, velocidad ni progreso por archivo**.',
    dataBody: 'Todos los datos locales viven en el directorio de datos del usuario del SO (`%AppData%/server-console/` en Windows).\nElimina esa carpeta para borrar todo el estado local.',
    contributingBody: 'Issues y PRs son bienvenidos. Por favor ejecuta `npm run build` (type-check estricto) antes de abrir un PR, y nunca commite hosts reales, credenciales o claves.',
    licenseBody: 'Distribuido bajo la **[MIT License](./LICENSE)**.',
    footer: 'Construido para ingenieros que administran muchos servidores GPU y quieren que las transferencias sean rápidas, honestas y seguras.',
  },
  'fr': {
    tagline: 'Un bureau pour surveiller votre parc de GPUs, parcourir les fichiers et déplacer des données **entre serveurs à pleine vitesse** — tout en SSH, entièrement local.',
    desc: '**ServerConsole** est une application de bureau local-first qui centralise plusieurs serveurs Linux/GPU :\nsurveillance GPU et processus en temps réel, gestionnaire de fichiers SFTP à double panneau, envois/réceptions, et\n**transfert direct haute vitesse entre serveurs** — construit avec Electron, React et [`ssh2`](https://github.com/mscdex/ssh2).\nPas de cloud, pas de relais de données : chaque connexion part directement de votre machine.',
    toc: 'Sommaire', highlights: '✨ Points forts', tech: '🧱 Stack technique', getting: '🚀 Démarrage', build: '🏗️ Build & Package', usage: '🧭 Utilisation',
    how: '🏛️ Fonctionnement', security: '🔐 Sécurité et confidentialité', data: '📁 Stockage des données', dev: '🧪 Développement', limitations: '⚠️ Limitations',
    contributing: '🤝 Contribuer', license: '📄 Licence',
    mgmt: '🧩 Gestion multi-serveurs', sshimport: '🔑 Import en un clic depuis `~/.ssh/config`', toolkit: '🧰 Boîte à outils opérations',
    monitoring: '📊 Surveillance GPU et processus en temps réel', sftp: '🗂️ Gestionnaire de fichiers SFTP double panneau', direct: '⚡ Transfert direct entre serveurs',
    transferCenter: '🚦 Tiroir centre de transfert', ui: '🎛️ Interface moderne et apaisée',
    requirements: 'Prérequis :', usageSteps: '1. **Ajouter un serveur** — saisissez hôte/port/utilisateur, choisissez auth par mot de passe ou clé, optionnellement *Tester la connexion*, puis enregistrez. Ou cliquez sur **Importer depuis `~/.ssh/config`**.\n2. Sélectionnez un nœud dans la barre latérale pour ouvrir ses onglets **Vue d\'ensemble / GPU / Processus / Fichiers**.\n3. Dans **Fichiers**, envoyez/recevez entre les deux panneaux, ou sélectionnez des éléments distants → **Relais entre serveurs ⇄** et choisissez le serveur et dossier de destination.\n4. Ouvrez le bouton **Transferts** de la barre supérieure à tout moment pour la vitesse en direct, la progression des fichiers et la gestion de la file.',
    securityBody: '- **Vérification de la clé d\'hôte (TOFU)** : la première connexion enregistre l\'empreinte du serveur ; chaque connexion suivante est vérifiée et toute divergence est rejetée avec un avertissement clair.\n- Les clés de transfert direct sont **éphémères et détruites après usage** ; la clé privée principale n\'est jamais copiée ni envoyée.\n- Le relais est **copie uniquement** — les données source ne sont jamais supprimées ; **le retry reprend du point d\'interruption**.\n- Les actions destructives nécessitent une confirmation et sont consignées dans un **journal d\'audit local persistant**.\n- Les mots de passe sont chiffrés avec le safe-storage de l\'OS ; seul le *chemin* d\'une clé privée est stocké, jamais son contenu.\n- Chaque métrique et valeur de progression provient d\'une vraie réponse de commande — **aucune température, vitesse ou progression par fichier inventée**.',
    dataBody: 'Toutes les données locales résident dans le répertoire de données utilisateur du système (`%AppData%/server-console/` sous Windows).\nSupprimez ce dossier pour réinitialiser tout l\'état local.',
    contributingBody: 'Issues et PRs bienvenues. Veuillez exécuter `npm run build` (type-check strict) avant d\'ouvrir une PR, et ne jamais committer de vrais hôtes, identifiants ou clés.',
    licenseBody: 'Distribué sous **[MIT License](./LICENSE)**.',
    footer: 'Conçu pour les ingénieurs qui gèrent de nombreux serveurs GPU et veulent des transferts rapides, honnêtes et sûrs.',
  },
  'de': {
    tagline: 'Ein Desktop für Ihre GPU-Flotte: überwachen, Dateien durchsuchen und Daten **zwischen Servern mit voller Geschwindigkeit** verschieben — alles über SSH, vollständig lokal.',
    desc: '**ServerConsole** ist eine Local-First-Desktop-App, die mehrere Linux/GPU-Server zentralisiert:\nLive-GPU- und Prozessüberwachung, einen Dual-Pane-SFTP-Dateimanager, Uploads/Downloads und\n**hochgeschwindigkeits-Direktübertragung zwischen Servern** — gebaut mit Electron, React und [`ssh2`](https://github.com/mscdex/ssh2).\nKeine Cloud, kein Datenrelay: Jede Verbindung läuft direkt von Ihrem Rechner.',
    toc: 'Inhaltsverzeichnis', highlights: '✨ Highlights', tech: '🧱 Tech-Stack', getting: '🚀 Erste Schritte', build: '🏗️ Build & Paketierung', usage: '🧭 Verwendung',
    how: '🏛️ Funktionsweise', security: '🔐 Sicherheit & Datenschutz', data: '📁 Datenspeicherung', dev: '🧪 Entwicklung', limitations: '⚠️ Einschränkungen',
    contributing: '🤝 Mitwirken', license: '📄 Lizenz',
    mgmt: '🧩 Multi-Server-Verwaltung', sshimport: '🔑 One-Click-Import aus `~/.ssh/config`', toolkit: '🧰 Ops-Werkzeugkasten',
    monitoring: '📊 Echte GPU- und Prozessüberwachung', sftp: '🗂️ Dual-Pane-SFTP-Dateimanager', direct: '⚡ Server-zu-Server-Direktübertragung',
    transferCenter: '🚦 Transfercenter-Drawer', ui: '🎛️ Moderne, ruhige Benutzeroberfläche',
    requirements: 'Voraussetzungen:', usageSteps: '1. **Server hinzufügen** — Host/Port/Benutzer eingeben, Passwort- oder Schlüsselauth wählen, optional *Verbindung testen*, dann speichern. Oder auf **Aus `~/.ssh/config` importieren** klicken.\n2. Wählen Sie einen Knoten in der Seitenleiste, um die Tabs **Übersicht / GPU / Prozesse / Dateien** zu öffnen.\n3. In **Dateien** zwischen den beiden Fenstern hoch-/herunterladen, oder entfernte Elemente auswählen → **Server-Relay ⇄** und Zielserver und -ordner im Dialog wählen.\n4. Öffnen Sie die Schaltfläche **Übertragungen** in der oberen Leiste jederzeit für Live-Geschwindigkeit, Dateifortschritt und Warteschlangenverwaltung.',
    securityBody: '- **Host-Key-Verifizierung (TOFU)**: Die erste Verbindung speichert den Fingerabdruck; jede spätere Verbindung wird abgeglichen und bei Abweichung mit klarer Warnung abgelehnt.\n- Direktübertragungsschlüssel sind **flüchtig und werden nach Gebrauch vernichtet**; der private Hauptschlüssel wird nie kopiert oder hochgeladen.\n- Relay ist **nur Kopie** — Quelldaten werden nie gelöscht; **Wiederholung setzt vom Haltepunkt fort**.\n- Destruktive Aktionen erfordern Bestätigung und werden in ein **persistentes lokales Auditprotokoll** geschrieben.\n- Passwörter werden mit dem OS safeStorage verschlüsselt; nur der *Pfad* eines privaten Schlüssels wird gespeichert, nie sein Inhalt.\n- Jede Metrik und jeder Fortschrittswert stammt aus einer echten Befehlsantwort — **keine erfundene Temperatur, Geschwindigkeit oder Dateifortschritt**.',
    dataBody: 'Alle lokalen Daten befinden sich im Benutzerdatenverzeichnis des OS (`%AppData%/server-console/` unter Windows).\nLöschen Sie diesen Ordner, um den gesamten lokalen Zustand zurückzusetzen.',
    contributingBody: 'Issues und PRs sind willkommen. Bitte führen Sie `npm run build` (strenge Typprüfung) vor dem Öffnen eines PRs aus und committen Sie niemals echte Hosts, Zugangsdaten oder Schlüssel.',
    licenseBody: 'Vertrieben unter der **[MIT License](./LICENSE)**.',
    footer: 'Gebaut für Ingenieure, die viele GPU-Server verwalten und Übertragungen wollen, die schnell, ehrlich und sicher sind.',
  },
  'ru': {
    tagline: 'Один рабочий стол для мониторинга вашего GPU-парка, просмотра файлов и перемещения данных **между серверами на полной скорости** — всё по SSH, полностью локально.',
    desc: '**ServerConsole** — это локальное десктопное приложение, централизующее несколько Linux/GPU-серверов:\nмониторинг GPU и процессов в реальном времени, двухпанельный SFTP-менеджер файлов, загрузки/выгрузки и\n**высокоскоростная прямая передача между серверами** — построено на Electron, React и [`ssh2`](https://github.com/mscdex/ssh2).\nБез облака, без релея данных: каждое подключение выполняется напрямую с вашей машины.',
    toc: 'Содержание', highlights: '✨ Возможности', tech: '🧱 Технологии', getting: '🚀 Начало работы', build: '🏗️ Сборка и упаковка', usage: '🧭 Использование',
    how: '🏛️ Как это работает', security: '🔐 Безопасность и приватность', data: '📁 Хранение данных', dev: '🧪 Разработка', limitations: '⚠️ Ограничения',
    contributing: '🤝 Участие', license: '📄 Лицензия',
    mgmt: '🧩 Управление несколькими серверами', sshimport: '🔑 Импорт в один клик из `~/.ssh/config`', toolkit: '🧰 Набор инструментов',
    monitoring: '📊 Мониторинг GPU и процессов в реальном времени', sftp: '🗂️ Двухпанельный SFTP-менеджер', direct: '⚡ Прямая передача между серверами',
    transferCenter: '🚦 Панель центра передач', ui: '🎛️ Современный спокойный интерфейс',
    requirements: 'Требования:', usageSteps: '1. **Добавить сервер** — введите хост/порт/пользователя, выберите пароль или ключ, опционально *Проверить соединение*, затем сохраните. Или нажмите **Импорт из `~/.ssh/config`**.\n2. Выберите узел в боковой панели для открытия вкладок **Обзор / GPU / Процессы / Файлы**.\n3. В **Файлах** загружайте/выгружайте между панелями, или выберите удалённые элементы → **Ретрансляция ⇄** и выберите целевой сервер и папку.\n4. Кнопка **Передачи** в верхней панели — живая скорость, прогресс файлов и управление очередью.',
    securityBody: '- **Проверка ключа хоста (TOFU)**: первое подключение записывает отпечаток сервера; каждое последующее сверяется, несоответствие отклоняется с чётким предупреждением.\n- Ключи прямой передачи **одноразовые и уничтожаются после использования**; основной приватный ключ никогда не копируется.\n- Ретрансляция **только копирует** — исходные данные не удаляются; **повтор продолжает с точки останова**.\n- Деструктивные действия требуют подтверждения и записываются в **постоянный локальный журнал аудита**.\n- Пароли шифруются системным safeStorage; хранится только *путь* к приватному ключу.\n- Каждая метрика и значение прогресса берутся из реального ответа команды — **никаких выдуманных температур, скоростей или прогресса**.',
    dataBody: 'Все локальные данные находятся в каталоге пользователя ОС (`%AppData%/server-console/` в Windows).\nУдалите эту папку, чтобы сбросить всё локальное состояние.',
    contributingBody: 'Issues и PR приветствуются. Пожалуйста, выполните `npm run build` (строгая проверка типов) перед открытием PR и никогда не коммитьте реальные хосты, учётные данные или ключи.',
    licenseBody: 'Распространяется под **[MIT License](./LICENSE)**.',
    footer: 'Создано для инженеров, управляющих множеством GPU-серверов, которым нужны быстрые, честные и безопасные передачи.',
  },
  'pt-BR': {
    tagline: 'Um desktop para monitorar sua frota de GPUs, navegar arquivos e mover dados **entre servidores em velocidade total** — tudo por SSH, totalmente local.',
    desc: '**ServerConsole** é um aplicativo desktop local-first que centraliza múltiplos servidores Linux/GPU:\nmonitoramento de GPU e processos em tempo real, um gerenciador de arquivos SFTP de painel duplo, uploads/downloads, e\n**transferência direta de alta velocidade entre servidores** — construído com Electron, React e [`ssh2`](https://github.com/mscdex/ssh2).\nSem nuvem, sem retransmissão de dados: cada conexão roda diretamente da sua máquina.',
    toc: 'Índice', highlights: '✨ Destaques', tech: '🧱 Stack tecnológico', getting: '🚀 Primeiros passos', build: '🏗️ Build & Pacote', usage: '🧭 Uso',
    how: '🏛️ Como funciona', security: '🔐 Segurança e privacidade', data: '📁 Armazenamento de dados', dev: '🧪 Desenvolvimento', limitations: '⚠️ Limitações',
    contributing: '🤝 Contribuir', license: '📄 Licença',
    mgmt: '🧩 Gestão multi-servidor', sshimport: '🔑 Importação com um clique de `~/.ssh/config`', toolkit: '🧰 Kit de ferramentas de operações',
    monitoring: '📊 Monitoramento real de GPU e processos', sftp: '🗂️ Gerenciador de arquivos SFTP de painel duplo', direct: '⚡ Transferência direta entre servidores',
    transferCenter: '🚦 Painel central de transferências', ui: '🎛️ Interface moderna e calma',
    requirements: 'Requisitos:', usageSteps: '1. **Adicionar um servidor** — insira host/porta/usuário, escolha autenticação por senha ou chave, opcionalmente *Testar conexão*, depois salve. Ou clique em **Importar de `~/.ssh/config`**.\n2. Selecione um nó na barra lateral para abrir as abas **Visão geral / GPU / Processos / Arquivos**.\n3. Em **Arquivos**, faça upload/download entre os dois painéis, ou selecione itens remotos → **Retransmissão ⇄** e escolha o servidor e pasta de destino.\n4. Abra o botão **Transferências** da barra superior a qualquer momento para velocidade em tempo real, progresso de arquivos e gerenciamento de fila.',
    securityBody: '- **Verificação de chave de host (TOFU)**: a primeira conexão registra a impressão digital do servidor; cada conexão posterior é verificada e qualquer divergência é rejeitada com aviso claro.\n- Chaves de transferência direta são **efêmeras e destruídas após o uso**; a chave privada principal nunca é copiada ou enviada.\n- O relé é **apenas cópia** — os dados de origem nunca são excluídos; **a repetição retoma do ponto de interrupção**.\n- Ações destrutivas exigem confirmação e são registradas em um **log de auditoria local persistente**.\n- Senhas são criptografadas com o safe-storage do SO; apenas o *caminho* de uma chave privada é armazenado, nunca seu conteúdo.\n- Cada métrica e valor de progresso vem de uma resposta real de comando — **nenhuma temperatura, velocidade ou progresso inventado**.',
    dataBody: 'Todos os dados locais ficam no diretório de dados do usuário do SO (`%AppData%/server-console/` no Windows).\nExclua essa pasta para limpar todo o estado local.',
    contributingBody: 'Issues e PRs são bem-vindos. Por favor execute `npm run build` (type-check estrito) antes de abrir um PR, e nunca commite hosts reais, credenciais ou chaves.',
    licenseBody: 'Distribuído sob a **[MIT License](./LICENSE)**.',
    footer: 'Construído para engenheiros que gerenciam muitos servidores GPU e querem transferências rápidas, honestas e seguras.',
  },
};

// ===== 3. 生成 8 个新 README =====
const enContent = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

for (const lang of LANGS) {
  if (lang.code === 'en' || lang.code === 'zh-CN') continue;
  const tr = T[lang.code];
  if (!tr) { console.log('No translation for ' + lang.code); continue; }

  let out = enContent;
  // 替换导航链接
  out = out.replace(
    /\[English\].*?\n/,
    navLinks(lang.code) + '\n'
  );
  // 替换 tagline
  out = out.replace(
    /### .*— .*\n/,
    `### ${tr.tagline}\n`
  );
  // 替换描述
  out = out.replace(
    /\*\*ServerConsole\*\* is a local-first[\s\S]*?from your machine\./,
    tr.desc
  );
  // 替换 TOC
  out = out.replace(/## 📑 Table of Contents/, `## 📑 ${tr.toc}`);
  out = out.replace(/- \[✨ Highlights\]/, `- [✨ ${tr.highlights}](#-highlights)`);
  out = out.replace(/- \[🧱 Tech Stack\]/, `- [🧱 ${tr.tech}](#-tech-stack)`);
  out = out.replace(/- \[🚀 Getting Started\]/, `- [🚀 ${tr.getting}](#-getting-started)`);
  out = out.replace(/- \[🏗️ Build & Package\]/, `- [🏗️ ${tr.build}](#️-build--package)`);
  out = out.replace(/- \[🧭 Usage\]/, `- [🧭 ${tr.usage}](#-usage)`);
  out = out.replace(/- \[🏛️ How it works\]/, `- [🏛️ ${tr.how}](#️-how-it-works)`);
  out = out.replace(/- \[🔐 Security & Privacy\]/, `- [🔐 ${tr.security}](#-security--privacy)`);
  out = out.replace(/- \[📁 Data storage\]/, `- [📁 ${tr.data}](#-data-storage)`);
  out = out.replace(/- \[🧪 Development\]/, `- [🧪 ${tr.dev}](#-development)`);
  out = out.replace(/- \[⚠️ Limitations\]/, `- [⚠️ ${tr.limitations}](#️-limitations)`);
  out = out.replace(/- \[🤝 Contributing\]/, `- [🤝 ${tr.contributing}](#-contributing)`);
  out = out.replace(/- \[📄 License\]/, `- [📄 ${tr.license}](#-license)`);
  // 替换区块标题
  out = out.replace('### 🧩 Multi-server management', `### ${tr.mgmt}`);
  out = out.replace("### 🔑 One-click `~/.ssh/config` import", `### ${tr.sshimport}`);
  out = out.replace('### 🧰 Ops toolkit', `### ${tr.toolkit}`);
  out = out.replace('### 📊 Real GPU & process monitoring', `### ${tr.monitoring}`);
  out = out.replace('### 🗂️ Dual-pane SFTP file manager', `### ${tr.sftp}`);
  out = out.replace('### ⚡ Server-to-server direct transfer', `### ${tr.direct}`);
  out = out.replace('### 🚦 Transfer Center drawer', `### ${tr.transferCenter}`);
  out = out.replace('### 🎛️ Modern, calm UI', `### ${tr.ui}`);
  out = out.replace('## ✨ Highlights', `## ✨ ${tr.highlights}`);
  out = out.replace('## 🧱 Tech Stack', `## 🧱 ${tr.tech}`);
  out = out.replace('## 🚀 Getting Started', `## 🚀 ${tr.getting}`);
  out = out.replace('## 🏗️ Build & Package', `## 🏗️ ${tr.build}`);
  out = out.replace('## 🧭 Usage', `## 🧭 ${tr.usage}`);
  out = out.replace('## 🏛️ How it works', `## 🏛️ ${tr.how}`);
  out = out.replace('## 🔐 Security & Privacy', `## 🔐 ${tr.security}`);
  out = out.replace('## 📁 Data storage', `## 📁 ${tr.data}`);
  out = out.replace('## 🧪 Development', `## 🧪 ${tr.dev}`);
  out = out.replace('## ⚠️ Limitations', `## ⚠️ ${tr.limitations}`);
  out = out.replace('## 🤝 Contributing', `## 🤝 ${tr.contributing}`);
  out = out.replace('## 📄 License', `## 📄 ${tr.license}`);
  out = out.replace('## 📑 Table of Contents', `## 📑 ${tr.toc}`);
  // 使用步骤
  out = out.replace(
    /1\. \*\*Add a server\*\*[\s\S]*?queue management\./,
    tr.usageSteps
  );
  // 安全
  out = out.replace(
    /## 🔐 Security & Privacy\n- \*\*Host key verification[\s\S]*?per-file progress\*\*/,
    `## 🔐 ${tr.security}\n${tr.securityBody}`
  );
  // 数据存储
  out = out.replace(
    /## 📁 Data storage\nAll local data[\s\S]*?local state\./,
    `## 📁 ${tr.data}\n${tr.dataBody}`
  );
  // 贡献
  out = out.replace(
    /## 🤝 Contributing\nIssues and PRs[\s\S]*?or keys\./,
    `## 🤝 ${tr.contributing}\n${tr.contributingBody}`
  );
  // 许可证
  out = out.replace(
    /## 📄 License\nDistributed under[\s\S]*?License\)\*\*\./,
    `## 📄 ${tr.license}\n${tr.licenseBody}`
  );
  // 页脚
  out = out.replace(
    /<sub>Built for engineers[\s\S]*?<\/sub>/,
    `<sub>${tr.footer}</sub>`
  );

  fs.writeFileSync(path.join(ROOT, lang.file), out);
  console.log(lang.file + ' generated (' + out.length + ' chars)');
}

console.log('all READMEs generated');
