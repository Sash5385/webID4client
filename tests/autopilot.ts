// Автопілот «зразкового учня» для тестів: проходить маршрут за правилами.
// Опції дозволяють навмисно порушувати правила, щоб перевірити суддю.

import type { Controls, Sim } from '../src/engine/sim';
import { ringBusy } from '../src/engine/traffic';
import { mod } from '../src/engine/geometry';

export interface PilotOpts {
  target?: number;          // бажана швидкість на вулиці, м/с
  ignoreLights?: boolean;
  noSignals?: boolean;
  neverExit?: boolean;
  uturnAtFirst?: boolean;   // розворот на першому перехресті (не за маршрутом)
  uturnEarly?: boolean;     // розворот до середини перехрестя
  stayLeft?: boolean;       // не повертатись у праву смугу на півночі
  approachLeft?: boolean;   // до кільця по лівій смузі → внутрішня смуга кільця
  ring1Inner?: boolean;     // на першому кільці перестроїтись у внутрішню (помилка для 1-го зʼїзду)
  noBypass?: boolean;       // не обʼїжджати перешкоди/райдерів (стоїть позаду)
  ignoreJaywalker?: boolean; // не зупинятись перед пішоходом поза переходом
  ignoreTurners?: boolean;  // не поступатись ІІ, що вже повертає (і не бачити його попереду)
  ramStatics?: boolean;     // «не бачить» припарковані/зламані (тест на зіткнення)
  squeezeRiders?: boolean;  // протискатись повз райдера у своїй смузі (тест closeOvertake)
}

export class Pilot {
  private sigWait = 0;
  private turned = false;
  private ringPressed = '';

  constructor(private readonly sim: Sim, private readonly o: PilotOpts = {}) {}

  private want(dir: -1 | 0 | 1): void {
    if (this.o.noSignals) { if (this.sim.sig !== 0) this.sim.toggleSignal(this.sim.sig as -1 | 1); return; }
    if (this.sim.sig === dir) return;
    if (dir === 0) this.sim.toggleSignal(this.sim.sig as -1 | 1);
    else { this.sim.toggleSignal(dir); this.sigWait = 0; }
  }

  // Найближча перешкода попереду в коридорі гравця: авто (у т.ч. припарковані), райдери.
  // Перед нерухомою перешкодою стоїмо з запасом standoff (щоб було куди виїхати).
  private carsAhead(range: number, lateral = 1.8, standoff = 0): number {
    const p = this.sim.player;
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    let g = Infinity;
    // Коридор з урахуванням повороту кузова: бокова «половина» тіла + наша + запас.
    const test = (x: number, z: number, a: number, hl: number, hw: number, extra: number): void => {
      const dx = x - p.x, dz = z - p.z;
      const fwd = dx * hx + dz * hz, lat = dx * -hz + dz * hx;
      const da = a - p.a;
      const latB = Math.abs(Math.sin(da)) * hl + Math.abs(Math.cos(da)) * hw;
      const lonB = Math.abs(Math.cos(da)) * hl + Math.abs(Math.sin(da)) * hw;
      if (fwd > -lonB && fwd < range && Math.abs(lat) < Math.max(lateral, 0.9 + latB + 0.35)) g = Math.min(g, fwd - lonB - 2.2 - extra);
    };
    const hw = this.sim.cfg.car.width / 2;
    for (const c of this.sim.traffic.cars) {
      if (this.o.ramStatics && c.kind !== 'car') continue;
      if (this.o.ignoreTurners && c.plan && !c.plan.done && (c.commit || c.leg === c.plan.turnLeg)) continue;
      test(c.x, c.z, c.a, c.len / 2, hw, c.kind === 'car' ? 0 : standoff);
      if (c.off !== c.offT) { // перестроюється до нас — вже вважаємо його в нашій смузі
        const hx2 = Math.sin(c.a), hz2 = -Math.cos(c.a), dd = c.offT - c.off;
        test(c.x - hz2 * dd, c.z + hx2 * dd, c.a, c.len / 2, hw, 0);
      }
    }
    if (!this.o.squeezeRiders) for (const r of this.sim.riders.list) test(r.x, r.z, r.a, r.len / 2, r.width / 2, 0);
    return g;
  }

