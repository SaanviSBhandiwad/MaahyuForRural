// ============================================================
// MAAHYU — Firebase configuration
// ------------------------------------------------------------
// 1. Go to https://console.firebase.google.com → create a project
// 2. Add a Web App (</> icon) → copy the config object it gives you
//    and paste the values below.
// 3. Enable these products in the Firebase console:
//      - Authentication → Sign-in method → Anonymous (turn ON)
//      - Firestore Database → create database (production mode)
//      - Storage → get started (for voice note audio files)
// 4. Paste the Firestore + Storage security rules from
//    /firebase-rules/firestore.rules and /firebase-rules/storage.rules
//    into the Firebase console (Firestore/Storage → Rules tab).
// ============================================================

export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

// ------------------------------------------------------------
// Optional: server-side AI endpoint.
// This app ships with a local, offline-friendly mood scorer
// (js/mood-scoring.js) so it works out of the box with ZERO
// backend. If your team later stands up a small serverless
// function (Cloud Function / Render web service) that wraps
// Gemini for richer replies, point this at it. Leave blank to
// keep everything running on the local scorer only.
// ------------------------------------------------------------
export const AI_ENDPOINT = ""; // e.g. "https://your-function-url/chat"
