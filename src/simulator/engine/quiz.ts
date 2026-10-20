import { inverseSmoothstep, polylineIntersection, smoothstep } from './geometry'
import type { Approach, Move, Vec2 } from './types'

export interface QuizCar { id: string; from: Approach; move: Move; you?: boolean; vehicle?: 'car' | 'tram' | 'bus' | 'ambulance' }
export interface QuizScenario {
  id: string
  theme: string
  level: 1 | 2 | 3
  road: 'equal' | 'main-secondary' | 'tjunction' | 'roundabout' | 'light' | 'controller'
  signs: { approach: Approach; sign: string }[]
  cars: QuizCar[]
  /** id машин у порядку проїзду. */
  correctOrder: string[]
  clause: string
  why: string
}

export const DUR = 3.2
export const START_DIST = 3.4
export const COLLISION_DIST = 0.85
const SAMPLES = 40

// Шляхи задаються у системі координат «приїзд з півдня на північ» і обертаються під плече.
const rot = (a: Approach, p: Vec2): Vec2 => {
  switch (a) {
    case 'S': return p
    case 'W': return { x: -p.z, z: p.x }
    case 'N': return { x: -p.x, z: -p.z }
    case 'E': return { x: p.z, z: -p.x }
  }
}

const quad = (a: Vec2, b: Vec2, c: Vec2): Vec2[] =>
  Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const t = i / SAMPLES
    const u = 1 - t
    return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, z: u * u * a.z + 2 * u * t * b.z + t * t * c.z }
  })

const cubic = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2[] =>
  Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const t = i / SAMPLES
    const u = 1 - t
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      z: u * u * u * a.z + 3 * u * u * t * b.z + 3 * u * t * t * c.z + t * t * t * d.z,
    }
  })

export const buildPath = (from: Approach, move: Move): Vec2[] => {
  const s = { x: 0.8, z: START_DIST }
  let pts: Vec2[]
  switch (move) {
    case 'straight': pts = [s, { x: 0.8, z: START_DIST - 12.4 }]; break
    case 'right': pts = quad(s, { x: 0.8, z: 0.8 }, { x: 9, z: 0.8 }); break
    case 'left': pts = quad(s, { x: 0.8, z: -0.8 }, { x: -9, z: -0.8 }); break
    case 'uturn':
      pts = [...cubic(s, { x: 0.8, z: -2.4 }, { x: -0.8, z: -2.4 }, { x: -0.8, z: START_DIST }), { x: -0.8, z: 9 }]
      break
  }
  return pts.map((p) => rot(from, p))
}

export const pathLength = (pts: Vec2[]): number => {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
  return l
}

/** Точка і курс на частці шляху f∈[0,1]. */
export const pointAt = (pts: Vec2[], f: number): { x: number; z: number; hx: number; hz: number } => {
  const total = pathLength(pts)
  let d = Math.min(1, Math.max(0, f)) * total
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
    if (d <= seg || i === pts.length - 1) {
      const k = seg === 0 ? 0 : Math.min(1, d / seg)
      const hx = seg === 0 ? 0 : (pts[i].x - pts[i - 1].x) / seg
      const hz = seg === 0 ? -1 : (pts[i].z - pts[i - 1].z) / seg
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, z: pts[i - 1].z + (pts[i].z - pts[i - 1].z) * k, hx, hz }
    }
    d -= seg
  }
  const e = pts[pts.length - 1]
  return { x: e.x, z: e.z, hx: 0, hz: -1 }
}

/** Частка довжини шляху, на якій лежить точка перетину c (проекція на найближчий відрізок). */
const fractionOf = (pts: Vec2[], c: Vec2): number => {
  const total = pathLength(pts)
  let acc = 0
  let best = { dist: Infinity, f: 0 }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const seg = Math.hypot(dx, dz)
    const k = seg === 0 ? 0 : Math.min(1, Math.max(0, ((c.x - a.x) * dx + (c.z - a.z) * dz) / (seg * seg)))
    const px = a.x + dx * k
    const pz = a.z + dz * k
    const dist = Math.hypot(c.x - px, c.z - pz)
    if (dist < best.dist) best = { dist, f: (acc + seg * k) / total }
    acc += seg
  }
  return best.f
}

export interface PlanCar { id: string; path: Vec2[]; start: number }
export interface QuizPlan {
  cars: PlanCar[]
  /** Момент зіткнення або null. */
  collisionAt: number | null
  collisionPair: [string, string] | null
  /** Чи порядок користувача збігається з правильним. */
  correct: boolean
}

const conflictPoint = (sc: QuizScenario, a: string, b: string): Vec2 | null => {
  const ca = sc.cars.find((c) => c.id === a)!
  const cb = sc.cars.find((c) => c.id === b)!
  return polylineIntersection(buildPath(ca.from, ca.move), buildPath(cb.from, cb.move))
}

export const conflicts = (sc: QuizScenario, a: string, b: string): boolean => conflictPoint(sc, a, b) !== null

export const positionOf = (car: PlanCar, t: number): { x: number; z: number; hx: number; hz: number } =>
  pointAt(car.path, smoothstep((t - car.start) / DUR))

const startsInOrder = (order: string[]): Record<string, number> => {
  const gap = Math.max(0.5, inverseSmoothstep(0.6) * DUR)
  const out: Record<string, number> = {}
  order.forEach((id, i) => { out[id] = i * gap })
  return out
}

export const buildPlan = (sc: QuizScenario, order: string[]): QuizPlan => {
  const rank = (id: string) => sc.correctOrder.indexOf(id)
  const correct = order.length === sc.correctOrder.length && order.every((id, i) => id === sc.correctOrder[i])
  const pathOf = (id: string) => {
    const c = sc.cars.find((x) => x.id === id)!
    return buildPath(c.from, c.move)
  }
  let pair: [string, string] | null = null
  for (let i = 0; i < order.length && !pair; i++) {
    for (let j = i + 1; j < order.length; j++) {
      if (rank(order[j]) < rank(order[i]) && conflicts(sc, order[i], order[j])) { pair = [order[i], order[j]]; break }
    }
  }
  if (!pair) {
    const starts = startsInOrder(order)
    return { cars: order.map((id) => ({ id, path: pathOf(id), start: starts[id] })), collisionAt: null, collisionPair: null, correct }
  }
  const [a, b] = pair
  const c = conflictPoint(sc, a, b)!
  const pa = inverseSmoothstep(fractionOf(pathOf(a), c))
  const pb = inverseSmoothstep(fractionOf(pathOf(b), c))
  const ta = pa * DUR
  const tb = pb * DUR
  const cars: PlanCar[] = [
    { id: a, path: pathOf(a), start: Math.max(0, tb - ta) },
    { id: b, path: pathOf(b), start: Math.max(0, ta - tb) },
  ]
  let collisionAt: number | null = null
  for (let t = 0; t < DUR * 3; t += 1 / 60) {
    const p = positionOf(cars[0], t)
    const q = positionOf(cars[1], t)
    if (Math.hypot(p.x - q.x, p.z - q.z) < COLLISION_DIST) { collisionAt = t; break }
  }
  return { cars, collisionAt, collisionPair: pair, correct }
}
