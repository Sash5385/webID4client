import { useState, useEffect, useMemo } from 'react'
import { subscribeSlotsForDate, createBooking, joinQueue, subscribeQueueForSlot, getAdminSettings, getAdminServices, markSlotsUnavailable, claimReservedSlot, setViewingSlot, clearViewingSlot } from '../../firebase/db'
import { getMonthGrid, getMonthName, formatDateYMD, isPast, isSameDay } from '../../utils/date'
import { getInitials, pluralize } from '../../utils/format'
import './BookTab.css'

const FALLBACK_SERVICES = [
  { id:'school-1h', name:'Автошкола 1 год',  type:'school',  duration:60,  price:0, colorId:'blue'   },
  { id:'school-2h', name:'Автошкола 2 год',  type:'school',  duration:120, price:0, colorId:'blue'   },
  { id:'private-1h',name:'Приватний 1 год',  type:'private', duration:60,  price:0, colorId:'purple' },
  { id:'private-2h',name:'Приватний 2 год',  type:'private', duration:120, price:0, colorId:'purple' },
]

export default function BookTab({ user, profile, bookingsData }) {
  const isSchool = profile?.studentType === 'school'
  const canPrivate = bookingsData.canBookPrivate || profile?.studentType === 'private'
  const [services, setServices] = useState([])
  const [servicesLoaded, setServicesLoaded] = useState(false)
  const [selectedService, setSelectedService] = useState(null)
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
    getAdminServices().then(list => {
      const final = list.length > 0 ? list : FALLBACK_SERVICES
      setServices(final)
      setSelectedService(final[0])
      setServicesLoaded(true)
    }).catch(() => {
      setServices(FALLBACK_SERVICES)
      setSelectedService(FALLBACK_SERVICES[0])
      setServicesLoaded(true)
    })
  }, [])

  const durationHours = selectedService ? Math.round(selectedService.duration / 60) : 1

  function isBlockedByLunch(slotTime, durHours) {
    if (!adminSettings.lunchEnabled) return false
    const [h, m] = slotTime.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + durHours * 60
    return startMin < adminSettings.lunchEnd * 60 && endMin > adminSettings.lunchStart * 60
  }

  function wouldOverlapTaken(slotTime, durHours) {
    const [h, m] = slotTime.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + durHours * 60
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
    if (!selectedDate || !selectedTime || !selectedService) return
    setSubmitting(true)
    try {
      const dateStr = formatDateYMD(selectedDate)
      await createBooking(user.uid, {
        date: dateStr,
        time: selectedTime,
        serviceType: selectedService.type,
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        price: selectedService.price,
        durationHours,
        studentName: profile.name,
        phone: profile.phone || user.phoneNumber,
        tscCenter: profile.tscCenter,
      })
      await markSlotsUnavailable(dateStr, selectedTime, durationHours, adminSettings.interval || 30)
      const currentSlot = slots[`slot${selectedTime.replace(':', '')}`]
      if (currentSlot?.reservedFor === user?.uid) {
        await claimReservedSlot(dateStr, selectedTime, user.uid)
      }
      setSelectedTime(null)
      setSuccessData({ type: 'booking', date: formatDateYMD(selectedDate), time: selectedTime, service: selectedService, durationHours })
    } catch (e) {
      alert('Помилка: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoinQueue = async () => {
    if (!dialogSlot || !selectedDate || !selectedService) return
    setSubmitting(true)
    try {
      await joinQueue(user.uid, formatDateYMD(selectedDate), dialogSlot.time, selectedService.type, durationHours, profile?.name || '', profile?.phone || user?.phoneNumber || '')
      setDialogSlot(null)
      setSuccessData({ type: 'queue', date: formatDateYMD(selectedDate), time: dialogSlot.time, service: selectedService, durationHours })
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
        lunchBlocked:   isBlockedByLunch(slot.time, durationHours),
        overlapBlocked: slot.available !== false && wouldOverlapTaken(slot.time, durationHours),
      }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, durationHours, adminSettings])

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
            {selectedService?.type === 'school' ? '🎓 Автошкола' : '🚙 Приватний'}
          </div>
        </div>
      </div>

      {/* 1. ПОСЛУГА */}
      <div className="section-title">1. Послуга</div>
      {!servicesLoaded ? (
        <div style={{textAlign:'center', padding:'16px', color:'var(--dim)', fontSize:'13px'}}>Завантаження...</div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
          {[...services].sort((a,b) => a.duration - b.duration || (a.type === 'school' ? -1 : 1)).map(svc => {
            const isLocked = svc.type === 'private' && !canPrivate
            const isSelected = selectedService?.id === svc.id
            const svcColor = svc.colorId === 'green' ? '#7ed957' : svc.colorId === 'yellow' ? '#f7c948' : svc.colorId === 'blue' ? '#5b9bff' : svc.colorId === 'purple' ? '#c084fc' : svc.colorId === 'red' ? '#ff5a3c' : svc.colorId === 'teal' ? '#2dd4bf' : svc.colorId === 'pink' ? '#f472b6' : svc.colorId === 'orange' ? '#fb923c' : svc.colorId === 'indigo' ? '#818cf8' : svc.colorId === 'lime' ? '#a3e635' : '#7ed957'
            return (
              <div
                key={svc.id}
                className={`svc-tile${isSelected ? ' selected' : ''}${isLocked ? ' locked' : ''}`}
                style={{
                  display:'flex', flexDirection:'column', alignItems:'center', gap:8, padding:'12px 8px',
                  textAlign:'center', borderRadius:14, position:'relative',
                  borderColor: isSelected ? svcColor : 'transparent',
                  boxShadow: isSelected ? `0 0 0 2px ${svcColor}55, var(--shadow)` : undefined,
                }}
                onClick={() => !isLocked && setSelectedService(svc)}
              >
                {isSelected && (
                  <svg style={{position:'absolute', top:8, right:8}} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={svcColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
                <div style={{
                  width:40, height:40, borderRadius:12,
                  background:`linear-gradient(155deg,${svcColor}cc,${svcColor}44)`,
                  border:`1.5px solid ${svcColor}55`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:19, boxShadow:`-2px 4px 10px rgba(0,0,0,0.4),inset 1px 1px 0 rgba(255,255,255,0.2)`
                }}>
                  {isLocked ? '🔒' : svc.type === 'school' ? '🎓' : '🚙'}
                </div>
                <div>
                  <div style={{fontSize:11, fontWeight:800, lineHeight:1.3}}>{svc.name}</div>
                  <div style={{fontSize:10, color:'var(--dim)', marginTop:1}}>
                    {isLocked ? 'після 40 уроків' : `${svc.price} ₴`}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 2. ДАТА */}
      <div className="section-title">2. Дата</div>
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

      {/* 3. ЧАС */}
      {selectedDate && (
        <>
          <div className="section-title">
            3. Час ({selectedDate.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'long' })})
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
                  const isTaken = !isAvailable && !isMyReserved && !isOtherReserved
                  const isHardDisabled = isLunch || isOverlap || isOtherReserved || isMyQueue
                  return (
                    <button
                      key={slot.time}
                      className={`slot ${isMyReserved || isMyQueue ? 'my-queue' : isTaken ? 'taken' : ''} ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSlotClick(slot)}
                      disabled={isHardDisabled}
                      title={isLunch ? 'Обідня перерва' : isOverlap ? 'Перетин з іншим уроком' : isMyReserved ? 'Зарезервовано для вас!' : isOtherReserved ? 'Пропонується іншому' : isTaken ? 'Зайнято — стати в чергу?' : undefined}
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
      {selectedTime && selectedService && (
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
                <span className="lbl">Послуга</span>
                <span className="val">{successData.service?.name || successData.service}</span>
              </div>
              <div className="dialog-info-row" style={{borderTop:'1px solid var(--border)', paddingTop:10, marginTop:4}}>
                <span className="lbl">Тривалість</span>
                <span className="val">{successData.durationHours} {successData.durationHours === 1 ? 'година' : 'години'}</span>
              </div>
              {successData.service?.price > 0 && (
                <div className="dialog-info-row">
                  <span className="lbl">Ціна</span>
                  <span className="val" style={{color:'var(--gold)'}}>{successData.service.price} ₴</span>
                </div>
              )}
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
