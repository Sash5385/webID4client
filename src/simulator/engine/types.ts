export type Approach = 'N' | 'E' | 'S' | 'W'
export type Move = 'straight' | 'left' | 'right' | 'uturn'

export interface Vec2 { x: number; z: number }

/** 0 — ліва смуга, 1 — права. */
export type Lane = 0 | 1
export type SignalDir = -1 | 0 | 1

export interface Input {
  gas: boolean
  brake: boolean
  /** Поворотник: -1 ліворуч, 1 праворуч, 0 вимкнено. */
  signal: SignalDir
  /** Запит перестроєння (одноразовий): -1 ліворуч, 1 праворуч. */
  laneChange: SignalDir
}

export interface LaneChange { from: number; to: number; dir: -1 | 1; t: number }

export interface Player {
  x: number
  z: number
  v: number
  lane: Lane
  lc: LaneChange | null
  signal: SignalDir
  /** Останнє значення Input.signal (щоб автоскидання не вмикалося знову). */
  sigInput: SignalDir
  /** Скільки секунд поворотник уже ввімкнений. */
  sigT: number
  yaw: number
}

export interface AiCar {
  id: number
  x: number
  z: number
  v: number
  vmax: number
  lane: Lane
}

export interface Pedestrian {
  id: number
  crossing: number
  x: number
  /** Напрям руху по x: 1 або -1. */
  dir: 1 | -1
  speed: number
  /** Затримка старту після спрацьовування зони, с. */
  delay: number
  triggered: boolean
  started: boolean
  done: boolean
}

export interface Crossing { z: number }

export type EventType =
  | 'ped-not-yielded'
  | 'lc-no-signal'
  | 'lc-late-signal'
  | 'lc-dangerous'
  | 'lc-out-of-road'
  | 'speeding'
  | 'collision'
  | 'finish'

export interface SimEvent { type: EventType; t: number }

export interface Flags {
  pedViolated: Record<number, boolean>
  overSpeedT: number
  lastSpeedingAt: number
}

export interface RoadState {
  t: number
  player: Player
  cars: AiCar[]
  peds: Pedestrian[]
  crossings: Crossing[]
  finishZ: number
  over: boolean
  flags: Flags
}
