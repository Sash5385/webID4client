import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut as fbSignOut
} from 'firebase/auth'
import { auth } from './config'

let recaptchaVerifier = null
let confirmationResult = null

export function initRecaptcha(containerId = 'recaptcha-container') {
  if (recaptchaVerifier) return recaptchaVerifier
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible'
  })
  return recaptchaVerifier
}

export async function sendSmsCode(phoneNumber) {
  // phoneNumber у форматі +380989225442
  const verifier = initRecaptcha()
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
