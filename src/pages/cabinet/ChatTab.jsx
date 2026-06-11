import { useState, useEffect, useRef } from 'react'
import {
  subscribeStudentChat, sendStudentMessage, markDirectChatRead, clearStudentChat,
  subscribeGeneralChat, sendGeneralMessage,
} from '../../firebase/db'
import './ChatTab.css'

// ─── DIRECT CHAT (with instructor) ───────────────────────────────
function DirectChat({ user, profile }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const taRef = useRef(null)

  useEffect(() => {
    if (!user?.uid) return
    markDirectChatRead(user.uid).catch(() => {})
    return subscribeStudentChat(user.uid, setMessages)
  }, [user?.uid])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await sendStudentMessage(user.uid, text.trim())
      setText('')
      taRef.current?.focus()
    } catch {
      alert('Помилка надсилання')
    } finally {
      setSending(false)
    }
  }

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const initials = (profile?.name || 'У').split(' ').map(w => w[0]).slice(0, 2).join('')

  const handleClear = async () => {
    if (!window.confirm('Очистити всю переписку?')) return
    await clearStudentChat(user.uid)
  }

  return (
    <div className="chat-inner fade-up">
      <div className="chat-header">
        <div className="chat-instructor-avatar">🚗</div>
        <div className="chat-instructor-info">
          <div className="chat-instructor-name">Олександр — інструктор</div>
          <div className="chat-instructor-status">Відповідає протягом дня</div>
        </div>
        {messages.length > 0 && (
          <button className="chat-clear-btn" onClick={handleClear} aria-label="Очистити чат">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        )}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <div className="chat-empty-title">Почніть розмову</div>
            <div className="chat-empty-sub">Напишіть інструктору будь-яке питання</div>
          </div>
        )}
        {messages.map(m => {
          const isMe = m.from === 'student'
          const isBroadcast = m.broadcast
          return (
            <div key={m.id} className={`chat-msg-row ${isMe ? 'out' : 'in'}`}>
              {!isMe && <div className="chat-msg-avatar instructor">🚗</div>}
              <div className={`chat-bubble ${isMe ? 'bubble-out' : isBroadcast ? 'bubble-broadcast' : 'bubble-in'}`}>
                {isBroadcast && <div className="bubble-broadcast-label">📢 Оголошення</div>}
                <div className="bubble-text">{m.text}</div>
                <div className="bubble-time">{m.time}</div>
              </div>
              {isMe && <div className="chat-msg-avatar me">{initials}</div>}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-box">
          <textarea
            ref={taRef}
            className="chat-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Напишіть повідомлення…"
            rows={1}
          />
          <button
            className={`chat-send-btn ${text.trim() ? 'active' : ''}`}
            onClick={send}
            disabled={!text.trim() || sending}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── GENERAL CHAT (student community) ────────────────────────────
function GeneralChat({ user, profile }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const taRef = useRef(null)

  useEffect(() => {
    return subscribeGeneralChat(setMessages)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      const name = profile?.name || 'Учень'
      await sendGeneralMessage(user.uid, name, text.trim())
      setText('')
      taRef.current?.focus()
    } catch {
      alert('Помилка надсилання')
    } finally {
      setSending(false)
    }
  }

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const getInitials = name => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('')
  const getHue = uid => [160, 220, 30, 280, 340, 200, 40, 300][((uid || '').charCodeAt(0) || 0) % 8]

  return (
    <div className="chat-inner fade-up">
      <div className="chat-header">
        <div className="chat-general-avatar">👥</div>
        <div className="chat-instructor-info">
          <div className="chat-instructor-name">Загальний чат учнів</div>
          <div className="chat-instructor-status">Спілкуйтесь і обмінюйтесь досвідом</div>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">👥</div>
            <div className="chat-empty-title">Тут ще тихо</div>
            <div className="chat-empty-sub">Будьте першими — напишіть щось!</div>
          </div>
        )}
        {messages.map(m => {
          const isMe = m.uid === user?.uid
          const hue = getHue(m.uid)
          const initials = getInitials(m.name)
          return (
            <div key={m.id} className={`chat-msg-row ${isMe ? 'out' : 'in'}`}>
              {!isMe && (
                <div
                  className="chat-msg-avatar general-user"
                  style={{ background: `linear-gradient(145deg, hsl(${hue},60%,44%), hsl(${(hue+35)%360},70%,28%))` }}
                >
                  {initials}
                </div>
              )}
              <div className={`chat-bubble-wrap ${isMe ? 'wrap-out' : 'wrap-in'}`}>
                {!isMe && <div className="chat-sender-name">{m.name}</div>}
                <div className={`chat-bubble ${isMe ? 'bubble-out' : 'bubble-in'}`}>
                  <div className="bubble-text">{m.text}</div>
                  <div className="bubble-time">{m.time}</div>
                </div>
              </div>
              {isMe && (
                <div className="chat-msg-avatar me">
                  {getInitials(profile?.name)}
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-box">
          <textarea
            ref={taRef}
            className="chat-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Напишіть у загальний чат…"
            rows={1}
          />
          <button
            className={`chat-send-btn ${text.trim() ? 'active' : ''}`}
            onClick={send}
            disabled={!text.trim() || sending}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN CHAT TAB ────────────────────────────────────────────────
export default function ChatTab({ user, profile }) {
  const [tab, setTab] = useState('direct')

  return (
    <div className="chat-tab">
      <div className="chat-tabs">
        <button
          className={`chat-tab-btn ${tab === 'direct' ? 'active' : ''}`}
          onClick={() => setTab('direct')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          Інструктор
        </button>
        <button
          className={`chat-tab-btn ${tab === 'general' ? 'active' : ''}`}
          onClick={() => setTab('general')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Загальний
        </button>
      </div>

      {tab === 'direct' && <DirectChat user={user} profile={profile} />}
      {tab === 'general' && <GeneralChat user={user} profile={profile} />}
    </div>
  )
}
