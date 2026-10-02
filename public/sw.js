/* Verse service worker: web push only. It has no fetch handler and caches nothing, so it can
 * never serve a stale page. Registered from the site root by src/app/lib/push.ts, and only
 * after someone opts in to alerts. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** A same-origin URL for a path from the payload; anything else falls back to the site root. */
function target(path) {
  try {
    const url = new URL(path || '/', self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Verse';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // A newer alert with the same tag replaces the old one instead of stacking.
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      renotify: typeof data.tag === 'string',
      data: { url: target(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = target(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        try {
          const navigated = await open.navigate(url);
          return (navigated || open).focus();
        } catch {
          // navigate() can be refused (for example for an uncontrolled client): open a window instead.
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
