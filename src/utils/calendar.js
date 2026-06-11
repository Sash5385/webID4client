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
    action: 'TEMPLATE',
    text: serviceName || 'Урок водіння',
    dates: `${startStr}/${endStr}`,
    details: 'ID4Drive — урок з інструктором',
    location: 'вул. Верховинна, 44',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

export function downloadICS(booking) {
  const { date, time, durationHours = 1, serviceName, id } = booking
  const { startStr, endStr } = fmt(date, time, durationHours)
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ID4Drive//ID4Drive//UK',
    'BEGIN:VEVENT',
    `DTSTART;TZID=Europe/Kyiv:${startStr}`,
    `DTEND;TZID=Europe/Kyiv:${endStr}`,
    `SUMMARY:${serviceName || 'Урок водіння'}`,
    'DESCRIPTION:ID4Drive — урок з інструктором',
    'LOCATION:вул. Верховинна\\, 44',
    `UID:${id || date + time.replace(':', '')}@id4drive`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `id4drive-${date}.ics`
  a.click()
  URL.revokeObjectURL(url)
}
