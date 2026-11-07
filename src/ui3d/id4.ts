// Автомобілі гравця: Volkswagen ID.4 (автомат) і Kia Cerato (механіка) — процедурні моделі.
// Кузов — гладкий лофт по перерізах (монотонна кубічна інтерполяція вздовж авто, заокруглені борти/дах), нормалі згладжені.
// Деталі: арки, дверні шви й ручки, стійки скла, фари/ліхтарі (корпуси), номерні знаки, дзеркала, спиці дисків.
// Матеріали окремі: фарба (лак), скло, чорний пластик, хром, гума, фари, ліхтарі, знак. Дивиться в −Z (як моделі Kenney).
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Euler, Float32BufferAttribute, Matrix3, Matrix4, MeshPhysicalMaterial, MeshStandardMaterial, Quaternion, Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Baked } from './models';

interface St { z: number; hw: number; yb: number; ys: number; yr: number; rhw: number }
const ID4_ST: St[] = [
  { z: -2.29, hw: 0.60, yb: 0.45, ys: 0.66, yr: 0.68, rhw: 0.56 },
  { z: -2.22, hw: 0.80, yb: 0.30, ys: 0.74, yr: 0.76, rhw: 0.74 },
  { z: -2.00, hw: 0.90, yb: 0.26, ys: 0.88, yr: 0.90, rhw: 0.84 },
  { z: -1.50, hw: 0.93, yb: 0.28, ys: 0.96, yr: 0.98, rhw: 0.86 },
  { z: -1.05, hw: 0.93, yb: 0.30, ys: 1.00, yr: 1.02, rhw: 0.86 },
  { z: -0.75, hw: 0.93, yb: 0.30, ys: 1.02, yr: 1.32, rhw: 0.78 },
  { z: -0.20, hw: 0.93, yb: 0.30, ys: 1.04, yr: 1.60, rhw: 0.74 },
  { z: 0.60, hw: 0.93, yb: 0.30, ys: 1.06, yr: 1.64, rhw: 0.74 },
  { z: 1.40, hw: 0.93, yb: 0.30, ys: 1.06, yr: 1.56, rhw: 0.74 },
  { z: 1.95, hw: 0.93, yb: 0.30, ys: 1.06, yr: 1.34, rhw: 0.78 },
  { z: 2.20, hw: 0.92, yb: 0.32, ys: 1.04, yr: 1.12, rhw: 0.80 },
  { z: 2.29, hw: 0.84, yb: 0.45, ys: 1.00, yr: 1.02, rhw: 0.80 },
];
const CERATO_ST: St[] = [
  { z: -2.32, hw: 0.60, yb: 0.45, ys: 0.62, yr: 0.64, rhw: 0.56 },
  { z: -2.25, hw: 0.78, yb: 0.30, ys: 0.70, yr: 0.72, rhw: 0.72 },
  { z: -2.05, hw: 0.88, yb: 0.27, ys: 0.80, yr: 0.82, rhw: 0.80 },
  { z: -1.50, hw: 0.90, yb: 0.25, ys: 0.86, yr: 0.88, rhw: 0.82 },
  { z: -0.95, hw: 0.90, yb: 0.24, ys: 0.90, yr: 0.92, rhw: 0.82 },
  { z: -0.55, hw: 0.90, yb: 0.24, ys: 0.92, yr: 1.15, rhw: 0.76 },
  { z: 0.00, hw: 0.90, yb: 0.24, ys: 0.94, yr: 1.36, rhw: 0.72 },
  { z: 0.55, hw: 0.90, yb: 0.24, ys: 0.95, yr: 1.43, rhw: 0.72 },
  { z: 1.05, hw: 0.90, yb: 0.24, ys: 0.96, yr: 1.40, rhw: 0.72 },
  { z: 1.45, hw: 0.90, yb: 0.24, ys: 0.97, yr: 1.24, rhw: 0.74 },
  { z: 1.72, hw: 0.90, yb: 0.26, ys: 0.96, yr: 0.99, rhw: 0.84 },
  { z: 2.20, hw: 0.88, yb: 0.30, ys: 0.98, yr: 1.00, rhw: 0.80 },
  { z: 2.32, hw: 0.82, yb: 0.45, ys: 0.94, yr: 0.96, rhw: 0.76 },
];

