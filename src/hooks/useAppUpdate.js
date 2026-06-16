import { useEffect, useState } from 'react'

async function hasNewVersion() {
  try {
    const res = await fetch('/index.html?_=' + Date.now(), { cache: 'no-store' })
    const html = await res.text()
    const remoteMatch = html.match(/\/assets\/index-([^"]+)\.js/)
    if (!remoteMatch) return false
    const currentScript = document.querySelector('script[src*="/assets/index-"]')
    if (!currentScript) return false
    const localMatch = currentScript.src.match(/\/assets\/index-([^"]+)\.js/)
    if (!localMatch) return false
    return remoteMatch[1] !== localMatch[1]
  } catch {
    return false
  }
}

export function useAppUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    const trigger = () => setNeedRefresh(true)

    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) trigger()
      })
      navigator.serviceWorker.ready.then(r => r.update()).catch(() => {})
    }

    const check = async () => { if (await hasNewVersion()) trigger() }
    check()
    const timer = setInterval(check, 60_000)
    const onVisible = () => { if (!document.hidden) check() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const updateServiceWorker = async () => {
    if (isUpdating) return
    setIsUpdating(true)
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      regs.forEach(reg => {
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      })
    }
    setTimeout(() => window.location.reload(), 300)
  }

  return { needRefresh, updateServiceWorker, isUpdating }
}
