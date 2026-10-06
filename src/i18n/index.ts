import i18n from 'i18next';
import { api } from '../api';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import type { BackendModule, ResourceKey } from 'i18next';

// 支持的语言（name 用各语言的母语写法，供下拉选择）
export const LANGUAGES: Array<{ code: string; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ru', name: 'Русский' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
];

const LS_KEY = 'sc.lang';

// 语言检测：用户选择 > 浏览器语言 > 英文
export function detectLanguage(): string {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
    const nav = (navigator.language || 'en').toLowerCase();
    if (nav.startsWith('zh')) {
      return /tw|hk|mo|hant/.test(nav) ? 'zh-TW' : 'zh-CN';
    }
    if (nav.startsWith('pt')) return 'pt-BR';
    const base = nav.split('-')[0];
    const hit = LANGUAGES.find((l) => l.code === base || l.code.split('-')[0] === base);
    return hit ? hit.code : 'en';
  } catch {
    return 'en';
  }
}

export function saveLanguage(code: string) {
  try {
    localStorage.setItem(LS_KEY, code);
  } catch {
    /* noop */
  }
  document.documentElement.lang = code;
  // 主进程通知也需要语言
  void api?.setAppLanguage(code).catch((error) => console.error('Language persistence failed', error));
}

const localeImports = import.meta.glob<ResourceKey>(['./locales/*.json', '!./locales/en.json'], { import: 'default' });
const backend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    const read = localeImports['./locales/' + language + '.json'];
    if (!read) { callback(new Error('Unknown locale: ' + language), false); return; }
    read().then((data) => callback(null, data)).catch((error) => callback(error, false));
  },
};

let languageRequest = 0;
export let initializationWarning = '';
async function resourcesFor(code: string) {
  if (!LANGUAGES.some((language) => language.code === code)) throw new Error('Unknown locale: ' + code);
  if (code === 'en') return en;
  return localeImports['./locales/' + code + '.json']();
}

export async function changeLanguage(code: string) {
  const request = ++languageRequest;
  const resources = await resourcesFor(code);
  if (request !== languageRequest) return;
  i18n.addResourceBundle(code, 'translation', resources, true, true);
  await i18n.changeLanguage(code);
}

async function initialize() {
  let lng = detectLanguage();
  try {
    const saved = localStorage.getItem(LS_KEY);
    const settings = await api?.getAppSettings();
    if (!LANGUAGES.some((language) => language.code === saved) && settings?.language && LANGUAGES.some((language) => language.code === settings.language)) lng = settings.language;
  } catch (error) { console.error('Language settings unavailable', error); }
  let selected;
  try { selected = await resourcesFor(lng); }
  catch (error) {
    initializationWarning = 'The selected language could not be loaded. English is shown; restart or select the language again. ' + String(error);
    console.error('Language initialization failed', error);
    lng = 'en'; selected = en;
  }
  await i18n.use(backend).use(initReactI18next).init({
  resources: { en: { translation: en }, [lng]: { translation: selected } },
  partialBundledLanguages: true,
  load: 'currentOnly',
  lng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  });
  if (!initializationWarning) saveLanguage(i18n.language);
  else document.documentElement.lang = i18n.language;
  i18n.on('languageChanged', saveLanguage);
}
export const ready = initialize();

export default i18n;
