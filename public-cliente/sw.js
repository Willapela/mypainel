/* Avisos de vencimento: recebe a notificação push e abre a área do cliente ao tocar */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { }
  e.waitUntil(self.registration.showNotification(d.title || 'Painel', {
    body: d.body || '', icon: '/cliente/icon.png', badge: '/cliente/icon.png', tag: 'vencimento', renotify: true, data: { url: d.url || '/cliente/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/cliente/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.includes('/cliente') && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
