// ============================================================
// MAAHYU — Offline Knowledge Base + Matcher  (Person C Steps 4 & 5)
// ------------------------------------------------------------
// 19 common situations with pre-written responses in EN/HI/KN.
// matchOffline(text, lang) → best response, zero network calls.
// Used when navigator.onLine === false OR Gemini call fails.
// ============================================================

const KB = [
  {
    id: "crisis", priority: 99,
    keywords: [
      "want to die","kill myself","end my life","hurt myself","self harm",
      "better off dead","no reason to live","marna chahti","saaya beku","baduku beda",
      "मरना चाहती","ಸಾಯಬೇಕು"
    ],
    responses: {
      en: "I'm very concerned about you right now. Please call iCall at 9152987821 or reach your ASHA worker immediately. You deserve care and support — please don't face this alone. 🚨💛",
      hi: "मुझे आपकी बहुत चिंता है। कृपया अभी iCall को call करें: 9152987821 या अपनी ASHA worker से मिलें। आप अकेली नहीं हैं। 🚨💛",
      kn: "ನಾನು ನಿಮ್ಮ ಬಗ್ಗೆ ತುಂಬಾ ಚಿಂತಿತಳಾಗಿದ್ದೇನೆ. ದಯವಿಟ್ಟು ಈಗ iCall ಗೆ ಕರೆ ಮಾಡಿ: 9152987821. 🚨💛"
    }
  },
  {
    id: "emergency", priority: 98,
    keywords: [
      "heavy bleeding","not breathing","turning blue","convulsion","seizure",
      "very high fever","unconscious","fainted","emergency"
    ],
    responses: {
      en: "This sounds urgent. Please go to the nearest PHC or hospital immediately, or call your ASHA worker to arrange transport. Do not wait. 🚨",
      hi: "यह जरूरी लग रहा है। कृपया तुरंत नजदीकी PHC या अस्पताल जाएं। इंतजार न करें। 🚨",
      kn: "ಇದು ತುರ್ತು ಎಂದು ತೋರುತ್ತಿದೆ. ದಯವಿಟ್ಟು ಈಗಲೇ ಹತ್ತಿರದ PHC ಗೆ ಹೋಗಿ. 🚨"
    }
  },
  {
    id: "fatigue",
    keywords: ["tired","exhausted","no energy","drained","thak","sulidu","emme illa","ಆಯಾಸ","थकी","थका"],
    responses: {
      en: "It makes complete sense to feel this way — your body is doing so much right now. Rest whenever your baby sleeps, even for a few minutes. You don't have to do everything at once. 💛",
      hi: "इस तरह महसूस करना बिल्कुल स्वाभाविक है। जब बच्चा सोए तब आप भी आराम करें। सब कुछ एक साथ नहीं करना है। 💛",
      kn: "ಹೀಗೆ ಅನಿಸುವುದು ಸ್ವಾಭಾವಿಕ. ಮಗು ಮಲಗಿದಾಗ ನೀವೂ ವಿಶ್ರಾಂತಿ ತೆಗೆದುಕೊಳ್ಳಿ. 💛"
    }
  },
  {
    id: "sleep",
    keywords: ["can't sleep","cant sleep","no sleep","awake","insomnia","neend nahi","nidde bartilla","नींद नहीं","ನಿದ್ರೆ ಇಲ್ಲ"],
    responses: {
      en: "Not being able to sleep when you're exhausted is really hard. Try to sleep when your baby sleeps, even during the day. If this continues for many days with low mood, please tell your ASHA worker. 💛",
      hi: "थकी होने के बावजूद नींद न आना बहुत कठिन है। जब बच्चा सोए तब आप भी सोने की कोशिश करें। 💛",
      kn: "ಆಯಾಸದಲ್ಲೂ ನಿದ್ರೆ ಬಾರದಿರುವುದು ಕಷ್ಟ. ಮಗು ಮಲಗಿದಾಗ ನೀವೂ ಮಲಗಲು ಪ್ರಯತ್ನಿಸಿ. 💛"
    }
  },
  {
    id: "sadness",
    keywords: ["sad","crying","cry","tears","upset","udaas","dukhi","rona","mana khushi illa","उदास","ದುಃಖ"],
    responses: {
      en: "It is okay to cry. Your feelings are real and they matter. Many mothers feel this way after delivery — you are not alone. If this sadness stays more than two weeks, do talk to your ASHA worker. 💛",
      hi: "रोना बिल्कुल ठीक है। बहुत सी माताएं प्रसव के बाद ऐसा महसूस करती हैं — आप अकेली नहीं हैं। 💛",
      kn: "ಅಳುವುದು ಸರಿಯೇ. ಪ್ರಸವದ ನಂತರ ಅನೇಕ ತಾಯಂದಿರು ಹೀಗೆ ಅನಿಸುತ್ತದೆ — ನೀವು ಒಂಟಿಯಲ್ಲ. 💛"
    }
  },
  {
    id: "hopeless",
    keywords: ["hopeless","no hope","nothing will improve","what's the point","whats the point","nirasha","niraasha","निराश","ನಿರಾಶೆ"],
    responses: {
      en: "When everything feels hopeless it can be hard to see a way forward — but this feeling can get better with the right support. Please talk to your ASHA worker soon. 💛",
      hi: "जब सब कुछ निराशाजनक लगे तो आगे का रास्ता दिखना मुश्किल होता है — लेकिन सही मदद से यह बेहतर हो सकता है। ASHA worker से बात करें। 💛",
      kn: "ಎಲ್ಲವೂ ನಿರಾಶಾದಾಯಕ ಎನಿಸಿದಾಗ ದಾರಿ ಕಾಣದಿರಬಹುದು — ಆದರೆ ಸರಿಯಾದ ಬೆಂಬಲದಿಂದ ಸುಧಾರಿಸಬಹುದು. 💛"
    }
  },
  {
    id: "anxiety",
    keywords: ["anxious","anxiety","worry","worried","scared","fear","panic","nervous","darr","chinta","डर","ಭಯ"],
    responses: {
      en: "Worrying about your baby and yourself is natural. Try slow deep breaths: in for 4 counts, hold for 4, out for 4. If the worry feels constant and overwhelming, please share it with your ASHA worker. 💛",
      hi: "चिंता करना स्वाभाविक है। धीरे-धीरे सांस लेने की कोशिश करें। अगर चिंता बहुत ज्यादा हो तो ASHA worker को बताएं। 💛",
      kn: "ಚಿಂತಿಸುವುದು ಸ್ವಾಭಾವಿಕ. ನಿಧಾನ ಉಸಿರಾಟ ಪ್ರಯತ್ನಿಸಿ. ಚಿಂತೆ ತುಂಬಾ ಹೆಚ್ಚಾದರೆ ASHA worker ಗೆ ತಿಳಿಸಿ. 💛"
    }
  },
  {
    id: "bad_mother",
    keywords: ["bad mother","bad mom","failing","not good enough","buri maa","nanna thappu","my fault","blame myself"],
    responses: {
      en: "You are not a bad mother. The fact that you care so deeply is proof of that. Every mother struggles — what matters is that you keep trying. 💛",
      hi: "आप बुरी माँ नहीं हैं। आपकी इतनी परवाह ही इसका सबूत है। हर माँ संघर्ष करती है। 💛",
      kn: "ನೀವು ಕೆಟ್ಟ ತಾಯಿ ಅಲ್ಲ. ನಿಮ್ಮ ಕಾಳಜಿಯೇ ಅದರ ಪುರಾವೆ. ಪ್ರಯತ್ನ ಮಾಡುತ್ತಿದ್ದೀರಿ, ಅದೇ ಸಾಕು. 💛"
    }
  },
  {
    id: "appetite",
    keywords: ["not eating","no appetite","can't eat","cant eat","skipping meals","not hungry","bhooka nahi","unda hasi illa"],
    responses: {
      en: "Your body needs food to heal and produce milk. Even small amounts — a banana, some dal and rice — are better than nothing. Try to eat something every few hours. 💛",
      hi: "आपके शरीर को खाना चाहिए। थोड़ा-थोड़ा खाना भी ठीक है — केला, दाल-चावल। हर कुछ घंटों में कुछ खाने की कोशिश करें। 💛",
      kn: "ನಿಮ್ಮ ದೇಹಕ್ಕೆ ಆಹಾರ ಬೇಕು. ಸ್ವಲ್ಪ ಸ್ವಲ್ಪ ತಿನ್ನಿ — ಬಾಳೆಹಣ್ಣು, ಅನ್ನ-ಸಾರು. 💛"
    }
  },
  {
    id: "baby_crying",
    keywords: ["baby crying","baby cries","baby won't stop","baby keeps crying","magu aladthide","bachha ro raha"],
    responses: {
      en: "A crying baby is stressful — it's okay to feel overwhelmed. Check if the baby is hungry, needs a nappy change, or wants to be held. If baby seems unwell — very high temperature or turning blue — go to the PHC immediately. 💛",
      hi: "रोता बच्चा तनावपूर्ण होता है। देखें कि बच्चा भूखा है, डायपर बदलना है, या गोद में आना चाहता है। अगर बच्चा बीमार लगे तो तुरंत PHC जाएं। 💛",
      kn: "ಅಳುವ ಮಗು ಒತ್ತಡ ತರುತ್ತದೆ. ಮಗು ಹಸಿದಿದೆಯೇ, ಡಯಾಪರ್ ಬದಲಿಸಬೇಕೇ, ಅಥವಾ ತೊಡೆಯಲ್ಲಿ ಬೇಕೇ ಎಂದು ನೋಡಿ. 💛"
    }
  },
  {
    id: "scheme_money",
    keywords: ["money","scheme","benefit","pmmvy","jsy","government","yojana","sarkar","free","cash"],
    responses: {
      en: "There are government schemes with cash support — PMMVY gives up to ₹5,000 for your first child, and JSY gives cash for hospital delivery. Your ASHA worker can help you apply at the nearest Anganwadi centre. 💛",
      hi: "सरकारी योजनाएं हैं — PMMVY पहले बच्चे के लिए ₹5,000 तक देती है, JSY अस्पताल में प्रसव के लिए पैसे देती है। ASHA worker आवेदन में मदद कर सकती है। 💛",
      kn: "PMMVY ಮೊದಲ ಮಗುವಿಗೆ ₹5,000, JSY ಆಸ್ಪತ್ರೆ ಪ್ರಸವಕ್ಕೆ ಹಣ ನೀಡುತ್ತದೆ. ASHA worker ಅರ್ಜಿ ಸಲ್ಲಿಸಲು ಸಹಾಯ ಮಾಡುತ್ತಾರೆ. 💛"
    }
  },
  {
    id: "iron_nutrition",
    keywords: ["iron","folic acid","ifa","anaemia","anemia","weak","pale","nutrition","diet","khoon","ರಕ್ತ"],
    responses: {
      en: "Free iron and folic acid tablets are available from your ASHA worker or PHC. Take them after food. Eating leafy greens, dal, and citrus fruit helps your body absorb the iron better. 💛",
      hi: "आयरन और फोलिक एसिड की गोलियां ASHA worker या PHC से मुफ्त मिलती हैं। खाने के बाद लें। हरी सब्जियां, दाल और नींबू खाएं। 💛",
      kn: "ಕಬ್ಬಿಣ ಮತ್ತು ಫೋಲಿಕ್ ಆ್ಯಸಿಡ್ ಮಾತ್ರೆಗಳು ASHA worker ನಲ್ಲಿ ಉಚಿತ. ಊಟದ ನಂತರ ತೆಗೆದುಕೊಳ್ಳಿ. 💛"
    }
  },
  {
    id: "lonely",
    keywords: ["alone","lonely","isolated","no support","akeli","yaaravoo illa","अकेला","ಒಂಟಿ"],
    responses: {
      en: "Feeling alone when you're going through so much is really painful. Your ASHA worker visits regularly — please open up to her, she is there for your whole wellbeing, not just physical health. 💛",
      hi: "इतने कठिन समय में अकेला महसूस करना बहुत दर्दनाक है। आपकी ASHA worker नियमित रूप से आती है — उनसे खुलकर बात करें। 💛",
      kn: "ಒಂಟಿ ಅನಿಸುವುದು ತುಂಬಾ ನೋವಿನ ಸಂಗತಿ. ASHA worker ನಿಯಮಿತವಾಗಿ ಭೇಟಿ ನೀಡುತ್ತಾರೆ — ಅವರೊಂದಿಗೆ ಮಾತನಾಡಿ. 💛"
    }
  },
  {
    id: "overwhelmed",
    keywords: ["overwhelmed","too much","can't handle","cant handle","falling apart","can't cope","cant cope"],
    responses: {
      en: "It's okay to feel like it's all too much. Pick the one most important thing right now and leave the rest. Is there anyone who can take the baby for just 30 minutes so you can rest? 💛",
      hi: "ऐसा लगना ठीक है कि सब बहुत ज्यादा है। अभी सिर्फ एक सबसे ज़रूरी काम करें। क्या कोई 30 मिनट बच्चे को संभाल सकता है? 💛",
      kn: "ಎಲ್ಲವೂ ಹೆಚ್ಚು ಎನಿಸಿದಾಗ ಒಂದೇ ಒಂದು ಮುಖ್ಯ ಕೆಲಸ ಮಾಡಿ. ಯಾರಾದರೂ 30 ನಿಮಿಷ ಮಗುವನ್ನು ನೋಡಿಕೊಳ್ಳಬಹುದೇ? 💛"
    }
  },
  {
    id: "positive",
    keywords: ["happy","good day","feeling better","baby smiled","doing well","khush","chennagide","खुश","ಸಂತೋಷ"],
    responses: {
      en: "That's so wonderful to hear! Hold onto this feeling — you are doing so well. 💛",
      hi: "यह सुनकर बहुत अच्छा लगा! इस एहसास को संजो कर रखें — आप बहुत अच्छा कर रही हैं। 💛",
      kn: "ಇದನ್ನು ಕೇಳಿ ತುಂಬಾ ಸಂತೋಷವಾಯಿತು! ನೀವು ತುಂಬಾ ಚೆನ್ನಾಗಿ ಮಾಡುತ್ತಿದ್ದೀರಿ. 💛"
    }
  },
  {
    id: "breastfeeding",
    keywords: ["breastfeeding","feeding problem","milk not coming","baby not feeding","sore nipples","dudh nahi","halu bartilla"],
    responses: {
      en: "Breastfeeding difficulties are very common in the first few weeks. Feed more often to increase supply. Your ASHA worker or ANM can show you the correct latch position in person. 💛",
      hi: "पहले कुछ हफ्तों में स्तनपान की समस्याएं बहुत आम हैं। ज्यादा बार दूध पिलाएं। ASHA worker सही तरीका बता सकती हैं। 💛",
      kn: "ಮೊದಲ ಕೆಲವು ವಾರಗಳಲ್ಲಿ ಸ್ತನ್ಯಪಾನ ತೊಂದರೆ ಸಾಮಾನ್ಯ. ಹೆಚ್ಚಾಗಿ ಹಾಲು ಕೊಡಿ. ASHA worker ಸರಿಯಾದ ರೀತಿ ತೋರಿಸಬಹುದು. 💛"
    }
  },
  {
    id: "pain",
    keywords: ["pain","hurting","sore","stitches","bleeding after delivery","discharge","dard","vedane","novu"],
    responses: {
      en: "Some pain after delivery is normal in the first 1-2 weeks. If pain is severe, increasing, or you have heavy bleeding or fever, please go to the PHC — don't wait. 💛",
      hi: "प्रसव के बाद कुछ दर्द सामान्य है। लेकिन अगर दर्द बढ़ रहा हो, बहुत खून आ रहा हो या बुखार हो तो तुरंत PHC जाएं। 💛",
      kn: "ಪ್ರಸವದ ನಂತರ ಸ್ವಲ್ಪ ನೋವು ಸಾಮಾನ್ಯ. ನೋವು ಹೆಚ್ಚಾದರೆ ಅಥವಾ ಜ್ವರ ಇದ್ದರೆ PHC ಗೆ ಹೋಗಿ. 💛"
    }
  },
  {
    id: "greeting",
    keywords: ["hello","hi","namaste","namaskar","good morning","good evening","vannakam","how are you"],
    responses: {
      en: "Hello! I'm SheRo, your wellness companion. I'm here to listen and support you. How are you feeling today? 💛",
      hi: "नमस्ते! मैं SheRo हूँ, आपका वेलनेस साथी। मैं यहाँ आपकी बात सुनने के लिए हूँ। आज आप कैसा महसूस कर रही हैं? 💛",
      kn: "ನಮಸ್ಕಾರ! ನಾನು SheRo, ನಿಮ್ಮ ಆರೋಗ್ಯ ಸಂಗಾತಿ. ಇಂದು ಹೇಗಿದ್ದೀರಿ? 💛"
    }
  }
];

