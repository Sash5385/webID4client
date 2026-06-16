const { onValueWritten, onValueCreated } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

const db        = admin.database();
const messaging = admin.messaging();
const REGION    = "europe-west1";
const INSTANCE  = "id4drive-booking-44182-default-rtdb";

// ─── HELPER: send FCM to a user token ────────────────────────────
async function sendPush(uid, title, body, urlPath, type = 'system') {
  // Persist notification to DB so NotifTab can display it
  await db.ref(`notifications/${uid}`).push({
    type,
    title,
    body,
    url: urlPath || '/cabinet',
    ts: Date.now(),
    read: false,
  }).catch(e => console.error(`notifications write error uid=${uid}`, e.message));

  const snap = await db.ref(`users/${uid}/fcmTokens/web/token`).get();
  const token = snap.val();
  if (!token) {
    console.warn(`sendPush: no token for uid=${uid}`);
    return;
  }
  const link = (urlPath || "/").startsWith("http") ? (urlPath || "/") : `https://id4drive.pro${urlPath || "/"}`;
  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: { url: link },
      webpush: {
        notification: { icon: "/favicon.svg", badge: "/favicon.svg", requireInteraction: true },
        fcmOptions: { link },
      },
    });
    console.log(`sendPush OK uid=${uid} title="${title}"`);
  } catch (err) {
    console.error(`sendPush ERROR uid=${uid} code=${err.code} msg=${err.message}`);
    if (
      err.code === "messaging/registration-token-not-registered" ||
      err.code === "messaging/invalid-registration-token" ||
      err.code === "messaging/invalid-argument"
    ) {
      await db.ref(`users/${uid}/fcmTokens/web`).remove();
    }
  }
}

// ─── HELPER: send FCM to admin ───────────────────────────────────
async function sendAdminPush(title, body) {
  // Try both token paths (legacy and current)
  const paths = ["admin/fcmToken", "admin/fcmTokens/web/token"];
  let token = null;
  let tokenPath = null;
  for (const p of paths) {
    const snap = await db.ref(p).get();
    if (snap.val()) { token = snap.val(); tokenPath = p; break; }
  }
  console.log("Admin token path:", tokenPath, "token exists:", !!token);
  if (!token) { console.log("No admin FCM token found"); return; }
  try {
    await messaging.send({
      token,
      notification: { title, body },
      webpush: {
        notification: { icon: "/favicon.svg", badge: "/favicon.svg" },
        fcmOptions: { link: "/" },
      },
    });
    console.log("Admin push sent OK");
  } catch (err) {
    console.error("Admin push error:", err.code, err.message);
    if (
      err.code === "messaging/registration-token-not-registered" ||
      err.code === "messaging/invalid-registration-token"
    ) {
      await db.ref(tokenPath).remove();
    }
  }
}

// ─── 0. onNewBooking ─────────────────────────────────────────────
exports.onNewBooking = onValueCreated(
  {
    ref: "bookings/{uid}/{bookingId}",
    region: REGION,
    instance: INSTANCE,
  },
  async (event) => {
    const booking = event.data.val();
    console.log("onNewBooking triggered:", booking?.date, booking?.time, booking?.studentName);
    if (!booking) return;
    const name = booking.studentName || "Учень";
    const date = booking.date || "";
    const time = booking.time || "";
    const slot = date && time ? `${date} о ${time}` : date || time;
    await sendAdminPush("📚 Новий запис", `${name} — ${slot}`);
  }
);

