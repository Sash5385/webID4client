// Пішоходи мережі: переходи (зебри й регульовані, у т.ч. в межах перехресть), тротуари, зупинки, порушник.
// Пішохід на переході рухається вздовж лінії переходу (u від бордюру a до бордюру b).
import type { SimConfig } from '../config';
import type { Rng } from '../rng';
import type { NetCrossing, NetEdge, Network } from './network';

export type PedKind = 'crossing' | 'sidewalk' | 'stop' | 'jaywalker';

// Лінія, якою йде пішохід (перехід або місце, де дорогу перебігає порушник).
export interface PedLine {
  readonly id: string;
  readonly ax: number; readonly az: number; readonly ux: number; readonly uz: number; readonly length: number;
  readonly spans: ReadonlyMap<string, { readonly s: number; readonly u0: number; readonly u1: number }>;
  readonly kind: 'zebra' | 'signal' | 'jaywalk';
}

export interface NetPed {
  readonly id: number;
  readonly kind: PedKind;
  readonly featureId: string;   // id переходу (crossing) або 'jw:…' (порушник); інакше ''
  x: number; z: number;
  readonly dir: 1 | -1;         // crossing/jaywalker: +1 від a до b; sidewalk/stop: 1
  readonly v: number;
  a: number;                    // курс (як у авто)
  speed: number;                // поточна швидкість (0 — стоїть)
  delay: number;
  started: boolean;
  done: boolean;
  u: number;                    // положення вздовж лінії (crossing/jaywalker)
  lat: number;                  // зсув поперек лінії (розкид по ширині зебри)
  readonly line: PedLine | null;
}

interface Walker { edge: NetEdge; d: number; s0: number; s1: number; s: number; sgn: 1 | -1; pause: number }

export class NetPeds {
  list: NetPed[] = [];
  private nextId = 1;
  private lastWalk = new Map<string, boolean>();
  private ambientT = new Map<string, number>();
  private walkers = new Map<number, Walker>();
  readonly lines = new Map<string, PedLine>();

  constructor(private readonly cfg: SimConfig, private readonly net: Network, private readonly rng: Rng) {
    for (const c of net.crossings.values()) {
      this.lines.set(c.id, { id: c.id, ax: c.ax, az: c.az, ux: c.ux, uz: c.uz, length: c.length, spans: c.spans, kind: c.kind });
      if (c.kind === 'zebra') this.ambientT.set(c.id, rng.range(8, 40));
    }
  }

  private int(r: readonly [number, number]): number { return r[0] + Math.floor(this.rng.next() * (r[1] - r[0] + 1)); }

  // Тротуари вздовж правого бордюру вулиць (на ділянках без переходів і виїздів) та зупинки.
  populateAmbient(edges: readonly NetEdge[]): void {
    const P = this.cfg.peds;
    for (const e of edges) {
      const cuts: [number, number][] = e.features.filter((f) => f.kind === 'crossing' || f.kind === 'signal').map((f) => [f.stop - 6, f.zone[1] + 6]);
      for (const c of e.departures) if (c.fromEdge === e && c.fromLane === e.n - 1) cuts.push([c.fromS - 4, c.fromS + 14]);
      cuts.sort((a, b) => a[0] - b[0]);
      const segs: [number, number][] = [];
      let from = 8;
      for (const [a, b] of cuts) { if (a - from > 20) segs.push([from, a]); from = Math.max(from, b); }
      if (e.length - 8 - from > 20) segs.push([from, e.length - 8]);
      const n = Math.round((e.length / 400) * this.int(P.sidewalkPerSide));
      for (let i = 0; i < n && segs.length; i++) {
        const seg = this.rng.pick(segs);
        const s = seg[0] + 1 + this.rng.next() * (seg[1] - seg[0] - 2);
        const v = this.rng.range(P.sidewalkSpeed[0], P.sidewalkSpeed[1]);
        const d = e.n * e.W + this.rng.range(0.8, 2.4);
        const sgn: 1 | -1 = this.rng.next() < 0.5 ? 1 : -1;
        const p = this.net.pose(e, s, d);
        const ped: NetPed = { id: this.nextId++, kind: 'sidewalk', featureId: '', x: p.x, z: p.z, dir: 1, v, a: sgn === 1 ? p.a : p.a + Math.PI, speed: v, delay: 0, started: true, done: false, u: 0, lat: 0, line: null };
        this.list.push(ped);
        this.walkers.set(ped.id, { edge: e, d, s0: seg[0], s1: seg[1], s, sgn, pause: 0 });
      }
    }
    for (const b of this.net.data.busStops) {
      const n = this.int(P.stopGroup);
      for (let i = 0; i < n; i++) {
        const ox = this.rng.range(-3, 3), oz = this.rng.range(-0.6, 0.6);
        const hx = Math.sin(b.a), hz = -Math.cos(b.a);
        this.list.push({
          id: this.nextId++, kind: 'stop', featureId: '', x: b.x + hx * ox - hz * oz, z: b.z + hz * ox + hx * oz, dir: 1, v: 0,
          a: b.a - Math.PI / 2, speed: 0, delay: 0, started: false, done: false, u: 0, lat: 0, line: null,
        });
      }
    }
  }

