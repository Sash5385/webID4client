export function formatPhone(raw) {
  // +380989225442 → +380 98 922 5442
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('380') && digits.length === 12) {
    return `+380 ${digits.slice(3,5)} ${digits.slice(5,8)} ${digits.slice(8,12)}`
  }
  return raw
}

export function normalizePhone(input) {
  // Приймає що завгодно, повертає +380XXXXXXXXX або null
  const digits = input.replace(/\D/g, '')
  if (digits.length === 9) return `+380${digits}`  // 989225442
  if (digits.length === 10 && digits.startsWith('0')) return `+380${digits.slice(1)}`  // 0989225442
  if (digits.length === 12 && digits.startsWith('380')) return `+${digits}`
  return null
}

export function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function pluralize(n, forms) {
  // pluralize(2, ['учень', 'учні', 'учнів']) → 'учні'
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}
