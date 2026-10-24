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

// Масштаб інтерфейсу: Мін / Середній / Макс (CSS zoom вмісту кабінету, зберігається в браузері)
export const UI_SCALES = [
  { id: 's', name: 'Мін',     zoom: 0.9 },
  { id: 'm', name: 'Середній', zoom: 1 },
  { id: 'l', name: 'Макс',    zoom: 1.15 },
]
const SCALE_EVENT = 'dp-scale'
export function readScale() {
  try {
    const v = localStorage.getItem('uiScale')
    return UI_SCALES.some(x => x.id === v) ? v : 'm'
  } catch { return 'm' }
}
export function applyUiScale(id) {
  const z = UI_SCALES.find(x => x.id === id)?.zoom || 1
  document.documentElement.style.setProperty('--ui-zoom', String(z)) // застосовується до вмісту кабінету (.cab-content); шапка й нижня панель не змінюються
}
// Збереження й застосування вибору (подія — щоб інші вкладки/компоненти підхопили зміну)
export function setUiScale(id) {
  if (!UI_SCALES.some(x => x.id === id)) return
  applyUiScale(id)
  try { localStorage.setItem('uiScale', id) } catch { /* сховище недоступне */ }
  window.dispatchEvent(new CustomEvent(SCALE_EVENT, { detail: id }))
}

export function useTheme() {
  const theme = 'dark'

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
    applyFog(isFogOn())
    applyUiScale(readScale())
  }, [])

  return { theme, toggle: () => {}, setTheme: () => {} }
}
