// ============================================================
// MAAHYU — Conversation Logger  (Person C — Step 8)
// ------------------------------------------------------------
// Writes every conversation turn to Firestore in the shared
// data model agreed at team kickoff. Fire-and-forget — never
// throws to the UI, so a logging failure never breaks the app.
//
// Firestore paths written:
//   users/{uid}/conversationEntries/{auto-id}   ← Person D reads for ASHA dashboard
//   flaggedMothers/{uid}                        ← Person D queries for at-risk list
// ============================================================
import { db, auth } from "./firebase-init.js";
import {
  collection, addDoc, serverTimestamp, doc, setDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { scoreRisk } from "./risk-scorer.js";

// Reads profile data saved by the user in settings
// (Person A can write this from onboarding too — same key)
function getProfile() {
  try { return JSON.parse(localStorage.getItem("maahyu:profile") || "{}"); }
  catch { return {}; }
}

function daysSinceDelivery(stage) {
  return { "0-2weeks": 7, "2-6weeks": 28, "6weeks+": 60, "pregnant": -1 }[stage] ?? 30;
}

/**
 * Log one conversation turn. Call after every AI reply.
 *
 * @param {{
 *   transcript:      string,
 *   aiReply:         string,
 *   phq9Result:      { score, severity, domainsTriggered, rawDomainHits },
 *   escalationLevel: "none"|"suggest"|"urgent",
 *   offlineSource:   boolean,
 *   ragSources:      string[]
 * }} entry
 */
export async function logEntry({ transcript, aiReply, phq9Result, escalationLevel, offlineSource, ragSources }) {
  try {
    const user = auth.currentUser;
    if (!user) return; // anonymous auth not yet resolved — skip

    const profile = getProfile();

    // Build risk features from PHQ-9 result + profile data
    const riskFeatures = {
      phq9Score:         phq9Result.score,
      daysSinceDelivery: daysSinceDelivery(profile.stage),
      ashaVisitsCount:   profile.ashaVisitsCount  ?? 0,
      distanceToPHCKm:   profile.distanceToPHCKm  ?? 10,
      hasFamilySupport:  profile.hasFamilySupport  ?? false,
      numDistressDays:   phq9Result.rawDomainHits  ?? 0,
      literacyLevel:     profile.literacyLevel     ?? 1,
      firstPregnancy:    profile.firstPregnancy    ?? false
    };
    const risk = scoreRisk(riskFeatures);
    const dayKey = new Date().toISOString().slice(0, 10);

    // ── conversationEntries (shared data model) ───────────────────────────────
    await addDoc(collection(db, "users", user.uid, "conversationEntries"), {
      dayKey,
      timestamp:        serverTimestamp(),
      channel:          "app",
      transcript,
      aiReply,
      // PHQ-9 fields (Person C Step 3)
      moodScore:        phq9Result.score,
      moodSeverity:     phq9Result.severity,
      domainsTriggered: phq9Result.domainsTriggered,
      // Risk fields (Person C Step 7)
      riskScore:        risk.score,
      riskTier:         risk.tier,
      riskFlag:         risk.needsASHAFlag || escalationLevel === "urgent",
      // Escalation (Person C Step 6)
      escalationLevel,
      // Source metadata
      offlineSource:    !!offlineSource,
      ragSources:       ragSources || []
    });

    // ── flaggedMothers (Person D ASHA dashboard reads this) ───────────────────
    if (risk.needsASHAFlag || escalationLevel === "urgent") {
      await setDoc(doc(db, "flaggedMothers", user.uid), {
        uid:                user.uid,
        lastFlaggedAt:      serverTimestamp(),
        latestRiskTier:     risk.tier,
        latestRiskScore:    risk.score,
        latestEscalation:   escalationLevel,
        latestMoodSeverity: phq9Result.severity,
        drivingFactors:     risk.drivingFactors,
        resolved:           false   // Person D sets this true after ASHA follow-up
      }, { merge: true });
    }
  } catch (err) {
    // Non-fatal — log failure should never crash the app
    console.warn("conversationLogger: Firestore write failed (non-fatal):", err);
  }
}
