/**
 * Lightweight i18n (internationalization) support for WenShape frontend.
 *
 * Usage:
 *   import { t, setLocale, getLocale } from '../i18n';
 *   const label = t('session.start');  // => "开始写作" or "Start Writing"
 *
 *   // React components: use useLocale() for reactive re-renders on switch
 *   import { useLocale } from '../i18n';
 *   const { locale, setLocale, t } = useLocale();
 */

import { useSyncExternalStore } from 'react';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

const LOCALE_KEY = 'wenshape_locale';

const bundles = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

function safeStorageGet(key, fallback = null) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return fallback;
    }
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

let currentLocale = safeStorageGet(LOCALE_KEY, 'zh-CN') || 'zh-CN';
let currentBundle = bundles[currentLocale] || zhCN;

// --- Pub/Sub for reactive locale updates ---

const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((fn) => fn());
}

// --- Public API ---

/**
 * Get translation by dot-path key.
 * Falls back to zh-CN, then returns the key itself.
 *
 * @param {string} key - Dot-separated key, e.g. "session.start"
 * @param {Object} [params] - Interpolation params, e.g. { count: 3 }
 * @returns {string}
 */
export function t(key, params) {
  let value = _resolve(currentBundle, key) ?? _resolve(zhCN, key) ?? key;
  if (params && typeof value === 'string') {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}

/**
 * Set the active locale and notify all subscribers.
 * @param {string} locale - e.g. "zh-CN" or "en-US"
 */
export function setLocale(locale) {
  if (!bundles[locale]) return;
  currentLocale = locale;
  currentBundle = bundles[locale];
  safeStorageSet(LOCALE_KEY, locale);
  emitChange();
}

/**
 * Get current locale identifier.
 * @returns {string}
 */
export function getLocale() {
  return currentLocale;
}

/**
 * Get list of supported locales.
 * @returns {string[]}
 */
export function getSupportedLocales() {
  return Object.keys(bundles);
}

/**
 * React Hook: returns current locale and helpers; triggers re-render on switch.
 *
 * @returns {{ locale: string, setLocale: Function, t: Function }}
 *
 * @example
 * function MyComponent() {
 *   const { locale, setLocale, t } = useLocale();
 *   return <button onClick={() => setLocale('en-US')}>{t('common.save')}</button>;
 * }
 */
export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getLocale);
  return { locale, setLocale, t };
}

// --- internal ---

function _resolve(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}
