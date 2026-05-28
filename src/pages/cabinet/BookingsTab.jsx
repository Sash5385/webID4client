import { cancelBooking } from '../../firebase/db'
import { parseYMD, getMonthShort } from '../../utils/date'
import './BookingsTab.css'

export default function BookingsTab({ user, profile, bookingsData }) {
  const { upcoming, completed, loading } = bookingsData

  const handleCancel = async (booking) => {
    if (!confirm(`Скасувати урок ${booking.date} о ${booking.time}?`)) return
    try {
      await cancelBooking(user.uid, booking.id)
    } catch (e) {
      alert('Помилка: ' + e.message)
    }
  }

  const renderCard = (b, isPast = false) => {
    const d = parseYMD(b.date)
    const endTime = b.time && b.durationHours
      ? `${String(parseInt(b.time) + b.durationHours).padStart(2,'0')}:00`
      : null
    const statusClass = b.status === 'confirmed' ? 'status-confirmed'
      : b.status === 'cancelled' ? 'status-cancelled' : 'status-pending'
    const statusText = b.status === 'confirmed' ? (isPast ? 'Завершено' : 'Підтверджено')
      : b.status === 'cancelled' ? 'Скасовано' : 'Очікує'

    return (
      <div key={b.id} className="booking-card" style={isPast ? {opacity:0.6} : {}}>
        <div className="booking-date">
          <div className="booking-day">{d.getDate()}</div>
          <div className="booking-mon">{getMonthShort(d.getMonth())}</div>
        </div>
        <div className="booking-body">
          <div className="booking-time">
            {b.time}{endTime ? ` — ${endTime}` : ''}
          </div>
          <div className="booking-type">
            {b.serviceType === 'school' ? '🎓' : '🚙'} {b.serviceName} · {b.durationHours || 1} год
          </div>
          <div className="booking-meta">📍 Верховинна, 44</div>
          <div className={`booking-status ${statusClass}`}>{statusText}</div>
        </div>
        {!isPast && b.status !== 'cancelled' && (
          <div className="booking-actions">
            <button className="action-btn" title="Перенести">📅</button>
            <button className="action-btn" title="Скасувати" onClick={() => handleCancel(b)}>✕</button>
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return <div style={{textAlign:'center', padding:'60px'}}><div className="spinner" style={{margin:'0 auto'}}></div></div>
  }

  return (
    <div className="fade-up">
      {upcoming.length === 0 && completed.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-emoji">📅</div>
          <div className="empty-state-title">Поки нема записів</div>
          <div className="empty-state-desc">Перейди на вкладку Запис і вибери час уроку</div>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <div className="section-title">Найближчі</div>
              {upcoming.map(b => renderCard(b))}
            </>
          )}
          {completed.length > 0 && (
            <>
              <div className="section-title">Завершені ({completed.length})</div>
              {completed.slice(0, 10).map(b => renderCard(b, true))}
            </>
          )}
        </>
      )}
    </div>
  )
}
