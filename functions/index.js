const { onValueWritten, onValueCreated } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

const db        = admin.database();
const messaging = admin.messaging();
const REGION    = "europe-west1";
const INSTANCE  = "id4drive-booking-44182-default-rtdb";

// ─── HELPER: send FCM to a user token ────────────────────────────
async function sendPush(uid, title, body, urlPath) {
  const snap = await db.ref(`users/${uid}/fcmTokens/web/token`).get();
  const token = snap.val();
  if (!token) return;
  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: { url: urlPath || "/" },
      webpush: {
        notification: { icon: "/favicon.svg", badge: "/favicon.svg" },
        fcmOptions: { link: urlPath || "/" },
      },
    });
  } catch (err) {
    if (
      err.code === "messaging/registration-token-not-registered" ||
      err.code === "messaging/invalid-registration-token"
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
      await sendPush(uid, "✅ Запис підтверджено", `Ваш урок${slot} підтверджено інструктором`, "/cabinet/bookings");
    } else if (newStatus === "cancelled") {
      await sendPush(uid, "❌ Запис скасовано", `Урок${slot} скасовано. Заплануйте новий.`, "/cabinet");
      if (after.cancelledBy === "student") {
        const name = after.studentName || "Учень";
        await sendAdminPush("❌ Учень скасував запис", `${name}${slot}`);
      }
    }
  }
);

// ─── 2. onSlotFreed ───────────────────────────────────────────────
// When a booking is cancelled → notify the first student in the queue for that slot
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
    const qSnap   = await db.ref(`queue/${slotKey}/entries`).orderByChild("addedAt").limitToFirst(5).get();
    if (!qSnap.exists()) return;

    const entries = Object.values(qSnap.val()).sort((a, b) => a.addedAt - b.addedAt);
    for (const entry of entries) {
      await sendPush(
        entry.uid,
        "🎉 З'явилось місце!",
        `Відкрився запис на ${after.date} о ${after.time}. Встигни записатись!`,
        "/cabinet"
      );
    }
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
              "/cabinet/bookings"
            )
          );
        }
      }
    }
    await Promise.allSettled(sends);
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
    await sendPush(uid, "💬 ID4Drive — Інструктор", message.text, "/cabinet/chat");
  }
);
