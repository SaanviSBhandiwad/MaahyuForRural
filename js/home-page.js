// ============================================================
// MAAHYU — Home screen logic
// ------------------------------------------------------------
// Voice note or chip → chat() → reply shown + spoken.
// Saving, scoring, risk and ASHA flags all happen on the backend
// (backend/lib/pipeline.js); offline messages are queued and
// synced by offline-queue.js.
// ============================================================
import { bootApp, activateTab } from "./app.js";
import { t } from "./i18n.js";
import { VoiceRecorder, speak } from "./recorder.js";
import { chat, resetSession } from "./gemini.js";

let lang = "en";
let recorder = null;
let isRecording = false;

const micBtn           = document.getElementById("micBtn");
const micStatus        = document.getElementById("micStatus");
const micRing          = document.getElementById("micRing");
const chipRow          = document.getElementById("chipRow");
const replyArea        = document.getElementById("replyArea");
const talkToSomeoneBtn = document.getElementById("talkToSomeoneBtn");
const connectModal     = document.getElementById("connectModal");
const closeConnectModal = document.getElementById("closeConnectModal");

async function init() {
  lang = await bootApp();
  activateTab("home");
  recorder = new VoiceRecorder({ lang });
  resetSession(); // Step 6: fresh escalation tracker each page load
  renderChips();
}

function renderChips() {
  const chips = t("home.chips");
  if (!Array.isArray(chips)) return;
  chipRow.innerHTML = "";
  chipRow.removeAttribute("aria-hidden");
  chips.forEach((phrase) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = phrase;
    chip.addEventListener("click", () => handleMessage(phrase, { inputType: "chip" }));
    chipRow.appendChild(chip);
  });
}

micBtn.addEventListener("click", async () => {
  if (!isRecording) await startRecording();
  else await stopRecording();
});

async function startRecording() {
  try { await recorder.start(); }
  catch (err) {
    console.error("Microphone access failed:", err);
    micStatus.textContent = "Microphone unavailable";
    return;
  }
  isRecording = true;
  micBtn.classList.add("is-recording");
  micBtn.setAttribute("aria-pressed", "true");
  micRing.classList.add("mic-ring--live");
  micStatus.textContent = t("home.listening");
}

async function stopRecording() {
  isRecording = false;
  micBtn.classList.remove("is-recording");
  micBtn.setAttribute("aria-pressed", "false");
  micRing.classList.remove("mic-ring--live");
  micStatus.textContent = t("home.processing");

  const recording = await recorder.stopAndSave();
  micStatus.textContent = t("home.tapToStart");

  await handleMessage(recording.transcript, { inputType: "voice", audioUrl: recording.audioUrl });
}

/** Used for both voice transcripts and chip taps. */
async function handleMessage(text, { inputType = "chip", audioUrl = null } = {}) {
  replyArea.innerHTML = `
    <div class="reply-card">
      <div class="reply-card__text" style="color:var(--text-onDark-muted);">SheRo is listening… 💛</div>
    </div>`;

  const { reply, escalation, queued } = await chat(text, lang, { inputType, audioUrl });
  speak(reply, lang);
  renderReply(reply, escalation, { queued });
}

const QUEUED_NOTE = {
  en: "Quick offline reply. Your message is saved on this phone and will be sent when you're back online.",
  hi: "यह ऑफ़लाइन जवाब है। आपका संदेश इस फ़ोन में सुरक्षित है और इंटरनेट आने पर भेज दिया जाएगा।",
  kn: "ಇದು ಆಫ್‌ಲೈನ್ ಉತ್ತರ. ನಿಮ್ಮ ಸಂದೇಶ ಈ ಫೋನ್‌ನಲ್ಲಿ ಸುರಕ್ಷಿತವಾಗಿದೆ, ಇಂಟರ್ನೆಟ್ ಬಂದಾಗ ಕಳುಹಿಸಲಾಗುತ್ತದೆ."
};

function renderReply(replyText, escalation, { queued = false } = {}) {
  replyArea.innerHTML = `
    <div class="reply-card">
      <div class="reply-card__label">${t("reply.label")}</div>
      <div class="reply-card__text">${escapeHtml(replyText)}</div>
      <button class="reply-card__play" id="playReplyBtn">🔊 ${t("reply.play")}</button>
      ${queued ? `<p class="reply-card__note">${escapeHtml(QUEUED_NOTE[lang] || QUEUED_NOTE.en)}</p>` : ""}
    </div>
  `;
  document.getElementById("playReplyBtn").addEventListener("click", () => speak(replyText, lang));

  // Show escalation banner — urgent uses existing .escalation-banner style
  if (escalation && escalation.level !== "none" && escalation.message) {
    const isUrgent = escalation.level === "urgent";
    replyArea.innerHTML += `
      <div class="escalation-banner${isUrgent ? "" : " escalation-banner--suggest"}">
        <strong>${isUrgent ? t("escalation.title") : "SheRo suggests:"}</strong>
        ${escapeHtml(escalation.message)}
        ${isUrgent ? `<button class="btn-primary" id="escalateBtn">${t("escalation.cta")}</button>` : ""}
      </div>
    `;
    if (isUrgent) {
      document.getElementById("escalateBtn")?.addEventListener("click", openConnectModal);
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function openConnectModal() { connectModal.classList.remove("hidden"); }
talkToSomeoneBtn.addEventListener("click", openConnectModal);
closeConnectModal.addEventListener("click", () => connectModal.classList.add("hidden"));

init();
