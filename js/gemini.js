// ============================================================
// MAAHYU — Chat orchestrator
// ------------------------------------------------------------
// chat(text, lang, { inputType, audioUrl })
//   → { reply, escalation, offlineSource, sources }
//
// Online:  POST /chat. The backend runs the whole pipeline (scoring,
//          risk, ASHA flag, Gemini + RAG) and saves the entry.
// Offline (or backend unreachable): reply from the offline KB,
//          escalate using the same shared rules, and queue the
//          message so the backend processes it once she reconnects.
//
// Never throws: the UI always gets a reply.
// ============================================================
import { apiPost, canReachBackend, rememberMotherId } from "./api.js";
import { matchOffline } from "./offline-kb.js";
import { scorePHQ9Full } from "./mood-scoring.js";
import { detectFlags, decideEscalation } from "./escalation.js";
import { queueEntry } from "./offline-queue.js";

const EMPTY_REPLY = {
  en: "I couldn't quite hear that. Could you try again, or tap one of the options below? 💛",
  hi: "मुझे ठीक से सुनाई नहीं दिया। क्या आप फिर से बोल सकती हैं, या नीचे कोई विकल्प चुनें? 💛",
  kn: "ನನಗೆ ಸರಿಯಾಗಿ ಕೇಳಿಸಲಿಲ್ಲ. ಮತ್ತೊಮ್ಮೆ ಹೇಳುತ್ತೀರಾ, ಅಥವಾ ಕೆಳಗಿನ ಆಯ್ಕೆಯನ್ನು ಒತ್ತಿ? 💛"
};

// Offline-only: distressed messages this session (online, the backend
// counts distressed DAYS from her full history instead).
let session = { distressedMessages: 0 };

export function resetSession() {
  session = { distressedMessages: 0 };
}

function offlineReply(text, lang) {
  const phq = scorePHQ9Full(text);
  const flag = detectFlags(text);
  if (phq.rawDomainHits > 0 || flag.severity) session.distressedMessages += 1;
  return {
    reply: matchOffline(text, lang).response,
    escalation: decideEscalation({
      phq, flagSeverity: flag.severity, distressCount: session.distressedMessages, lang
    })
  };
}

export async function chat(text, lang = "en", { inputType = "voice", audioUrl = null } = {}) {
  const clean = (text || "").trim();
  if (!clean) {
    return {
      reply: EMPTY_REPLY[lang] || EMPTY_REPLY.en,
      escalation: { level: "none", message: "" },
      offlineSource: true,
      sources: []
    };
  }

  if (canReachBackend()) {
    try {
      const data = await apiPost("/chat", { message: clean, lang, inputType, audioUrl });
      rememberMotherId(data.motherId);
      return {
        reply: data.reply,
        escalation: data.escalation || { level: "none", message: "" },
        offlineSource: data.replySource === "offline-kb",
        sources: data.sources || []
      };
    } catch (err) {
      const hint = /401/.test(err.message) ? " — the backend rejected the sign-in; check the backend terminal" : "";
      console.warn(`Backend chat failed, answering offline and queueing: ${err.message || err}${hint}`);
    }
  }

  const { reply, escalation } = offlineReply(clean, lang);
  queueEntry({ text: clean, lang, reply, inputType, audioUrl });
  return { reply, escalation, offlineSource: true, queued: true, sources: [] };
}
