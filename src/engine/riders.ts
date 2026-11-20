// Велосипедисти й самокатники: їдуть біля правого краю правої смуги Мрії у своєму напрямку.
// Зупиняються на червоне і перед пішоходами, обʼїжджають припарковані/зламані авто ближче до осі смуги.
// Напрям N: виїжджають із дворів (сх. бік) і звертають праворуч на першому перехресті зі сх. вулицею (вул. Ігоря Турчина).

import type { SimConfig } from './config';
import { bezierPath, clamp, line, type Path } from './geometry';
import type { Pedestrians } from './peds';
import type { Rng } from './rng';
import type { Dir, Feature, RouteNet } from './route';
import { isStopLight, lightAt } from './signals';
import type { Body, Traffic } from './traffic';

export type RiderKind = 'bike' | 'scooter';

export interface Rider {
  readonly id: number;          // від 100001 (не перетинаються з id авто)
  readonly kind: RiderKind;
  readonly dir: Dir;
  x: number; z: number; a: number; v: number;
  readonly len: number;
  readonly width: number;
  braking: boolean;
  // внутрішнє
  s: number;                    // по опорній лінії напрямку
  d: number;                    // від опорної лінії праворуч (без виляння)
  readonly v0: number;
  readonly phase: number;
  turn: { path: Path; s: number; out: Path; key: string } | null;
  done: boolean;
}

export const RIDER_ID_BASE = 100000;

export class Riders {
  list: Rider[] = [];
  private nextId = RIDER_ID_BASE + 1;
  private nLeft = 0;            // скільки ще випустити на N
  private nT = 0;
  private readonly dEdge: number;
  private readonly turnF: Feature | null;

  constructor(private readonly cfg: SimConfig, private readonly net: RouteNet, private readonly rng: Rng, private readonly traffic: Traffic) {
    this.dEdge = 2 * net.laneWidth - cfg.riders.edgeGap;
    // На N звертають на першому перехресті зі східною вулицею (не перехрестя розвороту).
    this.turnF = net.features.filter((f) => f.def.kind === 'intersection' && f.def.side !== 'W' && !f.def.uturn).sort((a, b) => a.stop.N - b.stop.N)[0] ?? null;
  }

  private int(r: readonly [number, number]): number { return r[0] + Math.floor(this.rng.next() * (r[1] - r[0] + 1)); }

  private make(dir: Dir, s: number, v: number): Rider {
    const R = this.cfg.riders;
    const bike = this.rng.next() < R.bikeShare;
    const dim = bike ? R.bike : R.scooter;
    const vr = bike ? R.bikeV : R.scooterV;
    const r: Rider = {
      id: this.nextId++, kind: bike ? 'bike' : 'scooter', dir, x: 0, z: 0, a: 0, v, len: dim.len, width: dim.width, braking: false,
      s, d: this.dEdge, v0: this.rng.range(vr[0], vr[1]), phase: this.rng.range(0, Math.PI * 2), turn: null, done: false,
    };
    this.pose(r, 0);
    return r;
  }

  // На S — на старті, біля кільця (гравець ще далеко на автодромі). На N — пізніше, з дворів.
  populate(): void {
    let s = this.rng.range(5, 20);
    const n = this.int(this.cfg.riders.perDir);
    for (let i = 0; i < n; i++) {
      const r = this.make('S', s, 0);
      r.v = r.v0;
      this.list.push(r);
      s += this.rng.range(25, 40);
    }
    this.nLeft = this.int(this.cfg.riders.perDir);
  }

  // Викликає Sim, коли гравець на S проїхав riders.spawnNAtS.
  private trySpawnN(player: Body, bodies: readonly Body[]): void {
    const opts = this.net.driveways.filter((d) => d.dir === 'N' && (!this.turnF || this.net.sAt('N', d.worldZ) < this.turnF.stop.N - 60));
    if (!opts.length) { this.nLeft = 0; return; }
    const d = this.rng.pick(opts);
    const s = this.net.sAt('N', d.worldZ) + 6;
    const p = this.net.ref.N.pose(s);
    if (Math.hypot(p.x - player.box.x, p.z - player.box.z) < 60) return;
    // Смуга вільна: ніхто не наздоганяє ззаду в межах 60 м і не стоїть попереду в 10 м.
    for (const b of bodies) {
      const q = this.net.streetSlot(b.box.x, b.box.z);
      if (!q || q.dir !== 'N' || q.lane !== 1) continue;
      if (q.s > s - 60 && q.s < s + 10) return;
    }
    const r = this.make('N', s, 2);
    this.list.push(r);
    this.nLeft--;
    this.nT = this.rng.range(6, 14);
  }

