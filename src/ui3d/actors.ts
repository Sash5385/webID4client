// Рухомі обʼєкти: авто (гравець + ІІ, моделі Kenney, пул за id), райдери (вело/самокат) і пішоходи (інстансинг).
import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Material, Matrix4, Mesh,
  AdditiveBlending, CanvasTexture, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { Geo } from './geo';
import { TRAFFIC_CARS, type Baked, type Models } from './models';
import type { Quality } from './quality';

// Актори читаються лише через ці поля (однаково для маршрутів №1 і №7).
export interface Rider { readonly id: number; readonly kind: 'bike' | 'scooter'; readonly x: number; readonly z: number; readonly a: number; readonly v: number; readonly len: number; readonly width: number }
interface CarLike { readonly id: number; readonly x: number; readonly z: number; readonly a: number; readonly len: number; readonly braking: boolean; readonly kind: 'car' | 'parked' | 'broken'; readonly hazard: boolean; readonly turn: -1 | 0 | 1; readonly color: number }
interface PedLike { readonly id: number; readonly x: number; readonly z: number; readonly a: number; readonly speed: number }
export interface ActorSim {
  readonly t: number;
  readonly cfg: { readonly car: { readonly length: number } };
  readonly player: { readonly x: number; readonly z: number; readonly a: number; readonly braking: boolean; readonly sig: -1 | 0 | 1; readonly sigT: number };
  readonly traffic: { readonly cars: readonly CarLike[] };
  readonly riders: { readonly list: readonly Rider[] };
  readonly peds: { readonly list: readonly PedLike[] };
}
type Sim = ActorSim;

const box = new BoxGeometry(1, 1, 1);
const tailOn = new MeshBasicMaterial({ color: 0xff2a22, toneMapped: false });
const sigOn = new MeshBasicMaterial({ color: 0xffa81c, toneMapped: false });
const headOn = new MeshBasicMaterial({ color: 0xfff7e0, toneMapped: false });
const tailDim = new MeshBasicMaterial({ color: 0x9a1812, toneMapped: false });
// Пляма світла від ближнього світла на дорозі (адитивна, градієнт): 5 м завширшки, 11 м вперед. Одна на всіх.
let poolMat: MeshBasicMaterial | null = null;
const poolGeo = new PlaneGeometry(5, 11);
function pool(): MeshBasicMaterial {
  if (poolMat) return poolMat;
  const W = 64, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!, im = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = 1 - y / H;                     // 1 біля авто (низ картинки), 0 далеко
    const half = 0.18 + 0.32 * (1 - t);      // конус розширюється вдалину
    const u = (x / (W - 1) - 0.5) / half;
    const a = Math.max(0, 1 - u * u) * Math.pow(t, 1.3) * Math.min(1, (1 - t) * 14 + 0.25);
    const i = (y * W + x) * 4; im.data[i] = 255; im.data[i + 1] = 244; im.data[i + 2] = 214; im.data[i + 3] = Math.round(255 * a);
  }
  ctx.putImageData(im, 0, 0);
  const tex = new CanvasTexture(c);
  poolMat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.55, fog: true });
  poolMat.userData['shared'] = true;
  return poolMat;
}

const T = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Matrix4 =>
  new Matrix4().makeTranslation(x, y, z).multiply(new Matrix4().makeScale(sx, sy, sz));

