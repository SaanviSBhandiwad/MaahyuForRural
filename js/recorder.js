// ============================================================
// MAAHYU — Recorder
// Records a voice note with MediaRecorder, transcribes it with
// the browser's SpeechRecognition (Chrome / Edge / Android
// WebView) and optionally uploads the audio to Firebase Storage.
// It does NOT save entries: the backend pipeline does that.
// ============================================================
import { storage, auth } from "./firebase-init.js";
import { apiPost, canReachBackend } from "./api.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { STORAGE_ENABLED } from "./firebase-config.js";

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

// How long to wait after tapping stop for the final words to arrive.
const RECOGNITION_FINISH_TIMEOUT_MS = 3000;

export class VoiceRecorder {
  constructor({ lang = "en" } = {}) {
    this.lang = lang;
    this.mediaRecorder = null;
    this.chunks = [];
    this.transcript = "";
    this.recognition = null;
    this.recognitionEnded = null; // Promise that resolves when recognition fully stops
    this.stream = null;
  }

  async start() {
    this.chunks = [];
    this.transcript = "";
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();

    if (!SpeechRecognitionImpl) {
      console.warn("SpeechRecognition is not supported in this browser — use Chrome or Edge.");
      this.recognition = null;
      this.recognitionEnded = Promise.resolve();
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = this._speechLangTag();
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          this.transcript += event.results[i][0].transcript + " ";
        }
      }
    };
    recognition.onerror = (event) => {
      // "no-speech" = heard nothing; "network" = can't reach Google's speech service;
      // "not-allowed" = mic permission; "language-not-supported" = check the language.
      console.warn(`Speech recognition error (${recognition.lang}):`, event.error);
    };

    this.recognitionEnded = new Promise((resolve) => {
      recognition.onend = () => resolve();
    });

    this.recognition = recognition;
    try {
      recognition.start();
    } catch (err) {
      console.warn("Speech recognition could not start:", err);
      this.recognitionEnded = Promise.resolve();
    }
  }

  /**
   * Stops recording, waits for the final transcript and uploads the
   * clip (if Storage is enabled). Returns { transcript, audioUrl, lang }.
   */
  async stopAndSave() {
    // Stop recognition first, then wait for Chrome to deliver the last words.
    if (this.recognition) {
      try { this.recognition.stop(); } catch (_) { /* ignore */ }
    }
    const audioBlob = await this._stopMediaRecorder();
    await Promise.race([
      this.recognitionEnded || Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, RECOGNITION_FINISH_TIMEOUT_MS))
    ]);
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }

    const transcript = this.transcript.trim();
    console.log("Transcript:", transcript || "(empty)");

    const user = auth.currentUser;
    let audioUrl = null;
    if (STORAGE_ENABLED && user && transcript) {
      try {
        const path = `voice-notes/${user.uid}/${Date.now()}.webm`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, audioBlob);
        audioUrl = await getDownloadURL(storageRef);
      } catch (err) {
        console.warn("Audio upload skipped (likely offline):", err);
      }
    }

    return { transcript, audioUrl, lang: this.lang };
  }

  _stopMediaRecorder() {
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: "audio/webm" }));
      };
      this.mediaRecorder.stop();
    });
  }

  _speechLangTag() {
    return { en: "en-IN", hi: "hi-IN", kn: "kn-IN" }[this.lang] || "en-IN";
  }
}

// ─── Speaking replies aloud ──────────────────────────────────────────────────
// 1. Backend Google Text-to-Speech (/tts) — proper Kannada & Hindi voices.
// 2. Fallback: the browser's own voice, ONLY if it has one for that language
//    (most Windows PCs have no Kannada/Hindi voice, and an English voice
//    would skip the words and just read out the emoji).
const SPEECH_LANG = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };
let currentAudio = null;

function stripEmojis(text) {
  return (text || "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();
}

function stopSpeaking() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

async function speakWithBackend(text, lang) {
  if (!canReachBackend()) return false;
  try {
    const { audio } = await apiPost("/tts", { text, lang }, { timeoutMs: 15000 });
    if (!audio) throw new Error("TTS returned no audio");
    currentAudio = new Audio(`data:audio/mp3;base64,${audio}`);
    await currentAudio.play();
    return true;
  } catch (err) {
    console.warn("Backend TTS unavailable, trying browser voice:", err.message || err);
    return false;
  }
}

function speakWithBrowser(text, lang) {
  if (!("speechSynthesis" in window)) return;
  const tag = SPEECH_LANG[lang] || "en-IN";
  const prefix = tag.split("-")[0];
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((v) => v.lang === tag) ||
                voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  if (!voice && prefix !== "en") {
    console.warn(`No ${tag} voice on this device — showing the reply as text only.`);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = tag;
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

/** Reads a reply out loud in her language. Respects the voice on/off setting. */
export async function speak(text, lang) {
  if (localStorage.getItem("maahyu:voiceEnabled") === "false") return;
  const clean = stripEmojis(text);
  if (!clean) return;
  stopSpeaking();
  const ok = await speakWithBackend(clean, lang);
  if (!ok) speakWithBrowser(clean, lang);
}
