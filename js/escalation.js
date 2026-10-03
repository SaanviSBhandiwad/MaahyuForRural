// ============================================================
// MAAHYU — Escalation rules  (shared by backend + app)
// ------------------------------------------------------------
// Pure module, no imports, no browser APIs: backend/lib/pipeline.js
// imports this exact file, and the app uses it only when offline.
//
//   detectFlags(text)  → { severity: "high"|"medium"|null, keywords[] }
//   decideEscalation({ phq, flagSeverity, distressCount, lang })
//                      → { level: "none"|"suggest"|"urgent", message }
// ============================================================

const HIGH_SEVERITY_KEYWORDS = [
  "kill myself", "end my life", "want to die", "suicide", "hurt myself",
  "can't go on", "cant go on", "dont want to live", "don't want to live", "harm myself",
  "self harm", "self-harm", "not worth living", "better off dead",
  "end it all", "no reason to live", "wish i was dead",
  "marna chahti", "jeena nahi chahti", "saaya beku", "baduku beda",
  "मरना चाहती", "जीना नहीं चाहती", "ಸಾಯಬೇಕು", "ಬದುಕು ಬೇಡ"
];

const MEDIUM_SEVERITY_KEYWORDS = [
  "hopeless", "worthless", "nobody cares", "give up", "can't cope",
  "cant cope", "falling apart", "hate myself", "no point", "disappear",
  "exhausted and broken", "can't do this anymore", "cant do this anymore",
  "feel empty", "nothing matters", "so alone", "completely alone",
  "nirasha", "bekar hoon", "koi parwah nahi", "niraasha",
  "निराश", "बेकार", "अकेली", "ನಿರಾಶೆ", "ಒಂಟಿ"
];

