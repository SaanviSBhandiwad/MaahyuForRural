// ============================================================
// MAAHYU — ASHA dashboard API  (Phase 4)
// ------------------------------------------------------------
// Every route requires an ASHA worker signed in with phone + OTP
// whose number is registered in ashaWorkers/. She only ever sees
// mothers in HER village; the filtering happens here, on the
// server, so it can't be bypassed from the browser.
//
// Privacy: she sees mood trend, concern themes, risk, and only the
// messages that raised a flag — never the mother's full diary.
//
//   GET  /asha/me
//   GET  /asha/mothers
//   GET  /asha/mothers/:motherId
//   POST /asha/mothers/:motherId/notes   { note, resolve }
// ============================================================
import express from "express";
import { FieldValue } from "firebase-admin/firestore";

const CONCERN_LABELS = {
  Q1_anhedonia: "Lost interest in things",
  Q2_depressed: "Low or hopeless mood",
  Q3_sleep: "Sleep problems",
  Q4_fatigue: "Tiredness / no energy",
  Q5_appetite: "Eating changes",
  Q6_worthlessness: "Feeling worthless or guilty",
  Q7_concentration: "Trouble concentrating",
  Q8_psychomotor: "Restless or slowed down",
  Q9_selfharm: "Thoughts of self-harm"
};

const HISTORY_DAYS = 30;

function toMillis(ts) {
  return ts?.toMillis ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : null);
}

/** Masks a phone number for list views: +91 98••• ••210 */
function maskPhone(phone) {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  return `+${d.slice(0, 2)} ${d.slice(2, 4)}••• ••${d.slice(-3)}`;
}

function motherSummary(id, m) {
  return {
    id,
    displayName: m.displayName || null,
    phoneMasked: maskPhone(m.phone),
    channels: m.channels || [],
    language: m.language || null,
    pregnancyStage: m.pregnancyStage || null,
    lastMessageAt: toMillis(m.lastMessageAt),
    lastMoodScore: m.lastMoodScore ?? null,
    riskTier: m.latestRiskTier || null,
    riskScore: m.latestRiskScore ?? null,
    needsFollowUp: Boolean(m.needsFollowUp),
    followUpPriority: m.followUpPriority || null,
    followUpReason: m.followUpReason || null,
    followUpSince: toMillis(m.followUpSince)
  };
}

const PRIORITY_RANK = { high: 0, medium: 1 };

/** Needs follow-up first (high before medium, longest-waiting first), then by recent activity. */
export function sortForDashboard(a, b) {
  if (a.needsFollowUp !== b.needsFollowUp) return a.needsFollowUp ? -1 : 1;
  if (a.needsFollowUp) {
    const pr = (PRIORITY_RANK[a.followUpPriority] ?? 2) - (PRIORITY_RANK[b.followUpPriority] ?? 2);
    if (pr) return pr;
    return (a.followUpSince ?? 0) - (b.followUpSince ?? 0);
  }
  return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
}

