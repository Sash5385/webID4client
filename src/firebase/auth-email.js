import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  sendPasswordResetEmail as fbSendReset
} from 'firebase/auth'
import { auth } from './config'

export async function signUpWithEmail(email, password) {
  const result = await createUserWithEmailAndPassword(auth, email, password)
  return result.user
}

export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email, password)
  return result.user
}

export async function signOut() {
  await fbSignOut(auth)
}

export async function sendPasswordReset(email) {
  await fbSendReset(auth, email)
}