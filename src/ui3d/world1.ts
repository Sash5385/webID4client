// Світ маршруту №1 (мережа OSM): дороги зі смугами, розмітка, перехрестя, кільце, переходи, світлофори, будинки з контурів OSM,
// дерева, ліхтарі, зупинки. Геометрію зливаємо по комірках ~200 м (на низькій/середній показуємо лише найближчі).
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, Points, PointsMaterial, Quaternion, ShapeUtils, Vector2, Vector3, type Material, type Texture,
} from 'three';
import type { NetEdge } from '../engine/net/network';
import type { NetSim } from '../engine/net/sim';
import type { Polyline, Vec2 } from '../engine/geometry';
import type { Light } from '../engine/signals';
import type { AnySim } from '../engine/sim';
import { Geo, ribbon as ribbonRaw, sector, without } from './geo';
import type { Polyline as PL } from '../engine/geometry';
import type { Baked, Models } from './models';
import type { Pbr, PbrSet } from './pbr';
import type { Quality } from './quality';
import { FACADE_COLS, FACADE_FLOORS, FACADE_H, FACADE_W } from './textures';
import { C, facadeMaterial, getWindowsTex, HALF_LINE, mat, mulberry32, textures, TILE, unitBox, unitCyl, Y_ASPH, Y_MARK, Y_SIDE, type World } from './world';

const CELL = 200;
// Довгі сегменти ділимо (≤ 14 м): величезні трикутники, що заходять за камеру, дають збої глибини (асфальт «зникає» поруч із камерою).
function resample(pts: readonly Vec2[], step = 14): Vec2[] {
  const out: Vec2[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!, n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step);
    for (let k = 1; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    out.push(b);
  }
  return out;
}
const ribbon = (g: Geo, pts: readonly Vec2[], halfW: number, y: number, col: readonly number[]): void => ribbonRaw(g, resample(pts), halfW, y, col);
const lineRibbon = (g: Geo, p: PL, d: number, halfW: number, y: number, col: readonly number[]): void => ribbon(g, d === 0 ? p.pts : p.offset(d).pts, halfW, y, col);
const SW = 2.5;               // ширина тротуару
type Layer = 'asph' | 'side' | 'fil' | 'edge' | 'mark' | 'props' | 'glass';
const LAYERS: readonly Layer[] = ['asph', 'side', 'fil', 'edge', 'mark', 'props', 'glass'];
// Радіус показу комірок (м від гравця): узгоджено з туманом/далекою площиною камери.
const SHOW_R: Record<Quality, number> = { low: 125, mid: 205, high: 340 };

// Накопичувач фасадів: позиції, нормалі, UV, колір вершин.
class Fac {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: readonly number[]): void {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(c[0]!, c[1]!, c[2]!);
  }
  get empty(): boolean { return this.pos.length === 0; }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

class Cell {
  readonly geos: Record<Layer, Geo> = { asph: new Geo(), side: new Geo(), fil: new Geo(), edge: new Geo(), mark: new Geo(), props: new Geo(), glass: new Geo() };
  readonly fac = new Fac();
  readonly sq: Matrix4[] = []; readonly cu: Matrix4[] = [];
  readonly trees: { x: number; z: number; s: number; y0: number }[] = [];
  readonly group = new Group();
  constructor(readonly ix: number, readonly iz: number) {}
  // Відстань від точки до рамки комірки.
  dist(x: number, z: number): number {
    const x0 = this.ix * CELL, z0 = this.iz * CELL;
    return Math.hypot(Math.max(x0 - x, 0, x - (x0 + CELL)), Math.max(z0 - z, 0, z - (z0 + CELL)));
  }
}

class Router {
  readonly cells = new Map<number, Cell>();
  at(x: number, z: number): Cell {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL), k = (ix + 512) * 1024 + (iz + 512);
    let c = this.cells.get(k);
    if (!c) { c = new Cell(ix, iz); this.cells.set(k, c); }
    return c;
  }
}

// Geo, що розкладає примітиви по комірках (за центром примітива).
class CGeo extends Geo {
  constructor(private readonly r: Router, private readonly layer: Layer) { super(); }
  private g(x: number, z: number): Geo { return this.r.at(x, z).geos[this.layer]; }
  override quadUp(a: Vec2, b: Vec2, c: Vec2, d: Vec2, y: number, col: readonly number[]): void { this.g((a.x + c.x) / 2, (a.z + c.z) / 2).quadUp(a, b, c, d, y, col); }
  override triUp(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, col: readonly number[]): void {
    this.g((ax + bx + cx) / 3, (az + bz + cz) / 3).triUp(ax, ay, az, bx, by, bz, cx, cy, cz, col);
  }
  override wall(a: Vec2, b: Vec2, y0: number, y1: number, col: readonly number[], flip = false): void { this.g((a.x + b.x) / 2, (a.z + b.z) / 2).wall(a, b, y0, y1, col, flip); }
  override addGeometry(geo: BufferGeometry, m: Matrix4, col: readonly number[]): void { this.g(m.elements[12]!, m.elements[14]!).addGeometry(geo, m, col); }
}

const lampCol = { redOn: new Color(0xff3b30), redOff: new Color(0x4a1612), yelOn: new Color(0xffcc00), yelOff: new Color(0x4a3d08), grnOn: new Color(0x30e060), grnOff: new Color(0x11401e) };

interface Head { readonly idx: number; readonly ped: boolean; readonly ctrl: string; readonly group: 'A' | 'B' | undefined; readonly crossing: string | undefined; state: string }

