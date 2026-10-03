// ============================================================
// MAAHYU — Shared app bootstrap
// Runs on every screen: signs the user in anonymously, loads
// the chosen language, and wires the offline banner.
// ============================================================
import { ensureSignedIn } from "./firebase-init.js";
import { getStoredLanguage, loadLanguage, applyTranslations } from "./i18n.js";
import { startAutoSync } from "./offline-queue.js";

/**
 * @returns {Promise<string>} the active language code
 */
export async function bootApp() {
  const lang = getStoredLanguage() || "en";
  await Promise.all([ensureSignedIn(), loadLanguage(lang)]);
  applyTranslations();
  wireOfflineBanner();
  startAutoSync(); // send anything she said while offline
  return lang;
}

function wireOfflineBanner() {
  const banner = document.querySelector("[data-offline-banner]");
  if (!banner) return;
  const update = () => banner.classList.toggle("is-visible", !navigator.onLine);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

export function activateTab(name) {
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.classList.toggle("is-active", el.getAttribute("data-tab") === name);
  });
}