  bodies(): Body[] {
    return this.list.map((r) => ({ id: r.id, box: { x: r.x, z: r.z, a: r.a, hl: r.len / 2, hw: r.width / 2 }, v: r.v, kind: 'rider' as const }));
  }

  step(t: number, dt: number, others: readonly Body[], peds: Pedestrians, playerSouthS: number | null): void {
    const R = this.cfg.riders;
    if (this.nLeft > 0 && playerSouthS !== null && playerSouthS >= R.spawnNAtS) {
      this.nT -= dt;
      if (this.nT <= 0) this.trySpawnN(others[0]!, others);
    }
    const mine = this.bodies();
    const rightSig = new Set(this.traffic.cars.filter((c) => c.turn === 1).map((c) => c.id));
    for (const r of this.list) {
      if (r.turn) { this.stepTurn(r, dt); continue; }
      const all = [...others, ...mine.filter((b) => b.id !== r.id)];
      const ref = this.net.ref[r.dir];
      // Обʼїзд нерухомої перешкоди в правій смузі: ближче до осі смуги.
      let dWant = this.dEdge;
      const hw = r.width / 2;
      let gap = Infinity, lv = 0;
      for (const b of all) {
        if (Math.abs(b.box.z - r.z) > 60) continue;
        const p = ref.project(b.box.x, b.box.z);
        if (p.d < 0 || p.d > 2 * this.net.laneWidth + 1) continue;
        const da = b.box.a - ref.pose(p.s).a;
        const lat = Math.abs(Math.sin(da)) * b.box.hl + Math.abs(Math.cos(da)) * b.box.hw;
        const lon = Math.abs(Math.cos(da)) * b.box.hl + Math.abs(Math.sin(da)) * b.box.hw;
        const rel = p.s - r.s;
        // Нерухома перешкода або авто ІІ, що стоїть (черга): обʼїхати ліворуч ближче до осі смуги (не гравця).
        const still = b.kind === 'static' || ((b.kind === 'car' || b.kind === 'turner') && b.v < 0.3);
        // Повз авто з правим покажчиком — не вертатись до бордюру одразу перед ним (воно повертатиме праворуч).
        const behind = rightSig.has(b.id) ? 14 : 2;
        if ((still || (rightSig.has(b.id) && b.v < 3)) && rel + lon > -r.len / 2 - behind && rel - lon - r.len / 2 < 25 && p.d + lat > this.dEdge - hw - 0.3) {
          dWant = Math.min(dWant, p.d - lat - R.passClear - hw);
        }
        if (rel <= 0) continue;
        if (Math.abs(p.d - r.d) > lat + hw + 0.25) continue;
        const g = rel - lon - r.len / 2;
        if (g < gap) { gap = g; lv = Math.max(0, b.v * Math.cos(da)); }
      }
      // Стоп-лінії (червоний, пішоходи) і пішохід поза переходом.
      const front = r.s + r.len / 2;
      for (const f of this.net.features) {
        const d = f.stop[r.dir] - front;
        if (d < -0.5 || d > 60) continue;
        if (f.signalised) {
          const l = lightAt(t, f.def.offset ?? 0, this.cfg.signals);
          if (isStopLight(l) || (l === 'yellow' && d > (r.v * r.v) / 5 + 0.5)) { if (d < gap) { gap = d; lv = 0; } }
        }
        if (f.def.kind !== 'intersection' && peds.conflict(f.def.id, r.dir, this.cfg.rules.pedConflictMargin) && d < gap) { gap = d; lv = 0; }
      }
      for (const p of peds.jaywalkers(r.dir, this.cfg.rules.pedConflictMargin)) {
        const d = this.net.sAt(r.dir, p.z) - 2.5 - front;
        if (d > -2 && d < gap) { gap = Math.max(0.1, d); lv = 0; }
      }
      // N: правий поворот на поперечну вулицю (по одному на перехресті — замок).
      if (r.dir === 'N' && this.turnF) {
        const at = this.turnF.stop.N;
        const d = at - front;
        if (d < 30 && d > -1) {
          if (d < 1.5 && !isStopLight(lightAt(t, this.turnF.def.offset ?? 0, this.cfg.signals)) && this.traffic.tryLock(this.turnF.def.id, r.id)) {
            this.startTurn(r, this.turnF);
            continue;
          }
          if (d < gap) { gap = Math.max(0.1, d); lv = 0; }
          if (d < 2 && r.v < 0.3) this.traffic.holding.add(r.id); else this.traffic.holding.delete(r.id);
        }
      }
      // IDM-подібне слідування.
      const s0 = 1.5, T = 1.0;
      const sStar = s0 + Math.max(0, r.v * T + (r.v * (r.v - lv)) / (2 * Math.sqrt(R.accel * R.decel)));
      let acc = R.accel * (1 - Math.pow(r.v / r.v0, 4));
      if (gap < Infinity) acc -= R.accel * Math.pow(sStar / Math.max(0.1, gap), 2);
      acc = Math.max(-6, acc);
      r.braking = acc < -0.8;
      r.v = Math.max(0, r.v + acc * dt);
      r.s += r.v * dt;
      const prevD = r.d;
      const rate = 0.8 * dt;
      let step = clamp(dWant - r.d, -rate, rate);
      // Не зміщуватись убік на авто, що поруч (ліворуч — у сусідній смузі, праворуч — у своїй): чекати.
      if (step !== 0) {
        for (const b of all) {
          if (b.kind === 'rider' || Math.abs(b.box.z - r.z) > 15) continue;
          const p = ref.project(b.box.x, b.box.z);
          const da = b.box.a - ref.pose(p.s).a;
          const lat = Math.abs(Math.sin(da)) * b.box.hl + Math.abs(Math.cos(da)) * b.box.hw;
          const lon = Math.abs(Math.cos(da)) * b.box.hl + Math.abs(Math.sin(da)) * b.box.hw;
          if (Math.abs(p.s - r.s) >= lon + r.len / 2 + (step < 0 ? 4 : 1.5)) continue;
          if (step < 0 && b.kind !== 'static' && p.d < r.d && p.d + lat > r.d + step - hw - 0.4) { step = 0; break; }
          if (step > 0 && p.d > r.d && p.d - lat < r.d + step + hw + 0.4) { step = 0; break; }
        }
      }
      r.d += step;
      this.pose(r, (r.d - prevD) / dt, t);
      if (r.s > ref.length - 1) r.done = true;
    }
    for (const r of this.list) if (r.done) { this.traffic.unlock(this.turnF?.def.id ?? '', r.id); this.traffic.holding.delete(r.id); }
    this.list = this.list.filter((r) => !r.done);
  }

