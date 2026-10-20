import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { RoadState } from '../engine/types'
import { CAR_LEN, CAR_WID } from '../engine/units'

const ROAD_W = 4.4

const Box = ({ p, s, c }: { p: [number, number, number]; s: [number, number, number]; c: string }) => (
  <mesh position={p} receiveShadow>
    <boxGeometry args={s} />
    <meshStandardMaterial color={c} flatShading />
  </mesh>
)

export const Car = ({ x, z, yaw = 0, color, signal = 0 }: { x: number; z: number; yaw?: number; color: string; signal?: number }) => (
  <group position={[x, 0.3, z]} rotation={[0, yaw, 0]}>
    {/* локальна +X = вперед; їде по −Z, тому довгий бік вздовж Z */}
    <mesh castShadow>
      <boxGeometry args={[CAR_WID, 0.3, CAR_LEN]} />
      <meshStandardMaterial color={color} flatShading />
    </mesh>
    <mesh position={[0, 0.25, 0.05]} castShadow>
      <boxGeometry args={[CAR_WID * 0.85, 0.22, CAR_LEN * 0.5]} />
      <meshStandardMaterial color="#cfe6f5" flatShading />
    </mesh>
    {signal !== 0 && (
      <mesh position={[signal * CAR_WID * 0.5, 0, -CAR_LEN * 0.5]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshBasicMaterial color="#ffb400" />
      </mesh>
    )}
  </group>
)

const Ped = ({ x, z }: { x: number; z: number }) => (
  <group position={[x, 0.3, z]}>
    <mesh castShadow>
      <boxGeometry args={[0.18, 0.5, 0.18]} />
      <meshStandardMaterial color="#e0463c" flatShading />
    </mesh>
    <mesh position={[0, 0.34, 0]}>
      <boxGeometry args={[0.16, 0.16, 0.16]} />
      <meshStandardMaterial color="#f0c9a0" flatShading />
    </mesh>
  </group>
)

const Road = ({ length, crossings, hint, stateRef }: {
  length: number; crossings: number[]; hint: boolean; stateRef: { current: RoadState }
}) => {
  const mid = -length / 2 + 10
  return (
    <group>
      <Box p={[0, -0.05, mid]} s={[ROAD_W, 0.1, length + 40]} c="#3a3d42" />
      <Box p={[-ROAD_W / 2 - 1.4, 0, mid]} s={[2.8, 0.12, length + 40]} c="#9a9a94" />
      <Box p={[ROAD_W / 2 + 1.4, 0, mid]} s={[2.8, 0.12, length + 40]} c="#9a9a94" />
      <Box p={[0, 0.01, mid]} s={[0.06, 0.02, length + 40]} c="#e8e8e8" />
      <Box p={[0, -0.12, mid]} s={[80, 0.1, length + 80]} c="#4f7a3a" />
      {crossings.map((cz, i) => (
        <group key={cz}>
          {Array.from({ length: 8 }, (_, k) => (
            <Box key={k} p={[-ROAD_W / 2 + 0.3 + k * 0.54, 0.02, cz]} s={[0.34, 0.02, 1.1]} c="#f2f2f2" />
          ))}
          <Box p={[0, 0.02, cz + 0.95]} s={[ROAD_W, 0.02, 0.12]} c="#f2f2f2" />
          {[-1, 1].map((side) => (
            <Box key={side} p={[side * (ROAD_W / 2 + 0.3), 0.6, cz + 1]} s={[0.05, 1.2, 0.05]} c="#888" />
          ))}
          {[-1, 1].map((side) => (
            <Box key={'s' + side} p={[side * (ROAD_W / 2 + 0.3), 1.3, cz + 1]} s={[0.5, 0.5, 0.04]} c="#1d4ed8" />
          ))}
          {hint && <HintZebra stateRef={stateRef} index={i} z={cz} />}
        </group>
      ))}
      <Box p={[0, 0.02, -165 + 0.5]} s={[ROAD_W, 0.02, 0.4]} c="#facc15" />
    </group>
  )
}

const HintZebra = ({ stateRef, index, z }: { stateRef: { current: RoadState }; index: number; z: number }) => {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff2d2d', transparent: true, opacity: 0 }), [])
  useFrame(() => {
    const on = stateRef.current.peds.some((p) => p.crossing === index && p.started && !p.done)
    mat.opacity = on ? 0.45 : 0
  })
  return (
    <mesh position={[0, 0.03, z]} material={mat}>
      <boxGeometry args={[ROAD_W, 0.01, 1.1]} />
    </mesh>
  )
}

const FollowCamera = ({ stateRef }: { stateRef: { current: RoadState } }) => {
  const { camera } = useThree()
  const look = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const p = stateRef.current.player
    camera.position.set(p.x * 0.6, 2.6, p.z + 5.2)
    look.set(p.x * 0.8, 0.5, p.z - 6)
    camera.lookAt(look)
  })
  return null
}

