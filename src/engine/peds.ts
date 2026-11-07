import type { SimConfig } from './config';
import type { Rng } from './rng';
import type { Dir, Feature, RouteNet } from './route';
import { pedLightAt } from './signals';

// crossing — переходить на зебрі/регульованому; sidewalk — гуляє тротуаром (на дорогу не виходить);
// stop — чекає на автобусній зупинці; jaywalker — перебігає дорогу поза переходом (один за заїзд).
export type PedKind = 'crossing' | 'sidewalk' | 'stop' | 'jaywalker';

export interface Ped {
  readonly id: number;
  readonly kind: PedKind;
  readonly featureId: string; // для crossing — id переходу; для решти — ''
  x: number;
  z: number;
  readonly dir: 1 | -1;   // напрямок по X (для crossing/jaywalker); для sidewalk/stop — бік вулиці
  readonly v: number;     // крокова швидкість, м/с
  a: number;              // курс, як у авто: h = (sin a, -cos a)
  speed: number;          // поточна швидкість, м/с (0 — стоїть)
  delay: number;          // секунд до виходу на перехід
  started: boolean;       // уже зійшов з тротуару (для sidewalk — завжди true)
  done: boolean;
}

interface Walker { zMin: number; zMax: number; sgn: 1 | -1; pause: number }

export class Pedestrians {
  list: Ped[] = [];
  private nextId = 1;
  private lastWalk = new Map<string, boolean>();
  private ambientT = new Map<string, number>();
  private walkers = new Map<number, Walker>();
  private readonly edge: number;
  private readonly kerb: number;

  constructor(private readonly cfg: SimConfig, private readonly net: RouteNet, private readonly rng: Rng) {
    this.edge = net.carriageway.N[1] + cfg.road.sidewalk * 0.5;
    this.kerb = net.carriageway.N[1];
    for (const f of net.features) if (f.def.kind === 'zebra') this.ambientT.set(f.def.id, rng.range(8, 30));
  }

  private int(r: readonly [number, number]): number { return r[0] + Math.floor(this.rng.next() * (r[1] - r[0] + 1)); }

  // Тротуари і зупинки: викликається один раз після створення.
  populateAmbient(): void {
    const P = this.cfg.peds;
    const z0 = this.cfg.street.startZ, z1 = z0 + this.cfg.street.length;
    for (const sign of [-1, 1] as const) {
      // Тротуар переривається поперечними вулицями та виїздами з дворів.
      const cuts: [number, number][] = [];
      for (const f of this.net.features) {
        if (f.def.kind !== 'intersection') continue;
        if ((sign === 1 && f.def.side === 'W') || (sign === -1 && f.def.side === 'E')) continue;
        cuts.push([f.worldZ - f.def.halfWidth - 1.5, f.worldZ + f.def.halfWidth + 1.5]);
      }
      for (const d of this.net.driveways) if (d.sign === sign) cuts.push([d.worldZ - 4.5, d.worldZ + 4.5]);
      cuts.sort((a, b) => a[0] - b[0]);
      const segs: [number, number][] = [];
      let from = z0 + 3;
      for (const [a, b] of cuts) { if (a - from > 12) segs.push([from, a]); from = Math.max(from, b); }
      if (z1 - 3 - from > 12) segs.push([from, z1 - 3]);
      const total = segs.reduce((acc, [a, b]) => acc + b - a, 0);
      const n = this.int(P.sidewalkPerSide);
      for (let i = 0; i < n; i++) {
        let r = this.rng.next() * total;
        let seg = segs[0]!;
        for (const sg of segs) { if (r <= sg[1] - sg[0]) { seg = sg; break; } r -= sg[1] - sg[0]; }
        const z = seg[0] + 1 + this.rng.next() * (seg[1] - seg[0] - 2);
        const sgn: 1 | -1 = this.rng.next() < 0.5 ? 1 : -1;
        const v = this.rng.range(P.sidewalkSpeed[0], P.sidewalkSpeed[1]);
        const p: Ped = {
          id: this.nextId++, kind: 'sidewalk', featureId: '', x: sign * (this.kerb + this.rng.range(0.8, 2.4)), z,
          dir: sign, v, a: sgn === 1 ? Math.PI : 0, speed: v, delay: 0, started: true, done: false,
        };
        this.list.push(p);
        this.walkers.set(p.id, { zMin: seg[0], zMax: seg[1], sgn, pause: 0 });
      }
    }
    for (const b of this.net.busStops) {
      const n = this.int(P.stopGroup);
      for (let i = 0; i < n; i++) {
        this.list.push({
          id: this.nextId++, kind: 'stop', featureId: '', x: b.sign * (this.kerb + this.rng.range(1.0, 2.2)), z: b.worldZ + this.rng.range(-3, 3),
          dir: b.sign, v: 0, a: b.sign === 1 ? -Math.PI / 2 : Math.PI / 2, speed: 0, delay: 0, started: false, done: false,
        });
      }
    }
  }

  spawn(f: Feature, count: number, delayStep = 2): void {
    const side: 1 | -1 = this.rng.next() < 0.5 ? 1 : -1;
    for (let i = 0; i < count; i++) {
      const dir: 1 | -1 = i % 2 === 0 ? side : (-side as 1 | -1);
      const v = this.rng.range(this.cfg.peds.speed[0], this.cfg.peds.speed[1]);
      this.list.push({
        id: this.nextId++, kind: 'crossing', featureId: f.def.id,
        x: -dir * this.edge, z: f.worldZ + this.rng.range(-1.2, 1.2),
        dir, v, a: dir * Math.PI / 2, speed: 0,
        delay: i * delayStep * this.rng.range(0.6, 1.2), started: false, done: false,
      });
    }
  }

