import type { MutableRefObject } from 'react'
import type { Input, SignalDir } from '../engine/types'

const btn: React.CSSProperties = {
  flex: 1, minHeight: 56, border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700,
  background: 'rgba(30,32,38,.85)', color: '#fff', touchAction: 'none', userSelect: 'none',
}

export const Controls = ({ input, signal, onSignal }: {
  input: MutableRefObject<Input>; signal: SignalDir; onSignal: (s: SignalDir) => void
}) => {
  const hold = (key: 'gas' | 'brake') => ({
    onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); input.current[key] = true },
    onPointerUp: () => { input.current[key] = false },
    onPointerCancel: () => { input.current[key] = false },
  })
  const toggle = (d: -1 | 1) => onSignal(signal === d ? 0 : d)
  const lc = (d: -1 | 1) => { input.current.laneChange = d }
  const on = (d: -1 | 1): React.CSSProperties => (signal === d ? { background: '#d97706' } : {})
  return (
    <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...btn, ...on(-1) }} onClick={() => toggle(-1)}>◀ Поворотник</button>
        <button style={btn} onClick={() => lc(-1)}>⇦ Перестр.</button>
        <button style={btn} onClick={() => lc(1)}>Перестр. ⇨</button>
        <button style={{ ...btn, ...on(1) }} onClick={() => toggle(1)}>Поворотник ▶</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...btn, background: 'rgba(185,28,28,.9)', minHeight: 72 }} {...hold('brake')}>ГАЛЬМО</button>
        <button style={{ ...btn, background: 'rgba(21,128,61,.9)', minHeight: 72 }} {...hold('gas')}>ГАЗ</button>
      </div>
    </div>
  )
}
