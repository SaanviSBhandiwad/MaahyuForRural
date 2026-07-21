// ============================================================
// MAAHYU — Home screen logic  (Person C additions wired in)
// ------------------------------------------------------------
// Changes from original:
//   + imports chat() from gemini.js  (Steps 1,2,5,6)
//   + imports logEntry() from conversation-logger.js  (Step 8)
//   + imports resetSession() for session tracking  (Step 6)
//   + scorePHQ9Full() used inside logEntry  (Step 3)
//   + chip taps now go through the full AI pipeline too
// Everything else (UI, DOM, recorder, Firestore entries schema)
// is IDENTICAL to the original so no HTML/CSS changes needed.
// ============================================================
import { bootApp, activateTab } from "./app.js";
import { t } from "./i18n.js";
import { VoiceRecorder, speak } from "./recorder.js";
import { scoreEntry, scorePHQ9Full, getReply } from "./mood-scoring.js";
import { chat, resetSession } from "./gemini.js";
import { logEntry } from "./conversation-logger.js";
import { db, auth } from "./firebase-init.js";
import {
  collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
    chip.addEventListener("click", () => handleMessage(phrase));
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

  const entry = await recorder.stopAndSave();
  micStatus.textContent = t("home.tapToStart");

  // Run the full Person C pipeline on the transcript
  await handleMessage(entry.transcript || "");
}

/**
 * Central handler — runs all Person C steps on any text input.
 * Used for both voice transcripts and chip taps.
 */
async function handleMessage(text) {
  // Show thinking state immediately
  replyArea.innerHTML = `
    <div class="reply-card">
      <div class="reply-card__text" style="color:var(--text-onDark-muted);">SheRo is listening… 💛</div>
    </div>`;

  // Steps 1+2+5+6: Gemini (with RAG grounding + offline fallback + escalation)
  const { reply, escalation, offlineSource, sources } = await chat(text, lang);

  // Speak the reply
  speak(reply, lang);

  // Render reply + optional escalation banner (same DOM structure as original)
  renderReply(reply, escalation);

  // Step 3 result for logging
  const phq9 = scorePHQ9Full(text);

  // Step 8: log to Firestore (fire-and-forget)
  logEntry({
    transcript:      text,
    aiReply:         reply,
    phq9Result:      phq9,
    escalationLevel: escalation.level,
    offlineSource,
    ragSources:      sources
  });

  // Keep existing "entries" collection write so mood calendar still works
  const scoring = scoreEntry(text);
  const user = auth.currentUser;
  if (user) {
    addDoc(collection(db, "users", user.uid, "entries"), {
      dayKey:    new Date().toISOString().slice(0, 10),
      createdAt: serverTimestamp(),
      transcript: text,
      audioUrl:  null,
      score:     scoring.score,
      band:      scoring.band,
      crisis:    scoring.crisis,
      lang
    }).catch(() => {});
  }
}

function renderReply(replyText, escalation) {
  replyArea.innerHTML = `
    <div class="reply-card">
      <div class="reply-card__label">${t("reply.label")}</div>
      <div class="reply-card__text">${escapeHtml(replyText)}</div>
      <button class="reply-card__play" id="playReplyBtn">🔊 ${t("reply.play")}</button>
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
