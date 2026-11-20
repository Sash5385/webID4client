// Мережа доріг маршруту №7: кільце (2 смуги) з 3 рукавами + вул. Мрії (по 2 смуги в кожен бік).
// Рукава (СВЕРИТЬ з OSM): W — автодром (старт/фініш), S — вул. Мрії, E — ще один виїзд.
// Від автодрому зʼїзд на Мрії перший, від Мрії до фінішу — другий.
// Зараз геометрія схематична (зі схеми). Дані OSM потім підміняють лише цей модуль.

import { BUS_STOPS, DRIVEWAYS, FEATURES, type BusStopDef, type DrivewayDef, type FeatureDef, type SimConfig } from './config';
import { Arc, bezierPath, line, mod, Polyline, ringPose, type Path, type Pose } from './geometry';

export type ArmId = 'W' | 'S' | 'E';
export type RingLane = 0 | 1; // 0 — внутрішня, 1 — зовнішня (права)
export type Dir = 'S' | 'N';

export interface Arm {
  readonly id: ArmId;
  readonly name: string;
  readonly mergeTheta: number;  // точка вʼїзду на зовнішню смугу
  readonly exitTheta: number;   // точка зʼїзду з зовнішньої смуги
  // Внутрішня смуга зливається/відходить ближче до осі рукава, щоб траєкторії двох смуг не перетиналися.
  mergeAt(lane: RingLane): number;
  exitAt(lane: RingLane): number;
  readonly inLine: Polyline | null; // підʼїзд до лінії «Дати дорогу» (для S — це смуги N)
  readonly outLine: Polyline;                // для S — права смуга Мрії
  readonly outStart: (lane: RingLane) => Pose; // куди веде зʼїзд з цієї смуги кільця
}

export interface Feature {
  readonly def: FeatureDef;
  readonly signalised: boolean;
  readonly worldZ: number;
  // У координатах s кожного напрямку (S: від кільця на південь, N: від півдня на північ).
  readonly zone: Readonly<Record<Dir, readonly [number, number]>>;
  readonly stop: Readonly<Record<Dir, number>>;
}

// Виїзд із двору: проїзд від краю проїзної частини (x = edgeX) углиб на depth м.
// Дві вузькі смуги: «у двір» (inZ) і «з двору» (outZ). Лише правий поворот.
export interface Driveway {
  readonly def: DrivewayDef;
  readonly dir: Dir;          // напрямок Мрії, що прилягає до цього боку
  readonly worldZ: number;
  readonly sign: 1 | -1;      // +1 схід (E), -1 захід (W)
  readonly edgeX: number;     // |x| краю проїзної частини
  readonly depth: number;     // м від краю
  readonly inZ: number;
  readonly outZ: number;
}
export interface BusStop { readonly def: BusStopDef; readonly worldZ: number; readonly sign: 1 | -1; readonly dir: Dir }

// Де на Мрії точка: напрям, смуга (0 ліва, 1 права), s по опорній лінії напрямку, d — від опорної лінії праворуч.
export interface StreetSlot { readonly dir: Dir; readonly lane: 0 | 1; readonly s: number; readonly d: number }

export interface RouteNet {
  // r — межа між смугами; осі смуг: r ± laneWidth/2.
  readonly ring: { readonly cx: number; readonly cz: number; readonly r: number; readonly laneWidth: number };
  laneR(lane: RingLane): number;
  readonly arms: Readonly<Record<ArmId, Arm>>;
  readonly armOrder: readonly ArmId[]; // проти годинникової: W → S → E
  readonly ref: Readonly<Record<Dir, Polyline>>;
  readonly lanes: Readonly<Record<Dir, readonly [Polyline, Polyline]>>; // [ліва(0), права(1)]
  readonly features: readonly Feature[];
  readonly driveways: readonly Driveway[];
  readonly busStops: readonly BusStop[];
  readonly carriageway: Readonly<Record<Dir, readonly [number, number]>>; // діапазон X проїзної частини
  readonly laneWidth: number;
  readonly startPose: { readonly line: Polyline; readonly s: number };
  readonly finishOut: Polyline;
  readonly finishS: number;
  entryPath(from: Pose, arm: ArmId, lane: RingLane): Polyline;
  exitPath(arm: ArmId, lane: RingLane): Polyline;
  ringArc(fromTheta: number, toTheta: number, lane: RingLane): Arc;
  streetSlot(x: number, z: number): StreetSlot | null;
  // s напрямку dir для світової Z (вулиця пряма вздовж Z).
  sAt(dir: Dir, z: number): number;
}

const DEG = Math.PI / 180;

