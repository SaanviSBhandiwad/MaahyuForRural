// ============================================================
// MAAHYU — Backend
// ------------------------------------------------------------
// Every message from every channel goes through ONE pipeline:
// lib/pipeline.js → processMessage(). This file only handles
// transport: auth, HTTP endpoints, Twilio, speech in/out.
//
//   POST /chat              app message      (Firebase ID token required)
//   POST /entries/sync      offline queue    (Firebase ID token required)
//   GET  /me                her motherId     (Firebase ID token required)
//   POST /tts               spoken reply     (Firebase ID token required)
//   POST /grandma-wisdom    wisdom cards
//   POST /whatsapp/webhook  Twilio WhatsApp
//   /asha/*                 ASHA dashboard (phone-OTP sign-in, see lib/asha.js)
// ============================================================
// Loads .env BEFORE every other import runs. (A plain dotenv.config() call
// would run after all imports, so modules reading process.env at load
// time — like lib/pipeline.js — would see empty values.)
import "dotenv/config";

import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import { GoogleGenAI } from "@google/genai";
import axios from "axios";
import cors from "cors";
import express from "express";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createAshaRouter } from "./lib/asha.js";
import {
  getOrCreateAppMother,
  getOrCreateWhatsAppMother,
  toShortLang, toSpeechLang
} from "./lib/mothers.js";
import { processMessage } from "./lib/pipeline.js";

// Log unexpected async errors instead of crashing the whole server.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled error (server kept running):", err?.message || err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, "public-audio");

// ─── Firebase service account ───────────────────────────────────────────────
const serviceAccount = process.env.SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.SERVICE_ACCOUNT_JSON)
  : JSON.parse(fs.readFileSync(path.join(__dirname, "serviceAccountKey.json"), "utf8"));

// ─── Speech credentials (Speech-to-Text + Text-to-Speech) ───────────────────
// Found automatically so a wrong path in .env can never crash the server:
//   1. SPEECH_CREDENTIALS_JSON env var (paste the whole JSON; for Render)
//   2. GOOGLE_APPLICATION_CREDENTIALS, resolved from the backend folder
//   3. backend/speechServiceAccountKey*.json (also catches "… (1).json")
//   4. the Firebase service account above
function readKeyFile(file) {
  try {
    const key = JSON.parse(fs.readFileSync(file, "utf8"));
    return key.client_email && key.private_key ? key : null;
  } catch {
    return null;
  }
}

function findSpeechCredentials() {
  if (process.env.SPEECH_CREDENTIALS_JSON) {
    try {
      return { key: JSON.parse(process.env.SPEECH_CREDENTIALS_JSON), source: "SPEECH_CREDENTIALS_JSON" };
    } catch {
      console.warn("⚠️  SPEECH_CREDENTIALS_JSON is not valid JSON, ignoring it.");
    }
  }
  const files = [];
  const envPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (envPath) files.push(path.isAbsolute(envPath) ? envPath : path.join(__dirname, envPath));
  for (const name of fs.readdirSync(__dirname).sort()) {
    if (/^speechServiceAccountKey.*\.json$/i.test(name)) files.push(path.join(__dirname, name));
  }
  for (const file of files) {
    const key = readKeyFile(file);
    if (key) return { key, source: path.relative(__dirname, file) || file };
  }
  if (envPath) {
    console.warn(`⚠️  GOOGLE_APPLICATION_CREDENTIALS points to a missing or invalid file: ${envPath}`);
  }
  return { key: serviceAccount, source: "serviceAccountKey.json (Firebase key)" };
}

const speechCreds = findSpeechCredentials();
// Stop Google libraries from separately reading a possibly-wrong path.
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
console.log(`🎙️  Speech key: ${speechCreds.source} (project ${speechCreds.key.project_id})`);

const speechClientOptions = {
  credentials: { client_email: speechCreds.key.client_email, private_key: speechCreds.key.private_key },
  projectId: speechCreds.key.project_id
};
const speechClient = new speech.SpeechClient(speechClientOptions);
const ttsClient = new textToSpeech.TextToSpeechClient(speechClientOptions);

initializeApp({ credential: cert(serviceAccount) });
console.log(`🔑 Firebase project (from service account): ${serviceAccount.project_id}`);
const adminDb = getFirestore();
const adminAuth = getAuth();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const deps = { db: adminDb, ai };

// ─── Express ────────────────────────────────────────────────────────────────
const app = express();

// Extra allowed origins (e.g. your Render site) go in .env as
// CORS_ORIGINS=https://maahyu.onrender.com,https://other.example
const allowedOrigins = [
  "http://localhost:8080", "http://127.0.0.1:8080", "http://localhost:5173",
  ...(process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean)
];
app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "200kb" }));
app.use("/audio", express.static(AUDIO_DIR));

