// Автопілот «зразкового учня» для маршруту №1 (мережа OSM). Опції — навмисні порушення для перевірки судді.
import type { Controls } from '../src/engine/sim';
import type { NetSim } from '../src/engine/net/sim';
import type { NetConn, NetEdge } from '../src/engine/net/network';
import { ringBusyN } from '../src/engine/net/traffic';
import { mod } from '../src/engine/geometry';

export interface NetPilotOpts {
  target?: number;
  ignoreLights?: boolean;
  noSignals?: boolean;
  neverExit?: boolean;
  skipLeft?: boolean;        // не повертати ліворуч на Турчина (їхати прямо)
  wrongTurnRight?: boolean;  // повернути праворуч у першу бічну вулицю на Стеценці
  ignoreOncoming?: boolean;  // лівий поворот / розворот без поступки зустрічним
  ignorePeds?: boolean;      // не поступатись пішоходам на переходах біля поворотів
  stayLeft?: boolean;        // їхати лівою смугою там, де можна правою
  leftFromMiddle?: boolean;  // лівий поворот на Турчина з середньої смуги
  noBypass?: boolean;
  skipUturn?: boolean;       // не розвертатись біля пл. Марченка
  ringFirstExit?: boolean;   // на кільці — перший зʼїзд (не той)
}

interface Item { s: number; lane: number; v: number; len: number; stat: boolean; rider: boolean }

export class NetPilot {
  private sigWait = 0;
  constructor(private readonly sim: NetSim, private readonly o: NetPilotOpts = {}) {}

  private want(dir: -1 | 0 | 1): void {
    const sim = this.sim;
    if (this.o.noSignals) { if (sim.sig !== 0) sim.toggleSignal(sim.sig as -1 | 1); return; }
    if (sim.sig === dir) return;
    if (dir === 0) sim.toggleSignal(sim.sig as -1 | 1);
    else { sim.toggleSignal(dir); this.sigWait = 0; }
  }

  // Перешкода в коридорі гравця попереду (авто, у т.ч. нерухомі, райдери).
  private carsAhead(range: number, lateral = 1.8, standoff = 0): number {
    const sim = this.sim, p = sim.player;
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    let g = Infinity;
    const test = (x: number, z: number, a: number, hl: number, hw: number, extra: number): void => {
      const dx = x - p.x, dz = z - p.z;
      const fwd = dx * hx + dz * hz, lat = dx * -hz + dz * hx;
      const da = a - p.a;
      const latB = Math.abs(Math.sin(da)) * hl + Math.abs(Math.cos(da)) * hw;
      const lonB = Math.abs(Math.cos(da)) * hl + Math.abs(Math.sin(da)) * hw;
      if (fwd > -lonB && fwd < range && Math.abs(lat) < Math.max(lateral, 0.9 + latB + 0.35)) g = Math.min(g, fwd - lonB - 2.2 - extra);
    };
    const hw = sim.cfg.car.width / 2;
    for (const c of sim.traffic.cars) {
      test(c.x, c.z, c.a, c.len / 2, hw, c.kind === 'car' ? 0 : standoff);
      if (c.off !== c.offT) { const hx2 = Math.sin(c.a), hz2 = -Math.cos(c.a), dd = c.offT - c.off; test(c.x - hz2 * dd, c.z + hx2 * dd, c.a, c.len / 2, hw, 0); }
    }
    for (const r of sim.riders.list) test(r.x, r.z, r.a, r.len / 2, r.width / 2, 0);
    return g;
  }

