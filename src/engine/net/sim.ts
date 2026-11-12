// Тренажер маршруту на мережі (маршрут №1): гравець, правила, суддя, підказки. Без DOM і three.js.
// Публічний інтерфейс повторює маршрут №7 (step / toggleSignal / changeLane / turn / player / next / faults / result),
// плюс turn(dir) — явний напрямок манeвру (−1 ліворуч/розворот, 1 праворуч/зʼїзд).
import { Gearbox } from '../gearbox';
import type { FaultCode, SimConfig } from '../config';
import { bezierPath, boxesOverlap, clamp, mod, pointBoxDist, smoothstep, wrapAngle, type Box, type Path, type Polyline } from '../geometry';
import { Rng } from '../rng';
import { isStopLight, type Light, type PedLight } from '../signals';
import type { Body } from '../traffic';
import type { Controls, Fault, PlayerView, Result, SimEvent } from '../sim7';
import { FAULT_TEXT } from '../sim7';
import { Network, type NetConn, type NetEdge, type NetFeature, type NetRing } from './network';
import { NetPeds, type PedLine } from './peds';
import { NetRiders } from './riders';
import { NetTraffic, ringBusyN, type NetCar } from './traffic';
import type { NetRouteId } from '../sim';
import type { RouteData, RouteStepData } from './types';

export type NetMode = 'edge' | 'path' | 'ring';
export type NetPathKind = 'conn' | 'entry' | 'exit' | 'adhoc';
type Action = { type: 'signal'; dir: -1 | 1 } | { type: 'lane'; dir: -1 | 1 } | { type: 'turn'; dir: -1 | 0 | 1 };

export interface NetWhere {
  mode: NetMode; pathKind: NetPathKind | null; edge: string | null; lane: number; lanes: number; s: number; d: number;
  pathLength: number; changing: boolean; step: number; conn: string | null; ring: string | null; theta: number;
  armed: string | null; armedExit: string | null; nextExit: string | null;
}

interface RingPlan { ring: NetRing; entry: string; exit: string; exitNo: number; step: number }

export class NetSim {
  readonly route: NetRouteId;
  readonly cfg: SimConfig;
  readonly data: RouteData;
  readonly net: Network;
  readonly traffic: NetTraffic;
  readonly peds: NetPeds;
  readonly riders: NetRiders;
  t = 0;
  stage = 'start';
  faults: Fault[] = [];
  result: Result | null = null;

  private mode: NetMode = 'edge';
  private pathKind: NetPathKind | null = null;
  private path: Path | null = null;
  private conn: NetConn | null = null;
  edge: NetEdge;
  s = 0;
  private d = 0;
  private lane = 0;
  private change: { from: number; to: number; target: number; prog: number; dist: number; sign: -1 | 1 } | null = null;
  private ring: NetRing | null = null;
  private theta = 0;
  private ringPlan: RingPlan | null = null;
  private armedExit: string | null = null;
  private armPendingRing = false;
  private armed: { conn: NetConn; dir: -1 | 1 } | null = null;
  private stepIdx = 0;
  private readonly steps: readonly RouteStepData[];
  private hold = false;
  v = 0;
  x = 0; z = 0; a = 0;
  private yaw = 0;
  sig: -1 | 0 | 1 = 0;
  private sigT = 0;
  private braking = false;
  // Зчеплення з дорогою: 1 суха, ~0.65 дощ, ~0.4 сніг, ~0.18 ожеледь — впливає на гальмування й розгін гравця.
  grip = 1;
  readonly gb = new Gearbox(0); // коробка: автомат (типово) або механіка
  setGrip(g: number): void { this.grip = Math.max(0.1, Math.min(1, g)); this.traffic.grip = this.grip; }

  private actions: Action[] = [];
  private events: SimEvent[] = [];
  private hinted = new Set<string>();
  private passFlags = new Set<string>();
  private overT = 0;
  private speedArmed = true;
  private hogT = 0;
  private hogArmed = true;
  private lcEnd = -Infinity;
  private prevLead = new Map<number, number>();
  private cutIn = new Map<number, number>();
  private forced = new Set<number>();
  private closePassed = new Set<number>();
  private jw: { edge: NetEdge; twin: NetEdge | null; windows: [number, number][] } | null = null;
  private jwDone = false;
  private jwYielded = new Set<number>();
  private oncomingChecked = false;

  constructor(cfg: SimConfig, raw: RouteData, route: NetRouteId = 'route1') {
    this.cfg = cfg;
    this.route = route;
    const def = raw.routes?.[route] ?? (route === 'route1' ? raw.route : undefined);
    if (!def) throw new Error('Невідомий маршрут: ' + route);
    const data: RouteData = { ...raw, route: def };
    this.data = data;
    const rng = new Rng(cfg.seed);
    this.net = new Network(data);
    this.steps = data.route.steps;
    this.peds = new NetPeds(cfg, this.net, rng);
    this.traffic = new NetTraffic(cfg, this.net, rng);
    this.riders = new NetRiders(cfg, this.net, rng);
    this.traffic.riders = this.riders;
    const st = data.route.start;
    this.edge = this.net.edge(st.edge);
    this.s = st.s;
    this.lane = st.lane;
    this.d = this.net.laneD(this.edge, this.lane);
    this.stepIdx = this.steps.findIndex((q) => q.kind === 'edge' && q.edge === st.edge);
    this.updatePose();
    const street = this.net.edgeList.filter((e) => e.kind === 'street' && e.n >= 2);
    this.traffic.placeObstacles(this.body(), street, this.leftKeep(), this.rightKeep());
    this.populateRiders(rng);
    this.peds.populateAmbient(this.net.edgeList.filter((e) => e.kind === 'street'));
    this.traffic.populate(this.body(), this.riders.bodies());
    this.planJaywalker(rng);
    const ringStep = this.steps.find((q) => q.kind === 'ring');
    this.hint('start', route === 'route1' || !ringStep
      ? 'Рушайте до кільця. Поступіться тим, хто на кільці. Зʼїзд — другий, на вул. Стеценка: правий покажчик і «Зʼїзд».'
      : `Рушайте до кільця. Поступіться тим, хто на кільці. ${ringStep.text.replace('Кільце: ', '')}: правий покажчик і «Зʼїзд».`);
  }

  // ---- Керування ----
  toggleSignal(dir: -1 | 1): void { this.actions.push({ type: 'signal', dir }); }
  changeLane(dir: -1 | 1): void { this.actions.push({ type: 'lane', dir }); }
  turn(dir: -1 | 0 | 1 = 0): void { this.actions.push({ type: 'turn', dir }); }

  get player(): PlayerView {
    return { x: this.x, z: this.z, a: this.a, v: this.v, sig: this.sig, braking: this.braking, lane: this.mode === 'path' ? null : (this.lane as 0 | 1), sigT: this.sigT };
  }
  get where(): NetWhere {
    return {
      mode: this.mode, pathKind: this.pathKind, edge: this.mode === 'edge' ? this.edge.id : null, lane: this.lane,
      lanes: this.mode === 'edge' ? this.edge.n : this.mode === 'ring' ? 2 : 1, s: this.s, d: this.d,
      pathLength: this.mode === 'path' ? this.path!.length : this.mode === 'edge' ? this.edge.length : 0,
      changing: this.change !== null, step: this.stepIdx, conn: this.conn?.id ?? null, ring: this.ring?.id ?? null, theta: this.theta,
      armed: this.armed?.conn.id ?? null, armedExit: this.armedExit, nextExit: this.mode === 'ring' ? this.nextExitArm() : null,
    };
  }
  get minorCount(): number { return this.faults.filter((f) => f.severity === 'minor').length; }
  get steps_(): readonly RouteStepData[] { return this.steps; }

