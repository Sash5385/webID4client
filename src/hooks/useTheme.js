import { useEffect } from 'react'

export function useTheme() {
  const theme = 'dark'

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1c1d21')
  }, [])

  return { theme, toggle: () => {}, setTheme: () => {} }
}
