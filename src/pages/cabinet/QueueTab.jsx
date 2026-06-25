import { useState, useEffect } from 'react'
import { subscribeUserQueue, leaveQueue } from '../../firebase/db'
import { formatDateLabel, parseYMD } from '../../utils/date'
import { useToast } from '../../hooks/useToast'

function formatSlotDate(dateStr) {
  try {
    const today = new Date(); today.setHours(0,0,0,0)
    const d = parseYMD(dateStr)
    d.setHours(0,0,0,0)
    const diff = Math.round((d - today) / 86400000)
    if (diff === 0) return 'Сьогодні'
    if (diff === 1) return 'Завтра'
    return formatDateLabel(d)
  } catch { return dateStr }
}

export default function QueueTab({ user }) {
  const { showToast, ToastEl } = useToast()
  const [slots, setSlots] = useState(null)
  const [leaving, setLeaving] = useState(null)

  useEffect(() => {
    if (!user?.uid) return
    return subscribeUserQueue(user.uid, setSlots)
  }, [user?.uid])

  const handleLeave = async (slot) => {
    setLeaving(slot.slotKey)
    try {
      await leaveQueue(user.uid, slot.date, slot.time)
    } catch (e) {
      showToast('Помилка: ' + e.message)
    } finally {
      setLeaving(null)
    }
  }

  if (slots === null) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px 0' }}>
        <div className="spinner" />
      </div>
    )
  }

  const active = slots.filter(s => s.status !== 'booked' && s.status !== 'declined')

  if (active.length === 0) {
    return (
      <div style={{ textAlign:'center', padding:'60px 20px' }}>
        <div style={{ fontSize:40, marginBottom:14 }}>⏳</div>
        <div style={{ fontSize:15, fontWeight:700, color:'var(--text)', marginBottom:6 }}>Черга порожня</div>
        <div style={{ fontSize:13, color:'var(--dim)', lineHeight:1.5 }}>
          Коли слот зайнятий — натисни на нього<br/>і стань у чергу. Ми повідомимо, коли місце звільниться.
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingTop:12, display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ fontSize:12, color:'var(--dim)', marginBottom:2 }}>
        Ти стоїш у черзі на {active.length} {active.length === 1 ? 'слот' : active.length < 5 ? 'слоти' : 'слотів'}
      </div>

      {active.map(slot => {
        const isOffered = slot.status === 'offered'
        const isLeaving = leaving === slot.slotKey
        return (
          <div key={slot.slotKey} style={{
            background: isOffered
              ? 'linear-gradient(135deg,rgba(99,211,120,0.15),rgba(99,211,120,0.05))'
              : 'var(--surface)',
            border: `1.5px solid ${isOffered ? 'rgba(99,211,120,0.5)' : 'var(--border)'}`,
            borderRadius:14,
            padding:'14px 14px 12px',
            display:'flex', flexDirection:'column', gap:10,
          }}>
            {/* Date + time row */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:'var(--text)' }}>
                  {formatSlotDate(slot.date)}
                </div>
                <div style={{ fontSize:13, color:'var(--dim)', marginTop:2 }}>
                  {slot.time}
                </div>
              </div>
              {isOffered ? (
                <div style={{
                  background:'rgba(99,211,120,0.2)', color:'var(--green)',
                  borderRadius:8, padding:'4px 10px',
                  fontSize:11, fontWeight:700,
                }}>Запрошено</div>
              ) : (
                <div style={{
                  background:'rgba(255,255,255,0.06)', color:'var(--dim)',
                  borderRadius:8, padding:'4px 10px',
                  fontSize:11, fontWeight:700,
                }}>Очікую</div>
              )}
            </div>

            {/* Leave button */}
            <button
              onClick={() => handleLeave(slot)}
              disabled={isLeaving}
              style={{
                width:'100%', padding:'10px',
                borderRadius:10, border:'none', cursor:'pointer',
                background:'rgba(239,68,68,0.1)', color:'#f87171',
                fontSize:13, fontWeight:700,
                opacity: isLeaving ? 0.5 : 1,
                transition:'opacity .15s',
              }}
            >
              {isLeaving ? 'Виходжу...' : 'Вийти з черги'}
            </button>
          </div>
        )
      })}
      {ToastEl}
    </div>
  )
}
