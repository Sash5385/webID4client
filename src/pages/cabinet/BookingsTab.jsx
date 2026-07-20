import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useToast } from '../../hooks/useToast'
import { cancelBooking, confirmAttendance, createBooking, markSlotsUnavailable, claimSlot, subscribeSlotsForDate, getAdminSettings, getAdminServices, subscribeMonthAvailability } from '../../firebase/db'
import { parseYMD, getMonthShort, getMonthGrid, getMonthName, formatDateYMD, isPast, isSameDay, formatDateLabel } from '../../utils/date'
import { googleCalendarLink, downloadICS } from '../../utils/calendar'
import './BookingsTab.css'
import './BookTab.css'

// Ціна послуги на дату уроку: якщо задано nextPrice/nextPriceFrom і дата
// уроку вже досягла nextPriceFrom — використовуємо нову ціну (див. BookTab.jsx).
function effectivePrice(svc, dateStr) {
  if (!svc) return 0
  if (svc.nextPrice != null && svc.nextPriceFrom && dateStr && dateStr >= svc.nextPriceFrom) {
    return svc.nextPrice
  }
  return svc.price || 0
}

// Мінімальний час до уроку, коли учень ще може самостійно скасувати (год)
const CANCEL_WINDOW_HOURS = 24

function hoursUntilLesson(booking) {
  if (!booking?.date || !booking?.time) return Infinity
  const [h, m] = booking.time.split(':').map(Number)
  const d = parseYMD(booking.date)
  d.setHours(h, m || 0, 0, 0)
  return (d.getTime() - Date.now()) / 3600000
}

