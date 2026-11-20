// Велосипедисти й самокатники мережі: їдуть біля правого краю правої смуги ребра й далі по ланцюжку (edge.next),
// зупиняються на червоне й перед пішоходами, обʼїжджають нерухомі перешкоди й авто ІІ, що стоять, ближче до осі смуги.
import type { SimConfig } from '../config';
import { clamp } from '../geometry';
import { isStopLight } from '../signals';
import type { Rng } from '../rng';
import type { Body } from '../traffic';
import type { NetEdge, Network } from './network';
import type { NetPeds } from './peds';

export type RiderKind = 'bike' | 'scooter';

export interface NetRider {
  readonly id: number;          // від 100001
  readonly kind: RiderKind;
  x: number; z: number; a: number; v: number;
  readonly len: number; readonly width: number;
  braking: boolean;
  edge: NetEdge;                // поточне ребро
  s: number;                    // уздовж ref
  d: number;                    // від ref праворуч (без виляння)
  readonly v0: number;
  readonly phase: number;
  done: boolean;
  lane: number;                 // смуга (права)
}

export const NET_RIDER_ID_BASE = 100000;

export class NetRiders {
  list: NetRider[] = [];
  private nextId = NET_RIDER_ID_BASE + 1;

  constructor(private readonly cfg: SimConfig, private readonly net: Network, private readonly rng: Rng) {}

  private dEdge(e: NetEdge): number { return e.n * e.W - this.cfg.riders.edgeGap; }

  add(e: NetEdge, s: number, v?: number): NetRider {
    const R = this.cfg.riders;
    const bike = this.rng.next() < R.bikeShare;
    const dim = bike ? R.bike : R.scooter;
    const vr = bike ? R.bikeV : R.scooterV;
    const v0 = this.rng.range(vr[0], vr[1]);
    const r: NetRider = {
      id: this.nextId++, kind: bike ? 'bike' : 'scooter', x: 0, z: 0, a: 0, v: v ?? v0, len: dim.len, width: dim.width, braking: false,
      edge: e, s, d: this.dEdge(e), v0, phase: this.rng.range(0, Math.PI * 2), done: false, lane: e.n - 1,
    };
    this.pose(r, 0, 0);
    this.list.push(r);
    return r;
  }

  bodies(): Body[] {
    return this.list.map((r) => ({ id: r.id, box: { x: r.x, z: r.z, a: r.a, hl: r.len / 2, hw: r.width / 2 }, v: r.v, kind: 'rider' as const }));
  }

