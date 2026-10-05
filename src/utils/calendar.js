function fmt(date, time, durationHours) {
  const [y, mo, d] = date.split('-')
  const [h, m] = time.split(':').map(Number)
  const startStr = `${y}${mo}${d}T${String(h).padStart(2,'0')}${String(m || 0).padStart(2,'0')}00`
  const endMin = h * 60 + (m || 0) + durationHours * 60
  const endStr = `${y}${mo}${d}T${String(Math.floor(endMin / 60)).padStart(2,'0')}${String(endMin % 60).padStart(2,'0')}00`
  return { startStr, endStr }
}

export function googleCalendarLink(booking) {
  const { date, time, durationHours = 1, serviceName } = booking
  const { startStr, endStr } = fmt(date, time, durationHours)
  const params = new URLSearchParams({
    text: serviceName || 'Урок водіння',
    dates: `${startStr}/${endStr}`,
    details: 'ID4Drive — урок з інструктором',
    location: 'вул. Верховинна, 44',
    ctz: 'Europe/Kyiv',
  })
  return `https://calendar.google.com/calendar/r/eventedit?${params}`
}

export function downloadICS(booking) {
  const { date, time, durationHours = 1, serviceName, id } = booking
  const { startStr, endStr } = fmt(date, time, durationHours)
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ID4Drive//ID4Drive//UK',
    'BEGIN:VEVENT',
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    // Час «плаваючий» (без TZID): календар телефону сам трактує його у місцевому часі.
    `DTSTART:${startStr}`,
    `DTEND:${endStr}`,
    `SUMMARY:${serviceName || 'Урок водіння'}`,
    'DESCRIPTION:ID4Drive — урок з інструктором',
    'LOCATION:вул. Верховинна\\, 44',
    `UID:${id || date + time.replace(':', '')}@id4drive`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    // iOS Safari одразу показує вікно «Додати в Календар» для .ics — без зайвого завантаження
    window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 30000)
    return
  }
  const a = document.createElement('a')
  a.href = url
  a.download = `id4drive-${date}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

// На телефоні кнопка «Google» віддає файл .ics: його відкриття = один тап, календар сам пропонує додати
// урок (форма Google на телефонах губить заповнені поля). На комп'ютері відкривається форма Google.
export function isMobileDevice() {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
export function onGoogleCalendarClick(e, booking) {
  if (!isMobileDevice()) return
  e.preventDefault()
  downloadICS(booking)
}
