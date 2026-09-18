import { getMessaging, getToken, onMessage } from 'firebase/messaging'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { app } from './config'
import { ref, set } from 'firebase/database'
import { db } from './config'

// ⚠️ ЗГЕНЕРУЙ VAPID KEY В Firebase Console:
// Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
const VAPID_KEY = 'BFT1t7hXhEcSsHdotLlG5xoIFNrdS11vU_jsHiD1UUMsskVINBW2het8ogOKioGTPK8X_-u1ivEQM0n0Dh6Zvqk'

// Android-канал зі звуком для нативних пушів (файл: android/app/src/main/res/raw/notification_sound.wav).
// Змінити звук у вже встановленому застосунку можна лише новим id каналу — сам канал іммутабельний.
export const NATIVE_NOTIFICATION_CHANNEL_ID = 'booking_alerts_v1'

let messaging = null

export async function getFirebaseSwReg() {
  if (!('serviceWorker' in navigator)) return undefined
  const regs = await navigator.serviceWorker.getRegistrations()
  // Use a unique scope to avoid conflict with VitePWA's sw.js (both default to scope /)
  // Without a unique scope, Firebase SW stays in "waiting" and push events go to VitePWA SW
  const existing = regs.find(r => r.scope?.includes('firebase-push'))
  if (existing) return existing
  return navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase-push/' })
}

export function initMessaging() {
  if (!('Notification' in window)) {
    console.warn('Браузер не підтримує сповіщення')
    return null
  }
  if (!messaging) {
    messaging = getMessaging(app)
  }
  return messaging
}

export async function requestNotificationPermission(uid) {
  const msg = initMessaging()
  if (!msg) return null

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null

  try {
    const swReg = await getFirebaseSwReg()
    const token = await getToken(msg, { vapidKey: VAPID_KEY, ...(swReg ? { serviceWorkerRegistration: swReg } : {}) })
    if (token && uid) {
      await set(ref(db, `users/${uid}/fcmTokens/web/token`), token)
      await set(ref(db, `studentTokens/${uid}`), token)
    }
    return token
  } catch (e) {
    console.error('FCM token error:', e)
    return null
  }
}

export function onForegroundMessage(callback) {
  const msg = initMessaging()
  if (!msg) return () => {}
  return onMessage(msg, callback)
}

// ─── Нативний push (Android/iOS через Capacitor) ───────────────────
// Працює навіть коли застосунок закритий/екран вимкнений — на відміну від
// web push (getToken/onMessage вище), який залежить від service worker'а у WebView.

export async function requestNativeNotificationPermission(uid) {
  if (!Capacitor.isNativePlatform()) return null
  try {
    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: NATIVE_NOTIFICATION_CHANNEL_ID,
        name: 'ID4Drive сповіщення',
        description: 'Бронювання, перенесення, скасування, чат',
        importance: 5,
        sound: 'notification_sound',
        visibility: 1,
      })
    }
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return null

    return new Promise((resolve) => {
      const regSub = PushNotifications.addListener('registration', async (token) => {
        regSub.remove()
        errSub.remove()
        if (token?.value && uid) {
          await set(ref(db, `users/${uid}/fcmTokens/native/token`), token.value)
        }
        resolve(token?.value || null)
      })
      const errSub = PushNotifications.addListener('registrationError', () => {
        regSub.remove()
        errSub.remove()
        resolve(null)
      })
      PushNotifications.register()
    })
  } catch (e) {
    console.error('Native push permission error:', e)
    return null
  }
}

export function onNativePushReceived(callback) {
  if (!Capacitor.isNativePlatform()) return () => {}
  const sub = PushNotifications.addListener('pushNotificationReceived', callback)
  return () => sub.remove()
}

export function onNativeNotificationTap(callback) {
  if (!Capacitor.isNativePlatform()) return () => {}
  const sub = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    callback(action.notification?.data || {})
  })
  return () => sub.remove()
}
