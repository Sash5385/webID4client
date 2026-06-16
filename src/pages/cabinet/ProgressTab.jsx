import { useMemo } from "react";
import "./ProgressTab.css";

export default function ProgressTab({ user, profile, bookingsData }) {
  const { bookings, schoolHours, manualHours, canBookPrivate } = bookingsData || { bookings: [], schoolHours: 0, manualHours: 0, canBookPrivate: false };

  const studentType = profile?.studentType || "school";
  const isSchool = studentType === "school";
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
          <div className="stat-block">
            <div className="num">{totalLessons}</div>
            <div className="lbl">всього</div>
          </div>
          <div className="stat-block">
            <div className="num">{schoolLessons}</div>
            <div className="lbl">автошкола</div>
          </div>
          <div className="stat-block">
            <div className="num">{privateLessons}</div>
            <div className="lbl">приватні</div>
          </div>
          <div className="stat-block">
            <div className="num">{schoolHours}</div>
            <div className="lbl">годин (школа)</div>
          </div>
        </div>
      </div>

      {totalLessons >= 10 && (
        <div className="progress-hero" style={{ marginTop: 14 }}>
          <div className="progress-title" style={{ marginBottom: 6 }}>🎯 Цілі уроку</div>
          <div className="progress-subtitle">
            З 10-го уроку ти можеш ставити до 3 цілей на кожен запис. Це допомагає інструктору краще підготуватись.
          </div>
        </div>
      )}
    </div>
  );
}
