import { describe, expect, it } from 'vitest'
import { buildPath, buildPlan, conflicts, pathLength, positionOf, COLLISION_DIST } from '../quiz'
import { QUIZ_SCENARIOS } from '../scenarios/quiz'

describe('quiz paths', () => {
  it('straight path from S has length 12.4 and ends north', () => {
    const p = buildPath('S', 'straight')
    expect(pathLength(p)).toBeCloseTo(12.4)
    expect(p[p.length - 1].z).toBeCloseTo(3.4 - 12.4)
  })
  it('rotation: from W heads east', () => {
    const p = buildPath('W', 'straight')
    expect(p[0].x).toBeCloseTo(-3.4)
    expect(p[p.length - 1].x).toBeGreaterThan(8)
  })
  it('opposite straights do not conflict; perpendicular do; left vs oncoming do', () => {
    const sc = QUIZ_SCENARIOS[0]
    expect(conflicts(sc, 'b', 'c')).toBe(false) // E vs W
    expect(conflicts(sc, 'a', 'b')).toBe(true)
    expect(conflicts(QUIZ_SCENARIOS[1], 'a', 'b')).toBe(true)
  })
})

describe('quiz plan', () => {
  it('correct order: no collision, starts staggered', () => {
    for (const sc of QUIZ_SCENARIOS) {
      const plan = buildPlan(sc, sc.correctOrder)
      expect(plan.correct).toBe(true)
      expect(plan.collisionAt).toBeNull()
      const starts = plan.cars.map((c) => c.start)
      expect(starts).toEqual([...starts].sort((a, b) => a - b))
    }
  })
  it('wrong order collides', () => {
    const sc = QUIZ_SCENARIOS[2]
    const plan = buildPlan(sc, ['a', 'b'])
    expect(plan.correct).toBe(false)
    expect(plan.collisionPair).toEqual(['a', 'b'])
    expect(plan.collisionAt).not.toBeNull()
    const t = plan.collisionAt!
    const p = positionOf(plan.cars[0], t)
    const q = positionOf(plan.cars[1], t)
    expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(COLLISION_DIST)
  })
})
