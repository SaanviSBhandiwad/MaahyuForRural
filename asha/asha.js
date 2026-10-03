// ============================================================
// MAAHYU — ASHA dashboard
// ------------------------------------------------------------
// Phone + OTP sign-in → flagged mothers in her village → detail
// (mood trend, concerns, flagged messages) → notes / follow-up.
// All data comes from the backend's /asha API, which enforces
// that she only sees her own village.
//
// Offline: the last list and opened mothers are kept on the
// phone, and notes written offline are queued and sent later.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { firebaseConfig, AI_ENDPOINT } from "../js/firebase-config.js";

// A separately named Firebase app, so signing in here never signs out
// the mothers' app if both are open in the same browser.
const app = initializeApp(firebaseConfig, "asha-dashboard");
const auth = getAuth(app);
const API = AI_ENDPOINT ? AI_ENDPOINT.replace(/\/chat\/?$/, "").replace(/\/$/, "") : "";

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback = null) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
};

let profile = null;   // { name, village }
let mothers = [];
let filter = "followup";
let currentMotherId = null;
let confirmation = null;

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function ago(ms) {
  if (!ms) return "never";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function waiting(ms) {
  if (!ms) return "";
  const days = Math.floor((Date.now() - ms) / 86400000);
  return days < 1 ? "since today" : `waiting ${days} day${days > 1 ? "s" : ""}`;
}

function dateTime(ms) {
  return ms ? new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
}

function displayName(m) {
  return m.displayName || m.phoneMasked || (m.channels?.includes("app") ? "App user" : "Mother");
}

const STAGE_LABELS = {
  pregnant: "Pregnant",
  "0-2weeks": "0–2 weeks after birth",
  "2-6weeks": "2–6 weeks after birth",
  "6weeks+": "6+ weeks after birth"
};
const LANG_LABELS = { en: "English", hi: "हिंदी", kn: "ಕನ್ನಡ" };

function showView(name) {
  for (const v of ["loginView", "listView", "detailView"]) $(v).hidden = v !== name;
  window.scrollTo(0, 0);
}

function updateOfflineStrip() {
  $("offlineStrip").hidden = navigator.onLine;
}

// ── API ─────────────────────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(method, path, body) {
  if (!API) throw new ApiError(0, "No backend configured in js/firebase-config.js");
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, "Not signed in");
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(`${API}/asha${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch {
    throw new ApiError(0, "Can't reach the server");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Error ${res.status}`);
  return data;
}

// ── Sign in ─────────────────────────────────────────────────────────────────
function loginError(msg) {
  $("loginError").textContent = msg || "";
}

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("invalid-phone-number")) return "Please enter a valid 10-digit mobile number.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a while and try again.";
  if (code.includes("invalid-verification-code")) return "That code is not correct. Please check and try again.";
  if (code.includes("code-expired")) return "The code expired. Please request a new one.";
  if (code.includes("operation-not-allowed")) {
    return /region/i.test(err?.message || "")
      ? "SMS to India isn't allowed yet. Firebase console → Authentication → Settings → SMS region policy → allow India."
      : "Phone sign-in is not enabled for this project yet (Firebase console → Authentication → Sign-in method → Phone).";
  }
  if (code.includes("billing")) return "Sending real SMS needs the Firebase Blaze plan. Use a test phone number for now.";
  if (code.includes("network")) return "No internet connection. Please try again when you're online.";
  return "Something went wrong. Please try again.";
}

let recaptcha = null;
function getRecaptcha() {
  if (!recaptcha) recaptcha = new RecaptchaVerifier(auth, "recaptcha", { size: "invisible" });
  return recaptcha;
}

/** After a failed attempt, start with a brand-new reCAPTCHA so "Send OTP" can be retried. */
function resetRecaptcha() {
  try { recaptcha?.clear(); } catch { /* already cleared */ }
  recaptcha = null;
  const old = $("recaptcha");
  const fresh = document.createElement("div");
  fresh.id = "recaptcha";
  old.replaceWith(fresh);
}

