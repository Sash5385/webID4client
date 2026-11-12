// Ядро тренажера маршруту №7: гравець, правила, суддя. Без DOM і three.js.
// Використання: const sim = new Sim(cfg) (фасад у sim.ts → Route7Sim); щокадру sim.step({gas, brake}) з фіксованим dt.

import { Gearbox } from './gearbox';
import { DEFAULT_CONFIG, type FaultCode, type Severity, type SimConfig } from './config';
import { bezierPath, boxesOverlap, clamp, mod, pointBoxDist, ringPose, smoothstep, wrapAngle, type Box, type Path } from './geometry';
import { Pedestrians } from './peds';
import { Rng } from './rng';
import { buildRoute, type ArmId, type Dir, type Feature, type RingLane, type RouteNet } from './route';
import { isStopLight, lightAt, sinceYellow, type Light, type PedLight, pedLightAt } from './signals';
import { Riders } from './riders';
import { ringBusy, Traffic, type Body, type Car } from './traffic';

export interface Fault {
  readonly code: FaultCode;
  readonly severity: Severity;
  readonly message: string;
  readonly t: number;
  readonly x: number;
  readonly z: number;
}

export interface Result {
  readonly passed: boolean;
  readonly reason: string;
  readonly faults: readonly Fault[];
  readonly minor: number;
  readonly time: number;
}

export type SimEvent =
  | { readonly type: 'fault'; readonly fault: Fault }
  | { readonly type: 'hint'; readonly key: string; readonly text: string }
  | { readonly type: 'info'; readonly text: string }
  | { readonly type: 'finish'; readonly result: Result };

export type Stage = 'start' | 'ring1' | 'south' | 'north' | 'ring2' | 'finish';
export interface Controls { readonly gas: boolean; readonly brake: boolean; readonly clutch?: boolean }
type Action = { type: 'signal'; dir: -1 | 1 } | { type: 'lane'; dir: -1 | 1 } | { type: 'turn' };
export type PathKind = 'startIn' | 'entry' | 'exit' | 'uturn' | 'finishOut';

export interface PlayerView {
  x: number; z: number; a: number; v: number;
  sig: -1 | 0 | 1; braking: boolean; lane: 0 | 1 | null;
  sigT: number; // секунд з моменту ввімкнення покажчика (для фази блимання)
}

export const FAULT_TEXT: Record<FaultCode, string> = {
  crash: 'Зіткнення з автомобілем',
  pedestrianHit: 'Наїзд на пішохода',
  redLight: 'Проїзд на червоний сигнал світлофора',
  yellowLight: 'Проїзд на жовтий сигнал (була можливість зупинитись)',
  offRoute: 'Відхилення від маршруту',
  pedestrianYield: 'Не надано перевагу пішоходу на переході',
  ringYield: 'Не поступились транспорту на кільці',
  ringExitLane: 'Зʼїзд з кільця не з правої (зовнішньої) смуги',
  oncomingYield: 'Не поступились зустрічному транспорту при розвороті',
  noSignal: 'Не увімкнено покажчик повороту',
  lateSignal: 'Покажчик повороту увімкнено невчасно',
  solidLine: 'Перестроювання через суцільну лінію розмітки',
  uturnNotCenter: 'Розворот не з середини перехрестя',
  uturnWrongLane: 'Розворот не з крайньої лівої смуги',
  turnWrongLane: 'Поворот не з крайньої смуги (ліворуч — з лівої, праворуч — з правої)',
  leftLaneHog: 'Тривалий рух лівою смугою при вільній правій',
  speeding: 'Перевищення швидкості (понад 50 км/год)',
  closeOvertake: 'Мало бокового інтервалу при обгоні велосипедиста/самокатника',
  forcedBraking: 'Створено перешкоду: змусили інших гальмувати',
  skid: 'Занос: надто швидко для слизької дороги — авто не втримало поворот',
};

const EXIT_NO: Record<Exclude<Stage, 'south' | 'north' | 'finish'>, string> = { start: 'перший', ring1: 'перший', ring2: 'другий' };

export class Route7Sim {
  readonly route = 'route7' as const;
  readonly cfg: SimConfig;
  readonly net: RouteNet;
  readonly traffic: Traffic;
  readonly peds: Pedestrians;
  readonly riders: Riders;
  t = 0;
  stage: Stage = 'start';
  faults: Fault[] = [];
  result: Result | null = null;