  // Хто де на Мрії: [s, lane, v, kind] для всіх тіл у напрямку dir (авто — і за цільовою смугою, якщо перестроюються).
  private street(dir: 'S' | 'N'): { s: number; lane: 0 | 1; v: number; len: number; stat: boolean; rider: boolean }[] {
    const sim = this.sim, net = sim.net, W = net.laneWidth;
    const out: { s: number; lane: 0 | 1; v: number; len: number; stat: boolean; rider: boolean }[] = [];
    for (const c of sim.traffic.cars) {
      const q = net.streetSlot(c.x, c.z);
      if (!q || q.dir !== dir) continue;
      out.push({ s: q.s, lane: q.lane, v: c.v, len: c.len, stat: c.kind !== 'car', rider: false });
      if (c.off !== c.offT) { // перестроюється — займає й цільову смугу
        const d2 = q.d + (c.offT - c.off);
        out.push({ s: q.s, lane: d2 < W ? 0 : 1, v: c.v, len: c.len, stat: false, rider: false });
      }
    }
    for (const r of sim.riders.list) {
      if (r.turn) continue;
      const q = net.streetSlot(r.x, r.z);
      if (q && q.dir === dir) out.push({ s: q.s, lane: q.lane, v: r.v, len: r.len, stat: false, rider: true });
    }
    return out;
  }

  // Чи заважає хтось перестроїтись у смугу lane (null — можна).
  private laneBlocker(dir: 'S' | 'N', lane: 0 | 1): { rel: number; v: number; stat: boolean } | null {
    const sim = this.sim;
    const L = sim.cfg.car.length;
    const v = sim.v;
    for (const b of this.street(dir)) {
      if (b.lane !== lane) continue;
      const rel = b.s - sim.where.s;
      const half = L / 2 + b.len / 2;
      if (b.stat) { if (rel > -half - 3 && rel < 30) return { rel, v: 0, stat: true }; continue; }
      if (rel >= 0) { if (rel - half < Math.max(8, v * 1.0 + Math.max(0, v - b.v) * 1.5)) return { rel, v: b.v, stat: false }; }
      // Позаду: щоб тому, хто наздоганяє, не довелося гальмувати різкіше ~4 м/с² (IDM).
      else if (-rel - half < 5 + b.v * 0.8 + Math.max(0, b.v - v) * 2.0) return { rel, v: b.v, stat: false };
    }
    return null;
  }

  // У смузі lane попереду нерухома перешкода (у межах from..to від центру гравця) або повільний райдер.
  private obstacleIn(dir: 'S' | 'N', lane: 0 | 1, from: number, to: number, riderTo: number, slowV: number): boolean {
    const s0 = this.sim.where.s;
    return this.street(dir).some((b) => b.lane === lane && (b.stat ? b.s - s0 > from && b.s - s0 < to : b.rider && b.v < slowV && b.s - s0 > from && b.s - s0 < riderTo));
  }

  // Точка перетину лінії між смугами (середина маневру) не на суцільній.
  private inSolid(dir: 'S' | 'N', s: number): boolean {
    const sim = this.sim;
    const cross = s + Math.min(40, Math.max(12, sim.v * 2.5)) / 2 + sim.v * 0.1;
    return sim.net.features.some((f) => cross + 4 >= f.stop[dir] - sim.cfg.rules.solidBeforeStop && cross - 4 <= f.zone[dir][1]);
  }

