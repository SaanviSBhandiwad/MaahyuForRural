// ============================================================
// MAAHYU — ASHA dashboard offline cache
// Keeps the dashboard's own files (and the Firebase/font files it
// loads) on the phone, so it opens with no signal. The mothers'
// data itself is cached by asha.js; API calls are never cached here.
// ============================================================
const CACHE = "maahyu-asha-v2";
const SHELL = [
  "./",
  "./index.html",
  "./asha.css",
  "./asha.js",
  "../css/variables.css",
  "../js/firebase-config.js"
];
const RUNTIME_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Own files: network first (always fresh when online), cache when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Copy BEFORE handing the response to the page (a body can only be read once).
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // Firebase SDK + fonts: versioned and stable, so cache first.
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
  }
  // Everything else (backend API, Google sign-in) goes straight to the network.
});
