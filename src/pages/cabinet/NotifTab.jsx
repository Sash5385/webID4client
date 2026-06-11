import { useState, useEffect } from 'react'
import { subscribeNotifications, clearNotification, clearAllNotifications } from '../../firebase/db'
import './NotifTab.css'

const TYPE_META = {
  booking_confirmed:   { icon: '✅', label: 'Підтверджено', accent: 'green' },
  booking_cancelled:   { icon: '❌', label: 'Скасовано',    accent: 'red'   },
  booking_rescheduled: { icon: '🔄', label: 'Перенесено',   accent: 'gold'  },
  queue_offer:         { icon: '🎉', label: 'Черга',        accent: 'blue'  },
  slot_freed:          { icon: '🚗', label: 'Слот вільний', accent: 'blue'  },
  system:              { icon: '🔔', label: 'Системне',     accent: 'dim'   },
}

export default function NotifTab({ user, onSeen }) {
  const [notifications, setNotifications] = useState([])

  useEffect(() => {
    if (!user?.uid) return
    return subscribeNotifications(user.uid, items => {
      setNotifications(items)
    })
  }, [user?.uid])

  useEffect(() => {
    if (notifications.length > 0) onSeen?.()
  }, [notifications])

  return (
    <div className="notif-tab fade-up">
      {notifications.length === 0 && (
        <div className="notif-empty">
          <div className="notif-empty-icon">🔔</div>
          <div className="notif-empty-title">Немає сповіщень</div>
          <div className="notif-empty-sub">Тут з'являться сповіщення про уроки</div>
        </div>
      )}
      {notifications.length > 0 && (
        <div className="notif-toolbar">
          <button className="notif-clear-all" onClick={() => clearAllNotifications(user.uid)}>
            Очистити всі
          </button>
        </div>
      )}
      <div className="notif-list">
        {notifications.map(n => {
          const meta = TYPE_META[n.type] || TYPE_META.system
          return (
            <div key={n.id} className={`notif-card notif-accent-${meta.accent}`}>
              <div className="notif-left">
                <div className="notif-icon-wrap">
                  <span className="notif-icon">{meta.icon}</span>
                </div>
              </div>
              <div className="notif-body">
                <div className="notif-header">
                  <span className="notif-title">{n.title}</span>
                  <span className={`notif-badge notif-badge-${meta.accent}`}>{meta.label}</span>
                </div>
                {n.body && <div className="notif-text">{n.body}</div>}
                <div className="notif-time">{n.date} · {n.time}</div>
              </div>
              <button className="notif-dismiss" onClick={() => clearNotification(user.uid, n.id)} aria-label="Видалити">✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
