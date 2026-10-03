// ============================================================
// MAAHYU — Message pipeline  (Phase 1)
// ------------------------------------------------------------
// processMessage() is the ONE place every message goes through,
// whether it arrives from the app (/chat, /entries/sync) or from
// WhatsApp (voice, text or emoji):
//
//   1. Mood scoring (PHQ-9 domains)      ← ../../js/mood-scoring.js
//   2. Flag detection + escalation       ← ../../js/escalation.js
//   3. Distressed days in the last 30    ← her own entry history
//   4. Risk score                        ← ../../js/risk-scorer.js
//   5. Reply: Gemini grounded in RAG facts (../../js/rag-kb.js),
//      falling back to the offline KB (../../js/offline-kb.js)
//   6. Save the entry + update her summary for the ASHA dashboard
//
// The scoring files are the same ones the app uses offline, so the
// logic can never drift between channels.
// ============================================================
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { decideEscalation, detectFlags } from "../../js/escalation.js";
import { scoreEntry, scorePHQ9Full } from "../../js/mood-scoring.js";
import { matchOffline } from "../../js/offline-kb.js";
import { retrieveRAG } from "../../js/rag-kb.js";
import { scoreRisk } from "../../js/risk-scorer.js";
import { toShortLang } from "./mothers.js";

// Tried in order. When one hits its quota (429), the next is used until
// the quota resets. Override in .env, e.g. GEMINI_MODELS=gemini-2.5-flash-lite
const GEMINI_MODELS = (process.env.GEMINI_MODELS || "gemini-2.5-flash,gemini-3.5-flash-lite")
  .split(",").map((m) => m.trim()).filter(Boolean);
const exhaustedUntil = new Map(); // model → timestamp (ms) when it may work again

// Optional second provider with an OpenAI-compatible API, e.g.
//   Grok (xAI):  ALT_LLM_BASE_URL=https://api.x.ai/v1
//   Groq:        ALT_LLM_BASE_URL=https://api.groq.com/openai/v1
// plus ALT_LLM_API_KEY and ALT_LLM_MODEL (copy the model name from the
// provider's console). ALT_LLM_FIRST=true uses it before Gemini;
// otherwise it's the backup when Gemini is over quota or down.
const ALT_LLM = process.env.ALT_LLM_API_KEY && process.env.ALT_LLM_BASE_URL && process.env.ALT_LLM_MODEL
  ? {
      baseUrl: process.env.ALT_LLM_BASE_URL.replace(/\/$/, ""),
      apiKey: process.env.ALT_LLM_API_KEY,
      model: process.env.ALT_LLM_MODEL,
      first: /^true$/i.test(process.env.ALT_LLM_FIRST || "")
    }
  : null;
const LLM_TIMEOUT_MS = 10000; // leaves room for speech-to-text + voice reply inside WhatsApp's 15s

