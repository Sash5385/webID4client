import { useEffect, useState } from 'react'

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark' || saved === 'light') return saved
    return 'dark'
  })

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#1c1d21' : '#f0f1f5')
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return { theme, toggle, setTheme }
}
