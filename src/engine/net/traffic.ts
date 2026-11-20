// ІІ на мережі (маршрут №1): IDM-слідування, світлофори з фазами A/B, пішоходи на переходах, «Дати дорогу»
// перед кільцем, повороти через зʼєднувачі (замок перехрестя + прийняття розриву), перешкоди, обʼїзд і обовʼязкове
// перестроювання, коли смуга закінчується. Авто живуть у «бульбашці» навколо гравця (народжуються за 200–360 м).
//
// Логіка — узагальнення src/engine/traffic.ts (маршрут №7): ті самі Body/IDM/canTurn/gapOK, але ноги (legs) —
// смуги ребер мережі та зʼєднувачі, а план руху обирається випадково на кожному ребрі.
import type { SimConfig } from '../config';
import { clamp, mod, Polyline, type Box, type Path, type Projection } from '../geometry';
import { isStopLight } from '../signals';
import type { Rng } from '../rng';
import type { Body, BodyKind } from '../traffic';
import type { NetConn, NetEdge, NetFeature, NetRing, Network } from './network';
import type { NetPeds } from './peds';
import type { NetRiders } from './riders';

export type NetLegKind = 'lane' | 'conn' | 'entry' | 'ring' | 'exit';
export interface NetLeg {
  readonly path: Path;
  readonly kind: NetLegKind;
  readonly edge?: NetEdge;     // для 'lane'
  readonly lane?: number;      // для 'lane' (смуга ребра) / 'ring' (смуга кільця)
  readonly s0: number;         // 'lane': початок ноги в координатах полілінії смуги
  readonly conn?: NetConn;     // для 'conn' / 'entry' / 'exit'
  readonly ring?: NetRing;
  readonly open?: boolean;     // план на цьому ребрі ще не обрано
  readonly sink?: boolean;     // авто зникає в кінці
}

export type NetCarKind = 'car' | 'parked' | 'broken';

export interface NetTurnPlan {
  readonly conn: NetConn;
  readonly key: string;        // замок ('' — без)
  readonly dir: -1 | 0 | 1;
  readonly turnLeg: number;
  readonly fromMain: boolean;  // має перевагу над другорядними (rank ≥ 1)
  readonly left: boolean;
  done: boolean;
}

export interface NetCar {
  readonly id: number;
  legs: NetLeg[];
  leg: number;
  s: number;
  v: number;
  readonly v0: number;
  readonly len: number;
  readonly color: number;
  x: number; z: number; a: number;
  braking: boolean;
  readonly kind: NetCarKind;
  hazard: boolean;
  turn: -1 | 0 | 1;
  off: number; offT: number; lcSig: number;
  acc: number;
  leadId: number;
  plan: NetTurnPlan | null;
  commit: boolean;
  home: number;                // бажана смуга
  merge: boolean;              // смуга закінчується — треба ліворуч
}

const IDM = { A: 1.6, B: 2.5, s0: 2.2, T: 1.3, maxDecel: 9 };
const LOOK = 80;
const LANE_HALF = 2.4;
const COLORS = [0xd6362f, 0xececec, 0x2a9d6a, 0xe6b422, 0x7a4fd6, 0xe07a2f, 0x3b3f4a, 0x9aa3ad];
const SPAWN_R: [number, number] = [210, 360];
const DESPAWN_R = 470;

// Проекція на ділянку шляху (швидко для довгих смуг).
const projR = (path: Path, x: number, z: number, s0: number, s1: number): Projection => (path instanceof Polyline ? path.projectRange(x, z, s0, s1) : path.project(x, z));

function clearTime(dist: number, v0: number, a: number, vmax: number): number {
  if (v0 >= vmax) return dist / vmax;
  const t1 = (vmax - v0) / a, d1 = ((v0 + vmax) / 2) * t1;
  if (dist <= d1) return (-v0 + Math.sqrt(v0 * v0 + 2 * a * dist)) / a;
  return t1 + (dist - d1) / vmax;
}

export class NetTraffic {
  grip = 1; // зчеплення з дорогою (1 = суха): ІІ їде повільніше й тримає більшу дистанцію
  cars: NetCar[] = [];
  private nextId = 1;
  private sideT: number;
  private spawnT = 0;
  private readonly locks = new Map<string, number>();
  readonly holding = new Set<number>();
  private extra: readonly Body[] = [];
  private t = 0;
  readonly why = new Map<number, string>();
  debugId = -1; // налагодження: друкувати рішення canTurn для цього авто
  riders: NetRiders | null = null;
  private whyId = 0;
  private readonly streetEdges: NetEdge[];

  constructor(private readonly cfg: SimConfig, private readonly net: Network, private readonly rng: Rng) {
    this.sideT = rng.range(4, 10);
    this.streetEdges = net.edgeList.filter((e) => e.kind === 'street' || e.kind === 'arm' || e.kind === 'cross');
  }

  // ---- Замки ----
  lockFree(key: string, id: number): boolean { return !key || !this.locks.has(key) || this.locks.get(key) === id; }
  tryLock(key: string, id: number): boolean { if (!this.lockFree(key, id)) return false; if (key) this.locks.set(key, id); return true; }
  unlock(key: string, id: number): void { if (key && this.locks.get(key) === id) this.locks.delete(key); }
  lockHolder(key: string): number | undefined { return this.locks.get(key); }

  // ---- Планування ----

  private laneLeg(e: NetEdge, lane: number, s0: number, s1: number, extra: Partial<NetLeg> = {}): NetLeg {
    const ln = e.lanes[lane]!;
    const a = clamp(s0, 0, ln.length), b = clamp(s1, a + 0.05, Math.max(a + 0.05, ln.length));
    return { path: a <= 0.001 && b >= ln.length - 0.001 ? ln : ln.slice(a, b), kind: 'lane', edge: e, lane, s0: a, ...extra };
  }