  private placeOnLine(p: NetPed): void {
    const L = p.line!;
    p.x = L.ax + L.ux * p.u - L.uz * p.lat; p.z = L.az + L.uz * p.u + L.ux * p.lat;
  }

  spawn(c: NetCrossing, count: number, delayStep = 2): void {
    const line = this.lines.get(c.id)!;
    const side: 1 | -1 = this.rng.next() < 0.5 ? 1 : -1;
    for (let i = 0; i < count; i++) {
      const dir: 1 | -1 = i % 2 === 0 ? side : (-side as 1 | -1);
      let v = this.rng.range(this.cfg.peds.speed[0], this.cfg.peds.speed[1]);
      // Довгий регульований перехід — встигнути за фазу.
      if (c.kind === 'signal') v = Math.max(v, (line.length + 3) / 15);
      const ped: NetPed = {
        id: this.nextId++, kind: 'crossing', featureId: c.id, x: 0, z: 0, dir, v,
        a: Math.atan2(line.ux * dir, -line.uz * dir), speed: 0,
        delay: i * delayStep * this.rng.range(0.6, 1.2), started: false, done: false,
        u: dir === 1 ? -1.6 : line.length + 1.6, lat: this.rng.range(-1.2, 1.2), line,
      };
      this.placeOnLine(ped);
      this.list.push(ped);
    }
  }

  // Порушник: лінія поперек дороги в точці s ребра e (від правого бордюру e через двійника до дальнього бордюру).
  spawnJaywalker(e: NetEdge, s: number, twin: NetEdge | null): NetPed {
    const kerb = this.net.pose(e, s, e.n * e.W + 0.4);
    const p = e.ref.pose(s);
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    const ux = hz, uz = -hx; // ліворуч від напрямку руху e
    const mh = e.data.median;
    const farW = twin ? twin.n * twin.W : e.n * e.W;
    const L = e.n * e.W + 0.4 + 2 * mh + farW + 0.4;
    const spans = new Map<string, { s: number; u0: number; u1: number }>();
    spans.set(e.id, { s, u0: 0.4, u1: 0.4 + e.n * e.W });
    if (twin) { const q = twin.ref.project(kerb.x + ux * L * 0.6, kerb.z + uz * L * 0.6); spans.set(twin.id, { s: q.s, u0: L - 0.4 - farW, u1: L - 0.4 }); }
    const line: PedLine = { id: `jw:${this.nextId}`, ax: kerb.x, az: kerb.z, ux, uz, length: L, spans, kind: 'jaywalk' };
    this.lines.set(line.id, line);
    const v = this.rng.range(this.cfg.peds.jaywalkSpeed[0], this.cfg.peds.jaywalkSpeed[1]);
    const ped: NetPed = { id: this.nextId++, kind: 'jaywalker', featureId: line.id, x: kerb.x, z: kerb.z, dir: 1, v, a: Math.atan2(ux, -uz), speed: v, delay: 0, started: true, done: false, u: 0, lat: 0, line };
    this.list.push(ped);
    return ped;
  }

