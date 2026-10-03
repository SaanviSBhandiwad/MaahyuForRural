// ============================================================
// MAAHYU — Offline queue
// ------------------------------------------------------------
// When there's no signal, the app still answers her (offline KB),
// and the message is kept on the phone here. As soon as she's back
// online it's sent to POST /entries/sync, where the backend runs the
// full pipeline (scoring, risk, ASHA flag) and saves it — so nothing
// she said offline is lost or skipped by the risk logic.
// Each item has a clientId, so re-sending is always safe.
// ============================================================
import { apiPost, canReachBackend, rememberMotherId } from "./api.js";

const QUEUE_KEY = "maahyu:pendingEntries";
const MAX_QUEUE = 200;
let syncing = false;

function read() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}

function write(items) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE))); }
  catch (err) { console.warn("Offline queue full or unavailable:", err); }
}

function newClientId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Messages not yet saved on the server (for the calendar). */
export function readPending() {
  return read();
}

export function pendingCount() {
  return read().length;
}

/** @param {{ text, lang, reply, inputType, audioUrl }} item */
export function queueEntry(item) {
  const items = read();
  items.push({ clientId: newClientId(), clientTimestamp: Date.now(), ...item });
  write(items);
}

export async function syncPending() {
  if (syncing || !canReachBackend()) return;
  const items = read();
  if (!items.length) return;

  syncing = true;
  try {
    const sent = items.slice(0, 50);
    const { motherId, results = [] } = await apiPost("/entries/sync", { items: sent }, { timeoutMs: 60000 });
    rememberMotherId(motherId);
    // Every item the server answered for (saved, or rejected as invalid) is done.
    const done = new Set(results.map((r) => r.clientId));
    write(read().filter((i) => !done.has(i.clientId)));
    console.log(`Offline queue: synced ${done.size}, ${pendingCount()} left`);
    if (done.size && pendingCount()) setTimeout(syncPending, 2000); // next batch
  } catch (err) {
    console.warn("Offline sync will retry later:", err.message || err);
  } finally {
    syncing = false;
  }
}

let started = false;
export function startAutoSync() {
  if (started) return;
  started = true;
  window.addEventListener("online", () => syncPending());
  syncPending();
}