  // Ноги для руху ребром e по смузі lane від sLane (координата полілінії смуги) і далі — до наступного ребра.
  // Повертає ноги і план (якщо є поворот із замком/поступкою).
  private planFrom(c: NetCar | null, e: NetEdge, lane: number, sLane: number, legBase: number, allowTurn = true): { legs: NetLeg[]; plan: NetTurnPlan | null; merge: boolean } {
    const ln = e.lanes[lane]!;
    const turnMargin = e.kind === 'side' || e.kind === 'driveway' ? 6 : 22; // короткі двори: поворот планується одразу
    const deps = e.departures.filter((d) => d.toEdge && !d.data.playerOnly && d.fromLane === lane && (d.fromLaneS > sLane + turnMargin || (d.fromLaneS >= ln.length - 1.5 && d.fromLaneS > sLane))); // зʼєднувач у самому кінці ребра доступний і з близької відстані
    const atEnd = (d: NetConn): boolean => d.fromLaneS >= ln.length - 1.5;
    const mid = deps.filter((d) => !atEnd(d));
    const endConns = deps.filter(atEnd);
    const cont = e.next.filter((n) => lane < n.n);
    const ringE = e.ringEntry;
    type Opt = { kind: 'mid' | 'endc' | 'cont' | 'ring' | 'sink'; conn?: NetConn; next?: NetEdge };
    const ends: Opt[] = [...endConns.map((d) => ({ kind: 'endc' as const, conn: d })), ...cont.map((n) => ({ kind: 'cont' as const, next: n }))];
    if (ringE) ends.push({ kind: 'ring' });
    const dying = !ends.length && (e.next.length > 0 || e.departures.some((d) => d.fromLane === lane && !d.data.playerOnly && atEnd(d)));
    if (!ends.length && !dying) ends.push({ kind: 'sink' });
    let pick: Opt | null = null;
    const share = this.cfg.turners.share;
    // Виїзд з двору/бічної вулиці: лише на дорогу (кінець такого ребра — край проїзної частини).
    const forced = (dying && allowTurn) || ((e.kind === 'side' || e.kind === 'driveway') && ends.length === 1 && ends[0]!.kind === 'sink');
    if (mid.length && (forced || (allowTurn && this.rng.next() < share * (mid.length > 1 ? 1.3 : 1)))) pick = { kind: 'mid', conn: this.rng.pick(mid) };
    if (!pick && ends.length) pick = this.rng.pick(ends);
    if (!pick) return { legs: [this.laneLeg(e, lane, sLane, ln.length)], plan: null, merge: true };
    const legs: NetLeg[] = [];
    let plan: NetTurnPlan | null = null;
    const addConn = (d: NetConn): void => {
      legs.push({ path: d.path, kind: 'conn', conn: d, s0: 0 });
      const turnLeg = legBase + legs.length - 1;
      if (d.rank < 3 || d.ctrl || d.lock) plan = { conn: d, key: d.lock, dir: d.dir, turnLeg, fromMain: d.rank >= 1, left: d.dir === -1, done: false };
      legs.push(this.laneLeg(d.toEdge!, d.toLane, d.toLaneS, d.toEdge!.lanes[d.toLane]!.length, { open: true }));
    };
    if (pick.kind === 'mid' || pick.kind === 'endc') { legs.push(this.laneLeg(e, lane, sLane, pick.conn!.fromLaneS)); addConn(pick.conn!); }
    else if (pick.kind === 'cont') { legs.push(this.laneLeg(e, lane, sLane, ln.length)); legs.push(this.laneLeg(pick.next!, lane, 0, pick.next!.lanes[lane]!.length, { open: true })); }
    else if (pick.kind === 'sink') legs.push(this.laneLeg(e, lane, sLane, ln.length, { sink: true }));
    else {
      legs.push(this.laneLeg(e, lane, sLane, ln.length));
      this.appendRing(legs, ringE!.ring, ringE!.arm.id, e, lane);
    }
    void c;
    return { legs, plan, merge: dying && pick.kind !== 'mid' };
  }

  private appendRing(legs: NetLeg[], ring: NetRing, armId: string, e: NetEdge, lane: number): void {
    const rl = e.n === 1 ? 1 : lane === 0 ? 0 : 1;
    const ent = ring.entry.get(armId)![rl]!;
    const arms = ring.arms;
    const i0 = arms.findIndex((a) => a.id === armId);
    const exits: string[] = [];
    for (let k = 1; k < arms.length; k++) { const a = arms[(i0 + k) % arms.length]!; if (a.kind === 'exit') exits.push(a.id); }
    // Внутрішня смуга — не на перший зʼїзд; останній (розворот) — рідко.
    let opts = exits.slice(rl === 0 ? 1 : 0, exits.length - 1);
    if (!opts.length) opts = exits.slice(0, exits.length);
    const exitId = this.rng.pick(opts);
    const ex = ring.exit.get(exitId)![rl]!;
    legs.push({ path: ent.path, kind: 'entry', conn: ent, ring, lane: rl, s0: 0 });
    legs.push({ path: ring.arc(ent.toTheta!, ex.fromTheta!, rl), kind: 'ring', ring, lane: rl, s0: 0 });
    legs.push({ path: ex.path, kind: 'exit', conn: ex, ring, s0: 0 });
    const te = ex.toEdge!;
    legs.push(this.laneLeg(te, ex.toLane, ex.toLaneS, te.lanes[ex.toLane]!.length, { open: true }));
  }

  // ---- Перешкоди ----

  // Вільні ділянки ребра (координати ref), подалі від переходів, стоп-ліній, зʼєднувачів, зупинок.
  freeSlots(e: NetEdge, clearBefore: number, clearAfter: number, lo: number, hi: number): [number, number][] {
    const O = this.cfg.obstacles;
    const excl: [number, number][] = [];
    for (const f of e.features) excl.push([f.stop - clearBefore, f.zone[1] + clearAfter]);
    for (const d of e.departures) excl.push([d.fromS - O.clearDriveway, d.fromS + 15]);
    for (const d of e.arrivals) excl.push([d.toS - 10, d.toS + O.clearDriveway]);
    for (const b of this.net.data.busStops) if (b.edge === e.id) excl.push([b.s - O.clearBusStop, b.s + O.clearBusStop]);
    excl.sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let from = lo;
    for (const [a, b] of excl) { if (a - from >= 10) out.push([from, Math.min(a, hi)]); from = Math.max(from, b); if (from >= hi) break; }
    if (hi - from >= 10) out.push([from, hi]);
    return out.filter(([a, b]) => b - a >= 10);
  }

