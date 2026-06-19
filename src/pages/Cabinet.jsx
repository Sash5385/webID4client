import { useState, useEffect, useMemo } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import { useBookings } from '../hooks/useBookings'
import { subscribeQueueOffers, clearQueueOffer, claimQueueOffer, declineQueueOffer, subscribeDirectUnread, markDirectChatRead, subscribeNotifications, subscribeUserQueue } from '../firebase/db'

import BookTab from './cabinet/BookTab'
import BookingsTab from './cabinet/BookingsTab'
import ProgressTab from './cabinet/ProgressTab'
import ProfileTab from './cabinet/ProfileTab'
import ChatTab from './cabinet/ChatTab'
import NotifTab from './cabinet/NotifTab'
import QueueTab from './cabinet/QueueTab'

import { formatDateLabel } from '../utils/date'
import './Cabinet.css'

const TITLES = {
  book: 'Записатись',
  bookings: 'Мої записи',
  progress: 'Прогрес',
  queue: 'Черга',
  chat: 'Чат',
  notifications: 'Повідомлення',
  profile: 'Профіль'
}

export default function Cabinet({ user, profile, onProfileUpdate }) {
  const { theme, toggle } = useTheme()
  const loc = useLocation()
  const nav = useNavigate()
  const bookingsData = useBookings(user?.uid, profile)

  // Визначаємо активну вкладку з URL
  const path = loc.pathname.replace('/cabinet', '').replace('/', '')
  const activeTab = path || 'book'

  // Параметри з push-сповіщення: ?date=2026-06-06&time=12:00
  const notifParams = useMemo(() => {
    const p = new URLSearchParams(loc.search)
    const date = p.get('date')
    const time = p.get('time')
    return date ? { date, time } : null
  }, [loc.search])

  const [userQueue, setUserQueue] = useState([])
  const [queueOffers, setQueueOffers] = useState({})
  const [selectedOffer, setSelectedOffer] = useState(null)
  const [offerSubmitting, setOfferSubmitting] = useState(false)
  const [unreadChat, setUnreadChat] = useState(0)

  const lsKey = user?.uid ? `lastSeenBookingsTs_${user.uid}` : null
  const [lastSeenTs, setLastSeenTs] = useState(() =>
    lsKey ? Number(localStorage.getItem(lsKey) || 0) : 0
  )

  const notifLsKey = user?.uid ? `lastSeenNotifTs_${user.uid}` : null
  const [lastSeenNotifTs, setLastSeenNotifTs] = useState(() =>
    notifLsKey ? Number(localStorage.getItem(notifLsKey) || 0) : 0
  )
  const [allNotifs, setAllNotifs] = useState([])

  const newBookings = useMemo(
    () => bookingsData.upcoming.filter(b => (b.createdAt || 0) > lastSeenTs).length,
    [bookingsData.upcoming, lastSeenTs]
  )

  const unreadNotifs = useMemo(
    () => allNotifs.filter(n => (n.ts || 0) > lastSeenNotifTs).length,
    [allNotifs, lastSeenNotifTs]
  )

  const bellCount = unreadChat + newBookings + unreadNotifs

  const markBookingsSeen = () => {
    if (!lsKey) return
    const now = Date.now()
    localStorage.setItem(lsKey, now)
    setLastSeenTs(now)
  }

  const markNotifsSeen = () => {
    if (!notifLsKey) return
    const now = Date.now()
    localStorage.setItem(notifLsKey, now)
    setLastSeenNotifTs(now)
  }

  useEffect(() => {
    if (!user?.uid) return
    return subscribeDirectUnread(user.uid, setUnreadChat)
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) return
    return subscribeNotifications(user.uid, setAllNotifs)
  }, [user?.uid])

  const handleBellClick = () => {
    if (unreadNotifs > 0) {
      markNotifsSeen()
      switchTab('notifications')
    } else if (unreadChat > 0) {
      if (user?.uid) markDirectChatRead(user.uid)
      switchTab('chat')
    } else {
      markBookingsSeen()
      switchTab('bookings')
    }
  }

  useEffect(() => {
    if (!user?.uid) return
    return subscribeUserQueue(user.uid, slots => {
      setUserQueue(slots.filter(s => s.status !== 'booked' && s.status !== 'declined'))
    })
  }, [user?.uid])

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

  const handleClaimOffer = async () => {
    if (!selectedOffer || !user?.uid) return
    setOfferSubmitting(true)
    try {
      await claimQueueOffer(user.uid, selectedOffer.slotKey, selectedOffer.offer, profile)
      setSelectedOffer(null)
    } catch (e) {
      alert('Помилка: ' + e.message)
    } finally {
      setOfferSubmitting(false)
    }
  }

  const handleDeclineOffer = async () => {
    if (!selectedOffer || !user?.uid) return
    setOfferSubmitting(true)
    try {
      await declineQueueOffer(user.uid, selectedOffer.slotKey, selectedOffer.offer.date, selectedOffer.offer.time)
      setSelectedOffer(null)
    } catch (e) {
      alert('Помилка: ' + e.message)
    } finally {
      setOfferSubmitting(false)
    }
  }

  const switchTab = (tab) => {
    if (tab === 'bookings') markBookingsSeen()
    nav(`/cabinet/${tab === 'book' ? '' : tab}`)
    window.scrollTo(0, 0)
  }

  return (
    <div className="cabinet-page">

      {/* TOP BAR */}
      <header className="cab-topbar">
        <div style={{display:'flex',gap:4}}>
          <button className="cab-icon-btn" onClick={() => nav(-1)} aria-label="Назад">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button className="cab-icon-btn" onClick={() => nav(1)} aria-label="Вперед">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <button className="cab-icon-btn" onClick={() => nav('/home')} aria-label="На головну">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><polyline points="9 21 9 12 15 12 15 21"/></svg>
          </button>
        </div>
        <div className="cab-title">{TITLES[activeTab] || 'Кабінет'}</div>
        <div className="cab-actions">
          <button className="cab-icon-btn" onClick={() => window.location.reload()} aria-label="Оновити">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
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
          <button className="cab-icon-btn" onClick={handleBellClick}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {bellCount > 0 && (
              <div className="badge">{bellCount}</div>
            )}
          </button>
        </div>
      </header>

      {/* QUEUE OFFER BANNERS */}
      {Object.entries(queueOffers).map(([slotKey, offer]) => {
        const minsLeft = Math.max(0, Math.round((offer.until - Date.now()) / 60000))
        return (
          <div key={slotKey} onClick={() => setSelectedOffer({ slotKey, offer })}
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
            <div style={{fontSize:11, fontWeight:700, color:'var(--green)'}}>Підтвердити →</div>
          </div>
        )
      })}

      {/* CONTENT */}
      <div className={`cab-content${activeTab === 'chat' ? ' cab-content--chat' : ''}`}>
        <Routes>
          <Route path="/" element={<BookTab user={user} profile={profile} bookingsData={bookingsData} notifParams={notifParams} />} />
          <Route path="/bookings" element={<BookingsTab user={user} profile={profile} bookingsData={bookingsData} />} />
          <Route path="/progress" element={<ProgressTab user={user} profile={profile} bookingsData={bookingsData} />} />
          <Route path="/queue" element={<QueueTab user={user} />} />
          <Route path="/chat" element={<ChatTab user={user} profile={profile} />} />
          <Route path="/notifications" element={<NotifTab user={user} onSeen={markNotifsSeen} />} />
          <Route path="/profile" element={<ProfileTab user={user} profile={profile} bookingsData={bookingsData} onProfileUpdate={onProfileUpdate} />} />
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
          {newBookings > 0 && (
            <div className="botnav-badge">{newBookings}</div>
          )}
        </button>
        <button className={`botnav-btn ${activeTab === 'queue' ? 'active' : ''}`} onClick={() => switchTab('queue')}>
          <div className="botnav-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9"/>
              <polyline points="12 7 12 12 15 14"/>
            </svg>
          </div>
          <div className="botnav-lbl">Черга</div>
          {userQueue.length > 0 && (
            <div className="botnav-badge">{userQueue.length}</div>
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
          {unreadChat > 0 && (
            <div className="botnav-badge">{unreadChat}</div>
          )}
        </button>
        <button className={`botnav-btn ${activeTab === 'notifications' ? 'active' : ''}`} onClick={() => { markNotifsSeen(); switchTab('notifications') }}>
          <div className="botnav-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
          <div className="botnav-lbl">Сповіщення</div>
          {unreadNotifs > 0 && (
            <div className="botnav-badge">{unreadNotifs}</div>
          )}
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

      {selectedOffer && (() => {
        const { offer } = selectedOffer
        const minsLeft = Math.max(0, Math.round((offer.until - Date.now()) / 60000))
        const dateLabel = formatDateLabel(new Date(offer.date + 'T12:00:00'))
        return (
          <div
            onClick={e => e.target === e.currentTarget && setSelectedOffer(null)}
            style={{
              position:'fixed', inset:0, zIndex:300,
              background:'rgba(0,0,0,0.7)', backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)',
              display:'flex', alignItems:'flex-end', justifyContent:'center',
              cursor:'pointer',
            }}
          >
            <div style={{
              width:'100%', maxWidth:480,
              background:'linear-gradient(180deg,var(--surface),var(--bg))',
              borderRadius:'24px 24px 0 0', padding:'20px 18px 40px',
              boxShadow:'0 -8px 40px rgba(0,0,0,0.5)',
            }}>
              <div style={{width:36,height:4,borderRadius:2,background:'rgba(255,255,255,0.12)',margin:'0 auto 20px'}}/>
              <div style={{
                width:64, height:64, borderRadius:20, margin:'0 auto 16px',
                background:'linear-gradient(165deg,#4ade80,#16a34a)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:30, boxShadow:'0 6px 20px rgba(74,222,128,0.4)',
              }}>🎉</div>
              <div style={{fontSize:18, fontWeight:900, color:'var(--text)', textAlign:'center', marginBottom:6}}>
                Слот зарезервовано!
              </div>
              <div style={{fontSize:13, color:'var(--dim)', textAlign:'center', marginBottom:20}}>
                Підтвердіть запис або відмовтесь від слоту
              </div>
              <div style={{
                background:'var(--surface-hi)', borderRadius:14, overflow:'hidden',
                border:'1px solid var(--border)', marginBottom:20,
              }}>
                {[
                  ['Дата', dateLabel],
                  ['Час', offer.time],
                  ['Залишилось', `${minsLeft} хв`],
                ].map(([lbl, val], i) => (
                  <div key={lbl} style={{
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'12px 16px',
                    borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  }}>
                    <span style={{fontSize:13, color:'var(--dim)'}}>{lbl}</span>
                    <span style={{fontSize:13, fontWeight:700, color: lbl === 'Залишилось' ? 'var(--gold)' : 'var(--text)'}}>{val}</span>
                  </div>
                ))}
              </div>
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                <button
                  onClick={handleDeclineOffer}
                  disabled={offerSubmitting}
                  style={{
                    padding:'14px', borderRadius:14, border:'none', cursor:'pointer',
                    background:'rgba(239,68,68,0.15)', color:'#f87171',
                    fontSize:14, fontWeight:700,
                    opacity: offerSubmitting ? 0.5 : 1,
                  }}
                >Відмовитись</button>
                <button
                  onClick={handleClaimOffer}
                  disabled={offerSubmitting}
                  style={{
                    padding:'14px', borderRadius:14, border:'none', cursor:'pointer',
                    background:'linear-gradient(165deg,#4ade80,#16a34a)', color:'#fff',
                    fontSize:14, fontWeight:700,
                    boxShadow:'0 4px 14px rgba(74,222,128,0.4)',
                    opacity: offerSubmitting ? 0.7 : 1,
                  }}
                >{offerSubmitting ? '...' : '✓ Записатись'}</button>
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
