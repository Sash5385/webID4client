import { useState, useEffect } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import { useBookings } from '../hooks/useBookings'
import { subscribeQueueOffers, clearQueueOffer } from '../firebase/db'

import BookTab from './cabinet/BookTab'
import BookingsTab from './cabinet/BookingsTab'
import ProgressTab from './cabinet/ProgressTab'
import ProfileTab from './cabinet/ProfileTab'
import ChatTab from './cabinet/ChatTab'

import './Cabinet.css'

const TITLES = {
  book: 'Записатись',
  bookings: 'Мої записи',
  progress: 'Прогрес',
  chat: 'Чат',
  profile: 'Профіль'
}

export default function Cabinet({ user, profile }) {
  const { theme, toggle } = useTheme()
  const loc = useLocation()
  const nav = useNavigate()
  const bookingsData = useBookings(user?.uid)

  // Визначаємо активну вкладку з URL
  const path = loc.pathname.replace('/cabinet', '').replace('/', '')
  const activeTab = path || 'book'

  const [queueOffers, setQueueOffers] = useState({})

  useEffect(() => {
    if (!user?.uid) return
    return subscribeQueueOffers(user.uid, offers => {
      const now = Date.now()
      const valid = Object.fromEntries(
        Object.entries(offers).filter(([, o]) => o.until > now)
      )
      setQueueOffers(valid)
    })
  }, [user?.uid])

  const switchTab = (tab) => {
    nav(`/cabinet/${tab === 'book' ? '' : tab}`)
    window.scrollTo(0, 0)
  }

  return (
    <div className="cabinet-page">

      {/* TOP BAR */}
      <header className="cab-topbar">
        <div className="cab-title">{TITLES[activeTab] || 'Кабінет'}</div>
        <div className="cab-actions">
          <button className="cab-icon-btn" onClick={toggle} aria-label="Тема">
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            )}
          </button>
          <button className="cab-icon-btn" onClick={() => switchTab('bookings')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {(Object.keys(queueOffers).length + bookingsData.upcoming.length) > 0 && (
              <div className="badge">{Object.keys(queueOffers).length + bookingsData.upcoming.length}</div>
            )}
          </button>
        </div>
      </header>

      {/* QUEUE OFFER BANNERS */}
      {Object.entries(queueOffers).map(([slotKey, offer]) => {
        const minsLeft = Math.max(0, Math.round((offer.until - Date.now()) / 60000))
        return (
          <div key={slotKey} onClick={() => { switchTab('book'); clearQueueOffer(user.uid, slotKey) }}
            style={{
              margin:'6px 12px 0', padding:'10px 14px', borderRadius:12, cursor:'pointer',
              background:'linear-gradient(135deg,rgba(99,211,120,0.2),rgba(99,211,120,0.08))',
              border:'1.5px solid rgba(99,211,120,0.5)',
              display:'flex', alignItems:'center', gap:10,
            }}>
            <span style={{fontSize:20}}>🎉</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13, fontWeight:800, color:'var(--green)'}}>Слот зарезервовано для вас!</div>
              <div style={{fontSize:11, color:'var(--dim)', marginTop:2}}>
                {offer.date} о {offer.time} · ще {minsLeft} хв
              </div>
            </div>
            <div style={{fontSize:11, fontWeight:700, color:'var(--green)'}}>Записатись →</div>
          </div>
        )
      })}

      {/* CONTENT */}
      <div className="cab-content">
        <Routes>
          <Route path="/" element={<BookTab user={user} profile={profile} bookingsData={bookingsData} />} />
          <Route path="/bookings" element={<BookingsTab user={user} profile={profile} bookingsData={bookingsData} />} />
          <Route path="/progress" element={<ProgressTab user={user} profile={profile} bookingsData={bookingsData} />} />
          <Route path="/chat" element={<ChatTab user={user} profile={profile} />} />
          <Route path="/profile" element={<ProfileTab user={user} profile={profile} bookingsData={bookingsData} />} />
          <Route path="*" element={<Navigate to="/cabinet" />} />
        </Routes>
      </div>

      {/* BOTTOM NAV */}
      <nav className="botnav">
        <div className="botnav-inner">
        <button className={`botnav-btn ${activeTab === 'book' ? 'active' : ''}`} onClick={() => switchTab('book')}>
          <div className="botnav-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <rect x="3" y="5" width="18" height="16" rx="2"/>
              <path d="M8 3v4M16 3v4M3 10h18"/>
            </svg>
          </div>
          <div className="botnav-lbl">Запис</div>
        </button>
        <button className={`botnav-btn ${activeTab === 'bookings' ? 'active' : ''}`} onClick={() => switchTab('bookings')}>
          <div className="botnav-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>
            </svg>
          </div>
          <div className="botnav-lbl">Записи</div>
          {bookingsData.upcoming.length > 0 && (
            <div className="botnav-badge">{bookingsData.upcoming.length}</div>
          )}
        </button>
        <button className={`botnav-btn ${activeTab === 'progress' ? 'active' : ''}`} onClick={() => switchTab('progress')}>
          <div className="botnav-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="20" x2="4" y2="10"/>
              <line x1="10" y1="20" x2="10" y2="4"/>
              <line x1="16" y1="20" x2="16" y2="14"/>
              <line x1="22" y1="20" x2="2" y2="20"/>
            </svg>
          </div>
          <div className="botnav-lbl">Прогрес</div>
        </button>
        <button className={`botnav-btn ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => switchTab('chat')}>
          <div className="botnav-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div className="botnav-lbl">Чат</div>
        </button>
        <button className={`botnav-btn ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => switchTab('profile')}>
          <div className="botnav-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>
            </svg>
          </div>
          <div className="botnav-lbl">Профіль</div>
        </button>
        </div>
      </nav>

    </div>
  )
}
