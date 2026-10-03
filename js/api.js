// ============================================================
// MAAHYU — Backend API helper
// Every call carries her Firebase ID token, so the backend knows
// who she is without trusting anything in the request body.
// ============================================================
import { AI_ENDPOINT } from "./firebase-config.js";
import { auth } from "./firebase-init.js";

const MOTHER_KEY = "maahyu:mother"; // { uid, motherId }

/** "http://localhost:5000/chat" → "http://localhost:5000" ("" = offline-only mode) */
export function apiBase() {
  return AI_ENDPOINT ? AI_ENDPOINT.replace(/\/chat\/?$/, "").replace(/\/$/, "") : "";
}

export function canReachBackend() {
  return Boolean(apiBase()) && navigator.onLine && Boolean(auth.currentUser);
}

async function request(method, path, body, timeoutMs) {
  if (!apiBase()) throw new Error("No backend configured");
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in yet");
  const token = await user.getIdToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiBase() + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`${path} responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const apiPost = (path, body, { timeoutMs = 20000 } = {}) => request("POST", path, body, timeoutMs);
export const apiGet = (path, { timeoutMs = 10000 } = {}) => request("GET", path, null, timeoutMs);

// ── Her mother id (the key of mothers/{motherId}) ───────────────────────────
export function rememberMotherId(motherId) {
  const uid = auth.currentUser?.uid;
  if (!uid || !motherId) return;
  try { localStorage.setItem(MOTHER_KEY, JSON.stringify({ uid, motherId })); } catch { /* ignore */ }
}

/** Best known id without a network call. */
export function getMotherId() {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(MOTHER_KEY) || "null");
    if (saved && saved.uid === uid && saved.motherId) return saved.motherId;
  } catch { /* ignore */ }
  return `app_${uid}`;
}

/** Asks the backend (which also creates her profile if needed). */
export async function refreshMotherId() {
  if (!canReachBackend()) return getMotherId();
  try {
    const { motherId } = await apiGet("/me");
    rememberMotherId(motherId);
    return motherId;
  } catch (err) {
    console.warn("Could not refresh mother id:", err.message || err);
    return getMotherId();
  }
}