  // Світлофори для рендера: голова (vehicle) за контролером і групою, пішохідний — за переходом.
  light(ctrl: string, group: 'A' | 'B'): Light { return this.net.light(ctrl, group, this.t, this.cfg.signals); }
  pedLight(crossingId: string): PedLight { const c = this.net.crossings.get(crossingId); return c ? this.net.pedLight(c, this.t, this.cfg.signals) : 'walk'; }
  featureLight(f: NetFeature): Light | null { return f.ctrl && f.group ? this.light(f.ctrl, f.group) : null; }

  // Наступний маневр за маршрутом і відстань до нього.
  get next(): { text: string; dist: number } {
    if (this.mode === 'ring' && this.ringPlan) {
      const arm = this.ring!.arms.find((q) => q.id === this.ringPlan!.exit)!;
      return { text: (this.steps[this.ringPlan.step] as { text: string }).text, dist: mod(arm.theta[this.curLane()]! - this.theta, Math.PI * 2) * this.ring!.r };
    }
    let dist: number;
    let k = this.stepIdx + 1;
    let last: NetEdge | null;
    if (this.mode === 'edge') { dist = this.edge.length - this.s; last = this.edge; }
    else if (this.pathKind === 'entry' && this.ringPlan) {
      // Вʼїзд на кільце: до свого зʼїзду.
      const ring = this.ringPlan.ring, arm = ring.arms.find((q) => q.id === this.ringPlan!.exit)!;
      const th0 = this.conn!.toTheta!;
      return { text: (this.steps[this.ringPlan.step] as { text: string }).text, dist: this.path!.length - this.s + mod(arm.theta[this.lane]! - th0, Math.PI * 2) * ring.r };
    } else {
      dist = this.path!.length - this.s;
      const c = this.conn!;
      last = c.toEdge;
      if (c.toEdge) {
        dist += c.toEdge.length - c.toS;
        const cur = this.steps[this.stepIdx];
        if (cur?.kind === 'edge' && cur.edge === c.toEdge.id) k = this.stepIdx + 1;
        else { const nx = this.steps[this.stepIdx + 1]; k = nx?.kind === 'edge' && nx.edge === c.toEdge.id ? this.stepIdx + 2 : this.stepIdx + 1; }
      } else last = null;
    }
    for (; k < this.steps.length; k++) {
      const st = this.steps[k]!;
      if (st.kind === 'edge') { last = this.net.edge(st.edge); dist += last.length; continue; }
      if (st.kind === 'turn') { const c = this.net.conn(st.conn); dist -= c.fromEdge!.length - c.fromS; return { text: st.text, dist: Math.max(0, dist) }; }
      if (st.kind === 'ring') return { text: st.text, dist: Math.max(0, dist) };
      if (st.kind === 'finish') { dist -= this.net.edge(st.edge).length - st.s; return { text: 'Фініш', dist: Math.max(0, dist) }; }
    }
    void last;
    return { text: 'Фініш', dist: 0 };
  }

  step(ctl: Controls, dt = this.cfg.dt): SimEvent[] {
    this.events = [];
    if (this.result) return this.events;
    this.t += dt;
    for (const act of this.actions.splice(0)) this.apply(act);
    if (this.result) return this.events;
    const P = this.cfg.player;
    this.braking = ctl.brake;
    if (this.gb.manual) this.v = this.gb.step(this.v, { gas: ctl.gas, brake: ctl.brake, clutch: !!ctl.clutch }, P, this.grip, dt);
    else if (ctl.brake) this.v -= P.brake * this.grip * dt;
    else if (ctl.gas) this.v += P.accel * (0.4 + 0.6 * this.grip) * Math.max(1 - Math.pow(this.v / 22, 3), 0.5 * (1 - this.v / P.maxV)) * dt; // до 80 км/год як раніше; далі повільніший набір швидкості до максимуму
    else this.v -= P.coast * dt;
    this.v = clamp(this.v, 0, P.maxV);
    if (this.hold && !this.armed && !this.change) this.v = 0;
    this.hold = false;
    if (this.sig !== 0) this.sigT += dt;
    this.move(this.v * dt);
    if (this.result) return this.events;
    this.checkSkid();
    if (this.result) return this.events;

    this.peds.step(this.t, dt, (line, u0, u1, mv) => this.carNear(line, u0, u1, mv), (line, u0, u1) => this.roadNear(line, u0, u1));
    const others: Body[] = [this.body(), ...this.traffic.cars.map((c) => this.traffic.body(c))];
    this.riders.step(this.t, dt, others, this.peds, this.traffic.holding);
    this.traffic.index();
    this.traffic.step(this.t, dt, this.body(), this.peds, this.riders.bodies(), this.ghost(), () => this.playerWillStop());
    this.checkCollisions();
    if (this.result) return this.events;
    this.checkJaywalker();
    if (this.result) return this.events;
    this.checkCloseOvertake();
    this.checkForcedBraking();
    if (this.result) return this.events;
    this.checkSpeed(dt);
    this.checkLeftLane(dt);
    this.learnHints();
    return this.events;
  }

  // ---- Внутрішнє ----

  private body(): Body {
    if (this.mode === 'edge') {
      const ln = this.edge.lanes[Math.max(0, Math.min(this.edge.n - 1, Math.round(this.d / this.edge.W - 0.5)))]!;
      return { id: 0, box: this.box(), v: this.v, kind: 'player', path: ln, ps: ln.projectRange(this.x, this.z, this.s - 15, this.s + 15).s };
    }
    if (this.mode === 'path') return { id: 0, box: this.box(), v: this.v, kind: 'player', path: this.path!, ps: this.s };
    return { id: 0, box: this.box(), v: this.v, kind: 'player' };
  }
  private box(): Box { return { x: this.x, z: this.z, a: this.a, hl: this.cfg.car.length / 2, hw: this.cfg.car.width / 2 }; }

  private fault(code: FaultCode, message = FAULT_TEXT[code]): void {
    if (this.result) return;
    const f: Fault = { code, severity: this.cfg.severity[code], message, t: this.t, x: this.x, z: this.z };
    this.faults.push(f);
    this.events.push({ type: 'fault', fault: f });
    if (f.severity === 'serious') this.finish(false, message);
    // Іспит: дрібні помилки накопичуються, їзда не обривається; вердикт — після фінішу (4 і більше = «Не склав»). У навчанні — як раніше.
    else if (this.cfg.mode !== 'exam' && this.minorCount >= this.cfg.rules.maxMinorFaults) this.finish(false, `Набрано ${this.minorCount} помилки`);
  }
  private finish(passed: boolean, reason: string): void {
    if (passed && this.minorCount >= this.cfg.rules.maxMinorFaults) { passed = false; reason = `Набрано ${this.minorCount} дрібних помилок`; }
    this.result = { passed, reason, faults: this.faults.slice(), minor: this.minorCount, time: this.t };
    this.events.push({ type: 'finish', result: this.result });
  }
  private hint(key: string, text: string): void {
    if (this.cfg.mode !== 'learn' || this.hinted.has(key)) return;
    this.hinted.add(key);
    this.events.push({ type: 'hint', key, text });
  }
  private info(text: string): void { this.events.push({ type: 'info', text }); }
  private checkSignal(dir: -1 | 1): void {
    if (this.sig !== dir) this.fault('noSignal');
    else if (this.sigT < this.cfg.rules.signalLeadS) this.fault('lateSignal');
  }