interface Opts {
  paint: number; wheelZ: [number, number]; wheelR: number; wheelX: number; badge: 'vw' | 'kia'; rails: boolean; len: number;
  doors: number[]; handles: number[]; pillar: number; mirror: [number, number]; plateY: [number, number]; lampY: [number, number]; lampX: [number, number];
}

// Монотонна кубічна (Фріча–Карлсона) інтерполяція: без перерегулювання на капоті й даху.
function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length, h: number[] = [], d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1]! - xs[i]!); d.push((ys[i + 1]! - ys[i]!) / h[i]!); }
  m[0] = d[0]!; m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (2 * d[i - 1]! * d[i]!) / (d[i - 1]! + d[i]!);
  return (x: number): number => {
    let i = 0; while (i < n - 2 && x > xs[i + 1]!) i++;
    const t = (x - xs[i]!) / h[i]!, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h[i]! * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h[i]! * m[i + 1]!;
  };
}

type V3 = [number, number, number];
// Переріз: права половина (A0…A12 від низу до осі даху), далі дзеркально вниз; 25 точок по колу.
function sideRing(s: St): V3[] {
  const gx = s.hw * 0.93, band = s.yr - s.ys;
  const mid: V3 = [(gx + s.rhw) / 2 + 0.012 * Math.min(1, band * 4), (s.ys + s.yr) / 2, s.z];
  const R: V3[] = [
    [0, s.yb, s.z], [s.hw * 0.72, s.yb, s.z], [s.hw * 0.94, s.yb + 0.04, s.z], [s.hw, s.yb + 0.2, s.z],
    [s.hw * 1.003, s.yb + (s.ys - s.yb) * 0.5, s.z], [s.hw * 0.99, s.ys - 0.1, s.z], [s.hw * 0.96, s.ys - 0.025, s.z], [gx, s.ys, s.z],
    mid, [s.rhw, s.yr - 0.025, s.z], [s.rhw * 0.82, s.yr + 0.008, s.z], [s.rhw * 0.45, s.yr + 0.022, s.z], [0, s.yr + 0.027, s.z],
  ];
  const full: V3[] = [...R];
  for (let k = R.length - 2; k >= 0; k--) full.push([-R[k]![0], R[k]![1], R[k]![2]]);
  return full; // 25 точок, перша = остання (x=0)
}

class Bucket {
  pos: number[] = []; nor: number[] = [];
  vtx(p: V3, n: V3): void { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); }
  mesh(g: BufferGeometry, m: Matrix4): void {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position'), n = ng.getAttribute('normal');
    const nm = new Matrix3().getNormalMatrix(m), v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); const px = v.x, py = v.y, pz = v.z;
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(px, py, pz); this.nor.push(v.x, v.y, v.z);
    }
    if (ng !== g) ng.dispose();
  }
  geo(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    return g;
  }
}

const PAINT = 0, GLASS = 1, BLACK = 2, CHROME = 3, RUBBER = 4, LAMP = 5, TAIL = 6, PLATE = 7;

export const ID4_PAINT = 0xd22b3a, CERATO_PAINT = 0xe9ecf0;
export function buildId4(paint = ID4_PAINT): Baked {
  return buildCar(ID4_ST, {
    paint, wheelZ: [-1.38, 1.39], wheelR: 0.39, wheelX: 0.83, badge: 'vw', rails: true, len: 2.29, doors: [-0.78, 0.5, 1.62], handles: [-0.12, 0.95], pillar: 0.5,
    mirror: [1.0, -0.78], plateY: [0.43, 0.6], lampY: [0.72, 0.99], lampX: [0.62, 0.7],
  });
}
export function buildCerato(paint = CERATO_PAINT): Baked {
  return buildCar(CERATO_ST, {
    paint, wheelZ: [-1.36, 1.34], wheelR: 0.33, wheelX: 0.8, badge: 'kia', rails: false, len: 2.32, doors: [-0.6, 0.42, 1.38], handles: [-0.08, 0.86], pillar: 0.42,
    mirror: [0.97, -0.62], plateY: [0.42, 0.62], lampY: [0.68, 0.9], lampX: [0.6, 0.7],
  });
}