  // Учень наближається до зебри: інколи хтось виходить (сценарій навчання).
  trigger(c: NetCrossing): void {
    if (c.kind !== 'zebra') return;
    if (this.list.some((p) => p.featureId === c.id && !p.done)) return;
    if (this.rng.next() < this.cfg.peds.zebraChance) this.spawn(c, this.int(this.cfg.peds.zebraGroup), 1.2);
  }

  // carNear(c, u): чи підʼїжджає/стоїть авто так близько до точки u переходу, що виходити небезпечно.
  // roadNear(line, u0, u1): чи наближається хтось до ділянки [u0, u1] лінії (порушник на осьовій).
  step(t: number, dt: number, carNear: (c: PedLine, u0: number, u1: number, movingOnly?: boolean) => boolean, roadNear: (line: PedLine, u0: number, u1: number) => boolean): void {
    for (const c of this.net.crossings.values()) {
      if (c.kind === 'signal') {
        const walk = this.net.pedLight(c, t, this.cfg.signals) === 'walk';
        if (walk && !this.lastWalk.get(c.id) && this.rng.next() < this.cfg.peds.signalChance) this.spawn(c, this.int(this.cfg.peds.signalGroup), 0.7);
        this.lastWalk.set(c.id, walk);
      } else {
        const left = (this.ambientT.get(c.id) ?? 0) - dt;
        if (left <= 0) {
          if (!this.list.some((p) => p.featureId === c.id && !p.done)) this.spawn(c, this.int(this.cfg.peds.zebraGroup), 1.2);
          this.ambientT.set(c.id, this.rng.range(25, 50));
        } else this.ambientT.set(c.id, left);
      }
    }
    for (const p of this.list) {
      if (p.done) continue;
      if (p.kind === 'sidewalk') { this.walk(p, dt); continue; }
      if (p.kind === 'stop') continue;
      if (p.kind === 'jaywalker') { this.jaywalk(p, dt, roadNear); continue; }
      if (p.delay > 0) { p.delay -= dt; continue; }
      const line = p.line!;
      if (!p.started) {
        const c = this.net.crossings.get(p.featureId)!;
        // Зебра: чекати, поки поруч немає авто біля краю, з якого виходимо.
        if (c.kind === 'zebra') { const sp = this.nextSpan(line, p.u, p.dir); if (sp && carNear(line, sp.u0, sp.u1)) continue; }
        // Регульований: лише на зелений для пішоходів.
        if (c.kind === 'signal' && this.net.pedLight(c, t, this.cfg.signals) !== 'walk') continue;
        p.started = true;
      }
      // На зебрі з острівцем/широкій дорозі: не виходити на наступну проїзну частину перед авто.
      if (line.kind === 'zebra' && this.atGapBetweenSpans(line, p.u)) {
        const sp = this.nextSpan(line, p.u, p.dir);
        if (sp && carNear(line, sp.u0, sp.u1, true)) { p.speed = 0; continue; }
      }
      p.speed = p.v;
      p.u += p.dir * p.v * dt;
      this.placeOnLine(p);
      if (p.u < -2 || p.u > line.length + 2) p.done = true;
    }
    this.list = this.list.filter((p) => !p.done);
  }

  // Наступна проїзна частина у напрямку руху пішохода (ще не почата).
  private nextSpan(line: PedLine, u: number, dir: 1 | -1): { u0: number; u1: number } | null {
    const sp = [...line.spans.values()].sort((a, b) => (a.u0 - b.u0) * dir);
    for (const q of sp) if (dir === 1 ? q.u1 > u + 0.3 : q.u0 < u - 0.3) return q;
    return null;
  }