$("phoneForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError("");
  const digits = $("phoneInput").value.replace(/\D/g, "");
  if (digits.length !== 10) return loginError("Please enter a valid 10-digit mobile number.");
  const phone = `+91${digits}`;
  $("sendOtpBtn").disabled = true;
  $("sendOtpBtn").textContent = "Sending…";
  try {
    confirmation = await signInWithPhoneNumber(auth, phone, getRecaptcha());
    $("otpPhone").textContent = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    $("phoneForm").hidden = true;
    $("otpForm").hidden = false;
    $("otpInput").focus();
  } catch (err) {
    console.warn("OTP send failed:", err);
    loginError(friendlyAuthError(err));
    resetRecaptcha();
  } finally {
    $("sendOtpBtn").disabled = false;
    $("sendOtpBtn").textContent = "Send OTP";
  }
});

$("otpForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError("");
  const code = $("otpInput").value.replace(/\D/g, "");
  if (code.length !== 6) return loginError("Please enter the 6-digit code.");
  $("verifyBtn").disabled = true;
  try {
    await confirmation.confirm(code); // onAuthStateChanged takes it from here
  } catch (err) {
    console.warn("OTP verify failed:", err);
    loginError(friendlyAuthError(err));
  } finally {
    $("verifyBtn").disabled = false;
  }
});

$("changeNumberBtn").addEventListener("click", () => {
  resetRecaptcha();
  $("otpForm").hidden = true;
  $("phoneForm").hidden = false;
  $("otpInput").value = "";
  loginError("");
});

$("signOutBtn").addEventListener("click", async () => {
  if (pendingNotes().length && !confirm("Some notes haven't been sent yet. Sign out anyway? They will be lost.")) return;
  for (const key of Object.keys(localStorage)) if (key.startsWith("asha:")) store.remove(key);
  await signOut(auth);
});

function resetLogin() {
  $("phoneForm").hidden = false;
  $("otpForm").hidden = true;
  $("otpInput").value = "";
  showView("loginView");
}

// ── Mothers list ────────────────────────────────────────────────────────────
function renderList() {
  const followUp = mothers.filter((m) => m.needsFollowUp);
  $("statHigh").textContent = followUp.filter((m) => m.followUpPriority === "high").length;
  $("statFollow").textContent = followUp.length;
  $("statTotal").textContent = mothers.length;

  const shown = filter === "followup" ? followUp : mothers;
  $("motherList").innerHTML = shown.map((m) => {
    const level = m.needsFollowUp ? (m.followUpPriority === "high" ? "high" : "medium") : "";
    const badge = m.needsFollowUp
      ? `<span class="badge badge--${level}">${level === "high" ? "Urgent" : "Follow up"}</span>`
      : `<span class="badge badge--ok">OK</span>`;
    const reason = m.needsFollowUp ? (m.followUpReason || "Flagged for follow-up") : (m.riskTier ? `Risk: ${m.riskTier}` : "");
    return `
      <li>
        <button class="mother-card ${level ? `is-${level}` : ""}" data-id="${escapeHtml(m.id)}">
          <span class="mother-card__name">${escapeHtml(displayName(m))}</span>
          ${badge}
          ${reason ? `<span class="mother-card__reason">${escapeHtml(reason)}</span>` : ""}
          <span class="mother-card__meta">
            <span>Last check-in ${ago(m.lastMessageAt)}</span>
            ${m.needsFollowUp ? `<span>${waiting(m.followUpSince)}</span>` : ""}
            <span>${(m.channels || []).map((c) => (c === "whatsapp" ? "WhatsApp" : "App")).join(" · ")}</span>
          </span>
        </button>
      </li>`;
  }).join("");

  const empty = $("emptyState");
  empty.hidden = shown.length > 0;
  empty.textContent = filter === "followup"
    ? (mothers.length ? "No one needs follow-up right now. 💛" : "")
    : "";
  if (!mothers.length) {
    empty.hidden = false;
    empty.textContent = `No mothers are linked to ${profile?.village || "your village"} yet.`;
  }
}

