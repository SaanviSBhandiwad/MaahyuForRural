// ============================================================
// MAAHYU — Calendar screen logic
// Renders the trailing 35 days (5 weeks) as dots. Days with an
// entry are colored by mood band; tapping a day with an entry
// opens a small playback sheet with the saved audio + transcript.
// ============================================================
import { bootApp, activateTab } from "./app.js";
import { t } from "./i18n.js";
import { db } from "./firebase-init.js";
import { collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getMotherId, refreshMotherId, canReachBackend } from "./api.js";
import { readPending, syncPending } from "./offline-queue.js";
import { scoreEntry } from "./mood-scoring.js";

const grid = document.getElementById("calendarGrid");
const emptyState = document.getElementById("emptyState");
const sheet = document.getElementById("playbackSheet");
const sheetDate = document.getElementById("playbackDate");
const sheetPlayBtn = document.getElementById("playbackPlayBtn");
const sheetTranscript = document.getElementById("playbackTranscript");
const sheetAudio = document.getElementById("playbackAudio");

async function init() {
  await bootApp();
  activateTab("calendar");
  await syncPending(); // push anything said offline first, so it shows up below
  const entriesByDay = await fetchEntriesByDay();
  renderGrid(entriesByDay);
}

/** Local calendar day, e.g. "2026-10-02" (matches the backend's India date). */
function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchEntriesByDay() {
  const motherId = canReachBackend() ? await refreshMotherId() : getMotherId();
  const byDay = {};
  if (!motherId) return byDay;
  try {
    const q = query(
      collection(db, "mothers", motherId, "entries"),
      orderBy("createdAt", "desc"),
      limit(300)
    );
    const snap = await getDocs(q);
    snap.forEach((doc) => {
      const data = doc.data();
      // Keep the most recent entry per day for the dot's color/playback.
      if (data.dayKey && !byDay[data.dayKey]) byDay[data.dayKey] = data;
    });
  } catch (err) {
    // No messages yet (profile not created), rules not published, or offline.
    console.warn("Calendar: no entries loaded from Firestore:", err.code || err.message);
  }
  // Messages still waiting to sync: show them too, so today's dot appears right away.
  readPending().forEach((item) => {
    const key = localDayKey(new Date(item.clientTimestamp));
    const existing = byDay[key];
    if (!existing || (existing.createdAt?.toMillis?.() ?? 0) < item.clientTimestamp) {
      byDay[key] = { ...scoreEntry(item.text), transcript: item.text, audioUrl: item.audioUrl || null, dayKey: key };
    }
  });
  return byDay;
}

function renderGrid(entriesByDay) {
  const days = [];
  const today = new Date();
  for (let i = 34; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  let anyEntries = false;
  grid.innerHTML = "";
  days.forEach((date) => {
    const dayKey = localDayKey(date);
    const entry = entriesByDay[dayKey];
    const cell = document.createElement("button");
    cell.className = "calendar-dot-day";
    cell.textContent = date.getDate();
    if (entry) {
      anyEntries = true;
      cell.classList.add("has-entry", `mood-${bandClass(entry.band)}`);
      cell.setAttribute("aria-label", `${dayKey}: ${entry.band}`);
      cell.addEventListener("click", () => openPlayback(dayKey, entry));
    } else {
      cell.disabled = true;
    }
    grid.appendChild(cell);
  });

  if (!anyEntries) {
    emptyState.classList.remove("hidden");
  }
}

function bandClass(band) {
  if (band === "low") return "low";
  if (band === "mid") return "mid";
  return "good";
}

function openPlayback(dayKey, entry) {
  sheet.classList.remove("hidden");
  sheetDate.textContent = dayKey;
  sheetTranscript.textContent = entry.transcript || t("calendar.empty");
  if (entry.audioUrl) {
    sheetAudio.src = entry.audioUrl;
    sheetPlayBtn.disabled = false;
    sheetPlayBtn.onclick = () => sheetAudio.play();
  } else {
    sheetPlayBtn.disabled = true;
  }
}

init();
