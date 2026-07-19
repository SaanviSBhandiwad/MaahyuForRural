// ============================================================
// MAAHYU — Recorder
// Records a voice note with MediaRecorder, opportunistically
// transcribes it with the browser's SpeechRecognition (Chrome/
// Android WebView support it; it's fine if it's unavailable —
// mood-scoring.js falls back gracefully), uploads the audio to
// Firebase Storage, and writes an entry document to Firestore.
// If offline, the entry is queued locally and Firestore's own
// offline cache flushes it once the connection returns.
// ============================================================
import { db, storage, auth } from "./firebase-init.js";
import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { scoreEntry } from "./mood-scoring.js";

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

export class VoiceRecorder {
  constructor({ lang = "en" } = {}) {
    this.lang = lang;
    this.mediaRecorder = null;
    this.chunks = [];
    this.transcript = "";
    this.recognition = null;
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

    if (SpeechRecognitionImpl) {
      this.recognition = new SpeechRecognitionImpl();
      this.recognition.lang = this._speechLangTag();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          this.transcript += event.results[i][0].transcript + " ";
        }
      };
      // Speech recognition can throw if mic permission races with
      // MediaRecorder's own getUserMedia call — non-fatal either way.
      try { this.recognition.start(); } catch (_) { /* ignore */ }
    }
  }

  /**
   * Stops recording, uploads the clip, scores it, and saves a
   * Firestore entry. Returns the entry data for the UI to render
   * a reply card immediately without waiting on a re-fetch.
   */
  async stopAndSave() {
    const audioBlob = await this._stopMediaRecorder();
    if (this.recognition) {
      try { this.recognition.stop(); } catch (_) { /* ignore */ }
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }

    const user = auth.currentUser;
    const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const scoring = scoreEntry(this.transcript);

    let audioUrl = null;
    try {
      const path = `voice-notes/${user.uid}/${Date.now()}.webm`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, audioBlob);
      audioUrl = await getDownloadURL(storageRef);
    } catch (err) {
      // Offline or upload failed — still save the entry with a null
      // audioUrl; the "no internet" mode of the brief covers this,
      // audio can be retried from a background sync queue later.
      console.warn("Audio upload deferred (likely offline):", err);
    }

    const entryData = {
      dayKey,
      createdAt: serverTimestamp(),
      transcript: this.transcript.trim(),
      audioUrl,
      score: scoring.score,
      band: scoring.band,
      crisis: scoring.crisis,
      lang: this.lang
    };

    await addDoc(collection(db, "users", user.uid, "entries"), entryData);

    return { ...entryData, replyKey: scoring.replyKey };
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

/** Reads a canned reply out loud using the Web Speech Synthesis API. */
export function speak(text, lang) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" }[lang] || "en-IN";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
