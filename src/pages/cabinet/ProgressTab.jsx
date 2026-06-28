import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { db } from "../../firebase/config";
import "./ProgressTab.css";

const getWeekStart = dateStr => {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
};

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
  const noShowCount = useMemo(() => bookings.filter(b => b.status === 'noshow').length, [bookings]);
  const attendanceRate = totalLessons + noShowCount > 2
    ? Math.round(totalLessons / (totalLessons + noShowCount) * 100)
    : null;
  const totalSpent = useMemo(() => completed.filter(b => b.isPaid && b.price > 0).reduce((s, b) => s + (b.price || 0), 0), [completed]);
  const totalDebt = useMemo(() => completed.filter(b => !b.isPaid && b.price > 0).reduce((s, b) => s + (b.price || 0), 0), [completed]);

  const lessonStreak = useMemo(() => {
    if (!completed.length) return 0;
    const weeksWithLessons = new Set(completed.map(b => getWeekStart(b.date)));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7;
    const thisWeekMs = today.getTime() - dow * 86400000;
    const thisWeek = new Date(thisWeekMs).toISOString().slice(0, 10);
    let streak = 0;
    const startIdx = weeksWithLessons.has(thisWeek) ? 0 : 1;
    for (let i = startIdx; i < 52; i++) {
      const key = new Date(thisWeekMs - i * 7 * 86400000).toISOString().slice(0, 10);
      if (weeksWithLessons.has(key)) streak++;
      else break;
    }
    return streak;
  }, [completed]);

  const nextLessonWithGoals = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return bookings
      .filter(b => b.status === 'confirmed' && b.date >= today && b.goals?.length > 0)
      .sort((a, b_) => a.date.localeCompare(b_.date))[0] || null;
  }, [bookings]);

  // Радіус кола
  const R = 70;
  const C = 2 * Math.PI * R;
  const dashOffset = C - (C * percent) / 100;

  return (
    <div className="progress-tab">
      {(() => {
        const today = new Date().toISOString().slice(0,10);
        const next = bookings
          .filter(b => b.status === 'confirmed' && b.date >= today)
          .sort((a,b) => a.date.localeCompare(b.date) || (a.time||'').localeCompare(b.time||''))[0];
        if (!next) return null;
        const [,mm,dd] = next.date.split('-');
        const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate()+1);
        const isToday = next.date === today;
        const isTomorrow = next.date === tomorrowDate.toISOString().slice(0,10);
        const dayLabel = isToday ? 'Сьогодні' : isTomorrow ? 'Завтра' : `${parseInt(dd)}.${parseInt(mm)}`;
        return (
          <div className="progress-hero" style={{
            marginBottom:14,
            background:'linear-gradient(135deg,rgba(99,155,255,0.14),rgba(99,155,255,0.06))',
            border:'1px solid rgba(99,155,255,0.3)',
          }}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:28,lineHeight:1}}>📅</span>
              <div style={{flex:1}}>
                <div style={{fontSize:11,color:'#6b9bff',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:3}}>Наступний урок</div>
                <div style={{fontSize:18,fontWeight:900,color:'var(--text)'}}>{dayLabel}{next.time ? ` · ${next.time}` : ''}</div>
                {next.serviceName && <div style={{fontSize:12,color:'var(--dim)',marginTop:2}}>{next.serviceName}</div>}
              </div>
            </div>
          </div>
        );
      })()}
      {(profile?.lessonBalance || 0) > 0 && (
        <div className="progress-hero" style={{
          marginBottom:14,
          background:'linear-gradient(135deg,rgba(74,222,128,0.14),rgba(74,222,128,0.06))',
          border:'1px solid rgba(74,222,128,0.3)',
        }}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:28,lineHeight:1}}>🎓</span>
            <div style={{flex:1}}>
              <div style={{fontSize:11,color:'#4ade80',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:3}}>Залишок уроків</div>
              <div style={{fontSize:18,fontWeight:900,color:'var(--text)'}}>
                {profile.lessonBalance} {profile.lessonBalance === 1 ? 'урок' : profile.lessonBalance < 5 ? 'уроки' : 'уроків'}
              </div>
              <div style={{fontSize:12,color:'var(--dim)',marginTop:2}}>Передоплачених занять</div>
            </div>
          </div>
        </div>
      )}
      {completed.length > 0 && (() => {
        const last = [...completed].sort((a,b_) => b_.date.localeCompare(a.date) || (b_.time||'').localeCompare(a.time||''))[0];
        const [,mm,dd] = last.date.split('-');
        return (
          <div className="progress-hero" style={{
            marginBottom:14,
            background:'linear-gradient(135deg,rgba(168,85,247,0.10),rgba(168,85,247,0.04))',
            border:'1px solid rgba(168,85,247,0.22)',
          }}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:28,lineHeight:1}}>🏁</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,color:'rgba(192,132,252,0.9)',fontWeight:700,textTransform:'uppercase',letterSpacing:1,marginBottom:3}}>Останній урок</div>
                <div style={{fontSize:18,fontWeight:900,color:'var(--text)'}}>{parseInt(dd)}.{parseInt(mm)}{last.time ? ` · ${last.time}` : ''}</div>
                {last.serviceName && <div style={{fontSize:12,color:'var(--dim)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{last.serviceName}</div>}
              </div>
              {last.rating > 0 && (
                <div style={{flexShrink:0}}>
                  <span style={{fontSize:14,color:'#fbbf24'}}>{'★'.repeat(last.rating)}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
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
          {attendanceRate !== null && (
            <div className="stat-btn">
              <div className="num" style={{color: attendanceRate >= 90 ? '#63d37b' : attendanceRate >= 70 ? '#f6b21b' : '#f87171'}}>{attendanceRate}%</div>
              <div className="lbl">явка</div>
            </div>
          )}
        </div>
      </div>

      {(totalSpent > 0 || totalDebt > 0) && (
        <div className="progress-hero" style={{ marginTop: 14 }}>
          <div className="progress-title" style={{ marginBottom: 10 }}>💰 Фінанси</div>
          <div className="stat-row">
            {totalSpent > 0 && (
              <div className="stat-btn">
                <div className="num" style={{ color:'#63d37b', fontSize:14 }}>{totalSpent.toLocaleString()} ₴</div>
                <div className="lbl">оплачено</div>
              </div>
            )}
            {totalDebt > 0 && (
              <div className="stat-btn">
                <div className="num" style={{ color:'#f87171', fontSize:14 }}>{totalDebt.toLocaleString()} ₴</div>
                <div className="lbl">борг</div>
              </div>
            )}
          </div>
        </div>
      )}

      {nextLessonWithGoals && (
        <div className="progress-hero" style={{ marginTop: 14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
            <span style={{ fontSize:18 }}>🎯</span>
            <span style={{ fontSize:13, fontWeight:800, color:'var(--text)' }}>Ціль на наступний урок</span>
          </div>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {nextLessonWithGoals.goals.map(g => (
              <span key={g} style={{
                fontSize:12, padding:'5px 11px', borderRadius:10,
                background:'rgba(99,155,255,0.14)', color:'#6b9bff', fontWeight:700,
              }}>{g}</span>
            ))}
          </div>
          <div style={{ fontSize:11, color:'var(--dim)', marginTop:8 }}>{nextLessonWithGoals.date} · Готуйся!</div>
        </div>
      )}

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

      {lessonStreak >= 2 && (
        <div className="progress-hero" style={{ marginTop: 14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ fontSize:36, lineHeight:1 }}>🔥</div>
            <div>
              <div style={{ fontSize:18, fontWeight:900, color:'#fb923c', lineHeight:1 }}>{lessonStreak}</div>
              <div style={{ fontSize:12, fontWeight:700, color:'#fb923c' }}>тижні поспіль</div>
              <div style={{ fontSize:11, color:'var(--dim)', marginTop:3 }}>Чудова регулярність!</div>
            </div>
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
