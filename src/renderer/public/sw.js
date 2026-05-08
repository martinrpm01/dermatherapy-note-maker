const CACHE_NAME = "clearskin-hub-v7";
const REFRESH_PULSE_URL = "/refresh-pulse.json";

// Bump CACHE_NAME when a deployment should invalidate previously cached shell files.
const PRECACHE_URLS = ["/index.browser.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

function isSameOriginRequest(url) {
  return url.origin === self.location.origin;
}

function isStaticAssetRequest(url) {
  if (url.pathname === REFRESH_PULSE_URL) {
    return false;
  }

  return (
    url.pathname.startsWith("/assets/") ||
    /\.(?:js|css|png|jpg|jpeg|svg|webp|gif|ico|json)$/i.test(url.pathname)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(request.url);
  if (!isSameOriginRequest(requestUrl)) {
    return;
  }

  if (requestUrl.pathname === REFRESH_PULSE_URL) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  const isNavigationRequest = request.mode === "navigate";
  if (!isNavigationRequest && !isStaticAssetRequest(requestUrl)) {
    return;
  }

  if (isNavigationRequest) {
    // Network-first for HTML: always fetch fresh so new JS/CSS hashes load after a deploy.
    // Fall back to cache only when offline.
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match(request, { ignoreSearch: true })) || cache.match("/index.browser.html");
        })
    );
    return;
  }

  // Cache-first for static assets (content-hashed filenames never change).
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
      try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch (error) {
        throw error;
      }
    })
  );
});
