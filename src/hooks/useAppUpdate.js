import { useEffect, useState } from 'react'

export function useAppUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const hadController = !!navigator.serviceWorker.controller
    const onControllerChange = () => {
      if (hadController) setNeedRefresh(true)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    navigator.serviceWorker.ready.then(r => r.update()).catch(() => {})

    const onVisible = () => {
      if (!document.hidden) {
        navigator.serviceWorker.ready.then(r => r.update()).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const updateServiceWorker = () => {
    if (isUpdating) return
    setIsUpdating(true)
    window.location.reload()
  }

  return { needRefresh, updateServiceWorker, isUpdating }
}
