import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase/config'
import { getUserProfile, createBooking, markSlotsUnavailable } from './firebase/db'
import { requestNotificationPermission, onForegroundMessage } from './firebase/push'

import Auth from './pages/Auth'
import Cabinet from './pages/Cabinet'
import Landing from './pages/Landing'
import PublicSchedule from './pages/PublicSchedule'

export default function App() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const pendingBookingRef = useRef(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        const p = await getUserProfile(u.uid)
        setProfile(p)
        requestNotificationPermission(u.uid).catch(() => {})
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  useEffect(() => {
    if (!user) return
    return onForegroundMessage((payload) => {
      const title = payload.notification?.title || 'ID4Drive'
      const body = payload.notification?.body || ''
      const url = payload.data?.url || '/'
      if (Notification.permission !== 'granted') return
      // Використовуємо Service Worker для показу — працює і в foreground і на мобільних
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'id4drive-' + Date.now(),
            requireInteraction: true,
            data: { url },
          })
        }).catch(() => {
          // fallback для старих браузерів
          new Notification(title, { body, icon: '/icon-192.png' })
        })
      } else if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/icon-192.png' })
      }
    })
  }, [user])

  const reloadProfile = async () => {
    if (!auth.currentUser) return
    const p = await getUserProfile(auth.currentUser.uid)
    setProfile(p)
    const pb = pendingBookingRef.current
    if (pb && p) {
      try {
        await createBooking(auth.currentUser.uid, {
          date: pb.date,
          time: pb.time,
          serviceType: p.studentType || pb.serviceType,
          serviceName: (p.studentType || pb.serviceType) === 'school' ? 'Автошкола' : 'Приватний',
          durationHours: pb.duration,
          studentName: p.name,
          phone: p.phone || auth.currentUser.phoneNumber,
          tscCenter: p.tscCenter,
        })
        await markSlotsUnavailable(pb.date, pb.time, pb.duration, 30)
      } catch (e) {
        console.error('Auto-book failed:', e)
      }
      pendingBookingRef.current = null
    }
  }

  const handleBook = (booking) => {
    pendingBookingRef.current = booking
    navigate('/auth')
  }

  if (loading) {
    return (
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'center',
        minHeight:'100vh', background:'var(--bg)'
      }}>
        <div className="spinner" />
      </div>
    )
  }

  return (
    <Routes>
      {/* Лендінг — завжди перший */}
      <Route path="/" element={<Landing user={user} />} />

      {/* Публічний розклад — перед авторизацією */}
      <Route path="/schedule" element={
        user && profile
          ? <Navigate to="/cabinet" replace />
          : <PublicSchedule onBook={handleBook} />
      } />

      {/* Авторизація */}
      <Route path="/auth" element={
        user && profile
          ? <Navigate to="/cabinet" replace />
          : <Auth user={user} profile={profile} onProfileSaved={reloadProfile} />
      } />

      {/* Кабінет */}
      <Route path="/cabinet/*" element={
        user && profile
          ? <Cabinet user={user} profile={profile} />
          : <Navigate to="/" replace />
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
