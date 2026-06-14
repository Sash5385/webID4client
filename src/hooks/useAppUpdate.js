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

  useEffect(() => {
    const trigger = () => setNeedRefresh(true)

    // Trigger 1: new SW took control (fires on controllerchange)
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) trigger()
      })
      // Force SW update check so iOS doesn't wait 24h
      navigator.serviceWorker.ready.then(r => r.update()).catch(() => {})
    }

    // Trigger 2: hash check — catches cases where SW didn't update
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

  return { needRefresh, updateServiceWorker: () => window.location.reload() }
}