function lamp(mat: MeshBasicMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh {
  const m = new Mesh(box, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.visible = false;
  return m;
}

const hash = (id: number): number => Math.imul(id + 1, 2654435761) >>> 0;
const pick = <V>(arr: readonly V[], h: number): V => arr[h % arr.length]!;

// Дальність промальовування (м від гравця) за якістю: туман на низькій ~90 м.
const DRAW_R: Record<Quality, { car: number; ped: number; rider: number }> = {
  low: { car: 115, ped: 80, rider: 115 }, mid: { car: 170, ped: 140, rider: 170 }, high: { car: 300, ped: 220, rider: 300 },
};

// Тонований матеріал для запаркованих авто (колір рушія змішується з білим, щоб не «бруднити» палітру Kenney).
const tinted = new Map<string, Material | Material[]>();
function tintedMat(m: Baked, key: string, color: number): Material | Material[] {
  const k = key + color;
  let r = tinted.get(k);
  if (!r) {
    const c = new Color(color).lerp(new Color(0xffffff), 0.6);
    const tint = (mt: Material): Material => { const n = mt.clone() as Material & { color?: Color }; n.color?.copy(c); n.userData['shared'] = true; return n; };
    r = Array.isArray(m.mat) ? m.mat.map(tint) : tint(m.mat);
    tinted.set(k, r);
  }
  return r;
}

// Червоний аварійний трикутник на ніжці (стоїть на дорозі).
let triGeo: BufferGeometry | null = null;
const triMat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
function warningTriangle(): Mesh {
  if (!triGeo) {
    const g = new Geo();
    const prism = (r: number, y: number, col: number[], th: number): void => {
      const cyl = new CylinderGeometry(r, r, th, 3);
      cyl.rotateX(Math.PI / 2); // вісь вздовж Z, трикутник стоїть у площині XY
      cyl.rotateZ(Math.PI); // вершина вгору
      g.addGeometry(cyl, T(0, y, 0), col);
    };
    prism(0.42, 0.55, Geo.color(0xd8201a), 0.02);
    prism(0.25, 0.52, Geo.color(0xf6f6f6), 0.03);
    g.addGeometry(box, T(0, 0.05, 0, 0.6, 0.04, 0.04), Geo.color(0x30343a));
    triGeo = g.build();
  }
  const m = new Mesh(triGeo, triMat);
  m.castShadow = false;
  return m;
}

// Модель дивиться в -Z; праворуч +X. Кузов — один Mesh зі спільними геометрією/матеріалом; лампи — тонкі емісійні «коробки» за габаритами моделі.
export class CarObj {
  readonly group = new Group();
  private readonly tail: Mesh[] = [];
  private readonly sigL: Mesh[] = [];
  private readonly sigR: Mesh[] = [];
  private readonly head: Mesh[] = [];
  private readonly dim: Mesh[] = [];
  private poolM: Mesh | null = null;
  private night = false;
  seen = 0;
  private braking = false;
  constructor(m: Baked, len: number, withSig: boolean, tint?: { key: string; color: number }, withTail = true) {
    // Моделі Kenney «пухкі»: довжину беремо з рушія, ширину/висоту трохи стискаємо, щоб авто не виходило за габарит смуги.
    const sz = len / (m.box.max.z - m.box.min.z), sx = m.exact ? sz : sz * 0.8, sy = m.exact ? sz : sz * 0.85;
    const body = new Mesh(m.geo, tint ? tintedMat(m, tint.key, tint.color) : m.mat);
    body.scale.set(sx, sy, sz);
    body.position.y = -m.box.min.y * sy;
    body.castShadow = true; body.receiveShadow = false;
    this.group.add(body);
    const zf = m.box.min.z * sz, zr = m.box.max.z * sz, hw = m.box.max.x * sx;
    for (const k of [-1, 1]) {
      if (withTail) this.tail.push(lamp(tailOn, k * hw * 0.52, 1.0, zr + 0.01, 0.34, 0.14, 0.08));
      if (withSig) {
        const L = k < 0 ? this.sigL : this.sigR;
        L.push(lamp(sigOn, k * hw * 0.62, 0.8, zf - 0.01, 0.26, 0.14, 0.08));
        L.push(lamp(sigOn, k * hw * 0.68, 1.0, zr + 0.01, 0.26, 0.14, 0.08));
      }
    }
    // Ближнє світло й габарити для ночі (вмикаються через setNight).
    if (withTail) for (const k of [-1, 1]) {
      const h = lamp(headOn, k * hw * 0.58, 0.72, zf - 0.01, 0.3, 0.13, 0.06); this.head.push(h);
      const d = lamp(tailDim, k * hw * 0.52, 1.0, zr + 0.015, 0.3, 0.11, 0.06); this.dim.push(d);
    }
    if (withTail) {
      const pm = new Mesh(poolGeo, pool());
      pm.rotation.x = -Math.PI / 2; pm.position.set(0, 0.045, zf - 5.0); pm.renderOrder = 2; pm.visible = false;
      this.poolM = pm; this.group.add(pm);
    }
    for (const l of [...this.tail, ...this.sigL, ...this.sigR, ...this.head, ...this.dim]) this.group.add(l);
  }
  // Ніч: фари й габарити горять (пляма світла — лише якщо showPool).
  setNight(on: boolean, showPool = true): void {
    if (on !== this.night) {
      this.night = on;
      for (const h of this.head) h.visible = on;
      for (const d of this.dim) d.visible = on && !this.braking;
    }
    if (this.poolM) this.poolM.visible = on && showPool;
  }
  // Попереджувальний знак на дорозі позаду авто (локальний +Z — назад).
  addTriangle(back: number): void {
    const t = warningTriangle();
    t.position.set(0, 0.03, back);
    this.group.add(t);
  }
  place(x: number, z: number, a: number, braking: boolean): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = -a;
    if (braking !== this.braking) { this.braking = braking; for (const t of this.tail) t.visible = braking; for (const d of this.dim) d.visible = this.night && !braking; }
  }
  setSig(sig: -1 | 0 | 1, blinkOn: boolean, hazard = false): void {
    for (const l of this.sigL) l.visible = (hazard || sig === -1) && blinkOn;
    for (const l of this.sigR) l.visible = (hazard || sig === 1) && blinkOn;
  }
}

// ---------- Райдери: вело/самокат ----------

const cyl = new CylinderGeometry(0.5, 0.5, 1, 6);
const ball = new SphereGeometry(0.5, 8, 6);
const UP = new Vector3(0, 1, 0);
const tq = new Quaternion(), tm = new Vector3(), td = new Vector3();
// Циліндр-«кістка» між двома точками.
function bar(g: Geo, a: readonly [number, number, number], b: readonly [number, number, number], r: number, col: readonly number[]): void {
  td.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = td.length();
  tq.setFromUnitVectors(UP, td.normalize());
  tm.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  g.addGeometry(cyl, new Matrix4().compose(tm, tq, new Vector3(2 * r, len, 2 * r)), col);
}
const blob = (g: Geo, p: readonly [number, number, number], s: readonly [number, number, number], col: readonly number[]): void =>
  g.addGeometry(ball, T(p[0], p[1], p[2], s[0], s[1], s[2]), col);

const SHIRT = [0xe05a4f, 0x4f8fe0, 0xe0b84f, 0x7a5fd6, 0x3fae7a, 0xd66fa8, 0xf08a3c, 0x2f3a4a];
const HELMET = [0xe8e8e8, 0xd8312b, 0x2f6fd6, 0xf0c020, 0x2a2a2a, 0x3fbf5a];
const FRAME = [0x2a5ccf, 0xc8372d, 0x2a2f36, 0x3a9a6a, 0xe0b020, 0xb8bcc4];
const PANTS = [0x2c3441, 0x4a5568, 0x1f2a44, 0x5b4a3a, 0x30343a];
const SKIN = [0xf0c8a0, 0xe0ae85, 0xc58c63, 0x8d5a3c];

interface RiderGeo { readonly body: BufferGeometry; readonly wheel: BufferGeometry; readonly wr: number; readonly wz: readonly [number, number] }
const riderGeos = new Map<string, RiderGeo>();
const riderMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });

