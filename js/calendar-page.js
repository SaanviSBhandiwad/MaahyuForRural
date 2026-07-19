// ============================================================
// MAAHYU — Calendar screen logic
// Renders the trailing 35 days (5 weeks) as dots. Days with an
// entry are colored by mood band; tapping a day with an entry
// opens a small playback sheet with the saved audio + transcript.
// ============================================================
import { bootApp, activateTab } from "./app.js";
import { t } from "./i18n.js";
import { db, auth } from "./firebase-init.js";
import { collection, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
  const entriesByDay = await fetchEntriesByDay();
  renderGrid(entriesByDay);
}

async function fetchEntriesByDay() {
  const user = auth.currentUser;
  const q = query(collection(db, "users", user.uid, "entries"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const byDay = {};
  snap.forEach((doc) => {
    const data = doc.data();
    // Keep the most recent entry per day for the dot's color/playback.
    if (!byDay[data.dayKey]) byDay[data.dayKey] = data;
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
    const dayKey = date.toISOString().slice(0, 10);
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
