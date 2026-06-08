import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as fbSignOut
} from 'firebase/auth'
import { auth } from './config'

let recaptchaVerifier = null
let confirmationResult = null

export const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent)

export function initRecaptcha(containerId = 'recaptcha-container', force = false, onSolved = null) {
  if (recaptchaVerifier && !force) return recaptchaVerifier
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear() } catch {}
    recaptchaVerifier = null
  }
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: isIOSDevice() ? 'normal' : 'invisible',
    callback: onSolved ?? (() => {}),
    'expired-callback': () => { recaptchaVerifier = null },
  })
  return recaptchaVerifier
}

export function getSmsErrorMessage(code) {
  switch (code) {
    case 'auth/invalid-phone-number': return 'Невірний формат номера телефону'
    case 'auth/too-many-requests': return 'Забагато спроб. Спробуй пізніше або використай Email'
    case 'auth/quota-exceeded': return 'SMS-ліміт вичерпано. Увійди через Email'
    case 'auth/captcha-check-failed': return 'Перевірка не пройдена. Оновіть сторінку'
    case 'auth/missing-phone-number': return 'Введи номер телефону'
    case 'auth/user-disabled': return 'Акаунт заблоковано'
    default: return 'Не вдалось надіслати SMS. Спробуй Email'
  }
}

export async function renderRecaptcha(containerId = 'recaptcha-container', onSolved = null) {
  const verifier = initRecaptcha(containerId, false, onSolved)
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
