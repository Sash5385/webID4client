import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackClose } from '../../hooks/useBackButton'
import { submitReview } from '../../firebase/db'
import './BookTab.css'

const STARS = [1, 2, 3, 4, 5]

export default function ReviewModal({ user, profile, booking, onClose, onDone }) {
  useBackClose(true, onClose)
  const [rating, setRating] = useState(5)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setSaving(true)
    setError('')
    try {
      await submitReview(user.uid, booking, {
        rating,
        text: text.trim(),
        studentName: profile?.name || 'Учень',
      })
      onDone()
    } catch (e) {
      setError('Помилка: ' + e.message)
      setSaving(false)
    }
  }

  return createPortal(
    <div className="dialog-backdrop show" onClick={e => e.target.classList.contains('dialog-backdrop') && onClose()}>
      <div className="dialog">
        <div className="dialog-handle" />
        <div className="dialog-icon">⭐</div>
        <div className="dialog-title">Як пройшов урок?</div>
        <div className="dialog-sub">
          {booking.serviceName} · {booking.date}<br />
          Ваш відгук зʼявиться на сайті
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 18 }}>
          {STARS.map(n => (
            <button
              key={n}
              onClick={() => setRating(n)}
              aria-label={`${n} зірок`}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                fontSize: 32, lineHeight: 1,
                color: n <= rating ? '#f7c948' : 'var(--faint)',
              }}
            >★</button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Напишіть кілька слів про урок (необовʼязково)"
          rows={4}
          style={{
            width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--border)',
            background: 'var(--surf-lo)', color: 'var(--text)', padding: 12, fontSize: 14,
            fontFamily: 'inherit', resize: 'none', marginBottom: 14,
          }}
        />

        {error && <div style={{ color: 'var(--accent)', fontSize: 12, textAlign: 'center', marginBottom: 10 }}>{error}</div>}

        <div className="dialog-actions">
          <button className="dialog-btn secondary" onClick={onClose} disabled={saving}>Пізніше</button>
          <button className="dialog-btn primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Надсилаємо...' : 'Залишити відгук'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