  // Хто на ребрі e: s/смуга (авто — і цільова смуга, якщо перестроюються).
  private onEdge(e: NetEdge): Item[] {
    const out: Item[] = [];
    const s0 = this.sim.where.edge === e.id ? this.sim.where.s : e.ref.project(this.sim.x, this.sim.z).s;
    const add = (x: number, z: number, v: number, len: number, stat: boolean, rider: boolean, dExtra = 0): void => {
      const q = e.ref.projectRange(x, z, s0 - 170, s0 + 170);
      const d = q.d + dExtra;
      if (d < -0.5 || d > e.n * e.W + 0.5 || q.s < -10 || q.s > e.length + 10) return;
      out.push({ s: q.s, lane: Math.max(0, Math.min(e.n - 1, Math.floor(d / e.W))), v, len, stat, rider });
    };
    for (const c of this.sim.traffic.cars) {
      if (Math.abs(c.x - this.sim.x) > 150 || Math.abs(c.z - this.sim.z) > 150) continue;
      add(c.x, c.z, c.v, c.len, c.kind !== 'car', false);
      if (c.off !== c.offT) add(c.x, c.z, c.v, c.len, false, false, c.offT - c.off);
    }
    for (const r of this.sim.riders.list) add(r.x, r.z, r.v, r.len, false, true);
    return out;
  }

  private laneBlocker(e: NetEdge, lane: number): { rel: number; v: number; stat: boolean } | null {
    const sim = this.sim, L = sim.cfg.car.length, v = sim.v, s0 = sim.where.s;
    for (const b of this.onEdge(e)) {
      if (b.lane !== lane) continue;
      const rel = b.s - s0, half = L / 2 + b.len / 2;
      if (b.stat) { if (rel > -half - 3 && rel < 30) return { rel, v: 0, stat: true }; continue; }
      if (rel >= 0) { if (rel - half < Math.max(8, v * 1.0 + Math.max(0, v - b.v) * 1.5)) return { rel, v: b.v, stat: false }; }
      else if (-rel - half < 5 + b.v * 0.8 + Math.max(0, b.v - v) * 2.0) return { rel, v: b.v, stat: false };
    }
    return null;
  }

  private obstacleIn(e: NetEdge, lane: number, from: number, to: number, riderTo: number, slowV: number): boolean {
    const s0 = this.sim.where.s;
    // Нерухома черга ІІ не біля світлофора/переходу/«Дати дорогу» (її тримає зламане авто попереду) — теж перешкода.
    const queued = (b: Item): boolean => !b.stat && !b.rider && b.v < 0.5 && !e.features.some((f) => (f.kind === 'signal' || f.kind === 'crossing' || f.kind === 'yield') && f.stop - b.s > -4 && f.stop - b.s < 50);
    return this.onEdge(e).some((b) => b.lane === lane && (b.stat || queued(b) ? b.s - s0 > from && b.s - s0 < to : b.rider && b.v < slowV && b.s - s0 > from && b.s - s0 < riderTo));
  }

  private inSolid(e: NetEdge, s: number): boolean {
    const sim = this.sim;
    const cross = s + Math.min(40, Math.max(12, sim.v * 2.5)) / 2 + sim.v * 0.1;
    return e.features.some((f) => (f.kind === 'signal' || f.kind === 'crossing' || f.kind === 'yield') && cross + 4 >= f.stop - sim.cfg.rules.solidBeforeStop && cross - 4 <= f.zone[1]);
  }

  // «Поганий учень»: перша бічна вулиця праворуч на Стеценці (20–60 м попереду, з поточної смуги).
  private sideTarget(e: NetEdge): NetConn | null {
    const w = this.sim.where;
    if (e.data.chain !== 'stet_se') return null;
    return e.departures.find((c) => c.dir === 1 && c.fromLane === w.lane && c.fromS - w.s < 60 && c.fromS - w.s > 3 && !c.junction) ?? null;
  }

  // Найпізніша точка перетину лінії між смугами (поза суцільними) на ребрі e між s і sEnd, або null.
  private deadline(e: NetEdge, s: number, sEnd: number): number | null {
    const L = this.sim.cfg.rules.solidBeforeStop;
    const solid = e.features.filter((f) => f.kind === 'signal' || f.kind === 'crossing' || f.kind === 'yield').map((f) => [f.stop - L - 4, f.zone[1] + 4] as [number, number]);
    for (let x = sEnd - 3; x > s; x -= 1) {
      if (solid.some(([a, b]) => x >= a && x <= b)) continue;
      let ok = true;
      for (let y = x - 8; y <= x; y += 1) if (solid.some(([a, b]) => y >= a && y <= b)) { ok = false; break; }
      if (ok) return x;
    }
    return null;
  }

