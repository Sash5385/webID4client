import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createLevel1 } from '../engine/scenarios/level1'
import { step } from '../engine/sim'
import type { EventType, Input, RoadState, SignalDir } from '../engine/types'
import { DT, toKmh } from '../engine/units'
import { Controls } from '../ui/Controls'
import { EVENT_TEXT, Hud } from '../ui/Hud'
import { Scene } from '../view/Scene'

type Mode = 'learn' | 'exam'
const MAX_ERRORS = 2 // демонстраційний критерій

export default function SimPage() {
  const [mode, setMode] = useState<Mode | null>(null)
  const [run, setRun] = useState(0)
  if (!mode) {
    return (
      <div style={{ minHeight: '100vh', background: '#1c1d21', color: '#fff', display: 'grid', placeContent: 'center', gap: 12, padding: 16, textAlign: 'center' }}>
        <h2>Тренажер: дорога</h2>
        <button onClick={() => setMode('learn')} style={{ padding: 14, fontSize: 16 }}>Навчання (з підказками)</button>
        <button onClick={() => setMode('exam')} style={{ padding: 14, fontSize: 16 }}>Іспит (без підказок)</button>
      </div>
    )
  }
  return <Run key={run} mode={mode} onRestart={() => setRun((r) => r + 1)} onExit={() => setMode(null)} />
}

function Run({ mode, onRestart, onExit }: { mode: Mode; onRestart: () => void; onExit: () => void }) {
  const learn = mode === 'learn'
  const stateRef = useRef<RoadState>(createLevel1())
  const input = useRef<Input>({ gas: false, brake: false, signal: 0, laneChange: 0 })
  const acc = useRef(0)
  const last = useRef(performance.now())
  const errors = useRef<EventType[]>([])
  const [signal, setSignal] = useState<SignalDir>(0)
  const [hud, setHud] = useState({ kmh: 0, message: '', errors: 0, over: false })

  const tick = useCallback(() => {
    const now = performance.now()
    acc.current += Math.min(0.1, (now - last.current) / 1000)
    last.current = now
    while (acc.current >= DT && !stateRef.current.over) {
      const r = step(stateRef.current, input.current, DT)
      input.current.laneChange = 0
      stateRef.current = r.state
      for (const e of r.events) if (e.type !== 'finish') errors.current.push(e.type)
      if (r.events.length) {
        const e = r.events[r.events.length - 1]
        setHud((h) => ({ ...h, message: learn || e.type === 'collision' || e.type === 'finish' ? EVENT_TEXT[e.type] : h.message }))
      }
      acc.current -= DT
    }
  }, [learn])

  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current
      let message = ''
      if (learn) {
        const near = s.peds.some((p) => p.started && !p.done && Math.abs(s.crossings[p.crossing].z - s.player.z) < 12 && s.player.z > s.crossings[p.crossing].z)
        if (near) message = 'Пішохід на переході — зупиніться'
      }
      setHud((h) => ({ kmh: toKmh(s.player.v), message: message || (h.over ? h.message : h.message), errors: errors.current.length, over: s.over }))
    }, 120)
    return () => clearInterval(id)
  }, [learn])

  const onSignal = (d: SignalDir) => { input.current.signal = d; setSignal(d) }
  useEffect(() => {
    const t = setInterval(() => { if (stateRef.current.player.signal === 0 && input.current.signal !== 0 && !stateRef.current.player.lc) { /* автоскидання у UI */ setSignal(0); input.current.signal = 0 } }, 200)
    return () => clearInterval(t)
  }, [])

  const passed = errors.current.length <= MAX_ERRORS && !errors.current.includes('collision')
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 60, near: 0.1, far: 200 }}>
        <Scene stateRef={stateRef} hint={learn} tick={tick} />
      </Canvas>
      <Hud kmh={hud.kmh} message={hud.message} errors={errors.current.length} showErrors={learn} />
      {learn && <SideHint stateRef={stateRef} />}
      {!hud.over && <Controls input={input} signal={signal} onSignal={onSignal} />}
      {hud.over && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.75)', color: '#fff', display: 'grid', placeContent: 'center', gap: 10, padding: 16, textAlign: 'center' }}>
          <h2>{errors.current.includes('collision') ? 'Аварія' : passed ? 'Склали' : 'Не склали'}</h2>
          <div>Помилок: {errors.current.length}</div>
          <ul style={{ textAlign: 'left' }}>
            {errors.current.map((e, i) => <li key={i}>{EVENT_TEXT[e]}</li>)}
          </ul>
          <button onClick={onRestart} style={{ padding: 12 }}>Ще раз</button>
          <button onClick={onExit} style={{ padding: 12 }}>Меню</button>
        </div>
      )}
    </div>
  )
}

// Червона смуга зліва/справа, якщо в сусідній смузі є авто у вікні −4…+7 u.
function SideHint({ stateRef }: { stateRef: { current: RoadState } }) {
  const [side, setSide] = useState<{ l: boolean; r: boolean }>({ l: false, r: false })
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current
      const near = (lane: 0 | 1) => s.cars.some((c) => c.lane === lane && s.player.z - c.z > -7 && s.player.z - c.z < 4)
      setSide({ l: s.player.lane === 1 && near(0), r: s.player.lane === 0 && near(1) })
    }, 120)
    return () => clearInterval(id)
  }, [stateRef])
  const bar = (on: boolean, left: boolean): React.CSSProperties => ({
    position: 'absolute', top: 0, bottom: 0, [left ? 'left' : 'right']: 0, width: 10,
    background: on ? 'rgba(255,40,40,.8)' : 'transparent', pointerEvents: 'none',
  })
  return <><div style={bar(side.l, true)} /><div style={bar(side.r, false)} /></>
}
