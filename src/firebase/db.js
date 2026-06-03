import {
  ref, get, set, update, push, onValue, off, remove, increment, onDisconnect
} from 'firebase/database'
import { db } from './config'

// в”Ђв”Ђв”Ђ USERS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export async function getUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`))
  if (!snap.exists()) return null
  const data = snap.val()
  return { ...(data.profile || {}), isVip: data.isVip || false }
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
export async function joinQueue(uid, date, time, studentType, durationHours = 1, name = '', phone = '') {
  const slotKey = `${date}_${time}`
  await set(ref(db, `queue/${slotKey}/entries/${uid}`), {
    uid,
    studentType,
    durationHours,
    name,
    phone,
    addedAt: Date.now(),
    status: 'waiting'
  })
}

export async function claimReservedSlot(date, time, uid) {
  const slotKey = `${date}_${time}`
  const slotId = `slot${time.replace(':', '')}`
  const updates = {}
  updates[`queue/${slotKey}/entries/${uid}/status`] = 'booked'
  updates[`timeslots/${date}/${slotId}/offeredTo/${uid}`] = null
  updates[`timeslots/${date}/${slotId}/reservedFor`] = null
  updates[`timeslots/${date}/${slotId}/reservedUntil`] = null
  await update(ref(db, '/'), updates)
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
    .filter(b => b.serviceType === 'school' && b.status !== 'cancelled' && new Date(b.date) < new Date())
    .reduce((sum, b) => sum + (b.durationHours || 1), 0)
}

export function getCompletedHours(bookings) {
  return bookings
    .filter(b => b.status === 'confirmed' && new Date(b.date) < new Date())
    .reduce((sum, b) => sum + (b.durationHours || 1), 0)
}

// ─── TIMESLOTS ───────────────────────────────────────────────────
export async function markSlotsUnavailable(date, startTime, durationHours, intervalMin = 30) {
  const [h, m] = startTime.split(':').map(Number)
  const startMin = h * 60 + m
  const endMin = startMin + durationHours * 60
  const updates = {}
  for (let min = startMin; min < endMin; min += intervalMin) {
    const slotH = String(Math.floor(min / 60)).padStart(2, '0')
    const slotM = String(min % 60).padStart(2, '0')
    const slotId = `slot${slotH}${slotM}`
    updates[`timeslots/${date}/${slotId}/available`] = false
    updates[`timeslots/${date}/${slotId}/time`] = `${slotH}:${slotM}`
  }
  await update(ref(db, '/'), updates)
}

// ─── VIEWING (live presence on slot) ─────────────────────────────
export async function setViewingSlot(date, time, uid) {
  const slotId = `slot${time.replace(':', '')}`
  const r = ref(db, `timeslots/${date}/${slotId}/viewing/${uid}`)
  await set(r, Date.now())
  onDisconnect(r).remove()
}

export async function clearViewingSlot(date, time, uid) {
  const slotId = `slot${time.replace(':', '')}`
  await remove(ref(db, `timeslots/${date}/${slotId}/viewing/${uid}`))
}

// ─── ADMIN SETTINGS ──────────────────────────────────────────────
export async function getAdminSettings() {
  const snap = await get(ref(db, 'admin_settings'))
  return snap.exists() ? snap.val() : { lunchEnabled: false, lunchStart: 12, lunchEnd: 13, workStart: 9, workEnd: 18, interval: 30 }
}

export async function getAdminServices() {
  const snap = await get(ref(db, 'admin_data/services'))
  if (!snap.exists()) return []
  const val = snap.val()
  return Array.isArray(val) ? val.filter(s => s && s.active && !s.archived) : []
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