function wheelGeo(r: number): BufferGeometry {
  const g = new Geo();
  const tyre = new TorusGeometry(r - 0.03, 0.03, 5, 14);
  tyre.rotateY(Math.PI / 2); // вісь колеса вздовж X
  g.addGeometry(tyre, new Matrix4(), Geo.color(0x1d1f23));
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    bar(g, [0, Math.cos(a) * (r - 0.04), Math.sin(a) * (r - 0.04)], [0, -Math.cos(a) * (r - 0.04), -Math.sin(a) * (r - 0.04)], 0.008, Geo.color(0xc4c8d0));
  }
  g.addGeometry(cyl, T(0, 0, 0, 0.06, 0.07, 0.06).multiply(new Matrix4().makeRotationZ(Math.PI / 2)), Geo.color(0x888c94));
  return g.build();
}

function buildRiderGeo(kind: Rider['kind'], v: number): RiderGeo {
  const key = kind + v;
  const hit = riderGeos.get(key);
  if (hit) return hit;
  const g = new Geo();
  const h = hash(v * 7 + (kind === 'bike' ? 1 : 2));
  const shirt = Geo.color(pick(SHIRT, h)), pants = Geo.color(pick(PANTS, h >>> 4)), skin = Geo.color(pick(SKIN, h >>> 8));
  const helmet = Geo.color(pick(HELMET, h >>> 12)), frame = Geo.color(pick(FRAME, h >>> 16)), dark = Geo.color(0x23262c);
  let wr: number, wz: readonly [number, number];
  if (kind === 'bike') {
    wr = 0.33; wz = [-0.55, 0.55];
    const R: [number, number, number] = [0, 0.33, 0.55], F: [number, number, number] = [0, 0.33, -0.55];
    const BB: [number, number, number] = [0, 0.3, 0.12], S: [number, number, number] = [0, 0.93, 0.28], H: [number, number, number] = [0, 0.95, -0.38];
    for (const [a, b] of [[BB, R], [R, S], [BB, S], [S, H], [BB, H], [H, F]] as const) bar(g, a, b, 0.022, frame);
    bar(g, H, [0, 1.07, -0.42], 0.02, dark);
    g.addGeometry(box, T(0, 1.07, -0.42, 0.5, 0.03, 0.03), dark); // кермо
    g.addGeometry(box, T(0, 0.96, 0.3, 0.14, 0.04, 0.26), dark); // сідло
    // райдер: тулуб нахилений уперед, руки на кермі, ноги на педалях
    bar(g, [0, 1.0, 0.3], [0, 1.52, -0.02], 0.15, shirt);
    blob(g, [0, 1.74, -0.1], [0.24, 0.26, 0.26], skin);
    blob(g, [0, 1.8, -0.09], [0.31, 0.24, 0.34], helmet);
    for (const k of [-1, 1]) {
      bar(g, [k * 0.19, 1.5, -0.04], [k * 0.22, 1.07, -0.42], 0.045, shirt);
      bar(g, [k * 0.1, 1.0, 0.3], [k * 0.13, 0.74, 0.0], 0.075, pants);
      bar(g, [k * 0.13, 0.74, 0.0], [k * 0.14, 0.32, 0.12], 0.06, pants);
      g.addGeometry(box, T(k * 0.14, 0.28, 0.1, 0.09, 0.05, 0.22), dark);
    }
  } else {
    wr = 0.14; wz = [-0.5, 0.45];
    g.addGeometry(box, T(0, 0.16, -0.02, 0.18, 0.05, 0.9), frame); // дека
    bar(g, [0, 0.16, -0.42], [0, 1.02, -0.52], 0.022, dark); // кермова стійка
    g.addGeometry(box, T(0, 1.02, -0.52, 0.5, 0.03, 0.03), dark);
    bar(g, [0, 0.14, -0.46], [0, 0.14, -0.5], 0.03, dark);
    // райдер стоїть на деці боком-уперед, вага на передній нозі
    bar(g, [0, 0.94, 0.0], [0, 1.5, -0.14], 0.15, shirt);
    blob(g, [0, 1.72, -0.18], [0.24, 0.26, 0.26], skin);
    blob(g, [0, 1.78, -0.17], [0.31, 0.24, 0.34], helmet);
    bar(g, [-0.1, 0.94, 0.0], [-0.1, 0.2, -0.12], 0.075, pants);
    bar(g, [0.1, 0.94, 0.0], [0.1, 0.2, 0.3], 0.075, pants);
    g.addGeometry(box, T(-0.1, 0.2, -0.14, 0.09, 0.05, 0.24), dark);
    g.addGeometry(box, T(0.1, 0.2, 0.3, 0.09, 0.05, 0.24), dark);
    for (const k of [-1, 1]) bar(g, [k * 0.19, 1.46, -0.16], [k * 0.22, 1.03, -0.5], 0.045, shirt);
  }
  const r = { body: g.build(), wheel: wheelGeo(wr), wr, wz };
  riderGeos.set(key, r);
  return r;
}

