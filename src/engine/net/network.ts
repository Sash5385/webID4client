// Мережа доріг (будується з RouteData): ребра зі смугами, зʼєднувачі, кільця, переходи, світлофори.
// Лише читання під час заїзду. Рендери можуть брати звідси готові Polyline (net.edges / net.conns / net.rings).
import type { SimConfig } from '../config';
import { Arc, mod, Polyline, ringPose, type Pose, type Vec2 } from '../geometry';
import type { Light, PedLight } from '../signals';
import { groupLight, groupSinceYellow, groupTiming, pedGroupLight, type Group, type PedGroup } from './signals';
import type { ConnectorData, ControllerData, CrossingData, EdgeData, EdgeFeatureData, JunctionData, RingArmData, RingData, RouteData } from './types';

export interface NetFeature {
  readonly data: EdgeFeatureData;
  readonly id: string;
  readonly kind: EdgeFeatureData['kind'];
  readonly s: number; readonly stop: number; readonly zone: readonly [number, number];
  readonly laneStop: readonly number[];          // стоп-лінія в координатах полілінії кожної смуги
  readonly laneZone: readonly (readonly [number, number])[];
  readonly crossing: NetCrossing | null;
  readonly ctrl: string | null; readonly group: Group | null;
}

export interface NetEdge {
  readonly id: string;
  readonly data: EdgeData;
  readonly name: string;
  readonly kind: EdgeData['kind'];
  readonly n: number;
  readonly W: number;
  readonly ref: Polyline;
  readonly lanes: readonly Polyline[];
  readonly length: number;
  readonly features: readonly NetFeature[];
  next: NetEdge[];
  prev: NetEdge[];
  departures: NetConn[];   // зʼєднувачі, що починаються на цьому ребрі (за fromS)
  arrivals: NetConn[];
  ringEntry: { ring: NetRing; arm: RingArmData } | null; // ребро закінчується вʼїздом на кільце
  ringExit: { ring: NetRing; arm: RingArmData } | null;  // ребро починається зʼїздом з кільця
  readonly bbox: readonly [number, number, number, number];
}

export interface LaneConflict { readonly edge: NetEdge; readonly lane: number; readonly laneS: number; readonly connS: number; readonly merge: boolean }
export interface ConnConflict { readonly conn: NetConn; readonly sSelf: number; readonly sOther: number }

export interface NetConn {
  readonly id: string;
  readonly data: ConnectorData;
  readonly path: Polyline;
  readonly turn: ConnectorData['turn'];
  readonly rank: number;
  readonly junction: string | null;
  readonly fromEdge: NetEdge | null; readonly fromLane: number; readonly fromS: number; readonly fromLaneS: number;
  readonly toEdge: NetEdge | null; readonly toLane: number; readonly toS: number; readonly toLaneS: number;
  readonly ring: NetRing | null; readonly fromTheta: number | null; readonly toTheta: number | null;
  readonly ctrl: string | null; readonly group: Group | null;
  readonly lock: string;
  readonly crossings: readonly { readonly crossing: NetCrossing; readonly s: number; readonly u: number }[];
  laneConflicts: LaneConflict[];
  connConflicts: ConnConflict[];
  readonly dir: -1 | 0 | 1; // покажчик: −1 ліворуч (лівий, розворот), 1 праворуч (правий, зʼїзд), 0 — без
  yieldS: number;           // вʼїзд на кільце: найдальше місце переднього бампера, поки ще поза кільцем
}

export interface NetRing {
  readonly id: string;
  readonly data: RingData;
  readonly cx: number; readonly cz: number; readonly r: number; readonly laneWidth: number;
  readonly arms: readonly RingArmData[];
  laneR(l: number): number;
  arc(fromTheta: number, toTheta: number, lane: number): Arc;
  entry: Map<string, NetConn[]>; // arm id → [вʼїзд у внутрішню, у зовнішню]
  exit: Map<string, NetConn[]>;
}

export interface NetCrossing {
  readonly id: string;
  readonly data: CrossingData;
  readonly kind: 'zebra' | 'signal';
  readonly ax: number; readonly az: number; readonly ux: number; readonly uz: number; readonly length: number;
  readonly spans: ReadonlyMap<string, { readonly s: number; readonly u0: number; readonly u1: number }>;
  readonly ctrl: string | null; readonly pedGroup: PedGroup | null;
}

