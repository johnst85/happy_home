// 서비스 워커: 앱 화면(정적 파일)을 캐시해 빠르게 열고, 서버가 잠시 꺼져도 화면은 뜨게 함
const CACHE = 'happy-home-v1';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/main.js', '/js/api.js', '/js/ui.js', '/js/fx.js', '/js/chars.js',
  '/js/home.js', '/js/scores.js', '/js/calendar.js', '/js/settings.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media-files/')) return;
  // 네트워크 우선, 실패하면 캐시
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
