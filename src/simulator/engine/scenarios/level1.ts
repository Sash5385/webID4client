import { createRoadState } from '../sim'
import type { RoadState } from '../types'

export const LEVEL1_CROSSINGS = [-35, -85, -135]
export const LEVEL1_FINISH_Z = -165

export const createLevel1 = (): RoadState =>
  createRoadState({
    crossings: LEVEL1_CROSSINGS,
    finishZ: LEVEL1_FINISH_Z,
    cars: [
      { x: 1.1, z: -12, v: 1.5, vmax: 1.5, lane: 1 },
      { x: -1.1, z: 14, v: 4.6, vmax: 4.6, lane: 0 },
      { x: -1.1, z: -25, v: 2.8, vmax: 2.8, lane: 0 },
      { x: 1.1, z: -48, v: 2.0, vmax: 2.0, lane: 1 },
    ],
    peds: [
      { crossing: 0, dir: 1 },
      { crossing: 0, dir: 1, delay: 1.5 },
      { crossing: 1, dir: -1 },
      { crossing: 1, dir: -1, delay: 1 },
      { crossing: 1, dir: -1, delay: 2 },
      { crossing: 2, dir: 1 },
      { crossing: 2, dir: -1, delay: 2.5 },
    ],
  })
