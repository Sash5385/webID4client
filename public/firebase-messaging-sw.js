// firebase-messaging-sw.js
// Кладеться в /public/ — Firebase повинен мати доступ за URL /firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => self.clients.claim())

firebase.initializeApp({
  apiKey: "AIzaSyDO6-LTuBoNHi6uS5KcOpmBuyvgJSouYpk",
  authDomain: "id4drive-booking-44182.firebaseapp.com",
  databaseURL: "https://id4drive-booking-44182-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "id4drive-booking-44182",
  storageBucket: "id4drive-booking-44182.firebasestorage.app",
  messagingSenderId: "815176240686",
  appId: "1:815176240686:web:1cf54d6c465420230199bf"
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage(async (payload) => {
  // Skip if any app window is visible — the foreground handler will show the notification
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clientList.some(c => c.visibilityState === 'visible')) return

  const title = payload.notification?.title || 'ID4Drive'
  const url = payload.data?.url || 'https://id4drive.pro/cabinet'
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'id4drive-notif',
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url, ...(payload.data || {}) },
  }
  self.registration.showNotification(title, options)
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const data = e.notification.data || {}
  const target = data.url || 'https://id4drive.pro/cabinet'
  const fullUrl = target.startsWith('http') ? target : ('https://id4drive.pro' + target)
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith('https://id4drive.pro') && 'focus' in c) {
          c.focus()
          return c.navigate(fullUrl)
        }
      }
      if (clients.openWindow) return clients.openWindow(fullUrl)
    })
  )
})
