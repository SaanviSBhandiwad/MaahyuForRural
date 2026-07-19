// ============================================================
// MAAHYU — Settings screen logic
// Only two real settings exist per the brief: language and
// voice on/off. "Share with a trusted person" is included as a
// visible, OFF-by-default toggle — deliberately not wired to
// any automatic sharing, since the brief requires this to never
// happen without an explicit, separate action from the user.
// ============================================================
import { bootApp, activateTab } from "./app.js";
import { SUPPORTED_LANGUAGES, getStoredLanguage, setStoredLanguage, loadLanguage, applyTranslations } from "./i18n.js";

const VOICE_KEY = "maahyu:voiceEnabled";
const langMeta = {
  en: { glyph: "A", label: "English" },
  hi: { glyph: "अ", label: "हिंदी" },
  kn: { glyph: "ಅ", label: "ಕನ್ನಡ" }
};

async function init() {
  await bootApp();
  activateTab("settings");
  renderLangList();
  wireVoiceSwitch();
  wireShareSwitch();
}

function renderLangList() {
  const list = document.getElementById("langList");
  const current = getStoredLanguage() || "en";
  list.innerHTML = "";
  SUPPORTED_LANGUAGES.forEach((code) => {
    const row = document.createElement("button");
    row.className = "lang-select-row" + (code === current ? " is-selected" : "");
    row.innerHTML = `<span>${langMeta[code].glyph}  ${langMeta[code].label}</span>${code === current ? "✓" : ""}`;
    row.addEventListener("click", async () => {
      setStoredLanguage(code);
      await loadLanguage(code);
      applyTranslations();
      renderLangList();
    });
    list.appendChild(row);
  });
}

function wireVoiceSwitch() {
  const el = document.getElementById("voiceSwitch");
  const stored = localStorage.getItem(VOICE_KEY);
  const isOn = stored === null ? true : stored === "true";
  setSwitch(el, isOn);
  el.addEventListener("click", () => {
    const nowOn = !el.classList.contains("is-on");
    setSwitch(el, nowOn);
    localStorage.setItem(VOICE_KEY, String(nowOn));
  });
}

function wireShareSwitch() {
  const el = document.getElementById("shareSwitch");
  setSwitch(el, false); // always starts off; no persistence of an auto-share preference
  el.addEventListener("click", () => {
    const nowOn = !el.classList.contains("is-on");
    setSwitch(el, nowOn);
    // Intentionally not implemented further: sharing requires
    // picking a specific trusted contact per entry, not a
    // blanket auto-share toggle. This switch is a visible
    // placeholder for that future flow.
  });
}

function setSwitch(el, isOn) {
  el.classList.toggle("is-on", isOn);
  el.setAttribute("aria-checked", String(isOn));
}

init();
