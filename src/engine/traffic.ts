// Інші учасники руху: слідування за лідером (IDM), світлофори, пішоходи, «Дати дорогу» перед кільцем,
// перешкоди в смугах (припарковані/зламані), обʼїзд сусідньою смугою, повороти з/на Мрії.

import type { SimConfig } from './config';
import { bezierPath, clamp, line, mod, type Box, type Path, type Pose } from './geometry';
import type { Pedestrians } from './peds';
import type { Rng } from './rng';
import type { ArmId, Dir, Feature, RingLane, RouteNet } from './route';
import { isStopLight, lightAt } from './signals';

// player — гравець; car — ІІ у своїй смузі; turner — ІІ на повороті/поперечній вулиці;
// static — припарковане/зламане; rider — вело/самокат; ped — пішохід на дорозі.
export type BodyKind = 'player' | 'car' | 'turner' | 'static' | 'rider' | 'ped';
export interface Body {
  readonly id: number; readonly box: Box; readonly v: number; readonly kind?: BodyKind;
  // (мережа, маршрут №1) шлях, яким тіло рухається, і його s на ньому — для прогнозу на кривих
  readonly path?: Path; readonly ps?: number; readonly next?: Path;
}

export type LegKind = 'lane' | 'stub' | 'entry' | 'ring' | 'exit' | 'turn' | 'side';
export interface Leg { readonly path: Path; readonly kind: LegKind; readonly dir?: Dir; readonly arm?: ArmId; readonly sOffset?: number; readonly lane?: RingLane }

export type CarKind = 'car' | 'parked' | 'broken';

interface TurnPlan {
  readonly key: string;         // замок перехрестя ('' — без замка, виїзд із двору)
  readonly dir: -1 | 1;         // покажчик: -1 ліворуч, 1 праворуч
  readonly turnLeg: number;     // індекс ноги 'turn'
  readonly fromMain: boolean;   // з Мрії (true) чи на Мрію (false)
  readonly left: boolean;
  readonly feature: Feature | null;
  done: boolean;
}

export interface Car {
  readonly id: number;
  legs: Leg[];
  leg: number;
  s: number;
  v: number;
  readonly v0: number;
  readonly len: number;
  readonly color: number;
  x: number; z: number; a: number;
  braking: boolean;
  readonly kind: CarKind;   // 'parked' | 'broken' — нерухомі (v = 0), у тому ж масиві, щоб бути тілами для всіх
  hazard: boolean;          // аварійка (усі 4 покажчики блимають)
  turn: -1 | 0 | 1;         // покажчик повороту: -1 лівий, 1 правий
  off: number;              // бічний зсув від осі своєї смуги (+ праворуч), м
  offT: number;             // ціль зсуву (0 — своя смуга, ±laneWidth — сусідня)
  lcSig: number;            // скільки вже блимає перед перестроюванням
  acc: number;              // прискорення на останньому кроці, м/с²
  leadId: number;           // id тіла, через яке гальмує (-1 — стоп-лінія тощо)
  plan: TurnPlan | null;
  commit: boolean;          // поворот розпочато (має пріоритет)
}

interface MainTurn { key: string; dir: Dir; lane: 0 | 1; sTurn: number; turn: Path; out: Path; sign: -1 | 1; left: boolean; feature: Feature | null }
interface SideTurn { key: string; inPath: Path; turn: Path; dir: Dir; lane: 0 | 1; sJoin: number; sign: -1 | 1; left: boolean; feature: Feature | null }

const IDM = { A: 1.6, B: 2.5, s0: 2.2, T: 1.3, maxDecel: 9 };
const LOOK = 80;
const LANE_HALF = 2.4; // половина смуги + запас на габарит сусіда (смуги через 3.5 м)
const COLORS = [0xd6362f, 0xececec, 0x2a9d6a, 0xe6b422, 0x7a4fd6, 0xe07a2f, 0x3b3f4a, 0x9aa3ad];
const HEAD = { S: Math.PI, N: 0, E: Math.PI / 2, W: -Math.PI / 2 };

// Час проїхати dist з поточної v, розганяючись з a до vmax.
function clearTime(dist: number, v0: number, a: number, vmax: number): number {
  if (v0 >= vmax) return dist / vmax;
  const t1 = (vmax - v0) / a, d1 = ((v0 + vmax) / 2) * t1;
  if (dist <= d1) return (-v0 + Math.sqrt(v0 * v0 + 2 * a * dist)) / a;
  return t1 + (dist - d1) / vmax;
}

export class Traffic {
  cars: Car[] = [];
  private nextId = 1;
  private ringT: number;
  private sideT: number;
  private readonly mainTurns: MainTurn[] = [];
  private readonly sideTurns: SideTurn[] = [];
  private readonly locks = new Map<string, number>();
  readonly holding = new Set<number>(); // хто стоїть на «Дати дорогу»/чекає замка (не рушить без перевірки)
  private extra: readonly Body[] = [];

  constructor(private readonly cfg: SimConfig, private readonly net: RouteNet, private readonly rng: Rng) {
    this.ringT = rng.range(1, 3);
    this.sideT = rng.range(4, 10);
    this.buildTurns();
  }

  // ---- Геометрія поворотів ----