// ─── Auth: verify the app's Firebase ID token ───────────────────────────────
// The app sends "Authorization: Bearer <idToken>". We never trust a uid
// sent in the request body.
async function requireAuth(req, res, next) {
  const match = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: "Missing sign-in token" });
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    const msg = String(err.message || "");
    if (/aud|audience|project/i.test(msg)) {
      console.error(
        `❌ App sign-in rejected: the app uses a different Firebase project than this backend ` +
        `(${serviceAccount.project_id}). Put the service-account key from the SAME project as ` +
        `js/firebase-config.js into backend/serviceAccountKey.json, then restart.`
      );
    } else {
      console.warn("Rejected token:", err.code || msg);
    }
    res.status(401).json({ error: "Invalid sign-in token" });
  }
}

// ─── Speech helpers ─────────────────────────────────────────────────────────
function stripEmojis(text) {
  return (text || "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();
}

async function transcribeVoiceNote(mediaUrl, languageCode = "en-IN") {
  const audioResponse = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    auth: { username: process.env.TWILIO_SID, password: process.env.TWILIO_AUTH_TOKEN }
  });
  const [response] = await speechClient.recognize({
    audio: { content: Buffer.from(audioResponse.data).toString("base64") },
    config: { encoding: "OGG_OPUS", sampleRateHertz: 16000, languageCode }
  });
  return (response.results || []).map((r) => r.alternatives[0].transcript).join(" ").trim();
}

async function synthesizeToBuffer(text, languageCode) {
  const [response] = await ttsClient.synthesizeSpeech({
    input: { text: stripEmojis(text).slice(0, 2000) },
    voice: { languageCode, ssmlGender: "FEMALE" },
    audioConfig: { audioEncoding: "MP3" }
  });
  return Buffer.from(response.audioContent);
}

/** Turns Google's speech errors into a plain next step in the terminal. */
function explainSpeechError(err) {
  const msg = String(err?.message || err);
  const project = speechCreds.key.project_id;
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(msg)) {
    console.error(`👉 Enable "Cloud Text-to-Speech API" and "Cloud Speech-to-Text API" for project ${project}: ` +
      `console.cloud.google.com → APIs & Services → Library.`);
  } else if (/BILLING|billing/i.test(msg)) {
    console.error(`👉 Project ${project} needs billing turned on to use Google speech services.`);
  } else if (/PERMISSION_DENIED|403/i.test(msg)) {
    console.error(`👉 The speech key (${speechCreds.source}) isn't allowed to use speech services in ${project}. ` +
      `Check the APIs are enabled there, or use a key from the project where they are.`);
  } else if (/UNAUTHENTICATED|invalid_grant|401/i.test(msg)) {
    console.error(`👉 The speech key (${speechCreds.source}) was rejected — it may have been deleted. Create a new key.`);
  }
}

// WhatsApp needs a public URL for voice replies.
// NOTE: Render wipes this folder on restart — move to Firebase Storage in Phase 2.
async function synthesizeToUrl(text, languageCode) {
  const audio = await synthesizeToBuffer(text, languageCode);
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const fileName = `reply-${Date.now()}.mp3`;
  fs.writeFileSync(path.join(AUDIO_DIR, fileName), audio);
  return `${process.env.PUBLIC_BASE_URL}/audio/${fileName}`;
}

// ─── ASHA dashboard API (lib/asha.js) ───────────────────────────────────────
app.use("/asha", createAshaRouter({ db: adminDb, adminAuth }));

// ─── GET /me ────────────────────────────────────────────────────────────────
app.get("/me", requireAuth, async (req, res) => {
  try {
    const mother = await getOrCreateAppMother(adminDb, req.uid);
    res.json({ motherId: mother.id, language: mother.data.language || null });
  } catch (err) {
    console.error("/me ERROR:", err);
    res.status(500).json({ error: "Could not load profile" });
  }
});

