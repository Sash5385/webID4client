import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { auth } from './firebase/config'
import { getUserProfile, createBooking, markSlotsUnavailable, claimSlot, unclaimSlot, markFirstLoginIfNew } from './firebase/db'
import { requestNotificationPermission, onForegroundMessage, getFirebaseSwReg } from './firebase/push'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useLicense, isLicenseBlocked } from './hooks/useLicense'
import { useToast } from './hooks/useToast'
import { consumeBackHandler } from './hooks/useBackButton'
import { APP_VERSION } from './version.js'

import Auth from './pages/Auth'
import Cabinet from './pages/Cabinet'
import Landing from './pages/Landing'

// ─── PWA INSTALL PROMPT (пропонуємо зберегти застосунок лише при
// першому вході — раз показали (banner з'явився), більше не пропонуємо,
// незалежно від того, встановив користувач чи закрив). Android/Chrome —
// нативний beforeinstallprompt; iOS Safari його не підтримує, тож для
// iPhone показуємо власну підказку "Поділитися → На екран Домівка".
// У нативному Capacitor-застосунку (вже встановлений) банер не потрібен.
// Окремо від кнопки в футері лендингу (Landing.jsx) — той самий event,
// два незалежні споживачі, показується лише той, що зараз на екрані.
const IOS_UA_RE = /iphone|ipad|ipod/i
function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(() =>
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  )
  useEffect(() => {
    const onBeforeInstall = (e) => { e.preventDefault(); setDeferredPrompt(e) }
    const onInstalled = () => { setInstalled(true); setDeferredPrompt(null) }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  return { deferredPrompt, installed }
}

function InstallBanner() {
  const { deferredPrompt, installed } = useInstallPrompt()
  const ios = IOS_UA_RE.test(window.navigator.userAgent)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('pwa_install_offered') === '1')
  const eligible = !Capacitor.isNativePlatform() && !installed && !dismissed && (deferredPrompt || ios)

  useEffect(() => {
    if (eligible) localStorage.setItem('pwa_install_offered', '1')
  }, [eligible])

  if (!eligible) return null

  const handleInstall = async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice }
    setDismissed(true)
  }

  return (
    <div style={{
      position:'fixed', left:12, right:12, bottom:'calc(env(safe-area-inset-bottom,0px) + 76px)', zIndex:200,
      background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:'12px 14px',
      boxShadow:'0 10px 30px rgba(0,0,0,0.4)',
      display:'flex', alignItems:'center', gap:10,
    }}>
      <div style={{fontSize:24, flexShrink:0}}>📲</div>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:13, fontWeight:800, color:'var(--text)'}}>Встановіть застосунок</div>
        <div style={{fontSize:11, color:'var(--dim)', marginTop:2}}>
          {ios && !deferredPrompt ? 'Поділитися → «На екран Домівка»' : 'Швидкий доступ з головного екрана, без браузера'}
        </div>
      </div>
      {deferredPrompt && (
        <button onClick={handleInstall} style={{
          padding:'8px 14px', borderRadius:10, border:'none', cursor:'pointer',
          fontSize:12, fontWeight:800, color:'#fff', flexShrink:0,
          background:'linear-gradient(145deg,var(--acc-hi),var(--accent))',
        }}>Встановити</button>
      )}
      <button onClick={()=>setDismissed(true)} aria-label="Закрити" style={{
        width:26, height:26, borderRadius:8, border:'none', cursor:'pointer', flexShrink:0,
        background:'rgba(255,255,255,0.06)', color:'var(--dim)', fontSize:14,
      }}>✕</button>
    </div>
  )
}

export default function App() {
  const navigate = useNavigate()
  const { showToast, ToastEl } = useToast()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const license = useLicense()
  const pendingBookingRef = useRef(null)
  const { needRefresh, updateServiceWorker, isUpdating } = useAppUpdate()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        const p = await getUserProfile(u.uid)
        setProfile(p)
        requestNotificationPermission(u.uid).catch(() => {})
        markFirstLoginIfNew(u.uid).catch(() => {})
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
          try {
            await createBooking(auth.currentUser.uid, {
              date: pb.date,
              time: pb.time,
              serviceType: p.studentType || pb.serviceType,
              serviceName: (p.studentType || pb.serviceType) === 'school' ? 'Автошкола' : 'Приватний',
              durationHours: pb.duration,
              studentName: p.name,
              phone: p.phone || auth.currentUser.phoneNumber,
            })
          } catch (createErr) {
            await unclaimSlot(pb.date, pb.time).catch(() => {})
            throw createErr
          }
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
        minHeight:'100vh', background:'var(--bg)',
        paddingTop:'env(safe-area-inset-top, 0px)', paddingBottom:'env(safe-area-inset-bottom, 0px)'
      }}>
        <div className="spinner" />
      </div>
    )
  }

  if (isLicenseBlocked(license)) {
    return (
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'center',
        minHeight:'100vh', background:'var(--bg)', padding:20, textAlign:'center',
        paddingTop:'calc(20px + env(safe-area-inset-top, 0px))', paddingBottom:'calc(20px + env(safe-area-inset-bottom, 0px))'
      }}>
        <div>
          <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
          <p>Сервіс тимчасово недоступний.</p>
          <p>Зверніться до інструктора.</p>
        </div>
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

      {/* Публічний розклад без реєстрації прибрано — спершу реєстрація/вхід */}
      <Route path="/schedule" element={
        user && profile
          ? <Navigate to="/cabinet" replace />
          : <Navigate to="/auth" replace />
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
    {needRefresh && (
      <div className={`update-banner${isUpdating ? ' update-banner--loading' : ''}`} onClick={updateServiceWorker}>
        {isUpdating
          ? <><span className="update-spinner" /> Оновлення...</>
          : <>Доступне оновлення {APP_VERSION} — натисніть щоб оновити</>
        }
      </div>
    )}
    {ToastEl}
    <InstallBanner/>
    </>
  )
}
