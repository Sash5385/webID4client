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

messaging.onBackgroundMessage((payload) => {
  // Раніше тут була перевірка "чи видима вкладка" (пропускали показ, якщо так,
  // розраховуючи на foreground-хендлер в App.jsx). Прибрано: "видима" вкладка
  // не гарантує, що foreground-хендлер реально спрацює (напр. приспаний таб
  // на телефоні) — у такому разі сповіщення не показував ХТОСЬ взагалі.
  // Дублю немає: і тут, і в App.jsx однаковий tag ('id4drive-notif'), тому
  // другий showNotification() з тим самим tag просто ЗАМІНЮЄ перший.
  //
  // Data-only push (no top-level/webpush "notification" — інакше браузер показав би
  // сповіщення сам ще раз ДОДАТКОВО до цього showNotification(), тобто дубль).
  const title = payload.data?.title || 'ID4Drive'
  const url = payload.data?.url || 'https://id4drive.pro/cabinet'
  const options = {
    body: payload.data?.body || '',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
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