// ─── POST /chat ─────────────────────────────────────────────────────────────
app.post("/chat", requireAuth, async (req, res) => {
  const { message, lang, audioUrl, inputType } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const mother = await getOrCreateAppMother(adminDb, req.uid, { lang });
    const result = await processMessage(deps, {
      mother,
      channel: "app",
      text: message,
      lang,
      inputType: ["voice", "chip", "text"].includes(inputType) ? inputType : "text",
      audioUrl: typeof audioUrl === "string" ? audioUrl : null
    });
    if (result.flag?.severity) {
      console.log(`🚩 Flag — severity: ${result.flag.severity} | mother: ${mother.id}`);
    }
    res.json({
      motherId: mother.id,
      entryId: result.entryId,
      reply: result.reply,
      replySource: result.replySource,
      sources: result.sources,
      escalation: result.escalation
    });
  } catch (err) {
    console.error("Chat ERROR:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ─── POST /entries/sync ── messages she sent while offline ──────────────────
// Body: { items: [{ clientId, text, lang, reply, clientTimestamp, inputType, audioUrl }] }
app.post("/entries/sync", requireAuth, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  try {
    const mother = await getOrCreateAppMother(adminDb, req.uid);
    const oldest = Date.now() - 30 * 86400000;
    const results = [];
    for (const item of items) {
      const ts = Number(item.clientTimestamp);
      const validId = typeof item.clientId === "string" && /^[\w-]{6,64}$/.test(item.clientId);
      if (!validId || !item.text || !Number.isFinite(ts) || ts < oldest || ts > Date.now() + 60000) {
        results.push({ clientId: item.clientId, ok: false });
        continue;
      }
      const r = await processMessage(deps, {
        mother,
        channel: "app",
        text: String(item.text),
        lang: item.lang,
        inputType: item.inputType || "voice",
        audioUrl: typeof item.audioUrl === "string" ? item.audioUrl : null,
        clientReply: typeof item.reply === "string" ? item.reply.slice(0, 2000) : undefined,
        clientTimestamp: ts,
        entryId: `offline_${item.clientId}`
      });
      results.push({ clientId: item.clientId, ok: true, entryId: r.entryId });
    }
    res.json({ motherId: mother.id, results });
  } catch (err) {
    console.error("Sync ERROR:", err);
    res.status(500).json({ error: "Sync failed" });
  }
});

// ─── POST /tts ── spoken replies for the app ────────────────────────────────
app.post("/tts", requireAuth, async (req, res) => {
  const { text, lang } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required" });
  }
  try {
    const audio = await synthesizeToBuffer(text, toSpeechLang(lang));
    res.json({ audio: audio.toString("base64"), format: "mp3" });
  } catch (err) {
    console.error("TTS ERROR:", err.message || err);
    explainSpeechError(err);
    res.status(500).json({ error: "Text-to-speech failed" });
  }
});

// ─── POST /grandma-wisdom ───────────────────────────────────────────────────
app.post("/grandma-wisdom", async (req, res) => {
  const { region, stage, category, count = 6 } = req.body;

  const prompt = `You are an expert in Indian traditional maternal and childcare practices with deep knowledge of Ayurveda, regional folk medicine, and modern biomedical research. 

Generate ${count} authentic traditional wellness tips for mothers. Be HIGHLY SPECIFIC to the region, not generic Pan-India advice.

Parameters:
- Region: ${region}
- Motherhood Stage: ${stage}  
- Category: ${category}

For each tip, respond ONLY with a valid JSON array. No markdown, no backticks, no preamble. Example format:
[
  {
    "title": "Specific practice name (include local language name if applicable)",
    "traditional": "Detailed description of the practice as elders would explain it, including local ingredients/methods, 2-3 sentences",
    "scientific": "Specific scientific explanation citing actual compounds, mechanisms, and peer-reviewed findings where possible, 2-3 sentences",
    "region": "${region}",
    "stage": "${stage}",
    "category": "${category}",
    "localName": "Name in local language/script if applicable",
    "caution": "Any safety note or contraindication if relevant, else empty string"
  }
]

Be extremely specific — mention actual plant/spice compounds (e.g. gingerol, thymol, diosgenin), cite mechanisms of action, and reference regional specificity (e.g. coastal Karnataka vs. Malnad belt practices differ). Avoid vague or generic claims.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        systemInstruction:
          "You are a precise medical anthropologist and ethnobotanist. Always respond with valid JSON only. Never include markdown formatting or backticks.",
      },
    });

    const raw   = response.text.trim().replace(/```json|```/g, "").trim();
    const cards = JSON.parse(raw);
    res.json({ cards });
  } catch (err) {
    console.error("Grandma Wisdom Error:", err);
    res.status(500).json({ error: "Failed to generate wisdom tips." });
  }
});

// ─── WhatsApp (Twilio) ──────────────────────────────────────────────────────
const WA_TEXT = {
  welcome:
    "Namaskara! Namaste! Welcome to Maahyu 💛\n" +
    "ಕನ್ನಡಕ್ಕಾಗಿ 1 ಒತ್ತಿ\n" +
    "हिंदी के लिए 2 भेजें\n" +
    "Reply 3 for English",
  invalidChoice: "Please reply 1 (ಕನ್ನಡ), 2 (हिंदी) or 3 (English).",
  ready: {
    kn: "ಸರಿ, ಶುರು ಮಾಡೋಣ! ನೀವು ಯಾವಾಗ ಬೇಕಾದರೂ ನನ್ನೊಂದಿಗೆ ಮಾತನಾಡಬಹುದು — ವಾಯ್ಸ್ ನೋಟ್ ಅಥವಾ ಮೆಸೇಜ್ ಕಳುಹಿಸಿ. 💛",
    hi: "बहुत अच्छा, चलिए शुरू करते हैं! आप कभी भी मुझसे बात कर सकती हैं — voice note या message भेजें। 💛",
    en: "Great, let's begin! You can talk to me anytime — send a voice note or a message. 💛"
  },
  notHeard: {
    kn: "ಕ್ಷಮಿಸಿ, ನನಗೆ ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ಮತ್ತೊಮ್ಮೆ ಕಳುಹಿಸುತ್ತೀರಾ? 💛",
    hi: "माफ़ कीजिए, मुझे ठीक से सुनाई नहीं दिया। क्या आप फिर से भेज सकती हैं? 💛",
    en: "Sorry, I couldn't quite hear that. Could you send it again? 💛"
  },
  error: "Sorry, something went wrong on my side. Please try again in a minute. 💛"
};
const LANG_CHOICES = { "1": "kn", "2": "hi", "3": "en" };

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

function twiml(res, { body = "", mediaUrl = null } = {}) {
  res.set("Content-Type", "text/xml");
  const media = mediaUrl ? `<Media>${escapeXml(mediaUrl)}</Media>` : "";
  const text = body ? `<Body>${escapeXml(body)}</Body>` : "";
  res.send(`<Response><Message>${text}${media}</Message></Response>`);
}

function classifyMessage(body) {
  if (parseInt(body.NumMedia) > 0 && body.MediaContentType0?.startsWith("audio")) return "voice";
  const emojiOnly = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+$/u;
  if (body.Body && emojiOnly.test(body.Body.trim())) return "emoji";
  return "text";
}

app.post("/whatsapp/webhook", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const mother = await getOrCreateWhatsAppMother(adminDb, req.body.From);
    // Her WhatsApp name helps her ASHA worker recognise her on the dashboard.
    const profileName = String(req.body.ProfileName || "").trim().slice(0, 60);
    if (profileName && profileName !== mother.data.displayName) {
      mother.ref.set({ displayName: profileName }, { merge: true }).catch(() => {});
    }

    // ── Onboarding: pick a language, no signup ──
    if (mother.data.awaitingLanguage) {
      if (mother.isNew) return twiml(res, { body: WA_TEXT.welcome });
      const lang = LANG_CHOICES[req.body.Body?.trim()];
      if (!lang) return twiml(res, { body: WA_TEXT.invalidChoice });
      await mother.ref.set({ language: lang, awaitingLanguage: false }, { merge: true });
      return twiml(res, { body: WA_TEXT.ready[lang] });
    }

    const lang = toShortLang(mother.data.language);
    const type = classifyMessage(req.body);
    console.log(`📩 WhatsApp ${type} from ${mother.id}: ${req.body.Body || "(voice note)"}`);

    let text = req.body.Body?.trim() || "";
    if (type === "voice") {
      try {
        text = await transcribeVoiceNote(req.body.MediaUrl0, toSpeechLang(lang));
      } catch (err) {
        console.error("STT ERROR:", err.message || err);
        explainSpeechError(err);
        return twiml(res, { body: WA_TEXT.notHeard[lang] });
      }
      console.log("Transcribed voice note:", text || "(empty)");
      if (!text) return twiml(res, { body: WA_TEXT.notHeard[lang] });
    }
    if (!text) return twiml(res, { body: WA_TEXT.notHeard[lang] });

    // Emoji check-ins get dedicated mood mapping in Phase 2; for now they
    // go through the same pipeline as text.
    const result = await processMessage(deps, {
      mother, channel: "whatsapp", text, lang, inputType: type
    });
    if (result.flag?.severity) {
      console.log(`🚩 Flag — severity: ${result.flag.severity} | mother: ${mother.id}`);
    }

    // Crisis: always include the helpline as text, even with a voice reply.
    const urgentLine = result.escalation.level === "urgent" ? `\n\n${result.escalation.message}` : "";

    if (type === "voice") {
      try {
        const audioUrl = await synthesizeToUrl(result.reply, toSpeechLang(lang));
        return twiml(res, { body: urgentLine.trim(), mediaUrl: audioUrl });
      } catch (err) {
        // Voice reply failed: still answer her, in text.
        console.error("TTS ERROR:", err.message || err);
        explainSpeechError(err);
        return twiml(res, { body: result.reply + urgentLine });
      }
    }
    return twiml(res, { body: result.reply + urgentLine });
  } catch (err) {
    console.error("WhatsApp webhook ERROR:", err);
    return twiml(res, { body: WA_TEXT.error });
  }
});

// ─── Start server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));