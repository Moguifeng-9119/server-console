// 一次性脚本：为 v0.15.0 的四个新 UI 块补充 features.* 键到全部 10 个语言文件
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const keys = ['logWatchers', 'logNote', 'logPath', 'logPatterns', 'logTrackLoss', 'addWatcher', 'logNeedsPattern', 'checkNow', 'paused', 'pause', 'resume', 'envCompare', 'envCollect', 'envCollectAll', 'envNote', 'envNever', 'envDriver', 'envCuda', 'envKernel', 'envPython', 'envTorch', 'occupiedIdle', 'occupiedIdleNote', 'usageReport', 'usageNote', 'usageDays', 'usageLoad', 'usageTotal', 'usageEmpty', 'user'];

const translations = {
  en: {
    logWatchers: 'Log watchers', logNote: 'The app tails the file every 30 seconds and notifies you when a new line matches any pattern. Patterns are regular expressions, one per line.',
    logPath: 'Log file path (on the server)', logPatterns: 'Patterns (one regex per line)', logTrackLoss: 'Track loss values (sparkline)', addWatcher: 'Add watcher',
    logNeedsPattern: 'Add at least one pattern or enable loss tracking.', checkNow: 'Check now', paused: 'Paused', pause: 'Pause', resume: 'Resume',
    envCompare: 'Environment comparison', envCollect: 'Collect this server', envCollectAll: 'Collect all servers',
    envNote: 'Differences from the majority value are highlighted. PyTorch requires torch to be importable by python3.', envNever: 'Not collected yet — use the buttons above.',
    envDriver: 'Driver', envCuda: 'CUDA', envKernel: 'Kernel / OS', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: 'Occupied but idle', occupiedIdleNote: 'Fires when a GPU holds memory but does no work: utilization stays below the threshold % while memory use stays above the recovery % for the whole duration. The event names the card and its users.',
    usageReport: 'GPU time by user', usageNote: 'Time is credited to each distinct user of an active GPU, split evenly when a card is shared. Data accumulates from the monitoring history, so it only grows while the app runs.',
    usageDays: 'Range (days)', usageLoad: 'Load', usageTotal: 'Total', usageEmpty: 'No usage recorded in this range.', user: 'User',
  },
  'zh-CN': {
    logWatchers: '日志监控', logNote: '应用每 30 秒读取一次文件末尾，新行命中任一模式时通知你。模式为正则表达式，每行一个。',
    logPath: '日志文件路径（服务器上的）', logPatterns: '匹配模式（每行一个正则）', logTrackLoss: '跟踪 loss 数值（迷你曲线）', addWatcher: '添加监控',
    logNeedsPattern: '请至少填写一个模式，或开启 loss 跟踪。', checkNow: '立即检查', paused: '已暂停', pause: '暂停', resume: '恢复',
    envCompare: '环境一致性对比', envCollect: '收集本服务器', envCollectAll: '收集全部服务器',
    envNote: '与多数值不同的单元格会高亮显示。PyTorch 需要 python3 可以导入 torch。', envNever: '尚未收集——点击上方按钮开始。',
    envDriver: '驱动', envCuda: 'CUDA', envKernel: '内核 / 系统', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: '占用但空闲', occupiedIdleNote: '当 GPU 占用显存却没有计算负载时触发：利用率在整个持续时间内低于阈值 %，而显存占用高于恢复 %。事件会注明卡号与占用用户。',
    usageReport: '按用户统计 GPU 时长', usageNote: '时长记给活跃 GPU 上的每个不同用户，多人共用一张卡时均摊。数据来自监控历史，只在软件运行期间累积。',
    usageDays: '范围（天）', usageLoad: '加载', usageTotal: '合计', usageEmpty: '该范围内没有用量记录。', user: '用户',
  },
  'zh-TW': {
    logWatchers: '日誌監控', logNote: '應用程式每 30 秒讀取一次檔案結尾，新行命中任一模式時通知你。模式為正規表示式，每行一個。',
    logPath: '日誌檔案路徑（伺服器上的）', logPatterns: '匹配模式（每行一個正規表示式）', logTrackLoss: '追蹤 loss 數值（迷你曲線）', addWatcher: '新增監控',
    logNeedsPattern: '請至少填寫一個模式，或開啟 loss 追蹤。', checkNow: '立即檢查', paused: '已暫停', pause: '暫停', resume: '恢復',
    envCompare: '環境一致性比較', envCollect: '收集本伺服器', envCollectAll: '收集全部伺服器',
    envNote: '與多數值不同的儲存格會以琥珀色標示。PyTorch 需要 python3 可以匯入 torch。', envNever: '尚未收集——點擊上方按鈕開始。',
    envDriver: '驅動程式', envCuda: 'CUDA', envKernel: '核心 / 系統', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: '佔用但閒置', occupiedIdleNote: '當 GPU 佔用記憶體卻沒有運算負載時觸發：使用率在整個持續時間內低於閾值 %，而記憶體占用高於恢復 %。事件會註明卡號與佔用使用者。',
    usageReport: '按使用者統計 GPU 時數', usageNote: '時數記給活躍 GPU 上的每個不同使用者，多人共用一張卡時平均分攤。資料來自監控歷史，只在軟體執行期間累積。',
    usageDays: '範圍（天）', usageLoad: '載入', usageTotal: '合計', usageEmpty: '該範圍內沒有用量記錄。', user: '使用者',
  },
  ja: {
    logWatchers: 'ログ監視', logNote: 'アプリは 30 秒ごとにファイルの末尾を読み、新しい行がいずれかのパターンに一致すると通知します。パターンは正規表現で、1 行に 1 つずつ指定します。',
    logPath: 'ログファイルのパス（サーバー上）', logPatterns: 'パターン（1 行に 1 つの正規表現）', logTrackLoss: 'loss 値を追跡（スパークライン）', addWatcher: '監視を追加',
    logNeedsPattern: 'パターンを 1 つ以上追加するか、loss 追跡を有効にしてください。', checkNow: '今すぐ確認', paused: '一時停止中', pause: '一時停止', resume: '再開',
    envCompare: '環境の一致比較', envCollect: 'このサーバーを収集', envCollectAll: '全サーバーを収集',
    envNote: '多数派の値と異なるセルが強調表示されます。PyTorch には python3 で torch をインポートできる必要があります。', envNever: 'まだ収集されていません — 上のボタンから開始してください。',
    envDriver: 'ドライバー', envCuda: 'CUDA', envKernel: 'カーネル / OS', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: '占有中だが遊休', occupiedIdleNote: 'GPU がメモリを確保したまま計算していない場合に発火：使用率がしきい値 % 未満で、メモリ使用率が回復しきい値 % を超えた状態が期間全体で続くとき。イベントにはカード番号と利用ユーザーが表示されます。',
    usageReport: 'ユーザー別 GPU 使用時間', usageNote: '時間は稼働中の GPU を利用した各ユーザーに割り当てられ、カードを共有する場合は均等に分割されます。データは監視履歴から蓄積されるため、アプリの実行中にのみ増加します。',
    usageDays: '期間（日）', usageLoad: '読み込み', usageTotal: '合計', usageEmpty: 'この期間の使用記録はありません。', user: 'ユーザー',
  },
  ko: {
    logWatchers: '로그 감시', logNote: '앱이 30초마다 파일 끝을 읽고, 새 줄이 패턴 중 하나와 일치하면 알려줍니다. 패턴은 정규 표현식이며 한 줄에 하나씩 입력합니다.',
    logPath: '로그 파일 경로 (서버)', logPatterns: '패턴 (한 줄에 정규 표현식 하나)', logTrackLoss: 'loss 값 추적 (스파크라인)', addWatcher: '감시 추가',
    logNeedsPattern: '패턴을 하나 이상 추가하거나 loss 추적을 사용하세요.', checkNow: '지금 확인', paused: '일시 중지됨', pause: '일시 중지', resume: '재개',
    envCompare: '환경 일관성 비교', envCollect: '이 서버 수집', envCollectAll: '모든 서버 수집',
    envNote: '다수 값과 다른 셀이 강조 표시됩니다. PyTorch는 python3에서 torch를 가져올 수 있어야 합니다.', envNever: '아직 수집되지 않았습니다 — 위의 버튼으로 시작하세요.',
    envDriver: '드라이버', envCuda: 'CUDA', envKernel: '커널 / OS', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: '점유 중이지만 유휴', occupiedIdleNote: 'GPU가 메모리를 점유한 채 연산하지 않을 때 발생합니다: 사용률이 임계값 % 미만이고 메모리 사용률이 복구 %를 초과한 상태가 전체 기간 동안 지속될 때입니다. 이벤트에 카드 번호와 사용자가 표시됩니다.',
    usageReport: '사용자별 GPU 사용 시간', usageNote: '시간은 활성 GPU를 사용한 각 사용자에게 기록되며, 카드를 공유하면 균등하게 분할됩니다. 데이터는 모니터링 기록에서 누적되므로 앱이 실행 중일 때만 늘어납니다.',
    usageDays: '범위 (일)', usageLoad: '불러오기', usageTotal: '합계', usageEmpty: '이 범위에는 사용 기록이 없습니다.', user: '사용자',
  },
  es: {
    logWatchers: 'Vigilancia de registros', logNote: 'La aplicación lee el final del archivo cada 30 segundos y te avisa cuando una línea nueva coincide con algún patrón. Los patrones son expresiones regulares, una por línea.',
    logPath: 'Ruta del archivo de registro (en el servidor)', logPatterns: 'Patrones (una expresión regular por línea)', logTrackLoss: 'Seguir valores de loss (minigráfico)', addWatcher: 'Añadir vigilancia',
    logNeedsPattern: 'Añade al menos un patrón o activa el seguimiento de loss.', checkNow: 'Comprobar ahora', paused: 'En pausa', pause: 'Pausar', resume: 'Reanudar',
    envCompare: 'Comparación de entornos', envCollect: 'Recopilar este servidor', envCollectAll: 'Recopilar todos los servidores',
    envNote: 'Las celdas que difieren del valor mayoritario se resaltan. PyTorch requiere que python3 pueda importar torch.', envNever: 'Aún no se ha recopilado; usa los botones de arriba.',
    envDriver: 'Controlador', envCuda: 'CUDA', envKernel: 'Núcleo / SO', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: 'Ocupada pero inactiva', occupiedIdleNote: 'Se activa cuando una GPU retiene memoria sin trabajar: la utilización se mantiene por debajo del umbral % mientras el uso de memoria supera el % de recuperación durante toda la duración. El evento indica la tarjeta y sus usuarios.',
    usageReport: 'Tiempo de GPU por usuario', usageNote: 'El tiempo se acredita a cada usuario distinto de una GPU activa y se reparte a partes iguales cuando la tarjeta se comparte. Los datos provienen del historial de monitoreo, así que solo crecen mientras la aplicación está en ejecución.',
    usageDays: 'Rango (días)', usageLoad: 'Cargar', usageTotal: 'Total', usageEmpty: 'No hay uso registrado en este rango.', user: 'Usuario',
  },
  fr: {
    logWatchers: 'Surveillance des journaux', logNote: "L'application lit la fin du fichier toutes les 30 secondes et vous avertit lorsqu'une nouvelle ligne correspond à un motif. Les motifs sont des expressions régulières, une par ligne.",
    logPath: 'Chemin du fichier journal (sur le serveur)', logPatterns: 'Motifs (une expression régulière par ligne)', logTrackLoss: 'Suivre les valeurs de loss (micro-graphique)', addWatcher: 'Ajouter une surveillance',
    logNeedsPattern: 'Ajoutez au moins un motif ou activez le suivi de loss.', checkNow: 'Vérifier maintenant', paused: 'En pause', pause: 'Mettre en pause', resume: 'Reprendre',
    envCompare: 'Comparaison des environnements', envCollect: 'Collecter ce serveur', envCollectAll: 'Collecter tous les serveurs',
    envNote: 'Les cellules différentes de la valeur majoritaire sont surlignées. PyTorch nécessite que python3 puisse importer torch.', envNever: 'Pas encore collecté — utilisez les boutons ci-dessus.',
    envDriver: 'Pilote', envCuda: 'CUDA', envKernel: 'Noyau / OS', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: 'Occupé mais inactif', occupiedIdleNote: "Se déclenche quand un GPU retient de la mémoire sans travailler : l'utilisation reste sous le seuil % pendant que la mémoire dépasse le % de récupération pendant toute la durée. L'événement nomme la carte et ses utilisateurs.",
    usageReport: 'Temps GPU par utilisateur', usageNote: "Le temps est crédité à chaque utilisateur distinct d'un GPU actif et réparti également lorsque la carte est partagée. Les données proviennent de l'historique de surveillance et ne croissent que pendant l'exécution de l'application.",
    usageDays: 'Période (jours)', usageLoad: 'Charger', usageTotal: 'Total', usageEmpty: 'Aucune utilisation enregistrée sur cette période.', user: 'Utilisateur',
  },
  de: {
    logWatchers: 'Log-Überwachung', logNote: 'Die App liest alle 30 Sekunden das Dateiende und benachrichtigt dich, wenn eine neue Zeile auf ein Muster passt. Muster sind reguläre Ausdrücke, einer pro Zeile.',
    logPath: 'Log-Dateipfad (auf dem Server)', logPatterns: 'Muster (ein regulärer Ausdruck pro Zeile)', logTrackLoss: 'Loss-Werte verfolgen (Sparkline)', addWatcher: 'Überwachung hinzufügen',
    logNeedsPattern: 'Füge mindestens ein Muster hinzu oder aktiviere die Loss-Verfolgung.', checkNow: 'Jetzt prüfen', paused: 'Angehalten', pause: 'Anhalten', resume: 'Fortsetzen',
    envCompare: 'Umgebungsvergleich', envCollect: 'Diesen Server sammeln', envCollectAll: 'Alle Server sammeln',
    envNote: 'Von der Mehrheit abweichende Zellen werden hervorgehoben. PyTorch erfordert, dass python3 torch importieren kann.', envNever: 'Noch nicht gesammelt — benutze die Schaltflächen oben.',
    envDriver: 'Treiber', envCuda: 'CUDA', envKernel: 'Kernel / OS', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: 'Belegt, aber untätig', occupiedIdleNote: 'Löst aus, wenn ein GPU Speicher hält, aber nicht rechnet: Die Auslastung bleibt unter dem Schwellenwert %, während die Speichernutzung über dem Erholungswert % liegt, für die gesamte Dauer. Das Ereignis nennt die Karte und ihre Nutzer.',
    usageReport: 'GPU-Zeit nach Benutzer', usageNote: 'Die Zeit wird jedem einzelnen Benutzer einer aktiven GPU gutgeschrieben und bei gemeinsam genutzten Karten gleichmäßig aufgeteilt. Die Daten stammen aus dem Monitoring-Verlauf und wachsen nur, während die App läuft.',
    usageDays: 'Zeitraum (Tage)', usageLoad: 'Laden', usageTotal: 'Gesamt', usageEmpty: 'In diesem Zeitraum ist keine Nutzung aufgezeichnet.', user: 'Benutzer',
  },
  ru: {
    logWatchers: 'Наблюдение за журналами', logNote: 'Приложение каждые 30 секунд читает конец файла и уведомляет, когда новая строка совпадает с одним из шаблонов. Шаблоны — регулярные выражения, по одному в строке.',
    logPath: 'Путь к файлу журнала (на сервере)', logPatterns: 'Шаблоны (по одному регулярному выражению в строке)', logTrackLoss: 'Отслеживать loss (мини-график)', addWatcher: 'Добавить наблюдение',
    logNeedsPattern: 'Добавьте хотя бы один шаблон или включите отслеживание loss.', checkNow: 'Проверить сейчас', paused: 'Приостановлено', pause: 'Приостановить', resume: 'Возобновить',
    envCompare: 'Сравнение окружений', envCollect: 'Собрать с этого сервера', envCollectAll: 'Собрать со всех серверов',
    envNote: 'Ячейки, отличающиеся от большинства, выделены. Для PyTorch требуется, чтобы python3 мог импортировать torch.', envNever: 'Ещё не собрано — используйте кнопки выше.',
    envDriver: 'Драйвер', envCuda: 'CUDA', envKernel: 'Ядро / ОС', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: 'Занят, но простаивает', occupiedIdleNote: 'Срабатывает, когда GPU держит память, но не считает: утилизация держится ниже порога %, а занятость памяти выше порога восстановления % в течение всей длительности. В событии указываются карта и её пользователи.',
    usageReport: 'Время GPU по пользователям', usageNote: 'Время начисляется каждому пользователю активного GPU и делится поровну при совместном использовании карты. Данные накапливаются из истории мониторинга, то есть растут только пока приложение работает.',
    usageDays: 'Диапазон (дни)', usageLoad: 'Загрузить', usageTotal: 'Всего', usageEmpty: 'За этот период использования нет.', user: 'Пользователь',
  },
  'pt-BR': {
    logWatchers: 'Monitoramento de logs', logNote: 'O aplicativo lê o final do arquivo a cada 30 segundos e avisa quando uma nova linha corresponde a algum padrão. Os padrões são expressões regulares, uma por linha.',
    logPath: 'Caminho do arquivo de log (no servidor)', logPatterns: 'Padrões (uma expressão regular por linha)', logTrackLoss: 'Rastrear valores de loss (mini-gráfico)', addWatcher: 'Adicionar monitor',
    logNeedsPattern: 'Adicione pelo menos um padrão ou ative o rastreamento de loss.', checkNow: 'Verificar agora', paused: 'Pausado', pause: 'Pausar', resume: 'Retomar',
    envCompare: 'Comparação de ambientes', envCollect: 'Coletar deste servidor', envCollectAll: 'Coletar de todos os servidores',
    envNote: 'As células diferentes do valor da maioria são destacadas. O PyTorch exige que o python3 consiga importar o torch.', envNever: 'Ainda não coletado — use os botões acima.',
    envDriver: 'Driver', envCuda: 'CUDA', envKernel: 'Kernel / SO', envPython: 'Python', envTorch: 'PyTorch + CUDA',
    occupiedIdle: 'Ocupada, mas ociosa', occupiedIdleNote: 'Dispara quando uma GPU retém memória sem trabalhar: a utilização fica abaixo do limite % enquanto o uso de memória fica acima do % de recuperação durante toda a duração. O evento indica a placa e os usuários.',
    usageReport: 'Tempo de GPU por usuário', usageNote: 'O tempo é creditado a cada usuário distinto de uma GPU ativa e dividido igualmente quando a placa é compartilhada. Os dados vêm do histórico de monitoramento, então só crescem enquanto o aplicativo está em execução.',
    usageDays: 'Período (dias)', usageLoad: 'Carregar', usageTotal: 'Total', usageEmpty: 'Nenhum uso registrado nesse período.', user: 'Usuário',
  },
};

for (const [locale, dict] of Object.entries(translations)) {
  const file = path.join(folder, locale + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = keys.filter((k) => !(k in dict));
  if (missing.length) throw new Error(locale + ' missing translations: ' + missing.join(','));
  let added = 0;
  for (const key of keys) if (!(key in data.features)) { data.features[key] = dict[key]; added++; }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(locale, 'updated,', added, 'keys added');
}