class RiderObj {
  readonly group = new Group();
  private readonly lean = new Group();
  private readonly wheels: Mesh[];
  private angle = 0;
  seen = 0;
  constructor(private readonly r: Rider) {
    const rg = buildRiderGeo(r.kind, r.id % 6);
    const body = new Mesh(rg.body, riderMat);
    body.castShadow = true;
    this.wheels = rg.wz.map((z) => { const w = new Mesh(rg.wheel, riderMat); w.position.set(0, rg.wr, z); w.castShadow = true; return w; });
    this.wr = rg.wr;
    this.lean.add(body, ...this.wheels);
    this.group.add(this.lean);
  }
  private readonly wr: number;
  place(r: Rider, dt: number, t: number): void {
    this.group.position.set(r.x, 0, r.z);
    this.group.rotation.y = -r.a;
    this.angle -= (r.v * dt) / this.wr; // колесо котиться вперед (−Z): верх рухається в −Z
    for (const w of this.wheels) w.rotation.x = this.angle;
    this.lean.rotation.z = Math.sin(t * 1.7 + this.r.id) * 0.035 * Math.min(1, r.v / 3); // легке виляння
  }
}

// ---------- Пішоходи: інстансинг частин тіла (кілька draw calls на всіх) ----------

const CAP = 220;
const PED_SHIRT = [0xe05a4f, 0x4f8fe0, 0xe0b84f, 0x7a5fd6, 0x3fae7a, 0xd66fa8, 0xf08a3c, 0xeeeeee, 0x2f3a4a, 0x9aa3ad];
const PED_PACK = [0x3b3f4a, 0x7a3f2a, 0x2a4a6a, 0x5a2a5a, 0x2f5a3a];