export function buildWorld1(sim: NetSim, q: Quality, models: Models, pbr: Pbr | null): World {
  const tx = q !== 'low';
  const P = tx ? pbr : null;
  const stdMat = q === 'high' || P !== null;
  const WHITE = Geo.color(0xffffff);
  const K = P
    ? { grass: [0.9, 1.9, 1.2], asph: Geo.color(0xc0c4cc), side: [2.0, 1.95, 1.8] }
    : { grass: tx ? WHITE : C.grass, asph: tx ? WHITE : C.asphalt, side: tx ? WHITE : C.side };
  const T = tx ? textures(!P) : null;
  if (T) T.blob.userData['shared'] = true;
  const net = sim.net, data = sim.data, cfg = sim.cfg;
  const rnd = mulberry32(8042);
  const group = new Group();
  const router = new Router();
  const G = {} as Record<Layer, CGeo>;
  for (const l of LAYERS) G[l] = new CGeo(router, l);
  const { asph, side, fil, edge, mark, props, glass } = G;
  const solidL = cfg.rules.solidBeforeStop;

  // ---------- Допоміжні запити: дорога/будинок у точці ----------
  const ring = net.rings[0]!;
  const bld = data.buildings.map((b) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return { b, x0, z0, x1, z1 };
  });
  const inPoly = (x: number, z: number, pts: readonly (readonly [number, number])[]): boolean => {
    let ins = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]!, b = pts[j]!;
      if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
    }
    return ins;
  };
  const inBuilding = (x: number, z: number, m: number): boolean => {
    for (const q2 of bld) if (x > q2.x0 - m && x < q2.x1 + m && z > q2.z0 - m && z < q2.z1 + m && (m === 0 ? inPoly(x, z, q2.b.pts) : true)) return true;
    return false;
  };
  const junc = data.junctions.map((j) => ({ poly: j.poly, x0: Math.min(...j.poly.map((p) => p[0])), x1: Math.max(...j.poly.map((p) => p[0])), z0: Math.min(...j.poly.map((p) => p[1])), z1: Math.max(...j.poly.map((p) => p[1])) }));
  const connBox = net.connList.map((c) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of c.path.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } return { c, x0: x0 - 4, z0: z0 - 4, x1: x1 + 4, z1: z1 + 4 }; });
  // Чи лежить точка на проїзній частині (ребра окрім skip, зʼєднувачі, перехрестя, кільце) з запасом m.
  const onRoad = (x: number, z: number, m: number, skip?: NetEdge): boolean => {
    const rr = Math.hypot(x - ring.cx, z - ring.cz);
    if (rr < ring.r + ring.laneWidth + m) return true;
    for (const e of net.edgeList) {
      if (e === skip) continue;
      const [x0, z0, x1, z1] = e.bbox;
      if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) continue;
      const p = e.ref.project(x, z);
      if (p.s >= -0.2 && p.s <= e.length + 0.2 && p.d > -m && p.d < e.n * e.W + m) return true;
    }
    for (const cb of connBox) {
      if (x < cb.x0 || x > cb.x1 || z < cb.z0 || z > cb.z1) continue;
      const p = cb.c.path.project(x, z);
      if (p.s >= 0 && p.s <= cb.c.path.length && Math.abs(p.d) < 1.9 + m) return true;
    }
    for (const j of junc) if (x > j.x0 - m && x < j.x1 + m && z > j.z0 - m && z < j.z1 + m && inPoly(x, z, j.poly)) return true;
    return false;
  };
  // Точки, поруч із якими не ставимо дерева/ліхтарі: переходи, стоп-лінії, зупинки, голови світлофорів, знаки.
  const poi: [number, number][] = [];
  for (const c of data.crossings) poi.push([(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2]);
  for (const s of data.stopLines) poi.push([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]);
  for (const b of data.busStops) poi.push([b.x, b.z]);
  for (const h of data.signals) poi.push([h.x, h.z]);
  for (const s of data.signs) poi.push([s.x, s.z]);
  const nearPoi = (x: number, z: number, r: number): boolean => poi.some((p) => Math.abs(p[0] - x) < r && Math.abs(p[1] - z) < r && Math.hypot(p[0] - x, p[1] - z) < r);
  const edgeLat = (e: NetEdge, s: number, d: number): { x: number; z: number; a: number } => net.pose(e, s, d);

  // ---------- Земля ----------
  const ground = new Geo();
  {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const e of net.edgeList) { x0 = Math.min(x0, e.bbox[0]); z0 = Math.min(z0, e.bbox[1]); x1 = Math.max(x1, e.bbox[2]); z1 = Math.max(z1, e.bbox[3]); }
    const M = 600;
    const gx0 = x0 - M, gz0 = z0 - M, nx = Math.ceil((x1 + M - gx0) / 100), nz = Math.ceil((z1 + M - gz0) / 100), sx = (x1 + M - gx0) / nx, sz = (z1 + M - gz0) / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const ax = gx0 + i * sx, az = gz0 + j * sz;
      ground.quadUp({ x: ax, z: az }, { x: ax + sx, z: az }, { x: ax + sx, z: az + sz }, { x: ax, z: az + sz }, 0, K.grass);
    }
  }

  // ---------- Проїзна частина ----------
  const major = (e: NetEdge): boolean => e.kind === 'street' || e.kind === 'arm' || e.kind === 'cross';
  // Дороги з OSM, що закінчуються за кілька метрів до проїзної частини (недотягнуті до магістралі), подовжуємо до її правого краю: без розриву й зі скругленням.
  const ctxRoads = data.context.map((c) => {
    if (c.kind === 'footway' || c.kind === 'path' || c.kind === 'cycleway' || c.kind === 'pedestrian' || c.pts.length < 2) return c;
    const pts = c.pts.map((p) => [p[0], p[1]] as [number, number]);
    for (const end of [0, 1]) {
      const n = pts.length, pe = pts[end === 0 ? 0 : n - 1]!, q = pts[end === 0 ? 1 : n - 2]!;
      let dx = pe[0] - q[0], dz = pe[1] - q[1]; const dl = Math.hypot(dx, dz);
      if (dl < 0.5) continue;
      dx /= dl; dz /= dl;
      let best = 0;
      for (const e of net.edgeList) {
        if (e.kind !== 'street' && e.kind !== 'arm' && e.kind !== 'cross') continue;
        const pr = e.ref.project(pe[0], pe[1]);
        if (pr.s < 2 || pr.s > e.length - 2) continue;
        const w = e.n * e.W, gap = pr.d - w; // відстань за правим краєм
        if (gap < 0.5 || gap > 9) continue;
        const B = net.pose(e, pr.s, w);
        const toward = dx * -Math.cos(B.a) + dz * -Math.sin(B.a); // компонента напряму «до осі» (вісь ліворуч від напряму ребра)
        if (toward < 0.35) continue;
        const ext = gap / toward + 0.6;
        if (ext > 12) continue;
        best = Math.max(best, ext);
      }
      if (best > 0) { const np: [number, number] = [pe[0] + dx * best, pe[1] + dz * best]; if (end === 0) pts.unshift(np); else pts.push(np); }
    }
    return { ...c, pts };
  });
  for (const e of net.edgeList) {
    const w = e.n * e.W;
    lineRibbon(asph, e.ref, w / 2, w / 2 + 0.02, Y_ASPH, K.asph);
    // Щілина між двома проїзними частинами однієї вулиці (осьова): заливає ребро-власник.
    if (e.data.centreOwner && e.data.centreLine !== 'none') { const m = e.data.median; lineRibbon(asph, e.ref, -m, m + 0.02, Y_ASPH, K.asph); }
  }
  // Зʼєднувачі малюємо по згладженій кривій (Катмулл–Ром через ті самі точки): ламана з кроком 1–3 м дає «кутасті» повороти.
  const smooth = (pts: readonly Vec2[], sub = 5): Vec2[] => {
    if (pts.length < 3) return pts.slice();
    const out: Vec2[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
      for (let k = 0; k < sub; k++) {
        const t = k / sub, t2 = t * t, t3 = t2 * t;
        const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
      }
    }
    out.push(pts[pts.length - 1]!);
    return out;
  };
  for (const c of net.connList) ribbon(asph, smooth(c.path.pts), 1.9, Y_ASPH, K.asph);
  for (const j of data.junctions) {
    if (j.kind === 'uturn') continue; // опукла оболонка петлі закрила б сквер: тут вистачає зʼєднувачів
    // Кути оболонки перехрестя скруглюємо (квадратична крива в кожній вершині, радіус до 6 м, не більше 40 % сусідніх сторін).
    const src = j.poly, np = src.length, rp: [number, number][] = [];
    for (let i = 0; i < np; i++) {
      const v = src[i]!, a = src[(i + np - 1) % np]!, b = src[(i + 1) % np]!;
      const la = Math.hypot(a[0] - v[0], a[1] - v[1]), lb = Math.hypot(b[0] - v[0], b[1] - v[1]);
      const t = Math.min(6, 0.4 * la, 0.4 * lb);
      if (t < 0.3 || la < 1e-6 || lb < 1e-6) { rp.push([v[0], v[1]]); continue; }
      const p0: [number, number] = [v[0] + ((a[0] - v[0]) / la) * t, v[1] + ((a[1] - v[1]) / la) * t];
      const p2: [number, number] = [v[0] + ((b[0] - v[0]) / lb) * t, v[1] + ((b[1] - v[1]) / lb) * t];
      for (let k = 0; k <= 6; k++) { const u = k / 6, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u; rp.push([w0 * p0[0] + w1 * v[0] + w2 * p2[0], w0 * p0[1] + w1 * v[1] + w2 * p2[1]]); }
    }
    let cx = 0, cz = 0;
    for (const p of rp) { cx += p[0]; cz += p[1]; }
    cx /= rp.length; cz /= rp.length;
    for (let i = 0; i < rp.length; i++) {
      const a = rp[i]!, b = rp[(i + 1) % rp.length]!;
      asph.triUp(cx, Y_ASPH, cz, a[0], Y_ASPH, a[1], b[0], Y_ASPH, b[1], K.asph);
    }
  }
  // Інші дороги з OSM (двори, вулиці) — асфальт; доріжки — плитка, лише поза проїзною частиною.
  for (const c of ctxRoads) {
    const pts = c.pts.map((p) => ({ x: p[0], z: p[1] }));
    if (pts.length < 2) continue;
    if (c.kind === 'footway' || c.kind === 'path' || c.kind === 'cycleway' || c.kind === 'pedestrian') {
      // Лише ділянки, що не лежать на дорозі.
      const run: Vec2[] = [];
      const flush = (): void => { if (run.length > 1) ribbon(side, run.slice(), 0.9, Y_SIDE, K.side); run.length = 0; };
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!, b = pts[i + 1]!, L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 3));
        for (let k = 0; k <= n; k++) {
          const p = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
          if (onRoad(p.x, p.z, 0.5) || inBuilding(p.x, p.z, 0)) flush(); else run.push(p);
        }
      }
      flush();
    } else ribbon(asph, pts, c.width / 2, Y_ASPH, K.asph);
  }

  // ---------- Скруглення кутів перехресть (радіус бордюру) ----------
  // Де бічна дорога виходить на проїзну частину, її край сходиться з краєм магістралі під гострим кутом. Для кожного такого кута
  // будуємо дугу радіуса CURB_R, дотичну до обох країв, і заливаємо асфальтом клин між кутом і дугою (шар 'fil' — над тротуаром).
  {
    const CURB_R = 5.5, arcSteps = 8;
    const major2 = net.edgeList.filter((e) => e.kind === 'street' || e.kind === 'arm' || e.kind === 'cross');
    const done = new Set<string>();
    const fillet = (Cn: Vec2, u1: Vec2, u2: Vec2): boolean => {
      const th = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.z * u2.z)));
      if (th < 0.35 || th > 2.9) return false;
      const tl = CURB_R / Math.tan(th / 2);
      if (tl > 14) return false;
      const T1 = { x: Cn.x + u1.x * tl, z: Cn.z + u1.z * tl };
      const bx = u1.x + u2.x, bz = u1.z + u2.z, bl = Math.hypot(bx, bz) || 1, od = CURB_R / Math.sin(th / 2);
      const O = { x: Cn.x + (bx / bl) * od, z: Cn.z + (bz / bl) * od };
      const a1 = Math.atan2(T1.z - O.z, T1.x - O.x), a2 = Math.atan2(Cn.z + u2.z * tl - O.z, Cn.x + u2.x * tl - O.x);
      let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const arc: Vec2[] = [];
      for (let i = 0; i <= arcSteps; i++) { const aa = a1 + (da * i) / arcSteps; arc.push({ x: O.x + Math.cos(aa) * CURB_R, z: O.z + Math.sin(aa) * CURB_R }); }
      for (let i = 0; i < arc.length - 1; i++) fil.triUp(Cn.x, Y_ASPH, Cn.z, arc[i]!.x, Y_ASPH, arc[i]!.z, arc[i + 1]!.x, Y_ASPH, arc[i + 1]!.z, K.asph);
      ribbon(mark, arc, 0.13, Y_MARK, C.curb);
      return true;
    };
    // P0 — точка на краю бічної дороги; d — одиничний напрям «до магістралі»; out — зовнішня нормаль (у бік трави); self — ребро цієї ж дороги.
    const corner = (P0: Vec2, d: Vec2, out: Vec2, self: NetEdge | null): void => {
      for (const e of major2) {
        if (e === self) continue;
        const w = e.n * e.W;
        const b = e.ref.project(P0.x, P0.z);
        if (b.s < 2 || b.s > e.length - 2 || b.d - w < -0.3 || b.d - w > 18) continue; // точка ззовні правого краю, не далі 18 м
        let B = net.pose(e, b.s, w), Cn = { x: 0, z: 0 }, ok = false;
        for (let it = 0; it < 3; it++) {
          const tx = Math.sin(B.a), tz = -Math.cos(B.a), ni = { x: tz, z: -tx };
          const dn = d.x * ni.x + d.z * ni.z;
          if (dn < 0.35) { ok = false; break; }
          const t = -((P0.x - B.x) * ni.x + (P0.z - B.z) * ni.z) / dn;
          Cn = { x: P0.x + t * d.x, z: P0.z + t * d.z };
          const pr = e.ref.project(Cn.x, Cn.z);
          if (pr.s < 2 || pr.s > e.length - 2) { ok = false; break; }
          B = net.pose(e, pr.s, w); ok = true;
        }
        if (!ok) continue;
        const key = `${Math.round(Cn.x * 2)},${Math.round(Cn.z * 2)}`;
        if (done.has(key)) continue;
        const tx = Math.sin(B.a), tz = -Math.cos(B.a);
        const sgn = out.x * tx + out.z * tz >= 0 ? 1 : -1;
        if (!fillet(Cn, { x: -d.x, z: -d.z }, { x: sgn * tx, z: sgn * tz })) continue;
        done.add(key);
      }
    };
    // 0) Перетин правих країв двох магістральних ребер (хрестові перехрестя): чотири кути, по одному на пару країв.
    {
      const bnd = major2.map((e) => ({ e, pts: e.ref.offset(e.n * e.W).pts, bb: e.bbox }));
      const rightOf = (h: Vec2): Vec2 => ({ x: -h.z, z: h.x });
      for (let i = 0; i < bnd.length; i++) for (let j = i + 1; j < bnd.length; j++) {
        const A = bnd[i]!, B = bnd[j]!;
        if (A.bb[0] > B.bb[2] + 2 || B.bb[0] > A.bb[2] + 2 || A.bb[1] > B.bb[3] + 2 || B.bb[1] > A.bb[3] + 2) continue;
        for (let m = 0; m < A.pts.length - 1; m++) {
          const a0 = A.pts[m]!, a1 = A.pts[m + 1]!;
          const ax = Math.min(a0.x, a1.x) - 1, ay = Math.max(a0.x, a1.x) + 1, az = Math.min(a0.z, a1.z) - 1, aw = Math.max(a0.z, a1.z) + 1;
          for (let n2 = 0; n2 < B.pts.length - 1; n2++) {
            const b0 = B.pts[n2]!, b1 = B.pts[n2 + 1]!;
            if (Math.max(b0.x, b1.x) < ax || Math.min(b0.x, b1.x) > ay || Math.max(b0.z, b1.z) < az || Math.min(b0.z, b1.z) > aw) continue;
            const rx = a1.x - a0.x, rz = a1.z - a0.z, sx = b1.x - b0.x, sz = b1.z - b0.z, den = rx * sz - rz * sx;
            if (Math.abs(den) < 1e-6) continue;
            const t = ((b0.x - a0.x) * sz - (b0.z - a0.z) * sx) / den, u = ((b0.x - a0.x) * rz - (b0.z - a0.z) * rx) / den;
            if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) continue;
            const Cn = { x: a0.x + rx * t, z: a0.z + rz * t };
            const key = `${Math.round(Cn.x * 2)},${Math.round(Cn.z * 2)}`;
            if (done.has(key)) continue;
            const l1 = Math.hypot(rx, rz) || 1, l2 = Math.hypot(sx, sz) || 1;
            const h1 = { x: rx / l1, z: rz / l1 }, h2 = { x: sx / l2, z: sz / l2 };
            const r1 = rightOf(h1), r2 = rightOf(h2);
            const s1 = h1.x * r2.x + h1.z * r2.z >= 0 ? 1 : -1, s2 = h2.x * r1.x + h2.z * r1.z >= 0 ? 1 : -1;
            if (fillet(Cn, { x: s1 * h1.x, z: s1 * h1.z }, { x: s2 * h2.x, z: s2 * h2.z })) done.add(key);
          }
        }
      }
    }
    // 1) Дороги-контекст з OSM (двори, вулиці): обидва кінці, обидва краї.
    for (const rd of ctxRoads) {
      if (rd.kind === 'footway' || rd.kind === 'path' || rd.kind === 'cycleway' || rd.kind === 'pedestrian' || rd.width < 3 || rd.pts.length < 2) continue;
      const n = rd.pts.length, hw = rd.width / 2;
      for (const end of [0, 1]) {
        const pe = rd.pts[end === 0 ? 0 : n - 1]!;
        let qi = end === 0 ? 1 : n - 2, q = rd.pts[qi]!, acc = Math.hypot(pe[0] - q[0], pe[1] - q[1]);
        while (acc < 4 && qi + (end === 0 ? 1 : -1) >= 0 && qi + (end === 0 ? 1 : -1) < n) { const nx = rd.pts[qi + (end === 0 ? 1 : -1)]!; acc += Math.hypot(nx[0] - q[0], nx[1] - q[1]); q = nx; qi += end === 0 ? 1 : -1; }
        let dx = pe[0] - q[0], dz = pe[1] - q[1]; const dl = Math.hypot(dx, dz);
        if (dl < 1) continue;
        dx /= dl; dz /= dl;
        for (const k of [-1, 1]) corner({ x: pe[0] + k * hw * -dz, z: pe[1] + k * hw * dx }, { x: dx, z: dz }, { x: k * -dz, z: k * dx }, null);
      }
    }
    // 2) Ребра мережі, що підходять до іншого ребра (бічні вулиці, виїзди): правий край на початку й наприкінці.
    for (const e of net.edgeList) {
      if (e.kind !== 'cross' && e.kind !== 'side' && e.kind !== 'driveway' && e.kind !== 'arm') continue;
      const w = e.n * e.W;
      const pa = net.pose(e, 0.5, w), pb = net.pose(e, e.length - 0.5, w);
      const ta = { x: Math.sin(pa.a), z: -Math.cos(pa.a) }, tb = { x: Math.sin(pb.a), z: -Math.cos(pb.a) };
      corner(pb, tb, { x: -tb.z, z: tb.x }, e);                                         // кінець ребра: рухаємось до магістралі
      corner(pa, { x: -ta.x, z: -ta.z }, { x: -ta.z, z: ta.x }, e);                    // початок ребра: «до магістралі» — назад
    }
  }

  // ---------- Тротуари і бордюри вздовж вулиць ----------
  const curbCol = C.curb;
  for (const e of net.edgeList) {
    if (!major(e)) continue;
    for (const sign of [1, -1] as const) {
      const dIn = sign > 0 ? e.n * e.W : 0, dOut = sign > 0 ? e.n * e.W + SW : -SW;
      const oi = e.ref.offset(dIn), oo = e.ref.offset(dOut);
      const step = 2.5, n = Math.max(1, Math.ceil(e.length / step));
      let prev: { i: Vec2; o: Vec2 } | null = null;
      for (let k = 0; k <= n; k++) {
        const s = (e.length * k) / n;
        const pi = oi.pose(s), po = oo.pose(s);
        const mx = (pi.x + po.x) / 2, mz = (pi.z + po.z) / 2;
        const free = !onRoad(mx, mz, 0.3, e) && !onRoad(pi.x + (po.x - pi.x) * 0.15, pi.z + (po.z - pi.z) * 0.15, 0.1, e) && !onRoad(po.x, po.z, 0, e) && !inBuilding(mx, mz, 0) && !inBuilding(po.x, po.z, 0);
        const cur = free ? { i: { x: pi.x, z: pi.z }, o: { x: po.x, z: po.z } } : null;
        if (prev && cur) {
          side.quadUp(prev.i, prev.o, cur.o, cur.i, Y_SIDE, K.side);
          edge.wall(prev.i, cur.i, Y_ASPH, Y_SIDE, curbCol, sign > 0);
        }
        prev = cur;
      }
    }
  }

  // ---------- Розмітка ----------
  const solidZones = (e: NetEdge): [number, number][] =>
    e.features.filter((f) => f.kind === 'signal' || f.kind === 'crossing' || f.kind === 'yield').map((f) => [Math.max(0, f.stop - solidL), Math.min(e.length, f.zone[1])] as [number, number]);
  const quadAlong = (a: Vec2, b: Vec2, th: number, y: number, col: readonly number[], g: Geo = mark): void => { // смуга a→b завтовшки th (поперек a→b)
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = (-(b.z - a.z) / L) * th / 2, nz = ((b.x - a.x) / L) * th / 2;
    g.quadUp({ x: a.x - nx, z: a.z - nz }, { x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, y, col);
  };
  // Шляхи розворотів і лівих поворотів (вони перетинають осьову): навколо них осьова — пунктир.
  const turnPaths = data.connectors.filter((c) => c.turn === 'uturn' || c.turn === 'left').map((c) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of c.path) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return { pts: c.path, x0: x0 - 2, x1: x1 + 2, z0: z0 - 2, z1: z1 + 2 };
  });
  const segDist2 = (px: number, pz: number, a: readonly [number, number], b: readonly [number, number]): number => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2)) : 0;
    const x = a[0] + dx * t - px, z = a[1] + dz * t - pz;
    return x * x + z * z;
  };
  const centreGaps = (e: NetEdge, m: number): [number, number][] => {
    const hit: boolean[] = [];
    const n = Math.max(2, Math.ceil(e.length));
    for (let i = 0; i <= n; i++) {
      const p = net.pose(e, Math.min(e.length, (i * e.length) / n), -m);
      let h = false;
      for (const t of turnPaths) {
        if (p.x < t.x0 || p.x > t.x1 || p.z < t.z0 || p.z > t.z1) continue;
        for (let k = 0; k < t.pts.length - 1 && !h; k++) if (segDist2(p.x, p.z, t.pts[k]!, t.pts[k + 1]!) < 1.7 * 1.7) h = true;
        if (h) break;
      }
      hit.push(h);
    }
    // розширюємо на 5 м в обидва боки й зливаємо в інтервали
    const out: [number, number][] = [];
    let a = -1;
    for (let i = 0; i <= n; i++) {
      const on = hit.slice(Math.max(0, i - 5), i + 6).some(Boolean);
      if (on && a < 0) a = i;
      if ((!on || i === n) && a >= 0) { out.push([Math.max(0, (a * e.length) / n), Math.min(e.length, ((on ? i : i - 1) * e.length) / n)]); a = -1; }
    }
    return out.filter(([x, y]) => y - x > 1);
  };
  for (const e of net.edgeList) {
    if (!major(e)) continue;
    const sz = solidZones(e);
    // Осьова: подвійна / одинарна суцільна по ref.offset(−median).
    if (e.data.centreOwner && e.data.centreLine !== 'none') {
      const m = e.data.median;
      // Там, де осьову перетинають розвороти й ліві повороти (виїзди з бічних вулиць), суцільної лінії бути не повинно — лише пунктир.
      const dz = centreGaps(e, m);
      const solid = without(e.length, dz);
      for (const [a, b] of solid) {
        const seg = e.ref.slice(a, b);
        if (e.data.centreLine === 'double') { for (const k of [-1, 1]) lineRibbon(mark, seg, -m + k * m * 0.5, HALF_LINE, Y_MARK, C.mark); } else lineRibbon(mark, seg, -m, HALF_LINE, Y_MARK, C.mark);
      }
      for (const [a, b] of dz) for (let t = a; t + 3 <= b + 0.01; t += 6) lineRibbon(mark, e.ref.slice(t, Math.min(b, t + 3)), -m, HALF_LINE, Y_MARK, C.mark);
    }
    // Розподіл смуг: пунктир, перед стоп-лініями/переходами — суцільна.
    for (let i = 1; i < e.n; i++) {
      const d = i * e.W;
      for (let s = 3; s + 3 < e.length; s += 9) {
        if (sz.some(([a, b]) => s + 3 > a - 0.5 && s < b + 0.5)) continue;
        const a = edgeLat(e, s, d), b = edgeLat(e, s + 3, d);
        quadAlong(a, b, 2 * HALF_LINE, Y_MARK, C.mark);
      }
      for (const [a, b] of sz) if (b - a > 0.5) lineRibbon(mark, e.ref.slice(a, b), d, HALF_LINE, Y_MARK, C.mark);
    }
    // Крайова права: суцільна, з розривами біля зʼїздів/вʼїздів бічних вулиць.
    const ex: [number, number][] = [];
    for (const c of e.departures) ex.push([c.fromS - 3, c.fromS + 7]);
    for (const c of e.arrivals) ex.push([c.toS - 7, c.toS + 3]);
    if (e.ringEntry) ex.push([e.length - 14, e.length]);
    if (e.ringExit) ex.push([0, 14]);
    for (const [a, b] of without(e.length, ex)) lineRibbon(mark, e.ref.slice(a, b), e.n * e.W - 0.2, HALF_LINE, Y_MARK, C.mark);
  }
  // Стоп-лінії (сигнал — суцільна; «дати дорогу» — переривчаста).
  for (const sl of data.stopLines) {
    if (sl.kind === 'crossing') continue;
    const a = { x: sl.a[0], z: sl.a[1] }, b = { x: sl.b[0], z: sl.b[1] };
    if (sl.kind === 'signal') { quadAlong(a, b, 0.4, Y_MARK, C.mark); continue; }
    const L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    for (let t = 0; t < L - 0.2; t += 0.9) {
      const t1 = Math.min(t + 0.5, L);
      quadAlong({ x: a.x + ux * t, z: a.z + uz * t }, { x: a.x + ux * t1, z: a.z + uz * t1 }, 0.4, Y_MARK, C.mark);
    }
  }
  // Переходи (зебра): смуги поперек напрямку руху, лише на проїзній частині.
  for (const c of data.crossings) {
    const L = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]), ux = (c.b[0] - c.a[0]) / L, uz = (c.b[1] - c.a[1]) / L;
    const hw = c.width / 2 - 0.15;
    for (const sp of c.spans) {
      for (let t = sp.u0 + 0.35; t + 0.55 <= sp.u1 - 0.2; t += 1.1) {
        const p0 = { x: c.a[0] + ux * t, z: c.a[1] + uz * t }, p1 = { x: c.a[0] + ux * (t + 0.55), z: c.a[1] + uz * (t + 0.55) };
        mark.quadUp({ x: p0.x - uz * hw, z: p0.z + ux * hw }, { x: p0.x + uz * hw, z: p0.z - ux * hw }, { x: p1.x + uz * hw, z: p1.z - ux * hw }, { x: p1.x - uz * hw, z: p1.z + ux * hw }, Y_MARK, C.mark);
      }
    }
  }

  // ---------- Кільце ----------
  const TAU = Math.PI * 2;
  {
    const { cx, cz, r, laneWidth: rw } = ring;
    sector(asph, cx, cz, r - rw, r + rw, 0, TAU, Y_ASPH, K.asph);
    const isl = r - rw - 0.3;
    sector(asph, cx, cz, 0, isl, 0, TAU, Y_ASPH, K.asph, 0.3);
    sector(edge, cx, cz, 0, isl, 0, TAU, Y_SIDE + 0.02, C.island, 0.25);
    sector(edge, cx, cz, isl - 0.35, isl, 0, TAU, Y_SIDE + 0.04, C.curb, 0.2);
    for (let i = 0; i < 48; i++) {
      const t0 = (i / 48) * TAU, t1 = ((i + 1) / 48) * TAU;
      edge.wall({ x: cx + isl * Math.cos(t0), z: cz - isl * Math.sin(t0) }, { x: cx + isl * Math.cos(t1), z: cz - isl * Math.sin(t1) }, Y_ASPH, Y_SIDE + 0.04, C.curb);
    }
    props.addGeometry(unitCyl, mat(cx, Y_SIDE + 0.5, cz, 0, 3.2, 1.0, 3.2), C.stone);
    props.addGeometry(unitBox, mat(cx, Y_SIDE + 2.2, cz, 0.4, 1.2, 2.2, 1.2), C.stone);
    for (const t of [[7, 4, 1.4], [-6, -7, 1.2], [4, -9, 1.0], [-10, 6, 1.1], [11, -3, 1.2]] as const) router.at(cx + t[0], cz + t[1]).trees.push({ x: cx + t[0], z: cz + t[1], s: t[2], y0: Y_SIDE });
    // Лінії: внутрішня суцільна, розділова пунктиром, зовнішня з розривами біля рукавів.
    sector(mark, cx, cz, r - rw + 0.15, r - rw + 0.15 + 2 * HALF_LINE, 0, TAU, Y_MARK, C.mark);
    const gaps: [number, number][] = ring.arms.map((a) => [Math.min(a.theta[0], a.theta[1]) - 0.2, Math.max(a.theta[0], a.theta[1]) + 0.2]);
    const norm: [number, number][] = [];
    for (const [a, b] of gaps) { const a0 = ((a % TAU) + TAU) % TAU; norm.push([a0, a0 + (b - a)]); if (a0 + (b - a) > TAU) norm.push([a0 - TAU, a0 + (b - a) - TAU]); }
    for (const [a, b] of without(TAU, norm)) sector(mark, cx, cz, r + rw - 0.15 - 2 * HALF_LINE, r + rw - 0.15, a, b, Y_MARK, C.mark);
    for (let t = 0; t < TAU - 0.01; t += 5 / r) sector(mark, cx, cz, r - HALF_LINE, r + HALF_LINE, t, t + 2 / r, Y_MARK, C.mark, 0.1);
  }

  // ---------- Знаки, світлофори, зупинки ----------
  const instanced = (b: Baked, ms: Matrix4[], into: Group): void => {
    if (!ms.length) return;
    const im = new InstancedMesh(b.geo, b.mat, ms.length);
    ms.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true; im.receiveShadow = false; im.instanceMatrix.needsUpdate = true;
    into.add(im);
  };
  for (const s of data.signs) {
    props.addGeometry(unitCyl, mat(s.x, 1.25, s.z, 0, 0.08, 2.5, 0.08), C.pole);
    const fx = -Math.sin(s.a) * 0.08, fz = Math.cos(s.a) * 0.08; // до водія
    if (s.kind === 'giveWay') {
      const rot = new Matrix4().makeRotationX(Math.PI / 2), base = new Matrix4().makeTranslation(s.x + fx, 2.7, s.z + fz).multiply(new Matrix4().makeRotationY(-s.a + Math.PI));
      for (const [rad, zo, col] of [[0.62, 0.0, C.red], [0.4, 0.035, C.white]] as const) props.addGeometry(new CylinderGeometry(rad, rad, 0.05, 3), base.clone().multiply(new Matrix4().makeTranslation(0, 0, zo)).multiply(rot), col);
    } else if (s.kind === 'roundabout') {
      const rot = new Matrix4().makeRotationX(Math.PI / 2), base = new Matrix4().makeTranslation(s.x + fx, 2.7, s.z + fz).multiply(new Matrix4().makeRotationY(-s.a + Math.PI));
      props.addGeometry(new CylinderGeometry(0.42, 0.42, 0.05, 14), base.clone().multiply(rot), Geo.color(0x1f5fbf));
      props.addGeometry(new CylinderGeometry(0.2, 0.2, 0.06, 10), base.clone().multiply(new Matrix4().makeTranslation(0, 0, 0.02)).multiply(rot), C.white);
    } else {
      props.addGeometry(unitBox, mat(s.x + fx, 2.7, s.z + fz, -s.a, 0.7, 0.7, 0.05), Geo.color(0x1f5fbf));
      props.addGeometry(unitBox, mat(s.x + fx * 1.8, 2.7, s.z + fz * 1.8, -s.a, 0.34, 0.5, 0.04), C.white);
    }
  }

  // Світлофори: стійка + корпус у props, лампи — один InstancedMesh з кольором на екземпляр.
  const heads: Head[] = [];
  const lampMats: Matrix4[] = [];
  for (const h of data.signals) {
    const ped = h.kind === 'ped', hy = ped ? 2.9 : 3.9, hh = ped ? 0.95 : 1.3;
    props.addGeometry(unitCyl, mat(h.x, hy / 2 - 0.1, h.z, 0, 0.14, hy - 0.2, 0.14), C.pole);
    props.addGeometry(unitBox, mat(h.x, hy, h.z, -h.a, 0.5, hh, 0.3), C.head);
    props.addGeometry(unitBox, mat(h.x, hy, h.z, -h.a, 0.62, hh + 0.12, 0.12), C.head);
    const idx = lampMats.length / 3;
    for (let k = 0; k < 3; k++) {
      const ly = hy + 0.45 - k * (ped ? 0.4 : 0.45);
      lampMats.push(new Matrix4().compose(new Vector3(h.x - Math.sin(h.a) * 0.2, ly, h.z + Math.cos(h.a) * 0.2), quatY(-h.a), new Vector3(1, 1, 1)));
    }
    heads.push({ idx, ped, ctrl: h.ctrl, group: h.group, crossing: h.crossing, state: '' });
  }
  let lamps: InstancedMesh | null = null;
  if (lampMats.length) {
    lamps = new InstancedMesh(new CircleGeometry(0.15, 10), new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lampMats.length);
    lampMats.forEach((m, i) => { lamps!.setMatrixAt(i, m); lamps!.setColorAt(i, lampCol.redOff); });
    lamps.instanceMatrix.needsUpdate = true; lamps.frustumCulled = false;
    group.add(lamps);
  }

  // Зупинки: павільйон відкритий до дороги, на тротуарі.
  {
    const metal = Geo.color(0x3b6fa0), wood = Geo.color(0x9a6a3c), dk = Geo.color(0x30343a);
    for (const bs of data.busStops) {
      const e = net.edge(bs.edge), pr = e.ref.project(bs.x, bs.z), w = e.n * e.W;
      const sgn = pr.d > w / 2 ? 1 : -1; // бік тротуару відносно осі ребра
      const dd = sgn > 0 ? Math.min(w + 2.6, Math.max(pr.d, w + 1.9)) : Math.max(-2.6, Math.min(pr.d, -1.9));
      const cc = net.pose(e, pr.s, dd);
      // Локальна рамка: +X — «назад» (від дороги), +Z — вздовж дороги.
      const bx = Math.cos(cc.a) * sgn, bz = Math.sin(cc.a) * sgn;
      const M = new Matrix4().makeTranslation(cc.x, Y_SIDE, cc.z).multiply(new Matrix4().makeRotationY(Math.atan2(-bz, bx)));
      const box = (g: Geo, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, col: readonly number[]): void => {
        g.addGeometry(unitBox, M.clone().multiply(new Matrix4().makeTranslation(lx, ly, lz)).multiply(new Matrix4().makeScale(sx, sy, sz)), col);
      };
      box(props, 0.2, 2.55, 0, 1.9, 0.09, 3.4, metal);
      for (const dz of [-1.55, 1.55]) { box(props, 0.95, 1.25, dz, 0.08, 2.5, 0.08, dk); box(props, -0.85, 1.25, dz, 0.08, 2.5, 0.08, dk); }
      box(props, 0.4, 0.5, 0, 0.4, 0.07, 2.4, wood); box(props, 0.55, 0.78, 0, 0.06, 0.45, 2.4, wood);
      box(glass, 0.95, 1.3, 0, 0.03, 2.2, 3.0, WHITE);
      box(glass, 0.1, 1.3, -1.55, 1.7, 2.2, 0.03, WHITE); box(glass, 0.1, 1.3, 1.55, 1.7, 2.2, 0.03, WHITE);
    }
  }

  // ---------- Старт і фініш ----------
  {
    const st = data.route.start, se = net.edge(st.edge), w = se.n * se.W;
    const o = (e: NetEdge, s: number, lat: number, lon: number): Vec2 => { const p = net.pose(e, s, lat); return { x: p.x + Math.sin(p.a) * lon, z: p.z - Math.cos(p.a) * lon }; };
    mark.quadUp(o(se, st.s, 0.1, -0.3), o(se, st.s, w - 0.1, -0.3), o(se, st.s, w - 0.1, 0.3), o(se, st.s, 0.1, 0.3), Y_MARK + 0.005, C.green);
    const fin = data.route.steps.find((q2) => q2.kind === 'finish');
    if (fin && fin.kind === 'finish') {
      const fe = net.edge(fin.edge), fw = fe.n * fe.W;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
        const l0 = 0.1 + (i * (fw - 0.2)) / 8, l1 = l0 + (fw - 0.2) / 8, o0 = -0.6 + j * 0.6;
        mark.quadUp(o(fe, fin.s, l0, o0), o(fe, fin.s, l1, o0), o(fe, fin.s, l1, o0 + 0.6), o(fe, fin.s, l0, o0 + 0.6), Y_MARK + 0.005, (i + j) % 2 ? C.black : C.white);
      }
      const p = net.pose(fe, fin.s, fw / 2);
      for (const sg of [-1, 1]) props.addGeometry(unitBox, mat(p.x + Math.cos(p.a) * sg * (fw / 2 + 0.5), 2, p.z + Math.sin(p.a) * sg * (fw / 2 + 0.5), 0, 0.2, 4, 0.2), C.pole);
      props.addGeometry(unitBox, mat(p.x, 4.1, p.z, -p.a, fw + 1.2, 0.5, 0.15), C.red);
    }
  }

  // ---------- Ліхтарі та дерева вздовж вулиць ----------
  const lampPts: [number, number][] = [];
  {
    const lampH = 7.5, lampXZ = 7;
    let li = 0;
    for (const e of net.edgeList) {
      if (!major(e)) continue;
      const lat = e.n * e.W + SW - 0.5;
      // Ліхтарі: правий бік, де є тротуар.
      for (let s = 14 + (li % 5) * 3; s < e.length - 8; s += 34, li++) {
        const p = e.ref.pose(s), x = p.x + Math.cos(p.a) * lat, z = p.z + Math.sin(p.a) * lat;
        if (onRoad(x, z, 0.8, e) || inBuilding(x, z, 0) || nearPoi(x, z, 8)) continue;
        const sy = lampH / (li % 2 ? models.props.lightCurved.box.max.y : models.props.lightSquare.box.max.y);
        (li % 2 ? router.at(x, z).cu : router.at(x, z).sq).push(mat(x, Y_SIDE, z, Math.PI / 2 - p.a, lampXZ, sy, lampXZ));
        lampPts.push([x - Math.cos(p.a) * 0.9, z - Math.sin(p.a) * 0.9]); // плями світла — трохи в бік дороги
      }
      // Дерева: праворуч за тротуаром і ліворуч (в «острівці» між проїзними частинами), де вільно.
      for (const sign of [1, -1] as const) {
        const dT = sign > 0 ? e.n * e.W + SW + 1.9 : -(SW + 1.9);
        for (let s = 6 + rnd() * 10; s < e.length - 4; s += 11 + rnd() * 14) {
          const p = net.pose(e, s, dT);
          if (onRoad(p.x, p.z, 2.6, e) || inBuilding(p.x, p.z, 2.2) || nearPoi(p.x, p.z, 6)) continue;
          router.at(p.x, p.z).trees.push({ x: p.x, z: p.z, s: 0.8 + rnd() * 0.6, y0: 0 });
        }
      }
    }
  }

  // ---------- Будинки з контурів OSM ----------
  const fm = (): Material => (stdMat ? new MeshStandardMaterial({ roughness: 0.9, vertexColors: true, ...(T ? { map: T.facade } : {}) }) : new MeshLambertMaterial({ vertexColors: true, flatShading: true, ...(T ? { map: T.facade } : {}) }));
  {
    const pal = [0xe8d9c5, 0xd9e2ec, 0xf0c9a8, 0xc9d8c5, 0xe9e0a8, 0xd4c1d9, 0xbfd3e0, 0xf2e1d0].map((h) => new Color(h));
    const roofCol = Geo.color(0x8b8f98);
    for (const { b } of bld) {
      let pts = b.pts.map((p) => ({ x: p[0], z: p[1] }));
      if (pts.length > 1 && Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.z - pts[pts.length - 1]!.z) < 0.01) pts = pts.slice(0, -1);
      if (pts.length < 3) continue;
      const h = Math.max(2.6, b.height);
      let area = 0, cx = 0, cz = 0;
      for (let i = 0; i < pts.length; i++) { const a = pts[i]!, c = pts[(i + 1) % pts.length]!; area += a.x * c.z - c.x * a.z; cx += a.x; cz += a.z; }
      area /= 2; cx /= pts.length; cz /= pts.length;
      const cell = router.at(cx, cz);
      const col = pal[Math.floor(rnd() * pal.length)]!.clone();
      const apt = b.kind === 'apartments' || h > 12;
      if (apt) { if (P) { col.lerp(new Color(0xffffff), 0.35); col.r *= 1.7; col.g *= 1.7; col.b *= 2.1; } } else { col.lerp(new Color(0xffffff), 0.25); if (P) { col.r *= 1.6; col.g *= 1.6; col.b *= 1.9; } }
      const cl = [col.r, col.g, col.b];
      const floors = Math.max(2, Math.round(h / FACADE_H));
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!, c = pts[(i + 1) % pts.length]!;
        const dx = c.x - a.x, dz = c.z - a.z, L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const sg = area > 0 ? 1 : -1;
        const nx = (dz / L) * sg, nz = (-dx / L) * sg; // назовні
        // Стіну ділимо на шматки ≤ 10 м (колонки фасаду рахуємо по всій стіні, щоб ритм вікон не рвався).
        const cols = Math.max(1, Math.round(L / FACADE_W)), v1 = floors / FACADE_FLOORS, nP = Math.max(1, Math.ceil(L / 10));
        for (let k = 0; k < nP; k++) {
          const t0 = k / nP, t1 = (k + 1) / nP, x0 = a.x + dx * t0, z0 = a.z + dz * t0, x1 = a.x + dx * t1, z1 = a.z + dz * t1, u0 = (cols * t0) / FACADE_COLS, u1 = (cols * t1) / FACADE_COLS;
          const A = [x0, 0, z0, u0, 0], B = [x1, 0, z1, u1, 0], Cc = [x1, h, z1, u1, v1], D = [x0, h, z0, u0, v1];
          const order = sg < 0 ? [A, B, Cc, A, Cc, D] : [A, Cc, B, A, D, Cc];
          for (const v of order) cell.fac.vert(v[0]!, v[1]!, v[2]!, nx, 0, nz, v[3]!, v[4]!, cl);
        }
      }
      // Дах: плоский, триангуляція контуру.
      const tri = ShapeUtils.triangulateShape(pts.map((p) => new Vector2(p.x, p.z)), []);
      for (const t of tri) props.triUp(pts[t[0]!]!.x, h + 0.02, pts[t[0]!]!.z, pts[t[1]!]!.x, h + 0.02, pts[t[1]!]!.z, pts[t[2]!]!.x, h + 0.02, pts[t[2]!]!.z, roofCol);
    }
  }

  // ---------- Збірка мешів ----------
  const surf = (p: PbrSet | undefined, legacy: Texture | undefined): { map: Texture; rough: Texture | null; normal: Texture | null } | null => (p ? p : legacy ? { map: legacy, rough: null, normal: null } : null);
  const base = (po: number, sf: ReturnType<typeof surf>, transparent = false): Material => {
    const o = { vertexColors: true, flatShading: true, side: DoubleSide, ...(sf ? { map: sf.map } : {}), polygonOffset: po !== 0, polygonOffsetFactor: po, polygonOffsetUnits: po };
    if (transparent) return new MeshLambertMaterial({ color: 0x9fd4ea, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide });
    if (!stdMat) return new MeshLambertMaterial(o);
    return new MeshStandardMaterial({
      ...o, roughness: sf?.rough ? 1 : 0.92, ...(sf?.rough ? { roughnessMap: sf.rough } : {}),
      ...(q === 'high' && sf?.normal ? { normalMap: sf.normal, normalScale: new Vector2(0.9, 0.9) } : {}),
    });
  };
  const grassSurf = surf(P?.grass, T?.grass), asphSurf = surf(P?.asphalt, T?.asph), sideSurf = surf(P?.paving, T?.paving);
  const mats: Record<Layer, Material> = {
    asph: base(-1, asphSurf), side: base(-2, sideSurf), fil: base(-3, asphSurf), edge: base(-2, null), mark: base(-4, null), props: base(0, null), glass: base(0, null, true),
  };
  const uvs: Record<Layer, number> = { asph: 1 / (P ? TILE.asphalt : 10), side: 1 / (P ? TILE.paving : 3.2), fil: 1 / (P ? TILE.asphalt : 10), edge: 0, mark: 0, props: 0, glass: 0 };
  const cast: Record<Layer, boolean> = { asph: false, side: false, fil: false, edge: false, mark: false, props: true, glass: false };
  {
    const gm = new Mesh(ground.build(grassSurf ? 1 / (P ? TILE.grass : 8) : 0), base(0, grassSurf));
    gm.receiveShadow = true; gm.frustumCulled = false;
    group.add(gm);
  }
  const facMat = P ? facadeMaterial(P.concrete, getWindowsTex(), q === 'high') : fm();
  const flatM = (c: number): Material => (stdMat ? new MeshStandardMaterial({ roughness: 0.9, flatShading: true, color: c }) : new MeshLambertMaterial({ flatShading: true, color: c }));
  const trunkM = flatM(0x7a5535);
  const crownM = T ? (stdMat ? new MeshStandardMaterial({ roughness: 0.9, color: 0xffffff }) : new MeshLambertMaterial({ color: 0xffffff })) : new MeshLambertMaterial({ flatShading: true });
  const blobs = T ? 3 : 1;
  const crownGeo = T ? T.blob : new IcosahedronGeometry(1, 0);
  const cells = [...router.cells.values()];
  for (const c of cells) {
    for (const l of LAYERS) {
      const g = c.geos[l];
      if (g.empty) continue;
      const m = new Mesh(g.build(uvs[l]), mats[l]);
      m.castShadow = cast[l]; m.receiveShadow = true;
      if (l === 'glass') m.renderOrder = 2;
      c.group.add(m);
    }
    if (!c.fac.empty) {
      const m = new Mesh(c.fac.build(), facMat);
      m.castShadow = true; m.receiveShadow = true;
      c.group.add(m);
    }
    instanced(models.props.lightSquare, c.sq, c.group);
    instanced(models.props.lightCurved, c.cu, c.group);
    if (c.trees.length) {
      const trunks = new InstancedMesh(unitCyl, trunkM, c.trees.length);
      const crowns = new InstancedMesh(crownGeo, crownM, c.trees.length * blobs);
      c.trees.forEach((t, i) => {
        trunks.setMatrixAt(i, mat(t.x, t.y0 + 0.7 * t.s, t.z, 0, 0.3 * t.s, 1.4 * t.s, 0.3 * t.s));
        const hue = new Color().setHSL(0.3 + rnd() * 0.05, 0.45, 0.38 + rnd() * 0.08);
        for (let k = 0; k < blobs; k++) {
          const j = i * blobs + k;
          if (T) crowns.setMatrixAt(j, mat(t.x + (k ? (k === 1 ? 0.8 : -0.7) * t.s : 0), t.y0 + (2.7 + (k ? 0.1 * k : 0.5)) * t.s, t.z + (k === 2 ? 0.6 * t.s : k === 1 ? -0.5 * t.s : 0), rnd() * 6, (1.3 - 0.15 * k) * t.s, (1.2 - 0.1 * k) * t.s, (1.3 - 0.15 * k) * t.s));
          else crowns.setMatrixAt(j, mat(t.x, t.y0 + 2.5 * t.s, t.z, rnd() * 3, 1.5 * t.s, 1.7 * t.s, 1.5 * t.s));
          crowns.setColorAt(j, k ? hue.clone().offsetHSL(0, 0, 0.03 * k) : hue);
        }
      });
      for (const m of [trunks, crowns]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); c.group.add(m); }
    }
    // Комірки без видимих елементів не потрібні.
    c.group.visible = false;
    group.add(c.group);
  }

  // ---------- Нічне світіння: плями від ліхтарів на землі, ореоли ліхтарів і світлофорів ----------
  const glow = new Group();
  glow.visible = false;
  const glowTex = ((): CanvasTexture => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new CanvasTexture(c);
  })();
  if (lampPts.length) {
    if (q !== 'low') { // тепла пляма на асфальті під ліхтарем
      const pm = new InstancedMesh(new PlaneGeometry(15, 15), new MeshBasicMaterial({ map: glowTex, color: 0xffd59a, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, fog: true }), lampPts.length);
      const m4 = new Matrix4().makeRotationX(-Math.PI / 2);
      lampPts.forEach(([x, z], i) => { pm.setMatrixAt(i, new Matrix4().makeTranslation(x, 0.07, z).multiply(m4)); });
      pm.instanceMatrix.needsUpdate = true; pm.frustumCulled = false; pm.renderOrder = 2;
      glow.add(pm);
    }
    const lg = new BufferGeometry();
    lg.setAttribute('position', new Float32BufferAttribute(lampPts.flatMap(([x, z]) => [x, 7.3, z]), 3));
    const lp = new Points(lg, new PointsMaterial({ map: glowTex, color: 0xffe2b0, size: 3.2, sizeAttenuation: true, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
    lp.frustumCulled = false; glow.add(lp);
  }
  let sigHalo: Points | null = null;
  if (lampMats.length) {
    const pos = new Float32Array(lampMats.length * 3);
    lampMats.forEach((m, i) => { pos[i * 3] = m.elements[12]!; pos[i * 3 + 1] = m.elements[13]!; pos[i * 3 + 2] = m.elements[14]!; });
    const sg = new BufferGeometry();
    sg.setAttribute('position', new Float32BufferAttribute(pos, 3));
    sg.setAttribute('color', new Float32BufferAttribute(new Float32Array(lampMats.length * 3), 3));
    sigHalo = new Points(sg, new PointsMaterial({ map: glowTex, size: 1.7, vertexColors: true, sizeAttenuation: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    sigHalo.frustumCulled = false; glow.add(sigHalo);
  }
  group.add(glow);

  // ---------- Оновлення щокадру ----------
  const R = new URLSearchParams(location.search).get('all') === '1' ? Infinity : SHOW_R[q]; // ?all=1 — лише для знімків
  const key = (l: Light, on: boolean): string => (l === 'greenBlink' ? (on ? 'gb1' : 'gb0') : l);
  const setH = (h: Head, red: boolean, yel: boolean, grn: boolean): void => {
    if (!lamps) return;
    lamps.setColorAt(h.idx * 3, red ? lampCol.redOn : lampCol.redOff);
    lamps.setColorAt(h.idx * 3 + 1, yel ? lampCol.yelOn : lampCol.yelOff);
    lamps.setColorAt(h.idx * 3 + 2, grn ? lampCol.grnOn : lampCol.grnOff);
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    if (sigHalo) {
      const ca = sigHalo.geometry.getAttribute('color') as BufferAttribute;
      const set = (k: number, on: boolean, c: Color): void => { if (on) ca.setXYZ(h.idx * 3 + k, c.r, c.g, c.b); else ca.setXYZ(h.idx * 3 + k, 0, 0, 0); };
      set(0, red, lampCol.redOn); set(1, yel, lampCol.yelOn); set(2, grn, lampCol.grnOn);
      ca.needsUpdate = true;
    }
  };
  return {
    group,
    dispose(): void {
      group.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        if (!m.geometry.userData['shared']) m.geometry.dispose();
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (!mt.userData['shared']) mt.dispose();
      });
    },
    setNight(on: boolean): void { glow.visible = on; },
    updateLights(s0: AnySim): void {
      if (s0.route === 'route7') return;
      const s = s0, p = s.player;
      for (const c of cells) c.group.visible = c.dist(p.x, p.z) < R;
      const blinkOn = Math.floor(s.t * 4) % 2 === 0;
      for (const h of heads) {
        if (h.ped) {
          const walk = s.pedLight(h.crossing!) === 'walk', k = walk ? 'w' : 's';
          if (k === h.state) continue;
          h.state = k; setH(h, !walk, false, walk);
        } else {
          const l = s.light(h.ctrl, h.group!), k = key(l, blinkOn);
          if (k === h.state) continue;
          h.state = k;
          setH(h, l === 'red' || l === 'redYellow', l === 'yellow' || l === 'redYellow', l === 'green' || (l === 'greenBlink' && blinkOn));
        }
      }
    },
  };
}

// Кватерніон повороту навколо Y (для ламп).
function quatY(a: number): Quaternion { return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a); }
