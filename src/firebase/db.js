import {
  ref, get, set, update, push, onValue, off, remove, increment
} from 'firebase/database'
import { db } from './config'

// в”Ђв”Ђв”Ђ USERS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export async function getUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}/profile`))
  return snap.exists() ? snap.val() : null
}

export async function saveUserProfile(uid, profile) {
  await set(ref(db, `users/${uid}/profile`), {
    ...profile,
    updatedAt: Date.now()
  })
}

export async function updateUserProfile(uid, patch) {
  await update(ref(db, `users/${uid}/profile`), patch)
}

// в”Ђв”Ђв”Ђ TIMESLOTS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export async function getSlotsForDate(date) {
  // date Сѓ С„РѕСЂРјР°С‚С– YYYY-MM-DD
  const snap = await get(ref(db, `timeslots/${date}`))
  return snap.exists() ? snap.val() : {}
}

export function subscribeSlotsForDate(date, callback) {
  const r = ref(db, `timeslots/${date}`)
  const handler = onValue(r, snap => {
    callback(snap.exists() ? snap.val() : {})
  })
  return () => off(r, 'value', handler)
}

// в”Ђв”Ђв”Ђ BOOKINGS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export async function getMyBookings(uid) {
  const snap = await get(ref(db, `bookings/${uid}`))
  if (!snap.exists()) return []
  const data = snap.val()
  return Object.entries(data).map(([id, b]) => ({ id, ...b }))
}

export function subscribeMyBookings(uid, callback) {
  const r = ref(db, `bookings/${uid}`)
  const handler = onValue(r, snap => {
    if (!snap.exists()) return callback([])
    const data = snap.val()
    callback(Object.entries(data).map(([id, b]) => ({ id, ...b })))
  })
  return () => off(r, 'value', handler)
}

export async function createBooking(uid, booking) {
  const r = push(ref(db, `bookings/${uid}`))
  const clean = Object.fromEntries(Object.entries(booking).filter(([,v]) => v !== undefined))
  await set(r, {
    ...clean,
    id: r.key,
    status: 'pending',
    createdAt: Date.now()
  })
  return r.key
}

export async function cancelBooking(uid, bookingId) {
  await update(ref(db, `bookings/${uid}/${bookingId}`), {
    status: 'cancelled',
    cancelledAt: Date.now()
  })
}

// в”Ђв”Ђв”Ђ QUEUE (Р»РёСЃС‚ РѕС‡С–РєСѓРІР°РЅРЅСЏ) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export async function joinQueue(uid, date, time, studentType) {
  const slotKey = `${date}_${time}`
  await set(ref(db, `queue/${slotKey}/entries/${uid}`), {
    uid,
    studentType,
    addedAt: Date.now(),
    status: 'waiting'
  })
}

export async function leaveQueue(uid, date, time) {
  const slotKey = `${date}_${time}`
  await remove(ref(db, `queue/${slotKey}/entries/${uid}`))
}

export async function getQueueForSlot(date, time) {
  const slotKey = `${date}_${time}`
  const snap = await get(ref(db, `queue/${slotKey}/entries`))
  if (!snap.exists()) return []
  return Object.values(snap.val())
}

export function subscribeQueueForSlot(date, time, callback) {
  const slotKey = `${date}_${time}`
  const r = ref(db, `queue/${slotKey}/entries`)
  const handler = onValue(r, snap => {
    if (!snap.exists()) return callback([])
    callback(Object.values(snap.val()))
  })
  return () => off(r, 'value', handler)
}

// в”Ђв”Ђв”Ђ HELPERS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export function getConfirmedSchoolHours(bookings) {
  return bookings
    .filter(b => b.serviceType === 'school' && b.status !== 'cancelled')
    .reduce((sum, b) => sum + (b.durationHours || 1), 0)
}

export function getCompletedHours(bookings) {
  return bookings
    .filter(b => b.status === 'confirmed' && new Date(b.date) < new Date())
    .reduce((sum, b) => sum + (b.durationHours || 1), 0)
}

// ─── CHAT ────────────────────────────────────────────────────────
export function subscribeStudentChat(uid, callback) {
  const r = ref(db, `chats/${uid}`)
  const handler = onValue(r, snap => {
    const data = snap.val() || {}
    const msgs = Object.entries(data)
      .map(([id, m]) => ({ ...m, id }))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    callback(msgs)
  })
  return () => off(r, 'value', handler)
}

export async function sendStudentMessage(uid, text) {
  const time = new Date().toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })
  await push(ref(db, `chats/${uid}`), {
    from: 'student',
    text,
    time,
    ts: Date.now(),
  })
  await update(ref(db, `chatMeta/${uid}`), {
    unreadForAdmin: increment(1),
    lastMsg: text,
    lastTs: Date.now(),
  })
}

export async function markDirectChatRead(uid) {
  await set(ref(db, `chatMeta/${uid}/unreadForStudent`), 0)
}

export function subscribeDirectUnread(uid, callback) {
  const r = ref(db, `chatMeta/${uid}/unreadForStudent`)
  const handler = onValue(r, snap => callback(snap.val() || 0))
  return () => off(r, 'value', handler)
}

// ─── GENERAL CHAT ─────────────────────────────────────────────────
export function subscribeGeneralChat(callback) {
  const r = ref(db, 'chats/general')
  const handler = onValue(r, snap => {
    const data = snap.val() || {}
    const msgs = Object.entries(data)
      .map(([id, m]) => ({ ...m, id }))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    callback(msgs)
  })
  return () => off(r, 'value', handler)
}

export async function sendGeneralMessage(uid, name, text) {
  const time = new Date().toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })
  await push(ref(db, 'chats/general'), {
    uid,
    name,
    from: 'student',
    text,
    time,
    ts: Date.now(),
  })
}
