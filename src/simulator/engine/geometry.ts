import type { Vec2 } from './types'

export const smoothstep = (p: number): number => {
  const c = Math.min(1, Math.max(0, p))
  return c * c * (3 - 2 * c)
}

/** Обернена до smoothstep (бісекція). */
export const inverseSmoothstep = (y: number, iters = 30): number => {
  const target = Math.min(1, Math.max(0, y))
  let lo = 0
  let hi = 1
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2
    if (smoothstep(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Курс: кут a ↔ вектор (sin a, -cos a). a=0 — на північ (−Z). */
export const headingVec = (a: number): Vec2 => ({ x: Math.sin(a), z: -Math.cos(a) })
export const headingAngle = (hx: number, hz: number): number => Math.atan2(hx, -hz)

/** rotation.y моделі, у якої локальна +X = вперед. */
export const modelRotationY = (hx: number, hz: number): number => Math.atan2(-hz, hx)

export type Bezier = [Vec2, Vec2, Vec2, Vec2]

export const bezierPoint = (b: Bezier, t: number): Vec2 => {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return {
    x: w0 * b[0].x + w1 * b[1].x + w2 * b[2].x + w3 * b[3].x,
    z: w0 * b[0].z + w1 * b[1].z + w2 * b[2].z + w3 * b[3].z,
  }
}

export const bezierDeriv = (b: Bezier, t: number): Vec2 => {
  const u = 1 - t
  const a0 = 3 * u * u
  const a1 = 6 * u * t
  const a2 = 3 * t * t
  return {
    x: a0 * (b[1].x - b[0].x) + a1 * (b[2].x - b[1].x) + a2 * (b[3].x - b[2].x),
    z: a0 * (b[1].z - b[0].z) + a1 * (b[2].z - b[1].z) + a2 * (b[3].z - b[2].z),
  }
}

export type TurnKind = 'right' | 'left' | 'uturn'

const TURN_EXIT: Record<TurnKind, { ex: Vec2; eh: Vec2 }> = {
  right: { ex: { x: 1.6, z: 0.8 }, eh: { x: 1, z: 0 } },
  left: { ex: { x: -1.6, z: -0.8 }, eh: { x: -1, z: 0 } },
  uturn: { ex: { x: -0.8, z: 1.6 }, eh: { x: 0, z: 1 } },
}

/** Крива повороту від поточної точки (курс — на північ) до виїзду з перехрестя. */
export const buildTurnPath = (kind: TurnKind, p0: Vec2): Bezier => {
  const { ex, eh } = TURN_EXIT[kind]
  const d = 0.55 * Math.max(Math.abs(ex.x - p0.x), Math.abs(ex.z - p0.z), 0.6)
  return [
    p0,
    { x: p0.x, z: p0.z - d },
    { x: ex.x - eh.x * d, z: ex.z - eh.z * d },
    ex,
  ]
}

/** Крок по кривій: t += v*dt/|B'(t)|. Повертає нове t (≤1). */
export const advanceOnBezier = (b: Bezier, t: number, v: number, dt: number): number => {
  const d = bezierDeriv(b, t)
  const len = Math.hypot(d.x, d.z) || 1e-6
  return Math.min(1, t + (v * dt) / len)
}

/** Розгортає кут `a` так, щоб він був найближчим до `prev` (безперервність курсу). */
export const unwrapAngle = (a: number, prev: number): number => {
  const tau = Math.PI * 2
  return a + tau * Math.round((prev - a) / tau)
}

/** Перетин відрізків (a1-a2) і (b1-b2); null, якщо не перетинаються. */
export const segmentIntersection = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null => {
  const rx = a2.x - a1.x
  const rz = a2.z - a1.z
  const sx = b2.x - b1.x
  const sz = b2.z - b1.z
  const den = rx * sz - rz * sx
  if (Math.abs(den) < 1e-9) return null
  const qx = b1.x - a1.x
  const qz = b1.z - a1.z
  const t = (qx * sz - qz * sx) / den
  const u = (qx * rz - qz * rx) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a1.x + t * rx, z: a1.z + t * rz }
}

/** Перетин двох ламаних; повертає першу знайдену точку перетину. */
export const polylineIntersection = (a: Vec2[], b: Vec2[]): Vec2 | null => {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const p = segmentIntersection(a[i], a[i + 1], b[j], b[j + 1])
      if (p) return p
    }
  }
  return null
}