export interface Slot { readonly edge: NetEdge; readonly lane: number; readonly s: number; readonly d: number }

const pl = (pts: readonly (readonly [number, number])[]): Polyline => new Polyline(pts.map((p) => ({ x: p[0], z: p[1] })));

export class Network {
  readonly data: RouteData;
  readonly edges = new Map<string, NetEdge>();
  readonly edgeList: NetEdge[] = [];
  readonly conns = new Map<string, NetConn>();
  readonly connList: NetConn[] = [];
  readonly rings: NetRing[] = [];
  readonly crossings = new Map<string, NetCrossing>();
  readonly controllers = new Map<string, ControllerData>();
  readonly junctions = new Map<string, JunctionData>();

  constructor(data: RouteData) {
    this.data = data;
    for (const c of data.controllers) this.controllers.set(c.id, c);
    for (const j of data.junctions) this.junctions.set(j.id, j);
    for (const c of data.crossings) {
      const L = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
      this.crossings.set(c.id, {
        id: c.id, data: c, kind: c.kind, ax: c.a[0], az: c.a[1], ux: (c.b[0] - c.a[0]) / L, uz: (c.b[1] - c.a[1]) / L, length: L,
        spans: new Map(c.spans.map((sp) => [sp.edge, { s: sp.s, u0: sp.u0, u1: sp.u1 }])), ctrl: c.ctrl ?? null, pedGroup: c.pedGroup ?? null,
      });
    }
    for (const e of data.edges) {
      const ref = pl(e.ref);
      const lanes: Polyline[] = [];
      for (let i = 0; i < e.lanes; i++) lanes.push(ref.offset((i + 0.5) * e.laneWidth));
      const features: NetFeature[] = e.features.map((f) => {
        const laneS = (s: number): number[] => lanes.map((ln) => { const p = ref.pose(s); return ln.project(p.x, p.z).s; });
        const zs0 = laneS(f.zone[0]), zs1 = laneS(f.zone[1]);
        return {
          data: f, id: f.id, kind: f.kind, s: f.s, stop: f.stop, zone: f.zone,
          laneStop: laneS(f.stop), laneZone: zs0.map((a, i) => [a, zs1[i]!] as const),
          crossing: f.crossing ? this.crossings.get(f.crossing) ?? null : null,
          ctrl: f.ctrl ?? null, group: f.group ?? null,
        };
      });
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of e.ref) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
      const pad = e.lanes * e.laneWidth + 2;
      const ne: NetEdge = {
        id: e.id, data: e, name: e.name, kind: e.kind, n: e.lanes, W: e.laneWidth, ref, lanes, length: ref.length, features,
        next: [], prev: [], departures: [], arrivals: [], ringEntry: null, ringExit: null, bbox: [x0 - pad, z0 - pad, x1 + pad, z1 + pad],
      };
      this.edges.set(e.id, ne);
      this.edgeList.push(ne);
    }
    for (const e of this.edgeList) {
      e.next = e.data.next.map((id) => this.edges.get(id)!);
      e.prev = e.data.prev.map((id) => this.edges.get(id)!);
    }
    for (const r of data.rings) {
      const laneR = (l: number): number => r.r + (l - 0.5) * r.laneWidth;
      const ring: NetRing = {
        id: r.id, data: r, cx: r.cx, cz: r.cz, r: r.r, laneWidth: r.laneWidth, arms: r.arms, laneR,
        arc(from, to, lane) { let t = to; while (t <= from + 0.02) t += Math.PI * 2; return new Arc(r.cx, r.cz, laneR(lane), from, t); },
        entry: new Map(), exit: new Map(),
      };
      this.rings.push(ring);
      for (const a of r.arms) {
        const e = this.edges.get(a.edge)!;
        if (a.kind === 'entry') e.ringEntry = { ring, arm: a }; else e.ringExit = { ring, arm: a };
      }
    }
    for (const c of data.connectors) {
      const path = pl(c.path);
      const fe = 'edge' in c.from ? this.edges.get(c.from.edge)! : null;
      const te = 'edge' in c.to ? this.edges.get(c.to.edge)! : null;
      const ring = 'ring' in c.from ? this.rings.find((q) => q.id === (c.from as { ring: string }).ring)! : 'ring' in c.to ? this.rings.find((q) => q.id === (c.to as { ring: string }).ring)! : null;
      const p0 = path.pose(0), p1 = path.pose(path.length);
      const nc: NetConn = {
        id: c.id, data: c, path, turn: c.turn, rank: c.rank, junction: c.junction,
        fromEdge: fe, fromLane: c.from.lane, fromS: fe ? (c.from as { s: number }).s : 0, fromLaneS: fe ? fe.lanes[c.from.lane]!.project(p0.x, p0.z).s : 0,
        toEdge: te, toLane: c.to.lane, toS: te ? (c.to as { s: number }).s : 0, toLaneS: te ? te.lanes[c.to.lane]!.project(p1.x, p1.z).s : 0,
        ring, fromTheta: 'ring' in c.from ? c.from.theta : null, toTheta: 'ring' in c.to ? c.to.theta : null,
        ctrl: c.ctrl ?? null, group: c.group ?? null, lock: c.lock ?? '',
        crossings: (c.crossings ?? []).map((q) => ({ crossing: this.crossings.get(q.crossing)!, s: q.s, u: q.u })),
        laneConflicts: [], connConflicts: [],
        dir: c.turn === 'left' || c.turn === 'uturn' ? -1 : c.turn === 'right' || c.turn === 'exit' ? 1 : 0,
        yieldS: path.length,
      };
      if (ring && c.turn === 'entry') {
        const lim = ring.r + ring.laneWidth + 1.0;
        let ys = 0;
        for (let q = 0; q <= path.length; q += 0.25) { const p = path.pose(q); if (Math.hypot(p.x - ring.cx, p.z - ring.cz) < lim) break; ys = q; }
        nc.yieldS = ys;
      }
      this.conns.set(c.id, nc);
      this.connList.push(nc);
      if (fe) fe.departures.push(nc);
      if (te) te.arrivals.push(nc);
      if (ring) {
        if (c.turn === 'entry') { const arm = ring.arms.find((a) => a.edge === fe!.id)!; const l = ring.entry.get(arm.id) ?? []; l[c.to.lane] = nc; ring.entry.set(arm.id, l); }
        if (c.turn === 'exit') { const arm = ring.arms.find((a) => a.edge === te!.id)!; const l = ring.exit.get(arm.id) ?? []; l[c.from.lane] = nc; ring.exit.set(arm.id, l); }
      }
    }
    for (const e of this.edgeList) e.departures.sort((a, b) => a.fromS - b.fromS);
    this.computeConflicts();
  }

  // Конфлікти зʼєднувачів зі смугами ребер і між собою (для «поступитися» й судді).
  private computeConflicts(): void {
    for (const c of this.connList) {
      if (c.turn === 'entry' || c.turn === 'exit') continue;
      const L = c.path.length;
      const pts: { s: number; x: number; z: number }[] = [];
      for (let s = 0; s <= L; s += 1) { const p = c.path.pose(s); pts.push({ s, x: p.x, z: p.z }); }
      const seen = new Set<string>();
      for (const e of this.edgeList) {
        if (e.kind === 'side' || e.kind === 'driveway') continue;
        const [x0, z0, x1, z1] = e.bbox;
        if (!pts.some((p) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1)) continue;
        for (let lane = 0; lane < e.n; lane++) {
          const key = `${e.id}:${lane}`;
          const isFrom = e === c.fromEdge && lane === c.fromLane, isTo = e === c.toEdge && lane === c.toLane;
          if (isTo) {
            // Злиття: конфлікт починається там, де кузов уже заходить у смугу (вісь ближче за 3.2 м).
            let hit = { laneS: c.toLaneS, connS: Math.max(0, L - 8) };
            for (const p of pts) {
              if (p.s < 3) continue;
              const q = e.lanes[lane]!.project(p.x, p.z);
              if (Math.abs(q.d) < 3.2 && q.s > 0 && q.s <= e.lanes[lane]!.length) { hit = { laneS: q.s, connS: p.s }; break; }
            }
            c.laneConflicts.push({ edge: e, lane, laneS: hit.laneS, connS: hit.connS, merge: true });
            continue;
          }
          for (const p of pts) {
            if (isFrom || (e === c.fromEdge && p.s < 5)) continue;
            const q = e.lanes[lane]!.project(p.x, p.z);
            if (Math.abs(q.d) < 1.9 && q.s > 0 && q.s < e.lanes[lane]!.length) {
              if (!seen.has(key)) { seen.add(key); c.laneConflicts.push({ edge: e, lane, laneS: q.s, connS: p.s, merge: false }); }
              break;
            }
          }
        }
      }
      for (const o of this.connList) {
        if (o === c || o.turn === 'entry' || o.turn === 'exit') continue;
        if (o.fromEdge === c.fromEdge && o.fromLane === c.fromLane && Math.abs(o.fromS - c.fromS) < 1) continue;
        let hit: ConnConflict | null = null;
        for (const p of pts) {
          const q = o.path.project(p.x, p.z);
          if (Math.abs(q.d) < 2.2 && q.s >= 0 && q.s <= o.path.length) { hit = { conn: o, sSelf: p.s, sOther: q.s }; break; }
        }
        if (hit) c.connConflicts.push(hit);
      }
    }
  }

  edge(id: string): NetEdge { const e = this.edges.get(id); if (!e) throw new Error('edge ' + id); return e; }
  conn(id: string): NetConn { const c = this.conns.get(id); if (!c) throw new Error('conn ' + id); return c; }

  // Точка на ребрі: s уздовж ref, d праворуч від ref.
  pose(e: NetEdge, s: number, d: number): Pose {
    const p = e.ref.pose(s);
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    return { x: p.x - hz * d, z: p.z + hx * d, a: p.a };
  }
  laneD(e: NetEdge, lane: number): number { return (lane + 0.5) * e.W; }

  // Де точка (ребро, смуга, s, d). heading — щоб вибрати серед ребер, що перекриваються.
  slot(x: number, z: number, heading?: number, filter?: (e: NetEdge) => boolean): Slot | null {
    let best: Slot | null = null, bs = Infinity;
    for (const e of this.edgeList) {
      const [x0, z0, x1, z1] = e.bbox;
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;
      if (filter && !filter(e)) continue;
      const p = e.ref.project(x, z);
      if (p.d < -0.3 || p.d > e.n * e.W + 0.3 || p.s < -0.5 || p.s > e.length + 0.5) continue;
      let score = 0;
      if (heading !== undefined) { const a = e.ref.pose(p.s).a; score = Math.abs(Math.atan2(Math.sin(a - heading), Math.cos(a - heading))); if (score > 1.2) continue; }
      if (score < bs) { bs = score; best = { edge: e, lane: Math.max(0, Math.min(e.n - 1, Math.floor(p.d / e.W))), s: p.s, d: p.d }; }
    }
    return best;
  }

  // ---- Світлофори ----
  light(ctrl: string, group: Group, t: number, c: SimConfig['signals']): Light {
    return groupLight(t, this.controllers.get(ctrl)?.offset ?? 0, group, c);
  }
  sinceYellow(ctrl: string, group: Group, t: number, c: SimConfig['signals']): number {
    return groupSinceYellow(t, this.controllers.get(ctrl)?.offset ?? 0, group, c);
  }
  timing(ctrl: string, group: Group, t: number, c: SimConfig['signals']): { goLeft: number; untilGreen: number } {
    return groupTiming(t, this.controllers.get(ctrl)?.offset ?? 0, group, c);
  }
  pedLight(cr: NetCrossing, t: number, c: SimConfig['signals']): PedLight {
    if (cr.kind !== 'signal' || !cr.ctrl) return 'walk';
    return pedGroupLight(t, this.controllers.get(cr.ctrl)?.offset ?? 0, cr.pedGroup ?? 'acrossA', c);
  }

  // ---- Кільце ----
  ringPose(r: NetRing, lane: number | null, theta: number, d?: number): Pose {
    return ringPose(r.cx, r.cz, d !== undefined ? r.r + d : r.laneR(lane ?? 1), theta);
  }
  ringTheta(r: NetRing, x: number, z: number): number { return mod(Math.atan2(-(z - r.cz), x - r.cx), Math.PI * 2); }
}

export const vec = (x: number, z: number): Vec2 => ({ x, z });