  // Пішохід між проїзними частинами (острівець/осьова) — там можна чекати.
  private atGapBetweenSpans(line: PedLine, u: number): boolean {
    const sp = [...line.spans.values()].sort((a, b) => a.u0 - b.u0);
    for (let i = 0; i < sp.length - 1; i++) if (u >= sp[i]!.u1 - 0.2 && u <= sp[i + 1]!.u0 + 0.2) return true;
    return false;
  }

  private walk(p: NetPed, dt: number): void {
    const w = this.walkers.get(p.id)!;
    if (w.pause > 0) {
      w.pause -= dt; p.speed = 0;
      if (w.pause <= 0) w.sgn = (-w.sgn) as 1 | -1;
      return;
    }
    p.speed = p.v;
    w.s += w.sgn * p.v * dt;
    if (w.s > w.s1 || w.s < w.s0) { w.s = Math.min(w.s1, Math.max(w.s0, w.s)); w.pause = this.rng.range(1, 4); }
    const q = this.net.pose(w.edge, w.s, w.d);
    p.x = q.x; p.z = q.z; p.a = w.sgn === 1 ? q.a : q.a + Math.PI;
  }

  // Свою (першу) проїзну частину проходить без зупинки, на осьовій чекає розриву.
  private jaywalk(p: NetPed, dt: number, roadNear: (line: PedLine, u0: number, u1: number) => boolean): void {
    const line = p.line!;
    const sp = [...line.spans.values()].sort((a, b) => a.u0 - b.u0);
    const far = sp[sp.length - 1]!;
    if (sp.length > 1 && p.u >= sp[0]!.u1 && p.u < far.u0 && p.u > far.u0 - 0.9 && roadNear(line, far.u0, far.u1)) { p.speed = 0; return; }
    p.speed = p.v;
    p.u += p.v * dt;
    this.placeOnLine(p);
    if (p.u > line.length + 1) p.done = true;
  }

  walking(p: NetPed): boolean { return !p.done && p.started && p.kind !== 'sidewalk' && p.kind !== 'stop'; }

  // Пішохід на ділянці [u0, u1] лінії (± margin/4) або йде до неї й уже ближче за margin.
  onSpan(p: NetPed, u0: number, u1: number, margin: number): boolean {
    if (p.u >= u0 - margin * 0.25 && p.u <= u1 + margin * 0.25) return true;
    const toward = p.u < u0 ? p.dir === 1 : p.u > u1 ? p.dir === -1 : false;
    const gap = p.u < u0 ? u0 - p.u : p.u - u1;
    return toward && gap <= margin;
  }

  // Чи є на лінії lineId пішохід, якому треба поступитись на ділянці [u0, u1].
  conflict(lineId: string, u0: number, u1: number, margin: number): boolean {
    return this.list.some((p) => p.featureId === lineId && (p.kind === 'crossing' || p.kind === 'jaywalker') && this.walking(p) && this.onSpan(p, u0, u1, margin));
  }
  conflictEdge(lineId: string, edgeId: string, margin: number): boolean {
    const line = this.lines.get(lineId);
    const sp = line?.spans.get(edgeId);
    return !!sp && this.conflict(lineId, sp.u0, sp.u1, margin);
  }

  // Порушники, яким треба поступитись на ребрі e: [s лінії на ребрі].
  jaywalkersOn(edgeId: string, margin: number): { ped: NetPed; s: number }[] {
    const out: { ped: NetPed; s: number }[] = [];
    for (const p of this.list) {
      if (p.kind !== 'jaywalker' || !this.walking(p)) continue;
      const sp = p.line!.spans.get(edgeId);
      if (sp && this.onSpan(p, sp.u0, sp.u1, margin)) out.push({ ped: p, s: sp.s });
    }
    return out;
  }
}
