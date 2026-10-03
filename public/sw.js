/**
 * Service worker for the installed app (PWA).
 *
 * Deliberately small and conservative:
 * - Pages (HTML) are NEVER cached. They carry the signed-in user's data and a
 *   per-request CSP nonce, so a cached copy would be stale at best and leak
 *   one person's screen to another at worst. Pages always go to the network;
 *   only when the network fails do we show /offline.html.
 * - Build assets under /_next/static/ have a content hash in their name and
 *   never change, so they are served cache-first. That makes repeat opens on
 *   a weak connection much faster.
 * - Icons and brand images are cache-first too.
 * - Everything else (server actions, API, private files, map tiles) passes
 *   straight through untouched.
 * - Push: shows the notification the server sent (built in
 *   src/features/notifications/messages.ts) and opens its page on tap.
 *
 * Bump VERSION to drop old caches after a change to this file.
 */
const VERSION = "v2";
const STATIC_CACHE = `najda-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/brand/logo-180.webp"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("najda-") && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/brand/"))
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    return (await cache.match(OFFLINE_URL)) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(networkOrOffline(request));
    return;
  }

  const url = new URL(request.url);
  if (isCacheableAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload still gets a generic notification below: browsers
    // may revoke push for a worker that receives a push and shows nothing.
  }

  const title = data.title || "نجدة الطريق 24";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      renotify: Boolean(data.tag),
      dir: "auto",
      // Same-origin paths only ("//host" would leave the site).
      data: { url: typeof data.url === "string" && /^\/(?!\/)/.test(data.url) ? data.url : "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Reuse an open window of the app rather than stacking new ones.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client
            .navigate(target)
            .then((c) => (c || client).focus())
            .catch(() => self.clients.openWindow(target));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