/** Calls an OpenAI-compatible chat API (Grok, Groq, …) with the same prompt and history. */
async function callAltLlm({ systemInstruction, history, current }) {
  const messages = [
    { role: "system", content: systemInstruction },
    ...history.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.parts[0].text })),
    { role: "user", content: current }
  ];
  // Reasoning models (e.g. gpt-oss) think before answering, and that thinking
  // counts toward max_tokens: keep it brief and leave room for the reply.
  const reasoning = /gpt-oss|qwen3|deepseek-r1|reasoning/i.test(ALT_LLM.model);
  const body = { model: ALT_LLM.model, messages, temperature: 0.8, max_tokens: reasoning ? 1500 : 400 };
  if (reasoning) body.reasoning_effort = "low";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    let res = await fetch(`${ALT_LLM.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ALT_LLM.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (res.status === 400 && body.reasoning_effort) {
      // Provider doesn't accept reasoning_effort for this model: retry without it.
      delete body.reasoning_effort;
      res = await fetch(`${ALT_LLM.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ALT_LLM.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`${ALT_LLM.model} responded ${res.status}: ${JSON.stringify(data.error || data).slice(0, 200)}`);
      err.status = res.status;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter) err.message += ` "retryDelay":"${retryAfter}s"`;
      throw err;
    }
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${ALT_LLM.model} returned an empty reply`);
    return text;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`${ALT_LLM.model} took longer than ${LLM_TIMEOUT_MS / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Tell the developer at startup exactly which models will answer, so a
// typo in .env is obvious instead of silently ignored.
{
  const altVars = ["ALT_LLM_BASE_URL", "ALT_LLM_API_KEY", "ALT_LLM_MODEL"];
  const set = altVars.filter((v) => process.env[v]);
  if (set.length && set.length < altVars.length) {
    console.warn(`⚠️  Groq/Grok is NOT active — missing in .env: ${altVars.filter((v) => !process.env[v]).join(", ")}`);
  }
}

/** Prints the models the Grok/Groq key can use, after a "model not found". */
async function printAltModels() {
  try {
    const res = await fetch(`${ALT_LLM.baseUrl}/models`, { headers: { Authorization: `Bearer ${ALT_LLM.apiKey}` } });
    const data = await res.json();
    const ids = (data.data || []).map((m) => m.id).sort();
    if (ids.length) console.warn(`   Models your key can use: ${ids.join(", ")}\n   → put one of these in ALT_LLM_MODEL in .env`);
  } catch { /* listing is only a hint */ }
}

/** Providers in the order to try them. */
function replyProviders() {
  const gemini = GEMINI_MODELS.map((model) => ({ name: model, kind: "gemini", model }));
  if (!ALT_LLM) return gemini;
  const alt = { name: ALT_LLM.model, kind: "alt" };
  return ALT_LLM.first ? [alt, ...gemini] : [...gemini, alt];
}
const LANGUAGE_NAMES = { en: "English", hi: "Hindi", kn: "Kannada" };
const DISTRESS_WINDOW_DAYS = 30;

// ── Prompt (single copy, used by every channel) ─────────────────────────────
const STAGE_NOTES = {
  pregnant: "She is pregnant.",
  "0-2weeks": "She gave birth less than two weeks ago.",
  "2-6weeks": "She gave birth two to six weeks ago.",
  "6weeks+": "She gave birth more than six weeks ago."
};

export function buildSystemPrompt(lang, profile = {}) {
  const name = LANGUAGE_NAMES[toShortLang(lang)];
  const languageLine = name === "English"
    ? "Reply in simple English."
    : `Always reply in ${name}, using simple everyday words she would use at home. Common English words like "ASHA" or "PHC" are fine.`;
  const known = [STAGE_NOTES[profile.pregnancyStage], profile.village ? `She lives in ${profile.village}.` : ""]
    .filter(Boolean).join(" ");

  return `You are SheRo, a companion for pregnant women and new mothers in rural India. Talk like a caring elder sister (didi / akka) who listens well and also gives real, practical help.
${languageLine}
${known ? `What you know about her: ${known}` : ""}

How to reply:
- Answer what she actually asked. If she asks what to do, what to eat, or how to handle something, give two or three specific, practical ideas that fit village life and cost little or nothing. For example, for feeling alone: sit in the morning sun in the courtyard with the baby, hum a favourite song or bhajan, visit a neighbour for ten minutes, call her mother or sister, tend a tulsi plant. Choose ideas that fit what she has told you.
- Use what she said earlier in this conversation. If she mentioned something before, refer back to it naturally.
- Acknowledge her feeling in one short phrase, then move to something concrete. Do not start every reply with sympathy, and do not repeat the same comforting sentence twice in a conversation.
- End with one gentle, specific question that invites her to keep talking, such as "Which of these feels easiest today?" or "Who in your house could hold the baby for a while?"
- Avoid vague advice like "practice self-care", "stay positive" or "talk to a professional". Suggest the ASHA worker or a doctor only when it really fits: health problems, danger signs, or sadness that has lasted many days.
- Your reply is read aloud. Write plain spoken sentences only: no lists, bullet points, headings, numbers or asterisks. At most one 💛 at the very end. Keep it to about 50 to 90 words.

Safety:
- Never diagnose or name medicine doses.
- If she mentions danger signs (heavy bleeding, fits, high fever, severe headache, blurred vision, trouble breathing, a baby not feeding or very drowsy), tell her clearly and calmly to contact her ASHA worker or call 108 right now.
- If she talks about hurting herself or not wanting to live, respond with deep care, tell her she matters, and urge her to call iCall at 9152987821 or talk to someone she trusts right now.

Facts:
- If "Relevant verified facts" appear with her message and they relate to her question, base scheme names, amounts, eligibility and medical guidance only on them. Ignore facts that are not related to what she asked.
- Never invent a rupee amount, scheme name or medical claim. If she asks something factual you have no facts for, say you are not sure and suggest checking with her ASHA worker or the PHC.`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
/** Calendar day in India (not UTC), e.g. "2026-10-02". */
export function indiaDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function daysSinceDelivery(stage) {
  return { "0-2weeks": 7, "2-6weeks": 28, "6weeks+": 60, "pregnant": 0 }[stage] ?? 30;
}

async function countDistressedDays(motherRef, todayKey, todayDistressed) {
  const since = Timestamp.fromDate(new Date(Date.now() - DISTRESS_WINDOW_DAYS * 86400000));
  const snap = await motherRef.collection("entries").where("createdAt", ">=", since).get();
  const days = new Set();
  snap.forEach((d) => {
    const e = d.data();
    if (e.distressed && e.dayKey) days.add(e.dayKey);
  });
  if (todayDistressed) days.add(todayKey);
  return days.size;
}

const HISTORY_TURNS = 6; // her last 6 messages (and replies) as context

/** Her recent conversation, oldest first, as Gemini chat turns. */
async function loadHistory(motherRef) {
  try {
    const snap = await motherRef.collection("entries")
      .orderBy("createdAt", "desc").limit(HISTORY_TURNS).get();
    const turns = [];
    snap.docs.reverse().forEach((d) => {
      const e = d.data();
      if (!e.transcript || !e.aiReply) return;
      turns.push({ role: "user", parts: [{ text: e.transcript }] });
      turns.push({ role: "model", parts: [{ text: e.aiReply }] });
    });
    return turns;
  } catch (err) {
    console.warn("Could not load history:", err.message || err);
    return [];
  }
}

/** Voice-friendly: strip markdown the model sometimes adds. */
function cleanForSpeech(text) {
  return text
    .replace(/\*\*?([^*]+)\*\*?/g, "$1")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** The model name doesn't exist (anymore) for this key: retired or mistyped. */
function isModelGone(err) {
  const msg = String(err?.message || err);
  return err?.status === 404 || /"code":\s*404|NOT_FOUND|no longer available|model.*not.*found|does not exist/i.test(msg);
}

function isQuotaError(err) {
  const msg = String(err?.message || err);
  return err?.status === 429 || /RESOURCE_EXHAUSTED|"code":\s*429|quota/i.test(msg);
}

/** How long Google says to wait (e.g. "retryDelay":"71183s"); default 1 hour, max 24h. */
function retryDelayMs(err) {
  const m = String(err?.message || err).match(/retryDelay"?\s*:\s*"?(\d+)(?:\.\d+)?s/);
  const seconds = m ? Number(m[1]) : 3600;
  return Math.min(seconds, 86400) * 1000;
}

async function generateReply(ai, { text, lang, profile, history }) {
  const hits = retrieveRAG(text, 2);
  const facts = hits.map((h) => `[${h.title}]\n${h.content}`).join("\n\n");
  const current = facts
    ? `Relevant verified facts:\n${facts}\n\nHer message: ${text}`
    : text;
  const request = {
    contents: [...history, { role: "user", parts: [{ text: current }] }],
    config: {
      systemInstruction: buildSystemPrompt(lang, profile),
      temperature: 0.8,
      maxOutputTokens: 400
    }
  };
  // "Fast mode" setting differs by Gemini generation: 2.5 models accept
  // thinkingBudget: 0; newer models reject it, so they get their default.
  const configFor = (model) => (/^gemini-2\.5/.test(model)
    ? { ...request.config, thinkingConfig: { thinkingBudget: 0 } }
    : request.config);

  const providers = replyProviders();
  let lastError = null;
  for (const [i, p] of providers.entries()) {
    if ((exhaustedUntil.get(p.name) || 0) > Date.now()) continue; // known to be over quota
    try {
      let text;
      if (p.kind === "gemini") {
        const response = await ai.models.generateContent({ model: p.model, contents: request.contents, config: configFor(p.model) });
        text = response.text;
        if (!text) throw new Error(`${p.model} returned an empty reply`);
      } else {
        text = await callAltLlm({ systemInstruction: request.config.systemInstruction, history, current });
      }
      return { reply: cleanForSpeech(text), sources: hits.map((h) => h.id), model: p.name };
    } catch (err) {
      lastError = err;
      const hasNext = i < providers.length - 1;
      if (isQuotaError(err)) {
        const wait = retryDelayMs(err);
        exhaustedUntil.set(p.name, Date.now() + wait);
        console.warn(`⏳ ${p.name}: quota used up — skipping it for ${Math.round(wait / 3600000 * 10) / 10}h${hasNext ? ", trying the next model" : ""}.`);
        continue;
      }
      if (isModelGone(err)) {
        exhaustedUntil.set(p.name, Date.now() + 86400000);
        if (p.kind === "alt") {
          console.warn(`🚫 ${p.name}: ${String(err.message || err).slice(0, 200)}`);
          await printAltModels();
          continue;
        }
        const hint = String(err.message || err).match(/use (?:models\/)?([\w.-]+)/i)?.[1];
        console.warn(`🚫 ${p.name} is not available (retired or misspelled) — skipping it.` +
          (hint ? ` Google suggests "${hint}"; set GEMINI_MODELS in .env.` : " Check the model name in .env."));
        continue;
      }
      // Other errors (timeout, bad key, outage): try the next provider, if any.
      console.warn(`⚠️  ${p.name} failed: ${String(err.message || err).slice(0, 160)}${hasNext ? " — trying the next model." : ""}`);
    }
  }
  throw lastError || new Error("All AI models are over quota right now");
}

// ── The pipeline ────────────────────────────────────────────────────────────
/**
 * @param {{ db, ai }} deps
 * @param {{
 *   mother: { id, ref, data },
 *   channel: "app" | "whatsapp",
 *   text: string,
 *   lang?: string,
 *   inputType?: "voice" | "text" | "emoji" | "chip",
 *   audioUrl?: string | null,
 *   clientReply?: string,      // reply already shown offline (from /entries/sync)
 *   clientTimestamp?: number,  // ms since epoch, when it was said offline
 *   entryId?: string           // fixed id → re-sending the same item is a no-op
 * }} input
 */
export async function processMessage({ db, ai }, input) {
  const { mother, channel, inputType = "text", audioUrl = null, clientReply, clientTimestamp, entryId } = input;
  const entryRef = entryId ? mother.ref.collection("entries").doc(entryId) : mother.ref.collection("entries").doc();
  if (entryId && (await entryRef.get()).exists) {
    return { entryId, duplicate: true };
  }
  const text = String(input.text || "").trim().slice(0, 4000);
  const lang = toShortLang(input.lang || mother.data.language);
  const when = clientTimestamp ? new Date(clientTimestamp) : new Date();
  const dayKey = indiaDayKey(when);

  // 1–2. Scoring and flags
  const phq = scorePHQ9Full(text);
  const calendar = scoreEntry(text);
  const flag = detectFlags(text);
  const distressed = phq.rawDomainHits > 0 || flag.severity !== null;

  // 3–4. History-aware risk
  const numDistressDays = await countDistressedDays(mother.ref, dayKey, distressed);
  const profile = mother.data;
  const risk = scoreRisk({
    phq9Score: phq.score,
    numDistressDays,
    daysSinceDelivery: daysSinceDelivery(profile.pregnancyStage),
    ashaVisitsCount: profile.ashaVisitsCount ?? 0,
    distanceToPHCKm: profile.distanceToPHCKm ?? 10,
    hasFamilySupport: profile.hasFamilySupport ?? false,
    literacyLevel: profile.literacyLevel ?? 1,
    firstPregnancy: profile.firstPregnancy ?? false
  });
  const escalation = decideEscalation({ phq, flagSeverity: flag.severity, distressCount: numDistressDays, lang });

  // 5. Reply
  let reply, replySource, replyModel = null, sources = [];
  if (clientReply) {
    reply = clientReply;
    replySource = "client-offline";
  } else {
    try {
      const history = await loadHistory(mother.ref);
      ({ reply, sources, model: replyModel } = await generateReply(ai, { text, lang, profile, history }));
      replySource = "ai";
    } catch (err) {
      const quota = isQuotaError(err);
      console.error(quota
        ? `⏳ All AI models are over their quota (${replyProviders().map((p) => p.name).join(", ")}) — answering from the offline KB.`
        : `All AI models failed — answering from the offline KB. Last error: ${String(err.message || err).slice(0, 160)}`);
      reply = matchOffline(text, lang).response;
      replySource = "offline-kb";
    }
  }

  // 6. Save
  const needsFollowUp = risk.needsASHAFlag || escalation.level === "urgent";
  const followUpPriority = escalation.level === "urgent" || risk.tier === "high" ? "high" : "medium";
  const createdAt = clientTimestamp ? Timestamp.fromDate(when) : FieldValue.serverTimestamp();

  const entry = {
    id: entryRef.id,
    motherId: mother.id,
    createdAt,
    dayKey,
    channel,
    inputType,
    lang,
    transcript: text,
    audioUrl,
    aiReply: reply,
    replySource,
    replyModel,
    ragSources: sources,
    // Mood (PHQ-9-based, never shown to her as questions)
    moodScore: phq.score,
    moodSeverity: phq.severity,
    domainsTriggered: phq.domainsTriggered,
    distressed,
    // Calendar fields (calendar-page.js reads these)
    band: calendar.band,
    calendarScore: calendar.score,
    crisis: calendar.crisis || flag.severity === "high",
    // Safety + risk
    flagSeverity: flag.severity,
    flagKeywords: flag.keywords,
    escalationLevel: escalation.level,
    riskScore: risk.score,
    riskTier: risk.tier,
    riskFlag: needsFollowUp,
    drivingFactors: risk.drivingFactors,
    numDistressDays
  };

  const summary = {
    lastMessageAt: createdAt,
    lastMoodScore: phq.score,
    latestRiskTier: risk.tier,
    latestRiskScore: risk.score,
    language: profile.language || lang,
    channels: FieldValue.arrayUnion(channel)
  };
  // Only ever RAISE a follow-up here — clearing it is the ASHA worker's job.
  if (needsFollowUp) {
    const alreadyHigh = profile.needsFollowUp && profile.followUpPriority === "high";
    Object.assign(summary, {
      needsFollowUp: true,
      followUpPriority: alreadyHigh ? "high" : followUpPriority,
      followUpReason: escalation.level === "urgent"
        ? "Crisis language in conversation"
        : (risk.drivingFactors.join("; ") || "High risk score"),
      followUpSince: profile.needsFollowUp ? (profile.followUpSince ?? createdAt) : createdAt
    });
  }

  const batch = db.batch();
  batch.set(entryRef, entry);
  batch.set(mother.ref, summary, { merge: true });
  await batch.commit();

  return { entryId: entryRef.id, reply, replySource, sources, escalation, phq, risk, flag };
}

console.log(`🤖 Reply models, in order: ${replyProviders().map((p) => p.name).join(" → ")} → offline answers`);