export function createAshaRouter({ db, adminAuth }) {
  const router = express.Router();

  // ── Auth: phone-OTP Firebase user whose number is a registered ASHA ──
  async function requireAsha(req, res, next) {
    const match = (req.headers.authorization || "").match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: "Please sign in." });
    try {
      const decoded = await adminAuth.verifyIdToken(match[1]);
      if (!decoded.phone_number) {
        return res.status(403).json({ error: "Sign in with your phone number." });
      }
      const snap = await db.collection("ashaWorkers")
        .where("phone", "==", decoded.phone_number).limit(1).get();
      if (snap.empty) {
        return res.status(403).json({ error: "This number is not registered as an ASHA worker." });
      }
      const doc = snap.docs[0];
      if (doc.data().authUid !== decoded.uid) {
        await doc.ref.set({ authUid: decoded.uid }, { merge: true });
      }
      req.asha = { id: doc.id, ...doc.data() };
      next();
    } catch (err) {
      console.warn("ASHA auth rejected:", err.code || err.message);
      res.status(401).json({ error: "Session expired. Please sign in again." });
    }
  }

  async function loadMotherInVillage(req, res) {
    const ref = db.collection("mothers").doc(req.params.motherId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().village !== req.asha.village) {
      res.status(404).json({ error: "Mother not found in your village." });
      return null;
    }
    return { ref, data: snap.data() };
  }

  router.use(requireAsha);

  router.get("/me", (req, res) => {
    res.json({ id: req.asha.id, name: req.asha.name || "", village: req.asha.village });
  });

  router.get("/mothers", async (req, res) => {
    try {
      const snap = await db.collection("mothers").where("village", "==", req.asha.village).get();
      const mothers = snap.docs.map((d) => motherSummary(d.id, d.data())).sort(sortForDashboard);
      res.json({ village: req.asha.village, mothers, fetchedAt: Date.now() });
    } catch (err) {
      console.error("/asha/mothers ERROR:", err);
      res.status(500).json({ error: "Could not load mothers." });
    }
  });

  router.get("/mothers/:motherId", async (req, res) => {
    try {
      const mother = await loadMotherInVillage(req, res);
      if (!mother) return;

      const since = new Date(Date.now() - HISTORY_DAYS * 86400000);
      const entriesSnap = await mother.ref.collection("entries")
        .where("createdAt", ">=", since).get();
      const entries = entriesSnap.docs.map((d) => d.data())
        .sort((a, b) => (toMillis(a.createdAt) ?? 0) - (toMillis(b.createdAt) ?? 0));

      // Mood trend: worst (highest) score per day
      const byDay = {};
      const concernDays = {};
      for (const e of entries) {
        if (!e.dayKey) continue;
        byDay[e.dayKey] = Math.max(byDay[e.dayKey] ?? 0, e.moodScore ?? 0);
        for (const domain of e.domainsTriggered || []) {
          (concernDays[domain] ||= new Set()).add(e.dayKey);
        }
      }
      const moodTrend = Object.entries(byDay).sort().map(([day, score]) => ({ day, score }));
      const concerns = Object.entries(concernDays)
        .map(([domain, days]) => ({ domain, label: CONCERN_LABELS[domain] || domain, days: days.size }))
        .sort((a, b) => (b.domain === "Q9_selfharm") - (a.domain === "Q9_selfharm") || b.days - a.days);

      // Only the messages that raised a flag — not her whole diary.
      const flaggedMessages = entries
        .filter((e) => e.flagSeverity || e.escalationLevel === "urgent")
        .slice(-10).reverse()
        .map((e) => ({
          at: toMillis(e.createdAt),
          channel: e.channel,
          severity: e.flagSeverity || "high",
          text: e.transcript
        }));

      const notesSnap = await db.collection("followUps").where("motherId", "==", mother.ref.id).get();
      const notes = notesSnap.docs.map((d) => {
        const n = d.data();
        return { id: d.id, note: n.note, resolved: n.resolved, ashaName: n.ashaName || "", at: toMillis(n.createdAt) };
      }).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

      res.json({
        mother: { ...motherSummary(mother.ref.id, mother.data), phone: mother.data.phone || null },
        drivingFactors: entries.at(-1)?.drivingFactors || [],
        checkIns: entries.length,
        moodTrend,
        concerns,
        flaggedMessages,
        notes
      });
    } catch (err) {
      console.error("/asha/mothers/:id ERROR:", err);
      res.status(500).json({ error: "Could not load this mother." });
    }
  });

  router.post("/mothers/:motherId/notes", express.json(), async (req, res) => {
    const note = String(req.body.note || "").trim().slice(0, 2000);
    const resolve = Boolean(req.body.resolve);
    const clientId = typeof req.body.clientId === "string" && /^[\w-]{6,64}$/.test(req.body.clientId)
      ? req.body.clientId : null;
    if (!note && !resolve) return res.status(400).json({ error: "Write a note or mark as followed up." });
    try {
      const mother = await loadMotherInVillage(req, res);
      if (!mother) return;

      // A fixed id makes notes sent from the offline queue safe to resend.
      const noteRef = clientId ? db.collection("followUps").doc(`note_${clientId}`) : db.collection("followUps").doc();
      if (clientId && (await noteRef.get()).exists) return res.json({ ok: true, duplicate: true });

      const batch = db.batch();
      batch.set(noteRef, {
        motherId: mother.ref.id,
        ashaId: req.asha.id,
        ashaName: req.asha.name || "",
        village: req.asha.village,
        note: note || "Marked as followed up.",
        resolved: resolve,
        createdAt: FieldValue.serverTimestamp()
      });
      if (resolve) {
        batch.set(mother.ref, {
          needsFollowUp: false,
          followUpPriority: null,
          followUpReason: null,
          followUpSince: null,
          lastFollowUpAt: FieldValue.serverTimestamp(),
          lastFollowUpBy: req.asha.id
        }, { merge: true });
      }
      await batch.commit();
      res.json({ ok: true, id: noteRef.id });
    } catch (err) {
      console.error("/asha notes ERROR:", err);
      res.status(500).json({ error: "Could not save the note." });
    }
  });

  return router;
}