  // edges: ребра, на яких можна ставити (≥ 2 смуг). leftClear: [ребро → s, до якого ліва смуга вільна (розворот/лівий)].
  placeObstacles(player: Body, edges: readonly NetEdge[], leftKeep: ReadonlyMap<string, [number, number]>, rightKeep: ReadonlyMap<string, readonly (readonly [number, number])[]> = new Map()): void {
    const O = this.cfg.obstacles;
    const int = (r: readonly [number, number]): number => r[0] + Math.floor(this.rng.next() * (r[1] - r[0] + 1));
    const cw = this.cfg.car.width;
    const total = edges.reduce((a, e) => a + e.length, 0);
    for (const e of edges) {
      const share = e.length / total;
      const widen = e.prev.some((q) => q.n < e.n); // після розширення (1 → 2 смуги) перешкод немає: гравець зі вузької частини має час перестроїтись
      const slots = this.freeSlots(e, O.clearBeforeStop, O.clearAfterZone, widen ? 130 : 40, e.length - 40);
      for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(this.rng.next() * (i + 1)); [slots[i], slots[j]] = [slots[j]!, slots[i]!]; }
      const kinds: NetCarKind[] = [];
      const nb = Math.round(int(O.brokenPerDir) * 2 * share + this.rng.next() * 0.5);
      const np = Math.round(int(O.parkedStretches) * 2 * share + this.rng.next() * 0.5);
      for (let i = 0; i < nb; i++) kinds.push('broken');
      for (let i = 0; i < np; i++) kinds.push('parked');
      for (const kind of kinds) {
        const slot = slots.shift();
        if (!slot) break;
        const rk = rightKeep.get(e.id); // зони без перешкод біля поворотів за маршрутом (перед правим і після посадки)
        if (rk && rk.some((z) => slot[1] > z[0] && slot[0] < z[1])) continue;
        let lane = e.n - 1;
        const keep = leftKeep.get(e.id);
        if (kind === 'broken' && this.rng.next() < O.brokenLeftShare && e.n >= 2 && !(keep && slot[1] > keep[0] && slot[0] < keep[1])) lane = 0;
        const lens: number[] = [];
        const n = kind === 'broken' ? 1 : int(O.parkedPerStretch);
        let tot = 0;
        for (let i = 0; i < n; i++) {
          const len = this.rng.range(4.2, 4.8);
          const gap = i === 0 ? 0 : this.rng.range(O.parkedGap[0], O.parkedGap[1]);
          if (tot + gap + len > slot[1] - slot[0]) break;
          lens.push(gap, len); tot += gap + len;
        }
        let s = slot[0] + this.rng.next() * (slot[1] - slot[0] - tot);
        const off = kind === 'parked' ? e.W / 2 - O.parkedKerbGap - cw / 2 : 0;
        const ln = e.lanes[lane]!;
        for (let i = 0; i < lens.length; i += 2) {
          s += lens[i]!;
          const len = lens[i + 1]!;
          const cRef = s + len / 2;
          s += len;
          const rp = this.net.pose(e, cRef, this.net.laneD(e, lane) + off);
          if (Math.hypot(rp.x - player.box.x, rp.z - player.box.z) < O.playerClear) continue;
          const sl = ln.project(rp.x, rp.z).s;
          this.cars.push({
            id: this.nextId++, legs: [{ path: ln, kind: 'lane', edge: e, lane, s0: 0 }], leg: 0, s: sl, v: 0, v0: 0, len,
            color: this.rng.pick(COLORS), x: rp.x, z: rp.z, a: rp.a, braking: false, kind, hazard: kind === 'broken', turn: 0,
            off, offT: off, lcSig: 0, acc: 0, leadId: -1, plan: null, commit: false, home: lane, merge: false,
          });
        }
      }
    }
  }

  // ---- Наповнення ----

  private moving(): number { let n = 0; for (const c of this.cars) if (c.kind === 'car') n++; return n; }

  private spawnOk(e: NetEdge, lane: number, sLane: number, player: Body, minPlayer: number): boolean {
    const p = e.lanes[lane]!.pose(sLane);
    if (Math.hypot(p.x - player.box.x, p.z - player.box.z) < minPlayer) return false;
    const sRef = e.ref.project(p.x, p.z).s;
    if (e.features.some((f) => sRef > f.stop - 12 && sRef < f.zone[1] + 6)) return false;
    if (e.departures.some((d) => sRef > d.fromS - 6 && sRef < d.fromS + 4) || e.arrivals.some((d) => sRef > d.toS - 4 && sRef < d.toS + 12)) return false;
    for (const c of this.cars) if (Math.hypot(c.x - p.x, c.z - p.z) < (c.kind === 'car' ? 16 : 25)) return false;
    for (const b of this.extra) if (Math.hypot(b.box.x - p.x, b.box.z - p.z) < 25) return false;
    return true;
  }

  private addCar(e: NetEdge, lane: number, sLane: number, v0: number, player: Body, minPlayer = 30): boolean {
    if (this.moving() >= this.cfg.traffic.maxCars) return false;
    if (!this.spawnOk(e, lane, sLane, player, minPlayer)) return false;
    const id = this.nextId++;
    const r = this.planFrom(null, e, lane, sLane, 0);
    if (r.merge && e.lanes[lane]!.length - sLane < 150) return false; // не народжувати в кінці смуги, що закінчується
    const p = r.legs[0]!.path.pose(0);
    this.cars.push({
      id, legs: r.legs, leg: 0, s: 0, v: v0 * 0.8, v0, len: this.rng.range(4.2, 4.8), color: this.rng.pick(COLORS),
      x: p.x, z: p.z, a: p.a, braking: false, kind: 'car', hazard: false, turn: 0, off: 0, offT: 0, lcSig: 0, acc: 0,
      leadId: -1, plan: r.plan, commit: false, home: lane, merge: r.merge,
    });
    return true;
  }

  private v0(): number { return this.rng.range(this.cfg.traffic.streetV[0], this.cfg.traffic.streetV[1]); }

  // Для тестів/сценаріїв: поставити рухоме авто на смугу (без поворотів), якщо місце вільне.
  inject(edgeId: string, lane: number, sLane: number, v: number): NetCar | null {
    const e = this.net.edge(edgeId);
    const p = e.lanes[lane]!.pose(sLane);
    for (const c of this.cars) if (Math.hypot(c.x - p.x, c.z - p.z) < 9) return null;
    const r = this.planFrom(null, e, lane, sLane, 0, false);
    const car: NetCar = {
      id: this.nextId++, legs: r.legs, leg: 0, s: 0, v, v0: Math.max(v, 11), len: 4.5, color: COLORS[0]!, x: p.x, z: p.z, a: p.a,
      braking: false, kind: 'car', hazard: false, turn: 0, off: 0, offT: 0, lcSig: 0, acc: 0, leadId: -1, plan: r.plan, commit: false, home: lane, merge: r.merge,
    };
    this.cars.push(car);
    return car;
  }

  populate(player: Body, extra: readonly Body[] = []): void {
    this.extra = extra;
    for (const e of this.streetEdges) {
      for (let lane = 0; lane < e.n; lane++) {
        const ln = e.lanes[lane]!;
        for (let s = this.rng.range(15, 60); s < ln.length - 20; s += this.rng.range(80, 150)) {
          const p = ln.pose(s);
          const d = Math.hypot(p.x - player.box.x, p.z - player.box.z);
          if (d < SPAWN_R[1] + 20) this.addCar(e, lane, s, this.v0(), player, 35);
        }
      }
    }
  }

  private spawn(dt: number, player: Body): void {
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5;
      // Бульбашка: на випадкових смугах на відстані 210–360 м від гравця.
      for (let k = 0; k < 6; k++) {
        const e = this.rng.pick(this.streetEdges);
        const lane = Math.floor(this.rng.next() * e.n);
        const ln = e.lanes[lane]!;
        const s = this.rng.next() * ln.length;
        const p = ln.pose(s);
        const d = Math.hypot(p.x - player.box.x, p.z - player.box.z);
        if (d < SPAWN_R[0] || d > SPAWN_R[1]) continue;
        // Густота: не більше ~1 авто на 70 м смуги поруч.
        let near = 0;
        for (const c of this.cars) if (c.kind === 'car' && Math.hypot(c.x - p.x, c.z - p.z) < 70) near++;
        if (near >= 2) continue;
        if (this.rng.next() < 0.35) this.addCar(e, lane, s, this.v0(), player, SPAWN_R[0]);
      }
    }
    // Виїзди з бічних вулиць і дворів.
    this.sideT -= dt;
    if (this.sideT <= 0) {
      this.sideT = this.rng.range(this.cfg.turners.sideSpawnInterval[0], this.cfg.turners.sideSpawnInterval[1]) * 0.6;
      const opts = this.net.data.stubs.map((s) => this.net.edge(s.out)).filter((e) => { const p = e.ref.pose(0); const d = Math.hypot(p.x - player.box.x, p.z - player.box.z); return d > 40 && d < 260; });
      if (opts.length) {
        const e = this.rng.pick(opts);
        this.addCar(e, 0, 0, this.rng.range(6, 9), player, 40);
      }
    }
  }

  onLane(c: NetCar, e: NetEdge, lane: number): boolean { const l = c.legs[c.leg]!; return l.kind === 'lane' && l.edge === e && l.lane === lane; }

  // Перебудувати ноги від поточного місця (після перестроювання / скасування повороту).
  private replan(c: NetCar, e: NetEdge, lane: number, sLane: number, allowTurn = true): void {
    if (c.plan && !c.plan.done) this.unlock(c.plan.key, c.id);
    this.holding.delete(c.id);
    const r = this.planFrom(c, e, lane, sLane, c.leg, allowTurn);
    c.legs = [...c.legs.slice(0, c.leg), ...r.legs];
    c.s = 0;
    c.plan = r.plan;
    c.commit = false;
    c.merge = r.merge;
  }

  // ---- Крок ----

  step(t: number, dt: number, player: Body, peds: NetPeds, extra: readonly Body[] = [], playerGhost: Body | null = null, playerStops: (b: Body) => boolean = () => false): void {
    this.t = t;
    this.extra = extra;
    this.playerStops = playerStops;
    this.spawn(dt, player);
    const bodies: Body[] = [player, ...this.cars.map((c) => this.body(c)), ...extra];
    const ghosts: Body[] = playerGhost ? [playerGhost] : [];
    for (const c of this.cars) if (c.kind === 'car' && c.off !== c.offT) ghosts.push(this.ghost(c));
    const LC = this.cfg.aiLaneChange;
    for (const c of this.cars) {
      if (c.kind !== 'car') continue;
      this.laneLogic(c, dt, bodies, ghosts);
      const lead = this.leader(c, t, bodies, player, peds);
      const dv = c.v - lead.v;
      const cur = c.legs[c.leg]!;
      const turning = c.plan !== null && !c.plan.done && (c.commit || c.leg === c.plan.turnLeg);
      const A = turning ? this.cfg.turners.accel : IDM.A;
      const gr = this.grip;
      const sStar = IDM.s0 + Math.max(0, c.v * IDM.T / Math.sqrt(gr) + (c.v * dv) / (2 * Math.sqrt(A * IDM.B * gr)));
      const nextK = c.legs[c.leg + 1]?.kind;
      const nearRing = nextK === 'entry' && cur.path.length - c.s < 50;
      let v0 = (cur.kind === 'lane') && !nearRing ? c.v0 : Math.min(c.v0, this.cfg.traffic.ringV);
      if (cur.edge && (cur.edge.kind === 'side' || cur.edge.kind === 'driveway')) v0 = Math.min(v0, 6);
      // Швидкість у повороті — за радіусом зʼєднувача.
      const turnV = (cn: NetConn): number => Math.min(this.cfg.turners.turnV, Math.sqrt(2.2 * Math.max(2, cn.data.minRadius)));
      if (cur.kind === 'conn' && cur.conn) v0 = Math.min(v0, turnV(cur.conn));
      const nx = c.legs[c.leg + 1];
      if (cur.kind === 'lane' && nx?.kind === 'conn' && nx.conn) {
        const tv = turnV(nx.conn);
        v0 = Math.min(v0, Math.sqrt(tv * tv + 2 * 2 * Math.max(0, cur.path.length - c.s - 4)));
      }
      v0 *= 0.55 + 0.45 * gr; // у негоду їдуть повільніше
      let acc = A * (1 - Math.pow(c.v / Math.max(0.5, v0), 4));
      if (lead.gap < Infinity) acc -= A * Math.pow(sStar / Math.max(0.1, lead.gap), 2);
      acc = Math.max(-IDM.maxDecel * Math.max(0.4, gr), acc);
      c.acc = c.v <= 0 && acc < 0 ? 0 : acc;
      c.leadId = lead.id;
      c.braking = acc < -1;
      c.v = Math.max(0, c.v + acc * dt);
      c.s += c.v * dt;
      let yaw = 0;
      if (c.off !== c.offT) {
        const rate = clamp(LC.latSpeedMin + 0.25 * c.v, LC.latSpeedMin, LC.latSpeed);
        const d = Math.sign(c.offT - c.off) * Math.min(Math.abs(c.offT - c.off), rate * dt);
        c.off += d;
        if (Math.abs(c.off - c.offT) < 1e-6) c.off = c.offT;
        yaw = clamp(Math.atan2(d / dt, Math.max(c.v, 2)), -0.25, 0.25) * Math.min(1, c.v / 2);
        // Перестроювання завершено: перейти на сусідню смугу.
        if (c.off === c.offT && cur.kind === 'lane' && cur.edge && Math.abs(c.offT) > 0.5) {
          const e = cur.edge, lane = cur.lane! + Math.sign(c.offT);
          const p = cur.path.pose(c.s);
          const hx = Math.sin(p.a), hz = -Math.cos(p.a);
          const x = p.x - hz * c.off, z = p.z + hx * c.off;
          const sl = e.lanes[lane]!.project(x, z).s;
          c.off = 0; c.offT = 0; c.lcSig = 0;
          this.replan(c, e, lane, sl);
        }
      }
      let leg = c.legs[c.leg]!;
      while (c.s > leg.path.length && c.leg < c.legs.length - 1) {
        c.s -= leg.path.length;
        if (leg.kind === 'lane') { c.off = 0; c.offT = 0; }
        c.leg++;
        leg = c.legs[c.leg]!;
        if (c.plan && !c.plan.done && c.leg > c.plan.turnLeg) { c.plan.done = true; this.unlock(c.plan.key, c.id); c.commit = false; c.turn = 0; }
        if (leg.open && leg.edge && c.leg === c.legs.length - 1) {
          const s = c.s;
          this.replan(c, leg.edge, leg.lane!, leg.s0);
          c.s = s;
          c.home = leg.lane!;
          leg = c.legs[c.leg]!;
        }
      }
      const p = leg.path.pose(c.s);
      const hx = Math.sin(p.a), hz = -Math.cos(p.a);
      c.x = p.x - hz * c.off; c.z = p.z + hx * c.off; c.a = p.a + yaw;
    }
    const gone = this.cars.filter((c) => c.kind === 'car' && ((c.leg === c.legs.length - 1 && c.s >= c.legs[c.leg]!.path.length - 0.01 && !c.legs[c.leg]!.open) || this.far(c, player)));
    for (const c of gone) { if (c.plan) this.unlock(c.plan.key, c.id); this.holding.delete(c.id); for (const [k, v] of this.locks) if (v === c.id) this.locks.delete(k); }
    if (gone.length) this.cars = this.cars.filter((c) => !gone.includes(c));
  }
  private playerStops: (b: Body) => boolean = () => false;

  private far(c: NetCar, player: Body): boolean { return Math.hypot(c.x - player.box.x, c.z - player.box.z) > DESPAWN_R; }

  // ---- Перестроювання ІІ ----

  private inLane(c: NetCar, bodies: readonly Body[], laneOff: number, from: number, to: number, pred: (b: Body) => boolean): Body | null {
    const leg = c.legs[c.leg]!;
    let best: Body | null = null, bs = Infinity;
    for (const b of bodies) {
      if (b.id === c.id || !pred(b)) continue;
      if (Math.abs(b.box.z - c.z) > to + 20 || Math.abs(b.box.x - c.x) > to + 20) continue;
      const p = projR(leg.path, b.box.x, b.box.z, c.s + from - 10, c.s + to + 10);
      const rel = p.s - c.s;
      if (rel < from || rel > to) continue;
      const da = b.box.a - leg.path.pose(p.s).a;
      const lat = Math.abs(Math.sin(da)) * b.box.hl + Math.abs(Math.cos(da)) * b.box.hw;
      if (Math.abs(p.d - laneOff) >= 1.5 + lat) continue;
      if (rel < bs) { bs = rel; best = b; }
    }
    return best;
  }

  private blocked(c: NetCar, laneOff: number, bodies: readonly Body[]): boolean {
    const LC = this.cfg.aiLaneChange;
    if (this.inLane(c, bodies, laneOff, 0, LC.lookStatic, (b) => b.kind === 'static')) return true;
    return this.inLane(c, bodies, laneOff, 0, LC.lookRider, (b) => b.kind === 'rider' && b.v < c.v0 - LC.slowRiderDv) !== null;
  }

  // Суцільна між смугами: від стоп-лінії − solidBeforeStop до кінця зони кожної особливості ребра.
  private solidAt(e: NetEdge, sRef: number, dist: number): boolean {
    const L = this.cfg.rules.solidBeforeStop;
    return e.features.some((f) => (f.kind === 'signal' || f.kind === 'crossing' || f.kind === 'yield') && sRef + dist >= f.stop - L - 2 && sRef <= f.zone[1] + 2);
  }

  private laneLogic(c: NetCar, dt: number, bodies: readonly Body[], ghosts: readonly Body[]): void {
    const leg = c.legs[c.leg]!;
    let planSig: -1 | 0 | 1 = 0;
    if (c.plan && !c.plan.done) {
      const tl = c.plan.turnLeg;
      if (c.leg === tl) planSig = c.plan.dir;
      else if (c.leg === tl - 1 && leg.path.length - c.s < Math.max(this.cfg.turners.signalDist, c.v * 4)) planSig = c.plan.dir;
    }
    // Зʼїзд з кільця / ноги кільця: правий покажчик перед зʼїздом.
    if (leg.kind === 'ring' && leg.path.length - c.s < 25) planSig = 1;
    if (leg.kind === 'exit') planSig = 1;
    if (leg.kind !== 'lane' || leg.lane === undefined || !leg.edge) { c.turn = planSig; return; }
    if (c.off !== c.offT) { c.turn = c.offT > c.off ? 1 : -1; return; }
    const e = leg.edge, lane = leg.lane, W = e.W;
    const remain = leg.path.length - c.s;
    const toRing = c.legs[c.leg + 1]?.kind === 'entry';
    const pending = c.plan !== null && !c.plan.done;
    const sRef = e.ref.projectRange(c.x, c.z, leg.s0 + c.s - 25, leg.s0 + c.s + 25).s;
    const LC = this.cfg.aiLaneChange;
    const canL = lane > 0, canR = lane < e.n - 1;
    // Перешкода у своїй смузі до місця повороту — поворот скасовується (обʼїзд і прямо).
    if (pending && !c.commit && c.plan!.turnLeg === c.leg + 1 && this.inLane(c, bodies, 0, 0, remain + 3, (b) => b.kind === 'static')) {
      this.replan(c, e, lane, leg.s0 + c.s, false);
      c.turn = 0;
      return;
    }
    const nearEnd = (toRing && remain < 120) || (pending && remain < 60) || remain < 30;
    let want = 0;
    if (c.merge && canL) want = -W;
    else if (!nearEnd) {
      const stat = this.inLane(c, bodies, 0, 0, LC.lookStatic, (b) => b.kind === 'static');
      const slow = !stat && !(pending && remain < 60) && this.blocked(c, 0, bodies);
      if (stat || slow) {
        const free = (off: number): boolean => !this.inLane(c, bodies, off, -10, 40, (b) => b.kind === 'static');
        if (canL && free(-W)) want = -W;
        else if (canR && free(W)) want = W;
      } else if (c.home !== lane && !pending) {
        // Повернення в «свою» смугу, якщо там вільно від перешкод.
        const off = (c.home > lane ? 1 : -1) * W;
        if (!this.inLane(c, bodies, off, -c.len, 50, (b) => b.kind === 'static') && !this.blocked(c, off, bodies)) want = off;
      }
    }
    if (want !== 0 && pending) {
      if (c.commit) want = 0;
      else if (!c.merge) { this.replan(c, e, lane, leg.s0 + c.s, false); planSig = 0; }
    }
    if (want === 0) { c.lcSig = 0; c.turn = planSig; return; }
    c.turn = want > 0 ? 1 : -1;
    c.lcSig += dt;
    const must = c.merge && remain < 60;
    const dist = clamp((c.v * W) / LC.latSpeed, 6, 45);
    if (c.lcSig >= LC.signalS && (must || !this.solidAt(e, sRef, dist)) && (remain > Math.min(dist, 20) || (must && remain > 0.5 && c.v < 1)) && this.gapOK(c, want, bodies, ghosts)) { c.offT = want; c.lcSig = 0; }
  }

  // Хто вливається зі зʼєднувача в смугу (edge, lane): віртуальна позиція (s смуги) за ≤ 30 м до злиття.
  private mergersInto(e: NetEdge, lane: number, exceptId: number): { s: number; v: number; len: number }[] {
    const out: { s: number; v: number; len: number }[] = [];
    for (const q of this.cars) {
      if (q.id === exceptId || q.kind !== 'car') continue;
      const ql = q.legs[q.leg]!;
      const qn = q.legs[q.leg + 1];
      if (ql.kind === 'conn' && ql.conn && ql.conn.toEdge === e && ql.conn.toLane === lane) {
        const rem = ql.path.length - q.s;
        if (rem < 30) out.push({ s: ql.conn.toLaneS - rem, v: q.v, len: q.len });
      } else if (ql.kind === 'lane' && qn?.kind === 'conn' && qn.conn && qn.conn.toEdge === e && qn.conn.toLane === lane && q.commit) {
        const rem = ql.path.length - q.s + qn.path.length;
        if (rem < 30) out.push({ s: qn.conn.toLaneS - rem, v: q.v, len: q.len });
      }
    }
    return out;
  }

  private gapOK(c: NetCar, offTarget: number, bodies: readonly Body[], ghosts: readonly Body[]): boolean {
    const leg = c.legs[c.leg]!;
    const half = c.len / 2;
    if (leg.kind === 'lane' && leg.edge && Math.abs(offTarget) > 0.5) {
      const tl = leg.lane! + Math.sign(offTarget);
      const me = leg.s0 + c.s;
      for (const m of this.mergersInto(leg.edge, tl, c.id)) {
        const rel = m.s - me;
        const gap = Math.abs(rel) - half - m.len / 2;
        const need = rel >= 0 ? 4 + c.v * 0.8 + Math.max(0, c.v - m.v) * 1.5 : 4 + m.v * 0.8 + Math.max(0, m.v - c.v) * 1.6;
        if (gap < need) return false;
      }
    }
    for (const list of [bodies, ghosts]) {
      for (const b of list) {
        if (b.id === c.id) continue;
        if (Math.abs(b.box.z - c.z) > 90 || Math.abs(b.box.x - c.x) > 90) continue;
        const p = projR(leg.path, b.box.x, b.box.z, c.s - 95, c.s + 95);
        if (Math.abs(p.s - c.s) > 90) continue;
        const da = b.box.a - leg.path.pose(p.s).a;
        const lat = Math.abs(Math.sin(da)) * b.box.hl + Math.abs(Math.cos(da)) * b.box.hw;
        const lon = Math.abs(Math.cos(da)) * b.box.hl + Math.abs(Math.sin(da)) * b.box.hw;
        const bv = b.v * Math.cos(da);
        const rel = p.s - c.s;
        let gap: number, need: number;
        if (Math.abs(p.d - offTarget) >= 1.4 + lat) {
          const lo = Math.min(c.off, offTarget) - 1.2 - lat, hi = Math.max(c.off, offTarget) + 1.2 + lat;
          if (b.kind !== 'rider' || p.d < lo || p.d > hi || (b.v < 0.3 && rel > 0)) continue;
          gap = Math.abs(rel) - half - lon;
          need = rel >= 0 ? 3 + Math.max(0, c.v - bv) * 3 : 4 + Math.max(0, bv - c.v) * 3;
          if (gap < need) return false;
          continue;
        }
        if (rel >= 0) { gap = rel - half - lon; need = 4 + c.v * 0.8 + Math.max(0, c.v - bv) * 1.5 + (b.kind === 'static' ? 4 : 0); }
        else { gap = -rel - half - lon; need = b.id === 0 ? 8 + bv * 1.6 + Math.max(0, bv - c.v) * 2.5 : 4 + bv * 0.8 + Math.max(0, bv - c.v) * 1.6; }
        if (gap < need) return false;
      }
    }
    return true;
  }

  private ghost(c: NetCar): Body {
    const p = c.legs[c.leg]!.path.pose(c.s);
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    return { id: c.id, box: { x: p.x - hz * c.offT, z: p.z + hx * c.offT, a: p.a, hl: c.len / 2, hw: this.cfg.car.width / 2 }, v: c.v, kind: 'car' };
  }

  // ---- Повороти: чи можна їхати ----

  private firstInLine(c: NetCar, leg: NetLeg, remain: number, player?: Body): boolean {
    if (player) {
      const p = projR(leg.path, player.box.x, player.box.z, c.s - 5, leg.path.length + 2);
      if (Math.abs(p.d) < 1.6 && p.s > c.s && p.s < leg.path.length + 6) return false;
    }
    for (const q of this.cars) {
      if (q === c || q.kind !== 'car') continue;
      if (Math.abs(q.x - c.x) > remain + 8 || Math.abs(q.z - c.z) > remain + 8) continue;
      const p = projR(leg.path, q.x, q.z, c.s - 5, leg.path.length + 2);
      if (Math.abs(p.d) < 1.6 && p.s > c.s && p.s < leg.path.length + 1) return false;
    }
    return true;
  }

  private no(reason: string): false { this.why.set(this.whyId, reason); return false; }

  // Тіло зупиниться перед своєю червоною стоп-лінією (і встигає спокійно)?
  private willStopAtRed(b: Body, t: number, minRed: number): boolean {
    if (b.id === 0) return this.playerStops(b);
    if (b.kind === 'rider' && this.riders) {
      const r = this.riders.list.find((q) => q.id === b.id);
      if (!r) return false;
      const front = r.s + r.len / 2;
      for (const f of r.edge.features) {
        if (f.kind !== 'signal' || !f.ctrl || !f.group) continue;
        const d = f.stop - front;
        if (d < -0.5 || d > 60) continue;
        const l = this.net.light(f.ctrl, f.group, t, this.cfg.signals);
        if ((isStopLight(l) || (l === 'yellow' && d > (r.v * r.v) / 5 + 0.5)) && this.net.timing(f.ctrl, f.group, t, this.cfg.signals).untilGreen > minRed) return true;
      }
      return false;
    }
    const c = this.byId.get(b.id);
    if (!c) return false;
    const leg = c.legs[c.leg]!;
    if (leg.kind !== 'lane' || !leg.edge) return false;
    const front = leg.s0 + c.s + c.len / 2;
    for (const f of leg.edge.features) {
      if (f.kind !== 'signal' || !f.ctrl || !f.group) continue;
      const d = f.laneStop[leg.lane!]! - front;
      if (d < -0.5 || d > 70) continue;
      const l = this.net.light(f.ctrl, f.group, t, this.cfg.signals);
      const tm = this.net.timing(f.ctrl, f.group, t, this.cfg.signals);
      const stopping = isStopLight(l) || (l === 'yellow' && d > (c.v * c.v) / 6 + 1);
      if (stopping && tm.untilGreen > minRed) return true;
    }
    return false;
  }
  private byId = new Map<number, NetCar>();

  private canTurn(c: NetCar, t: number, bodies: readonly Body[], peds: NetPeds): boolean {
    this.whyId = c.id;
    const plan = c.plan!;
    const T = this.cfg.turners;
    const cn = plan.conn;
    const pre = c.legs[c.leg]!, tl = c.legs[plan.turnLeg]!, after = c.legs[plan.turnLeg + 1];
    const remain = pre.path.length - c.s;
    const tv = Math.min(T.turnV, Math.sqrt(2.2 * Math.max(2, cn.data.minRadius)));
    const Tc = clearTime(remain + tl.path.length + c.len + 3, c.v, T.accel, tv);
    // Світлофор: лише на зелений і щоб встигнути до кінця зеленого (інакше — чекати наступного).
    // Уже за стоп-лінією (у перехресті) — звільнити його незалежно від світлофора.
    let passed = false;
    if (cn.ctrl && pre.kind === 'lane' && pre.edge) {
      const front = pre.s0 + c.s + c.len / 2;
      for (const f of pre.edge.features) if (f.kind === 'signal' && f.ctrl === cn.ctrl && f.laneStop[pre.lane!]! <= cn.fromLaneS + 0.5 && front > f.laneStop[pre.lane!]! + 0.5) passed = true;
    }
    if (cn.ctrl && cn.group && !passed) {
      const l = this.net.light(cn.ctrl, cn.group, t, this.cfg.signals);
      const tm = this.net.timing(cn.ctrl, cn.group, t, this.cfg.signals);
      if (!(l === 'green' || l === 'greenBlink') || tm.goLeft < Math.min(Tc, 6) * 0.6) return this.no('signal');
    }
    // Пішоходи на переходах на шляху повороту та на початку цільового ребра.
    const M = this.cfg.rules.pedConflictMargin + 1.5;
    for (const x of cn.crossings) if (peds.conflict(x.crossing.id, x.u - 2.5, x.u + 2.5, M)) return this.no('ped ' + x.crossing.id);
    if (after?.kind === 'lane' && after.edge) {
      for (const f of after.edge.features) {
        if (f.kind !== 'crossing' || !f.crossing) continue;
        const d = f.laneStop[after.lane!]! - after.s0;
        if (d > 18 || f.laneZone[after.lane!]![1] - after.s0 < 0) continue;
        if (peds.conflictEdge(f.crossing.id, after.edge.id, M)) return this.no('ped landing');
      }
    }
    const pts: { x: number; z: number }[] = [];
    for (let s = 0; s <= tl.path.length; s += 1.5) pts.push(tl.path.pose(s));
    if (after) for (let s = 1.5; s <= Math.min(14, after.path.length); s += 1.5) pts.push(after.path.pose(s));
    const samples = plan.fromMain && pre.kind === 'lane' ? pts.filter((q) => Math.abs(projR(pre.path, q.x, q.z, c.s - 10, pre.path.length + 30).d) > 1.2) : pts;
    const cw = this.cfg.car.width / 2;
    const queued = (id: number): boolean => {
      const q = this.byId.get(id);
      if (!q || q.leadId <= 0) return false;
      const l = this.byId.get(q.leadId);
      return l !== undefined && l.v < 0.3;
    };
    const signalised = !!cn.ctrl;
    for (const b of bodies) {
      if (b.id === c.id) continue;
      if (Math.abs(b.box.x - c.x) > 150 || Math.abs(b.box.z - c.z) > 150) continue;
      const bc = this.byId.get(b.id);
      // Хто підʼїжджає до свого повороту нижчого рангу й ще не почав — поступиться сам.
      // (лише якщо він уже біля свого місця повороту на цьому ж перехресті)
      if (bc && bc.plan && !bc.plan.done && !bc.commit && bc.leg === bc.plan.turnLeg - 1 && bc.legs[bc.leg]!.path.length - bc.s < 25) {
        const bp = bc.plan.conn;
        if (bp !== cn && bp.rank < cn.rank && bp.junction !== null && bp.junction === cn.junction) continue;
        if (bc.plan.key && bc.plan.key === plan.key) continue; // той самий замок
      }
      const pp = projR(pre.path, b.box.x, b.box.z, c.s - 45, pre.path.length + 15);
      // Правий з головної: поступитися райдеру біля бордюру (крім того, хто стоїть позаду — він чекає на нас).
      if (plan.fromMain && !plan.left && b.kind === 'rider' && pp.s > c.s - 30 && pp.s < c.s + 12 && Math.abs(pp.d) < 3 && !(b.v < 0.5 && pp.s < c.s - 2)) return this.no('rider ' + b.id);
      if (plan.fromMain && b.kind === 'static' && Math.abs(pp.d) < 2.4 && pp.s > c.s && pp.s < pre.path.length + 3) return this.no('static ' + b.id);
      if (Math.abs(pp.d) < 1.5 && pp.s < c.s) continue;
      const hx = Math.sin(b.box.a), hz = -Math.cos(b.box.a);
      const still = b.v < 0.3;
      let minT = Infinity, inside = false;
      // Прогноз уздовж власного шляху тіла (на кривих), інакше — по прямій.
      const bp = b.path, bs = b.ps ?? 0, bn = b.next;
      const rel = (q: { x: number; z: number }): { fwd: number; lat: number } => {
        if (bp) {
          const pq = projR(bp, q.x, q.z, bs - 6, bs + 130);
          if (pq.s >= bs - 6 && pq.s <= bp.length + 0.5) return { fwd: pq.s - bs, lat: pq.d };
          if (bn && pq.s > bp.length) { const nq = projR(bn, q.x, q.z, 0, 130); if (nq.s >= -0.5) return { fwd: bp.length - bs + nq.s, lat: nq.d }; }
        }
        const dx = q.x - b.box.x, dz = q.z - b.box.z;
        return { fwd: dx * hx + dz * hz, lat: dx * -hz + dz * hx };
      };
      for (const q of samples) {
        const { fwd, lat } = rel(q);
        if (Math.abs(lat) > b.box.hw + cw + 0.6) continue;
        if (fwd < -(b.box.hl + cw + 0.5)) continue;
        if (fwd <= b.box.hl + cw + 0.5) { inside = true; break; }
        if (b.kind === 'static' || b.kind === 'ped') continue;
        let v = b.v;
        if (signalised && !still && this.willStopAtRed(b, t, Tc + 1)) continue;
        if (still) {
          if (this.holding.has(b.id) || queued(b.id)) continue;
          if (this.willStopAtRed(b, t, Tc + 1)) continue;
          if (fwd > 30) continue;
          v = 2.5;
        } else if (b.id === 0) v = Math.max(v, 8); // гравець, що розганяється: рахуємо наперед, а не за поточною швидкістю
        minT = Math.min(minT, (fwd - b.box.hl - cw - 0.5) / Math.max(v, 0.1));
      }
      if (c.id === this.debugId) console.log('  canTurn', c.id, 'body', b.id, b.kind, 'v', b.v.toFixed(1), 'minT', minT.toFixed(2), 'Tc', Tc.toFixed(2), 'inside', inside);
      if (inside) return this.no('inside ' + b.id);
      if (minT < Tc + (b.id === 0 ? T.marginPlayer : T.marginAI)) return this.no(`tta ${b.id} ${minT.toFixed(1)}<${Tc.toFixed(1)}`);
      if (after && b.v < 4) {
        const q = projR(after.path, b.box.x, b.box.z, 0, 20);
        if (Math.abs(q.d) < 2.2 && q.s > -3 && q.s < 15) return this.no('landing ' + b.id);
      }
    }
    this.why.delete(c.id);
    return true;
  }

  body(c: NetCar): Body {
    const leg = c.legs[c.leg]!;
    const k = leg.kind;
    const kind: BodyKind = c.kind !== 'car' ? 'static' : k === 'conn' ? 'turner' : 'car';
    return { id: c.id, box: { x: c.x, z: c.z, a: c.a, hl: c.len / 2, hw: this.cfg.car.width / 2 }, v: c.v, kind, path: leg.path, ps: c.s, next: c.legs[c.leg + 1]?.path };
  }

  // Ті, хто їде кільцем (і ті, хто от-от зіллється з інших рукавів).
  ringBodies(ring: NetRing, exceptConn?: NetConn): Body[] {
    const out: Body[] = [];
    for (const c of this.cars) {
      const leg = c.legs[c.leg]!;
      if (leg.ring !== ring) continue;
      if (leg.kind === 'ring') out.push(this.body(c));
      else if (leg.kind === 'entry' && leg.conn !== exceptConn && !(exceptConn && leg.conn?.fromEdge === exceptConn.fromEdge) && leg.path.length - c.s < 12) {
        const m = leg.path.pose(leg.path.length);
        out.push({ id: c.id, box: { x: m.x, z: m.z, a: m.a, hl: c.len / 2, hw: this.cfg.car.width / 2 }, v: Math.max(c.v, 3) });
      }
    }
    return out;
  }

  private leader(c: NetCar, t: number, bodies: Body[], player: Body, peds: NetPeds): { gap: number; v: number; id: number } {
    let gap = Infinity, lv = 0, lid = -1;
    const consider = (g: number, v: number, id = -1): void => { if (g < gap) { gap = g; lv = v; lid = id; } };
    const leg = c.legs[c.leg]!;
    const next = c.legs[c.leg + 1];
    const front = c.s + c.len / 2;
    const remain = leg.path.length - c.s;
    const off = leg.kind === 'lane' ? c.off : 0;
    const changing = c.off !== c.offT;
    const standoff = changing ? 0 : this.cfg.aiLaneChange.staticStandoff;
    const cw = this.cfg.car.width / 2;

    const R2 = (LOOK + 10) * (LOOK + 10);
    for (const b of bodies) {
      if (b.id === c.id) continue;
      const ddx = b.box.x - c.x, ddz = b.box.z - c.z;
      if (ddx * ddx + ddz * ddz > R2) continue;
      const kind = b.kind ?? 'car';
      const precise = kind === 'turner' || kind === 'rider' || kind === 'ped' || kind === 'static' || kind === 'player';
      let ps: number | null = null, pa = 0;
      const p = projR(leg.path, b.box.x, b.box.z, c.s - 15, c.s + LOOK + 5);
      const latOf = (a: number): number => (precise ? Math.abs(Math.sin(b.box.a - a)) * b.box.hl + Math.abs(Math.cos(b.box.a - a)) * b.box.hw : cw);
      const corridor = (a: number): number => (kind === 'static' && changing ? cw + 0.2 : LANE_HALF - cw) + latOf(a);
      const abreast = (b.id === 0 || (b.id < c.id && (kind === 'car' || kind === 'turner'))) && Math.abs(p.d - off) > 0.6 ? c.len * 0.4 : 0;
      if (p.s > c.s - abreast - 3 && p.s <= leg.path.length + 1) {
        const a = leg.path.pose(p.s).a;
        if (Math.abs(p.d - off) < corridor(a) && p.s > c.s - abreast) { ps = p.s; pa = a; }
      }
      if (ps === null && next && remain < LOOK) {
        const q = projR(next.path, b.box.x, b.box.z, 0, LOOK - remain + 5);
        if (q.s >= -1 && q.s < LOOK - remain) {
          const a = next.path.pose(q.s).a;
          if (Math.abs(q.d) < corridor(a)) { ps = leg.path.length + q.s; pa = a; }
        }
      }
      if (ps === null || ps - c.s > LOOK) continue;
      if (b.id !== 0 && b.id > c.id && (kind === 'car' || kind === 'turner') && ps - c.s < c.len) continue;
      const da = b.box.a - pa;
      const half = Math.abs(Math.cos(da)) * b.box.hl + Math.abs(Math.sin(da)) * b.box.hw;
      consider(Math.max(0.1, ps - front - half - (kind === 'static' ? standoff : 0)), Math.max(0, b.v * Math.cos(da)), b.id);
    }

    // Хто вже вливається в мою смугу зі зʼєднувача (розворот, виїзд з двору, правий з бічної): стати за ним.
    if (leg.kind === 'lane' && leg.edge) {
      for (const q of this.cars) {
        if (q === c || q.kind !== 'car') continue;
        const ql = q.legs[q.leg]!;
        if (ql.kind !== 'conn' || !ql.conn || ql.conn.toEdge !== leg.edge || ql.conn.toLane !== leg.lane) continue;
        const remainQ = ql.path.length - q.s;
        if (remainQ > 30 || !(q.commit || q.plan === null || q.plan.done || q.leg === q.plan.turnLeg)) continue;
        const virt = ql.conn.toLaneS - leg.s0 - remainQ;
        if (virt < c.s - c.len * 0.5 || virt - c.s > LOOK) continue;
        consider(Math.max(0.1, virt - front - q.len / 2), q.v, q.id);
      }
    }

    // Світлофори й переходи на цій і наступній нозі-смузі.
    const feats = (lg: NetLeg, base: number): void => {
      if (lg.kind !== 'lane' || !lg.edge) return;
      const e = lg.edge, ln = lg.lane!;
      for (const f of e.features) {
        const d = f.laneStop[ln]! - lg.s0 - front + base;
        if (d < -0.5 || d > LOOK) continue;
        if (f.kind === 'signal' && f.ctrl && f.group) {
          const l = this.net.light(f.ctrl, f.group, t, this.cfg.signals);
          if (isStopLight(l) || (l === 'yellow' && d > (c.v * c.v) / 6 + 1)) consider(d, 0);
        }
        if (f.kind === 'crossing' && f.crossing && peds.conflictEdge(f.crossing.id, e.id, this.cfg.rules.pedConflictMargin)) consider(d, 0);
        if (f.kind === 'giveWay' && !(c.plan && !c.plan.done && c.commit)) { /* поступка — у плані повороту */ }
      }
      for (const j of peds.jaywalkersOn(e.id, this.cfg.rules.pedConflictMargin)) {
        const sl = e.lanes[ln]!.project(...this.lineXZ(e, j.s, ln)).s;
        const d = sl - 3 - lg.s0 - front + base;
        if (d > -2.5 && d < LOOK) consider(Math.max(0.1, d), 0);
      }
    };
    feats(leg, 0);
    if (next && remain < LOOK) feats(next, leg.path.length);

    // Не зупинятися на переході / в перехресті: якщо авто попереду стоїть так, що задня частина опиниться в зоні — чекати перед нею.
    if (gap < LOOK && (lv < 1 || (lid > 0 && remain - gap < 18)) && leg.kind === 'lane' && leg.edge) {
      const e = leg.edge, ln = leg.lane!;
      const stopFront = front + gap;
      for (const f of e.features) {
        if (f.kind !== 'crossing' && f.kind !== 'signal') continue;
        const z0 = f.laneZone[ln]![0] - leg.s0, z1 = f.laneZone[ln]![1] - leg.s0, st = f.laneStop[ln]! - leg.s0;
        if (st - front < 0.5) continue; // уже за стоп-лінією
        if (stopFront > z0 - 0.3 && stopFront - c.len < z1 + 0.5) consider(Math.max(0.1, st - front), 0);
      }
    }

    // Поворот: «Дати дорогу» в точці початку повороту. Лівий з головної бронює перехрестя заздалегідь.
    this.holding.delete(c.id);
    if (c.plan && !c.plan.done && c.leg === c.plan.turnLeg - 1 && !c.commit && this.firstInLine(c, leg, remain, player)) {
      const plan = c.plan;
      let g: number | null = null;
      const atTurn = remain - c.len / 2 - 0.2;
      const decide = remain < Math.max(4, (c.v * c.v) / 5 + 3);
      if (decide) {
        if (!this.lockFree(plan.key, c.id)) g = atTurn;
        else if (this.canTurn(c, t, bodies, peds)) { this.tryLock(plan.key, c.id); c.commit = true; }
        else g = atTurn;
      }
      if (g !== null) { consider(Math.max(0.1, g), 0); if (c.v < 0.5) this.holding.add(c.id); }
    }

    // Смуга закінчується — стояти перед кінцем, доки не перестроїться.
    if (leg.kind === 'lane' && c.merge && c.off === c.offT) consider(Math.max(0.1, remain - 8 - c.len / 2), 0);

    // Зʼїзд із внутрішньої смуги перетинає зовнішню: поступитися тим, хто в зовнішній поруч.
    if (leg.kind === 'ring' && leg.lane === 0 && next?.kind === 'exit' && remain < 16 && leg.ring) {
      if (outerNearExitN(leg.ring, next.conn!.fromTheta!, bodies, c.id)) consider(remain - 1, 0);
    }

    // «Дати дорогу» перед кільцем.
    const entry = next?.kind === 'entry' ? next : leg.kind === 'entry' ? leg : null;
    if (entry && (leg.kind === 'entry' || remain < LOOK)) {
      const stopAt = leg.kind === 'entry' ? Math.min(leg.path.length - 5, entry.conn!.yieldS - 0.3) : leg.path.length - 0.3;
      // Час, щоб звільнити точку злиття: до неї + довжина авто, зі швидкістю не менше 3 м/с.
      const toMerge = (leg.kind === 'entry' ? leg.path.length - c.s : remain + entry.path.length) + c.len;
      const tClear = toMerge / Math.max(3, Math.min(c.v, this.cfg.traffic.ringV)) + 1;
      if (front < stopAt && this.mustYieldRing(c, entry, player, leg.kind === 'entry' ? Math.max(2.5, tClear) : Math.max(this.cfg.rules.ringYieldTime + 2, tClear))) {
        consider(stopAt - front + (leg.kind === 'entry' ? 0 : 0.3), 0);
      }
    }
    return { gap, v: lv, id: lid };
  }

  private lineXZ(e: NetEdge, s: number, lane: number): [number, number] {
    const p = this.net.pose(e, s, this.net.laneD(e, lane));
    return [p.x, p.z];
  }

  private mustYieldRing(c: NetCar, entry: NetLeg, player: Body, time: number): boolean {
    const ring = entry.ring!;
    const theta = entry.conn!.toTheta!;
    const ringPlayer = Math.abs(Math.hypot(player.box.x - ring.cx, player.box.z - ring.cz) - ring.r) < ring.laneWidth + 0.5 ? [player] : [];
    return ringBusyN(ring, theta, [...ringPlayer, ...this.ringBodies(ring, entry.conn)], c.id, time);
  }

  // Викликати перед step (оновлює індекс за id).
  index(): void { this.byId = new Map(this.cars.map((q) => [q.id, q])); }

  // ---- Допоміжне для судді/автопілота ----
  isTurning(c: NetCar): boolean { return !!c.plan && !c.plan.done && (c.commit || c.leg === c.plan.turnLeg); }
  feature(c: NetCar): NetFeature | null { void c; return null; }
}

