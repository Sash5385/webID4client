const MONTHS_UA = [
  'Січень','Лютий','Березень','Квітень','Травень','Червень',
  'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'
]
const MONTHS_UA_SHORT = ['Січ','Лют','Бер','Кві','Тра','Чер','Лип','Сер','Вер','Жов','Лис','Гру']
const DAYS_UA = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб']

export function formatDateYMD(date) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function parseYMD(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function getMonthName(monthIndex) {
  return MONTHS_UA[monthIndex]
}

export function getMonthShort(monthIndex) {
  return MONTHS_UA_SHORT[monthIndex]
}

export function getDayName(dayIndex) {
  return DAYS_UA[dayIndex]
}

export function formatDateLabel(date) {
  const d = new Date(date)
  return `${DAYS_UA[d.getDay()]}, ${d.getDate()} ${MONTHS_UA[d.getMonth()]}`
}

export function getMonthGrid(year, month) {
  // Повертає масив днів для відображення в календарі.
  // Сітка завжди починається з понеділка.
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const days = []

  // Скільки пустих клітинок перед першим (Пн=1, Нд=0 → треба зсунути)
  const startWeekday = (first.getDay() + 6) % 7  // 0=Пн
  for (let i = 0; i < startWeekday; i++) days.push(null)

  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d))
  }
  return days
}

export function isSameDay(a, b) {
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

export function isPast(date) {
  const today = new Date()
  today.setHours(0,0,0,0)
  const d = new Date(date)
  d.setHours(0,0,0,0)
  return d < today
}
