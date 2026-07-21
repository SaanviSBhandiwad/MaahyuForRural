// ============================================================
// MAAHYU — Firebase + Gemini config
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDMs8ApuL5MV0BVglfSi4dIoRPhbuYLQoA",
  authDomain: "maahyuforrural.firebaseapp.com",
  projectId: "maahyuforrural",
  storageBucket: "maahyuforrural.firebasestorage.app",
  messagingSenderId: "296945872114",
  appId: "1:296945872114:web:14fc90d7f835553136b46b",
  measurementId: "G-H7RT88FB2G"
};

// ── Gemini API key ────────────────────────────────────────────────────────────
// Get from: https://aistudio.google.com/app/apikey
// After deploying: restrict this key to your domain in Google AI Studio
// (API key → HTTP referrer restriction → add your site URL)
// Leave blank → app still works, uses offline KB for all replies
export const GEMINI_API_KEY = ""; // ← PASTE YOUR KEY HERE

// (kept for backward compat — no longer used, Gemini called directly)
export const AI_ENDPOINT = "";