  // ІІ, що вже повертає (має перевагу): не заїжджати на його траєкторію, поки він її не звільнить.
  private turnerGap(): number {
    const sim = this.sim;
    const p = sim.player;
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    let g = Infinity;
    for (const c of sim.traffic.cars) {
      if (!c.plan || c.plan.done) continue;
      const onTurn = c.leg === c.plan.turnLeg;
      if (!onTurn && !c.commit) continue;
      const cf = (c.x - p.x) * hx + (c.z - p.z) * hz;
      if (!onTurn && cf < 0) continue; // позаду в нашій смузі — не наша справа
      const pts: { x: number; z: number }[] = [];
      for (let i = c.leg, s = c.s; i <= c.plan.turnLeg + 1 && i < c.legs.length; i++, s = 0) {
        const path = c.legs[i]!.path;
        const end = i === c.plan.turnLeg + 1 ? Math.min(path.length, 8) : path.length;
        for (let q = s; q <= end; q += 1.5) pts.push(path.pose(q));
      }
      for (const q of pts) {
        const dx = q.x - p.x, dz = q.z - p.z;
        const fwd = dx * hx + dz * hz, lat = dx * -hz + dz * hx;
        if (fwd > 0 && fwd < 60 && Math.abs(lat) < 2.4) g = Math.min(g, fwd - sim.cfg.car.length / 2 - 0.9 - 1.5);
      }
    }
    return g;
  }

  // Хтось інший уже вʼїжджає на кільце з цього ж рукава (ближче до точки злиття).
  private merging(arm: 'W' | 'S'): boolean {
    const sim = this.sim;
    const th = sim.net.arms[arm].mergeTheta, r = sim.net.ring.r;
    const mx = r * Math.cos(th), mz = -r * Math.sin(th);
    const mine = Math.hypot(sim.x - mx, sim.z - mz);
    return sim.traffic.cars.some((c) => {
      const kind = c.legs[c.leg]!.kind;
      return (kind === 'entry' || kind === 'lane') && Math.hypot(c.x - mx, c.z - mz) < Math.min(14, mine);
    });
  }