  // Гравець
  private mode: 'path' | 'ring' | 'street' = 'path';
  private pathKind: PathKind = 'startIn';
  private path: Path;
  private dir: Dir = 'S';
  s = 0;
  private d = 0;
  private lane: 0 | 1 = 1;
  private change: { from: number; to: number; target: 0 | 1; prog: number; dist: number; sign: -1 | 1 } | null = null;
  private theta = 0;
  private entryArm: ArmId = 'W';
  private entryLane: RingLane = 1;
  private armed: ArmId | null = null;
  private armPending = false;
  v = 0;
  x = 0; z = 0; a = 0;
  private yaw = 0;
  sig: -1 | 0 | 1 = 0;
  private sigT = 0;
  private braking = false;
  // Зчеплення з дорогою: 1 суха, ~0.65 дощ, ~0.4 сніг, ~0.18 ожеледь — впливає на гальмування й розгін гравця.
  grip = 1;
  readonly gb = new Gearbox(0); // коробка: автомат (типово) або механіка
  setGrip(g: number): void { this.grip = Math.max(0.1, Math.min(1, g)); }

  private actions: Action[] = [];
  private events: SimEvent[] = [];
  private hinted = new Set<string>();
  private passFlags = new Set<string>();
  private overT = 0;
  private speedArmed = true;
  private hogT = 0;
  private hogArmed = true;
  // Нові учасники: судження
  private lcEnd = -Infinity;                  // коли гравець завершив останнє перестроювання
  private prevLead = new Map<number, number>();
  private cutIn = new Map<number, number>();  // id ІІ → час, коли гравець «підрізав» його перестроюванням
  private forced = new Set<number>();
  private closePassed = new Set<number>();
  private jw: { dir: Dir; windows: [number, number][] } | null = null;
  private jwDone = false;
  private jwYielded = new Set<number>();

  constructor(cfg: SimConfig = DEFAULT_CONFIG) {
    this.cfg = cfg;
    const rng = new Rng(cfg.seed);
    this.net = buildRoute(cfg);
    this.peds = new Pedestrians(cfg, this.net, rng);
    this.traffic = new Traffic(cfg, this.net, rng);
    this.riders = new Riders(cfg, this.net, rng, this.traffic);
    this.path = this.net.startPose.line;
    this.s = this.net.startPose.s;
    this.updatePose();
    this.traffic.placeObstacles(this.body());
    this.riders.populate();
    this.peds.populateAmbient();
    this.traffic.populate(this.body(), this.riders.bodies());
    this.planJaywalker(rng);
    this.hint('start', 'Рушайте до кільця. Поступіться тим, хто на кільці. Зʼїзд — перший, на вул. Мрії: увімкніть правий покажчик і натисніть «Зʼїзд».');
  }

  // ---- Керування (кнопки) ----
  toggleSignal(dir: -1 | 1): void { this.actions.push({ type: 'signal', dir }); }
  changeLane(dir: -1 | 1): void { this.actions.push({ type: 'lane', dir }); }
  turn(): void { this.actions.push({ type: 'turn' }); }

  get player(): PlayerView {
    return { x: this.x, z: this.z, a: this.a, v: this.v, sig: this.sig, braking: this.braking, lane: this.mode === 'path' ? null : this.lane, sigT: this.sigT };
  }
  // Для UI/автопілота в тестах: де зараз гравець.
  get where(): { mode: 'path' | 'ring' | 'street'; pathKind: PathKind; dir: Dir; lane: 0 | 1; s: number; pathLength: number; changing: boolean; armed: ArmId | null; nextExit: ArmId } {
    return {
      mode: this.mode, pathKind: this.pathKind, dir: this.dir, lane: this.lane, s: this.s,
      pathLength: this.mode === 'path' ? this.path.length : this.mode === 'street' ? this.net.ref[this.dir].length : 0,
      changing: this.change !== null, armed: this.armed, nextExit: this.nextExitArm(),
    };
  }
  get minorCount(): number { return this.faults.filter((f) => f.severity === 'minor').length; }
  light(f: Feature): Light { return lightAt(this.t, f.def.offset ?? 0, this.cfg.signals); }
  pedLight(f: Feature): PedLight { return pedLightAt(this.t, f.def.offset ?? 0, this.cfg.signals); }