  private startTurn(r: Rider, f: Feature): void {
    const E = this.net.carriageway.N[1];
    const zOut = f.worldZ + f.def.halfWidth - 1;
    const end = { x: E + 4, z: zOut, a: Math.PI / 2 };
    const path = bezierPath({ x: r.x, z: r.z, a: 0 }, end, 2.5, 2.5, 16);
    r.turn = { path, s: 0, out: line({ x: end.x, z: zOut }, { x: 60, z: zOut }), key: f.def.id };
    this.traffic.holding.delete(r.id);
  }

  private stepTurn(r: Rider, dt: number): void {
    const tr = r.turn!;
    r.v = Math.min(r.v + this.cfg.riders.accel * dt, Math.min(r.v0, 4));
    tr.s += r.v * dt;
    let path = tr.path;
    if (tr.s > tr.path.length) {
      this.traffic.unlock(tr.key, r.id);
      path = tr.out;
      if (tr.s - tr.path.length > tr.out.length) { r.done = true; return; }
    }
    const p = path.pose(path === tr.path ? tr.s : tr.s - tr.path.length);
    r.x = p.x; r.z = p.z; r.a = p.a;
  }

  private pose(r: Rider, dRate: number, t = 0): void {
    const p = this.net.ref[r.dir].pose(r.s);
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    const d = r.d + this.cfg.riders.wobble * Math.sin(t * 1.7 + r.phase) * Math.min(1, r.v / 2);
    r.x = p.x - hz * d;
    r.z = p.z + hx * d;
    r.a = p.a + clamp(Math.atan2(dRate, Math.max(r.v, 1.5)), -0.3, 0.3);
  }
}
