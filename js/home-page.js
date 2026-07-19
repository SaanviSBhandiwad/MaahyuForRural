// ============================================================
// MAAHYU — Home screen logic
// ============================================================
import { bootApp, activateTab } from "./app.js";
import { t } from "./i18n.js";
import { VoiceRecorder, speak } from "./recorder.js";
import { scoreEntry, getReply } from "./mood-scoring.js";
import { db, auth } from "./firebase-init.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let lang = "en";
let recorder = null;
let isRecording = false;

const micBtn = document.getElementById("micBtn");
const micStatus = document.getElementById("micStatus");
const micRing = document.getElementById("micRing");
const chipRow = document.getElementById("chipRow");
const replyArea = document.getElementById("replyArea");
const talkToSomeoneBtn = document.getElementById("talkToSomeoneBtn");
const connectModal = document.getElementById("connectModal");
const closeConnectModal = document.getElementById("closeConnectModal");

async function init() {
  lang = await bootApp();
  activateTab("home");
  recorder = new VoiceRecorder({ lang });
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
    chip.addEventListener("click", () => logQuickEntry(phrase));
    chipRow.appendChild(chip);
  });
}

micBtn.addEventListener("click", async () => {
  if (!isRecording) {
    await startRecording();
  } else {
    await stopRecording();
  }
});

async function startRecording() {
  try {
    await recorder.start();
  } catch (err) {
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

  const entry = await recorder.stopAndSave();
  micStatus.textContent = t("home.tapToStart");
  renderReply(entry.replyKey, entry.crisis);
}

/** Chip tap: logs a text-only entry (no audio) for a suggested phrase. */
async function logQuickEntry(phrase) {
  const scoring = scoreEntry(phrase);
  const user = auth.currentUser;
  const dayKey = new Date().toISOString().slice(0, 10);
  await addDoc(collection(db, "users", user.uid, "entries"), {
    dayKey,
    createdAt: serverTimestamp(),
    transcript: phrase,
    audioUrl: null,
    score: scoring.score,
    band: scoring.band,
    crisis: scoring.crisis,
    lang
  });
  renderReply(scoring.replyKey, scoring.crisis);
}

function renderReply(replyKey, crisis) {
  const replyText = getReply(lang, replyKey);
  speak(replyText, lang);

  replyArea.innerHTML = `
    <div class="reply-card">
      <div class="reply-card__label">${t("reply.label")}</div>
      <div class="reply-card__text">${escapeHtml(replyText)}</div>
      <button class="reply-card__play" id="playReplyBtn">🔊 ${t("reply.play")}</button>
    </div>
  `;
  document.getElementById("playReplyBtn").addEventListener("click", () => speak(replyText, lang));

  if (crisis) {
    replyArea.innerHTML += `
      <div class="escalation-banner">
        <strong>${t("escalation.title")}</strong>
        ${t("escalation.body")}
        <button class="btn-primary" id="escalateBtn">${t("escalation.cta")}</button>
      </div>
    `;
    document.getElementById("escalateBtn").addEventListener("click", openConnectModal);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function openConnectModal() {
  connectModal.classList.remove("hidden");
}
talkToSomeoneBtn.addEventListener("click", openConnectModal);
closeConnectModal.addEventListener("click", () => connectModal.classList.add("hidden"));

init();
