import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as fbSignOut
} from 'firebase/auth'
import { auth } from './config'

let recaptchaVerifier = null
let confirmationResult = null

export const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
// In-app browsers (Viber, Telegram, Instagram) block Firebase storage
export const isInAppBrowser = () => {
  const ua = navigator.userAgent
  return /Viber|FBAN|FBAV|Instagram|TelegramBot|Line\//.test(ua) ||
    (isIOSDevice() && !/Safari\//.test(ua) && !/CriOS/.test(ua) && !/FxiOS/.test(ua))
}

export function initRecaptcha(containerId = 'recaptcha-container', force = false, onSolved = null, onExpired = null) {
  if (recaptchaVerifier && !force) return recaptchaVerifier
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear() } catch {}
    recaptchaVerifier = null
  }
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: isIOSDevice() ? 'normal' : 'invisible',
    callback: onSolved ?? (() => {}),
    'expired-callback': () => {
      recaptchaVerifier = null
      if (onExpired) onExpired()
    },
  })
  return recaptchaVerifier
}

export function getSmsErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-phone-number': return 'Невірний формат номера телефону'
    case 'auth/too-many-requests': return 'Забагато спроб. Спробуй пізніше або використай Email'
    case 'auth/quota-exceeded': return 'SMS-ліміт вичерпано. Увійди через Email'
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential': return 'Перевірка не пройдена. Оновіть сторінку'
    case 'auth/missing-phone-number': return 'Введи номер телефону'
    case 'auth/user-disabled': return 'Акаунт заблоковано'
    case 'auth/web-storage-unsupported': return 'Браузер блокує сховище. Відкрий у Safari або Chrome'
    case 'auth/unauthorized-domain': return 'Домен не авторизований. Зверніться до адміністратора'
    case 'auth/network-request-failed': return 'Помилка мережі. Перевір зʼєднання і спробуй ще раз'
    case 'auth/internal-error': return 'Внутрішня помилка Firebase. Спробуй Email'
    case 'auth/operation-not-allowed': return 'SMS-вхід вимкнено. Використай Email'
    default: return `Не вдалось надіслати SMS. Спробуй Email (${code ?? 'unknown'})`
  }
}

export async function renderRecaptcha(containerId = 'recaptcha-container', onSolved = null, onExpired = null) {
  const verifier = initRecaptcha(containerId, false, onSolved, onExpired)
  try { await verifier.render() } catch {}
}

// containerId used for resend (different container on SMS step)
export async function sendSmsCode(phoneNumber, containerId = 'recaptcha-container') {
  const verifier = initRecaptcha(containerId)
  confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, verifier)
  return confirmationResult
}

export async function verifySmsCode(code) {
  if (!confirmationResult) throw new Error('Спочатку надішли SMS код')
  const result = await confirmationResult.confirm(code)
  return result.user
}

export async function resetRecaptcha() {
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear() } catch {}
    recaptchaVerifier = null
  }
  confirmationResult = null
}

export async function signOut() {
  await fbSignOut(auth)
  await resetRecaptcha()
}
