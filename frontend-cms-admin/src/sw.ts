/// <reference lib="webworker" />
/** Minimal CMS service worker: precache the shell, never cache private API. */

export {};
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const CACHE = 'tb-cms-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(self.__WB_MANIFEST.map((e) => e.url)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Private admin API is never cached.
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => {
      const miss = fetch(event.request).then((res) => {
        const copy = res.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      });
      return hit ?? miss;
    }),
  );
});