export const Scene = ({ stateRef, hint, tick }: {
  stateRef: { current: RoadState }; hint: boolean; tick: () => void
}) => {
  useFrame(() => tick())
  const s = stateRef.current
  // Список авто/пішоходів перечитується кожен кадр через ref-групи нижче.
  return (
    <>
      <color attach="background" args={['#a8d4f0']} />
      <fog attach="fog" args={['#a8d4f0', 25, 90]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[8, 14, 6]} intensity={0.9} castShadow shadow-mapSize={[1024, 1024]} />
      <Road length={-s.finishZ} crossings={s.crossings.map((c) => c.z)} hint={hint} stateRef={stateRef} />
      <Dynamic stateRef={stateRef} />
      <FollowCamera stateRef={stateRef} />
    </>
  )
}

const CAR_COLORS = ['#d9534f', '#e0a800', '#5cb85c', '#8e5ad7']

const Dynamic = ({ stateRef }: { stateRef: { current: RoadState } }) => {
  const s = stateRef.current
  // Перерисовка: компонент читає ref у useFrame, але для простоти монтуємо фіксований набір.
  const cars = s.cars.map((c) => c.id)
  const peds = s.peds.map((p) => p.id)
  return (
    <>
      {cars.map((id) => <DynCar key={id} id={id} stateRef={stateRef} />)}
      {peds.map((id) => <DynPed key={id} id={id} stateRef={stateRef} />)}
      <DynPlayer stateRef={stateRef} />
    </>
  )
}

const useGroupFrame = (fn: (g: THREE.Group) => void) => {
  const ref = useMemo(() => ({ current: null as THREE.Group | null }), [])
  useFrame(() => { if (ref.current) fn(ref.current) })
  return ref
}

const DynCar = ({ id, stateRef }: { id: number; stateRef: { current: RoadState } }) => {
  const ref = useGroupFrame((g) => {
    const c = stateRef.current.cars.find((x) => x.id === id)
    g.visible = !!c
    if (c) g.position.set(c.x, 0, c.z)
  })
  return <group ref={ref}><Car x={0} z={0} yaw={0} color={CAR_COLORS[id % CAR_COLORS.length]} /></group>
}

const DynPed = ({ id, stateRef }: { id: number; stateRef: { current: RoadState } }) => {
  const ref = useGroupFrame((g) => {
    const s = stateRef.current
    const p = s.peds.find((x) => x.id === id)
    if (!p) return
    g.visible = !p.done
    g.position.set(p.x, 0, s.crossings[p.crossing].z)
  })
  return <group ref={ref}><Ped x={0} z={0} /></group>
}

const DynPlayer = ({ stateRef }: { stateRef: { current: RoadState } }) => {
  const ref = useGroupFrame((g) => {
    const p = stateRef.current.player
    g.position.set(p.x, 0, p.z)
    g.rotation.y = p.yaw
  })
  return <group ref={ref}><Car x={0} z={0} color="#2563eb" /></group>
}
