// ============================================================
// MAAHYU — RAG Knowledge Base  (Person C — Step 1)
// Verified scheme + care facts. Retrieved locally, no network.
// Used by gemini.js to ground Gemini replies in real facts.
// ============================================================

const KB = [
  {
    id: "pmmvy",
    title: "PMMVY",
    keywords: ["pmmvy","matru vandana","first child","second girl","5000","6000","anganwadi","pregnancy money","maternity benefit"],
    content: "PMMVY gives ₹5,000 for the first child (released in installments tied to antenatal checkups and birth registration). Under PMMVY 2.0, if the second child is a girl, an additional ₹6,000 is given — total ₹11,000 across both. Apply at the nearest Anganwadi centre with Aadhaar and bank details. ASHA worker can help fill the form. Women in permanent govt/PSU jobs already getting paid maternity leave are not eligible."
  },
  {
    id: "jsy_karnataka",
    title: "JSY Karnataka",
    keywords: ["jsy","janani suraksha","hospital delivery","delivery money","₹700","700","institutional delivery"],
    content: "JSY pays ₹700 for rural institutional delivery in Karnataka (a high-performing state). Payment goes directly to the mother's bank account within about a week of delivery. Register pregnancy early with ASHA or PHC and deliver at a government or JSY-empanelled private hospital."
  },
  {
    id: "thayi_bhagya",
    title: "Thayi Bhagya",
    keywords: ["thayi bhagya","free delivery","karnataka","bpl","sc st","thayi card","free hospital","free treatment"],
    content: "Thayi Bhagya (Karnataka) makes delivery fully free — covers normal delivery, C-section, pre/post-delivery treatment, transport, and medicines. Mainly for BPL/SC/ST families. Get the Thayi Card from your ASHA worker early in pregnancy — without it, hospitals may not waive the costs."
  },
  {
    id: "mathrushree",
    title: "Mathrushree / Mathrupoorna",
    keywords: ["mathrushree","mathrupoorna","1000 per month","6000","monthly support","karnataka bpl","anganwadi worker"],
    content: "Mathrushree (Karnataka) gives ₹1,000/month for 6 months — 3 months before and 3 months after delivery — totalling ₹6,000, for BPL families. Transferred to Aadhaar-linked bank account. Enroll through the local Anganwadi worker. Available for the first two deliveries."
  },
  {
    id: "asha_role",
    title: "What ASHA worker can help with",
    keywords: ["asha","health worker","who to call","community health","anganwadi","home visit","find asha"],
    content: "ASHA workers help register pregnancy, arrange antenatal checkups, apply for JSY/PMMVY/Thayi Bhagya, accompany for hospital delivery, and do home visits after delivery (approximately day 3, 7, 14, 28, and 42). Free to contact. If you don't know your ASHA's number, the nearest Anganwadi centre or PHC can connect you."
  },
  {
    id: "emergency",
    title: "Emergency warning signs after delivery",
    keywords: ["emergency","danger","bleeding","bleed","fever","convulsion","fits","seizure","not breathing","blue","unconscious","blurred vision","severe pain","severe headache","swelling","go to hospital","108","रक्तस्राव","खून बह","बुखार","दौरा","ರಕ್ತಸ್ರಾವ","ಜ್ವರ","ಆಸ್ಪತ್ರೆ"],
    content: "Go to PHC or hospital immediately — call ASHA for transport — if you have: heavy bleeding (soaking a pad in under an hour), high fever, severe headache with blurred vision, convulsions, foul-smelling discharge, severe abdominal pain, or baby turning blue / not feeding / very lethargic. Do not wait for the next scheduled visit."
  },
  {
    id: "postpartum_depression",
    title: "Postpartum depression and baby blues",
    keywords: ["postpartum","ppd","depression","baby blues","hopeless","not bonding","two weeks","mood","mental health","sad after delivery"],
    content: "Baby blues (first 2 weeks): tearfulness and mood swings — usually passes on its own. Postpartum depression: persistent sadness, difficulty bonding with baby, loss of interest, sleep/appetite changes, anxiety, or thoughts of harm lasting more than 2 weeks. Very common (1 in 5 Indian mothers) and treatable — not a personal failing. Talk to ASHA worker or PHC doctor."
  },
  {
    id: "nutrition_ifa",
    title: "Nutrition and iron-folic acid (IFA)",
    keywords: ["iron","folic acid","ifa","anaemia","anemia","food","diet","nutrition","weak","pale","khoon","ರಕ್ತ","खून"],
    content: "Free IFA (iron-folic acid) tablets are available from your ASHA worker or PHC — take them after food to reduce stomach upset. Eating leafy greens, dal, and citrus fruit helps iron absorption. Don't skip meals while breastfeeding — body needs extra nutrition, not less."
  },
  {
    id: "postnatal_schedule",
    title: "Postnatal checkup schedule",
    keywords: ["checkup","visit schedule","day 3","day 7","42 days","postnatal","anm","home visit after delivery"],
    content: "Government guidelines recommend ASHA/ANM home visits around day 3, 7, 14, 28, and 42 after delivery — checking mother's recovery (bleeding, infection, mood) and baby's health. A natural moment to mention emotional concerns. Missing one isn't a crisis — visit the PHC to catch up."
  }
];

function normalise(text) {
  return (text || "").toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ") // \p{M} keeps Hindi/Kannada vowel signs
    .replace(/\s+/g, " ")
    .trim();
}

export function retrieveRAG(query, topK = 2) {
  const n = normalise(query);
  const scored = KB.map(entry => {
    const hits = entry.keywords.filter(kw => n.includes(kw.toLowerCase())).length;
    // The title only breaks ties between entries that already matched a keyword,
    // so common words like "when" or "baby" can't pull in unrelated facts.
    const titleBonus = hits > 0 && entry.title.toLowerCase().split(" ").some(w => w.length > 4 && n.includes(w)) ? 1 : 0;
    return { entry, score: hits + titleBonus };
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(r => r.entry);
}

/**
 * Builds a grounded prompt to pass to Gemini.
 * Returns { prompt, sources[] } — sources for Firestore logging.
 */
export function buildGroundedPrompt(userMessage) {
  const hits = retrieveRAG(userMessage, 2);
  if (hits.length === 0) return { prompt: userMessage, sources: [] };
  const context = hits.map(h => `[${h.title}]\n${h.content}`).join("\n\n");
  const prompt =
    `Relevant verified facts (use ONLY these for any factual claims — never invent rupee amounts, scheme names, or medical details not listed here):\n${context}\n\nHer message: ${userMessage}`;
  return { prompt, sources: hits.map(h => h.id) };
}
