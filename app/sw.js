'use strict';

// IMPORTANTE: ao mudar assets, incrementar VERSION aqui E o ?v= nos
// <link>/<script> de index.html e autocarros.html (mesmo numero).
var VERSION = '14';
var Q = '?v=' + VERSION;
var CACHE = 'metro-planner-v' + VERSION;
var ASSETS = [
  './',
  './index.html',
  './autocarros.html',
  './style.css' + Q,
  './i18n.js' + Q,
  './engine.js' + Q,
  './router.js' + Q,
  './app.js' + Q,
  './bus.js' + Q,
  './consent.js' + Q,
  './data/data.js' + Q,
  './data/bus-lines.js' + Q,
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
