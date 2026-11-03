import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import id from './locales/id.json';
import ms from './locales/ms.json';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, id: { translation: id }, ms: { translation: ms } },
  lng: localStorage.getItem('tb:customer:lang') ?? 'en',
  fallbackLng: 'en',
  // Locale files use single-brace placeholders ("{shown} of {total} shown")
  // with a mix of `t(key, vars)` and manual `.replace('{var}', v)` call
  // sites, so interpolation must match single braces. Existing `.replace()`
  // calls stay harmless: they run on already-interpolated strings (no-op)
  // or on placeholder strings when called without vars.
  interpolation: { prefix: '{', suffix: '}', escapeValue: false },
});
export default i18n;