class Crowd {
  readonly group = new Group();
  private readonly torso: InstancedMesh; private readonly head: InstancedMesh; private readonly pack: InstancedMesh;
  private readonly legL: InstancedMesh; private readonly legR: InstancedMesh; private readonly armL: InstancedMesh; private readonly armR: InstancedMesh;
  private readonly all: InstancedMesh[];
  private readonly slot = new Int32Array(CAP).fill(-1);
  private phase = new Map<number, number>();
  private lastT = 0;
  private readonly m = new Matrix4(); private readonly base = new Matrix4(); private readonly loc = new Matrix4(); private readonly rot = new Matrix4();
  private readonly col = new Color();
  constructor() {
    const mat = new MeshLambertMaterial({ flatShading: true });
    const mk = (g: BufferGeometry): InstancedMesh => {
      const im = new InstancedMesh(g, mat, CAP);
      im.castShadow = true; im.frustumCulled = false; im.count = 0;
      // instanceColor створюється одразу, щоб шейдер не перекомпілювався
      im.setColorAt(0, this.col.setHex(0xffffff));
      this.group.add(im);
      return im;
    };
    const cap = new CapsuleGeometry(0.19, 0.4, 2, 6); cap.translate(0, 1.17, 0);
    const leg = new CylinderGeometry(0.075, 0.065, 0.85, 5); leg.translate(0, -0.425, 0);
    const arm = new CylinderGeometry(0.055, 0.05, 0.62, 5); arm.translate(0, -0.31, 0);
    const hd = new SphereGeometry(0.14, 7, 5); hd.translate(0, 1.69, 0);
    const pk = new BoxGeometry(0.3, 0.4, 0.14); pk.translate(0, 1.2, 0.24);
    this.torso = mk(cap); this.head = mk(hd); this.pack = mk(pk);
    this.legL = mk(leg); this.legR = mk(leg); this.armL = mk(arm); this.armR = mk(arm);
    this.all = [this.torso, this.head, this.pack, this.legL, this.legR, this.armL, this.armR];
  }
  reset(): void { this.phase.clear(); this.slot.fill(-1); this.lastT = 0; for (const im of this.all) im.count = 0; }
  update(sim: Sim, radius: number): void {
    const t = sim.t, dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const p = sim.player, r2 = radius * radius;
    let n = 0;
    const seen = new Map<number, number>();
    for (const pd of sim.peds.list) {
      const dx = pd.x - p.x, dz = pd.z - p.z;
      if (dx * dx + dz * dz > r2 || n >= CAP) continue;
      const h = hash(pd.id);
      const moving = pd.speed > 0.05;
      let ph = this.phase.get(pd.id) ?? (h % 628) / 100;
      ph += pd.speed * dt * 7.5;
      seen.set(pd.id, ph);
      const amp = moving ? Math.min(0.65, 0.25 + pd.speed * 0.25) : 0;
      const sw = Math.sin(ph) * amp;
      const child = h % 11 === 0, sc = child ? 0.7 : 0.93 + ((h >>> 5) % 15) / 100;
      const bob = moving ? Math.abs(Math.cos(ph)) * 0.03 * sc : 0;
      this.base.makeRotationY(-pd.a).setPosition(pd.x, bob, pd.z);
      this.rot.makeScale(sc, sc, sc);
      this.base.multiply(this.rot);
      this.torso.setMatrixAt(n, this.base); this.head.setMatrixAt(n, this.base);
      const packOn = h % 3 !== 0;
      this.pack.setMatrixAt(n, packOn ? this.base : this.m.makeScale(0, 0, 0));
      const lim = (part: InstancedMesh, x: number, y: number, ang: number): void => {
        this.loc.makeRotationX(ang).setPosition(x, y, 0);
        part.setMatrixAt(n, this.m.multiplyMatrices(this.base, this.loc));
      };
      lim(this.legL, -0.1, 0.85, sw); lim(this.legR, 0.1, 0.85, -sw);
      lim(this.armL, -0.26, 1.5, -sw * 0.8); lim(this.armR, 0.26, 1.5, sw * 0.8);
      if (this.slot[n] !== pd.id) {
        this.slot[n] = pd.id;
        const shirt = pick(PED_SHIRT, h >>> 3);
        this.torso.setColorAt(n, this.col.setHex(shirt));
        this.armL.setColorAt(n, this.col); this.armR.setColorAt(n, this.col);
        this.head.setColorAt(n, this.col.setHex(pick(SKIN, h >>> 9)));
        this.pack.setColorAt(n, this.col.setHex(pick(PED_PACK, h >>> 13)));
        const pants = pick(PANTS, h >>> 17);
        this.legL.setColorAt(n, this.col.setHex(pants)); this.legR.setColorAt(n, this.col);
        for (const im of this.all) if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
      n++;
    }
    this.phase = seen;
    for (const im of this.all) { im.count = n; im.instanceMatrix.needsUpdate = true; }
  }
}

// ---------- Менеджер ----------

export class Actors {
  readonly group = new Group();
  quality: Quality;
  private readonly cars = new Map<number, CarObj>();
  private readonly riders = new Map<number, RiderObj>();
  private readonly crowd = new Crowd();
  private frame = 0;
  private lastT = 0;
  private player: CarObj | null = null;
  night = false; // ніч/вечір: усі авто ввімкнули ближнє
  manual = false; // механіка — авто гравця Kia Cerato, автомат — VW ID.4
  private playerKey: 'id4' | 'cerato' = 'id4';
  setPlayerVisible(v: boolean): void { if (this.player) this.player.group.visible = v; }
  constructor(private readonly models: Models, quality: Quality) {
    this.quality = quality;
    this.group.add(this.crowd.group);
  }
  private readonly dropCar = (o: CarObj, id: number): void => {
    if (o.seen === this.frame) return;
    this.group.remove(o.group); this.cars.delete(id);
  };
  private readonly dropRider = (o: RiderObj, id: number): void => {
    if (o.seen === this.frame) return;
    this.group.remove(o.group); this.riders.delete(id);
  };

