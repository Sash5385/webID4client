import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createCrossState, stepCross, type CrossEventType, type CrossInput, type CrossState } from '../engine/crossing'
import type { SignalDir } from '../engine/types'
import { DT, toKmh } from '../engine/units'
import { SimAudio } from '../view/audio'
import { CrossScene } from '../view/CrossScene'

const TEXT: Record<CrossEventType, string> = {
  'red-light': 'Проїзд на червоний', 'yellow-light': 'Проїзд на жовтий, коли можна було зупинитись',
  'turn-no-signal': 'Поворот без поворотника', 'turn-late-signal': 'Запізнілий поворотник',
  'turn-no-yield': 'Не поступились зустрічному', 'turn-fast': 'Завелика швидкість у повороті',
  'ped-not-yielded': 'Не пропустили пішохода', 'turn-late': 'Занадто пізно для повороту',
  'turn-missed': 'Поворот не виконано', collision: 'Аварія', finish: 'Поворот виконано',
}
const MAX_ERRORS = 2

const b: React.CSSProperties = { flex: 1, minHeight: 52, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, background: 'rgba(30,32,38,.85)', color: '#fff', touchAction: 'none' }

export default function CrossingPage() {
  const [run, setRun] = useState(0)
  return <Run key={run} onRestart={() => setRun((r) => r + 1)} />
}

function Run({ onRestart }: { onRestart: () => void }) {
  const stateRef = useRef<CrossState>(createCrossState())
  const input = useRef<CrossInput>({ gas: false, brake: false, signal: 0, turn: null })
  const acc = useRef(0)
  const last = useRef(performance.now())
  const log = useRef<CrossEventType[]>([])
  const audio = useRef<SimAudio>(new SimAudio())
  const [muted, setMuted] = useState(false)
  useEffect(() => { const a = audio.current; return () => a.dispose() }, [])
  const [signal, setSignal] = useState<SignalDir>(0)
  const [hud, setHud] = useState({ kmh: 0, over: false, msg: '' })

  const tick = useCallback(() => {
    const now = performance.now()
    acc.current += Math.min(0.1, (now - last.current) / 1000)
    last.current = now
    while (acc.current >= DT && !stateRef.current.over) {
      const r = stepCross(stateRef.current, input.current, DT)
      input.current.turn = null
      stateRef.current = r.state
      for (const e of r.events) { log.current.push(e.type); if (e.type === 'collision') audio.current.crash(); else if (e.type !== 'finish') audio.current.beep() }
      acc.current -= DT
    }
    const pl = stateRef.current.player
    audio.current.update(pl.v, input.current.gas, input.current.brake, pl.signal !== 0, 1 / 60)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current
      const l = log.current
      if (s.player.turn && input.current.signal !== 0) { input.current.signal = 0; setSignal(0) }
      setHud({ kmh: toKmh(s.player.v), over: s.over, msg: l.length ? TEXT[l[l.length - 1]] : '' })
    }, 120)
    return () => clearInterval(id)
  }, [])

  const hold = (key: 'gas' | 'brake') => ({
    onPointerDown: (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); input.current[key] = true },
    onPointerUp: () => { input.current[key] = false },
    onPointerCancel: () => { input.current[key] = false },
  })
  const sig = (d: -1 | 1) => { const n: SignalDir = signal === d ? 0 : d; input.current.signal = n; setSignal(n) }
  const errs = log.current.filter((e) => e !== 'finish')
  const ok = log.current.includes('finish') && errs.length <= MAX_ERRORS && !errs.includes('collision')

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }} onPointerDown={() => audio.current.unlock()}>
      <button onClick={(e) => { e.stopPropagation(); audio.current.unlock(); audio.current.setMuted(!muted); setMuted(!muted) }} style={{ position: 'absolute', top: 44, right: 8, zIndex: 2, width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 18 }}>{muted ? '🔇' : '🔊'}</button>
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 60, near: 0.1, far: 200 }}>
        <CrossScene stateRef={stateRef} tick={tick} />
      </Canvas>
      <div style={{ position: 'absolute', top: 8, left: 8, right: 8, color: '#fff', fontFamily: 'system-ui', pointerEvents: 'none' }}>
        <b style={{ fontSize: 26, textShadow: '0 1px 3px #000' }}>{Math.round(hud.kmh)} км/г</b>
        {hud.msg && <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(0,0,0,.6)', borderRadius: 8, fontSize: 14 }}>{hud.msg}</div>}
      </div>
      {!hud.over && (
        <div style={{ position: 'absolute', left: 8, right: 8, bottom: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...b, background: signal === -1 ? '#d97706' : b.background }} onClick={() => sig(-1)}>◀ Поворотник</button>
            <button style={b} onClick={() => { input.current.turn = 'left' }}>Ліво</button>
            <button style={b} onClick={() => { input.current.turn = 'uturn' }}>Розворот</button>
            <button style={b} onClick={() => { input.current.turn = 'right' }}>Право</button>
            <button style={{ ...b, background: signal === 1 ? '#d97706' : b.background }} onClick={() => sig(1)}>Поворотник ▶</button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...b, background: 'rgba(185,28,28,.9)', minHeight: 72 }} {...hold('brake')}>ГАЛЬМО</button>
            <button style={{ ...b, background: 'rgba(21,128,61,.9)', minHeight: 72 }} {...hold('gas')}>ГАЗ</button>
          </div>
        </div>
      )}
      {hud.over && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.75)', color: '#fff', display: 'grid', placeContent: 'center', gap: 10, padding: 16, textAlign: 'center' }}>
          <h2>{ok ? 'Склали' : 'Не склали'}</h2>
          <ul style={{ textAlign: 'left' }}>{log.current.map((e, i) => <li key={i}>{TEXT[e]}</li>)}</ul>
          <button onClick={onRestart} style={{ padding: 12 }}>Ще раз</button>
        </div>
      )}
    </div>
  )
}
