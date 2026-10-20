import { describe, expect, it } from 'vitest'
import {
  advanceOnBezier, bezierDeriv, bezierPoint, buildTurnPath, createRoadState,
  followSpeed, headingAngle, headingVec, inverseSmoothstep, isDangerousLaneChange,
  modelRotationY, polylineIntersection, smoothstep, step, stopSpeed, unwrapAngle,
  DT, KM, type AiCar, type Input, type RoadState, type SimEvent,
} from '..'

const idle: Input = { gas: false, brake: false, signal: 0, laneChange: 0 }

const run = (s: RoadState, seconds: number, inp: (t: number) => Input): { s: RoadState; ev: SimEvent[] } => {
  const ev: SimEvent[] = []
  let st = s
  for (let t = 0; t < seconds && !st.over; t += DT) {
    const r = step(st, inp(t), DT)
    st = r.state
    ev.push(...r.events)
  }
  return { s: st, ev }
}
const types = (ev: SimEvent[]) => ev.map((e) => e.type)

describe('geometry', () => {
  it('smoothstep and its inverse', () => {
    expect(smoothstep(0)).toBe(0)
    expect(smoothstep(1)).toBe(1)
    expect(smoothstep(0.5)).toBeCloseTo(0.5)
    for (const y of [0.1, 0.25, 0.6, 0.9]) expect(smoothstep(inverseSmoothstep(y))).toBeCloseTo(y, 6)
  })
  it('heading round trip and model rotation', () => {
    const h = headingVec(Math.PI / 2)
    expect(h.x).toBeCloseTo(1)
    expect(h.z).toBeCloseTo(0)
    expect(headingAngle(h.x, h.z)).toBeCloseTo(Math.PI / 2)
    expect(modelRotationY(1, 0)).toBeCloseTo(0)
    expect(modelRotationY(0, -1)).toBeCloseTo(Math.PI / 2)
  })
  it('turn bezier starts north and ends along exit heading', () => {
    for (const [kind, eh] of [['right', [1, 0]], ['left', [-1, 0]], ['uturn', [0, 1]]] as const) {
      const b = buildTurnPath(kind, { x: 0.8, z: 1.6 })
      const d0 = bezierDeriv(b, 0)
      expect(d0.x).toBeCloseTo(0)
      expect(d0.z).toBeLessThan(0)
      const d1 = bezierDeriv(b, 1)
      const n = Math.hypot(d1.x, d1.z)
      expect(d1.x / n).toBeCloseTo(eh[0])
      expect(d1.z / n).toBeCloseTo(eh[1])
      const end = bezierPoint(b, 1)
      expect(end).toEqual(b[3])
    }
  })
  it('advanceOnBezier moves ~v*dt of arc length', () => {
    const b = buildTurnPath('right', { x: 0.8, z: 1.6 })
    const t = advanceOnBezier(b, 0, 2, 0.01)
    const a = bezierPoint(b, 0)
    const c = bezierPoint(b, t)
    expect(Math.hypot(c.x - a.x, c.z - a.z)).toBeCloseTo(0.02, 2)
  })
  it('unwrapAngle keeps continuity', () => {
    expect(unwrapAngle(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(Math.PI + 0.1)
  })
  it('polyline intersection', () => {
    const p = polylineIntersection([{ x: 0, z: 0 }, { x: 2, z: 2 }], [{ x: 0, z: 2 }, { x: 2, z: 0 }])
    expect(p).toEqual({ x: 1, z: 1 })
    expect(polylineIntersection([{ x: 0, z: 0 }, { x: 1, z: 0 }], [{ x: 0, z: 1 }, { x: 1, z: 1 }])).toBeNull()
  })
})

describe('ai', () => {
  it('follows leader by gap', () => {
    expect(followSpeed(4, null)).toBe(4)
    expect(followSpeed(4, { gap: 10, v: 1 })).toBe(4)
    expect(followSpeed(4, { gap: 0.5, v: 1 })).toBe(0)
    expect(followSpeed(4, { gap: 3, v: 2 })).toBeCloseTo(2 * 0.9 + 1.8 * 0.6)
    expect(followSpeed(1, { gap: 3, v: 2 })).toBe(1)
  })
  it('stop speed', () => {
    expect(stopSpeed(-1)).toBe(0)
    expect(stopSpeed(7)).toBeCloseTo(7)
  })
})

describe('rules', () => {
  const car = (lane: 0 | 1, z: number, v: number): AiCar => ({ id: 1, x: 0, z, v, vmax: v, lane })
  const player = { x: 1.1, z: 0, v: 3, lane: 1 as const, lc: null, signal: 1 as const, sigInput: 1 as const, sigT: 2, yaw: 0 }
  it('dangerous lane change windows', () => {
    expect(isDangerousLaneChange(player, 0, [car(0, 3, 3)])).toBe(true) // 3 u behind
    expect(isDangerousLaneChange(player, 0, [car(0, -1.5, 3)])).toBe(true) // ahead, close
    expect(isDangerousLaneChange(player, 0, [car(0, 8, 3)])).toBe(false) // slow, far behind
    expect(isDangerousLaneChange(player, 0, [car(0, 8, 5)])).toBe(true) // fast, far behind
    expect(isDangerousLaneChange(player, 0, [car(1, 1, 3)])).toBe(false) // other lane
  })
})

describe('sim', () => {
  const road = () => createRoadState({ crossings: [-35], finishZ: -60 })

  it('accelerates, brakes, coasts', () => {
    let { s } = run(road(), 1, () => ({ ...idle, gas: true }))
    expect(s.player.v).toBeCloseTo(2.2, 1)
    ;({ s } = run(s, 0.5, () => ({ ...idle, brake: true })))
    expect(s.player.v).toBeCloseTo(0, 5)
  })

  it('lane change without signal is flagged, and finishes in the other lane', () => {
    const { s, ev } = run(road(), 2, (t) => ({ ...idle, laneChange: t < DT ? -1 : 0 }))
    expect(types(ev)).toContain('lc-no-signal')
    expect(s.player.lane).toBe(0)
    expect(s.player.x).toBeCloseTo(-1.1)
  })

  it('late signal flagged, proper signal clean', () => {
    const late = run(road(), 1, (t) => ({ ...idle, signal: -1, laneChange: t < DT * 2 ? -1 : 0 }))
    expect(types(late.ev)).toContain('lc-late-signal')
    let r = run(road(), 1.5, () => ({ ...idle, signal: -1 }))
    r = run(r.s, 2, (t) => ({ ...idle, signal: -1, laneChange: t < DT ? -1 : 0 }))
    expect(types(r.ev)).not.toContain('lc-late-signal')
    expect(types(r.ev)).not.toContain('lc-no-signal')
    expect(r.s.player.signal).toBe(0) // скинувся після перестроєння
  })

  it('lane change out of the road', () => {
    const { ev, s } = run(road(), 1, (t) => ({ ...idle, signal: 1, laneChange: t < DT ? 1 : 0 }))
    expect(types(ev)).toContain('lc-out-of-road')
    expect(s.player.lc).toBeNull()
  })

  it('speeding fires once per 8 s', () => {
    const { ev } = run(road(), 10, () => ({ ...idle, gas: true }))
    expect(types(ev).filter((e) => e === 'speeding').length).toBeGreaterThanOrEqual(1)
    expect(types(ev).filter((e) => e === 'speeding').length).toBeLessThanOrEqual(2)
  })

  it('player not yielding to a pedestrian is flagged once', () => {
    const s0 = createRoadState({ crossings: [-10], finishZ: -40, peds: [{ crossing: 0, dir: 1 }] })
    const { ev } = run(s0, 8, () => ({ ...idle, gas: true }))
    expect(types(ev).filter((e) => e === 'ped-not-yielded')).toHaveLength(1)
  })

  it('AI car stops for a pedestrian', () => {
    const s0 = createRoadState({
      crossings: [-30], finishZ: -100,
      cars: [{ x: 1.1, z: -10, v: 3, vmax: 3, lane: 1 }],
      peds: [{ crossing: 0, dir: 1, speed: 0.3 }],
    })
    // ставимо гравця далеко ззаду, але в зоні тригера
    s0.player.z = -20
    s0.player.lane = 0
    s0.player.x = -1.1
    const { s } = run(s0, 8, () => idle)
    expect(s.cars[0].z).toBeGreaterThan(-30 + 0.95) // не заїхала на зебру
    expect(s.cars[0].v).toBeLessThan(0.5)
  })

  it('collision ends the run', () => {
    const s0 = createRoadState({ crossings: [], finishZ: -100, cars: [{ x: 1.1, z: -4, v: 0, vmax: 0, lane: 1 }] })
    const { s, ev } = run(s0, 5, () => ({ ...idle, gas: true }))
    expect(types(ev)).toContain('collision')
    expect(s.over).toBe(true)
  })

  it('finish', () => {
    const s0 = createRoadState({ crossings: [], finishZ: -10 })
    const { ev, s } = run(s0, 20, () => ({ ...idle, gas: true }))
    expect(types(ev)).toContain('finish')
    expect(s.player.v * KM).toBeGreaterThan(0)
  })
})