  // Що далі за маршрутом і скільки метрів до цього.
  get next(): { text: string; dist: number } {
    const R = this.net.ring.r;
    switch (this.stage) {
      case 'start':
      case 'ring1': {
        const dist = this.mode === 'ring' ? mod(this.net.arms.S.exitTheta - this.theta, Math.PI * 2) * R : this.path.length - this.s;
        return { text: 'Кільце: перший зʼїзд на вул. Мрії', dist };
      }
      case 'south': {
        const u = this.uturnFeature();
        return { text: `Розворот на перехресті: ${u.def.name ?? ''}`, dist: u.def.s - this.s };
      }
      case 'north':
        return { text: 'Кільце: другий зʼїзд до фінішу', dist: this.net.ref.N.length - this.s };
      case 'ring2':
        return { text: 'Другий зʼїзд до фінішу', dist: this.mode === 'ring' ? mod(this.net.arms.W.exitTheta - this.theta, Math.PI * 2) * R : 0 };
      case 'finish':
        return { text: 'Фініш', dist: this.pathKind === 'finishOut' ? this.net.finishS - this.s : 0 };
    }
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
    if (this.sig !== 0) this.sigT += dt;

    this.move(this.v * dt);
    if (this.result) return this.events;

    this.peds.step(this.t, dt, (f) => this.carNear(f), (z, dir) => this.roadNear(z, dir));
    const others: Body[] = [this.body(), ...this.traffic.cars.map((c) => this.traffic.body(c))];
    const southS = this.stage === 'south' ? this.s : this.stage === 'north' || this.stage === 'ring2' || this.stage === 'finish' ? Infinity : null;
    this.riders.step(this.t, dt, others, this.peds, southS);
    this.traffic.step(this.t, dt, this.body(), this.peds, this.riders.bodies(), this.ghost());
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
    return { id: 0, box: this.box(), v: this.v };
  }
  private box(): Box {
    return { x: this.x, z: this.z, a: this.a, hl: this.cfg.car.length / 2, hw: this.cfg.car.width / 2 };
  }

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

  private uturnFeature(): Feature {
    return this.net.features.find((f) => f.def.uturn)!;
  }

  private apply(act: Action): void {
    if (act.type === 'signal') {
      if (this.sig === act.dir) this.sig = 0;
      else { this.sig = act.dir; this.sigT = 0; }
      return;
    }
    if (act.type === 'lane') { this.startLaneChange(act.dir); return; }
    // «Зʼїзд / Розворот»: значення залежить від місця.
    if (this.mode === 'ring') { this.armed = this.nextExitArm(); return; }
    if (this.mode === 'path' && (this.pathKind === 'startIn' || this.pathKind === 'entry')) { this.armPending = true; return; }
    if (this.mode === 'street') {
      const inter = this.intersectionHere();
      if (inter) { this.startUturn(inter); return; }
      if (this.dir === 'N' && this.net.ref.N.length - this.s < 80) { this.armPending = true; return; }
      this.info('Тут розворот неможливий');
    }
  }

  private nextExitArm(): ArmId {
    let best: ArmId = 'W', bd = Infinity;
    for (const id of this.net.armOrder) {
      const d = mod(this.net.arms[id].exitTheta - this.theta, Math.PI * 2);
      if (d > 0.02 && d < bd) { bd = d; best = id; }
    }
    return best;
  }

  private intersectionHere(): Feature | null {
    for (const f of this.net.features) {
      if (f.def.kind !== 'intersection') continue;
      if (this.s >= f.stop[this.dir] - 20 && this.s <= f.zone[this.dir][1]) return f;
    }
    return null;
  }

  private startLaneChange(dir: -1 | 1): void {
    if (this.mode === 'path' || this.change) return;
    if (this.v < 1) { this.info('Перестроювання — лише під час руху'); return; }
    const ring = this.mode === 'ring';
    const target = this.lane + dir;
    if (target < 0) { this.info(ring ? 'Ліворуч центральний острів' : 'Ліворуч подвійна суцільна — перестроїтись неможливо'); return; }
    if (target > 1) { this.info(ring ? 'Ви вже в правій смузі кільця' : 'Праворуч бордюр — перестроїтись неможливо'); return; }
    this.checkSignal(dir);
    if (this.result) return;
    const to = ring ? (target - 0.5) * this.net.ring.laneWidth : this.net.laneWidth * (target + 0.5);
    this.change = { from: this.d, to, target: target as 0 | 1, prog: 0, dist: ring ? clamp(this.v * 2, 8, 20) : clamp(this.v * 2.5, 12, 40), sign: dir };
  }

  // Просування перестроювання (на вулиці d — від осі, на кільці — від межі смуг назовні).
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

