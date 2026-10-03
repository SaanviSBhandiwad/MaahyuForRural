// ============================================================
// MAAHYU — Mood Scoring  (Person C — Step 3)
// ------------------------------------------------------------
// Upgraded from keyword themes to full PHQ-9 domain inference.
// The mother NEVER sees clinical questions — runs silently.
//
// Exports are IDENTICAL to the original file:
//   scoreEntry(text)       → { score, band, crisis, replyKey }
//   getReply(lang, key)    → string
//   scorePHQ9Full(text)    → { score, severity, domainsTriggered, rawDomainHits }
//                            (used by gemini.js + backend pipeline)
// ============================================================
import { isCrisisText } from "./escalation.js";

// ── PHQ-9 domain keyword maps ─────────────────────────────────────────────────
const DOMAINS = [
  {
    domain: "Q1_anhedonia",
    keywords: [
      "no interest","don't enjoy","dont enjoy","nothing feels good","lost interest",
      "not interested","no joy","nothing makes me happy","everything feels pointless",
      "maza nahi","achha nahi lagta","kuch nahi karna",
      "ishtavilla","manasilla","kelasa madoke aaseyilla",
      "मन नहीं","ಆಸಕ್ತಿ ಇಲ್ಲ"
    ]
  },
  {
    domain: "Q2_depressed",
    keywords: [
      "hopeless","depressed","sad","so low","feel empty","feel nothing",
      "crying all the time","can't stop crying","cant stop crying",
      "feel dead inside","no hope","life is meaningless","what's the point",
      "dark feeling","feel like giving up",
      "nirasha","udaas","dukhi","rona aa raha","dil nahi",
      "niraasha","baduku bekilla","mana khushi illa",
      "उदास","रो","ದುಃಖ","ಅಳು"
    ]
  },
  {
    domain: "Q3_sleep",
    keywords: [
      "can't sleep","cant sleep","not sleeping","no sleep","awake all night",
      "sleep too much","sleeping all day","trouble sleeping","insomnia",
      "wake up at night","can't fall asleep","lying awake",
      "neend nahi","neend aa rahi nahi","raat bhar jaga",
      "nidde bartilla","raatri ellaa eddirta",
      "नींद नहीं","ನಿದ್ರೆ ಇಲ್ಲ"
    ]
  },
  {
    domain: "Q4_fatigue",
    keywords: [
      "so tired","exhausted","no energy","can't get up","cant get up",
      "drained","worn out","always tired","fatigue","no strength",
      "too weak","can't do anything","cant do anything",
      "thak gayi","shakti nahi","uthne ki iccha nahi",
      "taakat illa","sulidu hogidini","emme illa",
      "थकी","थका","ಆಯಾಸ"
    ]
  },
  {
    domain: "Q5_appetite",
    keywords: [
      "not eating","can't eat","cant eat","no appetite","lost appetite",
      "overeating","not hungry","skipping meals",
      "food doesn't taste","food doesnt taste","forgot to eat",
      "bhooka nahi","khana nahi khaya","khaane ki ichha nahi",
      "unda hasi illa","tinna ishtavilla"
    ]
  },
  {
    domain: "Q6_worthlessness",
    keywords: [
      "worthless","hate myself","bad mother","failure","my fault",
      "blame myself","feel guilty","useless","burden","let everyone down",
      "not good enough","i'm terrible","im terrible","ashamed",
      "bekar hoon","buri maa hoon","sab meri galti",
      "nanu huduga heen","nanna thappu","ella nanna vina",
      "बेकार","ಬೇಡ"
    ]
  },
  {
    domain: "Q7_concentration",
    keywords: [
      "can't focus","cant focus","can't concentrate","cant concentrate",
      "mind is blank","forgetting everything","can't think","cant think",
      "confused","brain fog","distracted","can't remember","cant remember",
      "dhyan nahi","bhool jaati hoon","dimag kaam nahi karta",
      "gaman illa","ella marettubidtini"
    ]
  },
  {
    domain: "Q8_psychomotor",
    keywords: [
      "moving slowly","talking slowly","feel slow","restless","can't sit still",
      "cant sit still","pacing","agitated","frozen","stuck","can't move","cant move",
      "hilne ka dil nahi","bahut bechain","ek jagah nahi baith sakti"
    ]
  },
  {
    domain: "Q9_selfharm",
    keywords: [
      "kill myself","end my life","want to die","suicide","hurt myself",
      "can't go on","dont want to live","don't want to live","harm myself",
      "self harm","self-harm","not worth living","better off dead",
      "end it all","no reason to live","wish i was dead","rather be dead",
      "marna chahti hoon","jeena nahi chahti","zindagi khatam karna chahti",
      "saaya beku","baduku beda",
      "मरना चाहती","ಸಾಯಬೇಕು"
    ]
  }
];

const POSITIVE_KEYWORDS = [
  "good","happy","better","fine","grateful","great","wonderful","relieved",
  "smile","baby smiled","feeling well",
  "accha","khush","chennagide",
  "अच्छा","खुश","ಒಳ್ಳೆಯ","ಸಂತೋಷ"
];

