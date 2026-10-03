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
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Offline-first: Firestore keeps a local copy so the app works without
// signal, and it's shared across tabs (no "exclusive access" warnings).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
export const storage = getStorage(app);
storage.maxUploadRetryTime = 15000; // give up after 15s instead of 10 minutes


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