// ─── 1. onBookingStatusChanged ────────────────────────────────────
// Triggers when admin confirms or cancels a booking — notify the student
exports.onBookingStatusChanged = onValueWritten(
  {
    ref: "bookings/{uid}/{bookingId}",
    region: REGION,
    instance: INSTANCE,
  },
  async (event) => {
    const { uid } = event.params;
    const before = event.data.before?.val();
    const after  = event.data.after?.val();
    if (!after || !before) return;

    const prevStatus = before.status;
    const newStatus  = after.status;
    if (prevStatus === newStatus) return;

    const date = after.date || "";
    const time = after.time || "";
    const slot = date && time ? ` ${date} о ${time}` : "";

    if (newStatus === "confirmed") {
      await sendPush(uid, "✅ Запис підтверджено", `Ваш урок${slot} підтверджено інструктором`, "/cabinet/bookings", "booking_confirmed");
    } else if (newStatus === "cancelled") {
      if (after.cancelledBy === "reschedule") {
        const name = after.studentName || "Учень";
        await sendAdminPush("🔄 Учень переніс запис", `${name}${slot}`);
      } else {
        await sendPush(uid, "❌ Запис скасовано", `Урок${slot} скасовано. Заплануйте новий.`, "/cabinet", "booking_cancelled");
        if (after.cancelledBy === "student") {
          const name = after.studentName || "Учень";
          await sendAdminPush("❌ Учень скасував запис", `${name}${slot}`);
        }
      }
    }
  }
);

// ─── 2. onSlotFreed ───────────────────────────────────────────────
// When a booking is cancelled → auto-invite the first student in queue (FIFO)
// onQueueInvite will fire next and send the actual offer push to the student
exports.onSlotFreed = onValueWritten(
  {
    ref: "bookings/{uid}/{bookingId}",
    region: REGION,
    instance: INSTANCE,
  },
  async (event) => {
    const after = event.data.after?.val();
    if (!after || after.status !== "cancelled") return;

    const before = event.data.before?.val();
    if (!before || before.status === "cancelled") return;

    const slotKey = `${after.date}_${after.time}`;
    await inviteNextInQueue(slotKey);
  }
);

// ─── 3. lessonReminder ────────────────────────────────────────────
// Daily cron — remind students about lessons the next day
exports.lessonReminder = onSchedule(
  {
    schedule: "0 18 * * *", // 18:00 UTC every day
    timeZone: "Europe/Kyiv",
    region: REGION,
  },
  async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split("T")[0];

    const bookSnap = await db.ref("bookings").get();
    if (!bookSnap.exists()) return;

    const all = bookSnap.val();
    const sends = [];
    for (const [uid, userBookings] of Object.entries(all)) {
      for (const b of Object.values(userBookings)) {
        if (b.date === dateStr && b.status !== "cancelled") {
          sends.push(
            sendPush(
              uid,
              "🚗 Нагадування про урок",
              `Завтра урок о ${b.time || ""}. До зустрічі!`,
              "/cabinet/bookings",
              "system"
            )
          );
        }
      }
    }
    await Promise.allSettled(sends);
  }
);

// ─── 4a. onStudentMessage ────────────────────────────────────────
// When student sends a message in direct chat → push to admin/instructor
exports.onStudentMessage = onValueCreated(
  {
    ref: "chats/{uid}/{msgId}",
    region: REGION,
    instance: INSTANCE,
  },
  async (event) => {
    const { uid } = event.params;
    if (uid === "general") return;

    const message = event.data.val();
    if (!message || message.from !== "student") return;

    const profileSnap = await db.ref(`users/${uid}/profile/name`).get();
    const name = profileSnap.val() || "Учень";

    await db.ref(`chatMeta/${uid}/unreadForAdmin`).transaction((cur) => (cur || 0) + 1);
    await sendAdminPush(`💬 ${name}`, message.text || "Нове повідомлення");
  }
);

// ─── 4. onInstructorMessage ───────────────────────────────────────
// When instructor sends a message in direct chat → push to student
exports.onInstructorMessage = onValueCreated(
  {
    ref: "chats/{uid}/{msgId}",
    region: REGION,
    instance: INSTANCE,
  },
  async (event) => {
    const { uid } = event.params;
    if (uid === "general") return;

    const message = event.data.val();
    if (!message || message.from !== "admin") return;

    await db.ref(`chatMeta/${uid}/unreadForStudent`).transaction((cur) => (cur || 0) + 1);
    await sendPush(uid, "💬 ID4Drive — Інструктор", message.text, "/cabinet/chat", "system");
  }
);

