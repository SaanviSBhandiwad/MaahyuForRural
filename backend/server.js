// ─── Imports (order matters!) ─────────────────────────────────────────────────
import dotenv from "dotenv";
dotenv.config(); // ← must be FIRST so process.env is ready

import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import axios from "axios";
import speech from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import { createReadStream } from "fs";
import fs from "fs";
//import { buildContextBlock } from "./rag/ragEngine.js";


const speechClient = new speech.SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

const serviceAccount = process.env.SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.SERVICE_ACCOUNT_JSON)
  : (await import("./serviceAccountKey.json", { with: { type: "json" } })).default;

// ─── Firebase Admin init ──────────────────────────────────────────────────────
initializeApp({ credential: cert(serviceAccount) });
const adminDb = getFirestore();

// ─── Express setup ────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: ["http://localhost:8080", "http://localhost:5173", "https://your-render-app.onrender.com"],
  methods: ["GET", "POST"],
}));
app.use(express.json());
app.use('/audio', express.static('public-audio'));

// ─── Gemini AI ────────────────────────────────────────────────────────────────
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ─── Flag keyword lists ───────────────────────────────────────────────────────
const HIGH_SEVERITY_KEYWORDS = [
  "kill myself", "end my life", "want to die", "suicide", "hurt myself",
  "can't go on", "dont want to live", "don't want to live", "harm myself",
  "self harm", "self-harm", "not worth living", "better off dead",
  "end it all", "no reason to live",
];

const MEDIUM_SEVERITY_KEYWORDS = [
  "hopeless", "worthless", "nobody cares", "give up", "can't cope",
  "cant cope", "falling apart", "hate myself", "no point", "disappear",
  "exhausted and broken", "can't do this anymore", "cant do this anymore",
  "feel empty", "nothing matters", "so alone", "completely alone",
];

function detectFlags(message) {
  const lower = message.toLowerCase();
  const highHits   = HIGH_SEVERITY_KEYWORDS.filter((k) => lower.includes(k));
  const mediumHits = MEDIUM_SEVERITY_KEYWORDS.filter((k) => lower.includes(k));

  if (highHits.length > 0) {
    return { flagged: true, severity: "high",   keywords: highHits };
  }
  if (mediumHits.length > 0) {
    return { flagged: true, severity: "medium", keywords: mediumHits };
  }
  return { flagged: false };
}

function classifyMessage(body) {
  if (parseInt(body.NumMedia) > 0 && body.MediaContentType0?.startsWith('audio')) {
    return 'voice';
  }
  const emojiRegex = /^[\u{1F600}-\u{1F64F}\u{2600}-\u{27BF}]+$/u;
  if (body.Body && emojiRegex.test(body.Body.trim())) {
    return 'emoji';
  }
  return 'text';
}

// ─── ADD transcription function────────────────────────────────────────────
async function transcribeVoiceNote(mediaUrl) {
  const audioResponse = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    auth: { username: process.env.TWILIO_SID, password: process.env.TWILIO_AUTH_TOKEN }
  });
  const audioBytes = Buffer.from(audioResponse.data).toString('base64');

  const [response] = await speechClient.recognize({
    audio: { content: audioBytes },
    config: {
      encoding: 'OGG_OPUS',
      sampleRateHertz: 16000,
      languageCode: 'en-IN',
    },
  });
  return response.results.map(r => r.alternatives[0].transcript).join(' ');
}
async function synthesizeSpeech(text, languageCode = "kn-IN") {
  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode, ssmlGender: 'FEMALE' },
    audioConfig: { audioEncoding: 'MP3' },
  });

  const fileName = `reply-${Date.now()}.mp3`;
  fs.writeFileSync(`./public-audio/${fileName}`, response.audioContent);

  return `${process.env.PUBLIC_BASE_URL}/audio/${fileName}`;
}

// ─── POST /chat ───────────────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  const {
    message,
    uid,
    userName,
    userEmail,
    emergencyContact,
    emergencyPhone,
    region, // optional, e.g. "karnataka" — falls back to "national"-only docs if absent
  } = req.body;

  // ── Flag detection — runs before AI, writes to Firestore if triggered ──────
  const flagResult = detectFlags(message);
  if (flagResult.flagged) {
    try {
      await adminDb.collection("flags").add({
        uid:              uid              || "unknown",
        userName:         userName         || "Unknown User",
        userEmail:        userEmail        || "Unknown",
        emergencyContact: emergencyContact || "Not provided",
        emergencyPhone:   emergencyPhone   || "Not provided",
        triggerMessage:   message,
        keywords:         flagResult.keywords,
        severity:         flagResult.severity,
        resolved:         false,
        createdAt:        new Date(),
      });
      console.log(`🚩 Flag saved — severity: ${flagResult.severity} | user: ${userEmail}`);
    } catch (flagErr) {
      // Don't block the chat response if flag write fails
      console.error("Failed to save flag:", flagErr);
    }
  }

  // ── RAG retrieval — ground the reply in real scheme/care facts ─────────────
  const contextText = "";