  // Очікуваний маневр за маршрутом на поточному ребрі (зʼєднувач) або null.
  expectedConn(): NetConn | null {
    const nx = this.steps[this.stepIdx + 1];
    return this.mode === 'edge' && nx?.kind === 'turn' ? this.net.conn(nx.conn) : null;
  }
  private expectedNext(): RouteStepData | null { return this.steps[this.stepIdx + 1] ?? null; }

  private apply(act: Action): void {
    if (act.type === 'signal') {
      if (this.sig === act.dir) this.sig = 0; else { this.sig = act.dir; this.sigT = 0; }
      return;
    }
    if (act.type === 'lane') { this.startLaneChange(act.dir); return; }
    if (this.mode === 'ring') { this.armedExit = this.nextExitArm(); return; }
    if (this.mode === 'path' && this.pathKind === 'entry') { this.armPendingRing = true; return; }
    if (this.mode !== 'edge') return;
    // Перед кільцем: «Зʼїзд» заздалегідь.
    if (this.edge.ringEntry && this.edge.length - this.s < 80 && act.dir !== -1) { this.armPendingRing = true; return; }
    const exp = this.expectedConn();
    let dir: -1 | 1 | 0 = act.dir;
    if (dir === 0) {
      if (exp && exp.fromS - this.s < 70 && exp.fromS - this.s > -2) dir = exp.dir === 0 ? 1 : exp.dir;
      else if (this.sig !== 0) dir = this.sig;
    }
    if (dir === 0) { this.info('Тут поворот неможливий'); return; }
    // Найближчий зʼїзд у цьому напрямку попереду (до 70 м), з будь-якої смуги.
    const cands = this.edge.departures.filter((c) => c.dir === dir && c.fromS > this.s - 2 && c.fromS - this.s < 70);
    if (!cands.length) { this.info(dir === -1 ? 'Тут поворот ліворуч неможливий' : 'Тут поворот праворуч неможливий'); return; }
    const near = Math.min(...cands.map((c) => c.fromS));
    const atPoint = cands.filter((c) => c.fromS - near < 3);
    const mine = atPoint.find((c) => c === exp && c.fromLane === this.curLane()) ?? atPoint.find((c) => c.fromLane === this.curLane()) ?? atPoint.find((c) => c === exp) ?? atPoint[0]!;
    this.armed = { conn: mine, dir };
  }

  private curLane(): number { return this.change ? this.change.target : this.lane; }

  private nextExitArm(): string | null {
    if (!this.ring) return null;
    let best: string | null = null, bd = Infinity;
    for (const a of this.ring.arms) {
      if (a.kind !== 'exit') continue;
      const dd = mod(a.theta[this.curLane()]! - this.theta, Math.PI * 2);
      if (dd > 0.02 && dd < bd) { bd = dd; best = a.id; }
    }
    return best;
  }

  private startLaneChange(dir: -1 | 1): void {
    if (this.mode === 'path' || this.change) return;
    const ring = this.mode === 'ring';
    // Стоїть у кінці смуги, що закінчується: перестроїтись з місця на останніх метрах.
    const fromStop = this.v < 1 && this.mode === 'edge' && this.s >= this.edge.length - 0.6;
    if (this.v < 1 && !fromStop) { this.info('Перестроювання — лише під час руху'); return; }
    const n = ring ? 2 : this.edge.n;
    const target = this.lane + dir;
    if (target < 0) { this.info(ring ? 'Ліворуч центральний острів' : 'Ліворуч осьова лінія / край проїзної частини — перестроїтись неможливо'); return; }
    if (target > n - 1) { this.info(ring ? 'Ви вже в правій смузі кільця' : 'Праворуч бордюр — перестроїтись неможливо'); return; }
    this.checkSignal(dir);
    if (this.result) return;
    const W = ring ? this.ring!.laneWidth : this.edge.W;
    const to = ring ? (target - 0.5) * W : W * (target + 0.5);
    if (fromStop) this.s = Math.max(0, this.edge.length - 7);
    this.change = { from: this.d, to, target, prog: 0, dist: fromStop ? 6 : ring ? clamp(this.v * 2, 8, 20) : clamp(this.v * 2.5, 12, 40), sign: dir };
  }

  private advanceChange(ds: number): void {
    if (!this.change) return;
    const c = this.change;
    c.prog = Math.min(1, c.prog + ds / c.dist);
    this.d = c.from + (c.to - c.from) * smoothstep(c.prog);
    if (c.prog >= 1) {
      this.lcEnd = this.t;
      this.lane = c.target;
      if (this.sig === c.sign) this.sig = 0;
      this.change = null;
    }
  }

  // Занос: у повороті (звʼязник) на слизькій дорозі авто тримає поворот лише до швидкості, що залежить від радіуса й зчеплення.
  // Суха й мокра дорога (зчеплення ≥ 0,6) не перевіряються: там діють звичайні правила.
  private checkSkid(): void {
    if (this.grip >= 0.6 || this.mode !== 'path' || !this.conn) return;
    const R = Math.max(2, this.conn.data.minRadius);
    const allowed = Math.sqrt(2.2 * R) * Math.sqrt(this.grip / 0.62);
    if (this.v > allowed * 1.35) this.fault('skid');
    else if (this.v > allowed * 1.05) this.hint('skid', 'Слизько: у повороті швидкість потрібно скинути заздалегідь');
  }

  private move(ds: number): void {
    if (this.mode === 'edge') this.moveEdge(ds);
    else if (this.mode === 'ring') this.moveRing(ds);
    else this.movePath(ds);
  }

  // Множник довжини: на кривій смуга з d ≠ 0 довша/коротша за ref.
  private refFactor(): number {
    const e = this.edge;
    if (this.s < 0.6 || this.s > e.length - 0.6) return 1;
    const a = this.net.pose(e, this.s - 0.5, this.d), b = this.net.pose(e, this.s + 0.5, this.d);
    return clamp(Math.hypot(b.x - a.x, b.z - a.z), 0.5, 2);
  }

  private moveEdge(ds: number): void {
    const prevS = this.s, prevD = this.d;
    const dsr = ds / this.refFactor();
    this.s += dsr;
    const W = this.edge.W;
    this.advanceChange(ds);
    for (let k = 1; k < this.edge.n; k++) {
      if ((prevD - k * W) * (this.d - k * W) <= 0 && prevD !== this.d && this.inSolidZone()) { this.fault('solidLine'); break; }
    }
    if (this.result) return;
    this.yaw = ds > 1e-6 ? Math.atan2(this.d - prevD, ds) : this.yaw * 0.9;
    this.updatePose();
    this.checkFeatures(prevS);
    if (this.result) return;
    // Фініш.
    const fin = this.expectedNext();
    if (fin?.kind === 'finish' && fin.edge === this.edge.id && this.s >= fin.s) { this.finish(true, 'Маршрут пройдено'); return; }
    // Зʼєднувачі, що починаються на пройденій ділянці.
    const exp = this.expectedConn();
    if (this.armed && this.armed.conn.fromEdge === this.edge && this.s >= this.armed.conn.fromS - 0.01) {
      this.takeArmed();
      return;
    }
    if (this.armed && this.s > this.armed.conn.fromS + 3) this.armed = null;
    if (exp && this.s > exp.fromS + 3 && exp.fromS < this.edge.length - 0.5) {
      this.fault('offRoute', `Пропущено: ${(this.steps[this.stepIdx + 1] as { text: string }).text}`);
      return;
    }
    if (this.s >= this.edge.length) this.atEdgeEnd(ds);
  }

