import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase/config'
import { getUserProfile, createBooking, markSlotsUnavailable } from './firebase/db'
import { requestNotificationPermission, onForegroundMessage, getFirebaseSwReg } from './firebase/push'
import { useAppUpdate } from './hooks/useAppUpdate'

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
  const { needRefresh, updateServiceWorker, isUpdating } = useAppUpdate()

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
      if ('serviceWorker' in navigator) {
        getFirebaseSwReg().then(reg => {
          if (!reg) return
          reg.showNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'id4drive-notif',
            requireInteraction: true,
            data: { url },
          })
        }).catch(() => {
          new Notification(title, { body, icon: '/icon-192.png' })
        })
      } else {
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
    <>
    <Routes>
      {/* Лендінг — тільки для не авторизованих */}
      <Route path="/" element={
        user && profile
          ? <Navigate to="/cabinet" replace />
          : <Landing user={user} profile={profile} />
      } />

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
    {needRefresh && (
      <div className={`update-banner${isUpdating ? ' update-banner--loading' : ''}`} onClick={updateServiceWorker}>
        {isUpdating
          ? <><span className="update-spinner" /> Оновлення...</>
          : 'Доступне оновлення — натисніть щоб оновити'
        }
      </div>
    )}
    </>
  )
}
