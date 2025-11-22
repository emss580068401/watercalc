const CACHE_NAME = 'emei-water-calc-v4';

// 先預快取「殼」＋主要檔案
const PRECACHE_URLS = [
  './',
  './index.html',
  './index.css',
  './index.tsx',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  // 立即啟用新版 SW
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 通用快取策略：優先用 cache，沒有再打網路 & 存回 cache
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只處理 GET
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          // 無效回應就不存
          if (
            !networkResponse ||
            networkResponse.status !== 200
          ) {
            return networkResponse;
          }

          const cloned = networkResponse.clone();

          // 把同源資源 & CDN（React / Tailwind / Recharts）都塞進 cache
          caches.open(CACHE_NAME).then((cache) => {
            const url = request.url;
            if (
              url.startsWith(self.location.origin) ||
              url.includes('aistudiocdn.com') ||
              url.includes('cdn.tailwindcss.com')
            ) {
              cache.put(request, cloned);
            }
          });

          return networkResponse;
        })
        .catch(() => {
          // 如果是導覽請求（例如重新整理首頁），離線時回傳 index.html
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          // 其他請求沒在 cache 就讓它 fail
        });
    })
  );
});