  // Узяти зʼєднувач, на який натиснули «Поворот».
  private takeArmed(): void {
    const arm = this.armed!;
    this.armed = null;
    const exp = this.expectedConn();
    const lane = this.curLane();
    const at = this.edge.departures.filter((c) => c.dir === arm.dir && Math.abs(c.fromS - arm.conn.fromS) < 3);
    let c = at.find((q) => q === exp && q.fromLane === lane) ?? at.find((q) => q.fromLane === lane) ?? null;
    let adhoc = false;
    if (!c) {
      if (exp && at.includes(exp)) { c = exp; adhoc = true; }
      else { this.info('З цієї смуги тут повернути не можна'); return; }
    }
    if (c !== exp) {
      this.fault('offRoute', c.turn === 'uturn' ? 'Розворот не за маршрутом' : 'Поворот не за маршрутом');
      return;
    }
    if (adhoc) { this.fault(c.turn === 'uturn' ? 'uturnWrongLane' : 'turnWrongLane'); if (this.result) return; }
    this.checkSignal(c.dir === 0 ? 1 : c.dir);
    if (this.result) return;
    this.enterConn(c, adhoc);
  }

  private enterConn(c: NetConn, adhoc: boolean): void {
    const over = Math.max(0, this.s - c.fromS);
    this.path = adhoc ? bezierPath({ x: this.x, z: this.z, a: this.a }, { ...c.path.pose(c.path.length) }, 8, 6, 28) : c.path;
    this.conn = c;
    this.mode = 'path';
    this.pathKind = 'conn';
    this.s = over;
    this.change = null;
    this.yaw = 0;
    this.oncomingChecked = false;
    this.stepIdx++;
    this.stage = c.turn === 'uturn' ? 'uturn' : c.turn === 'left' ? 'leftTurn' : 'rightTurn';
    this.updatePose();
  }

  private atEdgeEnd(ds: number): void {
    const e = this.edge;
    const nx = this.expectedNext();
    const over = this.s - e.length;
    // Продовження ланцюжка (зміна кількості смуг).
    if (nx?.kind === 'edge' && e.next.some((q) => q.id === nx.edge)) {
      const ne = this.net.edge(nx.edge);
      if (this.curLane() >= ne.n) { this.s = e.length; this.hold = true; this.hint(`lane-end:${e.id}`, 'Смуга закінчується — перестройтесь ліворуч.'); this.info('Смуга закінчується'); return; }
      this.edge = ne;
      this.s = Math.max(0, over);
      this.stepIdx++;
      this.updatePose();
      this.onEnterEdge();
      return;
    }
    if (nx?.kind === 'ring' && e.ringEntry) { this.enterRing(e, over); return; }
    // Тупик або кінець перед поворотом: стояти, доки не натиснуть «Поворот».
    const endConn = this.armed ? null : e.departures.find((c) => c.fromS >= e.length - 0.6);
    this.s = e.length;
    this.hold = !this.armed;
    void ds;
    if (endConn) this.hint(`turn-end:${e.id}`, 'Перехрестя: увімкніть покажчик і натисніть «Поворот».');
    this.updatePose();
  }

  private onEnterEdge(): void {
    this.stage = this.stageFor(this.edge);
    const e = this.edge;
    if (e.data.chain === 'stet_se') {
      const nt = this.steps.slice(this.stepIdx + 1).find((q) => q.kind === 'turn') as Extract<RouteStepData, { kind: 'turn' }> | undefined;
      this.hint('stet', nt?.manoeuvre === 'uturn' ? 'Вул. Стеценка: 3 смуги. Рухайтесь правою смугою; до розвороту займіть ліву.' : `Вул. Стеценка: 3 смуги. Рухайтесь правою смугою${nt ? `; далі: ${nt.text.toLowerCase()}` : ''}.`);
    }
    if (e.data.chain === 'mrii_n') {
      const rs = this.steps.slice(this.stepIdx + 1).find((q) => q.kind === 'ring') as Extract<RouteStepData, { kind: 'ring' }> | undefined;
      this.hint(`mrii:${this.stepIdx}`, `Вул. Мрії на північ до кільця. ${rs ? rs.text : 'На кільці — другий зʼїзд до фінішу.'}`);
    }
  }

  private stageFor(e: NetEdge): string {
    const ch = e.data.chain ?? '';
    if (ch === 'stet_se') return 'stetsenkaSE';
    if (ch === 'stet_nw') return 'stetsenkaNW';
    if (ch === 'tur_w') return 'turchyna';
    if (ch === 'mrii_n') return 'mrii';
    if (ch === 'n_out') return 'finish';
    return this.stage;
  }

  private enterRing(e: NetEdge, over: number): void {
    const info = e.ringEntry!;
    const st = this.steps[this.stepIdx + 1] as Extract<RouteStepData, { kind: 'ring' }>;
    const rl = e.n === 1 ? 1 : this.curLane() === 0 ? 0 : 1;
    const conn = info.ring.entry.get(info.arm.id)![rl]!;
    // «Дати дорогу» перед кільцем.
    if (this.v > 0.3 && ringBusyN(info.ring, conn.toTheta!, this.traffic.ringBodies(info.ring, conn), 0, this.cfg.rules.ringYieldTime)) { this.fault('ringYield'); if (this.result) return; }
    this.path = conn.path;
    this.conn = conn;
    this.mode = 'path';
    this.pathKind = 'entry';
    this.s = Math.max(0, over);
    this.change = null;
    this.yaw = 0;
    this.ring = info.ring;
    this.ringPlan = { ring: info.ring, entry: st.entry, exit: st.exit, exitNo: st.exitNo, step: this.stepIdx + 1 };
    this.lane = rl;
    this.stepIdx++;
    this.stage = this.stage === 'start' ? 'ring1' : 'ring2';
    this.updatePose();
  }

  private moveRing(ds: number): void {
    const ring = this.ring!;
    const prev = this.theta;
    const prevD = this.d;
    const r = ring.r + this.d;
    this.theta += ds / r;
    this.advanceChange(ds);
    this.yaw = ds > 1e-6 ? Math.atan2(this.d - prevD, ds) : this.yaw * 0.9;
    const dth = this.theta - prev;
    this.updatePose();
    if (dth <= 0) return;
    const plan = this.ringPlan!;
    const lane = this.curLane();
    // Порядковий номер зʼїзду від вʼїзду.
    const entryIdx = ring.arms.findIndex((a) => a.id === plan.entry);
    for (const arm of ring.arms) {
      if (arm.kind !== 'exit') continue;
      const ex = arm.theta[lane]!;
      if (mod(ex - prev, Math.PI * 2) > dth) continue;
      if (this.armedExit === arm.id) {
        this.checkSignal(1);
        if (this.result) return;
        if (arm.id !== plan.exit) { this.fault('offRoute', `Зʼїзд не туди: ${arm.name}`); return; }
        let no = 0;
        for (let k = 1; k <= ring.arms.length; k++) { const q = ring.arms[(entryIdx + k) % ring.arms.length]!; if (q.kind === 'exit') no++; if (q.id === arm.id) break; }
        if (no === 1 && lane === 0) { this.fault('ringExitLane'); if (this.result) return; }
        const conn = ring.exit.get(arm.id)![lane]!;
        this.path = conn.path;
        this.conn = conn;
        this.lane = lane;
        this.change = null;
        this.yaw = 0;
        this.mode = 'path';
        this.pathKind = 'exit';
        this.s = (this.theta - (prev + mod(ex - prev, Math.PI * 2))) * r;
        this.armedExit = null;
        this.stepIdx++;
        this.updatePose();
        return;
      }
      if (arm.id === plan.exit && this.cfg.rules.missedExitIsOffRoute) { this.fault('offRoute', 'Пропущено потрібний зʼїзд з кільця'); return; }
    }
  }

