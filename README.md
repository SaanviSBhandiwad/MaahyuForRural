# Maahyu

A voice-first maternal wellness companion. One mic button. She talks,
everything else — the caring reply, the mood tracking, the diary, the
calendar, the option to reach a real person — happens automatically
behind that one door.

This build is **frontend-only**: plain HTML/CSS/JS (no framework, no
build step), backed directly by Firebase (Auth, Firestore, Storage)
from the browser. It deploys as-is to **Render → Static Site**.

---

## 1. Folder structure

```
maahyu/
├── index.html              # Splash + language picker (first launch only)
├── home.html                # The one-mic home screen
├── calendar.html             # Mood calendar (tap a dot to replay)
├── settings.html             # Language + voice on/off
├── css/
│   ├── variables.css         # Design tokens (colors, type, spacing)
│   └── style.css             # All component styles
├── js/
│   ├── firebase-config.js    # ← PASTE YOUR FIREBASE KEYS HERE
│   ├── firebase-init.js      # Firebase app/auth/firestore/storage bootstrap
│   ├── app.js                 # Shared boot logic (auth, i18n, offline banner)
│   ├── i18n.js                 # Language loader + t() lookup helper
│   ├── recorder.js             # MediaRecorder + speech-to-text + upload
│   ├── mood-scoring.js         # Offline keyword-based mood scorer + replies
│   ├── home-page.js            # Home screen logic
│   ├── calendar-page.js        # Calendar screen logic
│   └── settings-page.js        # Settings screen logic
├── locales/
│   ├── en.json  /  hi.json  /  kn.json
├── firebase-rules/
│   ├── firestore.rules
│   └── storage.rules
└── render.yaml                # Render static-site blueprint (optional)
```

Every page is a plain `.html` file — there is no router and no build
step, so you can open `index.html` directly or drop the whole folder
onto any static host.

---

## 2. Firebase setup (one-time)

1. Go to the [Firebase console](https://console.firebase.google.com) → **Add project**.
2. Inside the project, click **Add app → Web (`</>`)**. Copy the config
   object it shows you.
3. Paste those values into `js/firebase-config.js` (each field has a
   placeholder telling you what goes there).
4. Turn on these products from the left sidebar:
   - **Authentication → Sign-in method → Anonymous → Enable.**
     This is what lets a mother open the app with zero forms — an
     anonymous Firebase user is created silently on first launch.
   - **Firestore Database → Create database** (start in production
     mode). Then go to the **Rules** tab and paste in the contents of
     `firebase-rules/firestore.rules`.
   - **Storage → Get started.** Go to its **Rules** tab and paste in
     `firebase-rules/storage.rules`.
5. That's it — no server, no API keys beyond the public Firebase web
   config (which is safe to expose client-side; access is controlled
   by the rules files above, not by hiding the config).

### Data model created automatically by the app

```
users/{uid}/entries/{entryId}
  dayKey       "2026-07-18"        (string, local date)
  createdAt    server timestamp
  transcript   "I feel really tired today"
  audioUrl     https://... | null  (null if offline when recorded)
  score        0-10
  band         "good" | "mid" | "low"
  crisis       true | false
  lang         "en" | "hi" | "kn"
```

---

## 3. Running it locally

Because the pages use ES module `<script type="module">` imports,
open them through a local server rather than double-clicking the
file (browsers block module fetches from `file://`):

```bash
cd maahyu
python3 -m http.server 8080
# then open http://localhost:8080
```

---

## 4. Deploying to Render (Static Site)

1. Push this folder to a GitHub repo.
2. In Render: **New → Static Site** → connect the repo.
3. Build command: leave blank or `echo "no build"`.
4. Publish directory: `.` (repo root, or wherever this folder lives).
5. Deploy. Render serves every `.html` file directly — `home.html`,
   `calendar.html`, `settings.html` all work as plain routes, no
   rewrite rules needed.
6. In the Firebase console, add your Render URL
   (`https://your-app.onrender.com`) to **Authentication → Settings →
   Authorized domains**, or anonymous sign-in will be blocked.

---

## 5. Where the mood scoring comes from

`js/mood-scoring.js` ships a small offline keyword scorer (inspired by
PHQ-9 symptom themes — low mood, anhedonia, fatigue, sleep, isolation,
crisis language) so the **entire app works with zero backend**,
including with no internet. It is explicitly **not** a diagnostic
PHQ-9 total — it's a lightweight heuristic to drive the mood calendar
color and the escalation banner.

If your team later wires up the RAG/Gemini backend described in the
original plan (a small Cloud Function or Render web service), replace
the body of `scoreEntry()`/`getReply()` with a call to that endpoint —
`AI_ENDPOINT` in `firebase-config.js` is a ready-made place to put its
URL. Keep the same return shape (`{ score, band, crisis, replyKey }`)
and nothing else in the app needs to change.

---

## 6. Suggested work split for a 4-person team

This repo is scoped so each person owns a folder/file set with almost
no overlap — you can work in parallel and merge with few conflicts.

**Person A — Voice & recording pipeline**
- Own `js/recorder.js`, `js/mood-scoring.js`
- Test MediaRecorder + SpeechRecognition across Android Chrome/WebView
  (this is where most rural users will actually open the app)
- Improve the keyword lists in `mood-scoring.js` per language, or swap
  in a real backend call behind `AI_ENDPOINT`

**Person B — Firebase & data layer**
- Own `js/firebase-config.js`, `js/firebase-init.js`, `firebase-rules/`
- Set up the actual Firebase project, test rules with the Firebase
  emulator, verify offline persistence really queues writes
- Design the ASHA worker dashboard's read side against the same
  `users/{uid}/entries` collection (separate app/repo)

**Person C — Screens & i18n**
- Own `home.html`/`calendar.html`/`settings.html` and their `-page.js`
  files, plus `locales/*.json`
- Add more languages, refine copy, test the calendar's playback sheet
  against real recorded data from Person A's pipeline

**Person D — Visual design & accessibility**
- Own `css/variables.css`, `css/style.css`
- Push on motion/haptics for the mic button, test with screen readers
  and large-text accessibility settings, verify contrast for low-light
  outdoor phone use (a real constraint for the target user)

Everyone should still smoke-test the full flow (splash → mic → reply →
calendar) before merging, since the four pieces are tightly coupled at
runtime even though the files are separate.
