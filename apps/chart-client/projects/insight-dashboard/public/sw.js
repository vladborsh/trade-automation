/*
 * IB-069 — the insight dashboard's service worker. Push and click only: no fetch handler, no cache.
 *
 * Why our own ~40 lines and not `@angular/service-worker` (SwPush): SwPush comes with ngsw, which
 * caches the app shell and assets from a generated manifest — a second deploy mechanism with its
 * own staleness bugs (a member looking at yesterday's bundle) that this task does not need. ngsw is
 * also only registered in a production build, so `ng serve` could not exercise push at all, and
 * SwPush's notification-click handling covers less than the few lines below. What push needs is
 * `push` → `showNotification` and `notificationclick` → open the dashboard; that is all this does.
 *
 * Plain JS in `public/`, copied as-is to the bundle root so its scope is the whole dashboard.
 * The payload is the bot's `WebPushPayload` (libs/contracts/src/insight/push.ts): `title`, `body`,
 * and `tag` = the in-tab notifier's `alert:<scheduledAt>`, so the two replace each other.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {}; // not ours, or garbled: still show something, a silent push is refused by browsers
  }
  const title = typeof payload.title === 'string' ? payload.title : 'Insight';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      data: { url: self.registration.scope },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
