// ============================================================
// MAAHYU — i18n
// Tiny loader: fetches the locale JSON for the chosen language
// and exposes t('a.b.c') for dotted-path lookups. Selected
// language is stored in localStorage so every screen agrees on it.
// ============================================================

export const SUPPORTED_LANGUAGES = ["en", "hi", "kn"];
const STORAGE_KEY = "maahyu:lang";
let strings = null;

export function getStoredLanguage() {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredLanguage(code) {
  localStorage.setItem(STORAGE_KEY, code);
}

export async function loadLanguage(code) {
  const safeCode = SUPPORTED_LANGUAGES.includes(code) ? code : "en";
  const res = await fetch(`./locales/${safeCode}.json`);
  strings = await res.json();
  document.documentElement.lang = safeCode;
  return strings;
}

/** Dotted-path lookup, e.g. t('home.greeting') */
export function t(path) {
  if (!strings) return path;
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), strings) ?? path;
}

/** Applies data-i18n="path" text content to every matching element in the document. */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const value = t(el.getAttribute("data-i18n"));
    if (Array.isArray(value)) return; // handled manually (e.g. chip lists)
    el.textContent = value;
  });
}