  step(t: number, dt: number, others: readonly Body[], peds: NetPeds, holding: Set<number>): void {
    const R = this.cfg.riders;
    const mine = this.bodies();
    for (const r of this.list) {
      const all = [...others, ...mine.filter((b) => b.id !== r.id)];
      const e = r.edge;
      const ref = e.ref;
      const dE = this.dEdge(e);
      let dWant = dE;
      const hw = r.width / 2;
      let gap = Infinity, lv = 0;
      for (const b of all) {
        if (Math.abs(b.box.z - r.z) > 60 || Math.abs(b.box.x - r.x) > 60) continue;
        const p = ref.projectRange(b.box.x, b.box.z, r.s - 25, r.s + 65);
        if (p.d < (e.n - 1) * e.W - 1 || p.d > e.n * e.W + 1 || p.s < r.s - 20 || p.s > r.s + 60) continue;
        const da = b.box.a - ref.pose(p.s).a;
        if (Math.abs(Math.cos(da)) < 0.5) continue; // поперек — не попутне
        const lat = Math.abs(Math.sin(da)) * b.box.hl + Math.abs(Math.cos(da)) * b.box.hw;
        const lon = Math.abs(Math.cos(da)) * b.box.hl + Math.abs(Math.sin(da)) * b.box.hw;
        const rel = p.s - r.s;
        const still = b.kind === 'static' || ((b.kind === 'car' || b.kind === 'turner') && b.v < 0.3);
        if (still && b.id !== 0 && rel + lon > -r.len / 2 - 2 && rel - lon - r.len / 2 < 25 && p.d + lat > dE - hw - 0.3) {
          dWant = Math.min(dWant, p.d - lat - R.passClear - hw);
        }
        if (rel <= 0) continue;
        if (Math.abs(p.d - r.d) > lat + hw + 0.25) continue;
        const g = rel - lon - r.len / 2;
        if (g < gap) { gap = g; lv = Math.max(0, b.v * Math.cos(da)); }
      }
      const front = r.s + r.len / 2;
      const consider = (d: number): void => { if (d < gap) { gap = Math.max(0.1, d); lv = 0; } };
      for (const f of e.features) {
        const d = f.stop - front;
        if (d < -0.5 || d > 60) continue;
        if (f.kind === 'signal' && f.ctrl && f.group) {
          const l = this.net.light(f.ctrl, f.group, t, this.cfg.signals);
          if (isStopLight(l) || (l === 'yellow' && d > (r.v * r.v) / 5 + 0.5)) consider(d);
        }
        if (f.kind === 'crossing' && f.crossing && peds.conflictEdge(f.crossing.id, e.id, this.cfg.rules.pedConflictMargin)) consider(d);
        if (f.kind === 'yield') consider(d); // кінець ребра перед кільцем — далі не їдемо
      }
      for (const j of peds.jaywalkersOn(e.id, this.cfg.rules.pedConflictMargin)) consider(j.s - 2.5 - front);
      const s0 = 1.5, T = 1.0;
      const sStar = s0 + Math.max(0, r.v * T + (r.v * (r.v - lv)) / (2 * Math.sqrt(R.accel * R.decel)));
      let acc = R.accel * (1 - Math.pow(r.v / r.v0, 4));
      if (gap < Infinity) acc -= R.accel * Math.pow(sStar / Math.max(0.1, gap), 2);
      acc = Math.max(-6, acc);
      r.braking = acc < -0.8;
      r.v = Math.max(0, r.v + acc * dt);
      r.s += r.v * dt;
      const prevD = r.d;
      let step = clamp(dWant - r.d, -0.8 * dt, 0.8 * dt);
      if (step !== 0) {
        for (const b of all) {
          if (b.kind === 'rider' || Math.abs(b.box.z - r.z) > 15 || Math.abs(b.box.x - r.x) > 15) continue;
          const p = ref.projectRange(b.box.x, b.box.z, r.s - 20, r.s + 20);
          const da = b.box.a - ref.pose(p.s).a;
          const lat = Math.abs(Math.sin(da)) * b.box.hl + Math.abs(Math.cos(da)) * b.box.hw;
          const lon = Math.abs(Math.cos(da)) * b.box.hl + Math.abs(Math.sin(da)) * b.box.hw;
          if (Math.abs(p.s - r.s) >= lon + r.len / 2 + (step < 0 ? 4 : 1.5)) continue;
          if (step < 0 && b.kind !== 'static' && p.d < r.d && p.d + lat > r.d + step - hw - 0.4) { step = 0; break; }
          if (step > 0 && p.d > r.d && p.d - lat < r.d + step + hw + 0.4) { step = 0; break; }
        }
      }
      r.d += step;
      // Перехід на наступне ребро ланцюжка (смуга праворуч; d — від нового ref).
      if (r.s > e.length) {
        const nx = e.next[0];
        if (!nx) { r.done = true; continue; }
        // Ліві межі суміжних ребер збігаються: d зберігається (до нового бордюру — плавно, через dWant).
        r.edge = nx; r.s = Math.max(0, r.s - e.length); r.lane = nx.n - 1;
      }
      this.pose(r, (r.d - prevD) / dt, t);
      if (r.edge.ringEntry && r.s > r.edge.length - 3) r.done = true;
    }
    for (const r of this.list) if (r.done) holding.delete(r.id);
    this.list = this.list.filter((r) => !r.done);
  }

  private pose(r: NetRider, dRate: number, t: number): void {
    const d = r.d + this.cfg.riders.wobble * Math.sin(t * 1.7 + r.phase) * Math.min(1, r.v / 2);
    const p = this.net.pose(r.edge, r.s, d);
    r.x = p.x; r.z = p.z;
    r.a = p.a + clamp(Math.atan2(dRate, Math.max(r.v, 1.5)), -0.3, 0.3);
  }
}
