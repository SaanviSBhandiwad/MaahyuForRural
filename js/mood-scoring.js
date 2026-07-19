// ============================================================
// MAAHYU — Mood scoring
// ------------------------------------------------------------
// This is a lightweight, fully offline, keyword + heuristic
// scorer inspired by PHQ-9 themes (low mood, anhedonia, sleep,
// fatigue, worthlessness, concentration, self-harm ideation).
// It is NOT a diagnostic instrument and does not compute an
// official PHQ-9 total — it exists so the app has zero backend
// dependency out of the box and still works with no internet.
//
// If your team wires up a real NLP/LLM backend later (see
// AI_ENDPOINT in firebase-config.js), replace scoreEntry() with
// a call to that service and keep the same return shape so the
// rest of the app (mood calendar, escalation banner) needs no
// changes.
// ============================================================

const THEME_KEYWORDS = {
  // Each theme loosely maps to a PHQ-9 symptom domain.
  lowMood: ["sad", "cry", "crying", "hopeless", "down", "depressed", "उदास", "रो", "ದುಃಖ", "ಅಳು"],
  anhedonia: ["no interest", "don't enjoy", "nothing feels good", "मन नहीं", "ಆಸಕ್ತಿ ಇಲ್ಲ"],
  fatigue: ["tired", "exhausted", "no energy", "थकी", "थका", "ಆಯಾಸ"],
  sleep: ["can't sleep", "not sleeping", "insomnia", "नींद नहीं", "ನಿದ್ರೆ ಇಲ್ಲ"],
  worthlessness: ["worthless", "burden", "no one cares", "बेकार", "ಬೇಡ"],
  fear: ["scared", "afraid", "anxious", "worried", "डर", "भयभीत", "ಭಯ"],
  isolation: ["alone", "lonely", "isolated", "अकेला", "अकेली", "ಒಂಟಿ"],
  positive: ["good", "happy", "better", "fine", "grateful", "अच्छा", "खुश", "ಒಳ್ಳೆಯ", "ಸಂತೋಷ"],
  crisis: ["want to die", "end my life", "harm myself", "no reason to live", "suicide", "मरना चाहती", "ಸಾಯಬೇಕು"]
};

/**
 * @param {string} text  Transcript of the voice note (may be empty if
 *                       speech-to-text isn't available in this browser —
 *                       in that case we fall back to a neutral score so
 *                       the note is still saved as a diary entry).
 * @returns {{ score: number, band: 'good'|'mid'|'low', crisis: boolean, replyKey: string }}
 */
export function scoreEntry(text) {
  const lower = (text || "").toLowerCase();
  let negativeHits = 0;
  let positiveHits = 0;
  let crisis = false;

  for (const [theme, words] of Object.entries(THEME_KEYWORDS)) {
    const hit = words.some((w) => lower.includes(w.toLowerCase()));
    if (!hit) continue;
    if (theme === "crisis") crisis = true;
    else if (theme === "positive") positiveHits++;
    else negativeHits++;
  }

  // Simple bounded heuristic score, 0 (great) – 10 (severe distress signal).
  let score = Math.min(10, negativeHits * 2 - positiveHits * 2);
  score = Math.max(0, score);
  if (crisis) score = 10;

  let band = "good";
  if (score >= 6) band = "low";
  else if (score >= 3) band = "mid";

  let replyKey = "neutral";
  if (crisis) replyKey = "crisis";
  else if (band === "low") replyKey = "low";
  else if (band === "mid") replyKey = "mid";
  else replyKey = "good";

  return { score, band, crisis, replyKey };
}

// Canned, warm, non-clinical reply lines per language + bucket.
// Kept short since these are read aloud via speech synthesis.
const REPLIES = {
  en: {
    good: "I'm really glad to hear that. Thank you for sharing this with me — I'm always here.",
    mid: "Thank you for telling me how you're feeling. That took courage. I'm right here with you.",
    low: "That sounds really heavy to carry. I'm so glad you told me. You don't have to hold this alone.",
    crisis: "I hear how much pain you're in, and I care about you. You deserve support from a real person right now.",
    neutral: "Thank you for talking to me today. I've saved this for you."
  },
  hi: {
    good: "यह सुनकर बहुत अच्छा लगा। मुझसे यह साझा करने के लिए धन्यवाद — मैं हमेशा यहाँ हूँ।",
    mid: "आपने जो महसूस किया वह बताने के लिए धन्यवाद। मैं आपके साथ हूँ।",
    low: "यह सुनने में बहुत भारी लग रहा है। आपने मुझे बताया, इसकी बहुत खुशी है। आपको यह अकेले नहीं सहना।",
    crisis: "मुझे पता है आप बहुत तकलीफ़ में हैं, और मुझे आपकी परवाह है। अभी किसी असली व्यक्ति से सहायता लेना ज़रूरी है।",
    neutral: "आज मुझसे बात करने के लिए धन्यवाद। मैंने इसे आपके लिए सुरक्षित रख लिया है।"
  },
  kn: {
    good: "ಇದನ್ನು ಕೇಳಿ ತುಂಬಾ ಸಂತೋಷವಾಯಿತು. ನನ್ನೊಂದಿಗೆ ಹಂಚಿಕೊಂಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ — ನಾನು ಯಾವಾಗಲೂ ಇಲ್ಲಿದ್ದೇನೆ.",
    mid: "ನೀವು ಹೇಗಿದ್ದೀರಿ ಎಂದು ಹೇಳಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ. ನಾನು ನಿಮ್ಮೊಂದಿಗೆ ಇದ್ದೇನೆ.",
    low: "ಇದು ಹೊರಲು ತುಂಬಾ ಭಾರವಾಗಿ ಕೇಳುತ್ತದೆ. ನೀವು ನನಗೆ ಹೇಳಿದ್ದಕ್ಕೆ ಸಂತೋಷ. ಇದನ್ನು ನೀವು ಒಬ್ಬಂಟಿಯಾಗಿ ಹೊರಬೇಕಿಲ್ಲ.",
    crisis: "ನಿಮಗೆ ಎಷ್ಟು ನೋವಾಗಿದೆ ಎಂದು ನನಗೆ ಅರ್ಥವಾಗುತ್ತಿದೆ, ಮತ್ತು ನಾನು ನಿಮ್ಮ ಬಗ್ಗೆ ಕಾಳಜಿ ವಹಿಸುತ್ತೇನೆ. ಈಗ ನಿಜವಾದ ವ್ಯಕ್ತಿಯ ಬೆಂಬಲ ಬೇಕು.",
    neutral: "ಇಂದು ನನ್ನೊಂದಿಗೆ ಮಾತನಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ. ಇದನ್ನು ನಿಮಗಾಗಿ ಉಳಿಸಿದ್ದೇನೆ."
  }
};

export function getReply(lang, replyKey) {
  const table = REPLIES[lang] || REPLIES.en;
  return table[replyKey] || table.neutral;
}