function normalise(text) {
  return (text || "").toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ") // \p{M} keeps Hindi/Kannada vowel signs
    .replace(/\s+/g, " ")
    .trim();
}

// ── Used by gemini.js + backend/lib/pipeline.js ─────────────────────
export function scorePHQ9Full(text) {
  const n = normalise(text);
  const triggered = [];

  for (const d of DOMAINS) {
    const hit = d.keywords.some(kw => n.includes(kw.toLowerCase())) ||
      (d.domain === "Q9_selfharm" && isCrisisText(text)); // same patterns as the ASHA flag
    if (hit) triggered.push(d.domain);
  }

  const rawDomainHits = triggered.length;
  // Scale 0-9 domains → 0-27 (PHQ-9 max)
  const score = Math.min(27, rawDomainHits * 3);

  let severity = "none";
  if (score >= 20)      severity = "severe";
  else if (score >= 15) severity = "moderately_severe";
  else if (score >= 10) severity = "moderate";
  else if (score >= 5)  severity = "mild";

  return { score, severity, domainsTriggered: triggered, rawDomainHits };
}

// ── Original export — shape unchanged so home-page.js needs no edits ─────────
export function scoreEntry(text) {
  const n = normalise(text);
  const full = scorePHQ9Full(text);
  const crisis = full.domainsTriggered.includes("Q9_selfharm");
  const positiveHits = POSITIVE_KEYWORDS.filter(kw => n.includes(kw.toLowerCase())).length;

  // Map PHQ-9 0-27 → 0-10 band scale used by the mood calendar
  let score = Math.round(full.score / 2.7);
  score = Math.max(0, score - positiveHits);
  if (crisis) score = 10;

  let band = "good";
  if (score >= 6)      band = "low";
  else if (score >= 3) band = "mid";

  let replyKey = "neutral";
  if (crisis)          replyKey = "crisis";
  else if (band === "low") replyKey = "low";
  else if (band === "mid") replyKey = "mid";
  else                 replyKey = "good";

  return { score, band, crisis, replyKey };
}

// ── Replies — same as original ────────────────────────────────────────────────
const REPLIES = {
  en: {
    good:    "I'm really glad to hear that. Thank you for sharing this with me — I'm always here. 💛",
    mid:     "Thank you for telling me how you're feeling. That took courage. I'm right here with you. 💛",
    low:     "That sounds really heavy to carry. I'm so glad you told me. You don't have to hold this alone. 💛",
    crisis:  "I hear how much pain you're in, and I care about you. Please call iCall right now: 9152987821. You deserve real support. 💛",
    neutral: "Thank you for talking to me today. I've saved this for you. 💛"
  },
  hi: {
    good:    "यह सुनकर बहुत अच्छा लगा। मुझसे यह साझा करने के लिए धन्यवाद — मैं हमेशा यहाँ हूँ। 💛",
    mid:     "आपने जो महसूस किया वह बताने के लिए धन्यवाद। मैं आपके साथ हूँ। 💛",
    low:     "यह सुनने में बहुत भारी लग रहा है। आपने मुझे बताया, इसकी बहुत खुशी है। आपको यह अकेले नहीं सहना। 💛",
    crisis:  "मुझे पता है आप बहुत तकलीफ़ में हैं। कृपया अभी iCall को call करें: 9152987821। 💛",
    neutral: "आज मुझसे बात करने के लिए धन्यवाद। मैंने इसे आपके लिए सुरक्षित रख लिया है। 💛"
  },
  kn: {
    good:    "ಇದನ್ನು ಕೇಳಿ ತುಂಬಾ ಸಂತೋಷವಾಯಿತು. ನನ್ನೊಂದಿಗೆ ಹಂಚಿಕೊಂಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ — ನಾನು ಯಾವಾಗಲೂ ಇಲ್ಲಿದ್ದೇನೆ. 💛",
    mid:     "ನೀವು ಹೇಗಿದ್ದೀರಿ ಎಂದು ಹೇಳಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ. ನಾನು ನಿಮ್ಮೊಂದಿಗೆ ಇದ್ದೇನೆ. 💛",
    low:     "ಇದು ಹೊರಲು ತುಂಬಾ ಭಾರವಾಗಿ ಕೇಳುತ್ತದೆ. ನೀವು ನನಗೆ ಹೇಳಿದ್ದಕ್ಕೆ ಸಂತೋಷ. ಇದನ್ನು ನೀವು ಒಬ್ಬಂಟಿಯಾಗಿ ಹೊರಬೇಕಿಲ್ಲ. 💛",
    crisis:  "ನಿಮಗೆ ಎಷ್ಟು ನೋವಾಗಿದೆ ಎಂದು ನನಗೆ ಅರ್ಥವಾಗುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಈಗ iCall ಗೆ ಕರೆ ಮಾಡಿ: 9152987821. 💛",
    neutral: "ಇಂದು ನನ್ನೊಂದಿಗೆ ಮಾತನಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ. ಇದನ್ನು ನಿಮಗಾಗಿ ಉಳಿಸಿದ್ದೇನೆ. 💛"
  }
};

export function getReply(lang, replyKey) {
  const table = REPLIES[lang] || REPLIES.en;
  return table[replyKey] || table.neutral;
}
