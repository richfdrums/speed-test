/* Speed — offline shell.

   The app itself (a few KB) is cached so it opens instantly and shows your
   history with no connection. The speed test traffic is cross-origin and is
   deliberately never touched: a service worker in the path of a throughput
   measurement would only distort it.

     Navigations (index.html)
         NETWORK FIRST, falling back to cache, so a deploy shows up on the
         next launch and offline still works.

     Everything else same-origin (icons, manifest)
         STALE WHILE REVALIDATE.

   VERSION only needs bumping to force-purge every client's cache.
*/

var VERSION = "2026-11-11";
var CACHE = "speed-" + VERSION;

var PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function putIfOk(request, response) {
  if (response && response.status === 200 && response.type === "basic") {
    var copy = response.clone();
    caches.open(CACHE).then(function (c) { c.put(request, copy); });
  }
  return response;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  // Test servers (M-Lab, Cloudflare) are cross-origin: hands off.
  if (new URL(req.url).origin !== self.location.origin) return;

  var isNavigation =
    req.mode === "navigate" ||
    (req.destination === "" && (req.headers.get("accept") || "").indexOf("text/html") !== -1);

  if (isNavigation) {
    // `no-cache` revalidates past GitHub Pages' ten-minute max-age.
    e.respondWith(
      fetch(req, { cache: "no-cache" })
        .then(function (res) { return putIfOk(req, res); })
        .catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match("./index.html");
          });
        })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req)
        .then(function (res) { return putIfOk(req, res); })
        .catch(function () { return hit; });
      return hit || network;
    })
  );
});
