import { useState, useEffect, useRef, useMemo } from 'react'
import { subscribeSlotsForDate, createBooking, joinQueue, leaveQueue, subscribeQueueForSlot, getAdminSettings, getAdminServices, markSlotsUnavailable, claimSlot, unclaimSlot, claimReservedSlot, setViewingSlot, clearViewingSlot, subscribeMonthAvailability } from '../../firebase/db'
import { getMonthGrid, getMonthName, formatDateYMD, isPast, isSameDay } from '../../utils/date'
import { getInitials, pluralize } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import './BookTab.css'

const FALLBACK_SERVICES = [
  { id:'sv1', name:'Автошкола 1 год',  type:'school',  duration:60,  price:600,  colorId:'blue'   },
  { id:'sv2', name:'Автошкола 2 год',  type:'school',  duration:120, price:1100, colorId:'blue'   },
  { id:'sv3', name:'Приватний 1 год',  type:'private', duration:60,  price:700,  colorId:'purple' },
  { id:'sv4', name:'Приватний 2 год',  type:'private', duration:120, price:1300, colorId:'purple' },
]

// Прибираємо дублювання тривалості з назви на плитці ("Автошкола 1 год" → "Автошкола") —
// тривалість вже показана окремим підписом нижче.
function stripDurationSuffix(name) {
  return (name || '').replace(/\s+\d+(?:[.,]\d+)?\s*год\S*\.?\s*$/iu, '').trim() || name
}

// Ціна послуги на дату уроку: якщо задано nextPrice/nextPriceFrom і дата
// уроку вже досягла nextPriceFrom — використовуємо нову ціну (див. налаштування послуг в адмінці).
function effectivePrice(svc, dateStr) {
  if (!svc) return 0
  if (svc.nextPrice != null && svc.nextPriceFrom && dateStr && dateStr >= svc.nextPriceFrom) {
    return svc.nextPrice
  }
  return svc.price || 0
}

// Ціна за конкретний слот = базова погодинна ставка (ціна 1-годинної послуги
// цього типу в адмінці) × тривалість слота + надбавка.
function slotPrice(baseService, dateStr, durationHours, surcharge = 0) {
  return Math.round(effectivePrice(baseService, dateStr) * durationHours) + surcharge
}

function formatDur(durMin) {
  return `${durMin} ${pluralize(durMin, ['хвилина', 'хвилини', 'хвилин'])}`
}

function timeToMin(t) {
  const [h, m] = (t || '0:0').split(':').map(Number)
  return h * 60 + m
}

