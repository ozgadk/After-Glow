// Afterglow service worker: makes the admin installable as an app and keeps the
// app shell usable when the bar's wifi drops. Network-first, so every deploy is
// picked up immediately; the cache is only a fallback. Firebase / CDNs are never
// touched (cross-origin requests pass straight through).
const CACHE = "afterglow-shell-v1";
const SHELL = [
  "admin.html", "screen.html", "gallery.html", "index.html", "css/style.css",
  "js/firebase-config.js", "js/painting.js", "js/rounds.js", "js/i18n.js", "js/filter.js", "js/photo.js", "js/app.js",
  "admin.webmanifest", "assets/app/icon-192.png", "assets/app/icon.svg"
];
const CACHEABLE = /\.(html|js|css|svg|png|webmanifest)$|\/$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || !CACHEABLE.test(url.pathname)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    } catch (err) {
      const hit = await caches.match(req) || await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return new Response(
        "<meta name=viewport content='width=device-width'><body style='background:#0d070c;color:#f6e9e2;font:16px system-ui;padding:40px'><h2>Afterglow</h2><p>No connection. It will come back by itself once the internet is back.</p><script>addEventListener('online',()=>location.reload())</script>",
        { headers: { "Content-Type": "text/html; charset=utf-8" } });
      throw err;
    }
  })());
});