  private startUturn(f: Feature): void {
    if (!f.def.uturn || this.dir !== 'S') {
      this.fault('offRoute', 'Розворот не за маршрутом');
      return;
    }
    const front = this.s + this.cfg.car.length / 2;
    if (front < f.stop.S) {
      const l = this.light(f);
      if (isStopLight(l)) { this.fault('redLight'); return; }
    }
    if (this.lane !== 0 || this.change) this.fault('uturnWrongLane');
    this.checkSignal(-1);
    if (this.s < f.def.s - this.cfg.rules.uturnCenterTol) this.fault('uturnNotCenter');
    if (this.result) return;
    const pz = this.z;
    const oncoming = this.traffic.cars.some((c) => {
      const leg = c.legs[c.leg]!;
      if (leg.kind !== 'lane' || leg.dir !== 'N') return false;
      const dist = c.z - pz;
      return dist > -3 && c.v > 1 && dist / c.v < this.cfg.rules.oncomingYieldTime;
    });
    if (oncoming) { this.fault('oncomingYield'); if (this.result) return; }
    const W = this.net.laneWidth;
    const endX = this.cfg.road.medianHalf + W * 0.5;
    this.path = bezierPath({ x: this.x, z: this.z, a: this.a }, { x: endX, z: this.z - 2, a: 0 }, 8, 8, 32);
    this.mode = 'path';
    this.pathKind = 'uturn';
    this.s = 0;
    this.change = null;
  }

  private move(ds: number): void {
    if (this.mode === 'street') this.moveStreet(ds);
    else if (this.mode === 'ring') this.moveRing(ds);
    else this.movePath(ds);
  }

  private moveStreet(ds: number): void {
    const prevS = this.s;
    const prevD = this.d;
    this.s += ds;
    const W = this.net.laneWidth;
    this.advanceChange(ds);
    // Перетин лінії між смугами — перевіряємо суцільну.
    if ((prevD - W) * (this.d - W) <= 0 && prevD !== this.d && this.inSolidZone()) this.fault('solidLine');
    this.yaw = ds > 1e-6 ? Math.atan2(this.d - prevD, ds) : this.yaw * 0.9;
    this.updatePose();
    this.checkFeatures(prevS);
    if (this.result) return;

    const ref = this.net.ref[this.dir];
    if (this.dir === 'S') {
      const u = this.uturnFeature();
      if (this.s - this.cfg.car.length / 2 > u.zone.S[1] + 2) this.fault('offRoute', 'Пропущено розворот на перехресті з вул. Естонською');
    } else if (this.s >= ref.length) {
      // Лінія «Дати дорогу» перед кільцем.
      this.entryLane = this.change ? this.change.target : this.lane;
      this.checkRingYield('S');
      if (this.result) return;
      this.path = this.net.entryPath({ x: this.x, z: this.z, a: this.a }, 'S', this.entryLane);
      this.entryArm = 'S';
      this.mode = 'path';
      this.pathKind = 'entry';
      this.s = 0;
      this.change = null;
      this.yaw = 0;
    }
  }

  private inSolidZone(): boolean {
    const L = this.cfg.rules.solidBeforeStop;
    return this.net.features.some((f) => this.s >= f.stop[this.dir] - L && this.s <= f.zone[this.dir][1]);
  }

  private checkFeatures(prevS: number): void {
    const half = this.cfg.car.length / 2;
    const front = this.s + half, prevFront = prevS + half, rear = this.s - half;
    for (const f of this.net.features) {
      const key = `${f.def.id}:${this.dir}`;
      const stop = f.stop[this.dir];
      const [z0, z1] = f.zone[this.dir];
      // Пішохід виходить, коли учень наближається (лише на нерегульованих).
      if (f.def.kind === 'zebra' && stop - front < this.cfg.peds.zebraTriggerDist && stop - front > 0 && !this.passFlags.has(key + ':trig')) {
        this.passFlags.add(key + ':trig');
        this.peds.trigger(f);
      }
      if (f.signalised && prevFront < stop && front >= stop && !this.passFlags.has(key + ':stop')) {
        this.passFlags.add(key + ':stop');
        const l = this.light(f);
        if (isStopLight(l)) this.fault('redLight');
        else if (l === 'yellow') {
          const since = sinceYellow(this.t, f.def.offset ?? 0, this.cfg.signals);
          const distAtOnset = this.v * since;
          if (distAtOnset > (this.v * this.v) / (2 * this.cfg.rules.yellowComfortDecel) + 1) this.fault('yellowLight');
        }
        if (this.result) return;
      }
      if (f.def.kind !== 'intersection' && front > z0 && rear < z1 && !this.passFlags.has(key + ':ped')) {
        if (this.peds.conflict(f.def.id, this.dir, 0)) { // пішохід уже на нашій половині
          this.passFlags.add(key + ':ped');
          this.fault('pedestrianYield');
          if (this.result) return;
        }
      }
    }
  }

