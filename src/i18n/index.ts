import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import ptBR from './locales/pt-BR.json';

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
  void import('../api').then(({ api }) => void api?.setAppLanguage(code));
}

const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
  ja: { translation: ja },
  ko: { translation: ko },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  ru: { translation: ru },
  'pt-BR': { translation: ptBR },
};

const lng = detectLanguage();
document.documentElement.lang = lng;

i18n.use(initReactI18next).init({
  resources,
  lng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

void import('../api').then(({ api }) => void api?.setAppLanguage(lng));

export default i18n;
