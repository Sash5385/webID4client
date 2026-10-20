import { approachSpeed, followSpeed, gapBetween, stopSpeed } from './ai'
import { smoothstep } from './geometry'
import {
  checkLaneChangeStart, isDangerousLaneChange, isSpeeding,
  LANE_CHANGE_TIME, LANE_X, PED_BLOCK_X,
} from './rules'
import type { AiCar, Input, Lane, Pedestrian, RoadState, SimEvent } from './types'
import { ACC_BRAKE, ACC_COAST, ACC_GAS, CAR_LEN, MAXV } from './units'

const PED_TRIGGER_DIST = 11.5
const PED_START_X = 3.4
const ZONE_HALF = 0.55
const STOP_LINE_OFFSET = 0.95
const SPEEDING_HOLD = 1.2
const SPEEDING_REPEAT = 8

export interface StepResult { state: RoadState; events: SimEvent[] }

export const createRoadState = (opts: {
  crossings: number[]
  finishZ: number
  cars?: Omit<AiCar, 'id'>[]
  peds?: { crossing: number; dir: 1 | -1; speed?: number; delay?: number }[]
}): RoadState => ({
  t: 0,
  player: { x: LANE_X[1], z: 2, v: 0, lane: 1, lc: null, signal: 0, sigInput: 0, sigT: 0, yaw: 0 },
  cars: (opts.cars ?? []).map((c, i) => ({ ...c, id: i })),
  peds: (opts.peds ?? []).map((p, i): Pedestrian => ({
    id: i,
    crossing: p.crossing,
    x: -p.dir * PED_START_X,
    dir: p.dir,
    speed: p.speed ?? 0.55,
    delay: p.delay ?? 0,
    triggered: false,
    started: false,
    done: false,
  })),
  crossings: opts.crossings.map((z) => ({ z })),
  finishZ: opts.finishZ,
  over: false,
  flags: { pedViolated: {}, overSpeedT: 0, lastSpeedingAt: -Infinity },
})

const pedBlocking = (p: Pedestrian): boolean => p.started && !p.done && Math.abs(p.x) < PED_BLOCK_X

const stepAi = (s: RoadState, dt: number): AiCar[] => {
  const { player } = s
  return s.cars.map((c) => {
    // лідер: найближче авто/гравець попереду в тій самій смузі (для гравця — за збігом x)
    let lead: { gap: number; v: number } | null = null
    for (const o of s.cars) {
      if (o === c || o.lane !== c.lane || o.z >= c.z) continue
      const gap = gapBetween(c.z, o.z)
      if (!lead || gap < lead.gap) lead = { gap, v: o.v }
    }
    if (Math.abs(player.x - c.x) < 0.9 && player.z < c.z) {
      const gap = gapBetween(c.z, player.z)
      if (!lead || gap < lead.gap) lead = { gap, v: player.v }
    }
    let desired = followSpeed(c.vmax, lead)
    // пішохід на переході попереду
    for (const cr of s.crossings) {
      const active = s.peds.some((p) => p.crossing === s.crossings.indexOf(cr) && p.triggered && !p.done)
      if (!active) continue
      const dist = c.z - CAR_LEN / 2 - (cr.z + STOP_LINE_OFFSET)
      if (dist > -0.3) desired = Math.min(desired, stopSpeed(dist))
    }
    const v = approachSpeed(c.v, desired, dt)
    return { ...c, v, z: c.z - v * dt }
  })
}

export const step = (prev: RoadState, input: Input, dt: number): StepResult => {
  if (prev.over) return { state: prev, events: [] }
  const events: SimEvent[] = []
  const emit = (type: SimEvent['type']) => events.push({ type, t: prev.t })
  const s: RoadState = {
    ...prev,
    t: prev.t + dt,
    player: { ...prev.player },
    flags: { ...prev.flags, pedViolated: { ...prev.flags.pedViolated } },
  }
  const p = s.player

  // поворотник
  if (input.signal !== p.sigInput) { p.sigInput = input.signal; p.signal = input.signal; p.sigT = 0 }
  else if (p.signal !== 0) p.sigT += dt

  // перестроєння
  if (input.laneChange !== 0 && !p.lc) {
    const dir = input.laneChange
    const issue = checkLaneChangeStart(p, dir)
    if (issue) emit(issue)
    if (issue !== 'lc-out-of-road') {
      const to = (p.lane + dir) as Lane
      if (isDangerousLaneChange(p, to, s.cars)) emit('lc-dangerous')
      p.lc = { from: p.x, to: LANE_X[to], dir, t: 0 }
    }
  }
  if (p.lc) {
    p.lc.t += dt
    const k = smoothstep(p.lc.t / LANE_CHANGE_TIME)
    const prevX = p.x
    p.x = p.lc.from + (p.lc.to - p.lc.from) * k
    p.yaw = -Math.atan2((p.x - prevX) / dt, Math.max(p.v, 0.5)) * 0.6
    if (p.lc.t >= LANE_CHANGE_TIME) {
      p.x = p.lc.to
      p.lane = p.lc.dir === 1 ? 1 : 0
      p.lc = null
      p.yaw = 0
      p.signal = 0
      p.sigT = 0
    }
  }

  // швидкість і положення
  const acc = input.brake ? ACC_BRAKE : input.gas ? ACC_GAS : ACC_COAST
  p.v = Math.min(MAXV, Math.max(0, p.v + acc * dt))
  p.z -= p.v * dt

  // перевищення швидкості
  if (isSpeeding(p.v)) {
    s.flags.overSpeedT += dt
    if (s.flags.overSpeedT > SPEEDING_HOLD && s.t - s.flags.lastSpeedingAt >= SPEEDING_REPEAT) {
      s.flags.lastSpeedingAt = s.t
      emit('speeding')
    }
  } else s.flags.overSpeedT = 0

  // ІІ і пішоходи
  s.cars = stepAi(s, dt)
  s.cars = s.cars.filter((c) => c.z > p.z - 80 && c.z < p.z + 80)
  s.peds = s.peds.map((ped) => {
    const cz = s.crossings[ped.crossing].z
    const n = { ...ped }
    if (!n.triggered && p.z > cz && p.z - cz < PED_TRIGGER_DIST) n.triggered = true
    if (n.triggered && !n.started) {
      n.delay -= dt
      if (n.delay <= 0) n.started = true
    }
    if (n.started && !n.done) {
      n.x += n.dir * n.speed * dt
      if (n.dir * n.x >= PED_START_X) n.done = true
    }
    return n
  })

  // непропуск пішохода (раз на перехід)
  s.crossings.forEach((cr, i) => {
    if (s.flags.pedViolated[i]) return
    const front = p.z - CAR_LEN / 2
    const inZone = front <= cr.z + ZONE_HALF && p.z >= cr.z - ZONE_HALF - CAR_LEN / 2
    if (inZone && s.peds.some((q) => q.crossing === i && pedBlocking(q))) {
      s.flags.pedViolated[i] = true
      emit('ped-not-yielded')
    }
  })

  // аварії
  const hitCar = s.cars.some((c) => Math.abs(c.x - p.x) < 0.5 && Math.abs(c.z - p.z) < 1.0)
  const hitPed = s.peds.some((q) => {
    const cz = s.crossings[q.crossing].z
    return q.started && !q.done && Math.hypot(q.x - p.x, cz - p.z) < 0.45
  })
  if (hitCar || hitPed) { emit('collision'); s.over = true }
  else if (p.z <= s.finishZ) { emit('finish'); s.over = true }

  return { state: s, events }
}