const { onValueUpdated } = require("firebase-functions/v2/database");
const OFFER_WINDOW_MS = 30 * 60 * 1000;

// ─── HELPER: запросити наступного в черзі ────────────────────────
async function inviteNextInQueue(slotKey, excludeUids = []) {
  const entriesSnap = await db.ref(`queue/${slotKey}/entries`).get();
  if (!entriesSnap.exists()) return;
  const entries = Object.entries(entriesSnap.val())
    .map(([uid, e]) => ({ uid, ...e }))
    .filter(e => e.status === "waiting" && !excludeUids.includes(e.uid))
    .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  if (!entries.length) return;
  await db.ref(`queue/${slotKey}/entries/${entries[0].uid}`).update({ status: "offered" });
}

// ─── 5. onQueueInvite ─────────────────────────────────────────────
// Admin clicks "Запросити" → reserves slot and pushes student
exports.onQueueInvite = onValueUpdated(
  { ref: "queue/{slotKey}/entries/{uid}", region: REGION, instance: INSTANCE },
  async (event) => {
    const before = event.data.before.val();
    const after  = event.data.after.val();
    if (!after || after.status !== "offered" || before?.status === "offered") return;

    const uid     = event.params.uid;
    const slotKey = event.params.slotKey;
    const sep  = slotKey.lastIndexOf("_");
    const date = slotKey.slice(0, sep);
    const time = slotKey.slice(sep + 1);
    if (!date || !time) return;
    const slotId = `slot${time.replace(":", "")}`;

    const until = Date.now() + OFFER_WINDOW_MS;
    await db.ref(`timeslots/${date}/${slotId}/offeredTo/${uid}`).set({ until }).catch(() => {});
    await db.ref(`users/${uid}/queueOffers/${slotKey}`).set({ date, time, until, slotKey }).catch(() => {});

    const url = `https://id4drive.pro/cabinet?date=${date}&time=${encodeURIComponent(time)}`;
    await sendPush(uid,
      "🎉 Слот зарезервовано для вас!",
      `${date} о ${time} — у вас 30 хвилин щоб записатись`,
      url,
      "queue_offer"
    );
  }
);

// ─── 6. cascadeQueueInvites ───────────────────────────────────────
// Every 10 min: invite next in queue for expired offers
exports.cascadeQueueInvites = onSchedule(
  { schedule: "every 10 minutes", region: REGION },
  async () => {
    const now = Date.now();
    const slotsSnap = await db.ref("timeslots").get();
    const data = slotsSnap.val() || {};

    for (const [date, dateSlots] of Object.entries(data)) {
      if (!dateSlots || typeof dateSlots !== "object") continue;
      for (const [, slot] of Object.entries(dateSlots)) {
        if (!slot.offeredTo || slot.available === false) continue;
        const time = slot.time;
        if (!time) continue;
        const slotKey = `${date}_${time}`;

        const expiredUids = Object.entries(slot.offeredTo)
          .filter(([, o]) => o.until < now)
          .map(([uid]) => uid);
        if (!expiredUids.length) continue;

        const alreadySnap = await db.ref(`queue/${slotKey}/entries`).get();
        const alreadyOffered = alreadySnap.exists()
          ? Object.entries(alreadySnap.val())
              .filter(([, e]) => e.status === "offered" || e.status === "booked")
              .map(([uid]) => uid)
          : [];

        await inviteNextInQueue(slotKey, alreadyOffered);
      }
    }
  }
);

