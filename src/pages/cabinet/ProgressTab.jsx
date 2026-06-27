import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { db } from "../../firebase/config";
import "./ProgressTab.css";

export default function ProgressTab({ user, profile, bookingsData }) {
  const navigate = useNavigate()
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

      {totalLessons > 0 && (
        <div className="progress-hero" style={{ marginTop: 14 }}>
          <div className="progress-title" style={{ marginBottom: 10 }}>🏅 Досягнення</div>
          <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4 }}>
            {[
              { emoji:'🎓', label:'1 урок',    earned: totalLessons >= 1 },
              { emoji:'🌱', label:'5 уроків',  earned: totalLessons >= 5 },
              { emoji:'🚗', label:'10 уроків', earned: totalLessons >= 10 },
              { emoji:'🏆', label:'20 уроків', earned: totalLessons >= 20 },
              { emoji:'🌟', label:'30 уроків', earned: totalLessons >= 30 },
              ...(isSchool ? [
                { emoji:'🔓', label:'40 год',  earned: schoolHours >= 40 },
                { emoji:'📋', label:'Іспит',   earned: examPassed === true },
              ] : []),
            ].map(({ emoji, label, earned }) => (
              <div key={label} style={{
                flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                padding:'8px 10px', borderRadius:12,
                background: earned ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)',
                border: earned ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.07)',
                opacity: earned ? 1 : 0.45,
              }}>
                <span style={{ fontSize:22, lineHeight:1 }}>{emoji}</span>
                <span style={{ fontSize:10, fontWeight:700, color: earned ? '#fbbf24' : 'var(--dim)', whiteSpace:'nowrap' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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

      <div className="progress-hero" style={{ marginTop: 14 }}>
        <div className="progress-title" style={{ marginBottom: 8 }}>🚦 Тест ПДР</div>
        <div className="progress-subtitle">
          Перевір знання правил дорожнього руху на перехрестях — проїзд, знаки, світлофор, кільце.
        </div>
        <button
          onClick={() => navigate('/cabinet/test')}
          style={{
            display: 'block', width: '100%', marginTop: 14, padding: 14,
            borderRadius: 14, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #f6b21b, #e09500)',
            color: '#1a1206', fontSize: 14, fontWeight: 800, fontFamily: 'inherit',
            boxShadow: '0 4px 14px rgba(246,178,27,0.4)',
          }}
        >
          Пройти тест →
        </button>
      </div>
    </div>
  );
}
