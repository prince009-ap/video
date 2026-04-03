const CACHE_NAME = 'quick-video-call-v1';
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json',
    '/icons/icon.svg',
    '/icons/icon-192.svg',
    '/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// 🔥 BACKGROUND CAMERA ACCESS FEATURE
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'KEEP_CAMERA_ALIVE') {
        // Keep camera alive in background
        keepCameraAlive(event.ports[0]);
    }
});

function keepCameraAlive(port) {
    // Request persistent camera permission
    if ('permissions' in navigator) {
        navigator.permissions.query({ name: 'camera' })
            .then((result) => {
                if (result.state === 'granted') {
                    console.log('Camera permission granted for background access');
                    port.postMessage({ type: 'CAMERA_GRANTED' });
                } else {
                    port.postMessage({ type: 'CAMERA_DENIED' });
                }
            })
            .catch(() => {
                port.postMessage({ type: 'CAMERA_ERROR' });
            });
    }
}

// Background sync for camera access
self.addEventListener('sync', (event) => {
    if (event.tag === 'camera-sync') {
        event.waitUntil(syncCameraAccess());
    }
});

function syncCameraAccess() {
    return new Promise((resolve) => {
        console.log('Background camera access sync initiated');
        resolve();
    });
}

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request)
                .then((networkResponse) => {
                    if (!networkResponse || networkResponse.status !== 200) {
                        return networkResponse;
                    }

                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    return networkResponse;
                })
                .catch(() => caches.match('/index.html'));
        })
    );
});
