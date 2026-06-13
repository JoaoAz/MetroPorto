/* Service worker — consulta offline.
 * Estratégia stale-while-revalidate: responde da cache (rápido/offline)
 * e atualiza a cache em segundo plano quando há rede. */
'use strict';

var CACHE = 'metro-planner-v6';
var ASSETS = [
  './',
  './index.html',
  './style.css',
  './engine.js',
  './router.js',
  './app.js',
  './data/data.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(e.request).then(function (cached) {
        var fetched = fetch(e.request).then(function (resp) {
          if (resp && resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(function () { return cached; });
        return cached || fetched;
      });
    })
  );
});