  private movePath(ds: number): void {
    this.s += ds;
    const path = this.path!;
    if (this.pathKind === 'conn' || this.pathKind === 'adhoc') {
      this.checkConnPeds();
      if (this.result) return;
      this.checkOncoming();
      if (this.result) return;
    }
    if (this.s < path.length) { this.updatePose(); return; }
    const over = this.s - path.length;
    const c = this.conn!;
    if (this.pathKind === 'entry') {
      this.mode = 'ring';
      this.d = (this.lane - 0.5) * this.ring!.laneWidth;
      this.yaw = 0;
      this.theta = c.toTheta! + over / (this.ring!.r + this.d);
      this.path = null;
      this.pathKind = null;
      if (this.armPendingRing) { this.armedExit = this.nextExitArm(); this.armPendingRing = false; }
      this.updatePose();
      return;
    }
    // На ребро.
    const e = c.toEdge!;
    this.mode = 'edge';
    this.edge = e;
    this.lane = c.toLane;
    this.d = this.net.laneD(e, this.lane);
    this.s = c.toS + over;
    this.path = null;
    this.pathKind = null;
    this.conn = null;
    this.ring = null;
    if (this.sig !== 0 && (c.turn === 'exit' || c.turn === 'right' || c.turn === 'left' || c.turn === 'uturn')) this.sig = 0;
    // Наступний крок маршруту — це ребро.
    const nx = this.steps[this.stepIdx + 1];
    if (nx?.kind === 'edge' && nx.edge === e.id) this.stepIdx++;
    this.updatePose();
    this.onEnterEdge();
  }

  private updatePose(): void {
    if (this.mode === 'ring') {
      const p = this.net.ringPose(this.ring!, null, this.theta, this.d);
      this.x = p.x; this.z = p.z; this.a = p.a + this.yaw;
    } else if (this.mode === 'edge') {
      const p = this.net.pose(this.edge, this.s, this.d);
      this.x = p.x; this.z = p.z; this.a = p.a + this.yaw;
    } else {
      const p = this.path!.pose(this.s);
      this.x = p.x; this.z = p.z; this.a = p.a;
    }
  }

  private inSolidZone(): boolean {
    const L = this.cfg.rules.solidBeforeStop;
    return this.edge.features.some((f) => (f.kind === 'signal' || f.kind === 'crossing' || f.kind === 'yield') && this.s >= f.stop - L && this.s <= f.zone[1]);
  }

  private checkFeatures(prevS: number): void {
    const half = this.cfg.car.length / 2;
    const front = this.s + half, prevFront = prevS + half, rear = this.s - half;
    const e = this.edge;
    // Зебра на початку наступного ребра: пішоходи стартують заздалегідь (інакше на межі ребер вони зʼявляються за ~6 м і водій не встигає).
    const nxe = this.expectedNext();
    if (nxe?.kind === 'edge' && e.next.some((q) => q.id === nxe.edge)) {
      const ne = this.net.edge(nxe.edge);
      for (const f of ne.features) {
        if (f.kind !== 'crossing' || !f.crossing || f.crossing.kind !== 'zebra') continue;
        const d = e.length - front + f.stop;
        if (d > 0 && d < this.cfg.peds.zebraTriggerDist && !this.passFlags.has(`${f.id}:trig`)) { this.passFlags.add(`${f.id}:trig`); this.peds.trigger(f.crossing); }
      }
    }
    for (const f of e.features) {
      const key = `${f.id}`;
      if (f.kind === 'crossing' && f.crossing && f.crossing.kind === 'zebra' && f.stop - front < this.cfg.peds.zebraTriggerDist && f.stop - front > 0 && !this.passFlags.has(key + ':trig')) {
        this.passFlags.add(key + ':trig');
        this.peds.trigger(f.crossing);
      }
      if (f.kind === 'signal' && f.ctrl && f.group && prevFront < f.stop && front >= f.stop && !this.passFlags.has(key + ':stop')) {
        this.passFlags.add(key + ':stop');
        const l = this.light(f.ctrl, f.group);
        if (isStopLight(l)) this.fault('redLight');
        else if (l === 'yellow') {
          const since = this.net.sinceYellow(f.ctrl, f.group, this.t, this.cfg.signals);
          if (this.v * since > (this.v * this.v) / (2 * this.cfg.rules.yellowComfortDecel) + 1) this.fault('yellowLight');
        }
        if (this.result) return;
      }
      if (f.kind === 'crossing' && f.crossing && front > f.zone[0] && rear < f.zone[1] && !this.passFlags.has(key + ':ped')) {
        if (this.peds.conflictEdge(f.crossing.id, e.id, 0)) { this.passFlags.add(key + ':ped'); this.fault('pedestrianYield'); if (this.result) return; }
      }
    }
  }

  // Поворот через перехід: пішохід там, де проїжджаємо.
  private checkConnPeds(): void {
    const c = this.conn!;
    const half = this.cfg.car.length / 2;
    for (const x of c.crossings) {
      const key = `${c.id}:${x.crossing.id}:ped`;
      if (this.passFlags.has(key)) continue;
      if (this.s + half > x.s - 2 && this.s - half < x.s + 2 && this.peds.conflict(x.crossing.id, x.u - 3, x.u + 3, 0)) {
        this.passFlags.add(key);
        this.fault('pedestrianYield');
        return;
      }
    }
  }

  // Лівий поворот / розворот: зустрічний (або той, до кого вливаємось) ближче за oncomingYieldTime.
  private checkOncoming(): void {
    const c = this.conn!;
    if (this.oncomingChecked || c.rank >= 2 || !(c.turn === 'left' || c.turn === 'uturn')) return;
    const first = Math.min(...c.laneConflicts.map((q) => q.connS));
    if (!(this.s + this.cfg.car.length / 2 >= first - 0.5)) return;
    this.oncomingChecked = true;
    if (this.oncomingBusy(c, this.cfg.rules.oncomingYieldTime)) {
      this.fault('oncomingYield', c.turn === 'uturn' ? 'Не поступились транспорту, що рухається в зустрічному напрямку, при розвороті' : 'Не поступились зустрічному транспорту при повороті ліворуч');
    }
  }