  controls(dt: number): Controls {
    const sim = this.sim;
    const w = sim.where;
    const v = sim.v;
    if (sim.sig !== 0) this.sigWait += dt;
    let target = this.o.target ?? 12;
    let gap = w.mode === 'street' ? Infinity : this.carsAhead(40);

    if (w.mode === 'path' && w.pathKind === 'startIn') {
      target = 8;
      this.want(1);
      if (!this.ringPressed) { sim.turn(); this.ringPressed = 'start'; }
      const bodies = sim.traffic.ringBodies('W');
      if (ringBusy(sim.net, sim.net.arms.W.mergeTheta, bodies, 0, sim.cfg.rules.ringYieldTime + 2) || this.merging('W')) gap = Math.min(gap, w.pathLength - w.s - 2.2);
    } else if (w.mode === 'path') {
      target = w.pathKind === 'uturn' ? 5 : 7;
      // На вʼїзді: якщо сусід зі своєї смуги вже ближче до злиття — пропустити.
      if (w.pathKind === 'entry' && w.pathLength - w.s > 7) {
        const arm = sim.stage === 'start' ? 'W' : 'S';
        if (this.merging(arm) || ringBusy(sim.net, sim.net.arms[arm].mergeTheta, sim.traffic.ringBodies(arm), 0, 2.5)) gap = Math.min(gap, w.pathLength - w.s - 7);
      }
    } else if (w.mode === 'ring') {
      target = 7;
      if (this.o.ring1Inner && sim.stage === 'ring1' && w.lane === 1 && !w.changing) sim.changeLane(-1);
      // Зʼїзд із внутрішньої смуги перетинає зовнішню: пропустити тих, хто в ній поруч.
      if (w.lane === 0 && w.armed) {
        const r = sim.net.ring.r, exTh = sim.net.arms[w.armed].exitAt(0);
        const me = Math.atan2(-sim.z, sim.x);
        const toExit = mod(exTh - me, Math.PI * 2) * r;
        if (toExit < 14) {
          const outerBusy = sim.traffic.cars.some((c) => {
            const dr = Math.hypot(c.x, c.z) - sim.net.laneR(1);
            if (Math.abs(dr) > 1.5) return false;
            const rel = (mod(Math.atan2(-c.z, c.x) - me + Math.PI, Math.PI * 2) - Math.PI) * r;
            return rel > -14 && rel < 6;
          });
          if (outerBusy) gap = Math.min(gap, toExit - 4);
        }
      }
      const expected = sim.stage === 'ring2' ? 'W' : 'S';
      // Покажчик — заздалегідь (після попереднього зʼїзду), «Зʼїзд» — коли наступний зʼїзд наш.
      const before = sim.stage === 'ring2' ? 'E' : 'W';
      if (!this.o.neverExit && (w.nextExit === before || w.nextExit === expected)) this.want(1);
      if (!this.o.neverExit && w.nextExit === expected && w.armed !== expected) sim.turn();
    } else {
      const dir = w.dir;
      const W = sim.net.laneWidth;
      const front = w.s + sim.cfg.car.length / 2;
      for (const f of sim.net.features) {
        const d = f.stop[dir] - front;
        if (d > 90 || front > f.zone[dir][0]) continue;
        if (f.signalised && !this.o.ignoreLights && d >= -0.3) {
          const l = sim.light(f);
          if (l === 'red' || l === 'redYellow' || (l === 'yellow' && d > (v * v) / 14 + 0.5) || (l === 'greenBlink' && d > (v * v) / 8 + 6)) gap = Math.min(gap, d);
        }
        if (f.def.kind !== 'intersection' && sim.peds.conflict(f.def.id, dir, 10)) gap = Math.min(gap, Math.max(0, d));
      }
      // Пішохід поза переходом: стоїмо, поки він на нашій половині або йде до неї.
      if (!this.o.ignoreJaywalker) {
        for (const p of sim.peds.jaywalkers(dir, 3)) {
          const d = sim.net.sAt(dir, p.z) - 3.5 - front;
          if (d > -3 && d < 90) gap = Math.min(gap, Math.max(0, d));
        }
      }
      if (!this.o.ignoreTurners) gap = Math.min(gap, this.turnerGap());

      // Базова смуга за маршрутом.
      let base: 0 | 1 = 1;
      let uturnLeft = Infinity;
      const toEnd = w.pathLength - w.s;
      if (dir === 'S') {
        const u = this.o.uturnAtFirst ? sim.net.features.find((f) => f.def.kind === 'intersection')! : sim.net.features.find((f) => f.def.uturn)!;
        uturnLeft = u.def.s - w.s;
        if (uturnLeft < 330 && !this.o.uturnAtFirst) base = 0;
      } else if (this.o.approachLeft && toEnd < 230) base = 0;
      if (this.o.stayLeft && dir === 'N') base = 0;
      // Обʼїзд: перешкода/повільний райдер у базовій смузі — у сусідню (якщо там вільно від перешкод).
      const other = (1 - base) as 0 | 1;
      const slowV = Math.min(target, 12) - 2;
      let wantLane: 0 | 1 = base;
      const nearUturn = dir === 'S' && sim.net.features.find((f) => f.def.uturn)!.def.s - w.s < 120;
      if (!this.o.noBypass && !nearUturn) {
        const sT = this.o.ramStatics ? -1 : 1, rT = this.o.squeezeRiders ? -1 : 1; // «погані» опції: не бачити
        const blockedBase = w.lane === base
          ? this.obstacleIn(dir, base, 0, 75 * sT, 45 * rT, slowV)
          : this.obstacleIn(dir, base, -9, 60 * sT, 35 * rT, slowV + 3);
        if (blockedBase && !this.obstacleIn(dir, other, -12, 40, -1, 0)) {
          wantLane = other;
          // Перешкоду майже обʼїхали, далі вільно — покажчик назад уже зараз (3 с наперед).
          if (w.lane === other && !w.changing && !this.obstacleIn(dir, base, 18, 60 * sT, 35 * rT, slowV + 3)) this.want(base > w.lane ? 1 : -1);
        }
      }
      // Нерухома перешкода в нашій смузі — стоїмо з запасом, щоб було куди виїхати.
      let carGap = this.carsAhead(40, 1.8, w.changing ? 0 : 6);
      if (w.lane !== wantLane && !w.changing) {
        const sd = wantLane > w.lane ? 1 : -1;
        this.want(sd);
        const b = this.laneBlocker(dir, wantLane);
        const urgent = dir === 'S' && wantLane === 0 && uturnLeft < 250;
        if (b && !b.stat && (b.rel > -8 || urgent)) target = Math.min(target, Math.max(3, b.v - 3)); // пропустити вперед
        // До розвороту не встиг у ліву — чекати перед суцільною.
        if (dir === 'S' && wantLane === 0 && w.lane === 1 && uturnLeft < 90) gap = Math.min(gap, Math.max(0, uturnLeft - 62 - sim.cfg.car.length / 2));
        const ready = (this.o.noSignals || this.sigWait > 3.3) && !b && !this.inSolid(dir, w.s);
        if (ready) {
          if (v >= 1.05) sim.changeLane(sd);
          else { carGap = this.carsAhead(40, 1.8, 0); target = Math.min(target, 3); } // рушити й виїхати з-за перешкоди
        }
      } else if (!w.changing && w.lane === wantLane && sim.sig !== 0 && wantLane === base && !(dir === 'S' && uturnLeft < 330 && w.lane === 0)) {
        this.want(0);
      }
      gap = Math.min(gap, carGap);

      if (dir === 'S') {
        const u = this.o.uturnAtFirst ? sim.net.features.find((f) => f.def.kind === 'intersection')! : sim.net.features.find((f) => f.def.uturn)!;
        const left = uturnLeft;
        if (left < 330 && !this.o.uturnAtFirst && w.lane === 0 && !w.changing) this.want(-1);
        if (this.o.uturnAtFirst && left < 30) this.want(-1);
        const point = this.o.uturnEarly ? u.def.s - 6 : u.def.s;
        if (left < 60) {
          gap = Math.min(gap, point - w.s);
          const oncoming = sim.traffic.cars.some((c) => {
            const leg = c.legs[c.leg]!;
            return leg.kind === 'lane' && leg.dir === 'N' && c.v > 0.1 && c.z > sim.player.z - 4 && (c.z - sim.player.z) / Math.max(0.1, c.v) < 7;
          });
          if (!this.turned && w.s >= point - 3 && v < 0.5 && !oncoming) { sim.turn(); this.turned = true; }
        }
      } else {
        if (toEnd < 40) target = 7;
        const bodies = sim.traffic.ringBodies('S');
        if (toEnd < 40 && (ringBusy(sim.net, sim.net.arms.S.mergeTheta, bodies, 0, sim.cfg.rules.ringYieldTime + 2) || this.merging('S'))) gap = Math.min(gap, toEnd - 2.2);
      }
      void W;
    }

    const vt = Math.min(target, Math.sqrt(2 * 3 * Math.max(0, gap - 1)));
    if (v > vt + 0.3) return { gas: false, brake: true };
    if (v < vt - 0.3) return { gas: true, brake: false };
    return { gas: false, brake: false };
  }
}

export function run(sim: Sim, o: PilotOpts = {}, maxT = 900): void {
  const pilot = new Pilot(sim, o);
  const dt = sim.cfg.dt;
  while (!sim.result && sim.t < maxT) sim.step(pilot.controls(dt), dt);
}

export const angle = (a: number): number => mod(a, Math.PI * 2);
