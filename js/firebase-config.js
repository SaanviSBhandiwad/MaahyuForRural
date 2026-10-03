// ============================================================
// MAAHYU — Firebase + backend config
// Firebase itself is loaded in firebase-init.js; this file only
// holds the config values. Do not add import lines here.
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDCO1GXie7FRzJ2NTMhvS0yVKm3oaWjtcg",
  authDomain: "maahyuforrural-4163d.firebaseapp.com",
  projectId: "maahyuforrural-4163d",
  storageBucket: "maahyuforrural-4163d.firebasestorage.app",
  messagingSenderId: "668902808525",
  appId: "1:668902808525:web:6ac44ae08784b9a57b4284",
  measurementId: "G-HRME8KQRJ8"
};

// Backend base URL (backend/server.js). Endpoints used: /chat, /tts, /entries/sync.
// After deploying the backend, replace with its public URL.
// Leave blank to run fully offline (offline KB replies only, queued for later).
export const AI_ENDPOINT = "http://localhost:5000/chat";

// Set to true once Firebase Storage is enabled (Blaze plan).
export const STORAGE_ENABLED = false;
