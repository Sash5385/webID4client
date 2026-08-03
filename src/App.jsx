import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { auth } from './firebase/config'
import { getUserProfile, createBooking, markSlotsUnavailable, claimSlot } from './firebase/db'
import { requestNotificationPermission, onForegroundMessage, getFirebaseSwReg } from './firebase/push'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useToast } from './hooks/useToast'
import { consumeBackHandler } from './hooks/useBackButton'
import { APP_VERSION } from './version.js'

import Auth from './pages/Auth'
import Cabinet from './pages/Cabinet'
import Landing from './pages/Landing'
import PublicSchedule from './pages/PublicSchedule'

export default function App() {
  const navigate = useNavigate()
  const { showToast, ToastEl } = useToast()
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
      // Data-only push — див. firebase-messaging-sw.js чому без "notification"
      const title = payload.data?.title || 'ID4Drive'
      const body = payload.data?.body || ''
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

  // Апаратна кнопка "назад" (Android): спершу закриває відкриту модалку/шторку,
  // потім робить крок назад по історії застосунку, і лише як останній варіант
  // згортає застосунок (а не закриває його повністю)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle
    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (consumeBackHandler()) return
      if (canGoBack) {
        navigate(-1)
      } else {
        CapacitorApp.minimizeApp().catch(() => CapacitorApp.exitApp())
      }
    }).then(h => { handle = h })
    return () => { handle?.remove() }
  }, [navigate])

  const reloadProfile = async () => {
    if (!auth.currentUser) return
    const p = await getUserProfile(auth.currentUser.uid)
    setProfile(p)
    const pb = pendingBookingRef.current
    if (pb && p) {
      try {
        // Атомарно займаємо слот — міг бути зайнятий поки користувач авторизувався
        const claimed = await claimSlot(pb.date, pb.time)
        if (!claimed) {
          showToast('На жаль, цей слот вже зайняли поки ви авторизувались. Оберіть інший час.')
        } else {
          await createBooking(auth.currentUser.uid, {
            date: pb.date,
            time: pb.time,
            serviceType: p.studentType || pb.serviceType,
            serviceName: (p.studentType || pb.serviceType) === 'school' ? 'Автошкола' : 'Приватний',
            durationHours: pb.duration,
            studentName: p.name,
            phone: p.phone || auth.currentUser.phoneNumber,
          })
          await markSlotsUnavailable(pb.date, pb.time, pb.duration, 30)
        }
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

      {/* Лендінг для авторизованих — перегляд без виходу */}
      <Route path="/home" element={<Landing user={user} profile={profile} />} />

      {/* Кабінет */}
      <Route path="/cabinet/*" element={
        user && profile
          ? <Cabinet user={user} profile={profile} onProfileUpdate={reloadProfile} />
          : <Navigate to="/" replace />
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <a
      href="https://send.monobank.ua/jar/Ad2XWyvEWB"
      target="_blank"
      rel="noopener noreferrer"
      className="jar-fab"
      aria-label="Банка на каву"
    >
      <div className="jar-fab-lid" />
      <div className="jar-fab-body"><span>КАВА</span></div>
    </a>
    {needRefresh && (
      <div className={`update-banner${isUpdating ? ' update-banner--loading' : ''}`} onClick={updateServiceWorker}>
        {isUpdating
          ? <><span className="update-spinner" /> Оновлення...</>
          : <>Доступне оновлення {APP_VERSION} — натисніть щоб оновити</>
        }
      </div>
    )}
    {ToastEl}
    </>
  )
}
