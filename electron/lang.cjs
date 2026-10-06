const languages = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt-BR'];
let appLanguage = 'en';
const catalogs = new Map();
const aliases = { done: 'main.transferDone', fail: 'main.transferFail', size: 'main.transferredSize', doneShort: 'main.transferDoneShort', up: 'main.kindUpload', down: 'main.kindDownload', relay: 'main.kindRelay' };
function catalog(language) {
  if (!catalogs.has(language)) catalogs.set(language, require('../src/i18n/locales/' + language + '.json'));
  return catalogs.get(language);
}
function supported(language) { return languages.includes(language); }
function setLanguage(language) {
  if (!supported(language)) return false;
  catalog(language);
  appLanguage = language;
  return true;
}
function getLanguage() { return appLanguage; }
function t(key, vars = {}) {
  const resolved = aliases[key] || (key.includes('.') ? key : 'backend.' + key);
  const get = (data) => resolved.split('.').reduce((value, part) => value && value[part], data);
  const text = get(catalog(appLanguage)) || get(catalog('en'));
  if (typeof text !== 'string') throw new Error('Unknown native translation: ' + resolved);
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
}
module.exports = { supported, languages, setLanguage, getLanguage, t };