  private buildTurns(): void {
    const net = this.net;
    const E = net.carriageway.N[1];
    const cl = this.cfg.turners.crossLaneOffset;
    const xL = (dir: Dir, lane: 0 | 1): number => net.lanes[dir][lane].pose(0).x;
    const P = (x: number, z: number, a: number): Pose => ({ x, z, a });
    const main = (key: string, dir: Dir, lane: 0 | 1, z: number, end: Pose, out: Path, sign: -1 | 1, feature: Feature | null, d0 = 3.5, d1 = 3.5): void => {
      const start = P(xL(dir, lane), z, HEAD[dir]);
      this.mainTurns.push({ key, dir, lane, sTurn: net.sAt(dir, z), turn: bezierPath(start, end, d0, d1, 20), out, sign, left: sign === -1, feature });
    };
    const side = (key: string, inPath: Path, dir: Dir, lane: 0 | 1, zJoin: number, sign: -1 | 1, feature: Feature | null, d0 = 3.5, d1 = 3.5): void => {
      const st = inPath.pose(inPath.length);
      const turn = bezierPath(st, P(xL(dir, lane), zJoin, HEAD[dir]), d0, d1, 20);
      this.sideTurns.push({ key, inPath, turn, dir, lane, sJoin: net.sAt(dir, zJoin), sign, left: sign === -1, feature });
    };
    for (const f of net.features) {
      if (f.def.kind !== 'intersection' || f.def.uturn) continue; // на перехресті розвороту — без поворотів ІІ
      const wz = f.worldZ, key = f.def.id;
      if (f.def.side !== 'E') { // захід
        const out = line({ x: -(E + 4.5), z: wz - cl }, { x: -80, z: wz - cl });
        main(key, 'S', 1, wz - 8, P(-(E + 4.5), wz - cl, HEAD.W), out, 1, f);
        main(key, 'N', 0, wz + 2, P(-(E + 4.5), wz - cl, HEAD.W), out, -1, f, 5, 6);
        const inW = line({ x: -80, z: wz + cl }, { x: -(E + 3), z: wz + cl });
        side(key, inW, 'S', 1, wz + 9, 1, f);
        side(key, inW, 'N', 0, wz - 9, -1, f, 6, 5);
      }
      if (f.def.side !== 'W') { // схід
        const out = line({ x: E + 4.5, z: wz + cl }, { x: 80, z: wz + cl });
        main(key, 'N', 1, wz + 8, P(E + 4.5, wz + cl, HEAD.E), out, 1, f);
        main(key, 'S', 0, wz - 2, P(E + 4.5, wz + cl, HEAD.E), out, -1, f, 5, 6);
        const inE = line({ x: 80, z: wz - cl }, { x: E + 3, z: wz - cl });
        side(key, inE, 'N', 1, wz - 9, 1, f);
        side(key, inE, 'S', 0, wz + 9, -1, f, 6, 5);
      }
    }
    for (const d of net.driveways) {
      const sg = d.sign, back = d.dir === 'S' ? -1 : 1; // back: куди «проти руху» по Z
      const out = line({ x: sg * (E + 4.5), z: d.inZ }, { x: sg * (E + d.depth), z: d.inZ });
      main('', d.dir, 1, d.worldZ + back * 7.5, P(sg * (E + 4.5), d.inZ, sg === 1 ? HEAD.E : HEAD.W), out, 1, null);
      const inP = line({ x: sg * (E + d.depth), z: d.outZ }, { x: sg * (E + 3), z: d.outZ });
      side('', inP, d.dir, 1, d.worldZ - back * 8, 1, null);
    }
  }

  // ---- Замки перехресть (один поворот за раз на перехресті) ----

  lockFree(key: string, id: number): boolean { return !key || !this.locks.has(key) || this.locks.get(key) === id; }
  tryLock(key: string, id: number): boolean {
    if (!this.lockFree(key, id)) return false;
    if (key) this.locks.set(key, id);
    return true;
  }
  unlock(key: string, id: number): void { if (key && this.locks.get(key) === id) this.locks.delete(key); }

  // ---- Перешкоди ----

  // Вільні від переходів/перехресть/дворів/зупинок ділянки напрямку dir (у координатах s цього напрямку).
  freeSlots(dir: Dir, clearBefore: number, clearAfter: number, lo: number, hi: number): [number, number][] {
    const O = this.cfg.obstacles;
    const excl: [number, number][] = [];
    for (const f of this.net.features) excl.push([f.stop[dir] - clearBefore, f.zone[dir][1] + clearAfter]);
    for (const d of this.net.driveways) if (d.dir === dir) { const s = this.net.sAt(dir, d.worldZ); excl.push([s - O.clearDriveway, s + O.clearDriveway]); }
    for (const b of this.net.busStops) if (b.dir === dir) { const s = this.net.sAt(dir, b.worldZ); excl.push([s - O.clearBusStop, s + O.clearBusStop]); }
    excl.sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let from = lo;
    for (const [a, b] of excl) { if (a - from >= 10) out.push([from, Math.min(a, hi)]); from = Math.max(from, b); if (from >= hi) break; }
    if (hi - from >= 10) out.push([from, hi]);
    return out.filter(([a, b]) => b - a >= 10);
  }

