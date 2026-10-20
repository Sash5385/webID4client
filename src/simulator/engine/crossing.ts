import { approachSpeed, followSpeed, gapBetween, stopSpeed } from './ai'
import {
  advanceOnBezier, bezierDeriv, bezierPoint, buildTurnPath, headingAngle, unwrapAngle, type Bezier, type TurnKind,
} from './geometry'
import type { SignalDir } from './types'
import { ACC_BRAKE, ACC_COAST, ACC_GAS, KM, MAXV } from './units'

export const CYCLE = 19.6
export const STOP_LINE = 2.7
export const ZEBRA_Z = 2.1
const TURN_START_Z = 1.6
const MIN_Z: Record<TurnKind, number> = { right: 1.0, left: -0.2, uturn: -0.3 }
const TURN_SPEED_KMH = 25
const PLAYER_START_Z = 13
const T0 = 11.5

export type Light = 'green' | 'yellow' | 'red'
export interface Lights { ns: Light; ew: Light }

export const lightsAt = (t: number): Lights => {
  const m = ((t + T0) % CYCLE + CYCLE) % CYCLE
  if (m < 7) return { ns: 'green', ew: 'red' }
  if (m < 8.6) return { ns: 'yellow', ew: 'red' }
  if (m < 9.8) return { ns: 'red', ew: 'red' }
  if (m < 16.8) return { ns: 'red', ew: 'green' }
  if (m < 18.4) return { ns: 'red', ew: 'yellow' }
  return { ns: 'red', ew: 'red' }
}

export type CrossEventType =
  | 'red-light' | 'yellow-light' | 'turn-no-signal' | 'turn-late-signal' | 'turn-no-yield'
  | 'turn-fast' | 'ped-not-yielded' | 'turn-late' | 'turn-missed' | 'collision' | 'finish'

export interface CrossEvent { type: CrossEventType; t: number }

export interface CrossInput {
  gas: boolean
  brake: boolean
  signal: SignalDir
  /** Запит повороту (одноразовий). */
  turn: TurnKind | null
}

export interface TrafficLane { h: { x: number; z: number }; off: { x: number; z: number }; grp: 'ns' | 'ew' }
export const LANES: TrafficLane[] = [
  { h: { x: 1, z: 0 }, off: { x: 0, z: 0.8 }, grp: 'ew' },
  { h: { x: -1, z: 0 }, off: { x: 0, z: -0.8 }, grp: 'ew' },
  { h: { x: 0, z: 1 }, off: { x: -0.8, z: 0 }, grp: 'ns' },
]

export interface XCar { id: number; lane: number; u: number; v: number; vmax: number }
export interface XPed { id: 'A' | 'B'; x: number; z: number; started: boolean; done: boolean }

export interface CrossState {
  t: number
  player: {
    x: number; z: number; v: number; a: number
    signal: SignalDir; sigInput: SignalDir; sigT: number
    armed: TurnKind | null
    turn: { kind: TurnKind; bez: Bezier; tt: number } | null
    turnKind: TurnKind | null
  }
  cars: XCar[]
  peds: XPed[]
  nextSpawn: number
  nextId: number
  yellowMayPass: boolean | null
  crossedLine: boolean
  pedViolated: { A: boolean; B: boolean }
  turnFastFlagged: boolean
  over: boolean
  rng: () => number
}

export const carPos = (c: XCar): { x: number; z: number } => {
  const l = LANES[c.lane]
  return { x: l.off.x + l.h.x * c.u, z: l.off.z + l.h.z * c.u }
}

export const createCrossState = (rng: () => number = Math.random): CrossState => ({
  t: 0,
  player: { x: 0.8, z: PLAYER_START_Z, v: 0, a: 0, signal: 0, sigInput: 0, sigT: 0, armed: null, turn: null, turnKind: null },
  cars: [],
  peds: [
    { id: 'A', x: -4, z: ZEBRA_Z, started: true, done: false },
    { id: 'B', x: 0, z: 0, started: false, done: false },
  ],
  nextSpawn: 1,
  nextId: 0,
  yellowMayPass: null,
  crossedLine: false,
  pedViolated: { A: false, B: false },
  turnFastFlagged: false,
  over: false,
  rng,
})

const EXIT_HEADING: Record<TurnKind, { x: number; z: number }> = {
  right: { x: 1, z: 0 }, left: { x: -1, z: 0 }, uturn: { x: 0, z: 1 },
}
const SIGNAL_FOR: Record<TurnKind, SignalDir> = { right: 1, left: -1, uturn: -1 }

