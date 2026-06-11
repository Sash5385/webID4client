import {
  ref, get, set, update, push, onValue, off, remove, increment, onDisconnect
} from 'firebase/database'
import { db } from './config'

// в”Ђв”Ђв”Ђ USERS в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export async function getUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`))
  if (!snap.exists()) return null
  const data = snap.val()
  return { ...(data.profile || {}), isVip: data.isVip || false, discount: data.discount || 0, hoursOffset: data.hoursOffset || 0 }
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

function classifyDay(slotsObj) {
  if (!slotsObj) return null
  const slots = Object.values(slotsObj).filter(s => s && s.time && !s.adminBlocked)
  if (slots.length === 0) return null
  const free  = slots.filter(s => s.available !== false).length
  const taken = slots.filter(s => s.available === false).length
  if (taken === 0) return 'free'
  if (free  === 0) return 'full'
  return 'partial'
}

export function subscribeMonthAvailability(year, month, callback) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const r = ref(db, 'timeslots')
  const handler = onValue(r, snap => {
    const all = snap.val() || {}
    const result = {}
    Object.entries(all).forEach(([date, slotsObj]) => {
      if (date.startsWith(prefix)) result[date] = classifyDay(slotsObj)
    })
    callback(result)
  })
  return () => off(r, 'value', handler)
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

export async function cancelBooking(uid, bookingId, { isReschedule = false } = {}) {
  const snap = await get(ref(db, `bookings/${uid}/${bookingId}`))
  const booking = snap.val()
  if (!booking) return

  await update(ref(db, `bookings/${uid}/${bookingId}`), {
    status: 'cancelled',
    cancelledAt: Date.now(),
    cancelledBy: isReschedule ? 'reschedule' : 'student',
  })

  // Відновити вільні слоти, видалити 30-хв фантоми
  if (booking.date && booking.time) {
    const [h, m] = booking.time.split(':').map(Number)
    const startMin = h * 60 + m
    const durMin = (booking.durationHours || 1) * 60
    const updates = {}
    for (let i = 0; i < durMin; i += 30) {
      const slotMin = startMin + i
      const slotH = String(Math.floor(slotMin / 60)).padStart(2, '0')
      const slotM = String(slotMin % 60).padStart(2, '0')
      const path = `timeslots/${booking.date}/slot${slotH}${slotM}`
      if (i % 60 === 0) {
        // Годинний слот — відновлюємо
        updates[`${path}/available`] = true
        updates[`${path}/time`] = `${slotH}:${slotM}`
      } else {
        // 30-хв фантом (створений markSlotsUnavailable) — видаляємо
        updates[path] = null
      }
    }
    await update(ref(db, '/'), updates)
  }
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
    .filter(b => b.serviceType === 'school' && (b.status === 'confirmed' || b.status === 'completed') && new Date(b.date) < new Date())
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

// ─── QUEUE OFFERS ────────────────────────────────────────────────
export function subscribeQueueOffers(uid, callback) {
  const r = ref(db, `users/${uid}/queueOffers`)
  const handler = onValue(r, snap => callback(snap.val() || {}))
  return () => off(r, 'value', handler)
}

export async function clearQueueOffer(uid, slotKey) {
  await remove(ref(db, `users/${uid}/queueOffers/${slotKey}`))
}

export async function claimQueueOffer(uid, slotKey, offer, profile) {
  const entrySnap = await get(ref(db, `queue/${slotKey}/entries/${uid}`))
  const entry = entrySnap.val()
  if (!entry) throw new Error('Queue entry not found')
  const durationHours = entry.durationHours || 1
  await createBooking(uid, {
    date: offer.date,
    time: offer.time,
    serviceType: entry.studentType,
    durationHours,
    studentName: entry.name || profile?.name || '',
    phone: entry.phone || profile?.phone || '',
    tscCenter: profile?.tscCenter,
  })
  await markSlotsUnavailable(offer.date, offer.time, durationHours, 30)
  await claimReservedSlot(offer.date, offer.time, uid)
  await clearQueueOffer(uid, slotKey)
}

export function subscribeUserQueue(uid, callback) {
  const r = ref(db, 'queue')
  const handler = onValue(r, snap => {
    const data = snap.val() || {}
    const slots = []
    Object.entries(data).forEach(([slotKey, slotData]) => {
      const entry = slotData?.entries?.[uid]
      if (!entry) return
      const parts = slotKey.split('_')
      const date = parts[0]
      const time = parts.slice(1).join('_')
      slots.push({ slotKey, date, time, ...entry })
    })
    slots.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.time.localeCompare(b.time)
    })
    callback(slots)
  })
  return () => off(r, 'value', handler)
}

export async function declineQueueOffer(uid, slotKey, date, time) {
  const slotId = `slot${time.replace(':', '')}`
  await update(ref(db, '/'), {
    [`queue/${slotKey}/entries/${uid}`]: null,
    [`timeslots/${date}/${slotId}/offeredTo/${uid}`]: null,
    [`users/${uid}/queueOffers/${slotKey}`]: null,
  })
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
  const arr = Array.isArray(val) ? val : Object.values(val)
  return arr.filter(s => s && s.active && !s.archived)
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

export async function clearStudentChat(uid) {
  await remove(ref(db, `chats/${uid}`))
  await set(ref(db, `chatMeta/${uid}/unreadForStudent`), 0)
  await set(ref(db, `chatMeta/${uid}/unreadForAdmin`), 0)
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

// ─── NOTIFICATIONS ────────────────────────────────────────────────
export function subscribeNotifications(uid, callback) {
  const r = ref(db, `notifications/${uid}`)
  const handler = onValue(r, snap => {
    const data = snap.val() || {}
    const items = Object.entries(data)
      .map(([id, n]) => ({ ...n, id }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    callback(items)
  })
  return () => off(r, 'value', handler)
}

export function clearNotification(uid, notifId) {
  return remove(ref(db, `notifications/${uid}/${notifId}`))
}

export function clearAllNotifications(uid) {
  return remove(ref(db, `notifications/${uid}`))
}
