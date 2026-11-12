// Offline shell. Network-first (fresh when online, instant fallback when not).
// Audio never goes through here — it lives in IndexedDB.
const VERSION = 'earmark-v5'; // keep in step with BUILD in js/util.js
// Paths are relative so the app works at the site root or in a sub-folder (e.g. GitHub Pages).
const ROOT = new URL('./', self.location).href;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'fonts/onest-latin.woff2',
  'fonts/onest-latin-ext.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/util.js',
  'js/icons.js',
  'js/db.js',
  'js/store.js',
  'js/api.js',
  'js/downloads.js',
  'js/anim.js',
  'js/nav.js',
  'js/views.js',
  'js/artwork.js',
  'js/player.js',
  'js/ui/home.js',
  'js/ui/player-ui.js',
  'js/ui/library.js',
  'js/ui/marks.js',
  'js/ui/settings.js',
  'js/ui/sheet.js',
  'js/ui/toast.js',
  'js/ui/dial.js',
  'js/ui/scrubber.js',
  'js/ui/track-actions.js',
  'js/shorten.js',
  'js/importer.js',
  'js/mp4.js',
  'js/repair.js',
  'js/fx.js',
  'js/media.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(new URL(u, ROOT), { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(ROOT) || url.href.startsWith(`${ROOT}api/`)) return;

  const isNav = req.mode === 'navigate';
  e.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const key = isNav ? ROOT : req;
      // Network first, but never let a slow/absent server stall the app.
      // Files are re-checked with the host every time ("no-cache"), so an update always
      // arrives whole — never half new code, half the browser's ten-minute-old copies.
      const net = fetch(isNav ? req : new Request(req, { cache: 'no-cache' })).then((res) => {
        if (res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
        return res;
      });
      net.catch(() => {});
      let timer;
      const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), isNav ? 3500 : 6000);
      });
      late.catch(() => {});
      try {
        const res = await Promise.race([net, late]);
        clearTimeout(timer);
        if (!res.ok && res.status >= 500) throw new Error('bad gateway');
        return res;
      } catch {
        clearTimeout(timer);
        const hit = (await cache.match(isNav ? ROOT : req, { ignoreSearch: true })) || (isNav && (await cache.match(`${ROOT}index.html`)));
        if (hit) return hit;
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })(),
  );
});
