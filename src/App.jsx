import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from './firebase/config'
import { getUserProfile } from './firebase/db'
import { requestNotificationPermission, onForegroundMessage } from './firebase/push'

import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Cabinet from './pages/Cabinet'
import BookPage from './pages/BookPage'

export default function App() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.svg' })
      }
    })
  }, [user])

  const reloadProfile = async () => {
    if (auth.currentUser) {
      const p = await getUserProfile(auth.currentUser.uid)
      setProfile(p)
    }
  }

  if (loading) {
    return (
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'center',
        minHeight:'100vh', background:'var(--bg)', color:'var(--text)'
      }}>
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Landing user={user} />} />
      <Route path="/book" element={
        <BookPage user={user} profile={profile} onProfileSaved={reloadProfile} />
      } />
      <Route path="/auth" element={
        user && profile ? <Navigate to="/cabinet" /> : <Auth user={user} profile={profile} onProfileSaved={reloadProfile} />
      } />
      <Route path="/cabinet/*" element={
        user && profile ? <Cabinet user={user} profile={profile} /> : <Navigate to="/book" />
      } />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  )
}
