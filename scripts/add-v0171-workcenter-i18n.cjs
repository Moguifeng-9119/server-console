// 一次性脚本：补齐 WorkCenter 一直缺失的 72 个 features.* 键（此前任何语言都显示英文兜底）
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const en = {
  desktopRequired: 'Open the desktop application to use remote tools.', systemTools: 'System', tasks: 'Tasks', rulesAndWatches: 'Reminders & rules', containers: 'Containers', services: 'Services', reports: 'Reports', commandTemplates: 'Command templates',
  workCenter: 'Work center', server: 'Server', storage: 'Storage & inodes', mount: 'Mount', available: 'Available', used: 'Used', diskIo: 'Disk I/O', network: 'Network', ratesNeedTwo: 'Rates appear after two observations.', processDetails: 'Process details', inspect: 'Inspect',
  newTask: 'New task workspace', name: 'Name', directory: 'Working directory', command: 'Command', saveTask: 'Save task', exitCode: 'Exit code', start: 'Start', logs: 'Logs', openTerminal: 'Terminal', remove: 'Remove',
  gpuReminder: 'GPU availability reminder', gpuModel: 'GPU model contains', freeGiB: 'Minimum free GiB', durationSeconds: 'Duration (seconds)', addReminder: 'Add reminder', enabled: 'Enabled', fired: 'Fired', alertRules: 'Alert rules', metric: 'Metric', threshold: 'Threshold', recovery: 'Recovery threshold', cooldown: 'Cooldown (seconds)', quietStart: 'Quiet hours start', quietEnd: 'Quiet hours end', addRule: 'Add rule', events: 'Events',
  containersUnavailable: 'Docker or Podman is not installed.', image: 'Image', status: 'Status', actions: 'Actions',
  service: 'Service', remotePort: 'Remote port', localPort: 'Local port', logDirectory: 'Log directory', openTunnel: 'Open tunnel & browser', launchService: 'Launch in terminal', serviceNote: 'The service must be running remotely. Jupyter keeps its token authentication; paste the token in the browser when prompted.',
  weeklyReport: 'Weekly resource report', generateReport: 'Generate report', average: 'Average', peak: 'Peak', coverage: 'Coverage', busyHours: 'Busy-equivalent hours', trackedTasks: 'Tracked tasks',
  saveTemplate: 'Save template', parameters: 'Parameters (JSON)', preview: 'Preview', runTerminal: 'Run in terminal',
  temperature: 'Temperature', memoryPercent: 'Memory', gpuUtil: 'GPU utilization', cpuUsage: 'CPU usage', offline: 'Offline',
};

