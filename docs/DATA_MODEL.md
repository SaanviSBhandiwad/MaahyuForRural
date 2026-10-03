# Maahyu — Shared Data Model (Phase 1)

Everyone builds against this. **All writes go through the backend**
(`backend/lib/pipeline.js`); the app only reads its own data, and the
ASHA dashboard will read through backend endpoints (Phase 4).

## `mothers/{motherId}`: one document per mother, any channel

`motherId` is her phone number in E.164 (`+919876543210`) for WhatsApp.
App users get `app_<firebaseUid>` until they verify their phone with OTP
(Phase 5); then the app account is linked to her phone document so her
WhatsApp history carries over.

| Field | Type | Notes |
|---|---|---|
| `phone` | string \| null | E.164 |
| `displayName` | string \| null | Her WhatsApp profile name, shown to her ASHA worker |
| `appUid` | string \| null | Firebase Auth uid of her app account |
| `language` | `"en"` \| `"hi"` \| `"kn"` | |
| `village` | string \| null | Used by the ASHA dashboard to filter. Collected in onboarding (Phase 3/5) |
| `pregnancyStage` | `"pregnant"` \| `"0-2weeks"` \| `"2-6weeks"` \| `"6weeks+"` \| null | |
| `assignedAshaId` | string \| null | → `ashaWorkers/{id}` |
| `channels` | string[] | `["whatsapp", "app"]` |
| `awaitingLanguage` | boolean | WhatsApp onboarding only |
| `ashaVisitsCount`, `distanceToPHCKm`, `hasFamilySupport`, `literacyLevel`, `firstPregnancy` | optional | Risk-model inputs; defaults are used until collected |
| `lastMessageAt` | timestamp | |
| `lastMoodScore` | 0–27 | PHQ-9-based |
| `latestRiskTier` / `latestRiskScore` | `"low"\|"medium"\|"high"` / 0–1 | |
| `needsFollowUp` | boolean | **Set by the pipeline, cleared only by an ASHA worker** |
| `followUpPriority` | `"high"` \| `"medium"` | Dashboard sort order |
| `followUpReason` | string | e.g. "Crisis language in conversation" |
| `followUpSince` | timestamp | |
| `createdAt` | timestamp | |

## `mothers/{motherId}/entries/{entryId}`: every message, both channels

| Field | Type | Notes |
|---|---|---|
| `id`, `motherId` | string | |
| `createdAt` | timestamp | When she said it (offline items keep their original time) |
| `dayKey` | `"YYYY-MM-DD"` | India date. The calendar groups by this |
| `channel` | `"app"` \| `"whatsapp"` | |
| `inputType` | `"voice"` \| `"text"` \| `"emoji"` \| `"chip"` | |
| `lang` | `"en"` \| `"hi"` \| `"kn"` | |
| `transcript` | string | What she said |
| `audioUrl` | string \| null | Her recording (needs Firebase Storage) |
| `aiReply` | string | |
| `replySource` | `"ai"` \| `"offline-kb"` \| `"client-offline"` | |
| `replyModel` | string \| null | Which model answered, e.g. `gemini-2.5-flash` or your Grok/Groq model |
| `ragSources` | string[] | RAG facts used, e.g. `["pmmvy"]` |
| `moodScore` | 0–27 | PHQ-9-based, never shown to her |
| `moodSeverity` | `"none"\|"mild"\|"moderate"\|"moderately_severe"\|"severe"` | |
| `domainsTriggered` | string[] | e.g. `["Q3_sleep","Q4_fatigue"]` |
| `distressed` | boolean | Any PHQ domain or flag keyword hit |
| `band` / `calendarScore` / `crisis` | `"good"\|"mid"\|"low"` / 0–10 / bool | Calendar colour |
| `flagSeverity` / `flagKeywords` | `"high"\|"medium"\|null` / string[] | |
| `escalationLevel` | `"none"\|"suggest"\|"urgent"` | |
| `riskScore` / `riskTier` / `riskFlag` / `drivingFactors` | | `riskFlag` = this entry raised a follow-up |
| `numDistressDays` | number | Distressed days in the 30 days up to this entry |

Offline entries synced later use the id `offline_<clientId>`, so re-sending is harmless.

## `ashaWorkers/{ashaId}`: built (create with `backend/scripts/setup-asha.js`)

| Field | Type |
|---|---|
| `phone` | string (E.164, used for OTP login) |
| `name` | string |
| `village` | string. She only ever sees mothers in this village |
| `authUid` | string \| null. Linked on first login |

## `followUps/{followUpId}`: built (written by the ASHA dashboard)

| Field | Type |
|---|---|
| `motherId` | string |
| `ashaId` | string |
| `note` | string |
| `resolved` | boolean. Resolving also sets `mothers/{id}.needsFollowUp = false` |
| `createdAt` | timestamp |

## ASHA dashboard

`/asha/` (frontend) talks to `backend/lib/asha.js`. The server checks her phone-OTP sign-in
against `ashaWorkers`, and only returns mothers whose `village` matches hers. She sees mood
trend, concern themes, risk and **only the messages that raised a flag**, not the full diary.

## Original query sketch

```js
db.collection("mothers")
  .where("village", "==", asha.village)
  .where("needsFollowUp", "==", true)
  .orderBy("followUpPriority")      // "high" sorts before "medium"
  .orderBy("followUpSince", "desc")
```
This needs a composite index; Firestore prints a link to create it the first time it runs.

## Where the logic lives

| Logic | File | Used by |
|---|---|---|
| Pipeline (save, score, flag, reply) | `backend/lib/pipeline.js` | `/chat`, `/entries/sync`, WhatsApp |
| Identity / channel linking | `backend/lib/mothers.js` | backend |
| PHQ-9 mood scoring | `js/mood-scoring.js` | backend + app (offline) |
| Risk score | `js/risk-scorer.js` | backend |
| Flags + escalation rules | `js/escalation.js` | backend + app (offline) |
| RAG facts | `js/rag-kb.js` | backend |
| Offline replies | `js/offline-kb.js` | backend (Gemini fallback) + app (offline) |

The backend imports these files from `../js/`, so **deploy the whole repo** for the backend,
not just the `backend/` folder.
