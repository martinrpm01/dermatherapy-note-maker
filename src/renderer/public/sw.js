const CACHE_NAME = "clearskin-hub-v5";
const ASSET_DATABASE_NAME = "dermatherapy-note-maker-browser-assets";
const ASSET_DATABASE_VERSION = 1;
const ASSET_STORE_NAME = "assets";

// Bump CACHE_NAME when a deployment should invalidate previously cached shell files.
const PRECACHE_URLS = ["/index.browser.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

function isSameOriginRequest(url) {
  return url.origin === self.location.origin;
}

function isStaticAssetRequest(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    /\.(?:js|css|png|jpg|jpeg|svg|webp|gif|ico|json)$/i.test(url.pathname)
  );
}

function openAssetDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DATABASE_NAME, ASSET_DATABASE_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
  });
}

function readAssetRecord(assetId) {
  return openAssetDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
        const store = transaction.objectStore(ASSET_STORE_NAME);
        const request = store.get(assetId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Asset lookup failed."));
        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          db.close();
          reject(transaction.error || new Error("Asset transaction failed."));
        };
      })
  );
}

function encodeContentDispositionFileName(fileName) {
  return `inline; filename="${fileName.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
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

  const browserAssetMatch = requestUrl.pathname.match(/^\/browser-assets\/([^/]+)\/([^/]+)$/);
  if (browserAssetMatch) {
    event.respondWith(
      readAssetRecord(decodeURIComponent(browserAssetMatch[1]))
        .then((record) => {
          if (!record || !record.blob) {
            return new Response("Asset not found.", { status: 404 });
          }

          const fileName = decodeURIComponent(browserAssetMatch[2]);
          return new Response(record.blob, {
            headers: {
              "Content-Type": record.blob.type || "application/octet-stream",
              "Content-Disposition": encodeContentDispositionFileName(fileName),
              "Cache-Control": "no-store"
            }
          });
        })
        .catch(() => new Response("Asset unavailable.", { status: 500 }))
    );
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
