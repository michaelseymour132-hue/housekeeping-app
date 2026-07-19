// sw.js - Housekeeping Hub service worker
// Conservative caching so the app is installable and the shell loads offline,
// WITHOUT ever caching Firebase/auth/data requests (those must hit the network).
// Style note: this file runs in the service-worker scope, not the page.

var CACHE = "hk-shell-v1";
var SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/common.js",
  "./manifest.json",
  "./icon.svg",
  "./offline.html"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Best-effort: do not fail install if one file is missing.
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) { return caches.delete(k); }
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  var url = new URL(req.url);

  // Only handle same-origin GET. Everything else (Firebase, gstatic, POSTs,
  // Storage uploads, API calls) goes straight to the network, untouched.
  if (req.method !== "GET" || url.origin !== self.location.origin) { return; }

  // HTML navigations: network-first, fall back to cache, then offline page.
  var isNav = req.mode === "navigate" ||
    (req.headers.get("accept") || "").indexOf("text/html") !== -1;
  if (isNav) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./offline.html") || caches.match("./index.html");
        });
      })
    );
    return;
  }

  // Static assets (css/js/svg/etc): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