// Patterns catch the many ways people actually say it ("feeling to die",
// "feel like dying", "mar jana hai"…), not just one exact phrase.
// Tested against everyday sentences ("my grandmother died", "I'm dying
// to see my mother", "ಸಾಯಂಕಾಲ" = evening) so they don't fire on those.
const CRISIS_PATTERNS = [
  // English
  /\b(?:want|wanna|wanted|feel|feeling|felt|going|ready|wish|wishing|trying|thinking(?: of| about)?|plan(?:ning)?)\s+(?:like\s+)?(?:to\s+)?(?:die|dying|end\s+(?:it|my\s+life|everything)|kill(?:ing)?\s+myself)\b/,
  /\b(?:don['’]?t|do\s+not|dont|no\s+longer)\s+want\s+to\s+(?:live|be\s+alive|exist|wake\s+up|be\s+here)\b/,
  /\b(?:kill(?:ing)?|hurt(?:ing)?|harm(?:ing)?|cut(?:ting)?|end(?:ing)?)\s+(?:myself|my\s+self|my\s+life)\b/,
  /\bsuicid/,
  /\b(?:no|not\s+any|nothing\s+to)\s+(?:reason|point)\s+(?:to|in)\s+(?:live|living|go\s+on)\b/,
  /\bbetter\s+off\s+(?:dead|without\s+me)\b/,
  /\b(?:wish|wished)\s+i\s+(?:was|were)\s+(?:dead|never\s+born)\b/,
  /\b(?:can['’]?t|cannot|cant)\s+(?:go\s+on|live\s+like\s+this|take\s+it\s+anymore)\b/,
  // Hinglish
  /\bmar\s+(?:jana|jaana|jaun|jaaun|jaungi|jaoongi|jaati|jaau)\b/,
  /\bmarna\s+(?:chahti|chahta|hai)\b/,
  /\bjeena\s+nahi\s+(?:chahti|chahta|hai)\b/,
  /\b(?:khudkushi|aatmahatya|atmahatya)\b/,
  /\bzindagi\s+khatam\b/,
  // Romanised Kannada
  /\b(?:saaya|saya|saay)\s*beku\b/,
  /\b(?:saaythini|saaytini|saayuttene)\b/,
  /\b(?:baduku|badukoke)\s+(?:beda|ishta\s+illa)\b/,
  /\b(?:athmahatye|aatmahatye)\b/,
  // Hindi script (no \b: JavaScript word boundaries don't work for Devanagari)
  /मर\s*(?:जाना|जाऊं|जाऊँ|जाऊंगी|जाऊँगी|जाती)/,
  /मरना\s*(?:चाहती|चाहता|है)/,
  /जीना\s*नहीं/,
  /(?:आत्महत्या|ख़ुदकुशी|खुदकुशी)/,
  /ज़िंदगी\s*ख़त्म|जिंदगी\s*खत्म/,
  // Kannada script
  /(?:ಸಾಯಬೇಕು|ಸಾಯುತ್ತೇನೆ|ಸಾಯ್ತೀನಿ|ಸಾಯೋಣ|ಸತ್ತು\s*ಹೋಗ)/,
  /ಬದುಕು\s*ಬೇಡ|ಬದುಕಲು\s*ಇಷ್ಟವಿಲ್ಲ/,
  /ಆತ್ಮಹತ್ಯೆ/
];

/** True if the text expresses wanting to die or self-harm, in any of our languages. */
export function isCrisisText(text) {
  const n = normalise(text);
  return HIGH_SEVERITY_KEYWORDS.some((k) => n.includes(k.toLowerCase())) ||
         CRISIS_PATTERNS.some((re) => re.test(n));
}

// Distressed days in the last 30 before we gently suggest a real person.
export const SUGGEST_AFTER_DISTRESSED_DAYS = 3;

export const ESCALATION_MESSAGES = {
  suggest: {
    en: "You've been carrying a lot. Would you like to talk to your ASHA worker or someone you trust? Tap \"Talk to someone\" whenever you're ready.",
    hi: "आप बहुत कुछ सह रही हैं। क्या आप अपनी ASHA worker या किसी भरोसेमंद व्यक्ति से बात करना चाहेंगी? जब तैयार हों, \"किसी से बात करें\" दबाएं।",
    kn: "ನೀವು ತುಂಬಾ ಹೊರುತ್ತಿದ್ದೀರಿ. ನಿಮ್ಮ ASHA ಕಾರ್ಯಕರ್ತೆ ಅಥವಾ ನಂಬಿಕೆಯ ವ್ಯಕ್ತಿಯೊಂದಿಗೆ ಮಾತನಾಡಲು ಬಯಸುವಿರಾ? ಸಿದ್ಧವಾದಾಗ \"ಯಾರೊಂದಿಗಾದರೂ ಮಾತನಾಡಿ\" ಒತ್ತಿ."
  },
  urgent: {
    en: "You don't have to face this alone. Please talk to someone right now. iCall: 9152987821.",
    hi: "आपको यह अकेले नहीं सहना है। कृपया अभी किसी से बात करें। iCall: 9152987821।",
    kn: "ಇದನ್ನು ನೀವು ಒಬ್ಬರೇ ಎದುರಿಸಬೇಕಿಲ್ಲ. ದಯವಿಟ್ಟು ಈಗಲೇ ಯಾರೊಂದಿಗಾದರೂ ಮಾತನಾಡಿ. iCall: 9152987821."
  }
};

function normalise(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function detectFlags(text) {
  const n = normalise(text);
  const high = HIGH_SEVERITY_KEYWORDS.filter((k) => n.includes(k.toLowerCase()));
  if (high.length) return { severity: "high", keywords: high };
  const matched = CRISIS_PATTERNS.find((re) => re.test(n));
  if (matched) return { severity: "high", keywords: [n.match(matched)[0]] };
  const medium = MEDIUM_SEVERITY_KEYWORDS.filter((k) => n.includes(k.toLowerCase()));
  if (medium.length) return { severity: "medium", keywords: medium };
  return { severity: null, keywords: [] };
}

/**
 * @param {{ phq: {severity, domainsTriggered}, flagSeverity: string|null,
 *           distressCount: number, lang: string }} input
 *   distressCount = distressed days in the last 30 (backend) or
 *                   distressed messages this session (app, offline).
 */
export function decideEscalation({ phq, flagSeverity = null, distressCount = 0, lang = "en" }) {
  const pick = (table) => table[lang] || table.en;

  if (flagSeverity === "high" || phq.domainsTriggered.includes("Q9_selfharm")) {
    return { level: "urgent", message: pick(ESCALATION_MESSAGES.urgent) };
  }
  const heavy = ["moderate", "moderately_severe", "severe"].includes(phq.severity);
  if (flagSeverity === "medium" || heavy || distressCount >= SUGGEST_AFTER_DISTRESSED_DAYS) {
    return { level: "suggest", message: pick(ESCALATION_MESSAGES.suggest) };
  }
  return { level: "none", message: "" };
}