export default function BookTab({ user, profile, bookingsData, notifParams }) {
  const { showToast, ToastEl } = useToast()
  const isSchool = profile?.studentType === 'school'
  const isPrivateStudent = profile?.studentType === 'private'
  const schoolLimitReached = bookingsData.canBookPrivate // schoolHours >= 40
  // Тип учня більше не обирається на кожен запис — він однозначно випливає
  // з профілю (заповнюється при реєстрації) + правила "40 год автошколи → приватні":
  // приватний учень — завжди приватний; учень автошколи — автошкола, поки не набере 40 год.
  const effectiveType = (isPrivateStudent || schoolLimitReached) ? 'private' : 'school'
  const isVipStudent = profile?.isVip === true
  const discountPct = profile?.discount || 0
  const applyDiscount = (price) => discountPct > 0 ? Math.round(price * (1 - discountPct / 100)) : price
  const [services, setServices] = useState([])
  // Базова погодинна ставка — це ціна вже наявної в адмінці 1-годинної послуги
  // цього типу. Кроку "Послуга" більше немає: тривалість і ціну конкретного
  // запису визначає сам обраний слот (slot.durMin), а не вибір учня.
  const baseService = useMemo(
    () => services.find(s => s.active !== false && s.type === effectiveType && Number(s.duration) === 60)
       || services.find(s => s.type === effectiveType && Number(s.duration) === 60),
    [services, effectiveType]
  )
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
  // Другий обраний годинний слот — коли учень бере два сусідні вільні годинні
  // слоти (напр. 8:00 і 9:00), вони об'єднуються в один запис на 2 години.
  const [selectedTime2, setSelectedTime2] = useState(null)
  const [loading, setLoading] = useState(() => !!notifParams?.date)
  const initialDateSet = useRef(true)
  useEffect(() => {
    if (initialDateSet.current) { initialDateSet.current = false; return }
    setSelectedTime(null)
    setSelectedTime2(null)
  }, [selectedDate])
  const [adminSettings, setAdminSettings] = useState({ lunchEnabled: true, lunchStart: 12, lunchEnd: 13 })
  const [monthAvail, setMonthAvail] = useState({})
  const timeSectionRef = useRef(null)
  const ctaSectionRef = useRef(null)
  const [cardCopied, setCardCopied] = useState(false)
  const copyingCardRef = useRef(false)
  const copyCard = () => {
    if (copyingCardRef.current) return
    copyingCardRef.current = true
    navigator.clipboard.writeText('4035200041312916').then(() => {
      setCardCopied(true)
      setTimeout(() => setCardCopied(false), 1800)
    }).catch(() => {}).finally(() => {
      setTimeout(() => { copyingCardRef.current = false }, 500)
    })
  }

  // Dialog state
  const [dialogSlot, setDialogSlot] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [successData, setSuccessData] = useState(null) // {type:'booking'|'queue', date, time, service, duration}

  useEffect(() => {
    getAdminSettings().then(s => setAdminSettings(s)).catch(() => {})
    getAdminServices().then(list => {
      setServices(list.length > 0 ? list : FALLBACK_SERVICES)
    }).catch(() => {
      setServices(FALLBACK_SERVICES)
    })
  }, [])

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
      // Нестандартне зміщення (+30хв) — конфлікт лише якщо слот зайнятий.
      return s.available === false
    })
  }

  // Авто-скрол до секції часу після вибору дати
  useEffect(() => {
    if (!selectedDate || !timeSectionRef.current) return
    setTimeout(() => {
      timeSectionRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
    }, 100)
  }, [selectedDate])

  // Авто-скрол вікна в самий низ після вибору часу
  useEffect(() => {
    if (!selectedTime) return
    setTimeout(() => {
      const container = document.querySelector('.cab-content')
      if (container) container.scrollTop = container.scrollHeight
    }, 100)
  }, [selectedTime])

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
      setSelectedTime2(null)
      return
    }
    if (slot.available === false) {
      // Зайнятий або зарезервований для іншого
      // якщо слот запропонований комусь — і не мені — дозволяємо стати в чергу
      const q = queueMap[slot.time]
      if (q?.mine) return
      setDialogSlot({ ...slot, queueCount: q?.count || 0 })
      return
    }
    // Повторний тап на вже обраний слот — знімає його з вибору.
    if (slot.time === selectedTime) {
      if (selectedTime2) { setSelectedTime(selectedTime2); setSelectedTime2(null) }
      else setSelectedTime(null)
      return
    }
    if (slot.time === selectedTime2) {
      setSelectedTime2(null)
      return
    }
    // Тап на сусідній вільний годинний слот, коли вже обрано один такий самий —
    // об'єднуємо в один запис на 2 години замість заміни вибору.
    if (selectedTime && !selectedTime2 && slot.slotDurMin === 60) {
      const anchorSlot = slots[`slot${selectedTime.replace(':', '')}`]
      const anchorDur = anchorSlot?.durMin || 60
      if (anchorDur === 60 && Math.abs(timeToMin(slot.time) - timeToMin(selectedTime)) === 60) {
        setSelectedTime2(slot.time)
        return
      }
    }
    setSelectedTime(slot.time)
    setSelectedTime2(null)
  }

  const handleBook = async () => {
    if (!selectedDate || !selectedTime || !baseService) return
    // Якщо обрано два сусідні годинні слоти — запис починається з раннішого
    // з них і триває 2 години; інакше тривалість власна для обраного слота
    // (адмін задає її на розкладі), а не заздалегідь вибрана послуга.
    const startTime = selectedTime2 && timeToMin(selectedTime2) < timeToMin(selectedTime) ? selectedTime2 : selectedTime
    const secondTime = selectedTime2 ? (startTime === selectedTime ? selectedTime2 : selectedTime) : null
    const currentSlot = slots[`slot${startTime.replace(':', '')}`]
    const durationHours = secondTime ? 2 : (currentSlot?.durMin || 60) / 60
    const slotDt = new Date(selectedDate)
    const [slotH, slotM] = startTime.split(':').map(Number)
    slotDt.setHours(slotH, slotM, 0, 0)
    if (slotDt <= new Date()) {
      showToast('Не можна записатись на минулий час')
      return
    }
    const dateStr = formatDateYMD(selectedDate)
    if (overlapsMyBooking(dateStr, startTime, durationHours)) {
      showToast('Ви вже записані на цей час')
      return
    }
    setSubmitting(true)
    try {
      const dateStr = formatDateYMD(selectedDate)
      const [bh, bm] = startTime.split(':').map(Number)
      const bookStartMin = bh * 60 + bm
      let surcharge = 0
      for (let slotMin = bookStartMin; slotMin < bookStartMin + durationHours * 60; slotMin += 60) {
        const key = `slot${String(Math.floor(slotMin/60)).padStart(2,'0')}${String(slotMin%60).padStart(2,'0')}`
        surcharge += slots[key]?.surcharge || 0
        // Фінальна перевірка: заборонити якщо будь-який покритий слот є VIP (для звичайних учнів)
        if (slotMin > bookStartMin && !isVipStudent && slots[key]?.vipOnly) {
          showToast('Неможливо записатись: наступна година є VIP-слотом')
          setSubmitting(false)
          return
        }
      }
      const totalPrice = applyDiscount(slotPrice(baseService, dateStr, durationHours, surcharge))
      const isOfferedToMe = !!currentSlot?.offeredTo?.[user?.uid]
      // Атомарно займаємо слот(и) (крім випадку, коли його зарезервовано саме для мене)
      if (!isOfferedToMe) {
        const claimed = await claimSlot(dateStr, startTime)
        if (!claimed) {
          showToast('Цей слот щойно зайняли. Оберіть інший час.')
          setSubmitting(false)
          return
        }
        if (secondTime) {
          const claimed2 = await claimSlot(dateStr, secondTime)
          if (!claimed2) {
            await unclaimSlot(dateStr, startTime)
            showToast('Один з обраних слотів щойно зайняли. Оберіть інший час.')
            setSubmitting(false)
            return
          }
        }
      }
      const bookedService = { ...baseService, name: `${stripDurationSuffix(baseService.name)} ${formatDur(durationHours * 60)}`.trim() }
      await createBooking(user.uid, {
        date: dateStr,
        time: startTime,
        serviceType: baseService.type,
        serviceId: baseService.id,
        serviceName: bookedService.name,
        price: totalPrice || undefined,
        surcharge: surcharge || undefined,
        discountPct: discountPct || undefined,
        durationHours,
        studentName: profile.name,
        phone: profile.phone || user.phoneNumber,
      })
      await markSlotsUnavailable(dateStr, startTime, durationHours, adminSettings.interval || 30)
      if (isOfferedToMe) {
        await claimReservedSlot(dateStr, startTime, user.uid)
      }
      setSelectedTime(null)
      setSelectedTime2(null)
      setSuccessData({ type: 'booking', date: formatDateYMD(selectedDate), time: startTime, service: bookedService, surcharge, durationHours })
    } catch (e) {
      showToast('Помилка: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleJoinQueue = async () => {
    if (!dialogSlot || !selectedDate || !baseService) return
    const durationHours = (dialogSlot.slotDurMin || dialogSlot.durMin || 60) / 60
    const slotDt = new Date(selectedDate)
    const [slotH, slotM] = (dialogSlot.time || '0:0').split(':').map(Number)
    slotDt.setHours(slotH, slotM, 0, 0)
    if (slotDt <= new Date()) {
      setDialogSlot(null)
      showToast('Не можна стати в чергу на минулий час')
      return
    }
    const dateStr = formatDateYMD(selectedDate)
    if (overlapsMyBooking(dateStr, dialogSlot.time, durationHours)) {
      setDialogSlot(null)
      showToast('Ви вже записані на цей час')
      return
    }
    setSubmitting(true)
    try {
      await joinQueue(user.uid, dateStr, dialogSlot.time, effectiveType, durationHours, profile?.name || '', profile?.phone || user?.phoneNumber || '')
      setDialogSlot(null)
      const bookedService = { ...baseService, name: `${stripDurationSuffix(baseService.name)} ${formatDur(durationHours * 60)}`.trim() }
      setSuccessData({ type: 'queue', date: formatDateYMD(selectedDate), time: dialogSlot.time, service: bookedService, durationHours, surcharge: dialogSlot.surcharge || 0 })
    } catch (e) {
      showToast('Помилка: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Напрям останньої зміни місяця — для пружинної анімації гортання календаря.
  const [calSlideDir, setCalSlideDir] = useState(0) // 1 = вперед (в наступний), -1 = назад
  const prevMonth = () => { setCalSlideDir(-1); setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1)) }
  const nextMonth = () => { setCalSlideDir(1); setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1)) }

  // Свайп вліво/вправо по календарю — зміна місяця. Зупиняємо спливання (stopPropagation),
  // інакше цей же свайп ловить обробник перемикання вкладок у Cabinet.jsx (на батьківському
  // .cab-content) і замість зміни місяця перемикає всю сторінку на іншу вкладку.
  const calTouchRef = useRef(null)
  const handleCalTouchStart = (e) => {
    const t = e.touches[0]
    calTouchRef.current = { x: t.clientX, y: t.clientY }
  }
  const handleCalTouchEnd = (e) => {
    const start = calTouchRef.current
    calTouchRef.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    e.stopPropagation()
    if (dx < 0) nextMonth()
    else prevMonth()
  }

  const slotsList = useMemo(() => {
    const isVip = profile?.isVip === true
    const dateStr = selectedDate ? formatDateYMD(selectedDate) : ''

    // Check if this date is closed per admin settings
    if (selectedDate) {
      const ov = (adminSettings.dateOverrides || []).find(o => o.date === dateStr)
      if (ov?.type === 'closed') return []
      if (!ov && Object.keys(slots).length === 0) {
        const dow = (selectedDate.getDay() + 6) % 7  // Mon=0..Sun=6
        const ws = (adminSettings.weekSchedule || [])[dow]
        if (ws && ws.enabled === false) return []
      }
    }

    // Sticky slots: show only free slots adjacent to existing bookings on this day.
    // Тривалість слота тепер своя в кожного (durMin), тому перевіряємо
    // сусідство індивідуально для кожного слота, а не через єдиний зсув наперед.
    const stickyEnabled = adminSettings.stickyTimeEnabled !== false
    const stickyMode = adminSettings.stickyTime || 'both'
    const bookingsOnDate = bookingsData.upcoming.filter(b =>
      b.date === dateStr && b.status !== 'cancelled'
    )

    return Object.values(slots)
      .filter(slot => !!(slot.time))
      .filter(slot => !slot.vipOnly || isVipStudent)
      .filter(slot => !slot.privateOnly || isPrivateStudent)
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
        // Тривалість цього конкретного слота (адмін міг розтягнути його на
        // календарі) — вона ж і буде тривалістю запису, якщо учень його обере.
        const slotDurMin = slot.durMin || 60
        const isCustomDur = slotDurMin !== 60
        const durHoursForSlot = slotDurMin / 60
        let totalSurcharge = 0
        for (let coveredMin = slotStartMin; coveredMin < slotStartMin + slotDurMin; coveredMin += 60) {
          const coveredKey = `slot${String(Math.floor(coveredMin/60)).padStart(2,'0')}${String(coveredMin%60).padStart(2,'0')}`
          totalSurcharge += slots[coveredKey]?.surcharge || 0
        }
        const slotMin = slotStartMin
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
        const isSticky = !stickyEnabled || bookingsOnDate.length === 0 || slot.available === false
          ? true
          : bookingsOnDate.some(b => {
              const [bh, bm] = (b.time || '0:0').split(':').map(Number)
              const bStart = bh * 60 + bm
              const bEnd = bStart + (b.durationHours || 1) * 60
              return (stickyMode !== 'after'  && slotStartMin + slotDurMin === bStart) ||
                     (stickyMode !== 'before' && slotStartMin === bEnd)
            })
        return {
          ...slot,
          slotDurMin,
          isCustomDur,
          isSticky,
          // Розтягнутий (нестандартний) слот вже сам собою — цілісний блок під
          // свою тривалість, адмін гарантував що там немає перетинів при
          // створенні: перевірку "чи вільна наступна година" пропускаємо,
          // бо поглинуті документи проміжних годин видалені навмисно.
          lunchBlocked:   isBlockedByLunch(slot.time, durHoursForSlot),
          overlapBlocked: slot.available !== false && (isCustomDur ? false : wouldOverlapTaken(slot.time, durHoursForSlot)),
          isMyBooked:     overlapsMyBooking(dateStr, slot.time, durHoursForSlot),
          isExactlyMine,
          isPartOfMyBooking,
          vipBlocked,
          totalSurcharge,
          totalPrice: slotPrice(baseService, dateStr, durHoursForSlot, totalSurcharge),
        }
      })
      .filter(slot => !slot.lunchBlocked && !slot.overlapBlocked)
      .filter(slot => slot.isSticky || slot.isMyBooked)
      .filter(slot => {
        // Для заблокованих слотів: показуємо лише реальний старт бронювання —
        // один запис на все бронювання, а не окрему позначку на кожну годину
        // всередині нього. Адмінка проставляє явний прапорець bookingStart на
        // момент створення запису (і дозаповнює його заднім числом для старих
        // записів) — довіряємо йому напряму, а не вгадуємо межі по відстані
        // між маркерами: записи впритул один до одного (без проміжку) робили
        // будь-яку евристику-по-відстані принципово ненадійною.
        if (slot.available !== false) return true
        if (slot.bookingStart === false) return false
        // slot.bookingStart === true АБО прапорець ще не проставлений (зовсім
        // стара позначка) — показуємо, щоб точно не сховати реальний запис.
        return true
      })
      .filter(slot => {
        if (!selectedDate || !isSameDay(selectedDate, new Date())) return true
        const [h, m] = (slot.time || '0:0').split(':').map(Number)
        const slotDt = new Date(selectedDate)
        slotDt.setHours(h, m, 0, 0)
        return slotDt > new Date()
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, adminSettings, profile?.isVip, selectedDate, baseService, bookingsData.upcoming])

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
      {ToastEl}

      {/* USER BANNER */}
      <div className="user-banner">
        <button type="button" className="banner-card" aria-label="Скопіювати номер картки" onClick={copyCard}>
          <div className="banner-card-chip" />
          <div className="banner-card-num">••2916</div>
        </button>
        <div className="banner-center">
          <div className="banner-avatar">{getInitials(profile?.name)}</div>
          <div className="banner-info">
            <div className="banner-greet">Привіт,</div>
            <div className="banner-name">{profile?.name?.split(' ')[0] || 'Учень'}</div>
            <div className="banner-tag">
              {effectiveType === 'school' ? '🎓 Автошкола' : '🚙 Приватний'}
            </div>
          </div>
        </div>
        <a href="https://send.monobank.ua/jar/Ad2XWyvEWB" target="_blank" rel="noopener noreferrer" className="banner-jar" aria-label="Банка на каву">
          <span>ПОДЯКА</span>
        </a>
      </div>
      {cardCopied && (
        <div className="card-copied-toast">Номер картки скопійовано</div>
      )}

      {/* 1. ДАТА */}
      <div className="section-title" style={{color:'#ffffff', fontSize:13, textAlign:'center'}}>1. Дата</div>
      <div className="cal-card" onTouchStart={handleCalTouchStart} onTouchEnd={handleCalTouchEnd}>
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
        <div
          key={`${viewMonth.getFullYear()}-${viewMonth.getMonth()}`}
          className={`cal-days ${calSlideDir === 1 ? 'cal-days-spring-next' : calSlideDir === -1 ? 'cal-days-spring-prev' : ''}`}
        >
          {days.map((d, i) => {
            if (!d) return <div key={i} className="cal-day empty"></div>
            const maxDays = adminSettings.calendarOpenDays ?? 30
            const maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + maxDays)
            const disabled = isPast(d) || d > maxDate
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
                onClick={() => { if (!disabled) { setLoading(true); setSelectedDate(d) } }}
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
            2. Час ({selectedDate.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'long' })})
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
                  const isSelected = selectedTime === slot.time || selectedTime2 === slot.time
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
                        ) : isMyQueue ? (
                          <div className="slot-queue">
                            <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>
                            <span className="slot-queue-num">ти {q.position}-й</span>
                          </div>
                        ) : q?.count > 0 ? (
                          <QueueIcons n={q.count} />
                        ) : (
                          // Кроку "Послуга" більше немає — тривалість і ціна тепер
                          // властивості самого слота, тож показуємо їх прямо тут.
                          <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:1}}>
                            <div style={{fontSize:10, color:'#7ed957', fontWeight:700, textShadow: isSelected ? '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' : undefined}}>{formatDur(slot.slotDurMin)}</div>
                            {slot.totalPrice > 0 && (
                              <div style={{fontSize:10, color: slot.totalSurcharge ? '#f7c948' : 'var(--dim)', fontWeight:700, textShadow: isSelected ? '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' : undefined}}>{slot.totalPrice}₴</div>
                            )}
                          </div>
                        )}
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
              <div style={{
                marginTop:8, padding:'8px 12px', borderRadius:10,
                background:'rgba(247,201,72,0.06)', border:'1px solid rgba(247,201,72,0.18)',
                fontSize:11, color:'var(--dim)', textAlign:'center', lineHeight:1.4,
              }}>
                ⏳ Якщо ваш бажаний час зайнятий — ви можете стати на нього в чергу. Як тільки він звільниться, ви зможете записатися.
              </div>
            </>
          )}
        </>
      )}

      {/* CTA */}
      {selectedTime && baseService && (() => {
        const ctaStart = selectedTime2 && timeToMin(selectedTime2) < timeToMin(selectedTime) ? selectedTime2 : selectedTime
        const clickedSlot = slots[`slot${ctaStart.replace(':', '')}`]
        const durationHours = selectedTime2 ? 2 : (clickedSlot?.durMin || 60) / 60
        const startMin = timeToMin(ctaStart)
        let surcharge = 0
        for (let slotMin = startMin; slotMin < startMin + durationHours * 60; slotMin += 60) {
          const key = `slot${String(Math.floor(slotMin/60)).padStart(2,'0')}${String(slotMin%60).padStart(2,'0')}`
          surcharge += slots[key]?.surcharge || 0
        }
        const baseP = Math.round(effectivePrice(baseService, formatDateYMD(selectedDate)) * durationHours)
        const totalPrice = applyDiscount(baseP + surcharge)
        const dateLabel = formatDateYMD(selectedDate).slice(-5).split('-').reverse().join('.')
        const endMin = startMin + durationHours * 60
        const endLabel = `${String(Math.floor(endMin/60)).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`
        const timeLabel = selectedTime2 ? `${ctaStart}–${endLabel}` : ctaStart
        return (
          <div ref={ctaSectionRef}>
            {selectedTime2 && (
              <div style={{
                marginTop:12, padding:'8px 14px', borderRadius:12,
                background:'rgba(126,217,87,0.08)', border:'1px solid rgba(126,217,87,0.3)',
                fontSize:12, color:'#7ed957', textAlign:'center', fontWeight:700,
              }}>
                Об'єднано два слоти — запис на 2 години
              </div>
            )}
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
              {submitting ? 'Записуємо...' : `✓ Записатись ${dateLabel} о ${timeLabel}${totalPrice ? ` · ${totalPrice}₴` : ''}`}
            </button>
          </div>
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
              <div className="dialog-sub">Як тільки слот звільниться — отримаєте сповіщення.</div>
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
                <span className="val">
                  {successData.type === 'booking' && successData.durationHours > 1
                    ? `${successData.time}–${(() => { const m = timeToMin(successData.time) + successData.durationHours * 60; return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}` })()}`
                    : successData.time}
                </span>
              </div>
              <div className="dialog-info-row">
                <span className="lbl">Послуга</span>
                <span className="val">{successData.service?.name || successData.service}</span>
              </div>
              <div className="dialog-info-row" style={{borderTop:'1px solid var(--border)', paddingTop:10, marginTop:4}}>
                <span className="lbl">Тривалість</span>
                <span className="val">{formatDur(successData.durationHours * 60)}</span>
              </div>
              {successData.service?.price > 0 && (
                <div className="dialog-info-row">
                  <span className="lbl">Ціна</span>
                  <span className="val" style={{color:'var(--gold)'}}>
                    {applyDiscount(Math.round(effectivePrice(successData.service, successData.date) * successData.durationHours) + (successData.surcharge || 0))} ₴
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
                : 'Якщо учень скасує — отримаєте сповіщення, урок стане вашим'}
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
              {dialogSlot.surcharge > 0 && (() => {
                const dialogDurHours = (dialogSlot.slotDurMin || dialogSlot.durMin || 60) / 60
                const dialogBaseP = Math.round(effectivePrice(baseService, selectedDate ? formatDateYMD(selectedDate) : '') * dialogDurHours)
                return (
                  <>
                    <div className="dialog-info-row">
                      <span className="lbl">Базова ціна</span>
                      <span className="val">{dialogBaseP}₴</span>
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
                      <span className="val" style={{fontWeight:800}}>{applyDiscount(dialogBaseP + dialogSlot.surcharge)}₴</span>
                    </div>
                  </>
                )
              })()}
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
