// Парковка: паралельна задом і заїзд у гараж. Окремий невеликий рушій: велосипедна модель авто (опорна точка — задня вісь),
// задній хід, кермо, зіткнення OBB↔OBB. Одиниці — метри; X на схід, Z на південь; курс a: вперед = (sin a, −cos a), a зростає вправо.
// Інтерфейс (t, cfg.car, player, traffic.cars, riders, peds) сумісний з ActorSim, тож 3D-актори малюють його без змін.

export type ParkKind = 'parallel' | 'garage' | 'turn';
export const PARK_LABEL: Record<ParkKind, string> = { parallel: 'Паралельна парковка', garage: 'Заїзд у гараж', turn: 'Розворот у 3 прийоми' };

import { Gearbox } from './gearbox';
export interface ParkControls { readonly gas: boolean; readonly brake: boolean; readonly steer: number; readonly reverse: boolean; readonly clutch?: boolean }
export interface Obb { readonly x: number; readonly z: number; readonly hl: number; readonly hw: number; readonly a: number }
export type ObsKind = 'car' | 'curb' | 'cone' | 'wall';
export interface Obstacle extends Obb { readonly kind: ObsKind; readonly h: number }
export interface ParkFault { readonly code: string; readonly message: string; readonly t: number }
export interface ParkResult { readonly passed: boolean; readonly reason: string; readonly time: number; readonly faults: readonly ParkFault[]; readonly corrections: number }

export const CAR = { length: 4.4, width: 1.8, wheelbase: 2.7, rearAxle: 1.3, maxSteer: 0.62 } as const; // rearAxle — від центру назад до задньої осі
const TIME_LIMIT = 240;
const wrap = (x: number): number => { let r = (x + Math.PI) % (Math.PI * 2); if (r < 0) r += Math.PI * 2; return r - Math.PI; };

