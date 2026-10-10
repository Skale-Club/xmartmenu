// XmartMenu service worker.
// Safe-by-default caching:
//  - Precache only the offline shell.
//  - Runtime-cache content-hashed build assets (/_next/static) with cache-first.
//  - Navigations are network-first and are NEVER stored (avoids caching
//    authenticated admin/superadmin HTML or tenant-specific pages).
//  - API routes and Supabase requests are never touched by the SW.

const VERSION = 'v1'
const STATIC_CACHE = `xm-static-${VERSION}`
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.add(OFFLINE_URL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Only handle same-origin requests; let Supabase/CDN/third-party pass through.
  if (url.origin !== self.location.origin) return

  // Never cache API routes.
  if (url.pathname.startsWith('/api/')) return

  // Cache-first for immutable, content-hashed build assets.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      })
    )
    return
  }

  // Network-first for navigations; fall back to offline shell when offline.
  // Responses are intentionally NOT cached to avoid storing authenticated
  // or tenant-specific HTML.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    )
    return
  }
})