export const stepCross = (prev: CrossState, input: CrossInput, dt: number): { state: CrossState; events: CrossEvent[] } => {
  if (prev.over) return { state: prev, events: [] }
  const events: CrossEvent[] = []
  const emit = (type: CrossEventType) => events.push({ type, t: prev.t })
  const s: CrossState = {
    ...prev, t: prev.t + dt, player: { ...prev.player }, pedViolated: { ...prev.pedViolated },
    cars: prev.cars.map((c) => ({ ...c })), peds: prev.peds.map((p) => ({ ...p })),
  }
  const p = s.player
  const lights = lightsAt(s.t)
  const before = lightsAt(prev.t)

  if (input.signal !== p.sigInput) { p.sigInput = input.signal; p.signal = input.signal; p.sigT = 0 }
  else if (p.signal !== 0) p.sigT += dt

  // фіксація можливості проїхати на жовтий
  if (lights.ns === 'yellow' && before.ns !== 'yellow') {
    s.yellowMayPass = p.z - 0.55 - STOP_LINE < (p.v * p.v) / 10 + 0.6
  }

  // запит повороту
  if (input.turn && !p.turn && !p.armed) {
    if (p.z < MIN_Z[input.turn]) emit('turn-late')
    else if (p.z <= TURN_START_Z) startTurn(s, input.turn, emit)
    else p.armed = input.turn
  }
  if (p.armed && !p.turn && p.z <= TURN_START_Z) {
    const k = p.armed
    p.armed = null
    startTurn(s, k, emit)
  }

  // швидкість
  const acc = input.brake ? ACC_BRAKE : input.gas ? ACC_GAS : ACC_COAST
  p.v = Math.min(MAXV, Math.max(0, p.v + acc * dt))

  if (p.turn) {
    if (p.turn.tt >= 1) {
      const h = EXIT_HEADING[p.turn.kind]
      p.x += h.x * p.v * dt
      p.z += h.z * p.v * dt
    } else {
      p.turn.tt = advanceOnBezier(p.turn.bez, p.turn.tt, p.v, dt)
      const pt = bezierPoint(p.turn.bez, p.turn.tt)
      const d = bezierDeriv(p.turn.bez, p.turn.tt)
      p.x = pt.x; p.z = pt.z
      p.a = unwrapAngle(headingAngle(d.x, d.z), p.a)
    }
    if (!s.turnFastFlagged && p.v * KM > TURN_SPEED_KMH) { s.turnFastFlagged = true; emit('turn-fast') }
  } else {
    p.z -= p.v * dt
  }

  // стоп-лінія
  const front = p.turn ? null : p.z - 0.55
  if (!s.crossedLine && front !== null && front < STOP_LINE) {
    s.crossedLine = true
    if (lights.ns === 'red') emit('red-light')
    else if (lights.ns === 'yellow' && s.yellowMayPass === false) emit('yellow-light')
  }

  // пішоходи
  const pa = s.peds[0]
  if (!pa.done) { pa.x += 0.7 * dt; if (pa.x >= 4) pa.done = true }
  const pb = s.peds[1]
  const kind = p.turnKind ?? p.armed
  if (!pb.started && !pb.done && lights.ns === 'green' && (kind === 'right' || kind === 'left')) {
    pb.started = true
    const side = kind === 'right' ? 1 : -1
    pb.x = side * ZEBRA_Z; pb.z = -4
  }
  if (pb.started && !pb.done) { pb.z += 0.55 * dt; if (pb.z >= 4) pb.done = true }
  const aBlock = !pa.done && Math.abs(pa.x) < 2
  const bBlock = pb.started && !pb.done && Math.abs(pb.z) < 2
  if (!s.pedViolated.A && aBlock && Math.abs(p.z - ZEBRA_Z) < 0.55 + 0.55 && p.x > -1.6 && p.x < 1.6) { s.pedViolated.A = true; emit('ped-not-yielded') }
  if (!s.pedViolated.B && bBlock && Math.abs(p.x - pb.x) < 0.55 + 0.55 && p.turn) { s.pedViolated.B = true; emit('ped-not-yielded') }
  const hitPed = [pa, pb].some((q) => (q.id === 'A' ? !q.done : q.started && !q.done) && Math.hypot(q.x - p.x, q.z - p.z) < 0.45)

  // трафік
  if (s.t >= s.nextSpawn) {
    s.nextSpawn = s.t + 2.2
    if (s.rng() < 0.75) {
      const lane = Math.floor(s.rng() * LANES.length)
      const vmax = 2.8 + s.rng() * 0.8
      const clear = !s.cars.some((c) => c.lane === lane && c.u < -12)
      if (clear) s.cars.push({ id: s.nextId++, lane, u: -16, v: vmax, vmax })
    }
  }
  s.cars = s.cars.map((c) => {
    const grp = LANES[c.lane].grp
    const light = lights[grp]
    let desired = c.vmax
    const dLine = -STOP_LINE - (c.u + 0.55)
    const mustStop = light === 'red' || (light === 'yellow' && dLine > (c.v * c.v) / 8 + 0.3)
    if (mustStop && dLine > -0.2) desired = Math.min(desired, stopSpeed(dLine))
    const lead = s.cars.filter((o) => o.lane === c.lane && o.u > c.u).sort((x, y) => x.u - y.u)[0]
    if (lead) desired = Math.min(desired, followSpeed(c.vmax, { gap: gapBetween(lead.u, c.u), v: lead.v }))
    const v = approachSpeed(c.v, desired, dt)
    return { ...c, v, u: c.u + v * dt }
  }).filter((c) => c.u < 18)

  // зіткнення
  const hitCar = s.cars.some((c) => { const q = carPos(c); return Math.hypot(q.x - p.x, q.z - p.z) < 0.75 })
  if (hitCar || hitPed) { emit('collision'); s.over = true; return { state: s, events } }

  // завершення
  const k = p.turnKind
  if (k && p.turn) {
    const done = k === 'right' ? p.x > 7 : k === 'left' ? p.x < -7 : p.z > 8
    if (done) { emit('finish'); s.over = true }
  } else if (!p.turn && p.z < -8) { emit('turn-missed'); s.over = true }
  return { state: s, events }
}

function startTurn(s: CrossState, kind: TurnKind, emit: (t: CrossEventType) => void): void {
  const p = s.player
  if (p.signal !== SIGNAL_FOR[kind]) emit('turn-no-signal')
  else if (p.sigT < 1) emit('turn-late-signal')
  if (kind === 'left' || kind === 'uturn') {
    const bad = s.cars.some((c) => c.lane === 2 && c.u > -9 && c.u < 1.2 && c.v > 0.3)
    if (bad) emit('turn-no-yield')
  }
  p.turn = { kind, bez: buildTurnPath(kind, { x: p.x, z: p.z }), tt: 0 }
  p.turnKind = kind
  p.signal = 0
  p.sigInput = p.sigInput // UI скидає сам
}