  reset(): void {
    this.cars.forEach((o) => { this.group.remove(o.group); });
    this.riders.forEach((o) => { this.group.remove(o.group); });
    this.cars.clear(); this.riders.clear();
    this.crowd.reset();
    if (this.player) { this.group.remove(this.player.group); this.player = null; }
  }

  update(sim: Sim): void {
    this.frame++;
    const t = sim.t, dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const blinkOn = Math.floor(t * 3) % 2 === 0; // 1.5 Гц
    const R = DRAW_R[this.quality];
    const { length } = sim.cfg.car;
    const want = this.manual ? 'cerato' : 'id4';
    if (this.player && this.playerKey !== want) { this.group.remove(this.player.group); this.player = null; }
    if (!this.player) { this.playerKey = want; this.player = new CarObj(this.models[want], length, true); this.group.add(this.player.group); }
    const p = sim.player;
    this.player.place(p.x, p.z, p.a, p.braking);
    this.player.setNight(this.night, false); // для гравця світить прожектор сцени
    this.player.setSig(p.sig, Math.floor(p.sigT * 3) % 2 === 0); // фаза від моменту ввімкнення: перше блимання одразу
    for (const c of sim.traffic.cars) {
      let o = this.cars.get(c.id);
      if (!o) {
        const key = TRAFFIC_CARS[c.id % TRAFFIC_CARS.length]!;
        const parked = c.kind === 'parked', broken = c.kind === 'broken';
        o = new CarObj(this.models.cars[key], c.len, !parked, parked ? { key, color: c.color } : undefined, !parked && !broken);
        if (broken) o.addTriangle(15);
        this.cars.set(c.id, o); this.group.add(o.group);
      }
      o.seen = this.frame;
      o.place(c.x, c.z, c.a, c.braking);
      if (c.kind === 'car') o.setNight(this.night);
      const dx = c.x - p.x, dz = c.z - p.z;
      o.group.visible = dx * dx + dz * dz < R.car * R.car;
      if (c.kind !== 'parked') o.setSig(c.turn, blinkOn, c.hazard);
    }
    this.cars.forEach(this.dropCar);
    for (const r of sim.riders.list) {
      let o = this.riders.get(r.id);
      if (!o) { o = new RiderObj(r); this.riders.set(r.id, o); this.group.add(o.group); }
      o.seen = this.frame;
      o.place(r, dt, t);
      const dx = r.x - p.x, dz = r.z - p.z;
      o.group.visible = dx * dx + dz * dz < R.rider * R.rider;
    }
    this.riders.forEach(this.dropRider);
    this.crowd.update(sim, R.ped);
  }
}
