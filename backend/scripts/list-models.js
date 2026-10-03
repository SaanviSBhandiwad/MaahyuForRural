// ============================================================
// MAAHYU — Which AI models can my keys use?
// Run from the backend folder:   node scripts/list-models.js
// Then copy names into .env:
//   GEMINI_MODELS=<main model>,<backup model>
//   ALT_LLM_MODEL=<Groq/Grok model>
// ============================================================
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

if (process.env.GEMINI_API_KEY) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const names = [];
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    for await (const m of pager) {
      const name = String(m.name || "").replace(/^models\//, "");
      if (m.supportedActions?.includes("generateContent") && /^gemini/.test(name) && !/tts|image|embedding|live|audio/i.test(name)) {
        names.push(name);
      }
    }
    console.log("\nGemini models your key can use:");
    console.log(names.length ? names.sort().map((n) => `  ${n}`).join("\n") : "  (none found)");
    console.log('  Tip: pick a "flash" model as main and a "flash-lite" model as backup.');
  } catch (err) {
    console.log(`\nGemini: could not list models — ${String(err.message || err).slice(0, 200)}`);
  }
} else {
  console.log("\nGemini: no GEMINI_API_KEY in .env");
}

if (process.env.ALT_LLM_BASE_URL && process.env.ALT_LLM_API_KEY) {
  try {
    const base = process.env.ALT_LLM_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${process.env.ALT_LLM_API_KEY}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data.error || data).slice(0, 200)}`);
    const ids = (data.data || []).filter((m) => m.active !== false).map((m) => m.id)
      .filter((id) => !/whisper|tts|guard|embed|playai|orpheus/i.test(id)).sort();
    console.log(`\n${base.includes("groq") ? "Groq" : "Grok/other"} chat models your key can use:`);
    console.log(ids.length ? ids.map((n) => `  ${n}`).join("\n") : "  (none found)");
    console.log("  Tip: prefer a large model (e.g. one with 70b or more in the name) for Kannada and Hindi.");
  } catch (err) {
    console.log(`\nGroq/Grok: could not list models — ${err.message}`);
  }
} else {
  console.log("\nGroq/Grok: ALT_LLM_BASE_URL / ALT_LLM_API_KEY not set in .env");
}
console.log("");
process.exit(0);