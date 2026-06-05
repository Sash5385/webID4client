import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribeSlotsForDate, getAdminSettings } from '../firebase/db'
import { getMonthGrid, getMonthName, formatDateYMD, isPast, isSameDay } from '../utils/date'
import { useTheme } from '../hooks/useTheme'
import './cabinet/BookTab.css'

export default function PublicSchedule({ onBook }) {
  const { theme, toggle } = useTheme()
  const navigate = useNavigate()
  const [serviceType, setServiceType] = useState('school')
  const [duration, setDuration] = useState(1)
  const [today] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d })
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(null)
  const [slots, setSlots] = useState({})
  const [selectedTime, setSelectedTime] = useState(null)
  const [loading, setLoading] = useState(false)
  const [adminSettings, setAdminSettings] = useState({ lunchEnabled: false, lunchStart: 12, lunchEnd: 13 })
  const timeSectionRef = useRef(null)

  useEffect(() => {
    if (!selectedDate || !timeSectionRef.current) return
    setTimeout(() => {
      timeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [selectedDate])

  useEffect(() => {
    getAdminSettings().then(s => setAdminSettings(s)).catch(() => {})
  }, [])

  function isBlockedByLunch(slotTime, durationHours) {
    if (!adminSettings.lunchEnabled) return false
    const [h, m] = slotTime.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + durationHours * 60
    return startMin < adminSettings.lunchEnd * 60 && endMin > adminSettings.lunchStart * 60
  }

  function wouldOverlapTaken(slotTime, durationHours) {
    const [h, m] = slotTime.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + durationHours * 60
    return Object.values(slots).some(s => {
      if (s.available !== false) return false
      const [sh, sm] = (s.time || '').split(':').map(Number)
      const sMin = sh * 60 + sm
      return sMin >= startMin && sMin < endMin
    })
  }

  useEffect(() => {
    if (!selectedDate) { setSlots({}); setSelectedTime(null); return }
    setLoading(true)
    const unsub = subscribeSlotsForDate(formatDateYMD(selectedDate), data => {
      setSlots(data || {})
      setLoading(false)
    })
    return unsub
  }, [selectedDate])

  const days = useMemo(() => getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()), [viewMonth])
  const slotsList = useMemo(() => Object.values(slots)
    .filter(slot => (slot.time || '').endsWith(':00'))
    .sort((a, b) => (a.time||'').localeCompare(b.time||''))
    .map(slot => ({
      ...slot,
      lunchBlocked:   isBlockedByLunch(slot.time, duration),
      overlapBlocked: slot.available !== false && wouldOverlapTaken(slot.time, duration),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [slots, duration, adminSettings])

  const prevMonth = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  const nextMonth = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px 80px' }}>

      {/* HEADER */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 0 8px' }}>
        <div>
          <div style={{ fontWeight:900, fontSize:22, color:'var(--text)', lineHeight:1.1 }}>ID4Drive</div>
          <div style={{ fontSize:11, color:'var(--dim)', marginTop:2 }}>Школа водіння · Онлайн-запис</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button
            onClick={toggle}
            style={{ width:36, height:36, borderRadius:10, background:'var(--surface)', border:'none',
              cursor:'pointer', color:'var(--text)', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'var(--shadow)' }}
          >
            {theme==='dark' ? '🌙' : '☀️'}
          </button>
          <button
            onClick={() => navigate('/auth')}
            style={{ height:36, padding:'0 14px', borderRadius:10, background:'var(--surface)', border:'none',
              color:'var(--text)', fontSize:13, fontWeight:700, cursor:'pointer',
              boxShadow:'var(--shadow)' }}
          >
            Увійти
          </button>
        </div>
      </div>

      {/* 1. ТИП УРОКУ */}
      <div className="section-title">1. Тип уроку</div>
      <div className="service-grid">
        <div className={`svc-tile ${serviceType==='school'?'selected':''}`} onClick={() => setServiceType('school')}>
          <div className="ico bk-ico-school">🎓</div>
          <div className="svc-title">Автошкола</div>
          <div className="svc-dur">Курс · ТСЦ</div>
        </div>
        <div className={`svc-tile ${serviceType==='private'?'selected':''}`} onClick={() => setServiceType('private')}>
          <div className="ico bk-ico-private">🚙</div>
          <div className="svc-title">Приватний урок</div>
          <div className="svc-dur">Індивідуально</div>
        </div>
      </div>

      {/* 2. ТРИВАЛІСТЬ */}
      <div className="section-title">2. Тривалість</div>
      <div className="dur-switch">
        <button className={`dur-pill ${duration===1?'active':''}`} onClick={() => setDuration(1)}>1 година</button>
        <button className={`dur-pill ${duration===2?'active':''}`} onClick={() => setDuration(2)}>2 години</button>
      </div>

      {/* 3. ДАТА */}
      <div className="section-title">3. Дата</div>
      <div className="cal-card">
        <div className="cal-head">
          <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
          <div className="cal-month">{getMonthName(viewMonth.getMonth())} {viewMonth.getFullYear()}</div>
          <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        </div>
        <div className="cal-weekdays">
          {['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map(d => <div key={d} className="cal-wd">{d}</div>)}
        </div>
        <div className="cal-days">
          {days.map((d, i) => {
            if (!d) return <div key={i} className="cal-day empty" />
            const disabled = isPast(d)
            const isToday = isSameDay(d, today)
            const selected = selectedDate && isSameDay(d, selectedDate)
            return (
              <button
                key={i}
                className={`cal-day ${disabled?'disabled':''} ${isToday?'today':''} ${selected?'selected':''} ${!disabled?'has-slots':''}`}
                onClick={() => !disabled && setSelectedDate(d)}
                disabled={disabled}
              >
                {d.getDate()}
              </button>
            )
          })}
        </div>
      </div>

      {/* 4. ЧАС */}
      {selectedDate && (
        <>
          <div ref={timeSectionRef} className="section-title">
            4. Час ({selectedDate.toLocaleDateString('uk-UA', { weekday:'short', day:'numeric', month:'long' })})
          </div>
          {loading ? (
            <div style={{ textAlign:'center', padding:'24px' }}>
              <div className="spinner" style={{ margin:'0 auto' }} />
            </div>
          ) : slotsList.length === 0 ? (
            <div style={{ textAlign:'center', padding:'24px', color:'var(--dim)', fontSize:'13px' }}>
              На цю дату немає слотів
            </div>
          ) : (
            <>
              <div className="slots-grid">
                {slotsList.map(slot => {
                  const isUnavailable = slot.available === false || slot.lunchBlocked || slot.overlapBlocked
                  const isSelected = selectedTime === slot.time
                  return (
                    <button
                      key={slot.time}
                      className={`slot ${isUnavailable?'taken':''} ${isSelected?'selected':''}`}
                      onClick={() => !isUnavailable && setSelectedTime(slot.time)}
                      disabled={isUnavailable}
                      title={slot.lunchBlocked ? 'Обідня перерва' : slot.overlapBlocked ? 'Перетин з іншим уроком' : undefined}
                    >
                      <div className="slot-time">{slot.time}</div>
                      {slot.lunchBlocked && <div style={{fontSize:8, opacity:0.5}}>обід</div>}
                    </button>
                  )
                })}
              </div>
              <div className="slot-legend">
                <div className="leg-item"><div className="leg-dot free" /> Вільно</div>
                <div className="leg-item"><div className="leg-dot taken" /> Зайнято</div>
              </div>
            </>
          )}
        </>
      )}

      {/* CTA */}
      {selectedTime && (
        <button
          className="btn-primary"
          style={{ marginTop: 16 }}
          onClick={() => onBook({ serviceType, duration, date: formatDateYMD(selectedDate), time: selectedTime })}
        >
          Записатись на {formatDateYMD(selectedDate).slice(-5).replace('-','.')} о {selectedTime} →
        </button>
      )}

    </div>
  )
}
