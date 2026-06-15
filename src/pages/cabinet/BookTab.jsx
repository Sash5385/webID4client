import { useState, useEffect, useRef, useMemo } from 'react'
import { subscribeSlotsForDate, createBooking, joinQueue, leaveQueue, subscribeQueueForSlot, getAdminSettings, getAdminServices, markSlotsUnavailable, claimReservedSlot, setViewingSlot, clearViewingSlot, subscribeMonthAvailability } from '../../firebase/db'
import { getMonthGrid, getMonthName, formatDateYMD, isPast, isSameDay } from '../../utils/date'
import { getInitials, pluralize } from '../../utils/format'
import './BookTab.css'

const FALLBACK_SERVICES = [
  { id:'sv1', name:'Автошкола 1 год',  type:'school',  duration:60,  price:600,  colorId:'blue'   },
  { id:'sv2', name:'Автошкола 2 год',  type:'school',  duration:120, price:1100, colorId:'blue'   },
  { id:'sv3', name:'Приватний 1 год',  type:'private', duration:60,  price:700,  colorId:'purple' },
  { id:'sv4', name:'Приватний 2 год',  type:'private', duration:120, price:1300, colorId:'purple' },
]

export default function BookTab({ user, profile, bookingsData, notifParams }) {
  const isSchool = profile?.studentType === 'school'
  const isPrivateStudent = profile?.studentType === 'private'
  const schoolLimitReached = bookingsData.canBookPrivate // schoolHours >= 40
  // private student: only private; school student: school until 40h, then only private
  const canPrivate = isPrivateStudent || schoolLimitReached
  const canSchool = !isPrivateStudent && !schoolLimitReached
  const isVipStudent = profile?.isVip === true
  const discountPct = profile?.discount || 0
  const applyDiscount = (price) => discountPct > 0 ? Math.round(price * (1 - discountPct / 100)) : price
  const [services, setServices] = useState([])
  const [servicesLoaded, setServicesLoaded] = useState(false)
  const [selectedService, setSelectedService] = useState(null)
  const [today] = useState(() => { const d = new Date(); d.setHours(0,0,0,0); return d })
  const [viewMonth, setViewMonth] = useState(() => {
    if (notifParams?.date) {
      const d = new Date(notifParams.date + 'T12:00:00')
      return new Date(d.getFullYear(), d.getMonth(), 1)
    }
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [selectedDate, setSelectedDate] = useState(() => {
    if (notifParams?.date) return new Date(notifParams.date + 'T12:00:00')
    return null
  })
  const [slots, setSlots] = useState({})
  const [queueMap, setQueueMap] = useState({}) // time → count
  const [selectedTime, setSelectedTime] = useState(notifParams?.time || null)
  const [loading, setLoading] = useState(false)
  const [adminSettings, setAdminSettings] = useState({ lunchEnabled: true, lunchStart: 12, lunchEnd: 13 })
  const [monthAvail, setMonthAvail] = useState({})
  const timeSectionRef = useRef(null)

  // Dialog state
  const [dialogSlot, setDialogSlot] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [successData, setSuccessData] = useState(null) // {type:'booking'|'queue', date, time, service, duration}

  useEffect(() => {
    getAdminSettings().then(s => setAdminSettings(s)).catch(() => {})
    getAdminServices().then(list => {
      const final = list.length > 0 ? list : FALLBACK_SERVICES
      setServices(final)
      const defaultSvc = final.find(s => canPrivate ? s.type === 'private' : s.type === 'school') || final[0]
      setSelectedService(defaultSvc)
      setServicesLoaded(true)
    }).catch(() => {
      setServices(FALLBACK_SERVICES)
      const defaultSvc = FALLBACK_SERVICES.find(s => canPrivate ? s.type === 'private' : s.type === 'school') || FALLBACK_SERVICES[0]
      setSelectedService(defaultSvc)
      setServicesLoaded(true)
    })
  }, [])

  const durationHours = selectedService ? selectedService.duration / 60 : 1

  function getLunchForDate(date) {
    if (!date) return { lunchEnabled: adminSettings.lunchEnabled, lunchStart: adminSettings.lunchStart || 12, lunchEnd: adminSettings.lunchEnd || 13 }
    const dateStr = formatDateYMD(date)
    const ov = (adminSettings.dateOverrides || []).find(o => o.date === dateStr)
    if (ov && ov.type !== 'closed') return { lunchEnabled: ov.lunchEnabled ?? adminSettings.lunchEnabled, lunchStart: ov.lunchStart ?? adminSettings.lunchStart ?? 12, lunchEnd: ov.lunchEnd ?? adminSettings.lunchEnd ?? 13 }
    const dow = (date.getDay() + 6) % 7
    const ws = (adminSettings.weekSchedule || [])[dow]
    if (ws) return { lunchEnabled: ws.lunchEnabled ?? true, lunchStart: ws.lunchStart ?? 12, lunchEnd: ws.lunchEnd ?? 13 }
    return { lunchEnabled: adminSettings.lunchEnabled, lunchStart: adminSettings.lunchStart || 12, lunchEnd: adminSettings.lunchEnd || 13 }
  }

  function isBlockedByLunch(slotTime, durHours) {
    const { lunchEnabled, lunchStart, lunchEnd } = getLunchForDate(selectedDate)
    if (!lunchEnabled) return false
    const [h, m] = slotTime.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + durHours * 60
    return startMin < lunchEnd * 60 && endMin > lunchStart * 60
  }

  function overlapsMyBooking(dateStr, slotTime, durHours) {
    const [nh, nm] = slotTime.split(':').map(Number)
    const newStart = nh * 60 + nm
    const newEnd = newStart + durHours * 60
    return bookingsData.upcoming.some(b => {
      if (b.date !== dateStr || b.status === 'cancelled') return false
      const [bh, bm] = (b.time || '0:0').split(':').map(Number)
      const bStart = bh * 60 + bm
      const bEnd = bStart + (b.durationHours || 1) * 60
      return newStart < bEnd && newEnd > bStart
    })
  }

  function wouldOverlapTaken(slotTime, durHours) {
    const [h, m] = slotTime.split(':').map(Number)
    const startMin = h * 60 + m
    const endMin = startMin + durHours * 60
    // Перевіряємо що всі годинні кроки всередині бронювання мають вільні слоти.
    // Якщо потрібний слот відсутній (кінець дня) — блокуємо.
    for (let i = 60; i < durHours * 60; i += 60) {
      const nextMin = startMin + i
      const nextKey = `slot${String(Math.floor(nextMin/60)).padStart(2,'0')}${String(nextMin%60).padStart(2,'0')}`
      if (!slots[nextKey]) return true
      if (slots[nextKey].available === false) return true
    }
    return Object.values(slots).some(s => {
      const [sh, sm] = (s.time || '').split(':').map(Number)
      const sMin = sh * 60 + sm
      if (sMin <= startMin || sMin >= endMin) return false
      const offsetMin = sMin - startMin
      // Слоти на рівній годинній межі — обов'язкові для багатогодинного уроку,
      // блокують тільки якщо вони вже зайняті.
      if (offsetMin % 60 === 0) return s.available === false
      // Будь-який слот на нестандартному зміщенні (напр. +30хв) — конфлікт.
      return true
    })
  }

  // Авто-скрол до секції часу після вибору дати
  useEffect(() => {
    if (!selectedDate || !timeSectionRef.current) return
    setTimeout(() => {
      timeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [selectedDate])

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
          const sorted = [...entries].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
          const myIdx = sorted.findIndex(e => e.uid === user?.uid && (e.status === 'waiting' || e.status === 'offered'))
          const waitingCount = entries.filter(e => e.status === 'waiting').length
          setQueueMap(prev => ({
            ...prev,
            [slot.time]: { count: waitingCount, mine: myIdx >= 0, position: myIdx + 1 }
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

  useEffect(() => {
    setMonthAvail({})
    const unsub = subscribeMonthAvailability(
      viewMonth.getFullYear(),
      viewMonth.getMonth(),
      avail => setMonthAvail(avail)
    )
    return unsub
  }, [viewMonth])

  const days = useMemo(() => getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth()), [viewMonth])

  const handleSlotClick = (slot) => {
    if (slot.lunchBlocked || slot.overlapBlocked) return
    if (slot.offeredTo?.[user?.uid]) {
      // Слот зарезервований для мене → одразу до бронювання
      setSelectedTime(slot.time)
      return
    }
    if (slot.available === false) {
      // Зайнятий або зарезервований для іншого
      // якщо слот запропонований комусь — і не мені — дозволяємо стати в чергу
      const q = queueMap[slot.time]
      if (q?.mine) return
      setDialogSlot({ ...slot, queueCount: q?.count || 0 })
    } else {
      setSelectedTime(slot.time)
    }
  }

  const handleBook = async () => {
    if (!selectedDate || !selectedTime || !selectedService) return
    const dateStr = formatDateYMD(selectedDate)
    if (overlapsMyBooking(dateStr, selectedTime, durationHours)) {
      alert('Ви вже записані на цей час')
      return
    }
    setSubmitting(true)
    try {
      const dateStr = formatDateYMD(selectedDate)
      const [bh, bm] = selectedTime.split(':').map(Number)
      const bookStartMin = bh * 60 + bm
      let surcharge = 0
      for (let i = 0; i < durationHours; i++) {
        const slotMin = bookStartMin + i * 60
        const key = `slot${String(Math.floor(slotMin/60)).padStart(2,'0')}${String(slotMin%60).padStart(2,'0')}`
        surcharge += slots[key]?.surcharge || 0
        // Фінальна перевірка: заборонити якщо будь-який покритий слот є VIP (для звичайних учнів)
        if (i > 0 && !isVipStudent && slots[key]?.vipOnly) {
          alert('Неможливо записатись: наступна година є VIP-слотом')
          setSubmitting(false)
          return
        }
      }
      const totalPrice = applyDiscount((selectedService?.price || 0) + surcharge)
      const currentSlot = slots[`slot${selectedTime.replace(':', '')}`]
      await createBooking(user.uid, {
        date: dateStr,
        time: selectedTime,
        serviceType: selectedService.type,
        serviceId: selectedService.id,
        serviceName: selectedService.name,
        price: totalPrice || undefined,
        surcharge: surcharge || undefined,
        discountPct: discountPct || undefined,
        durationHours,
        studentName: profile.name,
        phone: profile.phone || user.phoneNumber,
        tscCenter: profile.tscCenter,
      })
      await markSlotsUnavailable(dateStr, selectedTime, durationHours, adminSettings.interval || 30)
      if (currentSlot?.offeredTo?.[user?.uid]) {
        await claimReservedSlot(dateStr, selectedTime, user.uid)
      }
      setSelectedTime(null)
      setSuccessData({ type: 'booking', date: formatDateYMD(selectedDate), time: selectedTime, service: selectedService, surcharge, durationHours })
    } catch (e) {
      alert('Помилка: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoinQueue = async () => {
    if (!dialogSlot || !selectedDate || !selectedService) return
    const dateStr = formatDateYMD(selectedDate)
    if (overlapsMyBooking(dateStr, dialogSlot.time, durationHours)) {
      setDialogSlot(null)
      alert('Ви вже записані на цей час')
      return
    }
    setSubmitting(true)
    try {
      await joinQueue(user.uid, dateStr, dialogSlot.time, selectedService.type, durationHours, profile?.name || '', profile?.phone || user?.phoneNumber || '')
      setDialogSlot(null)
      setSuccessData({ type: 'queue', date: formatDateYMD(selectedDate), time: dialogSlot.time, service: selectedService, durationHours, surcharge: dialogSlot.surcharge || 0 })
    } catch (e) {
      alert('Помилка: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const prevMonth = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  const nextMonth = () => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))

  const slotsList = useMemo(() => {
    const isVip = profile?.isVip === true
    const dateStr = selectedDate ? formatDateYMD(selectedDate) : ''

    // Check if this date is closed per admin settings
    if (selectedDate) {
      const ov = (adminSettings.dateOverrides || []).find(o => o.date === dateStr)
      if (ov?.type === 'closed') return []
      if (!ov) {
        const dow = (selectedDate.getDay() + 6) % 7  // Mon=0..Sun=6
        const ws = (adminSettings.weekSchedule || [])[dow]
        if (ws && ws.enabled === false) return []
      }
    }

    // Sticky slots: show only free slots adjacent to existing bookings on this day
    const stickyEnabled = adminSettings.stickyTimeEnabled !== false
    const stickyMode = adminSettings.stickyTime || 'both'
    const bookingsOnDate = bookingsData.upcoming.filter(b =>
      b.date === dateStr && b.status !== 'cancelled'
    )
    const allowedStartMins = new Set()
    if (stickyEnabled && bookingsOnDate.length > 0) {
      bookingsOnDate.forEach(b => {
        const [bh, bm] = (b.time || '0:0').split(':').map(Number)
        const bStart = bh * 60 + bm
        const bEnd = bStart + (b.durationHours || 1) * 60
        if (stickyMode !== 'after')  allowedStartMins.add(bStart - durationHours * 60)
        if (stickyMode !== 'before') allowedStartMins.add(bEnd)
      })
    }

    return Object.values(slots)
      .filter(slot => !!(slot.time))
      .filter(slot => !slot.vipOnly || isVipStudent)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
      .map(slot => {
        let vipBlocked = false
        if (slot.vipOnly && !isVip) {
          if (selectedDate) {
            const [h, m] = (slot.time || '0:0').split(':').map(Number)
            const slotDt = new Date(selectedDate)
            slotDt.setHours(h, m, 0, 0)
            vipBlocked = Date.now() + 48 * 60 * 60 * 1000 < slotDt.getTime()
          } else {
            vipBlocked = true
          }
        }
        const [th, tm] = (slot.time || '0:0').split(':').map(Number)
        const slotStartMin = th * 60 + tm
        let totalSurcharge = 0
        for (let i = 0; i < durationHours; i++) {
          const coveredMin = slotStartMin + i * 60
          const coveredKey = `slot${String(Math.floor(coveredMin/60)).padStart(2,'0')}${String(coveredMin%60).padStart(2,'0')}`
          totalSurcharge += slots[coveredKey]?.surcharge || 0
        }
        const [th2, tm2] = (slot.time || '0:0').split(':').map(Number)
        const slotMin = th2 * 60 + tm2
        const isExactlyMine = bookingsData.upcoming.some(b => {
          if (b.date !== dateStr || b.status === 'cancelled') return false
          const [bh, bm] = (b.time || '0:0').split(':').map(Number)
          return slotMin === bh * 60 + bm
        })
        const isPartOfMyBooking = bookingsData.upcoming.some(b => {
          if (b.date !== dateStr || b.status === 'cancelled') return false
          const [bh, bm] = (b.time || '0:0').split(':').map(Number)
          const bStart = bh * 60 + bm
          const bEnd = bStart + (b.durationHours || 1) * 60
          return slotMin >= bStart && slotMin < bEnd
        })
        return {
          ...slot,
          lunchBlocked:   isBlockedByLunch(slot.time, durationHours),
          overlapBlocked: slot.available !== false && wouldOverlapTaken(slot.time, durationHours),
          isMyBooked:     overlapsMyBooking(dateStr, slot.time, durationHours),
          isExactlyMine,
          isPartOfMyBooking,
          vipBlocked,
          totalSurcharge,
          totalPrice: (selectedService?.price || 0) + totalSurcharge,
        }
      })
      .filter(slot => !slot.lunchBlocked && !slot.overlapBlocked)
      .filter(slot => {
        if (!stickyEnabled || bookingsOnDate.length === 0) return true
        if (slot.available === false) return true // зайняті — показуємо для черги
        if (slot.isMyBooked) return true // власний запис студента завжди видимий
        const [h, m] = (slot.time || '0:0').split(':').map(Number)
        return allowedStartMins.has(h * 60 + m)
      })
      .filter(slot => {
        // Для заблокованих слотів: показуємо тільки кожен годинний блок від старту бронювання.
        // Наприклад, бронювання 17:30 (2г) → показуємо 17:30 і 18:30, ховаємо 18:00 і 19:00.
        if (slot.available !== false) return true
        const [h, m] = (slot.time || '0:0').split(':').map(Number)
        let curMin = h * 60 + m
        while (curMin >= 30) {
          const prevMin = curMin - 30
          const prevKey = `slot${String(Math.floor(prevMin / 60)).padStart(2, '0')}${String(prevMin % 60).padStart(2, '0')}`
          if (!slots[prevKey] || slots[prevKey].available !== false) break
          curMin = prevMin
        }
        return (h * 60 + m - curMin) % 60 === 0
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, durationHours, adminSettings, profile?.isVip, selectedDate, selectedService, bookingsData.upcoming])

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
      <div className="section-title" style={{color:'#ffffff', fontSize:13, textAlign:'center'}}>1. Послуга</div>
      {!servicesLoaded ? (
        <div style={{textAlign:'center', padding:'16px', color:'var(--dim)', fontSize:'13px'}}>Завантаження...</div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
          {[...services].sort((a,b) => a.duration - b.duration || (a.type === 'school' ? -1 : 1)).map(svc => {
            const isLocked = (svc.type === 'private' && !canPrivate) || (svc.type === 'school' && !canSchool)
            const isSelected = selectedService?.id === svc.id
            const svcColor = svc.colorId === 'green' ? '#7ed957' : svc.colorId === 'yellow' ? '#f7c948' : svc.colorId === 'blue' ? '#5b9bff' : svc.colorId === 'purple' ? '#c084fc' : svc.colorId === 'red' ? '#ff5a3c' : svc.colorId === 'teal' ? '#2dd4bf' : svc.colorId === 'pink' ? '#f472b6' : svc.colorId === 'orange' ? '#fb923c' : svc.colorId === 'indigo' ? '#818cf8' : svc.colorId === 'lime' ? '#a3e635' : '#7ed957'
            return (
              <div
                key={svc.id}
                className={`svc-tile${isSelected ? ' selected' : ''}${isLocked ? ' locked' : ''}`}
                style={{
                  display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'8px 6px',
                  textAlign:'center', borderRadius:12, position:'relative',
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
                  width:28, height:28, borderRadius:8,
                  background:`linear-gradient(155deg,${svcColor}cc,${svcColor}44)`,
                  border:`1.5px solid ${svcColor}55`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:13, boxShadow:`-2px 4px 10px rgba(0,0,0,0.4),inset 1px 1px 0 rgba(255,255,255,0.2)`
                }}>
                  {isLocked ? '🔒' : svc.type === 'school' ? '🎓' : '🚙'}
                </div>
                <div>
                  <div style={{fontSize:10, fontWeight:800, lineHeight:1.3}}>{svc.name}</div>
                  <div style={{fontSize:9, color:'var(--dim)', marginTop:1}}>
                    {isLocked ? (svc.type === 'school' ? 'недоступно' : 'після 40 уроків') : discountPct > 0 ? `${applyDiscount(svc.price)} ₴ (−${discountPct}%)` : `${svc.price} ₴`}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 2. ДАТА */}
      <div className="section-title" style={{color:'#ffffff', fontSize:13, textAlign:'center'}}>2. Дата</div>
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
            const dateStr = formatDateYMD(d)
            const avail = monthAvail[dateStr]      // undefined=loading, null=empty, 'free'/'partial'/'full'
            const dayClass = disabled ? '' :
              avail === undefined ? 'has-slots' :  // loading - show neutral
              avail ? `day-${avail}` : ''          // loaded: colored or plain
            return (
              <button
                key={i}
                className={`cal-day ${disabled ? 'disabled' : ''} ${isToday ? 'today' : ''} ${selected ? 'selected' : ''} ${dayClass}`}
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
          <div ref={timeSectionRef} className="section-title" style={{color:'#ffffff', fontSize:13, textAlign:'center'}}>
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
                  const isMyReserved = !!(slot.offeredTo?.[user?.uid])
                  const isVipLocked = slot.vipBlocked
                  const isMyBooked = slot.isMyBooked
                  const isExactlyMine = slot.isExactlyMine
                  const isPartOfMyBooking = slot.isPartOfMyBooking
                  const isTaken = !isAvailable && !isMyReserved
                  const isTakenByOthers = isTaken && !isPartOfMyBooking
                  const isUnavailable = isLunch || isOverlap || isVipLocked || isTaken || isMyBooked
                  return (
                    <div key={slot.time} style={{position:'relative'}}>
                      <button
                        className={`slot ${isMyReserved || isMyQueue ? 'my-queue' : isPartOfMyBooking ? 'my-booked' : isUnavailable ? 'taken' : ''} ${isSelected ? 'selected' : ''}`}
                        style={{width:'100%'}}
                        onClick={() => !isMyQueue && !isMyBooked && handleSlotClick(slot)}
                        disabled={isLunch || isOverlap || isMyBooked}
                        title={isExactlyMine ? 'Ваш урок' : isPartOfMyBooking ? 'Ваш урок (продовження)' : isMyBooked ? 'Перетин з вашим уроком' : isLunch ? 'Обідня перерва' : isOverlap ? 'Перетин з іншим уроком' : isVipLocked ? 'VIP слот' : isMyReserved ? 'Зарезервовано для вас!' : isTaken ? 'Зайнято — стати в чергу?' : undefined}
                      >
                        <div className="slot-time">{slot.time}</div>
                        {isExactlyMine ? (
                          <div style={{fontSize:8, color:'#4ade80', fontWeight:700}}>ваш</div>
                        ) : isPartOfMyBooking ? null
                        : isMyReserved ? (
                          <div style={{fontSize:8, color:'white', fontWeight:700}}>ваш!</div>
                        ) : isLunch ? (
                          <div style={{fontSize:8, opacity:0.5}}>обід</div>
                        ) : isVipLocked ? (
                          <div style={{fontSize:8, opacity:0.5}}>👑</div>
                        ) : isTakenByOthers || isOverlap ? (
                          <div style={{fontSize:8, opacity:0.7}}>зайнято</div>
                        ) : slot.totalSurcharge ? (
                          <div style={{fontSize:8, color:'#f7c948', fontWeight:700}}>{slot.totalPrice}₴</div>
                        ) : isMyQueue ? (
                          <div className="slot-queue">
                            <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>
                            <span className="slot-queue-num">ти {q.position}-й</span>
                          </div>
                        ) : q?.count > 0 ? (
                          <QueueIcons n={q.count} />
                        ) : null}
                      </button>
                      {isMyQueue && (
                        <button
                          onClick={() => leaveQueue(user.uid, formatDateYMD(selectedDate), slot.time)}
                          style={{
                            position:'absolute', top:-6, right:-6,
                            width:16, height:16, borderRadius:'50%',
                            background:'rgba(239,68,68,0.9)', border:'none', cursor:'pointer',
                            display:'flex', alignItems:'center', justifyContent:'center',
                            fontSize:9, color:'white', fontWeight:900, lineHeight:1,
                            boxShadow:'0 2px 6px rgba(239,68,68,0.6)', zIndex:5,
                          }}
                          title="Вийти з черги"
                        >✕</button>
                      )}
                    </div>
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
      {selectedTime && selectedService && (() => {
        const [sh, sm] = selectedTime.split(':').map(Number)
        const startMin = sh * 60 + sm
        let surcharge = 0
        for (let i = 0; i < durationHours; i++) {
          const slotMin = startMin + i * 60
          const key = `slot${String(Math.floor(slotMin/60)).padStart(2,'0')}${String(slotMin%60).padStart(2,'0')}`
          surcharge += slots[key]?.surcharge || 0
        }
        const baseP = selectedService.price || 0
        const totalPrice = applyDiscount(baseP + surcharge)
        const dateLabel = formatDateYMD(selectedDate).slice(-5).split('-').reverse().join('.')
        return (
          <>
            {surcharge > 0 ? (
              <div style={{
                marginTop:12, padding:'12px 14px', borderRadius:12,
                background:'rgba(247,201,72,0.08)', border:'1px solid rgba(247,201,72,0.35)',
                display:'flex', flexDirection:'column', gap:4,
              }}>
                <div style={{fontSize:13, color:'#f7c948', fontWeight:700}}>
                  ⚠️ Ціна за цей час: <strong>{totalPrice}₴</strong>
                </div>
                <div style={{fontSize:11, color:'rgba(247,201,72,0.7)'}}>
                  Стандартна {baseP}₴ + надбавка +{surcharge}₴{discountPct > 0 ? ` − знижка ${discountPct}%` : ''}
                </div>
              </div>
            ) : totalPrice > 0 ? (
              <div style={{
                marginTop:12, padding:'8px 14px', borderRadius:12,
                background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)',
                fontSize:12, color:'var(--dim)', textAlign:'center',
              }}>
                Вартість уроку: <strong style={{color:'var(--text)'}}>{totalPrice}₴</strong>
                {discountPct > 0 && <span style={{marginLeft:6, color:'#4ade80', fontSize:11}}>−{discountPct}%</span>}
              </div>
            ) : null}
            <button className="btn-primary" style={{marginTop:10}} onClick={handleBook} disabled={submitting}>
              {submitting ? 'Записуємо...' : `✓ Записатись ${dateLabel} о ${selectedTime}${totalPrice ? ` · ${totalPrice}₴` : ''}`}
            </button>
          </>
        )
      })()}

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
            {successData.type === 'queue' && (
              <div className="dialog-sub">Як тільки слот звільниться — отримаєте push-сповіщення.</div>
            )}
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
                  <span className="val" style={{color:'var(--gold)'}}>
                    {applyDiscount(successData.service.price + (successData.surcharge || 0))} ₴
                    {successData.surcharge > 0 && <span style={{fontSize:10, color:'var(--gold)', opacity:0.7}}> (+{successData.surcharge}₴)</span>}
                    {discountPct > 0 && <span style={{fontSize:10, color:'#4ade80', marginLeft:4}}>−{discountPct}%</span>}
                  </span>
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
            <div className="dialog-icon">{dialogSlot.vipOnly ? '👑' : '⏰'}</div>
            <div className="dialog-title">{dialogSlot.vipOnly ? 'VIP черга' : 'Стати в чергу?'}</div>
            <div className="dialog-sub">
              {dialogSlot.vipOnly
                ? 'Коли адмін відкриє цей VIP слот — ти отримаєш сповіщення'
                : 'Якщо учень скасує — отримаєте push-сповіщення, урок стане вашим'}
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
              {dialogSlot.surcharge > 0 && (
                <>
                  <div className="dialog-info-row">
                    <span className="lbl">Базова ціна</span>
                    <span className="val">{selectedService?.price || 0}₴</span>
                  </div>
                  <div className="dialog-info-row">
                    <span className="lbl" style={{color:'var(--gold)'}}>⚡ Надбавка</span>
                    <span className="val" style={{color:'var(--gold)'}}>+{dialogSlot.surcharge}₴</span>
                  </div>
                  {discountPct > 0 && (
                    <div className="dialog-info-row">
                      <span className="lbl" style={{color:'#4ade80'}}>Знижка</span>
                      <span className="val" style={{color:'#4ade80'}}>−{discountPct}%</span>
                    </div>
                  )}
                  <div className="dialog-info-row" style={{borderTop:'1px solid rgba(255,255,255,0.07)', marginTop:4, paddingTop:4}}>
                    <span className="lbl" style={{fontWeight:700}}>Разом</span>
                    <span className="val" style={{fontWeight:800}}>{applyDiscount((selectedService?.price || 0) + dialogSlot.surcharge)}₴</span>
                  </div>
                </>
              )}
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