  // Порушник виходить з правого бордюру напрямку dir у точці z.
  spawnJaywalker(dir: Dir, z: number): Ped {
    const toward: 1 | -1 = dir === 'S' ? 1 : -1; // S — бордюр на заході, іде на схід
    const v = this.rng.range(this.cfg.peds.jaywalkSpeed[0], this.cfg.peds.jaywalkSpeed[1]);
    const p: Ped = {
      id: this.nextId++, kind: 'jaywalker', featureId: '', x: -toward * (this.kerb + 0.4), z,
      dir: toward, v, a: toward * Math.PI / 2, speed: v, delay: 0, started: true, done: false,
    };
    this.list.push(p);
    return p;
  }

  // Учень наближається до нерегульованого переходу: інколи хтось виходить (сценарій навчання).
  trigger(f: Feature): void {
    if (f.def.kind !== 'zebra') return;
    if (this.list.some((p) => p.featureId === f.def.id && !p.done)) return;
    if (this.rng.next() < this.cfg.peds.zebraChance) this.spawn(f, this.int(this.cfg.peds.zebraGroup), 1.2);
  }

  // carNear(f): чи підʼїжджає/стоїть на переході авто так близько, що виходити небезпечно.
  // roadNear(z, dir): чи наближається хтось у напрямку dir до лінії z (для порушника на осьовій).
  step(t: number, dt: number, carNear: (f: Feature) => boolean = () => false, roadNear: (z: number, dir: Dir) => boolean = () => false): void {
    for (const f of this.net.features) {
      if (f.def.kind === 'intersection') continue; // пішоходи на перехрестях — пізніше
      if (f.def.kind === 'signalCrossing') {
        const walk = pedLightAt(t, f.def.offset ?? 0, this.cfg.signals) === 'walk';
        if (walk && !this.lastWalk.get(f.def.id) && this.rng.next() < this.cfg.peds.signalChance) {
          this.spawn(f, this.int(this.cfg.peds.signalGroup), 0.7);
        }
        this.lastWalk.set(f.def.id, walk);
      } else {
        const left = (this.ambientT.get(f.def.id) ?? 0) - dt;
        if (left <= 0) {
          if (!this.list.some((p) => p.featureId === f.def.id && !p.done)) this.spawn(f, this.int(this.cfg.peds.zebraGroup), 1.2);
          this.ambientT.set(f.def.id, this.rng.range(25, 50));
        } else this.ambientT.set(f.def.id, left);
      }
    }
    for (const p of this.list) {
      if (p.done) continue;
      if (p.kind === 'sidewalk') { this.walk(p, dt); continue; }
      if (p.kind === 'stop') continue;
      if (p.kind === 'jaywalker') { this.jaywalk(p, dt, roadNear); continue; }
      if (p.delay > 0) { p.delay -= dt; continue; }
      // На нерегульованому переході пішохід не кидається під колеса: чекає розриву.
      if (!p.started) {
        const f = this.net.features.find((q) => q.def.id === p.featureId)!;
        if (f.def.kind === 'zebra' && carNear(f)) continue;
        p.started = true;
      }
      p.speed = p.v;
      p.x += p.dir * p.v * dt;
      if (p.dir * p.x > this.edge) p.done = true;
    }
    this.list = this.list.filter((p) => !p.done);
  }

  private walk(p: Ped, dt: number): void {
    const w = this.walkers.get(p.id)!;
    if (w.pause > 0) {
      w.pause -= dt;
      p.speed = 0;
      if (w.pause <= 0) { w.sgn = (-w.sgn) as 1 | -1; p.a = w.sgn === 1 ? Math.PI : 0; }
      return;
    }
    p.speed = p.v;
    p.z += w.sgn * p.v * dt;
    if (p.z > w.zMax || p.z < w.zMin) {
      p.z = Math.min(w.zMax, Math.max(w.zMin, p.z));
      w.pause = this.rng.range(1, 4);
    }
  }

  // Порушник: свою (першу) половину проходить без зупинки, на осьовій чекає розриву в зустрічному напрямку.
  private jaywalk(p: Ped, dt: number, roadNear: (z: number, dir: Dir) => boolean): void {
    const farDir: Dir = p.dir === 1 ? 'N' : 'S';
    const atMedian = p.dir * p.x > -0.2 && p.dir * p.x < 0.2; // на подвійній суцільній (вона 1 м завширшки)
    if (atMedian && roadNear(p.z, farDir)) { p.speed = 0; return; }
    p.speed = p.v;
    p.x += p.dir * p.v * dt;
    if (p.dir * p.x > this.edge) p.done = true;
  }

  walking(p: Ped): boolean { return !p.done && p.started && p.kind !== 'sidewalk'; }

  // Половина вулиці (за X) напрямку dir, на якій пішохід, або null.
  onHalf(p: Ped, dir: Dir, margin: number): boolean {
    const [lo, hi] = this.net.carriageway[dir];
    if (p.x >= lo - margin * 0.25 && p.x <= hi + margin * 0.25) return true;
    const toward = p.x < lo ? p.dir === 1 : p.x > hi ? p.dir === -1 : false;
    const gap = p.x < lo ? lo - p.x : p.x - hi;
    return toward && gap <= margin;
  }

  // Порушники, яким треба поступитись у напрямку dir (на нашій половині або йдуть до неї).
  jaywalkers(dir: Dir, margin: number): Ped[] {
    return this.list.filter((p) => p.kind === 'jaywalker' && this.walking(p) && this.onHalf(p, dir, margin));
  }

  // Чи є на переході пішохід, якому треба поступитись у напрямку dir.
  conflict(featureId: string, dir: Dir, margin: number): boolean {
    return this.list.some((p) => p.featureId === featureId && p.kind === 'crossing' && this.walking(p) && this.onHalf(p, dir, margin));
  }
}
