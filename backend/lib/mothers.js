// ============================================================
// MAAHYU — Mother identity  (shared data model, see docs/DATA_MODEL.md)
// ------------------------------------------------------------
// Every mother has ONE document: mothers/{motherId}
//   • WhatsApp mothers:   motherId = her phone in E.164, e.g. "+919876543210"
//   • App-only mothers:   motherId = "app_<firebase uid>" until she verifies
//     her phone (Phase 5 OTP), at which point the app account is linked
//     to her phone document so her WhatsApp history carries over.
// ============================================================
import { FieldValue } from "firebase-admin/firestore";

export const SHORT_LANGS = ["en", "hi", "kn"];
const SPEECH_TAGS = { en: "en-IN", hi: "hi-IN", kn: "kn-IN" };

/** "kn-IN" | "kn" | undefined → "kn" (defaults to "en") */
export function toShortLang(lang) {
  const short = String(lang || "").slice(0, 2).toLowerCase();
  return SHORT_LANGS.includes(short) ? short : "en";
}

/** "kn" → "kn-IN" for Google Speech-to-Text / Text-to-Speech */
export function toSpeechLang(lang) {
  return SPEECH_TAGS[toShortLang(lang)];
}

/** Twilio "whatsapp:+91 98765 43210" → "+919876543210" */
export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function newMotherDoc(extra) {
  return {
    phone: null,
    appUid: null,
    language: null,
    village: null,          // set during onboarding (Phase 3/5)
    pregnancyStage: null,   // "pregnant" | "0-2weeks" | "2-6weeks" | "6weeks+"
    assignedAshaId: null,
    channels: [],
    // Rolling summary the ASHA dashboard sorts and filters on:
    lastMessageAt: null,
    lastMoodScore: null,
    latestRiskTier: null,
    latestRiskScore: null,
    needsFollowUp: false,
    followUpPriority: null, // "high" | "medium"
    followUpReason: null,
    followUpSince: null,
    createdAt: FieldValue.serverTimestamp(),
    ...extra
  };
}

/**
 * Finds or creates the mother for a WhatsApp sender.
 * Also migrates the old "mothers/whatsapp:+91…" docs from before Phase 1.
 */
export async function getOrCreateWhatsAppMother(db, rawFrom) {
  const phone = normalizePhone(rawFrom);
  const ref = db.collection("mothers").doc(phone);
  const snap = await ref.get();
  if (snap.exists) return { id: phone, ref, data: snap.data(), isNew: false };

  // Legacy doc keyed by the raw Twilio "From" value.
  const legacyRef = db.collection("mothers").doc(String(rawFrom));
  const legacySnap = rawFrom !== phone ? await legacyRef.get() : null;
  const legacy = legacySnap?.exists ? legacySnap.data() : {};

  const data = newMotherDoc({
    phone,
    channels: ["whatsapp"],
    language: legacy.language ? toShortLang(legacy.language) : null,
    awaitingLanguage: legacy.language ? false : true
  });
  await ref.set(data);
  if (legacySnap?.exists) await legacyRef.delete();
  return { id: phone, ref, data, isNew: !legacySnap?.exists };
}

/**
 * Finds or creates the mother for a signed-in app user (Firebase uid).
 * If her app account is already linked to a phone doc, that doc is used.
 */
export async function getOrCreateAppMother(db, uid, { lang } = {}) {
  const linked = await db.collection("mothers").where("appUid", "==", uid).limit(1).get();
  if (!linked.empty) {
    const d = linked.docs[0];
    return { id: d.id, ref: d.ref, data: d.data(), isNew: false };
  }
  const id = `app_${uid}`;
  const ref = db.collection("mothers").doc(id);
  const data = newMotherDoc({
    appUid: uid,
    channels: ["app"],
    language: lang ? toShortLang(lang) : null
  });
  await ref.set(data);
  return { id, ref, data, isNew: true };
}