// ─── 7. onAdminSlotOpened ─────────────────────────────────────────
// Admin unblocks a slot → invite first in queue
exports.onAdminSlotOpened = onValueWritten(
  { ref: "timeslots/{date}/{slotId}", region: REGION, instance: INSTANCE },
  async (event) => {
    const before = event.data.before?.val();
    const after  = event.data.after?.val();
    if (!before || !after) return;
    if (before.adminBlocked !== true) return;
    if (after.adminBlocked !== false || after.available !== true) return;

    const { date, slotId } = event.params;
    // Дерайвимо time з поля або з ключа (slot1000 → '10:00')
    let time = after.time;
    if (!time) {
      const m = slotId.match(/^slot(\d{2})(\d{2})$/);
      if (!m) return;
      time = `${m[1]}:${m[2]}`;
    }

    const slotKey = `${date}_${time}`;
    const qSnap = await db.ref(`queue/${slotKey}/entries`).get();
    if (!qSnap.exists()) return;

    const entries = Object.entries(qSnap.val())
      .map(([uid, e]) => ({ uid, ...e }))
      .filter(e => e.status === "waiting")
      .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    if (!entries.length) return;

    await db.ref(`queue/${slotKey}/entries/${entries[0].uid}`).update({ status: "offered" });
  }
);

// ─── 9. getGoogleReviews ──────────────────────────────────────────
const GOOGLE_PLACES_KEY = "AIzaSyBb0RVbue5lKltEtF8-bSHRSlVR2rZGbZk";
const PLACE_ID          = "ChIJp-GuDoPN1EAR3LSwfhmIeqQ"; // Уроки водіння Київ (автомат)
const CACHE_TTL_MS      = 24 * 60 * 60 * 1000; // 24h

exports.getGoogleReviews = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    const cacheSnap = await db.ref("cache/googleReviews2").get();
    const cache = cacheSnap.val();
    if (cache && cache.updatedAt > Date.now() - CACHE_TTL_MS) {
      res.json(cache.data);
      return;
    }

    const detailsRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${PLACE_ID}&fields=reviews,rating,user_ratings_total&language=uk&key=${GOOGLE_PLACES_KEY}`
    );
    const detailsData = await detailsRes.json();
    const reviews = detailsData.result?.reviews || [];

    await db.ref("cache/googleReviews2").set({ placeId: PLACE_ID, data: reviews, updatedAt: Date.now() });
    res.json(reviews);
  }
);

// ─── 8. unlockVipSlots ────────────────────────────────────────────
// Every hour: unlock VIP slots within 48h and notify non-VIP students
exports.unlockVipSlots = onSchedule(
  { schedule: "every 1 hours", region: REGION },
  async () => {
    const now = Date.now();
    const threshold = now + 48 * 60 * 60 * 1000;
    const slotsSnap = await db.ref("timeslots").get();
    const slotsData = slotsSnap.val() || {};
    const updates = {};
    let unlocked = false;

    for (const [date, dateSlots] of Object.entries(slotsData)) {
      if (!dateSlots || typeof dateSlots !== "object") continue;
      for (const [slotId, slot] of Object.entries(dateSlots)) {
        if (!slot.vipOnly || slot.available === false) continue;
        const time = slot.time;
        if (!time) continue;
        const slotMs = new Date(`${date}T${time}:00`).getTime();
        if (slotMs > now && slotMs <= threshold) {
          updates[`timeslots/${date}/${slotId}/vipOnly`] = false;
          unlocked = true;
        }
      }
    }

    if (!unlocked) return;
    await db.ref().update(updates);

    const usersSnap = await db.ref("users").get();
    const usersData = usersSnap.val() || {};
    const tokens = Object.values(usersData)
      .filter(u => u.fcmTokens?.web?.token && !u.isVip)
      .map(u => u.fcmTokens.web.token);
    if (!tokens.length) return;

    for (let i = 0; i < tokens.length; i += 500) {
      await messaging.sendEachForMulticast({
        tokens: tokens.slice(i, i + 500),
        notification: {
          title: "🚗 З'явились нові слоти!",
          body: "Відкрились нові години для запису. Поспішай!",
        },
        webpush: {
          notification: { icon: "/favicon.svg" },
          fcmOptions: { link: "https://id4drive.pro/book" },
        },
      }).catch(() => {});
    }
  }
);
