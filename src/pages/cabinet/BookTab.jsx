import { useState, useEffect, useMemo } from 'react'
import { getSlotsForDate, createBooking, joinQueue, subscribeQueueForSlot } from '../../firebase/db'
import { getMonthGrid, getMonthName, formatDateYMD, isPast, isSameDay } from '../../utils/date'
import { getInitials, pluralize } from '../../utils/format'
import './BookTab.css'

export default function BookTab({ user, profile, bookingsData }) {
  const isSchool = profile?.studentType === 'school'
  const canPrivate = bookingsData.canBookPrivate || profile?.studentType === 'private'

  const [serviceType, setServiceType] = useState(profile?.studentType || 'school')
  const [duration, setDuration] = useState(1)
  const [today] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d })
  const [viewMonth, setViewMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(null)
  const [slots, setSlots] = useState({})
  const [queueMap, setQueueMap] = useState({}) // time → count
  const [selectedTime, setSelectedTime] = useState(null)
  const [loading, setLoading] = useState(false)

  // Dialog state
  const [dialogSlot, setDialogSlot] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Завантажуємо слоти для обраної дати
  useEffect(() => {
    if (!selectedDate) {
      setSlots({})
      return
    }
    setLoading(true)
    getSlotsForDate(formatDateYMD(selectedDate))
      .then(data => setSlots(data || {}))
      .finally(() => setLoading(false))
  }, [selectedDate])

  // Підписка на чергу для всіх зайнятих слотів
  useEffect(() => {
    if (!selectedDate) return
    const dateKey = formatDateYMD(selectedDate)
    const unsubs = []
    Object.values(slots).forEach(slot => {
      if (slot.available === false) {
        const unsub = subscribeQueueForSlot(dateKey, slot.time, entries => {
          setQueueMap(prev => ({
            ...prev,
            [slot.time]: { count: entries.length, mine: entries.some(e => e.uid === user?.uid) }
          }))
        })
        unsubs.push(unsub)
      }
    })
    return () => unsubs.forEach(u => u())
  }, [slots, selectedDate, user?.uid])

  const days = useMemo(() => getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()), [viewMonth])

  const handleSlotClick = (slot) => {
    if (slot.available === false) {
      // Слот зайнятий → пропонуємо чергу
      const q = queueMap[slot.time]
      if (q?.mine) return  // вже в черзі
      setDialogSlot({ ...slot, queueCount: q?.count || 0 })
    } else {
      setSelectedTime(slot.time)
    }
  }

  const handleBook = async () => {
    if (!selectedDate || !selectedTime) return
    setSubmitting(true)
    try {
      await createBooking(user.uid, {
        date: formatDateYMD(selectedDate),
        time: selectedTime,
        serviceType,
        serviceName: serviceType === 'school' ? 'Автошкола' : 'Приватний',
        durationHours: duration,
        studentName: profile.name,
        phone: profile.phone || user.phoneNumber,
        tscCenter: profile.tscCenter,
      })
      setSelectedTime(null)
      alert('Записано!')
    } catch (e) {
      alert('Помилка: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoinQueue = async () => {
    if (!dialogSlot || !selectedDate) return
    setSubmitting(true)
    try {
      await joinQueue(user.uid, formatDateYMD(selectedDate), dialogSlot.time, serviceType)
      setDialogSlot(null)
      alert('Ти в черзі! Сповістимо коли звільниться.')
    } catch (e) {
      alert('Помилка: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const prevMonth = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  const nextMonth = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))

  const slotsList = useMemo(() => {
    return Object.values(slots).sort((a, b) => (a.time || '').localeCompare(b.time || ''))
  }, [slots])

  const QueueIcons = ({ n }) => {
    const max = Math.min(n, 3)
    return (
      <div className="slot-queue">
        {Array.from({length: max}).map((_, i) => (
          <svg key={i} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="7" r="4"/>
            <path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>
          </svg>
        ))}
        {n > 3 && <span className="slot-queue-num">+{n - 3}</span>}
      </div>
    )
  }

  return (
    <div className="fade-up">

      {/* USER BANNER */}
      <div className="user-banner">
        <div className="banner-avatar">{getInitials(profile?.name)}</div>
        <div className="banner-info">
          <div className="banner-greet">Привіт,</div>
          <div className="banner-name">{profile?.name?.split(' ')[0] || 'Учень'}</div>
          <div className="banner-tag">
            {serviceType === 'school' ? '🎓 Автошкола' : '🚙 Приватний'}
          </div>
        </div>
      </div>

      {/* 1. ТИП УРОКУ */}
      <div className="section-title">1. Тип уроку</div>
      <div className="service-grid">
        <div
          className={`svc-tile ${serviceType === 'school' ? 'selected' : ''} ${!isSchool ? 'locked' : ''}`}
          onClick={() => isSchool && setServiceType('school')}
        >
          <div className={`ico ${isSchool ? 'bk-ico-school' : 'bk-ico-locked'}`}>
            {isSchool ? '🎓' : '🔒'}
          </div>
          <div className="svc-title">Автошкола</div>
          <div className="svc-dur">{isSchool ? 'Курс ТСЦ' : 'недоступно'}</div>
        </div>
        <div
          className={`svc-tile ${serviceType === 'private' ? 'selected' : ''} ${!canPrivate ? 'locked' : ''}`}
          onClick={() => canPrivate && setServiceType('private')}
        >
          <div className={`ico ${canPrivate ? 'bk-ico-private' : 'bk-ico-locked'}`}>
            {canPrivate ? '🚙' : '🔒'}
          </div>
          <div className="svc-title">Приватний</div>
          {canPrivate
            ? <div className="svc-dur">Індивідуально</div>
            : <div className="svc-lock">після 40 уроків</div>
          }
        </div>
      </div>

      {/* 2. ТРИВАЛІСТЬ */}
      <div className="section-title">2. Тривалість</div>
      <div className="dur-switch">
        <button className={`dur-pill ${duration === 1 ? 'active' : ''}`} onClick={() => setDuration(1)}>1 година</button>
        <button className={`dur-pill ${duration === 2 ? 'active' : ''}`} onClick={() => setDuration(2)}>2 години</button>
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
          <div className="cal-wd">Пн</div><div className="cal-wd">Вт</div><div className="cal-wd">Ср</div>
          <div className="cal-wd">Чт</div><div className="cal-wd">Пт</div><div className="cal-wd">Сб</div><div className="cal-wd">Нд</div>
        </div>
        <div className="cal-days">
          {days.map((d, i) => {
            if (!d) return <div key={i} className="cal-day empty"></div>
            const disabled = isPast(d)
            const isToday = isSameDay(d, today)
            const selected = selectedDate && isSameDay(d, selectedDate)
            // TODO: has-slots на основі реальних даних (зараз показуємо всім крім минулих)
            const hasSlots = !disabled
            return (
              <button
                key={i}
                className={`cal-day ${disabled ? 'disabled' : ''} ${isToday ? 'today' : ''} ${selected ? 'selected' : ''} ${hasSlots && !disabled ? 'has-slots' : ''}`}
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
          <div className="section-title">
            4. Час ({selectedDate.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'long' })})
          </div>
          {loading ? (
            <div style={{textAlign:'center', padding:'24px'}}><div className="spinner" style={{margin:'0 auto'}}></div></div>
          ) : slotsList.length === 0 ? (
            <div style={{textAlign:'center', padding:'24px', color:'var(--dim)', fontSize:'13px'}}>
              На цю дату немає слотів
            </div>
          ) : (
            <>
              <div className="slots-grid">
                {slotsList.map(slot => {
                  const q = queueMap[slot.time]
                  const isAvailable = slot.available !== false
                  const isMyQueue = q?.mine
                  const isSelected = selectedTime === slot.time
                  return (
                    <button
                      key={slot.time}
                      className={`slot ${!isAvailable ? 'taken' : ''} ${isSelected ? 'selected' : ''} ${isMyQueue ? 'my-queue' : ''}`}
                      onClick={() => handleSlotClick(slot)}
                    >
                      <div className="slot-time">{slot.time}</div>
                      {isMyQueue ? (
                        <div className="slot-queue">
                          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>
                          <span className="slot-queue-num">ти {q.count}-й</span>
                        </div>
                      ) : q?.count > 0 ? (
                        <QueueIcons n={q.count} />
                      ) : null}
                    </button>
                  )
                })}
              </div>
              <div className="slot-legend">
                <div className="leg-item"><div className="leg-dot free"></div> Вільно</div>
                <div className="leg-item"><div className="leg-dot taken"></div> Зайнято</div>
                <div className="leg-item">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#f7c948"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>
                  в черзі
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* CTA */}
      {selectedTime && (
        <button className="btn-primary" style={{marginTop:16}} onClick={handleBook} disabled={submitting}>
          {submitting ? 'Записуємо...' : `✓ Записатись на ${formatDateYMD(selectedDate).slice(-5).replace('-','.')} о ${selectedTime}`}
        </button>
      )}

      {/* DIALOG: стати в чергу */}
      {dialogSlot && (
        <div className="dialog-backdrop show" onClick={(e) => e.target.classList.contains('dialog-backdrop') && setDialogSlot(null)}>
          <div className="dialog">
            <div className="dialog-handle"></div>
            <div className="dialog-icon">⏰</div>
            <div className="dialog-title">Стати в чергу?</div>
            <div className="dialog-sub">
              Якщо учень скасує — отримаєш push-сповіщення, урок стане твоїм
            </div>
            <div className="dialog-info-card">
              <div className="dialog-info-row">
                <span className="lbl">Дата</span>
                <span className="val">{selectedDate?.toLocaleDateString('uk-UA', { weekday:'short', day:'numeric', month:'long' })}</span>
              </div>
              <div className="dialog-info-row">
                <span className="lbl">Час</span>
                <span className="val">{dialogSlot.time}</span>
              </div>
              <div className="dialog-info-row">
                <span className="lbl">У черзі вже</span>
                <span className="val">
                  {dialogSlot.queueCount} {pluralize(dialogSlot.queueCount, ['учень','учні','учнів'])}
                </span>
              </div>
              <div className="dialog-info-row">
                <span className="lbl">Твоя позиція</span>
                <span className="val" style={{color:'var(--gold)'}}>{dialogSlot.queueCount + 1}-й</span>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn secondary" onClick={() => setDialogSlot(null)}>Скасувати</button>
              <button className="dialog-btn primary" onClick={handleJoinQueue} disabled={submitting}>
                {submitting ? '...' : '✓ В чергу'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
