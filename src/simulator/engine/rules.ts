import type { AiCar, Lane, Player } from './types'
import { KM, SPEED_TOLERANCE_KMH } from './units'

export const LANE_X: Record<Lane, number> = { 0: -1.1, 1: 1.1 }
export const LANE_CHANGE_TIME = 1.4
export const MIN_SIGNAL_TIME = 1
export const PED_BLOCK_X = 2.45

/** Чи небезпечне перестроєння в цільову смугу: є авто поряд або швидке ззаду. */
export const isDangerousLaneChange = (player: Player, targetLane: Lane, cars: AiCar[]): boolean =>
  cars.some((c) => {
    if (c.lane !== targetLane) return false
    const rel = player.z - c.z // >0 — авто попереду
    if (rel > -5.5 && rel < 2.2) return true
    return rel <= -5.5 && rel >= -11 && c.v - player.v > 1.2
  })

export type LaneChangeIssue = 'lc-no-signal' | 'lc-late-signal' | 'lc-out-of-road'

/** Перевірка в момент початку перестроєння (без небезпеки — вона окрема). */
export const checkLaneChangeStart = (player: Player, dir: -1 | 1): LaneChangeIssue | null => {
  if ((dir === -1 && player.lane === 0) || (dir === 1 && player.lane === 1)) return 'lc-out-of-road'
  if (player.signal !== dir) return 'lc-no-signal'
  if (player.sigT < MIN_SIGNAL_TIME) return 'lc-late-signal'
  return null
}

export const isSpeeding = (v: number): boolean => v * KM > SPEED_TOLERANCE_KMH
