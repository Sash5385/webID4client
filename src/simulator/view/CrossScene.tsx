import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, type MutableRefObject } from 'react'
import * as THREE from 'three'
import { carPos, lightsAt, LANES, STOP_LINE, ZEBRA_Z, type CrossState, type Light } from '../engine/crossing'
import { Car, useGroupFrame } from './Scene'

const R = 1.6 // половина перехрестя
const ROAD_LEN = 40
const COLORS: Record<Light, string> = { green: '#22c55e', yellow: '#facc15', red: '#ef4444' }

const Box = ({ p, s, c }: { p: [number, number, number]; s: [number, number, number]; c: string }) => (
  <mesh position={p} receiveShadow>
    <boxGeometry args={s} />
    <meshStandardMaterial color={c} flatShading />
  </mesh>
)

const Head = ({ pos, grp, stateRef }: { pos: [number, number, number]; grp: 'ns' | 'ew'; stateRef: MutableRefObject<CrossState> }) => {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: COLORS.red }), [])
  useFrame(() => { mat.color.set(COLORS[lightsAt(stateRef.current.t)[grp]]) })
  return (
    <group position={pos}>
      <Box p={[0, 0.9, 0]} s={[0.06, 1.8, 0.06]} c="#555" />
      <mesh position={[0, 1.9, 0]} material={mat}><boxGeometry args={[0.3, 0.3, 0.3]} /></mesh>
    </group>
  )
}

const Zebra = ({ x, z, rot }: { x: number; z: number; rot: boolean }) => (
  <group position={[x, 0.02, z]} rotation={[0, rot ? Math.PI / 2 : 0, 0]}>
    {Array.from({ length: 6 }, (_, k) => <Box key={k} p={[-1.45 + k * 0.58, 0, 0]} s={[0.34, 0.02, 0.65]} c="#f2f2f2" />)}
  </group>
)

const Dyn = ({ stateRef }: { stateRef: MutableRefObject<CrossState> }) => {
  const player = useGroupFrame((g) => {
    const p = stateRef.current.player
    g.position.set(p.x, 0, p.z)
    g.rotation.y = -p.a
  })
  const carRefs = useMemo(() => Array.from({ length: 16 }, () => ({ current: null as THREE.Group | null })), [])
  const pedA = useGroupFrame((g) => { const q = stateRef.current.peds[0]; g.visible = !q.done; g.position.set(q.x, 0, q.z) })
  const pedB = useGroupFrame((g) => { const q = stateRef.current.peds[1]; g.visible = q.started && !q.done; g.position.set(q.x, 0, q.z) })
  useFrame(() => {
    const cars = stateRef.current.cars
    carRefs.forEach((r, i) => {
      const g = r.current
      if (!g) return
      const c = cars[i]
      g.visible = !!c
      if (!c) return
      const q = carPos(c)
      const h = LANES[c.lane].h
      g.position.set(q.x, 0, q.z)
      g.rotation.y = -Math.atan2(h.x, -h.z)
    })
  })
  return (
    <>
      <group ref={player}><Car x={0} z={0} color="#2563eb" /></group>
      {carRefs.map((r, i) => <group key={i} ref={r}><Car x={0} z={0} color={['#d9534f', '#e0a800', '#5cb85c', '#8e5ad7'][i % 4]} /></group>)}
      {[pedA, pedB].map((r, i) => (
        <group key={i} ref={r}>
          <mesh position={[0, 0.3, 0]}><boxGeometry args={[0.18, 0.55, 0.18]} /><meshStandardMaterial color="#e0463c" flatShading /></mesh>
        </group>
      ))}
    </>
  )
}

const Cam = ({ stateRef }: { stateRef: MutableRefObject<CrossState> }) => {
  const { camera } = useThree()
  useFrame(() => {
    const p = stateRef.current.player
    const hx = Math.sin(p.a)
    const hz = -Math.cos(p.a)
    camera.position.set(p.x - hx * 5 , 2.8, p.z - hz * 5)
    camera.lookAt(p.x + hx * 6, 0.4, p.z + hz * 6)
  })
  return null
}

export const CrossScene = ({ stateRef, tick }: { stateRef: MutableRefObject<CrossState>; tick: () => void }) => {
  useFrame(() => tick())
  return (
    <>
      <color attach="background" args={['#a8d4f0']} />
      <fog attach="fog" args={['#a8d4f0', 22, 70]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[8, 14, 6]} intensity={0.9} castShadow shadow-mapSize={[1024, 1024]} />
      <Box p={[0, -0.12, 0]} s={[120, 0.1, 120]} c="#4f7a3a" />
      <Box p={[0, -0.05, 0]} s={[3.2, 0.1, ROAD_LEN * 2]} c="#3a3d42" />
      <Box p={[0, -0.049, 0]} s={[ROAD_LEN * 2, 0.1, 3.2]} c="#3a3d42" />
      {/* зебри та стоп-лінії по чотирьох плечах */}
      <Zebra x={0} z={ZEBRA_Z} rot={false} /><Zebra x={0} z={-ZEBRA_Z} rot={false} />
      <Zebra x={ZEBRA_Z} z={0} rot /><Zebra x={-ZEBRA_Z} z={0} rot />
      <Box p={[0.8, 0.02, STOP_LINE]} s={[1.5, 0.02, 0.12]} c="#f2f2f2" />
      <Box p={[-0.8, 0.02, -STOP_LINE]} s={[1.5, 0.02, 0.12]} c="#f2f2f2" />
      <Box p={[STOP_LINE, 0.02, -0.8]} s={[0.12, 0.02, 1.5]} c="#f2f2f2" />
      <Box p={[-STOP_LINE, 0.02, 0.8]} s={[0.12, 0.02, 1.5]} c="#f2f2f2" />
      <Head pos={[R + 0.3, 0, R + 0.3]} grp="ns" stateRef={stateRef} />
      <Head pos={[-R - 0.3, 0, -R - 0.3]} grp="ns" stateRef={stateRef} />
      <Head pos={[-R - 0.3, 0, R + 0.3]} grp="ew" stateRef={stateRef} />
      <Head pos={[R + 0.3, 0, -R - 0.3]} grp="ew" stateRef={stateRef} />
      {[[-9, -9], [9, -9], [-9, 9], [9, 9]].map(([x, z], i) => <Box key={i} p={[x, 1.5, z]} s={[6, 3, 6]} c={i % 2 ? '#b98f6a' : '#a9a9b8'} />)}
      <Dyn stateRef={stateRef} />
      <Cam stateRef={stateRef} />
    </>
  )
}
