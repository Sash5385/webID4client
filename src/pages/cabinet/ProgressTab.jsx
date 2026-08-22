import { useMemo, useState, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../../firebase/config";
import "./ProgressTab.css";

const MANEUVER_LABELS = {
  rozvorot: "Розворот",
  parking90: "Паркування 90",
  parking45: "Паркування 45",
};

export default function ProgressTab({ user, profile, bookingsData }) {
  const { bookings, schoolHours, manualHours, canBookPrivate } = bookingsData || { bookings: [], schoolHours: 0, manualHours: 0, canBookPrivate: false };

  const studentType = profile?.studentType || "school";
  const isSchool = studentType === "school";

  const [examPassed, setExamPassed] = useState(null);
  useEffect(() => {
    if (!user?.uid || !isSchool) return;
    const r = ref(db, `users/${user.uid}/internalExam/passed`);
    const unsub = onValue(r, snap => setExamPassed(snap.exists() ? snap.val() : undefined));
    return () => unsub();
  }, [user?.uid, isSchool]);
  const target = 40;
  const current = Math.min(schoolHours, target);
  const percent = (current / target) * 100;

  const completed = useMemo(
    () => bookings.filter(b => b.status === "confirmed" && new Date(b.date) < new Date()),
    [bookings]
  );

  const totalLessons = completed.length;
  const schoolLessons = completed.filter(b => b.serviceType === "school").length;
  const privateLessons = completed.filter(b => b.serviceType === "private").length;

  // Радіус кола
  const R = 70;
  const C = 2 * Math.PI * R;
  const dashOffset = C - (C * percent) / 100;

  return (
    <div className="progress-tab">
      {isSchool && (
        <div className="progress-hero">
          <div className="progress-circle-wrap">
            <svg className="progress-svg" viewBox="0 0 160 160">
              <defs>
                <linearGradient id="gradOrange" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ff7a5c" />
                  <stop offset="100%" stopColor="#ff5a3c" />
                </linearGradient>
              </defs>
              <circle className="track" cx="80" cy="80" r={R} />
              <circle
                className="fill"
                cx="80"
                cy="80"
                r={R}
                strokeDasharray={C}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="progress-num">
              <div className="big">{current}</div>
              <div className="of">з {target} год</div>
            </div>
          </div>
          <div className="progress-title">Прогрес автошколи</div>
          <div className="progress-subtitle">
            {current < target
              ? `Залишилось ${target - current} годин до завершення курсу`
              : "Курс завершено! Можеш записуватись на приватні уроки"}
          </div>
          {manualHours > 0 && (
            <div className="progress-subtitle" style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
              Включаючи {manualHours} год, зарахованих інструктором
            </div>
          )}

          {canBookPrivate && (
            <div className="unlock-card">
              <div className="unlock-ico">🔓</div>
              <div className="unlock-info">
                <div className="unlock-title">Приватні уроки доступні</div>
                <div className="unlock-desc">
                  Ти пройшов 40 годин автошколи. Тепер можеш записуватись на додаткові приватні уроки.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="progress-hero" style={{ marginTop: 14 }}>
        <div className="progress-title" style={{ marginBottom: 14 }}>Статистика уроків</div>
        <div className="stat-row">
          <div className="stat-btn">
            <div className="num">{totalLessons}</div>
            <div className="lbl">всього</div>
          </div>
          <div className="stat-btn">
            <div className="num">{schoolHours}</div>
            <div className="lbl">автошкола</div>
          </div>
          <div className="stat-btn">
            <div className="num">{privateLessons}</div>
            <div className="lbl">приватні</div>
          </div>
        </div>
      </div>

      {isSchool && (
        <div className="progress-hero" style={{ marginTop: 14 }}>
          <div className="progress-title" style={{ marginBottom: 14 }}>Внутрішній іспит</div>
          {examPassed === true && (
            <div className="exam-card exam-card--pass">
              <span className="exam-ico">✓</span>
              <span className="exam-lbl">Складено</span>
            </div>
          )}
          {examPassed === false && (
            <div className="exam-card exam-card--fail">
              <span className="exam-ico">✗</span>
              <span className="exam-lbl">Не складено</span>
            </div>
          )}
          {(examPassed === null || examPassed === undefined) && (
            <div className="exam-card exam-card--pending">
              <span className="exam-ico">⏳</span>
              <span className="exam-lbl">Очікується</span>
            </div>
          )}
        </div>
      )}

      {totalLessons >= 10 && (
        <div className="progress-hero" style={{ marginTop: 14 }}>
          <div className="progress-title" style={{ marginBottom: 6 }}>🎯 Цілі уроку</div>
          <div className="progress-subtitle">
            З 10-го уроку ти можеш ставити до 3 цілей на кожен запис. Це допомагає інструктору краще підготуватись.
          </div>
        </div>
      )}

      {Object.keys(profile?.maneuverCounts || {}).length > 0 && (
        <div className="progress-hero" style={{ marginTop: 14 }}>
          <div className="progress-title" style={{ marginBottom: 14 }}>🚗 Маневри</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(MANEUVER_LABELS).filter(([key]) => profile.maneuverCounts[key]).map(([key, label]) => {
              const attempts = profile.maneuverCounts[key] || 0;
              const success = profile.maneuverSuccessCounts?.[key] || 0;
              const pct = attempts ? Math.round((success / attempts) * 100) : 0;
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: pct >= 70 ? "#4ade80" : pct >= 40 ? "#facc15" : "#f87171" }}>
                    {success}/{attempts} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="progress-hero" style={{ marginTop: 14 }}>
        <div className="progress-title" style={{ marginBottom: 14 }}>🏅 Медалі</div>
        {Object.keys(profile?.badges || {}).length === 0 ? (
          <div className="progress-subtitle">Ще немає медалей</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(profile.badges).sort((a, b) => (b[1].awardedAt || 0) - (a[1].awardedAt || 0)).map(([bid, b]) => (
              <div key={bid} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 20,
                background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
              }}>
                <span style={{ fontSize: 15 }}>{b.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{b.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
