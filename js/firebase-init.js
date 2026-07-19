// ============================================================
// MAAHYU — Firebase bootstrap
// Uses the Firebase JS SDK v10 modular build, loaded straight
// from Google's CDN as ES modules — no bundler/build step,
// so this deploys as a plain static site (Render Static Site,
// GitHub Pages, Netlify, etc all work unchanged).
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Offline-first: cache Firestore reads/writes locally so the app
// keeps working (per the brief's "no internet" requirement) and
// syncs automatically once connectivity returns.
enableIndexedDbPersistence(db).catch(() => {
  // Multiple tabs open, or browser doesn't support it — app still
  // works, it just won't persist across a full reload while offline.
});

/**
 * Resolves once we have a signed-in user, creating an anonymous
 * identity on first launch. No forms, no password — matches the
 * "no account creation" requirement in the design brief.
 */
export function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        resolve(user);
      } else {
        signInAnonymously(auth).then((cred) => resolve(cred.user)).catch(reject);
      }
    });
  });
}
