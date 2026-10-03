// ============================================================
// MAAHYU — Risk Scorer  (Person C — Step 7)
// Weighted linear approximation of XGBoost model trained on
// synthetic rural maternal data (see backend/train_risk_model.py).
// Runs entirely in-browser — no Python at runtime.
// ============================================================

const WEIGHTS = {
  phq9Score:         { importance: 0.4827, direction: +1, min: 0,   max: 27  },
  numDistressDays:   { importance: 0.1511, direction: +1, min: 0,   max: 30  },
  ashaVisitsCount:   { importance: 0.1217, direction: -1, min: 0,   max: 10  },
  distanceToPHCKm:   { importance: 0.1144, direction: +1, min: 0.5, max: 50  },
  hasFamilySupport:  { importance: 0.0812, direction: -1, min: 0,   max: 1   },
  literacyLevel:     { importance: 0.0383, direction: -1, min: 0,   max: 2   },
  daysSinceDelivery: { importance: 0.0098, direction: +1, min: 0,   max: 365 },
  firstPregnancy:    { importance: 0.0008, direction: -1, min: 0,   max: 1   }
};

const HIGH_RISK_THRESHOLDS = {
  phq9Score: 12, numDistressDays: 4, ashaVisitsCount: 1,
  distanceToPHCKm: 15, hasFamilySupport: 0,
  literacyLevel: 0, daysSinceDelivery: 30, firstPregnancy: 0
};

function clampNorm(v, min, max) {
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

function friendlyLabel(key, value) {
  const map = {
    phq9Score:         `High mood distress score (${Math.round(value)})`,
    numDistressDays:   `${Math.round(value)} days showing distress`,
    ashaVisitsCount:   `Only ${Math.round(value)} ASHA visit(s) so far`,
    distanceToPHCKm:   `PHC is ${Math.round(value)} km away`,
    hasFamilySupport:  "No reported family support",
    literacyLevel:     "Low literacy level",
    daysSinceDelivery: `${Math.round(value)} days postpartum`,
    firstPregnancy:    "First pregnancy"
  };
  return map[key] || key;
}

/**
 * @param {{
 *   phq9Score: number,        // 0-27 from scorePHQ9Full
 *   daysSinceDelivery: number,
 *   ashaVisitsCount: number,
 *   distanceToPHCKm: number,
 *   hasFamilySupport: boolean,
 *   numDistressDays: number,
 *   literacyLevel: 0|1|2,
 *   firstPregnancy: boolean
 * }} features
 * @returns {{ score: number, tier: "low"|"medium"|"high", drivingFactors: string[], needsASHAFlag: boolean }}
 */
export function scoreRisk(features) {
  const raw = {
    phq9Score:         features.phq9Score         ?? 0,
    numDistressDays:   features.numDistressDays    ?? 0,
    ashaVisitsCount:   features.ashaVisitsCount    ?? 0,
    distanceToPHCKm:   features.distanceToPHCKm    ?? 10,
    hasFamilySupport:  features.hasFamilySupport   ? 1 : 0,
    literacyLevel:     features.literacyLevel      ?? 1,
    daysSinceDelivery: features.daysSinceDelivery  ?? 30,
    firstPregnancy:    features.firstPregnancy     ? 1 : 0
  };

  let totalScore = 0;
  const drivingFactors = [];

  for (const [key, w] of Object.entries(WEIGHTS)) {
    const norm = clampNorm(raw[key], w.min, w.max);
    const contribution = w.direction === +1 ? norm * w.importance : (1 - norm) * w.importance;
    totalScore += contribution;

    const threshold = HIGH_RISK_THRESHOLDS[key];
    const inRiskZone = w.direction === +1 ? raw[key] > threshold : raw[key] < threshold;
    if (inRiskZone && w.importance > 0.05) {
      drivingFactors.push(friendlyLabel(key, raw[key]));
    }
  }

  const score = parseFloat(Math.min(1, totalScore).toFixed(3));
  const tier = score >= 0.55 ? "high" : score >= 0.30 ? "medium" : "low";
  const needsASHAFlag = tier === "high" || raw.phq9Score >= 20 || raw.numDistressDays >= 7;

  return { score, tier, drivingFactors, needsASHAFlag };
}