export function buildRoute(cfg: SimConfig): RouteNet {
  const W = cfg.road.laneWidth;
  const mh = cfg.road.medianHalf;
  const R = cfg.ring.radius;
  const z0 = cfg.street.startZ;
  const len = cfg.street.length;
  const yieldR = 26;               // відстань від центру кільця до ліній «Дати дорогу» на W/E
  const off = cfg.ring.armLaneOffset;
  const armLen = cfg.ring.armLength;
  const md = cfg.ring.mergeAngleDeg * DEG;
  const rw = cfg.ring.laneWidth;
  const ring = { cx: 0, cz: 0, r: R, laneWidth: rw };
  const laneR = (l: RingLane): number => R + (l - 0.5) * rw;

  const ref: Record<Dir, Polyline> = {
    S: line({ x: -mh, z: z0 }, { x: -mh, z: z0 + len }),
    N: line({ x: mh, z: z0 + len }, { x: mh, z: z0 }),
  };
  const lanes: Record<Dir, [Polyline, Polyline]> = {
    S: [ref.S.offset(W * 0.5), ref.S.offset(W * 1.5)],
    N: [ref.N.offset(W * 0.5), ref.N.offset(W * 1.5)],
  };

  const armAngle: Record<ArmId, number> = { E: 30 * DEG, W: 180 * DEG, S: 270 * DEG };
  const mdIn = cfg.ring.innerAngleDeg * DEG;
  const mkArm = (id: ArmId, name: string, inLine: Polyline | null, outLine: Polyline, outLeft?: Polyline): Arm => ({
    id, name,
    mergeTheta: mod(armAngle[id] + md, Math.PI * 2),
    exitTheta: mod(armAngle[id] - md, Math.PI * 2),
    mergeAt: (l) => mod(armAngle[id] + (l === 1 ? md : mdIn), Math.PI * 2),
    exitAt: (l) => mod(armAngle[id] - (l === 1 ? md : mdIn), Math.PI * 2),
    inLine, outLine,
    outStart: (l) => (l === 0 && outLeft ? outLeft : outLine).pose(0),
  });
  const ea = armAngle.E, ec = Math.cos(ea), es = Math.sin(ea); // E — під кутом, лінії по його осі
  const ePt = (along: number, side: number): { x: number; z: number } => ({ x: ec * along + es * side, z: -es * along + ec * side });

  const arms: Record<ArmId, Arm> = {
    W: mkArm('W', 'автодром',
      line({ x: -yieldR - armLen, z: off }, { x: -yieldR, z: off }),
      line({ x: -yieldR, z: -off }, { x: -yieldR - armLen, z: -off })),
    E: mkArm('E', 'схід',
      line(ePt(yieldR + armLen, -off), ePt(yieldR, -off)),
      line(ePt(yieldR, off), ePt(yieldR + armLen, off))),
    S: mkArm('S', 'вул. Мрії', null, lanes.S[1], lanes.S[0]),
  };

  const features: Feature[] = FEATURES.map((def) => {
    const sN = len - def.s;
    return {
      def,
      signalised: def.kind !== 'zebra',
      worldZ: z0 + def.s,
      zone: { S: [def.s - def.halfWidth, def.s + def.halfWidth], N: [sN - def.halfWidth, sN + def.halfWidth] },
      stop: { S: def.s - def.halfWidth - 1, N: sN - def.halfWidth - 1 },
    };
  });

  const edgeX = mh + 2 * W;
  const driveways: Driveway[] = DRIVEWAYS.map((def) => {
    const sign: 1 | -1 = def.side === 'E' ? 1 : -1;
    const worldZ = z0 + def.s;
    // Правосторонній рух: у дворі смуга «туди» — праворуч від руху вглиб.
    return { def, dir: def.side === 'E' ? 'N' : 'S', worldZ, sign, edgeX, depth: 18, inZ: worldZ + sign * 1.5, outZ: worldZ - sign * 1.5 };
  });
  const busStops: BusStop[] = BUS_STOPS.map((def) => ({ def, worldZ: z0 + def.s, sign: def.side === 'E' ? 1 : -1, dir: def.side === 'E' ? 'N' : 'S' }));

  const startLine = arms.W.inLine!;
  return {
    ring, laneR, arms, armOrder: ['W', 'S', 'E'], ref, lanes, features, driveways, busStops,
    carriageway: { S: [-mh - 2 * W, -mh], N: [mh, mh + 2 * W] },
    laneWidth: W,
    startPose: { line: startLine, s: armLen - 30 },
    finishOut: arms.W.outLine,
    finishS: 26,
    entryPath(from, arm, lane) {
      return bezierPath(from, ringPose(0, 0, laneR(lane), arms[arm].mergeAt(lane)), 5, 4);
    },
    exitPath(arm, lane) {
      return bezierPath(ringPose(0, 0, laneR(lane), arms[arm].exitAt(lane)), arms[arm].outStart(lane), 4, 5);
    },
    ringArc(from, to, lane) {
      let t = to;
      while (t <= from + 0.05) t += Math.PI * 2;
      return new Arc(0, 0, laneR(lane), from, t);
    },
    streetSlot(x, z) {
      for (const dir of ['S', 'N'] as const) {
        const p = ref[dir].project(x, z);
        if (p.d < 0 || p.d > 2 * W || p.s < -3 || p.s > len + 3) continue;
        return { dir, lane: p.d < W ? 0 : 1, s: p.s, d: p.d };
      }
      return null;
    },
    sAt(dir, z) { return dir === 'S' ? z - z0 : z0 + len - z; },
  };
}

export type { Path };