// Чи наближається хтось по кільцю до точки вʼїзду theta: доїде менш ніж за time секунд або вже поруч.
export function ringBusyN(ring: NetRing, theta: number, bodies: readonly Body[], exceptId: number, time: number): boolean {
  const { cx, cz, r } = ring;
  return bodies.some((b) => {
    if (b.id === exceptId) return false;
    const dr = Math.hypot(b.box.x - cx, b.box.z - cz) - r;
    if (Math.abs(dr) > ring.laneWidth + 0.5) return false;
    const th = Math.atan2(-(b.box.z - cz), b.box.x - cx);
    const up = mod(theta - th, 2 * Math.PI) * r;
    return up <= 7 || up / Math.max(1, b.v) < time;
  });
}

export function outerNearExitN(ring: NetRing, exitTheta: number, bodies: readonly Body[], exceptId: number): boolean {
  const rOut = ring.laneR(1);
  return bodies.some((b) => {
    if (b.id === exceptId) return false;
    if (Math.abs(Math.hypot(b.box.x - ring.cx, b.box.z - ring.cz) - rOut) > 1.5) return false;
    const th = Math.atan2(-(b.box.z - ring.cz), b.box.x - ring.cx);
    const rel = (mod(th - exitTheta + Math.PI, 2 * Math.PI) - Math.PI) * rOut;
    return rel > -16 && rel < 6;
  });
}

export type { Box };
