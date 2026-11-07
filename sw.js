const CACHE_PREFIX = 'revista-campo-belo-';
const CACHE_NAME = CACHE_PREFIX + 'v2';
const OFFLINE_PAGE = new URL('pwa/offline.html', self.registration.scope).href;
const HOME = self.registration.scope;
const CACHED_FILES = [
  HOME,
  'promocoes.html',
  'comunidade.html',
  'dados-locais.js',
  'dados-locais-resgatados.js',
  'app.webmanifest',
  'pwa/install.css',
  'pwa/install.js',
  'pwa/privacy-consent.css',
  'pwa/privacy-consent.js',
  'pwa/disqus-consent.css',
  'privacidade.html',
  'pwa/icon-192.png',
  OFFLINE_PAGE
].map(path => new URL(path, HOME).href);
const cachedUrls = new Set(CACHED_FILES);
const indexUrl = new URL('index.html', HOME).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CACHED_FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const path = url.origin + url.pathname;
  const cacheKey = path === indexUrl ? HOME : path;
  if (!isNavigation && !cachedUrls.has(cacheKey)) return;

  event.respondWith((async () => {
    let response;
    try {
      response = await fetch(request);
    } catch {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(cacheKey)
        || (isNavigation && await cache.match(OFFLINE_PAGE))
        || Response.error();
    }

    if (cachedUrls.has(cacheKey) && response.ok && !response.redirected) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(cacheKey, response.clone());
      } catch {
        // Falhas de armazenamento não impedem o acesso com conexão.
      }
    }
    return response;
  })());
});
