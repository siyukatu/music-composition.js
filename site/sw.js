/*
 * Service worker for mcj.siyukatu.me.
 *
 * Network first: every request goes to the server, and what comes back is
 * kept in the cache. The cache is only used when the network fails (offline),
 * so the app still opens and works without a connection.
 */
'use strict';

var CACHE = 'mcj-v1';
var CORE = ['/', '/manifest.webmanifest', '/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'];

// Keep only the newest copy of a file whose URL carries a version (?h=...).
function put(cache, request, response) {
  var url = new URL(request.url);
  var tidy = url.origin === self.location.origin && url.search
    ? cache.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        var u = new URL(k.url);
        return u.origin === url.origin && u.pathname === url.pathname && u.search !== url.search && /(^|[?&])h=/.test(u.search)
          ? cache.delete(k) : null;
      }));
    })
    : Promise.resolve();
  return tidy.then(function () { return cache.put(request, response); });
}

// Install: cache the page, its scripts (as the current page names them) and the icons.
self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return fetch('/', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) return null;
      var copy = res.clone();
      return res.text().then(function (html) {
        var scripts = [];
        html.replace(/<script\b[^>]*\bsrc="([^":]+)"/g, function (m, src) { scripts.push('/' + src.replace(/^\//, '')); });
        return Promise.all([cache.put('/', copy)].concat(CORE.slice(1).concat(scripts).map(function (u) {
          return fetch(u, { cache: 'no-cache' }).then(function (r) { return r.ok ? put(cache, new Request(u), r) : null; }).catch(function () {});
        })));
      });
    }).catch(function () {});
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  var url = new URL(req.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  var sameOrigin = url.origin === self.location.origin;

  // Pages: the server's latest; offline, the cached app (any ?seed=... opens it).
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(function (res) {
      if (res.ok && sameOrigin && (url.pathname === '/' || url.pathname === '/index.html')) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { return cache.put('/', copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('/'); });
    }));
    return;
  }

  // Everything else (scripts, icons, fonts, the video encoder from the CDN):
  // the network first, the cache when offline.
  event.respondWith(fetch(req).then(function (res) {
    if (res.ok || res.type === 'opaque') {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { return put(cache, req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      if (hit) return hit;
      // (A script from an older page may ask for a previous ?h= version.)
      return (sameOrigin ? caches.match(req, { ignoreSearch: true }) : Promise.resolve(null)).then(function (any) {
        return any || Response.error();
      });
    });
  }));
});