  private checkRingYield(arm: ArmId): void {
    if (this.v > 0.3 && ringBusy(this.net, this.net.arms[arm].mergeAt(this.entryLane), this.traffic.ringBodies(arm), 0, this.cfg.rules.ringYieldTime)) this.fault('ringYield');
  }

  private moveRing(ds: number): void {
    const prev = this.theta;
    const prevD = this.d;
    const r = this.net.ring.r + this.d;
    this.theta += ds / r;
    this.advanceChange(ds);
    this.yaw = ds > 1e-6 ? Math.atan2(this.d - prevD, ds) : this.yaw * 0.9;
    const dth = this.theta - prev;
    this.updatePose();
    if (dth <= 0) return;
    const expected: ArmId = this.stage === 'ring2' ? 'W' : 'S';
    for (const id of this.net.armOrder) {
      const ex = this.net.arms[id].exitAt(this.change ? this.change.target : this.lane);
      if (mod(ex - prev, Math.PI * 2) > dth) continue;
      if (this.armed === id) {
        this.checkSignal(1);
        if (this.result) return;
        if (id !== expected) { this.fault('offRoute', `Зʼїзд не туди: ${this.net.arms[id].name}`); return; }
        const lane: RingLane = this.change ? this.change.target : this.lane;
        if (this.stage === 'ring1' && lane === 0) { this.fault('ringExitLane'); if (this.result) return; }
        this.path = this.net.exitPath(id, lane);
        this.lane = lane;
        this.change = null;
        this.yaw = 0;
        this.mode = 'path';
        this.pathKind = 'exit';
        this.s = (this.theta - (prev + mod(ex - prev, Math.PI * 2))) * r;
        this.armed = null;
        this.updatePose();
        return;
      }
      if (id === expected && this.cfg.rules.missedExitIsOffRoute) { this.fault('offRoute', 'Пропущено потрібний зʼїзд з кільця'); return; }
    }
  }

  private movePath(ds: number): void {
    this.s += ds;
    if (this.s < this.path.length) { this.updatePose(); this.checkFinish(); return; }
    const over = this.s - this.path.length;
    switch (this.pathKind) {
      case 'startIn':
        this.checkRingYield('W');
        if (this.result) return;
        this.entryArm = 'W';
        this.entryLane = 1; // з автодрому одна смуга — на зовнішню
        this.path = this.net.entryPath(this.path.pose(this.path.length), 'W', 1);
        this.pathKind = 'entry';
        this.s = over;
        break;
      case 'entry':
        this.mode = 'ring';
        this.lane = this.entryLane;
        this.d = (this.entryLane - 0.5) * this.net.ring.laneWidth;
        this.yaw = 0;
        this.theta = this.net.arms[this.entryArm].mergeAt(this.entryLane) + over / (this.net.ring.r + this.d);
        this.stage = this.entryArm === 'W' ? 'ring1' : 'ring2';
        if (this.armPending) { this.armed = this.nextExitArm(); this.armPending = false; }
        break;
      case 'exit':
        if (this.stage === 'ring2') {
          this.path = this.net.finishOut;
          this.pathKind = 'finishOut';
          this.stage = 'finish';
          this.s = over;
        } else {
          this.mode = 'street';
          this.dir = 'S';
          this.stage = 'south';
          this.d = this.net.laneWidth * (this.lane + 0.5); // смуга Мрії = смуга, з якої зʼїхали
          this.s = over;
          this.hint('south', 'Вул. Мрії на південь. Ліміт 50 км/год. Тримайтесь правої смуги, пропускайте пішоходів.');
        }
        if (this.sig === 1) this.sig = 0;
        break;
      case 'uturn': {
        const end = this.path.pose(this.path.length);
        const p = this.net.ref.N.project(end.x, end.z);
        this.mode = 'street';
        this.dir = 'N';
        this.stage = 'north';
        this.s = p.s + over;
        this.d = p.d;
        this.lane = p.d < this.net.laneWidth ? 0 : 1;
        if (this.sig === -1) this.sig = 0;
        this.hint('north', 'Тепер на північ до кільця. Перестройтесь праворуч. На кільці — другий зʼїзд.');
        break;
      }
      case 'finishOut':
        break;
    }
    this.updatePose();
    this.checkFinish();
  }