const sources = [];
  if (sources.length > 0) {
    console.log(`📚 RAG matched: ${sources.map((s) => s.id).join(", ")}`);
  }

  // ── Send message to Gemini, with retrieved facts attached if any ──────────
  try {
    const groundedPrompt = contextText
      ? `Relevant verified facts (use these for any factual/scheme/medical claims — do not invent numbers or details beyond what's given here):\n${contextText}\n\nHer message: ${message}`
      : message;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: groundedPrompt,
      config: {
        systemInstruction: `
You are SheRo, a warm, empathetic AI companion designed to support pregnant women and new mothers.

Your tone:
- Kind, gentle, and emotionally supportive
- Non-judgmental and comforting
- Like a caring friend, not a doctor

Your behavior:
- Understand the user's emotional state (stress, sadness, anxiety, happiness)
- Respond with empathy first, then gentle guidance
- Keep responses short (2 to 4 lines)
- Use simple, soothing language
- If she asks a simple, casual, or factual question, answer it directly and warmly first — don't redirect every message into emotional support.

Guidelines:
- DO NOT give strict medical advice or diagnosis
- DO NOT sound robotic or overly technical
- DO NOT dismiss feelings

Grounding rules (important):
- If "Relevant verified facts" are provided above her message, base any factual claim
  (scheme names, amounts, eligibility, medical/emergency guidance) ONLY on those facts.
- Never invent a rupee amount, scheme name, or medical claim that isn't in the provided facts.
- If she asks something factual and no facts were provided, say gently that you're not sure
  and she should check with her ASHA worker or local PHC — do not guess.
- Weave facts in naturally and briefly, in her language register — don't read them out like
  a government notice.

Instead:
- Validate emotions ("That sounds really tough…")
- Reassure ("You are not alone in feeling this way")
- Offer light suggestions (rest, breathing, talking to someone)

If user is:
- Stressed → calm and reassure
- Sad → show empathy and support
- Anxious → gently ground them
- Happy → celebrate with them

End responses with warmth when appropriate (💛 optional but not overused)`,
      },
    });
    res.json({ reply: response.text, sources: sources.map((s) => s.id) });
  } catch (err) {
    console.error("Chat ERROR:", err);
    res.status(500).json({ reply: "Something went wrong. Please try again." });
  }
});

// ─── POST /grandma-wisdom ─────────────────────────────────────────────────────
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

// ─── Strip emojis before sending text to Text-to-Speech ──────────────────────
function stripEmojis(text) {
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
}


// ─── Reusable AI reply function (used by WhatsApp webhook) ───────────────────
async function getAIReply(message) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: message,
    config: {
      systemInstruction: `
You are SheRo, a warm, empathetic AI companion designed to support pregnant women and new mothers.

Your tone:
- Kind, gentle, and emotionally supportive
- Non-judgmental and comforting
- Like a caring friend, not a doctor

Your behavior:
- Understand the user's emotional state (stress, sadness, anxiety, happiness)
- Respond with empathy first, then gentle guidance
- Keep responses short (2 to 4 lines)
- If she asks a simple, casual, or factual question, answer it directly and warmly first — don't redirect every message into emotional support.

Guidelines:
- DO NOT give strict medical advice or diagnosis
- DO NOT sound robotic or overly technical
- DO NOT dismiss feelings

Instead:
- Validate emotions ("That sounds really tough…")
- Reassure ("You are not alone in feeling this way")
- Offer light suggestions (rest, breathing, talking to someone)

If user is:
- Stressed → calm and reassure
- Sad → show empathy and support
- Anxious → gently ground them
- Happy → celebrate with them

End responses with warmth when appropriate (💛 optional but not overused)`,
    },
  });
  return response.text;
}

/// ─── POST /whatsapp/webhook ───────────────────────────────────────────────────
app.post("/whatsapp/webhook", express.urlencoded({ extended: false }), async (req, res) => {
  const messageType = classifyMessage(req.body);

  if (messageType === 'voice') {
    const transcript = await transcribeVoiceNote(req.body.MediaUrl0);
    console.log("Transcribed voice note:", transcript);

    const aiReplyText = await getAIReply(transcript);
    console.log("AI reply text:", aiReplyText);

    console.log("Text sent to voice (emoji stripped):", stripEmojis(aiReplyText));
    const replyAudioUrl = await synthesizeSpeech(stripEmojis(aiReplyText), "kn-IN");
    console.log("Reply audio URL:", replyAudioUrl);

    res.set("Content-Type", "text/xml");
    return res.send(`<Response><Message><Media>${replyAudioUrl}</Media></Message></Response>`);
  } else {
    console.log("Message type:", messageType, "| Body:", req.body.Body);
  }

  res.set("Content-Type", "text/xml");
  res.send(`<Response><Message>Hello, I got your message!</Message></Response>`);
});
// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));