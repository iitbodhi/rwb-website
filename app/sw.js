/* RWB App service worker: keeps the app shell available offline and loads it fast.
   Bump VERSION whenever app files change so phones pick up the new version. */
const VERSION = 'rwb-app-v51';
const SHELL = ['./', 'index.html', 'config.js', 'css/app.css', 'js/app.js', 'js/api.js', '../js/data.js',
    'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET') return;
    /* our own files: network first, always asking the server for the newest copy (never the browser's
       10-minute HTTP cache), falling back to the saved copy when offline */
    /* videos stream straight from the server (they need range requests, and are too big to keep offline) */
    if (url.origin === location.origin && /\.mp4$/i.test(url.pathname)) return;
    if (url.origin === location.origin) {
        e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
            if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
            return r;
        }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
        return;
    }
    /* pinned library and fonts: cache first */
    if (url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('gstatic.com') || url.hostname === 'fonts.googleapis.com') {
        e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
            if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
            return res;
        })));
    }
    /* everything else (Supabase, Google Sheets, Drive) goes straight to the network */
});

/* ---------- push notifications ---------- */
self.addEventListener('push', e => {
    let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'RWB', body: e.data && e.data.text() }; }
    e.waitUntil(self.registration.showNotification(d.title || 'RWB', {
        body: d.body || '', tag: d.tag, data: { url: d.url || '#home' },
        icon: 'icons/icon-192.png', badge: 'icons/badge-96.png'
    }));
});
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const target = new URL('./' + (e.notification.data?.url || '#home'), self.registration.scope).href;
    e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(target).catch(() => {}); return c.focus(); }
        return clients.openWindow(target);
    }));
});
