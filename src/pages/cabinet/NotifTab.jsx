import { useState, useEffect } from 'react'
import { subscribeNotifications, clearNotification, clearAllNotifications } from '../../firebase/db'
import './NotifTab.css'

function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (isToday) return time;
  if (isYesterday) return `вчора ${time}`;
  return `${p(d.getDate())}.${p(d.getMonth()+1)} ${time}`;
}

const TYPE_META = {
  booking_confirmed:   { icon: '✅', label: 'Підтверджено', accent: 'green' },
  booking_cancelled:   { icon: '❌', label: 'Скасовано',    accent: 'red'   },
  booking_noshow:      { icon: '⚠️', label: 'Пропущено',    accent: 'red'   },
  booking_rescheduled: { icon: '🔄', label: 'Перенесено',   accent: 'gold'  },
  queue_offer:         { icon: '🎉', label: 'Черга',        accent: 'blue'  },
  slot_freed:          { icon: '🚗', label: 'Слот вільний', accent: 'blue'  },
  admin_message:       { icon: '📢', label: 'Від інструктора', accent: 'blue' },
  lesson_reminder_day: { icon: '📅', label: 'Завтра урок', accent: 'gold'  },
  reminder:            { icon: '🔔', label: 'Нагадування', accent: 'gold'  },
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
                <div className="notif-time">{n.date ? `${n.date} · ${n.time}` : fmtTs(n.ts)}</div>
              </div>
              <button className="notif-dismiss" onClick={() => clearNotification(user.uid, n.id)} aria-label="Видалити">✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
