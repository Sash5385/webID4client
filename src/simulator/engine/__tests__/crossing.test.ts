import { describe, expect, it } from 'vitest'
import { createCrossState, lightsAt, stepCross, CYCLE, type CrossEvent, type CrossInput, type CrossState } from '../crossing'
import { DT } from '../units'

const idle: CrossInput = { gas: false, brake: false, signal: 0, turn: null }
const rng = () => 0.99 // без спавну трафіку
const run = (s: CrossState, sec: number, inp: (t: number, s: CrossState) => CrossInput) => {
  const ev: CrossEvent[] = []
  let st = s
  for (let t = 0; t < sec && !st.over; t += DT) {
    const r = stepCross(st, inp(t, st), DT)
    st = r.state
    ev.push(...r.events)
  }
  return { s: st, ev: ev.map((e) => e.type) }
}

describe('lights', () => {
  it('cycle phases', () => {
    expect(lightsAt(-11.5).ns).toBe('green') // m=0
    expect(lightsAt(-11.5 + 7.5).ns).toBe('yellow')
    expect(lightsAt(-11.5 + 9).ns).toBe('red')
    expect(lightsAt(-11.5 + 12).ew).toBe('green')
    expect(lightsAt(-11.5 + 17).ew).toBe('yellow')
    expect(lightsAt(-11.5 + CYCLE).ns).toBe('green')
  })
  it('player starts on red', () => {
    expect(lightsAt(0).ns).toBe('red')
  })
})

describe('crossing sim', () => {
  it('running the red light is flagged', () => {
    const { ev } = run(createCrossState(rng), 6, () => ({ ...idle, gas: true }))
    expect(ev).toContain('red-light')
  })

  it('right turn on green: signal, wait, finish', () => {
    let st = createCrossState(rng)
    st.peds[0].done = true // пішохід A вже пройшов
    // чекаємо зеленого на стоп-лінії
    const r = run(st, 40, (t, s) => {
      const light = lightsAt(s.t).ns
      const nearLine = s.player.z - 0.55 - 2.7
      const go = light === 'green' || (s.player.z < 2.7 + 0.55)
      const v = s.player.v
      return {
        gas: go ? v < 1.5 : v < 3 && nearLine > 4,
        brake: !go && nearLine < 0.3 + v * v / 14,
        signal: 1,
        turn: s.player.z < 6 && !s.player.armed && !s.player.turn ? 'right' : null,
      }
    })
    expect(r.ev).not.toContain('turn-no-signal')
    expect(r.ev).not.toContain('turn-late-signal')
    expect(r.ev).toContain('finish')
    expect(r.s.player.x).toBeGreaterThan(7)
  })

  it('turn without signal flagged', () => {
    const st = createCrossState(rng)
    st.player.z = 1.6
    const { ev } = run(st, 0.1, (t) => ({ ...idle, turn: t < DT ? 'right' : null }))
    expect(ev).toContain('turn-no-signal')
  })

  it('late to turn', () => {
    const st = createCrossState(rng)
    st.player.z = -1
    const { ev } = run(st, 0.1, (t) => ({ ...idle, turn: t < DT ? 'left' : null }))
    expect(ev).toContain('turn-late')
  })

  it('left turn into oncoming car flagged', () => {
    const st = createCrossState(rng)
    st.player.z = 1.6
    st.player.sigInput = -1; st.player.signal = -1; st.player.sigT = 2
    st.cars.push({ id: 1, lane: 2, u: -4, v: 3, vmax: 3 })
    const { ev } = run(st, 0.05, (t) => ({ ...idle, signal: -1, turn: t < DT ? 'left' : null }))
    expect(ev).toContain('turn-no-yield')
  })

  it('missing the turn ends the run', () => {
    const st = createCrossState(rng)
    st.player.z = -7.5
    st.player.v = 3
    const { ev } = run(st, 2, () => ({ ...idle, gas: true }))
    expect(ev).toContain('turn-missed')
  })
})