function setUpdatedLine(fetchedAt, fromCache) {
  $("updatedLine").textContent = fetchedAt
    ? `${fromCache ? "Saved list from" : "Updated"} ${ago(fetchedAt)}${pendingNotes().length ? ` · ${pendingNotes().length} note(s) waiting to send` : ""}`
    : "";
}

async function loadList() {
  const cached = store.get("asha:list");
  if (cached) {
    mothers = cached.mothers;
    renderList();
    setUpdatedLine(cached.fetchedAt, true);
  }
  try {
    await flushNotes();
    const data = await api("GET", "/mothers");
    mothers = data.mothers;
    store.set("asha:list", data);
    applyPendingResolves();
    renderList();
    setUpdatedLine(data.fetchedAt, false);
  } catch (err) {
    if (err.status === 401 || err.status === 403) return handleAuthFailure(err);
    if (!cached) {
      $("emptyState").hidden = false;
      $("emptyState").textContent = `Couldn't load the list: ${err.message}.`;
    }
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    filter = tab.dataset.filter;
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("is-active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    });
    renderList();
  });
});

$("refreshBtn").addEventListener("click", loadList);
$("motherList").addEventListener("click", (e) => {
  const card = e.target.closest(".mother-card");
  if (card) openMother(card.dataset.id);
});

// ── Mother detail ───────────────────────────────────────────────────────────
function moodChart(trend) {
  const days = 30;
  const today = new Date();
  const slots = [];
  const byDay = Object.fromEntries(trend.map((t) => [t.day, t.score]));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    slots.push({ key, score: byDay[key] });
  }
  const W = 300, H = 90, slot = W / days, maxScore = 27;
  const bars = slots.map((s, i) => {
    if (s.score === undefined) {
      return `<circle cx="${(i + 0.5) * slot}" cy="${H - 3}" r="1.2" fill="var(--blush-deep)"/>`;
    }
    const h = Math.max(4, (s.score / maxScore) * (H - 10));
    const color = s.score >= 10 ? "var(--berry-700)" : s.score >= 5 ? "var(--apricot-300)" : "var(--mood-good)";
    return `<rect x="${i * slot + 1.5}" y="${H - h}" width="${slot - 3}" height="${h}" rx="2" fill="${color}"><title>${s.key}: distress ${s.score}/27</title></rect>`;
  }).join("");
  return `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distress level for each day over the last 30 days">${bars}</svg>
    <div class="chart-legend">
      <span><i style="background:var(--mood-good)"></i>Doing okay</span>
      <span><i style="background:var(--apricot-300)"></i>Some distress</span>
      <span><i style="background:var(--berry-700)"></i>High distress</span>
      <span>· = no check-in</span>
    </div>`;
}

