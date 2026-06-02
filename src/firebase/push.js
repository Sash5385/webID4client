import { getMessaging, getToken, onMessage } from 'firebase/messaging'
import { app } from './config'
import { ref, set } from 'firebase/database'
import { db } from './config'

// ⚠️ ЗГЕНЕРУЙ VAPID KEY В Firebase Console:
// Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
const VAPID_KEY = 'BFT1t7hXhEcSsHdotLlG5xoIFNrdS11vU_jsHiD1UUMsskVINBW2het8ogOKioGTPK8X_-u1ivEQM0n0Dh6Zvqk'

let messaging = null

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
    const token = await getToken(msg, { vapidKey: VAPID_KEY })
    if (token && uid) {
      await set(ref(db, `users/${uid}/fcmTokens/web/token`), token)
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