// ─── RESCHEDULE MODAL ────────────────────────────────────────────
function RescheduleModal({ booking, user, profile, onClose, onDone }) {
  const { showToast: showModalToast, ToastEl: ModalToastEl } = useToast()
  const isVipStudent = profile?.isVip === true
  const [today] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d })
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(null)
  const [slots, setSlots] = useState({})
  const [selectedTime, setSelectedTime] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [adminSettings, setAdminSettings] = useState({ lunchEnabled: true, lunchStart: 12, lunchEnd: 13 })
  const [monthAvail, setMonthAvail] = useState({})
  const [services, setServices] = useState([])

  const durationHours = booking.durationHours || 1

  useEffect(() => {
    getAdminSettings().then(s => setAdminSettings(s)).catch(() => {})
    getAdminServices().then(list => setServices(list)).catch(() => {})
  }, [])

  useEffect(() => {
    setMonthAvail({})
    const unsub = subscribeMonthAvailability(viewMonth.getFullYear(), viewMonth.getMonth(), avail => setMonthAvail(avail))
    return unsub
  }, [viewMonth])

  useEffect(() => {
    if (!selectedDate) { setSlots({}); setSelectedTime(null); return }
    setLoading(true)
    const unsub = subscribeSlotsForDate(formatDateYMD(selectedDate), data => {
      setSlots(data || {})
      setLoading(false)
    })
    return unsub
  }, [selectedDate])

  function isBlockedByLunch(time) {
    if (!adminSettings.lunchEnabled) return false
    const [h, m] = time.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + durationHours * 60
    return startMin < adminSettings.lunchEnd * 60 && endMin > adminSettings.lunchStart * 60
  }

  function wouldOverlap(time) {
    const [h, m] = time.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + durationHours * 60
    return Object.values(slots).some(s => {
      if (s.available !== false) return false
      const [sh, sm] = (s.time || '').split(':').map(Number)
      const sMin = sh * 60 + sm
      return sMin >= startMin && sMin < endMin
    })
  }

  const slotsList = useMemo(() => Object.values(slots)
    .filter(s => (s.time || '').endsWith(':00'))
    .filter(s => !s.vipOnly || isVipStudent)
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .map(s => ({
      ...s,
      lunchBlocked: isBlockedByLunch(s.time),
      overlapBlocked: s.available !== false && wouldOverlap(s.time),
    }))
    .filter(s => !s.lunchBlocked)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  , [slots, adminSettings, durationHours, isVipStudent])

  const days = useMemo(() => getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()), [viewMonth])

  const handleConfirm = async () => {
    if (!selectedDate || !selectedTime) return
    setSaving(true)
    try {
      const newDate = formatDateYMD(selectedDate)

      // Перерахунок надбавки за новими слотами + заборона VIP-годин для не-VIP
      const [nh, nm] = selectedTime.split(':').map(Number)
      const newStartMin = nh * 60 + (nm || 0)
      let newSurcharge = 0
      for (let i = 0; i < durationHours; i++) {
        const slotMin = newStartMin + i * 60
        const key = `slot${String(Math.floor(slotMin / 60)).padStart(2, '0')}${String(slotMin % 60).padStart(2, '0')}`
        newSurcharge += slots[key]?.surcharge || 0
        if (i > 0 && !isVipStudent && slots[key]?.vipOnly) {
          showModalToast('Неможливо перенести: наступна година є VIP-слотом')
          setSaving(false)
          return
        }
      }
      // Ціна: якщо є послуга — перераховуємо за її ціною на НОВУ дату (враховує
      // заплановану зміну ціни, напр. з 1 серпня); інакше — стара ціна + різниця надбавки.
      const discountFactor = 1 - (booking.discountPct || 0) / 100
      const oldSurcharge = booking.surcharge || 0
      const svc = services.find(s => s.id === booking.serviceId)
      let newPrice = booking.price
      if (svc) {
        newPrice = Math.round((effectivePrice(svc, newDate) + newSurcharge) * discountFactor)
      } else if (booking.price != null) {
        newPrice = booking.price + Math.round((newSurcharge - oldSurcharge) * discountFactor)
      } else if (newSurcharge > 0) {
        newPrice = Math.round(newSurcharge * discountFactor)
      }

      // 1. Атомарно займаємо новий слот ДО скасування старого
      const claimed = await claimSlot(newDate, selectedTime)
      if (!claimed) {
        showModalToast('Цей слот щойно зайняли. Оберіть інший час.')
        setSaving(false)
        return
      }
      // 2. Скасовуємо старий запис (відновлює старі слоти)
      await cancelBooking(user.uid, booking.id, { isReschedule: true })
      // 3. Створюємо новий
      await createBooking(user.uid, {
        date: newDate,
        time: selectedTime,
        serviceType: booking.serviceType,
        serviceId: booking.serviceId,
        serviceName: booking.serviceName,
        price: newPrice,
        surcharge: newSurcharge || undefined,
        discountPct: booking.discountPct || undefined,
        durationHours,
        studentName: booking.studentName,
        phone: booking.phone,
        tscCenter: booking.tscCenter,
        rescheduledFrom: `${booking.date} ${booking.time}`,
      })
      // 4. Закриваємо слоти (фантомні 30-хв + повна тривалість)
      await markSlotsUnavailable(newDate, selectedTime, durationHours, adminSettings.interval || 30)
      onDone()
    } catch (e) {
      showModalToast('Помилка: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="dialog-backdrop show" onClick={e => e.target.classList.contains('dialog-backdrop') && onClose()} ref={el => el && (el.scrollTop = 0)}>
      {ModalToastEl}
      <div className="dialog">
        <div className="dialog-handle" />
        <div className="dialog-title" style={{ fontSize: 16, marginBottom: 4 }}>📅 Перенести урок</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14, textAlign: 'center' }}>
          {booking.serviceName} · {booking.date} о {booking.time}
        </div>

        {/* CALENDAR */}
        <div className="cal-card" style={{ marginBottom: 14 }}>
          <div className="cal-head">
            <button className="cal-nav-btn" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>‹</button>
            <div className="cal-month">{getMonthName(viewMonth.getMonth())} {viewMonth.getFullYear()}</div>
            <button className="cal-nav-btn" onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>›</button>
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
              const isCurrent = d && formatDateYMD(d) === booking.date
              const dateStr = formatDateYMD(d)
              const avail = monthAvail[dateStr]
              const availClass = (!disabled && !isCurrent) ? (avail ? `day-${avail}` : '') : ''
              return (
                <button
                  key={i}
                  className={`cal-day ${disabled || isCurrent ? 'disabled' : ''} ${isToday ? 'today' : ''} ${selected ? 'selected' : ''} ${availClass}`}
                  onClick={() => !disabled && !isCurrent && setSelectedDate(d)}
                  disabled={disabled || isCurrent}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </div>

        {/* TIME SLOTS */}
        {selectedDate && (
          <>
            <div className="section-title" style={{ marginTop: 0 }}>
              Час · {formatDateLabel(selectedDate)}
            </div>
            {loading ? (
              <div style={{ textAlign:'center', padding:16 }}><div className="spinner" style={{ margin:'0 auto' }} /></div>
            ) : slotsList.length === 0 ? (
              <div style={{ textAlign:'center', color:'var(--dim)', fontSize:13, padding:16 }}>На цю дату немає слотів</div>
            ) : (
              <div className="slots-grid" style={{ marginBottom: 16 }}>
                {slotsList.map(slot => {
                  const unavail = slot.available === false || slot.overlapBlocked
                  const isSelected = selectedTime === slot.time
                  return (
                    <button
                      key={slot.time}
                      className={`slot ${unavail ? 'taken' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => !unavail && setSelectedTime(slot.time)}
                      disabled={unavail}
                    >
                      <div className="slot-time">{slot.time}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}

        <div className="dialog-actions">
          <button className="dialog-btn secondary" onClick={onClose}>Скасувати</button>
          <button
            className="dialog-btn primary"
            onClick={handleConfirm}
            disabled={!selectedDate || !selectedTime || saving}
          >
            {saving ? 'Зберігаємо...' : 'Перенести →'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── MAIN ────────────────────────────────────────────────────────
export default function BookingsTab({ user, profile, bookingsData }) {
  const { upcoming, completed, loading } = bookingsData
  const [rescheduleBooking, setRescheduleBooking] = useState(null)
  const [cancelConfirmId, setCancelConfirmId] = useState(null)
  const [toast, setToast] = useState(null)
  const [showAllCompleted, setShowAllCompleted] = useState(false)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3200)
  }

  const handleConfirmAttendance = async (booking) => {
    try {
      await confirmAttendance(user.uid, booking.id)
      showToast('Присутність підтверджено', 'success')
    } catch (e) {
      showToast('Помилка: ' + e.message, 'error')
    }
  }

  const handleCancel = async (booking) => {
    if (hoursUntilLesson(booking) < CANCEL_WINDOW_HOURS) {
      showToast(`Скасувати урок можна не пізніше ніж за ${CANCEL_WINDOW_HOURS} год до початку. Зверніться до інструктора.`, 'error')
      return
    }
    if (cancelConfirmId !== booking.id) {
      setCancelConfirmId(booking.id)
      return
    }
    setCancelConfirmId(null)
    try {
      await cancelBooking(user.uid, booking.id)
      showToast(`Урок ${booking.date} о ${booking.time} скасовано`)
    } catch (e) {
      showToast('Помилка: ' + e.message, 'error')
    }
  }

  const renderCard = (b, isPast = false) => {
    const d = parseYMD(b.date)
    const endTime = b.time && b.durationHours
      ? (() => {
          const [h, m] = b.time.split(':').map(Number)
          const total = h * 60 + (m || 0) + b.durationHours * 60
          return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
        })()
      : null
    const cancelLocked = hoursUntilLesson(b) < CANCEL_WINDOW_HOURS
    const statusClass = b.status === 'confirmed' ? 'status-confirmed'
      : b.status === 'cancelled' ? 'status-cancelled' : 'status-pending'
    const statusText = b.status === 'confirmed' ? (isPast ? 'Завершено' : 'Підтверджено')
      : b.status === 'cancelled' ? 'Скасовано' : 'Очікує'

    return (
      <div key={b.id} className="booking-card" style={isPast ? {opacity:0.6} : {}}>
        <div className="booking-date">
          <div className="booking-day">{d.getDate()}</div>
          <div className="booking-mon">{getMonthShort(d.getMonth())}</div>
        </div>
        <div className="booking-body">
          <div className="booking-time">
            {b.time}{endTime ? ` — ${endTime}` : ''}
          </div>
          <div className="booking-type">
            {b.serviceType === 'school' ? '🎓' : '🚙'} {b.serviceName} · {b.durationHours || 1} год
            {(b.price > 0) && (
              <span style={{marginLeft:6, color:'var(--gold)', fontWeight:700}}>
                {(b.price + (b.surcharge || 0))} ₴{b.surcharge > 0 ? ` (+${b.surcharge}₴)` : ''}
              </span>
            )}
          </div>
          <div className="booking-meta">📍 Верховинна, 44</div>
          <div className={`booking-status ${statusClass}`}>{statusText}</div>
          {!isPast && b.status !== 'cancelled' && !b.studentConfirmed && (
            <button
              style={{ marginTop: 6, fontSize: 12, padding: '4px 10px',
                background: 'rgba(76, 175, 80, 0.15)', color: '#4caf50',
                border: '1px solid rgba(76, 175, 80, 0.3)', borderRadius: 8,
                cursor: 'pointer', fontWeight: 600 }}
              onClick={() => handleConfirmAttendance(b)}
            >
              ✅ Підтверджую присутність
            </button>
          )}
          {!isPast && b.status !== 'cancelled' && b.studentConfirmed && (
            <div className="booking-meta" style={{ color: '#4caf50', marginTop: 4 }}>
              ✓ Ви підтвердили присутність
            </div>
          )}
          {!isPast && b.status !== 'cancelled' && cancelLocked && (
            <div className="booking-meta" style={{ color: 'var(--dim)', marginTop: 4 }}>
              ⏳ Скасування — не пізніше ніж за {CANCEL_WINDOW_HOURS} год
            </div>
          )}
          {!isPast && b.status !== 'cancelled' && (
            <div className="booking-cal-row">
              <a href={googleCalendarLink(b)} target="_blank" rel="noopener noreferrer" className="cal-add-btn">
                Google Calendar
              </a>
              <button className="cal-add-btn" onClick={() => downloadICS(b)}>
                Apple Calendar
              </button>
            </div>
          )}
        </div>
        {!isPast && b.status !== 'cancelled' && (
          <div className="booking-actions">
            <button className="action-btn" title="Перенести" onClick={() => setRescheduleBooking(b)}>📅</button>
            {cancelConfirmId === b.id ? (
              <>
                <button className="action-btn" style={{ color: '#e53935', fontSize: 11, padding: '2px 6px' }} onClick={() => handleCancel(b)}>Так</button>
                <button className="action-btn" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setCancelConfirmId(null)}>Ні</button>
              </>
            ) : (
              <button
                className="action-btn"
                title={cancelLocked ? `Скасування доступне не пізніше ніж за ${CANCEL_WINDOW_HOURS} год` : 'Скасувати'}
                onClick={() => handleCancel(b)}
                disabled={cancelLocked}
                style={cancelLocked ? { opacity: 0.4 } : {}}
              >✕</button>
            )}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return <div style={{textAlign:'center', padding:'60px'}}><div className="spinner" style={{margin:'0 auto'}}></div></div>
  }

  return (
    <div className="fade-up">
      {upcoming.length === 0 && completed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-emoji">📅</div>
          <div className="empty-state-title">Поки нема записів</div>
          <div className="empty-state-desc">Перейди на вкладку Запис і вибери час уроку</div>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <div className="section-title">Найближчі</div>
              {upcoming.map(b => renderCard(b))}
            </>
          )}
          {completed.length > 0 && (
            <>
              <div className="section-title">Завершені ({completed.length})</div>
              {(showAllCompleted ? completed : completed.slice(0, 10)).map(b => renderCard(b, true))}
              {completed.length > 10 && (
                <button
                  onClick={() => setShowAllCompleted(v => !v)}
                  style={{
                    display:'block', width:'100%', marginTop:8, padding:'10px 16px',
                    borderRadius:12, border:'1px solid rgba(255,255,255,0.1)',
                    background:'rgba(255,255,255,0.04)', color:'var(--dim)',
                    fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                  }}
                >
                  {showAllCompleted ? '▲ Сховати' : `▼ Показати всі (${completed.length})`}
                </button>
              )}
            </>
          )}
        </>
      )}

      {rescheduleBooking && (
        <RescheduleModal
          booking={rescheduleBooking}
          user={user}
          profile={profile}
          onClose={() => setRescheduleBooking(null)}
          onDone={() => { setRescheduleBooking(null); showToast('Урок перенесено') }}
        />
      )}

      {toast && (
        <div style={{
          position:'fixed', bottom:90, left:'50%', transform:'translateX(-50%)',
          background:'var(--surface)', color: toast.type === 'error' ? 'var(--accent)' : 'var(--green)',
          padding:'11px 18px', borderRadius:12, fontSize:13, fontWeight:600,
          boxShadow:'var(--shadow)', zIndex:9999, maxWidth:340, width:'calc(100% - 32px)',
          borderLeft: `3px solid ${toast.type === 'error' ? 'var(--accent)' : 'var(--green)'}`,
          animation:'fadeInUp .2s ease', pointerEvents:'none',
        }}>
          {toast.type !== 'error' && '✓ '}{toast.msg}
        </div>
      )}
    </div>
  )
}