function renderDetail(d) {
  const m = d.mother;
  const level = m.needsFollowUp ? (m.followUpPriority === "high" ? "high" : "medium") : "";
  const facts = [
    m.pregnancyStage ? STAGE_LABELS[m.pregnancyStage] : null,
    m.language ? LANG_LABELS[m.language] : null,
    (m.channels || []).map((c) => (c === "whatsapp" ? "WhatsApp" : "App")).join(" + ")
  ].filter(Boolean).join(" · ");

  $("detailBody").innerHTML = `
    <section class="detail-head">
      <h1>${escapeHtml(displayName(m))}</h1>
      <div class="badges">
        ${m.needsFollowUp ? `<span class="badge badge--${level}">${level === "high" ? "Urgent" : "Follow up"} · ${escapeHtml(waiting(m.followUpSince))}</span>` : `<span class="badge badge--ok">No follow-up needed</span>`}
        ${m.riskTier ? `<span class="badge badge--risk-${escapeHtml(m.riskTier)}">Risk: ${escapeHtml(m.riskTier)}</span>` : ""}
      </div>
      ${m.needsFollowUp ? `<p class="reason">${escapeHtml(m.followUpReason || "Flagged for follow-up")}</p>` : ""}
      <p class="muted small">${escapeHtml(facts)} · last check-in ${ago(m.lastMessageAt)} · ${d.checkIns} check-ins in 30 days</p>
      ${m.phone ? `<div class="contact">
        <a class="btn btn--primary" href="tel:${escapeHtml(m.phone)}">📞 Call</a>
        <a class="btn btn--ghost" href="https://wa.me/${escapeHtml(m.phone.replace(/\D/g, ""))}" target="_blank" rel="noopener">WhatsApp</a>
      </div>` : `<p class="muted small">App user without a verified phone number. Please follow up in person.</p>`}
    </section>

    <section class="panel">
      <h2>How she has been (last 30 days)</h2>
      ${d.moodTrend.length ? moodChart(d.moodTrend) : `<p class="muted">No check-ins in the last 30 days.</p>`}
    </section>

    <section class="panel">
      <h2>What she's been struggling with</h2>
      ${d.concerns.length ? `<ul class="concerns">${d.concerns.map((c) => `
        <li class="${c.domain === "Q9_selfharm" ? "is-selfharm" : ""}">
          <span>${escapeHtml(c.label)}</span><span>${c.days} day${c.days > 1 ? "s" : ""}</span>
        </li>`).join("")}</ul>` : `<p class="muted">Nothing worrying picked up in her check-ins.</p>`}
      ${d.drivingFactors?.length ? `<p class="muted small" style="margin-top:12px">Risk factors: ${escapeHtml(d.drivingFactors.join("; "))}</p>` : ""}
    </section>

    ${d.flaggedMessages.length ? `<section class="panel">
      <h2>Messages that raised a flag</h2>
      <p class="muted small" style="margin:-4px 0 12px">Only these are shown. The rest of her diary stays private.</p>
      <ul class="flagged">${d.flaggedMessages.map((f) => `
        <li class="${f.severity === "high" ? "is-high" : ""}">
          <q>${escapeHtml(f.text)}</q>
          <span class="when">${dateTime(f.at)} · ${f.channel === "whatsapp" ? "WhatsApp" : "App"}</span>
        </li>`).join("")}</ul>
    </section>` : ""}

    <section class="panel">
      <h2>Follow-up notes</h2>
      ${d.notes.length ? `<ul class="notes">${d.notes.map((n) => `
        <li>
          <div>${escapeHtml(n.note)}</div>
          <div class="when">${n.at ? dateTime(n.at) : "Waiting to send"}${n.ashaName ? ` · ${escapeHtml(n.ashaName)}` : ""}${n.resolved ? " · ✅ followed up" : ""}</div>
        </li>`).join("")}</ul>` : `<p class="muted">No notes yet.</p>`}
    </section>`;

  $("resolveBtn").hidden = !m.needsFollowUp;
}

async function openMother(id) {
  currentMotherId = id;
  $("noteInput").value = "";
  $("noteStatus").textContent = "";
  showView("detailView");
  const cached = store.get(`asha:detail:${id}`);
  if (cached) renderDetail(withPendingNotes(cached));
  else $("detailBody").innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const data = await api("GET", `/mothers/${encodeURIComponent(id)}`);
    store.set(`asha:detail:${id}`, data);
    if (currentMotherId === id) renderDetail(withPendingNotes(data));
  } catch (err) {
    if (err.status === 401 || err.status === 403) return handleAuthFailure(err);
    if (!cached) $("detailBody").innerHTML = `<p class="muted">Couldn't load her details: ${escapeHtml(err.message)}.</p>`;
  }
}

$("backBtn").addEventListener("click", () => {
  currentMotherId = null;
  showView("listView");
  renderList();
});

// ── Notes (queued, so they work offline) ────────────────────────────────────
function pendingNotes() {
  return store.get("asha:pendingNotes", []);
}

function newClientId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function withPendingNotes(detail) {
  const mine = pendingNotes().filter((n) => n.motherId === detail.mother.id);
  if (!mine.length) return detail;
  const resolved = mine.some((n) => n.resolve);
  return {
    ...detail,
    mother: resolved ? { ...detail.mother, needsFollowUp: false } : detail.mother,
    notes: [...mine.map((n) => ({ note: n.note || "Marked as followed up.", resolved: n.resolve, at: null })).reverse(), ...detail.notes]
  };
}

