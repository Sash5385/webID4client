import { useEffect } from 'react'

// «Туман» увімкнений за замовчуванням; вимикач у Профілі зберігає 'off' у localStorage
export const FOG_KEY = 'id4_fog'
export function isFogOn() {
  try { return localStorage.getItem(FOG_KEY) !== 'off' } catch { return true }
}
export function applyFog(on) {
  document.documentElement.setAttribute('data-fog', on ? 'on' : 'off')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#10141c' : '#1c1d21')
}

export function useTheme() {
  const theme = 'dark'

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
    applyFog(isFogOn())
  }, [])

  return { theme, toggle: () => {}, setTheme: () => {} }
}
