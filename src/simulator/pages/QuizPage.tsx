import { Canvas, useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useMemo, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { buildPath, buildPlan, pointAt, positionOf, type QuizPlan, type QuizScenario } from '../engine/quiz'
import { QUIZ_SCENARIOS } from '../engine/scenarios/quiz'
import { Car } from '../view/Scene'

const COLORS = ['#d9534f', '#e0a800', '#5cb85c', '#8e5ad7']

interface Anim { plan: QuizPlan | null; t: number }

const Box = ({ p, s, c }: { p: [number, number, number]; s: [number, number, number]; c: string }) => (
  <mesh position={p} receiveShadow><boxGeometry args={s} /><meshStandardMaterial color={c} flatShading /></mesh>
)

function QuizCar({ sc, id, idx, anim, pick, order, result }: {
  sc: QuizScenario; id: string; idx: number; anim: MutableRefObject<Anim>; pick: (id: string) => void; order: string[]; result: boolean
}) {
  const car = sc.cars.find((c) => c.id === id)!
  const ref = useRef<THREE.Group>(null)
  const startPath = useMemo(() => buildPath(car.from, car.move), [car])
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const a = anim.current
    let pos = pointAt(startPath, 0)
    const pc = a.plan?.cars.find((c) => c.id === id)
    if (a.plan && pc) {
      const ca = a.plan.collisionAt
      const t = ca !== null && a.t > ca ? ca : a.t
      pos = positionOf(pc, t)
    }
    g.position.set(pos.x, 0, pos.z)
    g.rotation.y = -Math.atan2(pos.hx, -pos.hz)
  })
  const n = order.indexOf(id) + 1
  const right = sc.correctOrder.indexOf(id) + 1
  return (
    <group ref={ref} onClick={() => pick(id)}>
      <Car x={0} z={0} color={COLORS[idx % COLORS.length]} />
      {(n > 0 || result) && (
        <Html center position={[0, 1.2, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{
            minWidth: 26, textAlign: 'center', padding: '2px 8px', borderRadius: 12, color: '#fff', fontWeight: 700, fontFamily: 'system-ui',
            background: result ? (n === right ? '#16a34a' : '#dc2626') : '#2563eb',
          }}>{result && n !== right ? `${n || '—'} → ${right}` : n || right}</div>
        </Html>
      )}
    </group>
  )
}

function Clock({ anim }: { anim: MutableRefObject<Anim> }) {
  useFrame((_, d) => { if (anim.current.plan) anim.current.t += Math.min(d, 0.05) })
  return null
}

export default function QuizPage() {
  const [i, setI] = useState(0)
  const sc = QUIZ_SCENARIOS[i]
  const [order, setOrder] = useState<string[]>([])
  const [checked, setChecked] = useState<QuizPlan | null>(null)
  const [warn, setWarn] = useState('')
  const [score, setScore] = useState(0)
  const anim = useRef<Anim>({ plan: null, t: 0 })

  const pick = (id: string) => {
    if (checked) return
    setWarn('')
    setOrder((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))
  }
  const check = () => {
    if (order.length !== sc.cars.length) { setWarn('Оберіть порядок для всіх машин'); return }
    const plan = buildPlan(sc, order)
    anim.current = { plan, t: 0 }
    setChecked(plan)
    if (plan.correct) setScore((s) => s + 1)
  }
  const next = () => {
    anim.current = { plan: null, t: 0 }
    setChecked(null); setOrder([]); setWarn('')
    setI((x) => (x + 1) % QUIZ_SCENARIOS.length)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#a8d4f0', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui' }}>
      <div style={{ padding: '8px 12px', background: '#1c1d21', color: '#fff', fontSize: 14 }}>
        {sc.theme} · {i + 1}/{QUIZ_SCENARIOS.length} · Правильно: {score}
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 13, 10], fov: 50 }} onCreated={({ camera }) => camera.lookAt(0, 0, 0)}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[6, 12, 4]} intensity={0.9} castShadow />
          <Clock anim={anim} />
          <Box p={[0, -0.12, 0]} s={[60, 0.1, 60]} c="#4f7a3a" />
          <Box p={[0, -0.05, 0]} s={[3.2, 0.1, 40]} c="#3a3d42" />
          <Box p={[0, -0.049, 0]} s={[40, 0.1, 3.2]} c="#3a3d42" />
          {sc.cars.map((c, k) => <QuizCar key={sc.id + c.id} sc={sc} id={c.id} idx={k} anim={anim} pick={pick} order={order} result={!!checked} />)}
          {sc.signs.map((s) => {
            const pos = { S: [2.2, 0, 5], N: [-2.2, 0, -5], W: [-5, 0, 2.2], E: [5, 0, -2.2] }[s.approach] as [number, number, number]
            return (
              <Html key={s.approach} center position={[pos[0], 1, pos[2]]} style={{ pointerEvents: 'none' }}>
                <div style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: s.sign === 'main' ? '#facc15' : '#fff', border: '2px solid #dc2626' }}>
                  {s.sign === 'main' ? 'Головна' : 'Дати дорогу'}
                </div>
              </Html>
            )
          })}
        </Canvas>
        {checked && checked.collisionAt !== null && (
          <div style={{ position: 'absolute', top: 12, left: 0, right: 0, textAlign: 'center' }}>
            <span style={{ background: '#dc2626', color: '#fff', padding: '6px 14px', borderRadius: 8, fontWeight: 700 }}>Зіткнення!</span>
          </div>
        )}
      </div>
      <div style={{ padding: 12, background: '#fff', color: '#111', minHeight: 110 }}>
        {warn && <div style={{ color: '#b45309', marginBottom: 6 }}>{warn}</div>}
        {checked ? (
          <>
            <div style={{ fontWeight: 700 }}>{checked.correct ? 'Правильно' : 'Неправильно'}</div>
            <div style={{ fontSize: 13, margin: '4px 0 8px' }}>{sc.why} <i>({sc.clause})</i></div>
            <button onClick={next} style={{ padding: 12, width: '100%', background: '#1c1d21', color: '#fff', border: 'none', borderRadius: 10 }}>Далі</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, marginBottom: 8 }}>Торкайтесь машин у порядку проїзду (повторний дотик знімає вибір).</div>
            <button onClick={check} style={{ padding: 12, width: '100%', background: '#1c1d21', color: '#fff', border: 'none', borderRadius: 10 }}>Перевірити</button>
          </>
        )}
      </div>
    </div>
  )
}
