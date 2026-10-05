/* Nahda service worker — Web Push only (no caching / offline logic). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Payload mirrors the SignalR one: { title, subtitle, icon, caseId }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'منظومة النهضة';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.subtitle || data.body || '',
    icon: '/assets/logo.png',
    dir: 'rtl',
    lang: 'ar',
    data: { caseId: data.caseId || null }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const caseId = event.notification.data && event.notification.data.caseId;
  const target = caseId ? `/?case=${encodeURIComponent(caseId)}` : '/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'notification-click', caseId: caseId || null });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
