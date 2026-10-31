import { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref, push } from 'firebase/database'
import { db } from '../firebase/config'
import { registerBackHandler } from '../hooks/useBackButton'

// 3D-тренажер екзаменаційних маршрутів (статичний файл /trainer/index.html у iframe).
// Тренажер після кожної спроби шле сюди postMessage; зберігаємо в users/{uid}/trainerRuns (лише для авторизованих).
const STR = (v, n) => String(v ?? '').slice(0, n)

export default function Trainer({ user }) {
  const nav = useNavigate()
  const frameRef = useRef(null)

  const goBack = useCallback(() => {
    if (window.history.length > 1) nav(-1)
    else nav('/')
  }, [nav])

  useEffect(() => registerBackHandler(goBack), [goBack])

  useEffect(() => {
    if (!user?.uid) return undefined
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.source !== frameRef.current?.contentWindow) return
      const d = e.data
      if (!d || d.type !== 'route-trainer-result' || d.v !== 1) return
      const run = {
        route: d.route === 1 ? 1 : 7,
        mode: d.mode === 'exam' ? 'exam' : 'learn',
        passed: !!d.passed,
        reason: STR(d.reason, 160),
        time: Math.max(0, Math.min(7200, Number(d.time) || 0)),
        minor: Math.max(0, Math.min(99, Number(d.minor) || 0)),
        faults: Array.isArray(d.faults) ? d.faults.slice(0, 30).map((f) => ({
          code: STR(f.code, 40),
          severity: f.severity === 'serious' ? 'serious' : 'minor',
          message: STR(f.message, 120),
          t: Math.max(0, Math.min(7200, Number(f.t) || 0)),
        })) : [],
        at: Date.now(),
      }
      push(ref(db, `users/${user.uid}/trainerRuns`), run).catch(() => {})
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [user?.uid])

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg, #15171c)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 'calc(8px + env(safe-area-inset-top, 0px)) 12px 8px',
        background: 'rgba(0,0,0,0.35)', color: '#fff', flex: '0 0 auto',
      }}>
        <button onClick={goBack} style={{
          background: 'rgba(255,255,255,0.12)', color: '#fff', border: 0, borderRadius: 10,
          padding: '8px 14px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
        }}>← Назад</button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>3D-тренажер маршрутів</div>
      </div>
      <iframe
        ref={frameRef}
        title="3D-тренажер маршрутів"
        src="/trainer/index.html"
        allow="autoplay"
        style={{ flex: 1, minHeight: 0, width: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}