function corners(b: Obb): [number, number][] {
  const fx = Math.sin(b.a), fz = -Math.cos(b.a), rx = Math.cos(b.a), rz = Math.sin(b.a);
  const out: [number, number][] = [];
  for (const [l, w] of [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const) out.push([b.x + fx * b.hl * l + rx * b.hw * w, b.z + fz * b.hl * l + rz * b.hw * w]);
  return out;
}
// Перетин двох повернутих прямокутників (теорема про розділову вісь).
export function obbHit(p: Obb, q: Obb): boolean {
  const cp = corners(p), cq = corners(q);
  for (const a of [p.a, q.a, p.a + Math.PI / 2, q.a + Math.PI / 2]) {
    const ax = Math.sin(a), az = -Math.cos(a);
    let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity;
    for (const [x, z] of cp) { const d = x * ax + z * az; p0 = Math.min(p0, d); p1 = Math.max(p1, d); }
    for (const [x, z] of cq) { const d = x * ax + z * az; q0 = Math.min(q0, d); q1 = Math.max(q1, d); }
    if (p1 < q0 || q1 < p0) return false;
  }
  return true;
}

interface Layout {
  readonly obstacles: Obstacle[];
  readonly cars: { x: number; z: number; a: number; len: number; color: number }[];
  readonly start: { x: number; z: number; a: number }; // центр авто
  readonly hint: string;
  readonly bounds: { x0: number; x1: number; z0: number; z1: number };
  readonly zone: Obb; // зона парковки (для розмітки)
}

const box = (kind: ObsKind, x0: number, x1: number, z0: number, z1: number, h: number): Obstacle => ({ kind, h, x: (x0 + x1) / 2, z: (z0 + z1) / 2, hl: (z1 - z0) / 2, hw: (x1 - x0) / 2, a: 0 });

// Паралельна: вулиця вздовж X, бордюр праворуч (z = 2.9). Місце 6,6 м між двома авто; старт — біля переднього авто.
function parallelLayout(): Layout {
  const CZ = 2.9, SP0 = 0, SP1 = 6.6, parkZ = CZ - 0.95;
  const o: Obstacle[] = [
    box('curb', -30, 40, CZ, CZ + 0.3, 0.15), box('curb', -30, 40, -4.9, -4.6, 0.15),
  ];
  const cars = [{ x: SP0 - 2.4, z: parkZ, a: Math.PI / 2, len: 4.4, color: 0x5b7fd6 }, { x: SP1 + 2.5, z: parkZ, a: Math.PI / 2, len: 4.4, color: 0xd6a35b }];
  for (const c of cars) o.push({ kind: 'car', h: 1.5, x: c.x, z: c.z, hl: 2.2, hw: 0.9, a: c.a });
  return {
    obstacles: o, cars, start: { x: SP1 + 2.5 - 0.3, z: -0.6, a: Math.PI / 2 }, bounds: { x0: -26, x1: 34, z0: -6, z1: 6 },
    zone: { x: (SP0 + SP1) / 2, z: parkZ, hl: (SP1 - SP0) / 2, hw: 1.15, a: Math.PI / 2 },
    hint: 'Паралельна парковка: станьте поруч із переднім авто, увімкніть задній хід (Р), кермо вправо — і назад у кишеню; далі кермо вліво.',
  };
}

// Гараж: вулиця вздовж X, гараж справа (z від 3 до 8,6). Прорізь 3,4 м, бічні стіни й задня; навколо бордюр.
function garageLayout(): Layout {
  const GX0 = 9, GX1 = 12.6, GZ0 = 3.0, GZ1 = 8.6, T = 0.4;
  const o: Obstacle[] = [
    box('curb', -30, GX0 - T, GZ0, GZ0 + 0.3, 0.15), box('curb', GX1 + T, 40, GZ0, GZ0 + 0.3, 0.15), box('curb', -30, 40, -6.6, -6.3, 0.15),
    box('wall', GX0 - T, GX0, GZ0, GZ1 + T, 2.6), box('wall', GX1, GX1 + T, GZ0, GZ1 + T, 2.6), box('wall', GX0 - T, GX1 + T, GZ1, GZ1 + T, 2.6),
    box('cone', GX0 - T - 0.25, GX0 - T + 0.05, GZ0 - 0.5, GZ0 - 0.2, 0.7), box('cone', GX1 + T - 0.05, GX1 + T + 0.25, GZ0 - 0.5, GZ0 - 0.2, 0.7),
  ];
  return {
    obstacles: o, cars: [], start: { x: 3.5, z: -0.5, a: Math.PI / 2 }, bounds: { x0: -26, x1: 34, z0: -8, z1: 10 },
    zone: { x: (GX0 + GX1) / 2, z: GZ0 + 3.2, hl: 3.1, hw: (GX1 - GX0) / 2 - 0.2, a: 0 },
    hint: 'Заїзд у гараж: проїдьте повз проріз, зупиніться, задній хід (Р) і кермо в бік гаража; випрямте авто по стінах.',
  };
}

// Розворот у три прийоми («ластівка»): вузька вулиця 9 м між бордюрами, старт біля правого бордюру; потрібно стати назад по ходу, у правій смузі.
function turnLayout(): Layout {
  const Z0 = -8.0, Z1 = 3.4;
  return {
    obstacles: [box('curb', -30, 40, Z1, Z1 + 0.3, 0.15), box('curb', -30, 40, Z0 - 0.3, Z0, 0.15)],
    cars: [], start: { x: 0, z: 2.0, a: Math.PI / 2 }, bounds: { x0: -26, x1: 34, z0: -11, z1: 8 },
    zone: { x: 0, z: -5.0, hl: 6, hw: 1.2, a: Math.PI / 2 },
    hint: 'Розворот у три прийоми: вперед із кермом уліво до лівого бордюру, назад із розворотом керма, і знову вперед — і їдьте назад по правій смузі. Бордюрів не торкайтесь.',
  };
}

export class ParkSim {
  readonly kind: ParkKind;
  readonly cfg = { car: { length: CAR.length, width: CAR.width }, dt: 1 / 60 } as const;
  readonly layout: Layout;
  readonly traffic: { cars: { id: number; x: number; z: number; a: number; len: number; braking: boolean; kind: 'parked'; hazard: boolean; turn: 0; color: number; v: number }[] };
  readonly riders = { list: [] as never[] };
  readonly peds = { list: [] as never[] };
  t = 0;
  v = 0;
  grip = 1;
  readonly gb = new Gearbox(-1); // механіка: передачі R/N/1–5 (у автоматі — перемикач «Вперед/Назад»)
  private rx = 0; private rz = 0; a = 0;
  wheel = 0;               // фактичний кут керма −1..1
  reverse = false;
  braking = false;
  result: ParkResult | null = null;
  faults: ParkFault[] = [];
  moves = 0;               // кількість «прийомів» — відрізків руху в один бік довжиною > 0,8 м
  private curDir = 0; private curDist = 0; private counted = false;
  get corrections(): number { return Math.max(0, this.moves - 1); }
  private launched = false; // поки не натиснули газ — стоїмо (без «повзання»)
  private stillT = 0;

  constructor(kind: ParkKind) {
    this.kind = kind;
    this.layout = kind === 'parallel' ? parallelLayout() : kind === 'garage' ? garageLayout() : turnLayout();
    this.traffic = { cars: this.layout.cars.map((c, i) => ({ id: 1000 + i, x: c.x, z: c.z, a: c.a, len: c.len, braking: false, kind: 'parked' as const, hazard: false, turn: 0 as const, color: c.color, v: 0 })) };
    const s = this.layout.start;
    this.a = s.a;
    this.rx = s.x - Math.sin(s.a) * CAR.rearAxle; this.rz = s.z + Math.cos(s.a) * CAR.rearAxle;
  }

  setGrip(g: number): void { this.grip = Math.max(0.1, Math.min(1, g)); }
  get x(): number { return this.rx + Math.sin(this.a) * CAR.rearAxle; }
  get z(): number { return this.rz - Math.cos(this.a) * CAR.rearAxle; }
  get player(): { x: number; z: number; a: number; v: number; braking: boolean; sig: 0; sigT: number } { return { x: this.x, z: this.z, a: this.a, v: this.v, braking: this.braking, sig: 0, sigT: 0 }; }
  get body(): Obb { return { x: this.x, z: this.z, hl: CAR.length / 2 - 0.02, hw: CAR.width / 2 - 0.02, a: this.a }; }
  get next(): { text: string; dist: number } { return { text: this.layout.hint, dist: 0 }; }

  // Відстань до бордюру (паралельна), м, і кут до лінії вулиці, градуси — для підказки в HUD.
  get metrics(): { curb: number | null; angle: number } {
    const ang = this.kind === 'turn' ? wrap(this.a + Math.PI / 2) : this.kind === 'parallel' ? wrap(this.a - Math.PI / 2) : wrap(Math.abs(wrap(this.a)) < Math.PI / 2 ? this.a : this.a - Math.PI);
    let curb: number | null = null;
    if (this.kind === 'parallel') curb = Math.max(0, 2.9 - Math.max(...corners(this.body).map((c) => c[1])));
    return { curb, angle: ang * 180 / Math.PI };
  }

  private fault(code: string, message: string): void {
    if (this.result) return;
    const f = { code, message, t: this.t };
    this.faults.push(f);
    this.result = { passed: false, reason: message, time: this.t, faults: this.faults.slice(), corrections: this.corrections };
  }

  step(ctl: ParkControls, dt = this.cfg.dt): void {
    if (this.result) return;
    this.t += dt;
    // Кермо з обмеженою швидкістю повороту.
    const want = Math.max(-1, Math.min(1, ctl.steer));
    this.wheel += Math.max(-1.6 * dt, Math.min(1.6 * dt, want - this.wheel));
    this.reverse = this.gb.manual ? this.gb.gear < 0 : ctl.reverse;
    if (this.gb.manual) {
      this.braking = ctl.brake;
      this.v = this.gb.step(this.v, { gas: ctl.gas, brake: ctl.brake, clutch: !!ctl.clutch }, { brake: 5.5, coast: 0.45 }, this.grip, dt);
      this.v = Math.max(-3.5, Math.min(6, this.v));
      this.launched = true;
    } else {
      if (!this.launched) { if (!ctl.gas) { this.v = 0; this.braking = false; return; } this.launched = true; }
      // Швидкість: газ — до 3 м/с вперед чи 2 м/с назад, без педалей — «повзе» 0,7 м/с (автомат), гальмо — зупиняє.
      const dir = ctl.reverse ? -1 : 1, g = this.grip;
      this.braking = ctl.brake;
      if (ctl.brake) {
        const d = 5.5 * g * dt;
        this.v = Math.abs(this.v) <= d ? 0 : this.v - Math.sign(this.v) * d;
      } else {
        const target = dir * (ctl.gas ? (ctl.reverse ? 2.0 : 3.0) : 0.7);
        const acc = (ctl.gas ? 1.6 : 0.9) * (0.4 + 0.6 * g) * dt;
        this.v += Math.max(-acc, Math.min(acc, target - this.v));
      }
    }
    if (Math.abs(this.v) > 0.05) {
      const d = Math.sign(this.v);
      if (d !== this.curDir) { this.curDir = d; this.curDist = 0; this.counted = false; }
      this.curDist += Math.abs(this.v) * dt;
      if (!this.counted && this.curDist > 0.8) { this.counted = true; this.moves++; }
    }
    const delta = this.wheel * CAR.maxSteer;
    this.a += (this.v / CAR.wheelbase) * Math.tan(delta) * dt;
    this.rx += Math.sin(this.a) * this.v * dt;
    this.rz -= Math.cos(this.a) * this.v * dt;
    this.check(dt);
  }

  private check(dt: number): void {
    const b = this.body;
    for (const o of this.layout.obstacles) {
      if (!obbHit(b, o)) continue;
      const msg = o.kind === 'car' ? 'Зіткнення із запаркованим авто' : o.kind === 'curb' ? 'Наїзд на бордюр' : o.kind === 'cone' ? 'Збито конус' : 'Зіткнення зі стіною гаража';
      this.fault(o.kind, msg);
      return;
    }
    const bd = this.layout.bounds;
    if (this.x < bd.x0 || this.x > bd.x1 || this.z < bd.z0 || this.z > bd.z1) { this.fault('out', 'Виїзд за межі майданчика'); return; }
    if (this.t > TIME_LIMIT) { this.fault('time', 'Перевищено час на вправу'); return; }
    // Успіх: авто стоїть у правильній позі близько секунди.
    if (Math.abs(this.v) < 0.05 && this.poseOk()) {
      this.stillT += dt;
      if (this.stillT > 0.8) this.result = { passed: true, reason: this.kind === 'turn' ? `Розвернулись за ${this.moves} ${this.moves === 3 ? 'прийоми' : 'прийомів'}${this.moves > 3 ? ' (більше трьох)' : ''}` : `Припарковано, поправок: ${this.corrections}`, time: this.t, faults: this.faults.slice(), corrections: this.corrections };
    } else this.stillT = 0;
  }

  // Правильна поза: паралельна — вирівняно, ≤ 0,6 м до бордюру, у кишені; гараж — повністю всередині, рівно.
  poseOk(): boolean {
    const m = this.metrics, cs = corners(this.body);
    if (this.kind === 'parallel') {
      const z = this.layout.zone;
      const inside = cs.every(([x]) => x > z.x - z.hl + 0.3 && x < z.x + z.hl - 0.3);
      return Math.abs(m.angle) < 8 && m.curb !== null && m.curb <= 0.6 && inside;
    }
    if (this.kind === 'turn') return Math.abs(m.angle) < 12 && this.z < -2.3 && this.z > -7.1;
    const gz = this.layout.zone;
    const inside = cs.every(([x, z]) => x > gz.x - gz.hw - 0.02 && x < gz.x + gz.hw + 0.02 && z > 3.2);
    return Math.abs(m.angle) < 8 && inside;
  }
}
