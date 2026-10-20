import { AI_ACC, AI_BRAKE, CAR_LEN } from './units'

export interface Lead { gap: number; v: number }

/** Бажана швидкість ІІ при русі за лідером. gap — зазор між бамперами. */
export const followSpeed = (vmax: number, lead: Lead | null): number => {
  if (!lead || lead.gap >= 6) return vmax
  if (lead.gap < 1) return 0
  return Math.min(vmax, lead.v * 0.9 + Math.max(0, lead.gap - 1.2) * 0.6)
}

/** Швидкість, з якої ще можна встати на відстані dist (до стоп-лінії). */
export const stopSpeed = (dist: number): number => Math.sqrt(2 * 3.5 * Math.max(0, dist))

/** Довести v до бажаної з обмеженням прискорення/гальмування ІІ. */
export const approachSpeed = (v: number, desired: number, dt: number): number => {
  if (desired > v) return Math.min(desired, v + AI_ACC * dt)
  return Math.max(desired, v + AI_BRAKE * dt)
}

export const gapBetween = (rearZ: number, frontZ: number): number => rearZ - frontZ - CAR_LEN