  private checkFinish(): void {
    if (this.pathKind === 'finishOut' && this.s >= this.net.finishS && !this.result) this.finish(true, 'Маршрут пройдено');
  }

  private updatePose(): void {
    if (this.mode === 'ring') {
      const p = ringPose(this.net.ring.cx, this.net.ring.cz, this.net.ring.r + this.d, this.theta);
      this.x = p.x; this.z = p.z; this.a = p.a + this.yaw;
    } else if (this.mode === 'street') {
      const p = this.net.ref[this.dir].pose(this.s);
      const hx = Math.sin(p.a), hz = -Math.cos(p.a);
      this.x = p.x - hz * this.d;
      this.z = p.z + hx * this.d;
      this.a = p.a + this.yaw;
    } else {
      const p = this.path.pose(this.s);
      this.x = p.x; this.z = p.z; this.a = p.a;
    }
  }

  private carNear(f: Feature): boolean {
    const near = (x: number, z: number, a: number, v: number): boolean => {
      if (Math.abs(x) > this.net.carriageway.N[1] + 1) return false;
      const dz = f.worldZ - z, vz = -Math.cos(a) * v;
      return Math.abs(dz) < 5 || (dz * vz > 0 && Math.abs(dz) < Math.abs(vz) * 2.5 + 5);
    };
    if (near(this.x, this.z, this.a, this.v)) return true;
    return this.traffic.cars.some((c) => near(c.x, c.z, c.a, c.v)) || this.riders.list.some((r) => near(r.x, r.z, r.a, r.v));
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
      if (boxesOverlap(me, { x: r.x, z: r.z, a: r.a, hl: r.len / 2, hw: r.width / 2 })) {
        this.fault('crash', r.kind === 'bike' ? 'Зіткнення з велосипедистом' : 'Зіткнення з самокатником');
        return;
      }
    }
    for (const p of this.peds.list) {
      if (this.peds.walking(p) && pointBoxDist(p.x, p.z, me) < 0.3) { this.fault('pedestrianHit'); return; }
    }
  }

  // Куди перестроюється гравець (для рішень ІІ про перестроювання).
  private ghost(): Body | null {
    // Під час розвороту гравець от-от займе ліву смугу N — ІІ має це враховувати.
    if (this.mode === 'path' && this.pathKind === 'uturn') {
      const e = this.path.pose(this.path.length);
      return { id: 0, box: { x: e.x, z: e.z, a: e.a, hl: this.cfg.car.length / 2, hw: this.cfg.car.width / 2 }, v: Math.max(this.v, 3) };
    }
    if (!this.change || this.mode !== 'street') return null;
    const p = this.net.ref[this.dir].pose(this.s);
    const hx = Math.sin(p.a), hz = -Math.cos(p.a);
    return { id: 0, box: { x: p.x - hz * this.change.to, z: p.z + hx * this.change.to, a: p.a, hl: this.cfg.car.length / 2, hw: this.cfg.car.width / 2 }, v: this.v };
  }

  // Хтось у напрямку dir наближається до лінії z (за 4 с) або поруч — порушник чекає на осьовій.
  private roadNear(z: number, dir: Dir): boolean {
    const [lo, hi] = this.net.carriageway[dir];
    // Хто стоїть (зокрема перед ним) — не заважає, якщо не стоїть просто на його лінії.
    const test = (x: number, zz: number, a: number, v: number, hl = 2.4): boolean => {
      if (x < lo - 1 || x > hi + 1) return false;
      const dz = z - zz, vz = -Math.cos(a) * v;
      if (v < 0.5) return Math.abs(dz) < hl + 0.8;
      return Math.abs(dz) < 6 || (dz * vz > 0 && Math.abs(dz) < Math.abs(vz) * 4 + 6);
    };
    if (test(this.x, this.z, this.a, this.v)) return true;
    return this.traffic.cars.some((c) => c.kind === 'car' && test(c.x, c.z, c.a, c.v, c.len / 2)) || this.riders.list.some((r) => test(r.x, r.z, r.a, r.v, r.len / 2));
  }

  // ---- Порушник (пішохід поза переходом) ----

  private planJaywalker(rng: Rng): void {
    const P = this.cfg.peds;
    if (rng.next() >= P.jaywalkChance) return;
    const dir: Dir = rng.next() < 0.5 ? 'S' : 'N';
    const u = this.uturnFeature();
    const lo = dir === 'S' ? 60 : u.zone.N[1] + P.jaywalkClear;
    const hi = dir === 'S' ? u.zone.S[0] - P.jaywalkClear : this.cfg.street.length - 60;
    let windows = this.traffic.freeSlots(dir, P.jaywalkClear, P.jaywalkClear, lo, hi);
    // Подалі від перешкод на обох половинах (±20 м).
    for (const c of this.traffic.cars) {
      if (c.kind === 'car') continue;
      const cs = this.net.sAt(dir, c.z);
      windows = windows.flatMap(([a, b]): [number, number][] => {
        if (cs + 20 <= a || cs - 20 >= b) return [[a, b]];
        return ([[a, cs - 20], [cs + 20, b]] as [number, number][]).filter(([x, y]) => y - x >= 4);
      });
    }
    if (windows.length) this.jw = { dir, windows };
  }

  private checkJaywalker(): void {
    if (this.mode !== 'street') return;
    const half = this.cfg.car.length / 2;
    const front = this.s + half, rear = this.s - half;
    // Вихід порушника перед учнем.
    if (this.jw && !this.jwDone && this.dir === this.jw.dir && this.v > 4) {
      const D = Math.max(this.cfg.peds.jaywalkMinDist, this.v * 1.0 + (this.v * this.v) / 8 + 6);
      const target = front + D;
      if (this.jw.windows.some(([a, b]) => target >= a && target <= b)) {
        const busy = [...this.traffic.cars.filter((c) => c.kind === 'car'), ...this.riders.list].some((c) => {
          const q = this.net.streetSlot(c.x, c.z);
          return q !== null && q.dir === this.dir && q.s > this.s - 25 && q.s < target + 15;
        });
        if (!busy) {
          this.jwDone = true;
          this.peds.spawnJaywalker(this.dir, this.dir === 'S' ? this.cfg.street.startZ + target : this.cfg.street.startZ + this.cfg.street.length - target);
        }
      }
    }
    // Проїхав повз порушника, коли той на нашій половині.
    for (const p of this.peds.jaywalkers(this.dir, 0)) {
      if (this.jwYielded.has(p.id)) continue;
      const ps = this.net.sAt(this.dir, p.z);
      if (front >= ps && rear <= ps + 0.5) {
        this.jwYielded.add(p.id);
        this.fault('pedestrianYield', 'Не надано перевагу пішоходу, що переходить дорогу');
        if (this.result) return;
      }
    }
  }

  // ---- Вело/самокат: обгін у своїй смузі з малим інтервалом ----

  private checkCloseOvertake(): void {
    if (this.mode !== 'street') return;
    const W = this.net.laneWidth;
    const ref = this.net.ref[this.dir];
    const myLane = this.d < W ? 0 : 1;
    for (const r of this.riders.list) {
      if (r.dir !== this.dir || r.turn || this.closePassed.has(r.id)) continue;
      const q = ref.project(r.x, r.z);
      if ((q.d < W ? 0 : 1) !== myLane) continue;
      if (Math.abs(q.s - this.s) > this.cfg.car.length / 2 + r.len / 2) continue;
      if (this.v < r.v + 0.3) continue;
      const clear = Math.abs(q.d - this.d) - this.cfg.car.width / 2 - r.width / 2;
      if (clear < this.cfg.rules.closeOvertakeClear) {
        this.closePassed.add(r.id);
        this.fault('closeOvertake');
        return;
      }
    }
  }

  // ---- Змусив ІІ різко гальмувати ----

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
      const prio = this.hasPriority(c);
      let hit = c.leadId === 0 && c.acc < -R.forcedDecel && (cutRecent || prio);
      // TTC — лише до того, хто вже на траєкторії повороту чи перетинає наш курс (не до попутного попереду).
      if (!hit && prio && (c.leg === c.plan!.turnLeg || Math.abs(wrapAngle(c.a - this.a)) > 0.35)) {
        // Час до зіткнення з ІІ, що вже повертає (у нашому коридорі попереду).
        const dx = c.x - this.x, dz = c.z - this.z;
        const fwd = dx * hx + dz * hz, lat = dx * -hz + dz * hx;
        const da = c.a - this.a;
        const lonB = Math.abs(Math.cos(da)) * c.len / 2 + Math.abs(Math.sin(da)) * hw;
        const latB = Math.abs(Math.sin(da)) * c.len / 2 + Math.abs(Math.cos(da)) * hw;
        if (fwd > 0 && Math.abs(lat) < hw + latB + 0.2) {
          const gap = fwd - hl - lonB;
          // Зближення — лише за рахунок руху гравця (той, хто стоїть, нікого не змушує).
          const closing = this.v - Math.max(0, c.v * Math.cos(da));
          // Близько й швидко: TTC малий і спокійно (≤ forcedStopDecel) вже не зупинитись.
          if (gap > 0 && this.v > 1 && closing > 0.5 && gap / closing < R.forcedTTC && (closing * closing) / (2 * gap) > R.forcedStopDecel) hit = true;
        }
      }
      if (hit) {
        this.forced.add(c.id);
        this.fault('forcedBraking');
        if (this.result) return;
      }
    }
  }

  // ІІ уже повертає (розпочав маневр) — має перевагу перед гравцем.
  private hasPriority(c: Car): boolean {
    if (!c.plan || c.plan.done) return false;
    return c.commit || c.leg === c.plan.turnLeg;
  }

  private checkSpeed(dt: number): void {
    const kmh = this.v * 3.6;
    if (kmh > this.cfg.rules.speedLimitKmh) {
      this.overT += dt;
      this.hint(`speed:${Math.floor(this.t / 20)}`, 'Обмеження 50 км/год — пригальмуйте.');
      if (this.overT > this.cfg.rules.speedHoldS && this.speedArmed) { this.speedArmed = false; this.fault('speeding'); }
    } else { this.overT = 0; this.speedArmed = true; }
  }

  private checkLeftLane(dt: number): void {
    if (this.mode !== 'street' || this.lane !== 0 || this.change || this.v < 2) {
      if (this.mode !== 'street' || this.lane === 1) { this.hogT = 0; this.hogArmed = true; }
      return;
    }
    if (this.dir === 'S' && this.uturnFeature().def.s - this.s < this.cfg.rules.uturnPrepDist) return;
    // Перед двосмуговим кільцем ліва смуга — законна (на внутрішню смугу кільця).
    if (this.dir === 'N' && this.net.ref.N.length - this.s < this.cfg.rules.ringPrepDist) return;
    // Між смугами суцільна — повернутись праворуч не можна, час не рахується (пауза, не скидання).
    if (this.inSolidZone()) return;
    const R = this.cfg.rules;
    const busy = [...this.traffic.cars, ...this.riders.list].some((c) => {
      const q = this.net.streetSlot(c.x, c.z);
      if (!q || q.dir !== this.dir || q.lane !== 1) return false;
      const rel = q.s - this.s;
      // Перешкода (припарковане/зламане) далі попереду теж робить праву смугу «не вільною»: однаково обʼїжджати.
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
    if (this.mode === 'street') {
      const front = this.s + this.cfg.car.length / 2;
      for (const f of this.net.features) {
        const d = f.stop[this.dir] - front;
        if (d < 0 || d > 60) continue;
        if (f.signalised && isStopLight(this.light(f))) this.hint(`red:${f.def.id}:${this.dir}:${Math.floor(this.t / this.cfg.signals.cycle)}`, 'Попереду червоний — зупиніться перед стоп-лінією.');
        if (f.def.kind !== 'intersection' && this.peds.conflict(f.def.id, this.dir, this.cfg.rules.pedConflictMargin)) this.hint(`ped:${f.def.id}:${this.dir}`, 'Пішохід на переході — пропустіть.');
      }
      if (this.dir === 'S') {
        const u = this.uturnFeature();
        const left = u.def.s - this.s;
        if (left < 250) this.hint('uturnPrep', `Через ${Math.round(left / 10) * 10} м розворот (${u.def.name}): займіть ліву смугу, увімкніть лівий покажчик, розворот — із середини перехрестя.`);
      } else if (this.net.ref.N.length - this.s < 120) {
        this.hint('ring2', 'Кільце: поступіться тим, хто на кільці. З правої смуги — у праву смугу кільця, другий зʼїзд до фінішу.');
      }
    }
    if (this.mode === 'ring') {
      const exp: ArmId = this.stage === 'ring2' ? 'W' : 'S';
      const left = mod(this.net.arms[exp].exitTheta - this.theta, Math.PI * 2) * this.net.ring.r;
      if (this.stage === 'ring1' && this.lane === 0) this.hint('ring1lane', 'Перший зʼїзд — лише з правої (зовнішньої) смуги.');
      if (left < 20 && this.armed !== exp) this.hint(`exit:${this.stage}`, `Ваш зʼїзд ${EXIT_NO[this.stage === 'ring2' ? 'ring2' : 'ring1']} — правий покажчик і «Зʼїзд».`);
    }
  }
}
