self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; }
  catch { data = { body: event.data?.text() || '' }; }

  const title = typeof data.title === 'string' ? data.title.slice(0, 80) : 'Revista Digital Campo Belo';
  const body = typeof data.body === 'string' ? data.body.slice(0, 240) : '';
  const path = typeof data.url === 'string' ? data.url : './';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: new URL('pwa/icon-192.png', self.registration.scope).href,
    badge: new URL('pwa/icon-192.png', self.registration.scope).href,
    data: { path },
    tag: 'revista-campo-belo-news'
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedPath = event.notification.data?.path || './';
  let destination = new URL('./', self.registration.scope);
  try {
    const candidate = new URL(requestedPath, self.registration.scope);
    if (candidate.origin === new URL(self.registration.scope).origin) destination = candidate;
  } catch {}

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === destination.origin) {
        await client.navigate(destination.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination.href);
  })());
});
