// ============================================================
// MAAHYU — ASHA setup (admin only, run from the backend folder)
// ------------------------------------------------------------
//   node scripts/setup-asha.js add-asha --phone +919876543210 --name "Lakshmi" --village "Hosahalli"
//   node scripts/setup-asha.js assign --village "Hosahalli" --mother +917483763465
//   node scripts/setup-asha.js assign --village "Hosahalli" --all-unassigned
//   node scripts/setup-asha.js list
//
// Until onboarding asks mothers for their village (Phase 3/5),
// this is how mothers get linked to an ASHA worker's village.
// ============================================================
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, "..", "serviceAccountKey.json");
const serviceAccount = process.env.SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.SERVICE_ACCOUNT_JSON)
  : JSON.parse(fs.readFileSync(keyPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) continue;
  const key = rest[i].slice(2);
  const next = rest[i + 1];
  args[key] = next && !next.startsWith("--") ? (i++, next) : true;
}

function e164(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

async function addAsha() {
  const phone = e164(args.phone);
  if (!phone || !args.name || !args.village) {
    fail('Usage: add-asha --phone +919876543210 --name "Lakshmi" --village "Hosahalli"');
  }
  const existing = await db.collection("ashaWorkers").where("phone", "==", phone).limit(1).get();
  const ref = existing.empty ? db.collection("ashaWorkers").doc() : existing.docs[0].ref;
  await ref.set({
    phone,
    name: String(args.name),
    village: String(args.village),
    authUid: existing.empty ? null : existing.docs[0].data().authUid ?? null,
    ...(existing.empty ? { createdAt: FieldValue.serverTimestamp() } : {})
  }, { merge: true });
  console.log(`✅ ASHA worker ${existing.empty ? "added" : "updated"}: ${args.name} (${phone}) → village "${args.village}"`);
}

async function assign() {
  const village = args.village && String(args.village);
  if (!village) fail('Usage: assign --village "Hosahalli" (--mother <id or phone> | --all-unassigned)');

  let refs = [];
  if (args.mother) {
    const raw = String(args.mother);
    const id = raw.startsWith("app_") ? raw : e164(raw);
    const snap = await db.collection("mothers").doc(id).get();
    if (!snap.exists) fail(`No mother with id ${id}. Run "list" to see ids.`);
    refs = [snap.ref];
  } else if (args["all-unassigned"]) {
    const snap = await db.collection("mothers").get();
    refs = snap.docs.filter((d) => !d.data().village).map((d) => d.ref);
  } else {
    fail("Say which mother: --mother <id or phone>, or --all-unassigned");
  }

  const asha = await db.collection("ashaWorkers").where("village", "==", village).limit(1).get();
  const ashaId = asha.empty ? null : asha.docs[0].id;
  for (const ref of refs) await ref.set({ village, assignedAshaId: ashaId }, { merge: true });
  console.log(`✅ Assigned ${refs.length} mother(s) to "${village}"${ashaId ? "" : " (note: no ASHA worker registered for this village yet)"}`);
}

async function list() {
  const ashas = await db.collection("ashaWorkers").get();
  console.log("\nASHA workers:");
  if (ashas.empty) console.log("  (none yet)");
  ashas.forEach((d) => {
    const a = d.data();
    console.log(`  ${a.name}  ${a.phone}  village: ${a.village}${a.authUid ? "  (has signed in)" : ""}`);
  });
  const mothers = await db.collection("mothers").get();
  console.log("\nMothers:");
  if (mothers.empty) console.log("  (none yet)");
  mothers.forEach((d) => {
    const m = d.data();
    const flag = m.needsFollowUp ? `  ⚠ follow-up (${m.followUpPriority})` : "";
    console.log(`  ${d.id}  ${m.displayName || ""}  village: ${m.village || "—"}${flag}`);
  });
  console.log("");
}

const commands = { "add-asha": addAsha, assign, list };
if (!commands[command]) {
  console.log(`Commands:
  add-asha --phone +919876543210 --name "Lakshmi" --village "Hosahalli"
  assign   --village "Hosahalli" --mother +917483763465
  assign   --village "Hosahalli" --all-unassigned
  list`);
  process.exit(command ? 1 : 0);
}
await commands[command]();
process.exit(0);
