// Накопичувач геометрії: зливає багато дрібних фігур в один BufferGeometry (мало draw calls).
import { BufferGeometry, Color, Float32BufferAttribute, Matrix3, Matrix4, Vector3 } from 'three';
import type { Polyline, Vec2 } from '../engine/geometry';

const tmpC = new Color();

export class Geo {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];

  private push(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: readonly number[]): void {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(c[0]!, c[1]!, c[2]!);
  }

  static color(hex: number): number[] { tmpC.setHex(hex); return [tmpC.r, tmpC.g, tmpC.b]; }

  // Трикутник, що дивиться вгору (нормаль +Y) незалежно від порядку вершин.
  triUp(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: readonly number[]): void {
    const cr = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // y-складова (b-a)x(c-a) з урахуванням порядку осей
    if (cr > 0) this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, 0, 1, 0, c);
    else this.tri(ax, ay, az, cx, cy, cz, bx, by, bz, 0, 1, 0, c);
  }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, c: readonly number[]): void {
    this.push(ax, ay, az, nx, ny, nz, c); this.push(bx, by, bz, nx, ny, nz, c); this.push(cx, cy, cz, nx, ny, nz, c);
  }

  // Горизонтальний чотирикутник (a,b,c,d по колу).
  quadUp(a: Vec2, b: Vec2, c: Vec2, d: Vec2, y: number, col: readonly number[]): void {
    this.triUp(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z, col);
    this.triUp(a.x, y, a.z, c.x, y, c.z, d.x, y, d.z, col);
  }

  // Вертикальна стінка між двома точками (від y0 до y1), нормаль назовні вправо від a→b.
  wall(a: Vec2, b: Vec2, y0: number, y1: number, col: readonly number[], flip = false): void {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    let nx = dz / L, nz = -dx / L;
    if (flip) { nx = -nx; nz = -nz; }
    // порядок вершин, щоб нормаль збігалась з (nx,0,nz)
    const ccw = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void => {
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const gx = uy * vz - uz * vy, gz = ux * vy - uy * vx;
      if (gx * nx + gz * nz >= 0) this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, nx, 0, nz, col);
      else this.tri(ax, ay, az, cx, cy, cz, bx, by, bz, nx, 0, nz, col);
    };
    ccw(a.x, y0, a.z, b.x, y0, b.z, b.x, y1, b.z);
    ccw(a.x, y0, a.z, b.x, y1, b.z, a.x, y1, a.z);
  }

  // Вбудувати готову three-геометрію з матрицею і кольором (для коробок, циліндрів).
  addGeometry(g: BufferGeometry, m: Matrix4, col: readonly number[]): void {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position'), n = ng.getAttribute('normal');
    const nm = new Matrix3().getNormalMatrix(m);
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      const px = v.x, py = v.y, pz = v.z;
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.push(px, py, pz, v.x, v.y, v.z, col);
    }
    if (ng !== g) ng.dispose();
  }

  // uvScale > 0: планарні UV зверху (x, z) × uvScale — для текстур землі/асфальту/плитки.
  build(uvScale = 0): BufferGeometry {
    const g = new BufferGeometry();
    if (uvScale > 0) {
      const uv: number[] = [];
      for (let i = 0; i < this.pos.length; i += 3) uv.push(this.pos[i]! * uvScale, -this.pos[i + 2]! * uvScale); // v = −z: правий базис (u→x, v→−z, нормаль +y) для normalMap
      g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    }
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }

  get empty(): boolean { return this.pos.length === 0; }
}

// Стрічка вздовж ламаної: точки ± нормаль * halfW. Горизонтальна, на висоті y.
export function ribbon(g: Geo, pts: readonly Vec2[], halfW: number, y: number, col: readonly number[]): void {
  const n = pts.length;
  const L: Vec2[] = [], R: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const hx = (b.x - a.x) / len, hz = (b.z - a.z) / len;
    const rx = -hz, rz = hx; // праворуч
    const p = pts[i]!;
    L.push({ x: p.x - rx * halfW, z: p.z - rz * halfW });
    R.push({ x: p.x + rx * halfW, z: p.z + rz * halfW });
  }
  for (let i = 0; i < n - 1; i++) g.quadUp(L[i]!, R[i]!, R[i + 1]!, L[i + 1]!, y, col);
}

// Стрічка зі зсувом d праворуч від полілінії.
export function lineRibbon(g: Geo, p: Polyline, d: number, halfW: number, y: number, col: readonly number[]): void {
  ribbon(g, d === 0 ? p.pts : p.offset(d).pts, halfW, y, col);
}

// Пунктир: штрихи dash з проміжком gap між s0 і s1.
export function dashes(g: Geo, p: Polyline, d: number, dash: number, gap: number, halfW: number, y: number, col: readonly number[], s0 = 0, s1 = p.length): void {
  for (let s = s0; s + dash <= s1 + 1e-6; s += dash + gap) {
    const a = p.pose(s), b = p.pose(s + dash);
    const ra = { x: Math.cos(a.a), z: Math.sin(a.a) }, rb = { x: Math.cos(b.a), z: Math.sin(b.a) };
    g.quadUp(
      { x: a.x + ra.x * (d - halfW), z: a.z + ra.z * (d - halfW) },
      { x: a.x + ra.x * (d + halfW), z: a.z + ra.z * (d + halfW) },
      { x: b.x + rb.x * (d + halfW), z: b.z + rb.z * (d + halfW) },
      { x: b.x + rb.x * (d - halfW), z: b.z + rb.z * (d - halfW) }, y, col);
  }
}

// Сектор кільця між радіусами r0..r1 і кутами t0..t1 (математичний кут: x=cx+r cos, z=cz-r sin).
export function sector(g: Geo, cx: number, cz: number, r0: number, r1: number, t0: number, t1: number, y: number, col: readonly number[], step = 0.12): void {
  const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / step));
  for (let i = 0; i < n; i++) {
    const ta = t0 + ((t1 - t0) * i) / n, tb = t0 + ((t1 - t0) * (i + 1)) / n;
    const pt = (r: number, t: number): Vec2 => ({ x: cx + r * Math.cos(t), z: cz - r * Math.sin(t) });
    g.quadUp(pt(r0, ta), pt(r1, ta), pt(r1, tb), pt(r0, tb), y, col);
  }
}

// Інтервали [0,len] без виключених.
export function without(len: number, ex: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = [...ex].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = 0;
  for (const [a, b] of sorted) {
    if (a > cur) out.push([cur, Math.min(a, len)]);
    cur = Math.max(cur, b);
  }
  if (cur < len) out.push([cur, len]);
  return out.filter(([a, b]) => b - a > 0.05);
}
