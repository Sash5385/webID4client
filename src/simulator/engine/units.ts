// 1 u ≈ 4 м. Швидкість у км/год = v (u/с) * KM.
export const KM = 14

export const CAR_LEN = 1.1
export const CAR_WID = 0.58
export const BUS_LEN = 2.4

export const LIMIT_CITY = 50 / KM
export const SPEED_TOLERANCE_KMH = 57
export const MAXV = 5.5

export const ACC_GAS = 2.2
export const ACC_BRAKE = -7
export const ACC_COAST = -0.7
export const AI_ACC = 2.5
export const AI_BRAKE = -6

export const DT = 1 / 60

export const toKmh = (v: number): number => v * KM