  // ІІ, що вже повертає (має перевагу): не заїжджати на його траєкторію.
  private turnerGap(): number {
    const sim = this.sim, p = sim.player;
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    let g = Infinity;
    for (const c of sim.traffic.cars) {
      if (!c.plan || c.plan.done) continue;
      const onTurn = c.leg === c.plan.turnLeg;
      if (!onTurn && !c.commit) continue;
      const cf = (c.x - p.x) * hx + (c.z - p.z) * hz;
      if (!onTurn && cf < 0) continue;
      for (let i = c.leg, s = c.s; i <= c.plan.turnLeg + 1 && i < c.legs.length; i++, s = 0) {
        const path = c.legs[i]!.path;
        const end = i === c.plan.turnLeg + 1 ? Math.min(path.length, 8) : path.length;
        for (let q = s; q <= end; q += 1.5) {
          const pt = path.pose(q);
          const dx = pt.x - p.x, dz = pt.z - p.z;
          const fwd = dx * hx + dz * hz, lat = dx * -hz + dz * hx;
          if (fwd > 0 && fwd < 60 && Math.abs(lat) < 2.4) g = Math.min(g, fwd - sim.cfg.car.length / 2 - 0.9 - 1.5);
        }
      }
    }
    return g;
  }

  // Пішоходи на переходах, які перетинає зʼєднувач (і на початку цільового ребра).
  private pedsOnConn(c: NetConn, margin: number): boolean {
    const peds = this.sim.peds;
    for (const x of c.crossings) if (peds.conflict(x.crossing.id, x.u - 3.5, x.u + 3.5, margin)) return true;
    if (c.toEdge) for (const f of c.toEdge.features) if (f.kind === 'crossing' && f.crossing && f.stop - c.toS < 15 && f.zone[1] > c.toS && peds.conflictEdge(f.crossing.id, c.toEdge.id, margin)) return true;
    return false;
  }

  // Місце після повороту зайняте чергою.
  private landingBlocked(c: NetConn): boolean {
    if (!c.toEdge) return false;
    const e = c.toEdge;
    return this.onEdge(e).some((b) => b.lane === c.toLane && b.s > c.toS - 4 && b.s < c.toS + 12 && b.v < 3);
  }

  private firstConflictS(c: NetConn): number {
    if (!c.laneConflicts.length) return Infinity;
    return Math.min(...c.laneConflicts.map((q) => q.connS));
  }

  // Смуга, яка продовжується за маршрутом (найправіша з можливих), або потрібна для повороту.
  private baseLane(e: NetEdge): number {
    const sim = this.sim, w = sim.where;
    const steps = sim.steps_;
    const nx = steps[w.step + 1];
    let maxLane = e.n - 1;
    // Права смуга закінчується далі: їдемо нею, а за ~140 м до кінця перестроюємось ліворуч.
    if (nx?.kind === 'edge') { const ne = sim.net.edge(nx.edge); if (ne.n < e.n && e.length - w.s > 140) maxLane = Math.min(maxLane, Math.max(ne.n - 1, e.n - 1)); else maxLane = Math.min(maxLane, ne.n - 1); }
    const prep = sim.prepDistances();
    const exp = sim.expectedConn();
    if (prep.left < 410) {
      const lc = sim.nextTurnConn();
      if (lc && this.o.leftFromMiddle && lc.turn === 'left') return Math.min(1, e.n - 1);
      return 0;
    }
    if (exp && exp.dir === 1 && exp.fromS - w.s < 200) return exp.fromLane;
    if (this.o.stayLeft) return 0;
    return maxLane;
  }

