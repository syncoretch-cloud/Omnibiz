// OmniBiz service worker: shows push notifications and opens the right page when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* plain text */ }
  event.waitUntil((async () => {
    // If OmniBiz is already open and in front, the app itself shows the update; no need for a system notification.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.focused)) return;
    await self.registration.showNotification(data.title || 'OmniBiz', {
      body: data.body || '',
      icon: '/favicon.png',
      badge: '/favicon.png',
      data: { link: data.link || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) {
        if ('navigate' in w) await w.navigate(link).catch(() => {});
        return w.focus();
      }
    }
    return self.clients.openWindow(link);
  })());
});