  placeObstacles(player: Body): void {
    const O = this.cfg.obstacles;
    const int = (r: readonly [number, number]): number => r[0] + Math.floor(this.rng.next() * (r[1] - r[0] + 1));
    const uturn = this.net.features.find((f) => f.def.uturn)!;
    const W = this.net.laneWidth, cw = this.cfg.car.width;
    for (const dir of ['S', 'N'] as const) {
      const lo = dir === 'S' ? O.sMin : uturn.zone.N[1];
      const hi = dir === 'S' ? O.sMaxS : this.cfg.street.length - O.ringClear;
      const slots = this.freeSlots(dir, O.clearBeforeStop, O.clearAfterZone, lo, hi);
      // Перемішати слоти (детерміновано).
      for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(this.rng.next() * (i + 1)); [slots[i], slots[j]] = [slots[j]!, slots[i]!]; }
      const kinds: CarKind[] = [];
      for (let i = int(O.brokenPerDir); i > 0; i--) kinds.push('broken');
      for (let i = int(O.parkedStretches); i > 0; i--) kinds.push('parked');
      for (const kind of kinds) {
        const slot = slots.shift();
        if (!slot) break;
        let lane: 0 | 1 = 1;
        if (kind === 'broken' && this.rng.next() < O.brokenLeftShare && !(dir === 'S' && slot[1] > uturn.def.s - O.leftLaneUturnClear)) lane = 0;
        const lens: number[] = [];
        const n = kind === 'broken' ? 1 : int(O.parkedPerStretch);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const len = this.rng.range(4.2, 4.8);
          const gap = i === 0 ? 0 : this.rng.range(O.parkedGap[0], O.parkedGap[1]);
          if (total + gap + len > slot[1] - slot[0]) break;
          lens.push(gap, len);
          total += gap + len;
        }
        let s = slot[0] + this.rng.next() * (slot[1] - slot[0] - total);
        const path = this.net.lanes[dir][lane];
        const off = kind === 'parked' ? W / 2 - O.parkedKerbGap - cw / 2 : 0;
        for (let i = 0; i < lens.length; i += 2) {
          s += lens[i]!;
          const len = lens[i + 1]!;
          const c = s + len / 2;
          s += len;
          const p = path.pose(c);
          const hx = Math.sin(p.a), hz = -Math.cos(p.a);
          const x = p.x - hz * off, z = p.z + hx * off;
          if (Math.hypot(x - player.box.x, z - player.box.z) < O.playerClear) continue;
          this.cars.push({
            id: this.nextId++, legs: [{ path, kind: 'lane', dir, lane }], leg: 0, s: c, v: 0, v0: 0, len,
            color: this.rng.pick(COLORS), x, z, a: p.a, braking: false, kind, hazard: kind === 'broken', turn: 0,
            off, offT: off, lcSig: 0, acc: 0, leadId: -1, plan: null, commit: false,
          });
        }
      }
    }
  }

  // ---- Наповнення ----

  // Початкове наповнення вулиці (подалі від гравця).
  populate(player: Body, extra: readonly Body[] = []): void {
    this.extra = extra;
    for (const dir of ['S', 'N'] as const) {
      for (const lane of [0, 1] as const) {
        const path = this.net.lanes[dir][lane];
        let s = this.rng.range(60, 120);
        for (let i = 0; i < this.cfg.traffic.streetCarsPerLane && s < path.length - 40; i++) {
          this.addStreetCar(dir, lane, s, player);
          s += this.rng.range(90, 200);
        }
      }
    }
  }

  private addStreetCar(dir: Dir, lane: 0 | 1, s: number, player: Body | null): boolean {
    const v0 = this.rng.range(this.cfg.traffic.streetV[0], this.cfg.traffic.streetV[1]);
    if (this.rng.next() < this.cfg.turners.share) {
      const opts = this.mainTurns.filter((o) => o.dir === dir && o.lane === lane && o.sTurn > s + 60);
      if (opts.length) {
        const o = this.rng.pick(opts);
        const legs: Leg[] = [
          { path: this.net.lanes[dir][lane].slice(0, o.sTurn), kind: 'lane', dir, lane },
          { path: o.turn, kind: 'turn' },
          { path: o.out, kind: 'side' },
        ];
        return this.add(legs, s, player, v0, { key: o.key, dir: o.sign, turnLeg: 1, fromMain: true, left: o.left, feature: o.feature, done: false });
      }
    }
    const legs: Leg[] = [{ path: this.net.lanes[dir][lane], kind: 'lane', dir, lane }];
    // З правої смуги Мрії — на зовнішню смугу кільця, з лівої — на внутрішню.
    if (dir === 'N') this.appendRing(legs, 'S', this.pickExit('S', false, lane), lane);
    return this.add(legs, s, player, v0);
  }

  // Внутрішня смуга не для першого зʼїзду.
  private pickExit(from: ArmId, allowS: boolean, lane: RingLane): ArmId {
    const order = this.net.armOrder;
    const first = order[(order.indexOf(from) + 1) % order.length]!;
    let opts = order.filter((a) => a !== from && (allowS || a !== 'S'));
    if (lane === 0) opts = opts.filter((a) => a !== first);
    return opts.length ? this.rng.pick(opts) : first;
  }

  private appendRing(legs: Leg[], from: ArmId, to: ArmId, lane: RingLane): void {
    const prev = legs[legs.length - 1]!.path;
    const net = this.net;
    legs.push({ path: net.entryPath(prev.pose(prev.length), from, lane), kind: 'entry', arm: from, lane });
    legs.push({ path: net.ringArc(net.arms[from].mergeAt(lane), net.arms[to].exitAt(lane), lane), kind: 'ring', lane });
    legs.push({ path: net.exitPath(to, lane), kind: 'exit', arm: to });
    if (to === 'S') legs.push({ path: net.lanes.S[lane], kind: 'lane', dir: 'S', lane });
    else legs.push({ path: net.arms[to].outLine, kind: 'stub' });
  }

  private moving(): number { return this.cars.filter((c) => c.kind === 'car').length; }

  private add(legs: Leg[], s: number, player: Body | null, v0: number, plan: TurnPlan | null = null): boolean {
    if (this.moving() >= this.cfg.traffic.maxCars) return false;
    const p = legs[0]!.path.pose(s);
    const clear = (b: { x: number; z: number; kind: CarKind }): boolean => Math.hypot(b.x - p.x, b.z - p.z) > (b.kind === 'car' ? 14 : 30);
    if (!this.cars.every(clear)) return false;
    if (this.extra.some((b) => Math.hypot(b.box.x - p.x, b.box.z - p.z) < 30)) return false;
    if (player && Math.hypot(player.box.x - p.x, player.box.z - p.z) < 30) return false;
    this.cars.push({
      id: this.nextId++, legs, leg: 0, s, v: v0 * 0.8, v0,
      len: this.rng.range(4.2, 4.8), color: this.rng.pick(COLORS),
      x: p.x, z: p.z, a: p.a, braking: false, kind: 'car', hazard: false, turn: 0,
      off: 0, offT: 0, lcSig: 0, acc: 0, leadId: -1, plan, commit: false,
    });
    return true;
  }

  private spawn(dt: number, player: Body): void {
    const far = (x: number, z: number, d: number): boolean => Math.hypot(player.box.x - x, player.box.z - z) > d;
    this.ringT -= dt;
    if (this.ringT <= 0) {
      this.ringT = this.rng.range(this.cfg.traffic.ringSpawnInterval[0], this.cfg.traffic.ringSpawnInterval[1]);
      const from = this.rng.pick(['W', 'E'] as const);
      const inLine = this.net.arms[from].inLine!;
      const st = inLine.pose(0);
      if (far(st.x, st.z, 45)) {
        const legs: Leg[] = [{ path: inLine, kind: 'stub' }];
        this.appendRing(legs, from, this.pickExit(from, true, 1), 1);
        this.add(legs, 0, player, this.cfg.traffic.ringV + 2);
      }
    }
    for (const dir of ['S', 'N'] as const) {
      for (const lane of [0, 1] as const) {
        const path = this.net.lanes[dir][lane];
        const n = this.cars.filter((c) => c.kind === 'car' && this.onLane(c, dir, lane)).length;
        if (n >= this.cfg.traffic.streetCarsPerLane) continue;
        const st = path.pose(0);
        if (far(st.x, st.z, 130) && this.rng.next() < dt * 0.5) this.addStreetCar(dir, lane, 0, player);
      }
    }
    // Виїзди з поперечних вулиць і дворів.
    this.sideT -= dt;
    if (this.sideT <= 0 && this.sideTurns.length) {
      this.sideT = this.rng.range(this.cfg.turners.sideSpawnInterval[0], this.cfg.turners.sideSpawnInterval[1]);
      const o = this.rng.pick(this.sideTurns);
      const st = o.inPath.pose(0);
      if (far(st.x, st.z, 40)) {
        const legs: Leg[] = [
          { path: o.inPath, kind: 'side' },
          { path: o.turn, kind: 'turn' },
          { path: this.net.lanes[o.dir][o.lane].slice(o.sJoin, this.net.lanes[o.dir][o.lane].length), kind: 'lane', dir: o.dir, lane: o.lane, sOffset: o.sJoin },
        ];
        if (o.dir === 'N') this.appendRing(legs, 'S', this.pickExit('S', false, o.lane), o.lane);
        const v0 = this.rng.range(this.cfg.traffic.streetV[0], this.cfg.traffic.streetV[1]);
        this.add(legs, 0, player, v0, { key: o.key, dir: o.sign, turnLeg: 1, fromMain: false, left: o.left, feature: o.feature, done: false });
      }
    }
  }

  onLane(c: Car, dir: Dir, lane: 0 | 1): boolean {
    const leg = c.legs[c.leg]!;
    return leg.kind === 'lane' && leg.dir === dir && leg.lane === lane;
  }

  // Поворот скасовано (ІІ обʼїжджає перешкоду): їде прямо до кінця вулиці / на кільце.
  private cancelTurn(c: Car): void {
    const leg = c.legs[c.leg]!;
    if (!c.plan || leg.kind !== 'lane' || !leg.dir || leg.lane === undefined || (leg.sOffset ?? 0) !== 0) return;
    this.unlock(c.plan.key, c.id);
    this.holding.delete(c.id);
    const legs: Leg[] = [{ path: this.net.lanes[leg.dir][leg.lane], kind: 'lane', dir: leg.dir, lane: leg.lane }];
    if (leg.dir === 'N') this.appendRing(legs, 'S', this.pickExit('S', false, leg.lane), leg.lane);
    c.legs = legs;
    c.leg = 0;
    c.plan = null;
    c.commit = false;
  }

  // ---- Крок ----

  // extra — райдери (та інші тіла поза cars); playerGhost — куди перестроюється гравець (якщо перестроюється).
  step(t: number, dt: number, player: Body, peds: Pedestrians, extra: readonly Body[] = [], playerGhost: Body | null = null): void {
    this.extra = extra;
    this.spawn(dt, player);
    const bodies: Body[] = [player, ...this.cars.map((c) => this.body(c)), ...extra];
    const ghosts: Body[] = playerGhost ? [playerGhost] : [];
    for (const c of this.cars) if (c.kind === 'car' && c.off !== c.offT) ghosts.push(this.ghost(c));
    const { cx, cz, r } = this.net.ring;
    // Гравець, якщо він уже на кільці (решту кільця mustYield бере сам).
    const ringPlayer: Body[] = Math.abs(Math.hypot(player.box.x - cx, player.box.z - cz) - r) < this.net.ring.laneWidth + 0.5 ? [player] : [];
    const LC = this.cfg.aiLaneChange;
    for (const c of this.cars) {
      if (c.kind !== 'car') continue;
      this.laneLogic(c, dt, bodies, ghosts);
      const lead = this.leader(c, t, bodies, ringPlayer, peds);
      const dv = c.v - lead.v;
      const cur = c.legs[c.leg]!;
      const turning = c.plan !== null && !c.plan.done && (c.commit || c.leg === c.plan.turnLeg);
      const A = turning ? this.cfg.turners.accel : IDM.A;
      const sStar = IDM.s0 + Math.max(0, c.v * IDM.T + (c.v * dv) / (2 * Math.sqrt(A * IDM.B)));
      const nearRing = c.legs[c.leg + 1]?.kind === 'entry' && cur.path.length - c.s < 50;
      let v0 = (cur.kind === 'lane' || cur.kind === 'stub' || cur.kind === 'side') && !nearRing ? c.v0 : Math.min(c.v0, this.cfg.traffic.ringV);
      if (c.plan && !c.plan.done) {
        const tv = this.cfg.turners.turnV;
        if (c.leg === c.plan.turnLeg) v0 = Math.min(v0, tv);
        else if (c.leg === c.plan.turnLeg - 1) v0 = Math.min(v0, Math.sqrt(tv * tv + 2 * 2 * Math.max(0, cur.path.length - c.s - 4)));
      }
      let acc = A * (1 - Math.pow(c.v / Math.max(0.5, v0), 4));
      if (lead.gap < Infinity) acc -= A * Math.pow(sStar / Math.max(0.1, lead.gap), 2);
      acc = Math.max(-IDM.maxDecel, acc);
      c.acc = c.v <= 0 && acc < 0 ? 0 : acc;
      c.leadId = lead.id;
      c.braking = acc < -1;
      c.v = Math.max(0, c.v + acc * dt);
      c.s += c.v * dt;
      // Бічний рух (перестроювання).
      let yaw = 0;
      if (c.off !== c.offT) {
        const rate = clamp(LC.latSpeedMin + 0.25 * c.v, LC.latSpeedMin, LC.latSpeed);
        const d = Math.sign(c.offT - c.off) * Math.min(Math.abs(c.offT - c.off), rate * dt);
        c.off += d;
        if (Math.abs(c.off - c.offT) < 1e-6) c.off = c.offT;
        yaw = clamp(Math.atan2(d / dt, Math.max(c.v, 2)), -0.25, 0.25) * Math.min(1, c.v / 2);
      }
      let leg = c.legs[c.leg]!;
      while (c.s > leg.path.length && c.leg < c.legs.length - 1) {
        c.s -= leg.path.length;
        if (leg.kind === 'lane') { c.off = 0; c.offT = 0; }
        c.leg++;
        leg = c.legs[c.leg]!;
        if (c.plan && !c.plan.done && c.leg > c.plan.turnLeg) {
          c.plan.done = true;
          this.unlock(c.plan.key, c.id);
          c.commit = false;
          c.turn = 0;
        }
      }
      const p = leg.path.pose(c.s);
      const hx = Math.sin(p.a), hz = -Math.cos(p.a);
      c.x = p.x - hz * c.off; c.z = p.z + hx * c.off; c.a = p.a + yaw;
    }
    const gone = this.cars.filter((c) => c.kind === 'car' && c.leg === c.legs.length - 1 && c.s >= c.legs[c.leg]!.path.length);
    for (const c of gone) { if (c.plan) this.unlock(c.plan.key, c.id); this.holding.delete(c.id); }
    if (gone.length) this.cars = this.cars.filter((c) => !gone.includes(c));
  }

  // ---- Перестроювання ІІ (обʼїзд перешкоди / повільного райдера) ----

  // Тіла в смузі зі зсувом laneOff від осі смуги, де зараз нога c, на відстанях [from, to] від c (між центрами).
  private inLane(c: Car, bodies: readonly Body[], laneOff: number, from: number, to: number, pred: (b: Body) => boolean): Body | null {
    const leg = c.legs[c.leg]!;
    let best: Body | null = null, bs = Infinity;
    for (const b of bodies) {
      if (b.id === c.id || !pred(b)) continue;
      if (Math.abs(b.box.z - c.z) > to + 20 || Math.abs(b.box.x - c.x) > to + 20) continue;
      const p = leg.path.project(b.box.x, b.box.z);
      const rel = p.s - c.s;
      if (rel < from || rel > to) continue;
      const da = b.box.a - leg.path.pose(p.s).a;
      const lat = Math.abs(Math.sin(da)) * b.box.hl + Math.abs(Math.cos(da)) * b.box.hw;
      if (Math.abs(p.d - laneOff) >= 1.5 + lat) continue;
      if (rel < bs) { bs = rel; best = b; }
    }
    return best;
  }

  private blocked(c: Car, laneOff: number, bodies: readonly Body[]): boolean {
    const LC = this.cfg.aiLaneChange;
    if (this.inLane(c, bodies, laneOff, 0, LC.lookStatic, (b) => b.kind === 'static')) return true;
    return this.inLane(c, bodies, laneOff, 0, LC.lookRider, (b) => b.kind === 'rider' && b.v < c.v0 - LC.slowRiderDv) !== null;
  }

  private laneLogic(c: Car, dt: number, bodies: readonly Body[], ghosts: readonly Body[]): void {
    const leg = c.legs[c.leg]!;
    let planSig: -1 | 0 | 1 = 0;
    if (c.plan && !c.plan.done) {
      const tl = c.plan.turnLeg;
      if (c.leg === tl) planSig = c.plan.dir;
      else if (c.leg === tl - 1 && leg.path.length - c.s < Math.max(this.cfg.turners.signalDist, c.v * 4)) planSig = c.plan.dir;
    }
    if (leg.kind !== 'lane' || leg.lane === undefined || !leg.dir) { c.turn = planSig; return; }
    if (c.off !== c.offT) { c.turn = c.offT > c.off ? 1 : -1; return; }
    const W = this.net.laneWidth;
    const other = leg.lane === 1 ? -W : W;
    const remain = leg.path.length - c.s;
    const toRing = c.legs[c.leg + 1]?.kind === 'entry';
    const pending = c.plan !== null && !c.plan.done;
    const nearEnd = (toRing && remain < 300) || (!pending && remain < 40);
    const LC = this.cfg.aiLaneChange;
    let want = c.offT;
    if (c.offT === 0) {
      // Перед своїм поворотом за повільним райдером просто їде слідом; перешкода — скасовує поворот.
      const stat = this.inLane(c, bodies, 0, 0, LC.lookStatic, (b) => b.kind === 'static');
      const slow = !stat && !(pending && remain < 60) && this.blocked(c, 0, bodies);
      if (!nearEnd && (stat || slow) && !this.inLane(c, bodies, other, -10, 40, (b) => b.kind === 'static')) want = other;
    } else {
      const statHome = this.inLane(c, bodies, 0, -c.len, 45, (b) => b.kind === 'static');
      const riderHome = this.inLane(c, bodies, 0, -2, 25, (b) => b.kind === 'rider');
      if (nearEnd || (!statHome && !riderHome) || this.blocked(c, c.offT, bodies)) want = statHome ? c.offT : 0;
    }
    if (want !== c.offT && c.plan && !c.plan.done) {
      if (c.commit) want = c.offT; // поворот уже почався — не перестроюємось
      else { this.cancelTurn(c); planSig = 0; }
    }
    if (want === c.offT) { c.lcSig = 0; c.turn = planSig; return; }
    c.turn = want > c.offT ? 1 : -1;
    c.lcSig += dt;
    // Обовʼязкове повернення перед кільцем — краще перетнути суцільну, ніж застрягти.
    const mustBack = toRing && want === 0 && remain < 200;
    if (c.lcSig >= LC.signalS && (mustBack || !this.solidAhead(c)) && this.gapOK(c, want, bodies, ghosts)) { c.offT = want; c.lcSig = 0; }
  }

  // Перестроювання (з запасом) зачепить суцільну лінію/перехрестя?
  private solidAhead(c: Car): boolean {
    const leg = c.legs[c.leg]!;
    const dir = leg.dir!;
    const s = c.s + (leg.sOffset ?? 0);
    const dist = clamp((c.v * this.net.laneWidth) / this.cfg.aiLaneChange.latSpeed, 6, 45);
    return this.net.features.some((f) => s + dist >= f.stop[dir] - this.cfg.rules.solidBeforeStop - 2 && s <= f.zone[dir][1] + 2);
  }

  private gapOK(c: Car, offTarget: number, bodies: readonly Body[], ghosts: readonly Body[]): boolean {
    const leg = c.legs[c.leg]!;
    const half = c.len / 2;
    for (const list of [bodies, ghosts]) {
      for (const b of list) {
        if (b.id === c.id) continue;
        if (Math.abs(b.box.z - c.z) > 90 || Math.abs(b.box.x - c.x) > 20) continue;
        const p = leg.path.project(b.box.x, b.box.z);
        if (Math.abs(p.s - c.s) > 90) continue;
        const da = b.box.a - leg.path.pose(p.s).a;
        const lat = Math.abs(Math.sin(da)) * b.box.hl + Math.abs(Math.cos(da)) * b.box.hw;
        const lon = Math.abs(Math.cos(da)) * b.box.hl + Math.abs(Math.sin(da)) * b.box.hw;
        const bv = b.v * Math.cos(da);
        const rel = p.s - c.s;
        let gap: number, need: number;
        if (Math.abs(p.d - offTarget) >= 1.4 + lat) {
          // Райдер між смугами (обʼїжджає перешкоду): не перетинати його траєкторію поруч.
          const lo = Math.min(c.off, offTarget) - 1.2 - lat, hi = Math.max(c.off, offTarget) + 1.2 + lat;
          if (b.kind !== 'rider' || p.d < lo || p.d > hi || (b.v < 0.3 && rel > 0)) continue;
          gap = Math.abs(rel) - half - lon;
          need = rel >= 0 ? 3 + Math.max(0, c.v - bv) * 3 : 4 + Math.max(0, bv - c.v) * 3;
          if (gap < need) return false;
          continue;
        }
        if (rel >= 0) {
          gap = rel - half - lon;
          need = 4 + c.v * 0.8 + Math.max(0, c.v - bv) * 1.5 + (b.kind === 'static' ? 4 : 0);
        } else {
          gap = -rel - half - lon;
          need = b.id === 0 ? 8 + bv * 1.6 + Math.max(0, bv - c.v) * 2.5 : 4 + bv * 0.8 + Math.max(0, bv - c.v) * 1.6;
        }
        if (gap < need) return false;
      }
    }
    return true;
  }

  private ghost(c: Car): Body {
    const p = c.legs[c.leg]!.path.pose(c.s);
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    return { id: c.id, box: { x: p.x - hz * c.offT, z: p.z + hx * c.offT, a: p.a, hl: c.len / 2, hw: this.cfg.car.width / 2 }, v: c.v, kind: 'car' };
  }

  // ---- Повороти: чи можна їхати ----

  private firstInLine(c: Car, leg: Leg, remain: number): boolean {
    for (const q of this.cars) {
      if (q === c || q.kind !== 'car') continue;
      if (Math.abs(q.x - c.x) > 8 || Math.abs(q.z - c.z) > remain + 8) continue;
      const p = leg.path.project(q.x, q.z);
      if (Math.abs(p.d) < 1.6 && p.s > c.s && p.s < leg.path.length + 1) return false;
    }
    return true;
  }

  // Налагодження: чому поворот ще не дозволено (id авто → причина).
  readonly why = new Map<number, string>();
  private whyId = 0;
  private no(reason: string): false { this.why.set(this.whyId, reason); return false; }

  private canTurn(c: Car, t: number, bodies: readonly Body[]): boolean {
    this.whyId = c.id;
    const plan = c.plan!;
    const T = this.cfg.turners;
    const pre = c.legs[c.leg]!, tl = c.legs[plan.turnLeg]!, after = c.legs[plan.turnLeg + 1];
    const remain = pre.path.length - c.s;
    const Tc = clearTime(remain + tl.path.length + c.len + 3, c.v, T.accel, T.turnV);
    let ignoreStill = false;
    const f = plan.feature;
    if (f && f.signalised) {
      const sg = this.cfg.signals;
      const ph = mod(t + (f.def.offset ?? 0), sg.cycle);
      const redFrom = sg.green + sg.greenBlink + sg.yellow;
      const untilGreen = sg.cycle - ph;
      if (!plan.fromMain) {
        // Поперечна вулиця має зелений, поки на Мрії червоний (без червоний+жовтий).
        if (ph < redFrom + 0.5 || untilGreen - sg.redYellow < Tc + 1.5) return this.no('window');
        ignoreStill = true;
      } else if (ph >= redFrom && untilGreen >= Tc + 1.5) ignoreStill = true;
    }
    // Точки траєкторії (без частини у власній смузі для поворотів з Мрії) + 12 м після.
    const pts: { x: number; z: number }[] = [];
    for (let s = 0; s <= tl.path.length; s += 1.5) pts.push(tl.path.pose(s));
    if (after) for (let s = 1.5; s <= Math.min(12, after.path.length); s += 1.5) pts.push(after.path.pose(s));
    const samples = plan.fromMain ? pts.filter((q) => Math.abs(pre.path.project(q.x, q.z).d) > 1.2) : pts;
    const cw = this.cfg.car.width / 2;
    const byId = new Map(this.cars.map((q) => [q.id, q]));
    // Стоїть у черзі (той, за ким він стоїть, теж стоїть) — першим не рушить.
    const queued = (id: number): boolean => {
      const q = byId.get(id);
      if (!q || q.leadId <= 0) return false;
      const l = byId.get(q.leadId);
      return l !== undefined && l.v < 0.3;
    };
    for (const b of bodies) {
      if (b.id === c.id) continue;
      if (Math.abs(b.box.x - c.x) > 150 || Math.abs(b.box.z - c.z) > 150) continue;
      // Хто під'їжджає поперечною вулицею/з двору й ще не почав поворот — сам зупиниться на «Дати дорогу».
      const bc = byId.get(b.id);
      if (bc && bc.plan && !bc.plan.done && !bc.commit && bc.leg < bc.plan.turnLeg && bc.legs[bc.leg]!.kind === 'side') continue;
      const pp = pre.path.project(b.box.x, b.box.z);
      // Правий поворот з Мрії: поступитись райдеру, що їде прямо біля бордюру (позаду/поруч/трохи попереду).
      if (plan.fromMain && !plan.left && b.kind === 'rider' && pp.s > c.s - 30 && pp.s < c.s + 12 && Math.abs(pp.d) < 3) return this.no('rider ' + b.id);
      // Перешкода у своїй смузі до точки повороту — спершу обʼїхати (поворот скасується).
      if (plan.fromMain && b.kind === 'static' && Math.abs(pp.d) < 2.4 && pp.s > c.s && pp.s < pre.path.length + 3) return this.no('static ' + b.id);
      // Свої «задні» на тій самій смузі/під'їзді — не конфлікт.
      if (Math.abs(pp.d) < 1.5 && pp.s < c.s) continue;
      const hx = Math.sin(b.box.a), hz = -Math.cos(b.box.a);
      const still = b.v < 0.3;
      let minT = Infinity, inside = false;
      for (const q of samples) {
        const dx = q.x - b.box.x, dz = q.z - b.box.z;
        const fwd = dx * hx + dz * hz, lat = dx * -hz + dz * hx;
        if (Math.abs(lat) > b.box.hw + cw + 0.6) continue;
        if (fwd < -(b.box.hl + cw + 0.5)) continue;
        if (fwd <= b.box.hl + cw + 0.5) { inside = true; break; }
        if (b.kind === 'static' || b.kind === 'ped') continue;
        let v = b.v;
        // На Мрії червоний: хто ще до стоп-лінії й встигає спокійно зупинитись — зупиниться.
        if (ignoreStill && f && !still) {
          const q = this.net.streetSlot(b.box.x, b.box.z);
          if (q && f.stop[q.dir] - (q.s + b.box.hl) > (b.v * b.v) / 6 + 1) continue;
        }
        if (still) {
          if (this.holding.has(b.id) || queued(b.id)) continue;
          if (ignoreStill && this.net.streetSlot(b.box.x, b.box.z)) continue;
          if (fwd > 30) continue;
          v = 2.5;
        }
        minT = Math.min(minT, (fwd - b.box.hl - cw - 0.5) / Math.max(v, 0.1));
      }
      if (inside) return this.no('inside ' + b.id);
      if (minT < Tc + (b.id === 0 ? T.marginPlayer : T.marginAI)) return this.no(`tta ${b.id} ${minT.toFixed(1)}<${Tc.toFixed(1)}`);
      // Місце після повороту має бути вільне.
      if (after && b.v < 4) {
        const q = after.path.project(b.box.x, b.box.z);
        if (Math.abs(q.d) < 2.2 && q.s > -3 && q.s < 15) return this.no('landing ' + b.id);
      }
    }
    this.why.delete(c.id);
    return true;
  }

  body(c: Car): Body {
    const k = c.legs[c.leg]!.kind;
    const kind: BodyKind = c.kind !== 'car' ? 'static' : k === 'turn' || k === 'side' ? 'turner' : 'car';
    return { id: c.id, box: { x: c.x, z: c.z, a: c.a, hl: c.len / 2, hw: this.cfg.car.width / 2 }, v: c.v, kind };
  }

  private mustYield(c: Car, entry: Leg, ringPlayer: Body[], time: number): boolean {
    const theta = this.net.arms[entry.arm!].mergeAt(entry.lane ?? 1);
    return ringBusy(this.net, theta, [...ringPlayer, ...this.ringBodies(entry.arm)], c.id, time);
  }

  // Ті, хто вже їде по кільцю (не ті, що тільки вʼїжджають).
  // Плюс ті, хто вʼїжджає з інших рукавів і вже фізично на смузі кільця.
  // Хто вʼїжджає з інших рукавів і от-от зіллється — вважаємо, що вже в точці злиття.
  ringBodies(exceptArm?: ArmId): Body[] {
    const out: Body[] = [];
    for (const c of this.cars) {
      const leg = c.legs[c.leg]!;
      if (leg.kind === 'ring') out.push(this.body(c));
      else if (leg.kind === 'entry' && leg.arm !== exceptArm && leg.path.length - c.s < 12) {
        const m = leg.path.pose(leg.path.length);
        out.push({ id: c.id, box: { x: m.x, z: m.z, a: m.a, hl: c.len / 2, hw: this.cfg.car.width / 2 }, v: Math.max(c.v, 3) });
      }
    }
    return out;
  }

  // Найближча перешкода попереду: авто/гравець на шляху, стоп-лінія, пішохід, «Дати дорогу», поворот.
  private leader(c: Car, t: number, bodies: Body[], ringPlayer: Body[], peds: Pedestrians): { gap: number; v: number; id: number } {
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

    for (const b of bodies) {
      if (b.id === c.id) continue;
      if (Math.abs(b.box.x - c.x) > LOOK + 10 || Math.abs(b.box.z - c.z) > LOOK + 10) continue;
      const kind = b.kind ?? 'car';
      const precise = kind === 'turner' || kind === 'rider' || kind === 'ped' || kind === 'static';
      let ps: number | null = null, pa = 0;
      const p = leg.path.project(b.box.x, b.box.z);
      const latOf = (a: number): number => (precise ? Math.abs(Math.sin(b.box.a - a)) * b.box.hl + Math.abs(Math.cos(b.box.a - a)) * b.box.hw : cw);
      const corridor = (a: number): number => (kind === 'static' && changing ? cw + 0.2 : LANE_HALF - cw) + latOf(a);
      // Пліч-о-пліч (злиття смуг) теж рахується: поступається той, у кого більший id; гравцю поступаються завжди.
      const abreast = (b.id === 0 || (b.id < c.id && (kind === 'car' || kind === 'turner'))) && Math.abs(p.d - off) > 0.6 ? c.len * 0.4 : 0;
      if (p.s > c.s - abreast - 3 && p.s <= leg.path.length + 1) {
        const a = leg.path.pose(p.s).a;
        if (Math.abs(p.d - off) < corridor(a) && p.s > c.s - abreast) { ps = p.s; pa = a; }
      }
      if (ps === null && next && remain < LOOK) {
        const q = next.path.project(b.box.x, b.box.z);
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

    if (leg.kind === 'lane' && leg.dir) {
      const dir = leg.dir;
      const soff = leg.sOffset ?? 0;
      for (const f of this.net.features) {
        const stop = f.stop[dir];
        const d = stop - front - soff;
        if (d < -0.5 || d > LOOK) continue;
        if (f.signalised) {
          const l = lightAt(t, f.def.offset ?? 0, this.cfg.signals);
          if (isStopLight(l) || (l === 'yellow' && d > (c.v * c.v) / 6 + 1)) consider(d, 0);
        }
        if (f.def.kind !== 'intersection' && peds.conflict(f.def.id, dir, this.cfg.rules.pedConflictMargin)) consider(d, 0);
      }
      // Пішохід поза переходом: стоїмо за 3 м до його лінії.
      for (const p of peds.jaywalkers(dir, this.cfg.rules.pedConflictMargin)) {
        const d = this.net.sAt(dir, p.z) - 3 - front - soff;
        if (d > -2.5 && d < LOOK) consider(Math.max(0.1, d), 0);
      }
    }

    // Поворот: «Дати дорогу» в точці початку повороту. Лівий з Мрії бронює перехрестя ще до стоп-лінії.
    // Бронювати/рушати може лише перший у черзі до точки повороту.
    this.holding.delete(c.id);
    if (c.plan && !c.plan.done && c.leg === c.plan.turnLeg - 1 && !c.commit && this.firstInLine(c, leg, remain)) {
      const plan = c.plan;
      let g: number | null = null; // від переднього бампера до місця зупинки
      const atTurn = remain - c.len / 2 - 0.2;
      if (plan.key && plan.fromMain && plan.left && plan.feature && leg.dir && remain < 30) {
        const dStop = plan.feature.stop[leg.dir] - front - (leg.sOffset ?? 0);
        const red = isStopLight(lightAt(t, plan.feature.def.offset ?? 0, this.cfg.signals));
        if ((!red || dStop < 0) && !this.tryLock(plan.key, c.id)) g = dStop > -0.5 ? Math.max(0.1, dStop) : 0.1;
      }
      const decide = remain < Math.max(4, (c.v * c.v) / 5 + 3);
      if (g === null && decide) {
        if (!this.lockFree(plan.key, c.id)) g = atTurn;
        else if (this.canTurn(c, t, bodies)) { this.tryLock(plan.key, c.id); c.commit = true; }
        else g = atTurn;
      }
      if (g !== null) {
        consider(Math.max(0.1, g), 0);
        if (c.v < 0.5) this.holding.add(c.id);
      }
    }

    // Не встиг повернутись у свою смугу до кінця вулиці — чекати розриву.
    if (leg.kind === 'lane' && c.offT !== 0 && next?.kind === 'entry' && remain < 60) consider(Math.max(0.1, remain - 45), 0);

    // Зʼїзд із внутрішньої смуги перетинає зовнішню: поступитися тим, хто в зовнішній поруч.
    if (leg.kind === 'ring' && leg.lane === 0 && next?.kind === 'exit' && remain < 16) {
      if (outerNearExit(this.net, this.net.arms[next.arm!].exitAt(0), bodies, c.id)) consider(remain - 1, 0);
    }

    // «Дати дорогу» перед кільцем: стоїмо, якщо по кільцю хтось наближається
    // або хтось інший уже вʼїжджає ближче до точки злиття. Після лінії — ще можна зупинитись до смуги кільця.
    const entry = next?.kind === 'entry' ? next : leg.kind === 'entry' ? leg : null;
    if (entry && (leg.kind === 'entry' || remain < LOOK)) {
      const stopAt = leg.kind === 'entry' ? leg.path.length - 5 : leg.path.length - 0.3;
      if (front < stopAt && this.mustYield(c, entry, ringPlayer, leg.kind === 'entry' ? 2.5 : this.cfg.rules.ringYieldTime + 2)) {
        consider(stopAt - front + (leg.kind === 'entry' ? 0 : 0.3), 0);
      }
    }
    return { gap, v: lv, id: lid };
  }
}

// Чи наближається хтось по кільцю до точки вʼїзду theta: доїде менш ніж за time секунд або вже поруч.
export function ringBusy(net: RouteNet, theta: number, bodies: readonly Body[], exceptId: number, time: number): boolean {
  const { cx, cz, r } = net.ring;
  return bodies.some((b) => {
    if (b.id === exceptId) return false;
    const dr = Math.hypot(b.box.x - cx, b.box.z - cz) - r;
    if (Math.abs(dr) > net.ring.laneWidth + 0.5) return false; // обидві смуги кільця
    const th = Math.atan2(-(b.box.z - cz), b.box.x - cx);
    const up = mod(theta - th, 2 * Math.PI) * r;
    return up <= 7 || up / Math.max(1, b.v) < time;
  });
}

// Хтось у зовнішній смузі кільця поруч із точкою зʼїзду внутрішньої (від 16 м позаду до 6 м попереду).
export function outerNearExit(net: RouteNet, exitTheta: number, bodies: readonly Body[], exceptId: number): boolean {
  const { cx, cz } = net.ring;
  const rOut = net.laneR(1);
  return bodies.some((b) => {
    if (b.id === exceptId) return false;
    if (Math.abs(Math.hypot(b.box.x - cx, b.box.z - cz) - rOut) > 1.5) return false;
    const th = Math.atan2(-(b.box.z - cz), b.box.x - cx);
    const rel = (mod(th - exitTheta + Math.PI, 2 * Math.PI) - Math.PI) * rOut;
    return rel > -16 && rel < 6;
  });
}