function applyPendingResolves() {
  const resolvedIds = new Set(pendingNotes().filter((n) => n.resolve).map((n) => n.motherId));
  mothers = mothers.map((m) => (resolvedIds.has(m.id) ? { ...m, needsFollowUp: false } : m));
}

let flushing = false;
async function flushNotes() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const item of pendingNotes()) {
      try {
        await api("POST", `/mothers/${encodeURIComponent(item.motherId)}/notes`, {
          note: item.note, resolve: item.resolve, clientId: item.clientId
        });
        store.set("asha:pendingNotes", pendingNotes().filter((n) => n.clientId !== item.clientId));
      } catch (err) {
        if (err.status === 0 || err.status === 401 || err.status >= 500) break; // retry later
        // 400/403/404: this note can never be saved — drop it.
        store.set("asha:pendingNotes", pendingNotes().filter((n) => n.clientId !== item.clientId));
      }
    }
  } finally {
    flushing = false;
  }
}

async function addNote(resolve) {
  const note = $("noteInput").value.trim();
  if (!note && !resolve) {
    $("noteStatus").textContent = "Please write a note first.";
    return;
  }
  const id = currentMotherId;
  store.set("asha:pendingNotes", [...pendingNotes(), { clientId: newClientId(), motherId: id, note, resolve, at: Date.now() }]);
  $("noteInput").value = "";
  $("saveNoteBtn").disabled = $("resolveBtn").disabled = true;

  await flushNotes();
  const stillPending = pendingNotes().some((n) => n.motherId === id);
  $("noteStatus").textContent = stillPending
    ? "Saved on this phone. It will be sent when you're back online."
    : (resolve ? "Marked as followed up. ✅" : "Note saved. ✅");
  $("saveNoteBtn").disabled = $("resolveBtn").disabled = false;

  if (resolve) {
    mothers = mothers.map((m) => (m.id === id ? { ...m, needsFollowUp: false } : m));
    const cachedList = store.get("asha:list");
    if (cachedList) store.set("asha:list", { ...cachedList, mothers });
  }
  if (stillPending) {
    const cached = store.get(`asha:detail:${id}`);
    if (cached) renderDetail(withPendingNotes(cached));
  } else {
    openMother(id); // reload from the server
  }
}

$("saveNoteBtn").addEventListener("click", () => addNote(false));
$("resolveBtn").addEventListener("click", () => addNote(true));

// ── Session ─────────────────────────────────────────────────────────────────
async function handleAuthFailure(err) {
  if (err.status === 403) {
    await signOut(auth);
    resetLogin();
    loginError(err.message);
    return;
  }
  // 401 while offline-capable: keep showing cached data; sign-in is needed online.
  if (navigator.onLine) {
    await signOut(auth);
    resetLogin();
    loginError("Your session expired. Please sign in again.");
  }
}

async function startSession() {
  showView("listView");
  const cachedProfile = store.get("asha:profile");
  if (cachedProfile) {
    profile = cachedProfile;
    $("ashaLine").textContent = `${profile.name ? `Namaste, ${profile.name} · ` : ""}${profile.village}`;
  }
  try {
    profile = await api("GET", "/me");
    store.set("asha:profile", profile);
    $("ashaLine").textContent = `${profile.name ? `Namaste, ${profile.name} · ` : ""}${profile.village}`;
  } catch (err) {
    if (err.status === 401 || err.status === 403) return handleAuthFailure(err);
    if (!cachedProfile) $("ashaLine").textContent = "Offline";
  }
  loadList();
}

onAuthStateChanged(auth, (user) => {
  if (user) startSession();
  else resetLogin();
});

window.addEventListener("online", () => { updateOfflineStrip(); if (auth.currentUser) loadList(); });
window.addEventListener("offline", updateOfflineStrip);
updateOfflineStrip();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Offline cache unavailable:", err));
}