  // Чи є «зустрічний» для зʼєднувача c, що доїде до конфлікту швидше за T (для судді й автопілота).
  oncomingBusy(c: NetConn, T: number, ignoreId = -1): boolean {
    for (const car of this.traffic.cars) {
      if (car.kind !== 'car' || car.id === ignoreId || car.v < 1) continue;
      const leg = car.legs[car.leg]!;
      if (leg.kind === 'lane' && leg.edge) {
        for (const q of c.laneConflicts) {
          if (q.edge !== leg.edge || q.lane !== leg.lane) continue;
          const sl = leg.s0 + car.s + car.len / 2;
          const dist = q.laneS - sl;
          if (dist < -3 || dist > 120) continue;
          if (this.carStopsBefore(car, q.laneS)) continue;
          // Сам повертає раніше конфлікту — не зустрічний.
          if (car.plan && !car.plan.done && car.plan.conn.fromEdge === q.edge && car.plan.conn.fromLaneS < q.laneS - 1 && car.plan.turnLeg === car.leg + 1) {
            // Повертає раніше конфлікту з лінією, але сам поворот перетинає наш шлях (напр. правий в устя Турчина) — теж «зустрічний».
            const cc = c.connConflicts.find((k) => k.conn === car.plan!.conn);
            if (cc && car.plan.conn.rank > c.rank) {
              const dTurn = car.plan.conn.fromLaneS - sl;
              if (dTurn < 3 || dTurn / Math.max(car.v, 3) < T) return true;
            }
            continue;
          }
          if (dist <= 3 || dist / car.v < T) return true;
        }
      }
      if (leg.kind === 'conn' && leg.conn) {
        const cc = c.connConflicts.find((q) => q.conn === leg.conn);
        if (cc && leg.conn.rank > c.rank && car.s < cc.sOther && (cc.sOther - car.s) / car.v < T) return true;
      }
    }
    return false;
  }

  // ІІ зупиниться (червоне) раніше за точку laneS своєї смуги.
  private carStopsBefore(car: NetCar, laneS: number): boolean {
    const leg = car.legs[car.leg]!;
    if (leg.kind !== 'lane' || !leg.edge) return false;
    const front = leg.s0 + car.s + car.len / 2;
    for (const f of leg.edge.features) {
      if (f.kind !== 'signal' || !f.ctrl || !f.group) continue;
      const st = f.laneStop[leg.lane!]!;
      if (st < front - 0.5 || st > laneS) continue;
      const l = this.light(f.ctrl, f.group);
      if (isStopLight(l) || (l === 'yellow' && st - front > (car.v * car.v) / 6 + 1)) return true;
    }
    return false;
  }

  // Гравець зупиниться перед червоним (для ІІ, що вирішує поворот): стоїть/гальмує перед стоп-лінією.
  private playerWillStop(): boolean {
    if (this.mode !== 'edge') return false;
    const front = this.s + this.cfg.car.length / 2;
    for (const f of this.edge.features) {
      if (f.kind !== 'signal' || !f.ctrl || !f.group) continue;
      const d = f.stop - front;
      if (d < -0.3 || d > 60) continue;
      const l = this.light(f.ctrl, f.group);
      if ((isStopLight(l) || l === 'yellow') && (this.v * this.v) / (2 * 4) < d + 0.5) return true;
    }
    return false;
  }

  // Хто на ділянці [u0, u1] лінії переходу або наближається до неї і не встигне спокійно зупинитись.
  private carNear(line: PedLine, u0: number, u1: number, movingOnly = false): boolean {
    // Хто біля точки u переходу або наближається до неї (≤ 2.5 с).
    const nx = -line.uz, nz = line.ux; // нормаль до переходу (вздовж дороги)
    const test = (x: number, z: number, a: number, v: number): boolean => {
      if (movingOnly && v < 0.5) return false;
      const dx = x - line.ax, dz = z - line.az;
      const uu = dx * line.ux + dz * line.uz;
      if (uu < u0 - 1.5 || uu > u1 + 1.5) return false;
      const along = dx * nx + dz * nz;
      const va = (Math.sin(a) * nx - Math.cos(a) * nz) * v;
      return Math.abs(along) < 5 || (along * va < 0 && Math.abs(along) < Math.abs(va) * 2.5 + 5 + (v * v) / 8);
    };
    if (test(this.x, this.z, this.a, this.v)) return true;
    return this.traffic.cars.some((c) => test(c.x, c.z, c.a, c.v)) || this.riders.list.some((r) => test(r.x, r.z, r.a, r.v));
  }

  private roadNear(line: PedLine, u0: number, u1: number): boolean {
    const nx = -line.uz, nz = line.ux;
    const test = (x: number, z: number, a: number, v: number, hl = 2.4): boolean => {
      const dx = x - line.ax, dz = z - line.az;
      const uu = dx * line.ux + dz * line.uz;
      if (uu < u0 - 1 || uu > u1 + 1) return false;
      const along = dx * nx + dz * nz;
      const va = (Math.sin(a) * nx - Math.cos(a) * nz) * v;
      if (v < 0.5) return Math.abs(along) < hl + 0.8;
      return Math.abs(along) < 6 || (along * va < 0 && Math.abs(along) < Math.abs(va) * 4 + 6);
    };
    if (test(this.x, this.z, this.a, this.v)) return true;
    return this.traffic.cars.some((c) => c.kind === 'car' && test(c.x, c.z, c.a, c.v, c.len / 2)) || this.riders.list.some((r) => test(r.x, r.z, r.a, r.v, r.len / 2));
  }

  private checkCollisions(): void {
    const me = this.box();
    for (const c of this.traffic.cars) {
      if (boxesOverlap(me, this.traffic.body(c).box)) {
        this.fault('crash', c.kind === 'parked' ? 'Зіткнення з припаркованим автомобілем' : c.kind === 'broken' ? 'Зіткнення з автомобілем на аварійці' : FAULT_TEXT.crash);
        return;
      }
    }
    for (const r of this.riders.list) {
      if (boxesOverlap(me, { x: r.x, z: r.z, a: r.a, hl: r.len / 2, hw: r.width / 2 })) { this.fault('crash', r.kind === 'bike' ? 'Зіткнення з велосипедистом' : 'Зіткнення з самокатником'); return; }
    }
    for (const p of this.peds.list) if (this.peds.walking(p) && pointBoxDist(p.x, p.z, me) < 0.3) { this.fault('pedestrianHit'); return; }
  }

  private ghost(): Body | null {
    if (this.mode === 'path' && (this.pathKind === 'conn' || this.pathKind === 'adhoc') && this.conn?.turn === 'uturn') {
      const e = this.path!.pose(this.path!.length);
      return { id: 0, box: { x: e.x, z: e.z, a: e.a, hl: this.cfg.car.length / 2, hw: this.cfg.car.width / 2 }, v: Math.max(this.v, 3) };
    }
    if (!this.change || this.mode !== 'edge') return null;
    const p = this.net.pose(this.edge, this.s, this.change.to);
    return { id: 0, box: { x: p.x, z: p.z, a: p.a, hl: this.cfg.car.length / 2, hw: this.cfg.car.width / 2 }, v: this.v };
  }

  // ---- Розстановка: райдери, порушник ----

  // Права смуга вільна за 150 м до правого повороту за маршрутом (і 12 м після початку).
  private rightKeep(): Map<string, [number, number][]> {
    const m = new Map<string, [number, number][]>();
    const add = (id: string, lo: number, hi: number): void => { const l = m.get(id) ?? []; l.push([lo, hi]); m.set(id, l); };
    for (const st of this.steps) {
      if (st.kind !== 'turn') continue;
      const c = this.net.conn(st.conn);
      if (c.dir === 1 && c.fromEdge) add(c.fromEdge.id, c.fromS - 150, c.fromS + 12);
      // Після повороту (посадки) — 160 м без перешкод: черга за зламаним авто не має впиратись в гравця, що тільки влився.
      if (c.toEdge) add(c.toEdge.id, c.toS - 40, c.toS + 160);
    }
    return m;
  }