function buildCar(ST: St[], o: Opts): Baked {
  // 1) Лофт: інтерполюємо перерізи вздовж z.
  const zs = ST.map((s) => s.z);
  const f = (k: keyof St): ((x: number) => number) => pchip(zs, ST.map((s) => s[k]));
  const fhw = f('hw'), fyb = f('yb'), fys = f('ys'), fyr = f('yr'), frhw = f('rhw');
  const SUB = 4, stations: St[] = [];
  for (let i = 0; i < ST.length - 1; i++) for (let k = 0; k < SUB; k++) {
    const z = ST[i]!.z + ((ST[i + 1]!.z - ST[i]!.z) * k) / SUB;
    stations.push({ z, hw: fhw(z), yb: fyb(z), ys: fys(z), yr: fyr(z), rhw: frhw(z) });
  }
  stations.push(ST[ST.length - 1]!);
  const rings = stations.map(sideRing);
  const NR = rings[0]!.length; // 25
  const B = Array.from({ length: 8 }, () => new Bucket());
  const segMat = (k: number, i: number): number => {
    const t = k < 12 ? k : 23 - k; // тип сегмента (дзеркально)
    if (t <= 2) return BLACK;
    if (t === 7 || t === 8) { const a = stations[i]!, b = stations[i + 1]!; return a.yr - a.ys + b.yr - b.ys > 0.3 ? GLASS : PAINT; }
    return PAINT;
  };
  const normalAt = (i: number, k: number): V3 => {
    const kk = k % (NR - 1);
    const P = (ii: number, jj: number): V3 => rings[Math.max(0, Math.min(rings.length - 1, ii))]![((jj % (NR - 1)) + (NR - 1)) % (NR - 1)]!;
    const z0 = P(i - 1, kk), z1 = P(i + 1, kk), r0 = P(i, kk - 1), r1 = P(i, kk + 1);
    const dz: V3 = [z1[0] - z0[0], z1[1] - z0[1], z1[2] - z0[2]], dr: V3 = [r1[0] - r0[0], r1[1] - r0[1], r1[2] - r0[2]];
    // нормаль назовні: dr × dz (кільце йде вгору по правому борту)
    let nx = dr[1] * dz[2] - dr[2] * dz[1], ny = dr[2] * dz[0] - dr[0] * dz[2], nz = dr[0] * dz[1] - dr[1] * dz[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    return [nx, ny, nz];
  };
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < NR - 1; k++) {
      const bk = B[segMat(k, i)]!;
      const a = rings[i]![k]!, b = rings[i]![k + 1]!, c = rings[i + 1]![k + 1]!, d = rings[i + 1]![k]!;
      const na = normalAt(i, k), nb = normalAt(i, k + 1), nc = normalAt(i + 1, k + 1), nd = normalAt(i + 1, k);
      const tri = (p: V3, q: V3, r: V3, np: V3, nq: V3, nr: V3): void => {
        const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
        const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        const dot = fx * (np[0] + nq[0] + nr[0]) + fy * (np[1] + nq[1] + nr[1]) + fz * (np[2] + nq[2] + nr[2]);
        if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) < 1e-12) return;
        if (dot >= 0) { bk.vtx(p, np); bk.vtx(q, nq); bk.vtx(r, nr); } else { bk.vtx(p, np); bk.vtx(r, nr); bk.vtx(q, nq); }
      };
      tri(a, b, c, na, nb, nc); tri(a, c, d, na, nc, nd);
    }
  }
  // Торці: веєр із плоскою нормаллю.
  for (const [idx, sgn] of [[0, -1], [rings.length - 1, 1]] as const) {
    const r = rings[idx]!, st = stations[idx]!, c: V3 = [0, (st.yb + st.yr) / 2, st.z];
    for (let k = 0; k < NR - 1; k++) {
      const n: V3 = [0, 0, sgn], bk = B[PAINT]!;
      const p = r[k]!, q = r[k + 1]!;
      const fz = (p[0] - c[0]) * (q[1] - c[1]) - (p[1] - c[1]) * (q[0] - c[0]); // z-компонента (p−c)×(q−c)
      if (Math.abs(fz) < 1e-12) continue;
      if (fz * sgn > 0) { bk.vtx(c, n); bk.vtx(p, n); bk.vtx(q, n); } else { bk.vtx(c, n); bk.vtx(q, n); bk.vtx(p, n); }
    }
  }
  // 2) Деталі.
  const T = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Matrix4 =>
    new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));
  const box = new BoxGeometry(1, 1, 1), cyl = (r: number, h: number, seg = 16): CylinderGeometry => new CylinderGeometry(r, r, h, seg);
  const zf = -o.len, zr = o.len;
  const at = (z: number): St => ({ z, hw: fhw(z), yb: fyb(z), ys: fys(z), yr: fyr(z), rhw: frhw(z) });
  for (const k of [-1, 1]) {
    // Дверні шви й ручки.
    for (const z of o.doors) { const s = at(z); B[BLACK]!.mesh(box, T(k * (s.hw * 1.0 + 0.003), (s.yb + 0.28 + s.ys - 0.04) / 2, z, 0.012, s.ys - 0.04 - (s.yb + 0.28), 0.014)); }
    for (const z of o.handles) { const s = at(z); B[PAINT]!.mesh(box, T(k * (s.hw + 0.006), s.ys - 0.13, z, 0.014, 0.03, 0.16)); B[BLACK]!.mesh(box, T(k * (s.hw + 0.004), s.ys - 0.13, z, 0.012, 0.012, 0.14)); }
    // Стійка між скельцями (з нахилом за бортом скла).
    { const s = at(o.pillar), x0 = s.hw * 0.93, x1 = s.rhw, ang = Math.atan2(x1 - x0, s.yr - s.ys); B[BLACK]!.mesh(box, T(k * (x0 + x1) / 2, (s.ys + s.yr) / 2, o.pillar, 0.03, s.yr - s.ys, 0.07, 0, 0, -k * ang)); }
    // Арки: темні диски на борту навколо коліс; колесо: шина, диск зі спицями.
    for (const zz of o.wheelZ) {
      const s = at(zz), R = o.wheelR;
      const arch = cyl(R + 0.075, 0.02, 22); arch.rotateZ(Math.PI / 2);
      B[BLACK]!.mesh(arch, T(k * (s.hw * 1.0 + 0.002), R, zz));
      const tyre = cyl(R, 0.26, 22); tyre.rotateZ(Math.PI / 2);
      B[RUBBER]!.mesh(tyre, T(k * o.wheelX, R, zz));
      const rim = cyl(R * 0.72, 0.27, 20); rim.rotateZ(Math.PI / 2);
      B[CHROME]!.mesh(rim, T(k * o.wheelX, R, zz));
      for (let sp = 0; sp < 5; sp++) { const a = (sp / 5) * Math.PI * 2; B[BLACK]!.mesh(box, T(k * (o.wheelX + 0.135), R + Math.sin(a) * R * 0.34, zz + Math.cos(a) * R * 0.34, 0.012, R * 0.52, 0.05, Math.PI / 2 - a)); }
      const hub = cyl(R * 0.16, 0.28, 10); hub.rotateZ(Math.PI / 2);
      B[BLACK]!.mesh(hub, T(k * o.wheelX, R, zz));
    }
    // Дзеркала: корпус у колір кузова + чорне дзеркало.
    B[PAINT]!.mesh(box, T(k * o.mirror[0], at(o.mirror[1]).ys + 0.02, o.mirror[1], 0.16, 0.1, 0.2));
    B[BLACK]!.mesh(box, T(k * o.mirror[0], at(o.mirror[1]).ys + 0.02, o.mirror[1] + 0.1, 0.14, 0.085, 0.01));
    // Корпуси фар і ліхтарів по кутах.
    B[LAMP]!.mesh(box, T(k * o.lampX[0], o.lampY[0], zf + 0.1, 0.36, 0.1, 0.16));
    B[TAIL]!.mesh(box, T(k * o.lampX[1], o.lampY[1], zr - 0.06, 0.38, 0.12, 0.1));
    if (o.rails) B[BLACK]!.mesh(box, T(k * 0.72, 1.665, 0.75, 0.04, 0.04, 1.5));
  }
  // Бампери, решітка, емблеми, номерні знаки.
  B[BLACK]!.mesh(box, T(0, 0.45, zf + 0.04, 1.4, 0.18, 0.08)); B[BLACK]!.mesh(box, T(0, 0.46, zr - 0.04, 1.36, 0.18, 0.08));
  if (o.badge === 'vw') {
    B[LAMP]!.mesh(box, T(0, 0.745, zf + 0.012, 1.3, 0.035, 0.03));        // LED-смуга між фарами
    B[TAIL]!.mesh(box, T(0, 1.0, zr - 0.012, 1.25, 0.035, 0.03));
    const d = cyl(0.1, 0.02, 20); d.rotateX(Math.PI / 2);
    B[CHROME]!.mesh(d, T(0, 0.62, zf - 0.008)); B[CHROME]!.mesh(d, T(0, 0.96, zr + 0.008));
    const d2 = cyl(0.066, 0.025, 16); d2.rotateX(Math.PI / 2);
    B[BLACK]!.mesh(d2, T(0, 0.62, zf - 0.012)); B[BLACK]!.mesh(d2, T(0, 0.96, zr + 0.012));
  } else {
    B[BLACK]!.mesh(box, T(0, 0.585, zf + 0.005, 0.95, 0.12, 0.04));
    B[CHROME]!.mesh(box, T(0, 0.66, zf - 0.004, 1.02, 0.02, 0.025)); B[CHROME]!.mesh(box, T(0, 0.51, zf - 0.004, 1.02, 0.02, 0.025));
    const el = cyl(0.1, 0.02, 20); el.rotateX(Math.PI / 2);
    B[CHROME]!.mesh(el, T(0, 0.585, zf - 0.012, 1, 0.55, 1)); B[CHROME]!.mesh(el, T(0, 0.9, zr + 0.01, 1, 0.55, 1));
    B[TAIL]!.mesh(box, T(0, 0.93, zr - 0.006, 0.5, 0.03, 0.02));
  }
  for (const [z, y, sgn] of [[zf - 0.002, o.plateY[0], -1], [zr + 0.004, o.plateY[1], 1]] as const) {
    B[PLATE]!.mesh(box, T(0, y, z, 0.52, 0.115, 0.012));
    B[BLACK]!.mesh(box, T(-0.23, y, z + sgn * 0.004, 0.045, 0.115, 0.012));
  }
  // 3) Збірка: матеріали й групи.
  const mats: Material[] = [
    new MeshPhysicalMaterial({ color: o.paint, roughness: 0.32, metalness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.08 }),
    new MeshStandardMaterial({ color: 0x0a1018, roughness: 0.05, metalness: 0.7 }),
    new MeshStandardMaterial({ color: 0x15171a, roughness: 0.7, metalness: 0.05 }),
    new MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.2, metalness: 0.95 }),
    new MeshStandardMaterial({ color: 0x111214, roughness: 0.95, metalness: 0 }),
    new MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.1, metalness: 0.3, emissive: 0x202a34 }),
    new MeshStandardMaterial({ color: 0x7a0f12, roughness: 0.2, metalness: 0.2 }),
    new MeshStandardMaterial({ color: 0xf4f5f2, roughness: 0.5, metalness: 0 }),
  ];
  const geos = B.map((b) => b.geo());
  const geo = mergeGeometries(geos, true)!;
  geo.computeBoundingBox();
  geo.userData['shared'] = true;
  for (const m of mats) m.userData['shared'] = true;
  return { geo, mat: mats, box: geo.boundingBox!.clone(), exact: true };
}