  controls(dt: number): Controls {
    const sim = this.sim, w = sim.where, v = sim.v;
    if (sim.sig !== 0) this.sigWait += dt;
    let target = this.o.target ?? 12;
    let gap = w.mode === 'edge' ? Infinity : this.carsAhead(40);
    const half = sim.cfg.car.length / 2;

    // Перший зʼїзд з кільця: правий покажчик — ще перед вʼїздом на кільце (інакше «невчасно»).
    {
      const up = [sim.steps_[w.step], sim.steps_[w.step + 1]].find((q) => q?.kind === 'ring');
      if (up?.kind === 'ring' && up.exitNo === 1 && w.mode !== 'ring' && !this.o.noSignals) {
        const e0 = w.edge ? sim.net.edge(w.edge) : null;
        if (w.mode === 'path' || (e0?.ringEntry && e0.length - w.s < 35)) this.want(1);
      }
    }
    if (w.mode === 'ring') {
      target = 7;
      const st = sim.steps_[w.step];
      const expected = st?.kind === 'ring' ? st.exit : null;
      if (this.o.ringFirstExit) { if (w.nextExit && !w.armedExit) { this.want(1); sim.turn(); } }
      else if (!this.o.neverExit && expected && w.nextExit === expected) { this.want(1); if (w.armedExit !== expected) sim.turn(); }
      // Зʼїзд із внутрішньої перетинає зовнішню — пропустити.
      if (w.lane === 0 && w.armedExit) {
        const ring = sim.net.rings.find((r) => r.id === w.ring)!;
        const ex = ring.exit.get(w.armedExit)![0]!.fromTheta!;
        const toExit = mod(ex - w.theta, Math.PI * 2) * ring.r;
        if (toExit < 14 && sim.traffic.cars.some((c) => Math.abs(Math.hypot(c.x - ring.cx, c.z - ring.cz) - ring.laneR(1)) < 1.5 && Math.abs((mod(sim.net.ringTheta(ring, c.x, c.z) - w.theta + Math.PI, Math.PI * 2) - Math.PI) * ring.r) < 14)) gap = Math.min(gap, toExit - 4);
      }
    } else if (w.mode === 'path') {
      const c = sim.net.conn(w.conn!);
      target = w.pathKind === 'entry' ? 7 : Math.min(7, Math.sqrt(2.5 * Math.max(3, c.data.minRadius)) + 1);
      if (w.pathKind === 'entry' && w.pathLength - w.s > 7) {
        const ring = c.ring!;
        if (ringBusyN(ring, c.toTheta!, sim.traffic.ringBodies(ring, c), 0, 2.5)) gap = Math.min(gap, w.pathLength - w.s - 7);
      }
      if ((w.pathKind === 'conn' || w.pathKind === 'adhoc') && (c.turn === 'left' || c.turn === 'uturn') && !this.o.ignoreOncoming) {
        const first = this.firstConflictS(c);
        if (w.s + half < first - 0.5 && sim.oncomingBusy(c, 6)) gap = Math.min(gap, first - 1.5 - w.s - half);
      }
      if ((w.pathKind === 'conn' || w.pathKind === 'adhoc') && !this.o.ignorePeds) {
        for (const x of c.crossings) {
          if (w.s + half < x.s - 2.2 && sim.peds.conflict(x.crossing.id, x.u - 3.5, x.u + 3.5, 6)) gap = Math.min(gap, x.s - 2.5 - w.s - half);
        }
      }
      gap = Math.min(gap, this.turnerGap());
    } else {
      const e = sim.net.edge(w.edge!);
      const front = w.s + half;
      const steps = sim.steps_;
      const nx = steps[w.step + 1];
      // Світлофори й переходи: це ребро і наступне за маршрутом.
      const feats = (edge: NetEdge, base: number): void => {
        for (const f of edge.features) {
          const d = f.stop - front + base;
          if (d > 90 || front - base > f.zone[0]) continue;
          if (f.kind === 'signal' && f.ctrl && f.group && !this.o.ignoreLights && d >= -0.3) {
            const l = sim.light(f.ctrl, f.group);
            if (l === 'red' || l === 'redYellow' || (l === 'yellow' && d > (v * v) / (2 * sim.cfg.rules.yellowComfortDecel)) || (l === 'greenBlink' && d > (v * v) / 8 + 6)) gap = Math.min(gap, d);
          }
          if (f.kind === 'crossing' && f.crossing && f.crossing.kind === 'zebra' && d < 45 && d > -4) target = Math.min(target, 6.5); // перед зеброю — повільніше: пішохід стартує за ~15 м
          if (f.kind === 'crossing' && f.crossing && sim.peds.conflictEdge(f.crossing.id, edge.id, 10)) gap = Math.min(gap, Math.max(0, d - 1.5)); // запас перед пішоходом
          if (f.kind === 'yield') {
            const ring = edge.ringEntry!.ring;
            const rl = edge.n === 1 ? 1 : w.lane === 0 ? 0 : 1;
            const cn = ring.entry.get(edge.ringEntry!.arm.id)![rl]!;
            if (d < 45) target = Math.min(target, 7);
            if (d < 45 && (ringBusyN(ring, cn.toTheta!, sim.traffic.ringBodies(ring, cn), 0, sim.cfg.rules.ringYieldTime + 2) || this.merging(edge, cn))) gap = Math.min(gap, d + 0.1);
          }
        }
      };
      feats(e, 0);
      if (nx?.kind === 'edge' && e.length - w.s < 90) feats(sim.net.edge(nx.edge), e.length);
      for (const j of sim.peds.jaywalkersOn(e.id, 3)) { const d = j.s - 3.5 - front; if (d > -3 && d < 90) gap = Math.min(gap, Math.max(0, d)); }
      gap = Math.min(gap, this.turnerGap());

      // Смуга.
      let base = this.baseLane(e);
      const exp = sim.expectedConn();
      const toTurn = exp ? exp.fromS - w.s : Infinity;
      const otherOf = (l: number): number => (l > 0 ? l - 1 : l + 1);
      let wantLane = base;
      const slowV = Math.min(target, 12) - 2;
      const nearTurn = toTurn < 120;
      if (!this.o.noBypass && !nearTurn && e.n >= 2) {
        const blockedBase = w.lane === base ? this.obstacleIn(e, base, 0, 150, 45, slowV) : this.obstacleIn(e, base, -9, 170, 35, slowV + 3);
        const other = otherOf(base);
        if (blockedBase && !this.obstacleIn(e, other, -12, 40, -1, 0)) {
          wantLane = other;
          if (w.lane === other && !w.changing && !this.obstacleIn(e, base, 18, 60, 35, slowV + 3)) this.want(base > w.lane ? 1 : -1);
        }
      }
      let carGap = this.carsAhead(40, 1.8, w.changing ? 0 : 6);
      if (w.lane !== wantLane && !w.changing) {
        const sd = wantLane > w.lane ? 1 : -1;
        const tgt = w.lane + sd;
        this.want(sd);
        const b = this.laneBlocker(e, tgt);
        const prepL = sim.prepDistances().left;
        const urgent = (exp !== null && toTurn < 250) || prepL < 410;
        if (b && !b.stat && (b.rel > -8 || urgent)) target = Math.min(target, Math.max(3, b.v - 3)); // пропустити вперед
        const laneEnds = ((): boolean => { const n0 = sim.steps_[w.step + 1]; if (n0?.kind !== 'edge') return false; const ne0 = sim.net.edge(n0.edge); return ne0.n <= w.lane; })();
        const ready = (this.o.noSignals || this.sigWait > 3.3) && !b && !this.inSolid(e, w.s) && (e.length - w.s > 15 || laneEnds);
        // Останнє місце, де ще можна перестроїтись до повороту (поза суцільними): чекати перед ним.
        const turnS = exp && wantLane === exp.fromLane ? exp.fromS : prepL < 410 && wantLane === 0 ? w.s + prepL : Infinity;
        if (urgent && turnS < Infinity && !ready) {
          const dl = this.deadline(e, w.s, Math.min(turnS, e.length));
          if (dl !== null) gap = Math.min(gap, Math.max(0, dl - (b ? 7 : 1) - front));
        }
        if (ready) {
          if (v >= 1.05 || w.s >= e.length - 0.6) sim.changeLane(sd); // з місця — лише в кінці смуги, що закінчується
          else { carGap = this.carsAhead(40, 1.8, 0) + 2; target = Math.min(target, 3); } // підповзти, щоб набрати ≥ 1 м/с для перестроювання
        }
      } else if (!w.changing && w.lane === wantLane && sim.sig !== 0 && wantLane === base) {
        const keep = exp && toTurn < Math.max(80, v * 6) && sim.sig === (exp.dir === 0 ? 1 : exp.dir);
        const keepLeft = exp && exp.dir === -1 && w.lane === exp.fromLane && sim.sig === -1;
        const keepWrong = this.o.wrongTurnRight && this.sideTarget(e) !== null;
        if (!keep && !keepLeft && !keepWrong) this.want(0);
      }
      // Не ставати на переході / в перехресті, якщо попереду черга: позаду переднього авто має лишитися місце.
      {
        const L = sim.cfg.car.length;
        let lead: Item | null = null;
        for (const b of this.onEdge(e)) if (b.lane === w.lane && !b.rider && b.s > w.s + 1 && (!lead || b.s < lead.s)) lead = b;
        if (lead && (lead.v < 3 || e.length - lead.s < 15)) {
          const rear = lead.s - lead.len / 2;
          for (const f of e.features) {
            if (f.kind !== 'crossing' && f.kind !== 'signal') continue;
            if (f.stop - front < 0.3) continue;
            if (rear > f.zone[0] - 1 && rear - f.zone[1] < L + 1.5) gap = Math.min(gap, f.stop - front);
          }
        }
      }
      gap = Math.min(gap, carGap);
      void base; base = wantLane;

      // Поворот за маршрутом.
      if (exp && !(this.o.skipLeft && exp.turn === 'left') && !(this.o.skipUturn && exp.turn === 'uturn')) {
        if (toTurn < Math.max(70, v * 6) && (w.lane === exp.fromLane || (this.o.leftFromMiddle && exp.turn === 'left')) && !w.changing) this.want(exp.dir === 0 ? 1 : exp.dir);
        if (toTurn < 60 && !w.armed && (w.lane === exp.fromLane || this.o.leftFromMiddle) && sim.sig === (exp.dir === 0 ? 1 : exp.dir) && this.sigWait > 0.5) sim.turn(exp.dir === 0 ? 1 : exp.dir);
        // Чекати в точці повороту: зустрічні, пішоходи, місце після повороту.
        if (toTurn < 60) {
          let wait = false;
          if ((exp.turn === 'left' || exp.turn === 'uturn') && !this.o.ignoreOncoming && sim.oncomingBusy(exp, 7)) wait = true;
          if (!this.o.ignorePeds && this.pedsOnConn(exp, 6)) wait = true;
          if (this.landingBlocked(exp)) wait = true;
          if (this.sigWait < 3.4 && !this.o.noSignals) wait = true;
          if (wait) gap = Math.min(gap, toTurn - half - 0.3);
        }
      }
      if (((this.o.skipLeft && exp?.turn === 'left') || (this.o.skipUturn && exp?.turn === 'uturn')) && sim.sig === -1 && toTurn < 60 && !w.changing) this.want(0);
      if (this.o.wrongTurnRight && this.sideTarget(e)) { this.want(1); if (this.sigWait > 3.4) sim.turn(1); }
    }

    const vt = Math.min(target, Math.sqrt(2 * 3 * Math.max(0, gap - 1)));
    if (v > vt + 0.3) return { gas: false, brake: true };
    if (v < vt - 0.3) return { gas: true, brake: false };
    return { gas: false, brake: false };
  }

  // Хтось інший уже вʼїжджає з цього рукава ближче до злиття.
  private merging(e: NetEdge, cn: NetConn): boolean {
    const sim = this.sim;
    const end = cn.path.pose(cn.path.length);
    const mine = Math.hypot(sim.x - end.x, sim.z - end.z);
    return sim.traffic.cars.some((c) => {
      const k = c.legs[c.leg]!;
      return (k.kind === 'entry' || (k.kind === 'lane' && k.edge === e)) && Math.hypot(c.x - end.x, c.z - end.z) < Math.min(14, mine);
    });
  }
}

export function run1(sim: NetSim, o: NetPilotOpts = {}, maxT = 900): void {
  const pilot = new NetPilot(sim, o);
  const dt = sim.cfg.dt;
  while (!sim.result && sim.t < maxT) sim.step(pilot.controls(dt), dt);
}