const FALLBACKS = {
  en: "I'm here with you, even without a connection right now. Whatever you're feeling is valid. Please try to rest, eat something, and if you need urgent help reach your ASHA worker directly. 💛",
  hi: "मैं आपके साथ हूँ, अभी connection नहीं है। आप जो भी महसूस कर रही हैं वह सच्चा है। आराम करें, कुछ खाएं, और जरूरी हो तो ASHA worker को बुलाएं। 💛",
  kn: "ನಾನು ನಿಮ್ಮೊಂದಿಗಿದ್ದೇನೆ, ಈಗ connection ಇಲ್ಲ. ವಿಶ್ರಾಂತಿ ತೆಗೆಕೊಳ್ಳಿ, ತಿನ್ನಿ, ತುರ್ತಿದ್ದರೆ ASHA worker ಗೆ ಕರೆ ಮಾಡಿ. 💛"
};

function normalise(text) {
  return (text || "").toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ") // \p{M} keeps Hindi/Kannada vowel signs
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match text to best offline KB entry.
 * @param {string} text
 * @param {string} lang  "en"|"hi"|"kn"
 * @returns {{ response: string, entryId: string|null, usedFallback: boolean }}
 */
export function matchOffline(text, lang = "en") {
  const n = normalise(text);
  const safeLang = ["en","hi","kn"].includes(lang) ? lang : "en";

  // Crisis / emergency always first
  for (const entry of KB) {
    if (!entry.priority) continue;
    if (entry.keywords.some(kw => n.includes(kw.toLowerCase()))) {
      return { response: entry.responses[safeLang], entryId: entry.id, usedFallback: false };
    }
  }

  // Score the rest
  let best = null, bestScore = 0;
  for (const entry of KB) {
    if (entry.priority) continue;
    const hits = entry.keywords.filter(kw => n.includes(kw.toLowerCase())).length;
    if (hits > bestScore) { bestScore = hits; best = entry; }
  }

  if (best && bestScore > 0) {
    return { response: best.responses[safeLang], entryId: best.id, usedFallback: false };
  }

  return { response: FALLBACKS[safeLang], entryId: null, usedFallback: true };
}

export function isOnline() {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}