  private leftKeep(): Map<string, [number, number]> {
    // Ліва смуга вільна від зламаних авто за 380 м до розвороту / лівого повороту і 80 м після вʼїзду на ребро після розвороту.
    const m = new Map<string, [number, number]>();
    for (const st of this.steps) {
      if (st.kind !== 'turn') continue;
      const c = this.net.conn(st.conn);
      if (c.fromEdge) m.set(c.fromEdge.id, [c.fromS - this.cfg.obstacles.leftLaneUturnClear, c.fromS + (c.turn === 'uturn' ? 55 : 10)]); // розворот: траєкторія ще довго йде вздовж лівої смуги
      if (c.toEdge && !m.has(c.toEdge.id)) m.set(c.toEdge.id, [c.toS - 10, c.toS + 80]);
    }
    return m;
  }

  private populateRiders(rng: Rng): void {
    const R = this.cfg.riders;
    const int = (r: readonly [number, number]): number => r[0] + Math.floor(rng.next() * (r[1] - r[0] + 1));
    // На Стеценці (на ПдС) — попереду гравця, від зʼїзду з кільця.
    // Місце без нерухомих перешкод поруч (±12 м уздовж).
    const free = (e: NetEdge, s: number): number => {
      for (let k = 0; k < 20; k++) {
        const p = this.net.pose(e, s, e.n * e.W - 0.5);
        if (!this.traffic.cars.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 12)) return s;
        s += 6;
      }
      return s;
    };
    const se = this.net.edgeList.find((e) => e.data.chain === 'stet_se' && e.n >= 3);
    if (se) { let s = rng.range(20, 50); for (let i = int(R.perDir); i > 0; i--) { s = free(se, s); this.riders.add(se, s); s += rng.range(30, 60); } }
    // На Стеценці (на ПЗ) після Виговського — там гравець їде до лівого повороту.
    const nw = this.net.edgeList.filter((e) => e.data.chain === 'stet_nw' && e.n >= 3);
    const nwc = nw[1];
    if (nwc) this.riders.add(nwc, free(nwc, rng.range(70, 140)));
  }

  private planJaywalker(rng: Rng): void {
    const P = this.cfg.peds;
    if (rng.next() >= P.jaywalkChance) return;
    // Двостороння ділянка вул. Стеценки (6 смуг) між кільцем і розгалуженням біля пл. Марченка.
    const e = this.net.edgeList.find((q) => q.data.chain === 'stet_se' && q.n >= 3);
    if (!e) return;
    const twin = this.twinOf(e, 150);
    if (!twin) return;
    const split = this.twinRange(e);
    const lo = 60, hi = Math.min(split, e.length) - 40;
    if (hi - lo < 40) return;
    let windows = this.traffic.freeSlots(e, P.jaywalkClear, P.jaywalkClear, lo, hi);
    for (const c of this.traffic.cars) {
      if (c.kind === 'car') continue;
      const cs = e.ref.project(c.x, c.z);
      if (Math.abs(cs.d) > 25) continue;
      windows = windows.flatMap(([a, b]): [number, number][] => {
        if (cs.s + 20 <= a || cs.s - 20 >= b) return [[a, b]];
        return ([[a, cs.s - 20], [cs.s + 20, b]] as [number, number][]).filter(([x, y]) => y - x >= 4);
      });
    }
    if (windows.length) this.jw = { edge: e, twin, windows };
  }

  // Ребро зустрічного напрямку поруч (ліва межа через осьову).
  twinOf(e: NetEdge, s: number): NetEdge | null {
    const p = this.net.pose(e, s, -2 * e.data.median - 0.5);
    const sl = this.net.slot(p.x, p.z, wrapAngle(e.ref.pose(s).a + Math.PI), (q) => q !== e && q.kind === 'street');
    return sl ? sl.edge : null;
  }
  // До якого s ребро e має двійника впритул (двостороння дорога).
  private twinRange(e: NetEdge): number {
    for (let s = 40; s < e.length; s += 10) {
      const p = this.net.pose(e, s, -2 * e.data.median - 0.5);
      const sl = this.net.slot(p.x, p.z, wrapAngle(e.ref.pose(s).a + Math.PI), (q) => q !== e && q.kind === 'street');
      if (!sl || sl.d > 1.2) return s;
    }
    return e.length;
  }

  private checkJaywalker(): void {
    if (this.mode !== 'edge') return;
    const half = this.cfg.car.length / 2;
    const front = this.s + half, rear = this.s - half;
    if (this.jw && !this.jwDone && this.edge === this.jw.edge && this.v > 4) {
      const D = Math.max(this.cfg.peds.jaywalkMinDist, this.v * 1.0 + (this.v * this.v) / 8 + 6);
      const target = front + D;
      if (this.jw.windows.some(([a, b]) => target >= a && target <= b)) {
        const busy = [...this.traffic.cars.filter((c) => c.kind === 'car'), ...this.riders.list].some((c) => {
          const q = this.edge.ref.projectRange(c.x, c.z, this.s - 60, this.s + 120);
          return q.d > -0.5 && q.d < this.edge.n * this.edge.W + 0.5 && q.s > this.s - 25 && q.s < target + 15;
        });
        if (!busy) { this.jwDone = true; this.peds.spawnJaywalker(this.edge, target, this.jw.twin); }
      }
    }
    for (const j of this.peds.jaywalkersOn(this.edge.id, 0)) {
      if (this.jwYielded.has(j.ped.id)) continue;
      if (front >= j.s && rear <= j.s + 0.5) {
        this.jwYielded.add(j.ped.id);
        this.fault('pedestrianYield', 'Не надано перевагу пішоходу, що переходить дорогу');
        if (this.result) return;
      }
    }
  }

  private checkCloseOvertake(): void {
    if (this.mode !== 'edge') return;
    const W = this.edge.W;
    const ref = this.edge.ref;
    const myLane = Math.floor(this.d / W);
    for (const r of this.riders.list) {
      if (r.edge !== this.edge || this.closePassed.has(r.id)) continue;
      const q = ref.projectRange(r.x, r.z, this.s - 30, this.s + 30);
      if (Math.floor(q.d / W) !== myLane) continue;
      if (Math.abs(q.s - this.s) > this.cfg.car.length / 2 + r.len / 2) continue;
      if (this.v < r.v + 0.3) continue;
      const clear = Math.abs(q.d - this.d) - this.cfg.car.width / 2 - r.width / 2;
      if (clear < this.cfg.rules.closeOvertakeClear) { this.closePassed.add(r.id); this.fault('closeOvertake'); return; }
    }
  }

  private checkForcedBraking(): void {
    const R = this.cfg.rules;
    const lcActive = this.change !== null || this.t - this.lcEnd < R.forcedLaneChangeWindow;
    const hx = Math.sin(this.a), hz = -Math.cos(this.a);
    const hl = this.cfg.car.length / 2, hw = this.cfg.car.width / 2;
    for (const c of this.traffic.cars) {
      if (c.kind !== 'car') continue;
      const prev = this.prevLead.get(c.id);
      this.prevLead.set(c.id, c.leadId);
      if (this.forced.has(c.id)) continue;
      if (c.leadId === 0 && prev !== 0 && lcActive && c.off === c.offT) this.cutIn.set(c.id, this.t);
      const cut = this.cutIn.get(c.id);
      const cutRecent = cut !== undefined && this.t - cut <= R.forcedLaneChangeWindow + 1;
      const prio = this.traffic.isTurning(c);
      let hit = c.leadId === 0 && c.acc < -R.forcedDecel && (cutRecent || prio);
      if (!hit && prio && (c.leg === c.plan!.turnLeg || Math.abs(wrapAngle(c.a - this.a)) > 0.35)) {
        const dx = c.x - this.x, dz = c.z - this.z;
        const fwd = dx * hx + dz * hz, lat = dx * -hz + dz * hx;
        const da = c.a - this.a;
        const lonB = Math.abs(Math.cos(da)) * c.len / 2 + Math.abs(Math.sin(da)) * hw;
        const latB = Math.abs(Math.sin(da)) * c.len / 2 + Math.abs(Math.cos(da)) * hw;
        if (fwd > 0 && Math.abs(lat) < hw + latB + 0.2) {
          const gap = fwd - hl - lonB;
          const closing = this.v - Math.max(0, c.v * Math.cos(da));
          if (gap > 0 && this.v > 1 && closing > 0.5 && gap / closing < R.forcedTTC && (closing * closing) / (2 * gap) > R.forcedStopDecel) hit = true;
        }
      }
      if (hit) { this.forced.add(c.id); this.fault('forcedBraking'); if (this.result) return; }
    }
  }

  private checkSpeed(dt: number): void {
    const lim = this.mode === 'edge' ? Math.min(this.cfg.rules.speedLimitKmh, this.edge.data.speedKmh) : this.cfg.rules.speedLimitKmh;
    const kmh = this.v * 3.6;
    if (kmh > lim) {
      this.overT += dt;
      this.hint(`speed:${Math.floor(this.t / 20)}`, `Обмеження ${lim} км/год — пригальмуйте.`);
      if (this.overT > this.cfg.rules.speedHoldS && this.speedArmed) { this.speedArmed = false; this.fault('speeding'); }
    } else { this.overT = 0; this.speedArmed = true; }
  }

  // Наступний поворот за маршрутом (зʼєднувач), навіть якщо він на одному з наступних ребер.
  nextTurnConn(): NetConn | null {
    for (let k = this.stepIdx + 1; k < this.steps.length; k++) {
      const st = this.steps[k]!;
      if (st.kind === 'turn') return this.net.conn(st.conn);
      if (st.kind !== 'edge') return null;
    }
    return null;
  }

  // Скільки метрів до наступного маневру, що потребує лівої смуги (лівий/розворот), і до кільця.
  prepDistances(): { left: number; ring: number } {
    let left = Infinity, ring = Infinity;
    if (this.mode !== 'edge') return { left, ring };
    let acc = -this.s;
    for (let k = this.stepIdx; k < this.steps.length; k++) {
      const st = this.steps[k]!;
      if (st.kind === 'edge') { acc += this.net.edge(st.edge).length; continue; }
      if (st.kind === 'turn') {
        const c = this.net.conn(st.conn);
        if (c.dir === -1) left = acc - (c.fromEdge!.length - c.fromS);
        break;
      }
      if (st.kind === 'ring') { ring = acc; break; }
      break;
    }
    return { left, ring };
  }

  private checkLeftLane(dt: number): void {
    if (this.mode !== 'edge' || this.edge.n < 2 || this.lane !== 0 || this.change || this.v < 2) {
      if (this.mode !== 'edge' || this.lane !== 0) { this.hogT = 0; this.hogArmed = true; }
      return;
    }
    const R = this.cfg.rules;
    const prep = this.prepDistances();
    if (prep.left < R.uturnPrepDist || prep.ring < R.ringPrepDist) return;
    if (this.inSolidZone()) return;
    const e = this.edge;
    const busy = [...this.traffic.cars, ...this.riders.list].some((c) => {
      if (Math.abs(c.x - this.x) > 120 || Math.abs(c.z - this.z) > 120) return false;
      const q = e.ref.projectRange(c.x, c.z, this.s - 40, this.s + 110);
      if (q.d < e.W - 0.3 || q.d > 2 * e.W + 0.3) return false; // смуга праворуч (1)
      const rel = q.s - this.s;
      const ahead = 'hazard' in c && c.kind !== 'car' ? R.leftLaneStaticAhead : R.leftLaneFreeAhead;
      return rel > -R.leftLaneFreeBehind && rel < ahead;
    });
    if (busy) return;
    this.hogT += dt;
    if (this.hogT > R.leftLaneMaxS - 3) this.hint(`hog:${Math.floor(this.s / 200)}`, 'Права смуга вільна — перестройтесь праворуч.');
    if (this.hogT > R.leftLaneMaxS && this.hogArmed) { this.hogArmed = false; this.fault('leftLaneHog'); }
  }

  private learnHints(): void {
    if (this.cfg.mode !== 'learn') return;
    if (this.mode === 'edge') {
      const front = this.s + this.cfg.car.length / 2;
      for (const f of this.edge.features) {
        const d = f.stop - front;
        if (d < 0 || d > 60) continue;
        if (f.kind === 'signal' && f.ctrl && f.group && isStopLight(this.light(f.ctrl, f.group))) this.hint(`red:${f.id}:${Math.floor(this.t / this.cfg.signals.cycle)}`, 'Попереду червоний — зупиніться перед стоп-лінією.');
        if (f.kind === 'crossing' && f.crossing && this.peds.conflictEdge(f.crossing.id, this.edge.id, this.cfg.rules.pedConflictMargin)) this.hint(`ped:${f.id}`, 'Пішохід на переході — пропустіть.');
      }
      const exp = this.expectedConn();
      if (exp) {
        const left = exp.fromS - this.s;
        if (exp.turn === 'uturn' && left < 300) this.hint(`uturnPrep:${this.stepIdx}`, `Через ${Math.round(left / 10) * 10} м розворот: займіть ліву смугу, лівий покажчик, «Поворот».`);
        if (exp.turn === 'left' && left < 300) this.hint(`leftPrep:${this.stepIdx}`, `Через ${Math.round(left / 10) * 10} м: ${(this.steps[this.stepIdx + 1] as { text?: string }).text?.toLowerCase() ?? ''}. Ліва смуга, покажчик, поступіться зустрічним і пішоходам.`);
        if (exp.turn === 'right' && left < 120) this.hint(`rightPrep:${this.stepIdx}`, `Попереду: ${(this.steps[this.stepIdx + 1] as { text?: string }).text?.toLowerCase() ?? ''}. Правий покажчик, «Поворот», пропустіть пішоходів.`);
      }
    }
    if (this.mode === 'ring' && this.ringPlan) {
      const arm = this.ring!.arms.find((a) => a.id === this.ringPlan!.exit)!;
      const left = mod(arm.theta[this.curLane()]! - this.theta, Math.PI * 2) * this.ring!.r;
      if (left < 25 && this.armedExit !== arm.id) this.hint(`exit:${this.ringPlan.step}`, 'Ваш зʼїзд — правий покажчик і «Зʼїзд».');
    }
  }
}

export type { Polyline };
