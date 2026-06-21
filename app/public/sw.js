const CACHE_NAME = 'pianoscore-piano-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Cache piano sample requests (audio files loaded by @tonejs/piano)
  const isPianoSample = url.pathname.includes('piano') &&
    (url.pathname.endsWith('.mp3') || url.pathname.endsWith('.ogg') || url.pathname.endsWith('.wav') ||
     url.pathname.endsWith('.json') || url.pathname.includes('Salamander'))

  if (isPianoSample) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached
          return fetch(event.request).then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone())
            }
            return response
          })
        })
      )
    )
    return
  }

  // For all other requests, network first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})