const t = {
  'zh-CN': {
    desktopRequired: '请在桌面应用中使用远程工具。', systemTools: '系统', tasks: '任务', rulesAndWatches: '提醒与规则', containers: '容器', services: '服务', reports: '报告', commandTemplates: '命令模板',
    workCenter: '工作台', server: '服务器', storage: '存储与 inode', mount: '挂载点', available: '可用', used: '已用', diskIo: '磁盘 I/O', network: '网络', ratesNeedTwo: '速率在两次观测后显示。', processDetails: '进程详情', inspect: '查看',
    newTask: '新建任务工作区', name: '名称', directory: '工作目录', command: '命令', saveTask: '保存任务', exitCode: '退出码', start: '启动', logs: '日志', openTerminal: '终端', remove: '移除',
    gpuReminder: 'GPU 空闲提醒', gpuModel: 'GPU 型号包含', freeGiB: '最小空闲 GiB', durationSeconds: '持续时间（秒）', addReminder: '添加提醒', enabled: '已启用', fired: '已触发', alertRules: '告警规则', metric: '指标', threshold: '阈值', recovery: '恢复阈值', cooldown: '冷却（秒）', quietStart: '静默时段开始', quietEnd: '静默时段结束', addRule: '添加规则', events: '事件',
    containersUnavailable: '未安装 Docker 或 Podman。', image: '镜像', status: '状态', actions: '操作',
    service: '服务', remotePort: '远程端口', localPort: '本地端口', logDirectory: '日志目录', openTunnel: '开隧道并打开浏览器', launchService: '在终端中启动', serviceNote: '服务必须已在远程运行。Jupyter 保留其令牌认证，浏览器提示时粘贴令牌即可。',
    weeklyReport: '每周资源报告', generateReport: '生成报告', average: '平均', peak: '峰值', coverage: '覆盖率', busyHours: '等效忙碌小时', trackedTasks: '跟踪的任务',
    saveTemplate: '保存模板', parameters: '参数（JSON）', preview: '预览', runTerminal: '在终端中运行',
    temperature: '温度', memoryPercent: '显存', gpuUtil: 'GPU 利用率', cpuUsage: 'CPU 使用率', offline: '离线',
  },
  'zh-TW': {
    desktopRequired: '請在桌面應用程式中使用遠端工具。', systemTools: '系統', tasks: '任務', rulesAndWatches: '提醒與規則', containers: '容器', services: '服務', reports: '報告', commandTemplates: '命令範本',
    workCenter: '工作台', server: '伺服器', storage: '儲存與 inode', mount: '掛載點', available: '可用', used: '已用', diskIo: '磁碟 I/O', network: '網路', ratesNeedTwo: '速率會在兩次觀測後顯示。', processDetails: '行程詳情', inspect: '檢視',
    newTask: '新建任務工作區', name: '名稱', directory: '工作目錄', command: '命令', saveTask: '儲存任務', exitCode: '結束代碼', start: '啟動', logs: '日誌', openTerminal: '終端機', remove: '移除',
    gpuReminder: 'GPU 空閒提醒', gpuModel: 'GPU 型號包含', freeGiB: '最小空閒 GiB', durationSeconds: '持續時間（秒）', addReminder: '新增提醒', enabled: '已啟用', fired: '已觸發', alertRules: '警示規則', metric: '指標', threshold: '閾值', recovery: '恢復閾值', cooldown: '冷卻（秒）', quietStart: '靜音時段開始', quietEnd: '靜音時段結束', addRule: '新增規則', events: '事件',
    containersUnavailable: '未安裝 Docker 或 Podman。', image: '映像', status: '狀態', actions: '操作',
    service: '服務', remotePort: '遠端連接埠', localPort: '本機連接埠', logDirectory: '日誌目錄', openTunnel: '開通道並開啟瀏覽器', launchService: '在終端機中啟動', serviceNote: '服務必須已在遠端執行。Jupyter 保留其權杖驗證，瀏覽器提示時貼上權杖即可。',
    weeklyReport: '每週資源報告', generateReport: '產生報告', average: '平均', peak: '峰值', coverage: '覆蓋率', busyHours: '等效忙碌小時', trackedTasks: '追蹤的任務',
    saveTemplate: '儲存範本', parameters: '參數（JSON）', preview: '預覽', runTerminal: '在終端機中執行',
    temperature: '溫度', memoryPercent: '記憶體', gpuUtil: 'GPU 使用率', cpuUsage: 'CPU 使用率', offline: '離線',
  },
  ja: {
    desktopRequired: 'リモートツールはデスクトップアプリで利用できます。', systemTools: 'システム', tasks: 'タスク', rulesAndWatches: 'リマインダーとルール', containers: 'コンテナ', services: 'サービス', reports: 'レポート', commandTemplates: 'コマンドテンプレート',
    workCenter: 'ワークセンター', server: 'サーバー', storage: 'ストレージと inode', mount: 'マウント', available: '利用可能', used: '使用済み', diskIo: 'ディスク I/O', network: 'ネットワーク', ratesNeedTwo: '速度は 2 回の観測後に表示されます。', processDetails: 'プロセス詳細', inspect: '調査',
    newTask: '新しいタスクワークスペース', name: '名前', directory: '作業ディレクトリ', command: 'コマンド', saveTask: 'タスクを保存', exitCode: '終了コード', start: '開始', logs: 'ログ', openTerminal: 'ターミナル', remove: '削除',
    gpuReminder: 'GPU 空き通知', gpuModel: 'GPU モデルに含む', freeGiB: '最小空き GiB', durationSeconds: '継続時間（秒）', addReminder: 'リマインダーを追加', enabled: '有効', fired: '発火済み', alertRules: 'アラートルール', metric: '指標', threshold: 'しきい値', recovery: '復帰しきい値', cooldown: 'クールダウン（秒）', quietStart: 'サイレント開始', quietEnd: 'サイレント終了', addRule: 'ルールを追加', events: 'イベント',
    containersUnavailable: 'Docker または Podman がインストールされていません。', image: 'イメージ', status: '状態', actions: '操作',
    service: 'サービス', remotePort: 'リモートポート', localPort: 'ローカルポート', logDirectory: 'ログディレクトリ', openTunnel: 'トンネルを開いてブラウザで開く', launchService: 'ターミナルで起動', serviceNote: 'サービスはリモートで起動している必要があります。Jupyter はトークン認証を維持するため、ブラウザで求められたらトークンを貼り付けてください。',
    weeklyReport: '週次リソースレポート', generateReport: 'レポートを生成', average: '平均', peak: 'ピーク', coverage: 'カバレッジ', busyHours: '同等ビジー時間', trackedTasks: '追跡中のタスク',
    saveTemplate: 'テンプレートを保存', parameters: 'パラメータ（JSON）', preview: 'プレビュー', runTerminal: 'ターミナルで実行',
    temperature: '温度', memoryPercent: 'メモリ', gpuUtil: 'GPU 使用率', cpuUsage: 'CPU 使用率', offline: 'オフライン',
  },
  ko: {
    desktopRequired: '원격 도구는 데스크톱 앱에서 사용할 수 있습니다.', systemTools: '시스템', tasks: '작업', rulesAndWatches: '알림 및 규칙', containers: '컨테이너', services: '서비스', reports: '보고서', commandTemplates: '명령 템플릿',
    workCenter: '작업 센터', server: '서버', storage: '저장소 및 inode', mount: '마운트', available: '사용 가능', used: '사용됨', diskIo: '디스크 I/O', network: '네트워크', ratesNeedTwo: '속도는 두 번 관측 후 표시됩니다.', processDetails: '프로세스 상세', inspect: '조회',
    newTask: '새 작업 워크스페이스', name: '이름', directory: '작업 디렉터리', command: '명령', saveTask: '작업 저장', exitCode: '종료 코드', start: '시작', logs: '로그', openTerminal: '터미널', remove: '제거',
    gpuReminder: 'GPU 여유 알림', gpuModel: 'GPU 모델 포함', freeGiB: '최소 여유 GiB', durationSeconds: '지속 시간(초)', addReminder: '알림 추가', enabled: '사용 중', fired: '발생함', alertRules: '알림 규칙', metric: '지표', threshold: '임계값', recovery: '복구 임계값', cooldown: '쿨다운(초)', quietStart: '무음 시작', quietEnd: '무음 종료', addRule: '규칙 추가', events: '이벤트',
    containersUnavailable: 'Docker 또는 Podman이 설치되어 있지 않습니다.', image: '이미지', status: '상태', actions: '동작',
    service: '서비스', remotePort: '원격 포트', localPort: '로컬 포트', logDirectory: '로그 디렉터리', openTunnel: '터널 열고 브라우저 열기', launchService: '터미널에서 실행', serviceNote: '서비스가 원격에서 실행 중이어야 합니다. Jupyter는 토큰 인증을 유지하므로 브라우저에서 요청 시 토큰을 붙여넣으세요.',
    weeklyReport: '주간 리소스 보고서', generateReport: '보고서 생성', average: '평균', peak: '최대', coverage: '커버리지', busyHours: '환산 바쁜 시간', trackedTasks: '추적 중인 작업',
    saveTemplate: '템플릿 저장', parameters: '매개변수 (JSON)', preview: '미리보기', runTerminal: '터미널에서 실행',
    temperature: '온도', memoryPercent: '메모리', gpuUtil: 'GPU 사용률', cpuUsage: 'CPU 사용률', offline: '오프라인',
  },
  es: {
    desktopRequired: 'Abre la aplicación de escritorio para usar herramientas remotas.', systemTools: 'Sistema', tasks: 'Tareas', rulesAndWatches: 'Recordatorios y reglas', containers: 'Contenedores', services: 'Servicios', reports: 'Informes', commandTemplates: 'Plantillas de comandos',
    workCenter: 'Centro de trabajo', server: 'Servidor', storage: 'Almacenamiento e inodos', mount: 'Punto de montaje', available: 'Disponible', used: 'Usado', diskIo: 'E/S de disco', network: 'Red', ratesNeedTwo: 'Las tasas aparecen tras dos observaciones.', processDetails: 'Detalles del proceso', inspect: 'Inspeccionar',
    newTask: 'Nuevo espacio de tareas', name: 'Nombre', directory: 'Directorio de trabajo', command: 'Comando', saveTask: 'Guardar tarea', exitCode: 'Código de salida', start: 'Iniciar', logs: 'Registros', openTerminal: 'Terminal', remove: 'Eliminar',
    gpuReminder: 'Recordatorio de GPU disponible', gpuModel: 'Modelo de GPU contiene', freeGiB: 'GiB libres mínimos', durationSeconds: 'Duración (segundos)', addReminder: 'Añadir recordatorio', enabled: 'Activado', fired: 'Disparado', alertRules: 'Reglas de alerta', metric: 'Métrica', threshold: 'Umbral', recovery: 'Umbral de recuperación', cooldown: 'Enfriamiento (segundos)', quietStart: 'Inicio de silencio', quietEnd: 'Fin de silencio', addRule: 'Añadir regla', events: 'Eventos',
    containersUnavailable: 'Docker o Podman no está instalado.', image: 'Imagen', status: 'Estado', actions: 'Acciones',
    service: 'Servicio', remotePort: 'Puerto remoto', localPort: 'Puerto local', logDirectory: 'Directorio de registros', openTunnel: 'Abrir túnel y navegador', launchService: 'Iniciar en terminal', serviceNote: 'El servicio debe estar en ejecución en el servidor. Jupyter mantiene su autenticación por token; pega el token en el navegador cuando se solicite.',
    weeklyReport: 'Informe semanal de recursos', generateReport: 'Generar informe', average: 'Media', peak: 'Pico', coverage: 'Cobertura', busyHours: 'Horas equivalentes de uso', trackedTasks: 'Tareas rastreadas',
    saveTemplate: 'Guardar plantilla', parameters: 'Parámetros (JSON)', preview: 'Vista previa', runTerminal: 'Ejecutar en terminal',
    temperature: 'Temperatura', memoryPercent: 'Memoria', gpuUtil: 'Uso de GPU', cpuUsage: 'Uso de CPU', offline: 'Sin conexión',
  },
  fr: {
    desktopRequired: 'Ouvrez l’application de bureau pour utiliser les outils distants.', systemTools: 'Système', tasks: 'Tâches', rulesAndWatches: 'Rappels et règles', containers: 'Conteneurs', services: 'Services', reports: 'Rapports', commandTemplates: 'Modèles de commandes',
    workCenter: 'Centre de travail', server: 'Serveur', storage: 'Stockage et inodes', mount: 'Point de montage', available: 'Disponible', used: 'Utilisé', diskIo: 'E/S disque', network: 'Réseau', ratesNeedTwo: 'Les débits apparaissent après deux observations.', processDetails: 'Détails du processus', inspect: 'Inspecter',
    newTask: 'Nouvel espace de tâches', name: 'Nom', directory: 'Répertoire de travail', command: 'Commande', saveTask: 'Enregistrer la tâche', exitCode: 'Code de sortie', start: 'Démarrer', logs: 'Journaux', openTerminal: 'Terminal', remove: 'Supprimer',
    gpuReminder: 'Rappel de GPU disponible', gpuModel: 'Modèle de GPU contient', freeGiB: 'GiB libres minimum', durationSeconds: 'Durée (secondes)', addReminder: 'Ajouter un rappel', enabled: 'Activé', fired: 'Déclenché', alertRules: 'Règles d’alerte', metric: 'Métrique', threshold: 'Seuil', recovery: 'Seuil de récupération', cooldown: 'Refroidissement (secondes)', quietStart: 'Début des heures calmes', quietEnd: 'Fin des heures calmes', addRule: 'Ajouter une règle', events: 'Événements',
    containersUnavailable: 'Docker ou Podman n’est pas installé.', image: 'Image', status: 'État', actions: 'Actions',
    service: 'Service', remotePort: 'Port distant', localPort: 'Port local', logDirectory: 'Répertoire des journaux', openTunnel: 'Ouvrir le tunnel et le navigateur', launchService: 'Lancer dans le terminal', serviceNote: 'Le service doit déjà tourner sur le serveur. Jupyter conserve son authentification par jeton ; collez le jeton dans le navigateur lorsque demandé.',
    weeklyReport: 'Rapport hebdomadaire des ressources', generateReport: 'Générer le rapport', average: 'Moyenne', peak: 'Pic', coverage: 'Couverture', busyHours: 'Heures équivalentes occupées', trackedTasks: 'Tâches suivies',
    saveTemplate: 'Enregistrer le modèle', parameters: 'Paramètres (JSON)', preview: 'Aperçu', runTerminal: 'Exécuter dans le terminal',
    temperature: 'Température', memoryPercent: 'Mémoire', gpuUtil: 'Utilisation GPU', cpuUsage: 'Utilisation CPU', offline: 'Hors ligne',
  },
  de: {
    desktopRequired: 'Öffne die Desktop-App, um Remote-Werkzeuge zu nutzen.', systemTools: 'System', tasks: 'Aufgaben', rulesAndWatches: 'Erinnerungen & Regeln', containers: 'Container', services: 'Dienste', reports: 'Berichte', commandTemplates: 'Befehlsvorlagen',
    workCenter: 'Arbeitszentrum', server: 'Server', storage: 'Speicher & Inodes', mount: 'Einhängpunkt', available: 'Verfügbar', used: 'Belegt', diskIo: 'Festplatten-I/O', network: 'Netzwerk', ratesNeedTwo: 'Raten erscheinen nach zwei Beobachtungen.', processDetails: 'Prozessdetails', inspect: 'Untersuchen',
    newTask: 'Neuer Aufgabenbereich', name: 'Name', directory: 'Arbeitsverzeichnis', command: 'Befehl', saveTask: 'Aufgabe speichern', exitCode: 'Exit-Code', start: 'Starten', logs: 'Logs', openTerminal: 'Terminal', remove: 'Entfernen',
    gpuReminder: 'GPU-Verfügbarkeitserinnerung', gpuModel: 'GPU-Modell enthält', freeGiB: 'Mindestens freie GiB', durationSeconds: 'Dauer (Sekunden)', addReminder: 'Erinnerung hinzufügen', enabled: 'Aktiv', fired: 'Ausgelöst', alertRules: 'Alarmregeln', metric: 'Metrik', threshold: 'Schwellenwert', recovery: 'Erholungsschwelle', cooldown: 'Abklingzeit (Sekunden)', quietStart: 'Ruhezeit Beginn', quietEnd: 'Ruhezeit Ende', addRule: 'Regel hinzufügen', events: 'Ereignisse',
    containersUnavailable: 'Docker oder Podman ist nicht installiert.', image: 'Image', status: 'Status', actions: 'Aktionen',
    service: 'Dienst', remotePort: 'Remote-Port', localPort: 'Lokaler Port', logDirectory: 'Log-Verzeichnis', openTunnel: 'Tunnel & Browser öffnen', launchService: 'Im Terminal starten', serviceNote: 'Der Dienst muss auf dem Server laufen. Jupyter behält seine Token-Authentifizierung; füge den Token im Browser ein, wenn du dazu aufgefordert wirst.',
    weeklyReport: 'Wöchentlicher Ressourcenbericht', generateReport: 'Bericht erstellen', average: 'Durchschnitt', peak: 'Spitze', coverage: 'Abdeckung', busyHours: 'Äquivalente Beschäftigungsstunden', trackedTasks: 'Verfolgte Aufgaben',
    saveTemplate: 'Vorlage speichern', parameters: 'Parameter (JSON)', preview: 'Vorschau', runTerminal: 'Im Terminal ausführen',
    temperature: 'Temperatur', memoryPercent: 'Speicher', gpuUtil: 'GPU-Auslastung', cpuUsage: 'CPU-Auslastung', offline: 'Offline',
  },
  ru: {
    desktopRequired: 'Откройте настольное приложение для удалённых инструментов.', systemTools: 'Система', tasks: 'Задачи', rulesAndWatches: 'Напоминания и правила', containers: 'Контейнеры', services: 'Службы', reports: 'Отчёты', commandTemplates: 'Шаблоны команд',
    workCenter: 'Рабочий центр', server: 'Сервер', storage: 'Диски и inode', mount: 'Точка монтирования', available: 'Доступно', used: 'Занято', diskIo: 'Дисковый ввод/вывод', network: 'Сеть', ratesNeedTwo: 'Скорости появятся после двух наблюдений.', processDetails: 'Сведения о процессе', inspect: 'Осмотреть',
    newTask: 'Новая рабочая область задач', name: 'Название', directory: 'Рабочий каталог', command: 'Команда', saveTask: 'Сохранить задачу', exitCode: 'Код выхода', start: 'Запустить', logs: 'Журналы', openTerminal: 'Терминал', remove: 'Удалить',
    gpuReminder: 'Напоминание о свободном GPU', gpuModel: 'Модель GPU содержит', freeGiB: 'Минимум свободных ГиБ', durationSeconds: 'Длительность (секунды)', addReminder: 'Добавить напоминание', enabled: 'Включено', fired: 'Сработало', alertRules: 'Правила оповещений', metric: 'Метрика', threshold: 'Порог', recovery: 'Порог восстановления', cooldown: 'Пауза (секунды)', quietStart: 'Начало тихих часов', quietEnd: 'Конец тихих часов', addRule: 'Добавить правило', events: 'События',
    containersUnavailable: 'Docker или Podman не установлен.', image: 'Образ', status: 'Статус', actions: 'Действия',
    service: 'Служба', remotePort: 'Удалённый порт', localPort: 'Локальный порт', logDirectory: 'Каталог журналов', openTunnel: 'Открыть туннель и браузер', launchService: 'Запустить в терминале', serviceNote: 'Служба должна быть запущена на сервере. Jupyter сохраняет аутентификацию по токену; вставьте токен в браузере, когда он потребуется.',
    weeklyReport: 'Недельный отчёт о ресурсах', generateReport: 'Создать отчёт', average: 'Среднее', peak: 'Пик', coverage: 'Покрытие', busyHours: 'Эквивалент занятых часов', trackedTasks: 'Отслеживаемые задачи',
    saveTemplate: 'Сохранить шаблон', parameters: 'Параметры (JSON)', preview: 'Предпросмотр', runTerminal: 'Запустить в терминале',
    temperature: 'Температура', memoryPercent: 'Память', gpuUtil: 'Загрузка GPU', cpuUsage: 'Загрузка CPU', offline: 'Не в сети',
  },
  'pt-BR': {
    desktopRequired: 'Abra o aplicativo desktop para usar ferramentas remotas.', systemTools: 'Sistema', tasks: 'Tarefas', rulesAndWatches: 'Lembretes e regras', containers: 'Contêineres', services: 'Serviços', reports: 'Relatórios', commandTemplates: 'Modelos de comando',
    workCenter: 'Central de trabalho', server: 'Servidor', storage: 'Armazenamento e inodes', mount: 'Ponto de montagem', available: 'Disponível', used: 'Usado', diskIo: 'E/S de disco', network: 'Rede', ratesNeedTwo: 'As taxas aparecem após duas observações.', processDetails: 'Detalhes do processo', inspect: 'Inspecionar',
    newTask: 'Novo espaço de tarefas', name: 'Nome', directory: 'Diretório de trabalho', command: 'Comando', saveTask: 'Salvar tarefa', exitCode: 'Código de saída', start: 'Iniciar', logs: 'Logs', openTerminal: 'Terminal', remove: 'Remover',
    gpuReminder: 'Lembrete de GPU disponível', gpuModel: 'Modelo de GPU contém', freeGiB: 'GiB livres mínimos', durationSeconds: 'Duração (segundos)', addReminder: 'Adicionar lembrete', enabled: 'Ativado', fired: 'Disparado', alertRules: 'Regras de alerta', metric: 'Métrica', threshold: 'Limite', recovery: 'Limite de recuperação', cooldown: 'Espera (segundos)', quietStart: 'Início do silêncio', quietEnd: 'Fim do silêncio', addRule: 'Adicionar regra', events: 'Eventos',
    containersUnavailable: 'Docker ou Podman não está instalado.', image: 'Imagem', status: 'Status', actions: 'Ações',
    service: 'Serviço', remotePort: 'Porta remota', localPort: 'Porta local', logDirectory: 'Diretório de logs', openTunnel: 'Abrir túnel e navegador', launchService: 'Iniciar no terminal', serviceNote: 'O serviço já deve estar em execução no servidor. O Jupyter mantém sua autenticação por token; cole o token no navegador quando solicitado.',
    weeklyReport: 'Relatório semanal de recursos', generateReport: 'Gerar relatório', average: 'Média', peak: 'Pico', coverage: 'Cobertura', busyHours: 'Horas equivalentes ocupadas', trackedTasks: 'Tarefas rastreadas',
    saveTemplate: 'Salvar modelo', parameters: 'Parâmetros (JSON)', preview: 'Pré-visualização', runTerminal: 'Executar no terminal',
    temperature: 'Temperatura', memoryPercent: 'Memória', gpuUtil: 'Utilização da GPU', cpuUsage: 'Uso da CPU', offline: 'Offline',
  },
};

for (const [locale, dict] of Object.entries(t)) {
  const file = path.join(folder, locale + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = Object.keys(en).filter((k) => !(k in dict));
  if (missing.length) throw new Error(locale + ' missing: ' + missing.join(','));
  let added = 0;
  for (const key of Object.keys(en)) if (!(key in data.features)) { data.features[key] = dict[key]; added++; }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(locale, '+' + added);
}
