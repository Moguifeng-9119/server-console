// 一次性脚本：为 v0.16.0 终端搜索补充 terminal.search* 键到全部 10 个语言文件
const fs = require('node:fs');
const path = require('node:path');
const folder = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const keys = ['searchPh', 'searchPrev', 'searchNext', 'searchClose'];
const translations = {
  en: { searchPh: 'Search in terminal…', searchPrev: 'Previous match', searchNext: 'Next match', searchClose: 'Close search' },
  'zh-CN': { searchPh: '在终端中搜索…', searchPrev: '上一个匹配', searchNext: '下一个匹配', searchClose: '关闭搜索' },
  'zh-TW': { searchPh: '在終端機中搜尋…', searchPrev: '上一個符合', searchNext: '下一個符合', searchClose: '關閉搜尋' },
  ja: { searchPh: 'ターミナル内を検索…', searchPrev: '前の一致', searchNext: '次の一致', searchClose: '検索を閉じる' },
  ko: { searchPh: '터미널에서 검색…', searchPrev: '이전 일치', searchNext: '다음 일치', searchClose: '검색 닫기' },
  es: { searchPh: 'Buscar en el terminal…', searchPrev: 'Coincidencia anterior', searchNext: 'Coincidencia siguiente', searchClose: 'Cerrar búsqueda' },
  fr: { searchPh: 'Rechercher dans le terminal…', searchPrev: 'Correspondance précédente', searchNext: 'Correspondance suivante', searchClose: 'Fermer la recherche' },
  de: { searchPh: 'Im Terminal suchen…', searchPrev: 'Vorheriger Treffer', searchNext: 'Nächster Treffer', searchClose: 'Suche schließen' },
  ru: { searchPh: 'Поиск в терминале…', searchPrev: 'Предыдущее совпадение', searchNext: 'Следующее совпадение', searchClose: 'Закрыть поиск' },
  'pt-BR': { searchPh: 'Pesquisar no terminal…', searchPrev: 'Correspondência anterior', searchNext: 'Próxima correspondência', searchClose: 'Fechar pesquisa' },
};

for (const [locale, dict] of Object.entries(translations)) {
  const file = path.join(folder, locale + '.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = keys.filter((k) => !(k in dict));
  if (missing.length) throw new Error(locale + ' missing: ' + missing.join(','));
  let added = 0;
  for (const key of keys) if (!(key in data.terminal)) { data.terminal[key] = dict[key]; added++; }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(locale, 'updated,', added);
}
