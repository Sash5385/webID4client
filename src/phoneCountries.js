// Країни для полів телефону: код, діапазон цифр національного номера (без коду)
export const COUNTRIES = [
  { iso: 'UA', flag: '🇺🇦', code: '+380', min: 9, max: 9 },
  { iso: 'PL', flag: '🇵🇱', code: '+48', min: 9, max: 9 },
  { iso: 'DE', flag: '🇩🇪', code: '+49', min: 10, max: 11 },
  { iso: 'CZ', flag: '🇨🇿', code: '+420', min: 9, max: 9 },
  { iso: 'SK', flag: '🇸🇰', code: '+421', min: 9, max: 9 },
  { iso: 'MD', flag: '🇲🇩', code: '+373', min: 8, max: 8 },
  { iso: 'RO', flag: '🇷🇴', code: '+40', min: 9, max: 9 },
  { iso: 'GB', flag: '🇬🇧', code: '+44', min: 10, max: 10 },
  { iso: 'US', flag: '🇺🇸', code: '+1', min: 10, max: 10 },
  { iso: 'CA', flag: '🇨🇦', code: '+1', min: 10, max: 10 },
]

export const DEFAULT_COUNTRY = COUNTRIES[0]

export function getCountry(iso) {
  return COUNTRIES.find(c => c.iso === iso) || DEFAULT_COUNTRY
}

// "+380981234567" -> { country, national }. Без "+" — UA і цифри як є.
export function splitPhone(e164) {
  const s = String(e164 || '').trim()
  if (!s.startsWith('+')) return { country: DEFAULT_COUNTRY, national: s.replace(/\D/g, '') }
  const digits = s.slice(1).replace(/\D/g, '')
  let best = null
  for (const c of COUNTRIES) {
    const cd = c.code.slice(1)
    if (digits.startsWith(cd) && (!best || cd.length > best.code.length - 1)) best = c
  }
  if (!best) return { country: DEFAULT_COUNTRY, national: digits }
  return { country: best, national: digits.slice(best.code.length - 1) }
}

export function joinPhone(country, national) {
  const n = String(national || '').replace(/\D/g, '')
  return n ? `${(country || DEFAULT_COUNTRY).code}${n}` : ''
}
