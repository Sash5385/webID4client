import { useEffect, useState, useRef } from 'react'

export function useAppUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const waitingWorkerRef = useRef(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const trackWorker = (worker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          waitingWorkerRef.current = worker
          setNeedRefresh(true)
        }
      })
    }

    navigator.serviceWorker.ready.then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorkerRef.current = reg.waiting
        setNeedRefresh(true)
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (newWorker) trackWorker(newWorker)
      })

      reg.update().catch(() => {})
    })

    const onVisible = () => {
      if (!document.hidden) {
        navigator.serviceWorker.ready.then(r => r.update()).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const updateServiceWorker = () => {
    if (isUpdating) return
    setIsUpdating(true)

    const doReload = () => window.location.reload()
    const worker = waitingWorkerRef.current

    if (worker) {
      navigator.serviceWorker.addEventListener('controllerchange', doReload, { once: true })
      worker.postMessage({ type: 'SKIP_WAITING' })
    } else {
      navigator.serviceWorker.getRegistrations().then(regs => {
        const waiting = regs.find(r => r.waiting)
        if (waiting) {
          navigator.serviceWorker.addEventListener('controllerchange', doReload, { once: true })
          waiting.waiting.postMessage({ type: 'SKIP_WAITING' })
        } else {
          doReload()
        }
      })
    }
  }

  return { needRefresh, updateServiceWorker, isUpdating }
}
