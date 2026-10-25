// 一次性脚本：为 v0.16.0 Dev Sync 补充 features.sync* 键到全部 10 个语言文件
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const keys = ['syncTitle', 'syncNote', 'syncLocalDir', 'syncRemoteDir', 'syncExcludes', 'addPair', 'pickOnce', 'lastSync', 'syncNever', 'syncError', 'browse'];
const translations = {
  en: { syncTitle: 'Save & upload (Dev sync)', syncNote: 'Watches a local folder and uploads every changed file to the server automatically (500 ms debounce). Excludes are glob patterns, one per line, e.g. **/*.tmp or node_modules.', syncLocalDir: 'Local directory', syncRemoteDir: 'Remote directory (on the server)', syncExcludes: 'Excludes (one glob per line)', addPair: 'Add pair', pickOnce: 'Upload all now', lastSync: 'Last sync', syncNever: 'No changes yet', syncError: 'Watch error', browse: 'Browse…' },
  'zh-CN': { syncTitle: '保存即上传（开发同步）', syncNote: '监听本地文件夹，文件一有改动就自动上传到服务器（500 毫秒去抖）。排除规则为通配符模式，每行一个，如 **/*.tmp 或 node_modules。', syncLocalDir: '本地目录', syncRemoteDir: '远程目录（服务器上的）', syncExcludes: '排除规则（每行一个通配符）', addPair: '添加配对', pickOnce: '立即上传全部', lastSync: '上次同步', syncNever: '暂无改动', syncError: '监听错误', browse: '浏览…' },
  'zh-TW': { syncTitle: '儲存即上傳（開發同步）', syncNote: '監聽本機資料夾，檔案一有變更就自動上傳到伺服器（500 毫秒去抖）。排除規則為萬用字元模式，每行一個，如 **/*.tmp 或 node_modules。', syncLocalDir: '本機目錄', syncRemoteDir: '遠端目錄（伺服器上的）', syncExcludes: '排除規則（每行一個萬用字元）', addPair: '新增配對', pickOnce: '立即上傳全部', lastSync: '上次同步', syncNever: '暫無變更', syncError: '監聽錯誤', browse: '瀏覽…' },
  ja: { syncTitle: '保存して即アップロード（開発同期）', syncNote: 'ローカルフォルダーを監視し、変更されたファイルを自動でサーバーへアップロードします（500 ms デバウンス）。除外は glob パターンで 1 行に 1 つ、例：**/*.tmp や node_modules。', syncLocalDir: 'ローカルディレクトリ', syncRemoteDir: 'リモートディレクトリ（サーバー上）', syncExcludes: '除外（1 行に 1 つの glob）', addPair: 'ペアを追加', pickOnce: 'すべて今すぐアップロード', lastSync: '最終同期', syncNever: '変更はまだありません', syncError: '監視エラー', browse: '参照…' },
  ko: { syncTitle: '저장 즉시 업로드 (개발 동기화)', syncNote: '로컬 폴더를 감시하고 변경된 파일을 자동으로 서버에 업로드합니다(500ms 디바운스). 제외 패턴은 한 줄에 하나의 glob, 예: **/*.tmp 또는 node_modules.', syncLocalDir: '로컬 디렉터리', syncRemoteDir: '원격 디렉터리 (서버)', syncExcludes: '제외 (한 줄에 glob 하나)', addPair: '페어 추가', pickOnce: '지금 모두 업로드', lastSync: '마지막 동기화', syncNever: '변경 사항 없음', syncError: '감시 오류', browse: '찾아보기…' },
  es: { syncTitle: 'Guardar y subir (sincronización de desarrollo)', syncNote: 'Vigila una carpeta local y sube automáticamente al servidor cada archivo modificado (500 ms de debounce). Las exclusiones son patrones glob, una por línea, p. ej. **/*.tmp o node_modules.', syncLocalDir: 'Directorio local', syncRemoteDir: 'Directorio remoto (en el servidor)', syncExcludes: 'Exclusiones (un glob por línea)', addPair: 'Añadir pareja', pickOnce: 'Subir todo ahora', lastSync: 'Última sincronización', syncNever: 'Aún sin cambios', syncError: 'Error de vigilancia', browse: 'Examinar…' },
  fr: { syncTitle: 'Enregistrer et envoyer (synchro dev)', syncNote: 'Surveille un dossier local et envoie automatiquement au serveur chaque fichier modifié (anti-rebond de 500 ms). Les exclusions sont des motifs glob, un par ligne, p. ex. **/*.tmp ou node_modules.', syncLocalDir: 'Dossier local', syncRemoteDir: 'Dossier distant (sur le serveur)', syncExcludes: 'Exclusions (un motif glob par ligne)', addPair: 'Ajouter une paire', pickOnce: 'Tout envoyer maintenant', lastSync: 'Dernière synchro', syncNever: 'Aucun changement pour le moment', syncError: 'Erreur de surveillance', browse: 'Parcourir…' },
  de: { syncTitle: 'Speichern & hochladen (Dev-Sync)', syncNote: 'Überwacht einen lokalen Ordner und lädt jede geänderte Datei automatisch auf den Server (500 ms Entprellung). Ausschlüsse sind Glob-Muster, eines pro Zeile, z. B. **/*.tmp oder node_modules.', syncLocalDir: 'Lokales Verzeichnis', syncRemoteDir: 'Remote-Verzeichnis (auf dem Server)', syncExcludes: 'Ausschlüsse (ein Glob pro Zeile)', addPair: 'Paar hinzufügen', pickOnce: 'Alle jetzt hochladen', lastSync: 'Letzte Synchronisierung', syncNever: 'Noch keine Änderungen', syncError: 'Überwachungsfehler', browse: 'Durchsuchen…' },
  ru: { syncTitle: 'Сохранил — загрузилось (Dev-синхронизация)', syncNote: 'Следит за локальной папкой и автоматически загружает каждый изменённый файл на сервер (дебаунс 500 мс). Исключения — glob-шаблоны, по одному в строке, например **/*.tmp или node_modules.', syncLocalDir: 'Локальный каталог', syncRemoteDir: 'Удалённый каталог (на сервере)', syncExcludes: 'Исключения (по одному glob в строке)', addPair: 'Добавить пару', pickOnce: 'Загрузить всё сейчас', lastSync: 'Последняя синхронизация', syncNever: 'Изменений пока нет', syncError: 'Ошибка наблюдения', browse: 'Обзор…' },
  'pt-BR': { syncTitle: 'Salvar e enviar (sincronização de dev)', syncNote: 'Vigia uma pasta local e envia automaticamente ao servidor cada arquivo alterado (debounce de 500 ms). As exclusões são padrões glob, um por linha, ex.: **/*.tmp ou node_modules.', syncLocalDir: 'Diretório local', syncRemoteDir: 'Diretório remoto (no servidor)', syncExcludes: 'Exclusões (um glob por linha)', addPair: 'Adicionar par', pickOnce: 'Enviar tudo agora', lastSync: 'Última sincronização', syncNever: 'Nenhuma alteração ainda', syncError: 'Erro de vigilância', browse: 'Procurar…' },
};

for (const [locale, dict] of Object.entries(translations)) {
  const file = path.join(folder, locale + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = keys.filter((k) => !(k in dict));
  if (missing.length) throw new Error(locale + ' missing: ' + missing.join(','));
  let added = 0;
  for (const key of keys) if (!(key in data.features)) { data.features[key] = dict[key]; added++; }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(locale, 'updated,', added, 'keys');
}
