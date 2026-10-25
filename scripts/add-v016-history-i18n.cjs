// 一次性脚本：为 v0.16.0 命令历史补充 parallel.history* 键到全部 10 个语言文件
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const keys = ['historyTitle', 'historySearch', 'historyClear', 'historyEmpty', 'historyFill', 'historyDelete'];
const translations = {
  en: { historyTitle: 'Command history', historySearch: 'Search history…', historyClear: 'Clear history', historyEmpty: 'No commands recorded yet.', historyFill: 'Click to fill the command box', historyDelete: 'Delete entry' },
  'zh-CN': { historyTitle: '命令历史', historySearch: '搜索历史…', historyClear: '清空历史', historyEmpty: '还没有记录的命令。', historyFill: '点击回填到命令框', historyDelete: '删除该条' },
  'zh-TW': { historyTitle: '命令歷史', historySearch: '搜尋歷史…', historyClear: '清空歷史', historyEmpty: '還沒有記錄的命令。', historyFill: '點擊回填到命令框', historyDelete: '刪除該條' },
  ja: { historyTitle: 'コマンド履歴', historySearch: '履歴を検索…', historyClear: '履歴を消去', historyEmpty: '記録されたコマンドはまだありません。', historyFill: 'クリックでコマンド欄に反映', historyDelete: 'この項目を削除' },
  ko: { historyTitle: '명령 기록', historySearch: '기록 검색…', historyClear: '기록 비우기', historyEmpty: '아직 기록된 명령이 없습니다.', historyFill: '클릭하여 명령란에 채우기', historyDelete: '항목 삭제' },
  es: { historyTitle: 'Historial de comandos', historySearch: 'Buscar en el historial…', historyClear: 'Borrar historial', historyEmpty: 'Aún no hay comandos registrados.', historyFill: 'Clic para rellenar el cuadro de comando', historyDelete: 'Eliminar entrada' },
  fr: { historyTitle: 'Historique des commandes', historySearch: 'Rechercher dans l’historique…', historyClear: 'Vider l’historique', historyEmpty: 'Aucune commande enregistrée pour le moment.', historyFill: 'Cliquer pour remplir le champ de commande', historyDelete: 'Supprimer l’entrée' },
  de: { historyTitle: 'Befehlsverlauf', historySearch: 'Verlauf durchsuchen…', historyClear: 'Verlauf leeren', historyEmpty: 'Noch keine Befehle aufgezeichnet.', historyFill: 'Klicken, um den Befehl einzusetzen', historyDelete: 'Eintrag löschen' },
  ru: { historyTitle: 'История команд', historySearch: 'Поиск по истории…', historyClear: 'Очистить историю', historyEmpty: 'Записанных команд пока нет.', historyFill: 'Нажмите, чтобы подставить команду', historyDelete: 'Удалить запись' },
  'pt-BR': { historyTitle: 'Histórico de comandos', historySearch: 'Pesquisar no histórico…', historyClear: 'Limpar histórico', historyEmpty: 'Nenhum comando registrado ainda.', historyFill: 'Clique para preencher o campo de comando', historyDelete: 'Excluir entrada' },
};

for (const [locale, dict] of Object.entries(translations)) {
  const file = path.join(folder, locale + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = keys.filter((k) => !(k in dict));
  if (missing.length) throw new Error(locale + ' missing: ' + missing.join(','));
  let added = 0;
  for (const key of keys) if (!(key in data.parallel)) { data.parallel[key] = dict[key]; added++; }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(locale, 'updated,', added);
}
