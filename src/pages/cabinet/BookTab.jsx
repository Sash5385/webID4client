import { useState, useEffect, useMemo } from 'react'
import { subscribeSlotsForDate, createBooking, joinQueue, subscribeQueueForSlot, getAdminSettings, markSlotsUnavailable, claimReservedSlot, setViewingSlot, clearViewingSlot } from '../../firebase/db'
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
  const [adminSettings, setAdminSettings] = useState({ lunchEnabled: true, lunchStart: 12, lunchEnd: 13 })

  // Dialog state
  const [dialogSlot, setDialogSlot] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [successData, setSuccessData] = useState(null) // {type:'booking'|'queue', date, time, service, duration}

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

  // Реальний-тайм підписка на слоти (щоб резервування оновлювалось одразу)
  useEffect(() => {
    if (!selectedDate) { setSlots({}); return }
    setLoading(true)
    const unsub = subscribeSlotsForDate(formatDateYMD(selectedDate), data => {
      setSlots(data || {})
      setLoading(false)
    })
    return unsub
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

  // Сигналізуємо адміну що учень дивиться на цей слот
  useEffect(() => {
    if (!selectedDate || !selectedTime || !user?.uid) return
    const dateStr = formatDateYMD(selectedDate)
    setViewingSlot(dateStr, selectedTime, user.uid).catch(() => {})
    return () => { clearViewingSlot(dateStr, selectedTime, user.uid).catch(() => {}) }
  }, [selectedDate, selectedTime, user?.uid])

  const days = useMemo(() => getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()), [viewMonth])

  const handleSlotClick = (slot) => {
    if (slot.lunchBlocked || slot.overlapBlocked) return
    if (slot.reservedFor === user?.uid) {
      // Слот зарезервований для мене → одразу до бронювання
      setSelectedTime(slot.time)
      return
    }
    if (slot.available === false) {
      // Зайнятий або зарезервований для іншого
      if (slot.reservedFor) return // зарезервовано для когось іншого — не пропонуємо чергу
      const q = queueMap[slot.time]
      if (q?.mine) return
      setDialogSlot({ ...slot, queueCount: q?.count || 0 })
    } else {
      setSelectedTime(slot.time)
    }
  }

  const handleBook = async () => {
    if (!selectedDate || !selectedTime) return
    setSubmitting(true)
    try {
      const dateStr = formatDateYMD(selectedDate)
      await createBooking(user.uid, {
        date: dateStr,
        time: selectedTime,
        serviceType,
        serviceName: serviceType === 'school' ? 'Автошкола' : 'Приватний',
        durationHours: duration,
        studentName: profile.name,
        phone: profile.phone || user.phoneNumber,
        tscCenter: profile.tscCenter,
      })
      await markSlotsUnavailable(dateStr, selectedTime, duration, adminSettings.interval || 30)
      // Якщо слот був зарезервований для мене — знімаємо резерв
      const currentSlot = slots[`slot${selectedTime.replace(':', '')}`]
      if (currentSlot?.reservedFor === user?.uid) {
        await claimReservedSlot(dateStr, selectedTime, user.uid)
      }
      setSelectedTime(null)
      setSuccessData({ type: 'booking', date: formatDateYMD(selectedDate), time: selectedTime, service: serviceType, duration })
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
      await joinQueue(user.uid, formatDateYMD(selectedDate), dialogSlot.time, serviceType, duration)
      setDialogSlot(null)
      setSuccessData({ type: 'queue', date: formatDateYMD(selectedDate), time: dialogSlot.time, service: serviceType, duration })
    } catch (e) {
      alert('Помилка: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const prevMonth = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  const nextMonth = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))

  const slotsList = useMemo(() => {
    return Object.values(slots)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
      .map(slot => ({
        ...slot,
        lunchBlocked:   isBlockedByLunch(slot.time, duration),
        overlapBlocked: slot.available !== false && wouldOverlapTaken(slot.time, duration),
      }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, duration, adminSettings])

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
          <div className="cal-month">
            {getMonthName(viewMonth.getMonth())}
            <span style={{color:'var(--faint)', fontWeight:600, marginLeft:5}}>{viewMonth.getFullYear()}</span>
          </div>
          <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        </div>
        <div className="cal-weekdays">
          {['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map(d => <div key={d} className="cal-wd">{d}</div>)}
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
                  const isLunch = slot.lunchBlocked
                  const isOverlap = slot.overlapBlocked
                  const isMyReserved = slot.reservedFor === user?.uid
                  const isOtherReserved = slot.reservedFor && !isMyReserved
                  const isUnavailable = isLunch || isOverlap || (!isAvailable && !isMyReserved) || isOtherReserved
                  return (
                    <button
                      key={slot.time}
                      className={`slot ${isMyReserved ? 'my-queue' : isUnavailable ? 'taken' : ''} ${isSelected ? 'selected' : ''} ${isMyQueue && !isUnavailable ? 'my-queue' : ''}`}
                      onClick={() => handleSlotClick(slot)}
                      disabled={isUnavailable && !isMyReserved}
                      title={isLunch ? 'Обідня перерва' : isOverlap ? 'Перетин з іншим уроком' : isMyReserved ? 'Зарезервовано для вас!' : isOtherReserved ? 'Пропонується іншому' : undefined}
                    >
                      <div className="slot-time">{slot.time}</div>
                      {isMyReserved ? (
                        <div style={{fontSize:8, color:'white', fontWeight:700}}>ваш!</div>
                      ) : isLunch ? (
                        <div style={{fontSize:8, opacity:0.5}}>обід</div>
                      ) : isOverlap ? (
                        <div style={{fontSize:8, opacity:0.5}}>зайнято</div>
                      ) : isMyQueue ? (
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

      {/* DIALOG: успішний запис / черга */}
      {successData && (
        <div className="dialog-backdrop show" onClick={e => e.target.classList.contains('dialog-backdrop') && setSuccessData(null)}>
          <div className="dialog">
            <div className="dialog-handle"></div>
            <div className="dialog-icon" style={{
              background: successData.type === 'booking'
                ? 'linear-gradient(165deg, #4ade80, #16a34a)'
                : 'linear-gradient(165deg, #fcd34d, #d97706)'
            }}>
              {successData.type === 'booking' ? (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <circle cx="12" cy="7" r="4"/>
                  <path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>
                </svg>
              )}
            </div>
            <div className="dialog-title">
              {successData.type === 'booking' ? 'Урок заброньовано!' : 'Ти в черзі!'}
            </div>
            <div className="dialog-sub">
              {successData.type === 'booking'
                ? 'Чекай підтвердження від інструктора. Нагадаємо за 24 год.'
                : 'Як тільки слот звільниться — отримаєш push-сповіщення.'
              }
            </div>
            <div className="dialog-info-card">
              <div className="dialog-info-row">
                <span className="lbl">Дата</span>
                <span className="val">
                  {new Date(successData.date + 'T12:00:00').toLocaleDateString('uk-UA', { weekday:'short', day:'numeric', month:'long' })}
                </span>
              </div>
              <div className="dialog-info-row">
                <span className="lbl">Час</span>
                <span className="val">{successData.time}</span>
              </div>
              <div className="dialog-info-row">
                <span className="lbl">Тип</span>
                <span className="val">{successData.service === 'school' ? '🎓 Автошкола' : '🚙 Приватний'}</span>
              </div>
              <div className="dialog-info-row" style={{borderTop:'1px solid var(--border)', paddingTop:10, marginTop:4}}>
                <span className="lbl">Тривалість</span>
                <span className="val">{successData.duration} {successData.duration === 1 ? 'година' : 'години'}</span>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn primary" onClick={() => setSuccessData(null)}>Закрити</button>
            </div>
          </div>
        </div>
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
