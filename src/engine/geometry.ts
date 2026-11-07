// Геометрія: шляхи (полілінія, дуга), Безьє, проекція, перетин прямокутників.
// Курс a: вектор руху h = (sin a, -cos a); a=0 на північ (-Z), a=+π/2 на схід.

export interface Vec2 { x: number; z: number }
export interface Pose { x: number; z: number; a: number }
export interface Projection { s: number; d: number } // d > 0 праворуч від напрямку руху

export interface Path {
  readonly length: number;
  pose(s: number): Pose;
  project(x: number, z: number): Projection;
}

const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (p: number): number => { const t = clamp(p, 0, 1); return t * t * (3 - 2 * t); };
export const headingOf = (hx: number, hz: number): number => Math.atan2(hx, -hz);
export const wrapAngle = (a: number): number => { let r = (a + Math.PI) % TAU; if (r < 0) r += TAU; return r - Math.PI; };
export const mod = (a: number, m: number): number => ((a % m) + m) % m;

export class Polyline implements Path {
  readonly pts: readonly Vec2[];
  readonly cum: readonly number[];
  readonly length: number;

  // Межі сегментів (для швидкого відкидання в project; на результат не впливають).
  private readonly bb: Float64Array | null;

  constructor(pts: readonly Vec2[]) {
    if (pts.length < 2) throw new Error('Polyline needs 2+ points');
    this.pts = pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.cum = cum;
    this.length = cum[cum.length - 1]!;
    if (pts.length > 4) {
      const bb = new Float64Array((pts.length - 1) * 4);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!, b = pts[i + 1]!;
        bb[i * 4] = Math.min(a.x, b.x); bb[i * 4 + 1] = Math.max(a.x, b.x); bb[i * 4 + 2] = Math.min(a.z, b.z); bb[i * 4 + 3] = Math.max(a.z, b.z);
      }
      this.bb = bb;
    } else this.bb = null;
  }

  seg(s: number): number {
    const c = this.cum;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m]! <= s) lo = m; else hi = m; }
    return lo;
  }

  pose(s: number): Pose {
    // За межами шляху — екстраполяція по крайньому сегменту (потрібно для проекцій «за кінцем»).
    const i = s <= 0 ? 0 : s >= this.length ? this.pts.length - 2 : this.seg(s);
    const a = this.pts[i]!, b = this.pts[i + 1]!;
    const L = Math.max(1e-9, this.cum[i + 1]! - this.cum[i]!);
    const t = (s - this.cum[i]!) / L;
    const hx = (b.x - a.x) / L, hz = (b.z - a.z) / L;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, a: headingOf(hx, hz) };
  }

  project(x: number, z: number): Projection {
    let best = Infinity, bs = 0, bd = 0;
    const n = this.pts.length;
    const bb = this.bb;
    for (let i = 0; i < n - 1; i++) {
      // Середні сегменти: відкинути, якщо їхня рамка далі за найкращий результат (перший/останній — з продовженням).
      if (bb !== null && i > 0 && i < n - 2) {
        const k = i * 4;
        const dx = x < bb[k]! ? bb[k]! - x : x > bb[k + 1]! ? x - bb[k + 1]! : 0;
        const dz = z < bb[k + 2]! ? bb[k + 2]! - z : z > bb[k + 3]! ? z - bb[k + 3]! : 0;
        if (dx >= best || dz >= best || dx * dx + dz * dz >= best * best) continue;
      }
      const a = this.pts[i]!, b = this.pts[i + 1]!;
      const L = this.cum[i + 1]! - this.cum[i]!;
      if (L < 1e-9) continue;
      const hx = (b.x - a.x) / L, hz = (b.z - a.z) / L;
      let t = (x - a.x) * hx + (z - a.z) * hz;
      // Перший і останній сегменти продовжуються за кінці.
      if (i > 0) t = Math.max(0, t);
      if (i < n - 2) t = Math.min(L, t);
      const px = a.x + hx * t, pz = a.z + hz * t;
      const dist = Math.hypot(x - px, z - pz);
      if (dist < best) {
        best = dist;
        bs = this.cum[i]! + t;
        bd = (x - px) * -hz + (z - pz) * hx; // праворуч = (-hz, hx)
      }
    }
    return { s: bs, d: bd };
  }

  // Проекція лише на ділянку [s0, s1] (для довгих смуг мережі: швидко, коли цікавить лише околиця).
  // Сегменти на кінцях полілінії, як і в project, продовжуються за кінці.
  projectRange(x: number, z: number, s0: number, s1: number): Projection {
    const n = this.pts.length;
    if (n <= 4 || (s0 <= 0 && s1 >= this.length)) return this.project(x, z);
    const i0 = s0 <= 0 ? 0 : this.seg(Math.min(s0, this.length));
    const i1 = s1 >= this.length ? n - 2 : this.seg(Math.max(0, s1));
    let best = Infinity, bs = 0, bd = 0;
    for (let i = i0; i <= i1; i++) {
      const a = this.pts[i]!, b = this.pts[i + 1]!;
      const L = this.cum[i + 1]! - this.cum[i]!;
      if (L < 1e-9) continue;
      const hx = (b.x - a.x) / L, hz = (b.z - a.z) / L;
      let t = (x - a.x) * hx + (z - a.z) * hz;
      if (i > 0) t = Math.max(0, t);
      if (i < n - 2) t = Math.min(L, t);
      const px = a.x + hx * t, pz = a.z + hz * t;
      const dist = Math.hypot(x - px, z - pz);
      if (dist < best) { best = dist; bs = this.cum[i]! + t; bd = (x - px) * -hz + (z - pz) * hx; }
    }
    return { s: bs, d: bd };
  }

  // Частина лінії між s0 і s1.
  slice(s0: number, s1: number): Polyline {
    const out: Vec2[] = [this.pose(s0)];
    for (let i = 0; i < this.pts.length; i++) if (this.cum[i]! > s0 && this.cum[i]! < s1) out.push(this.pts[i]!);
    out.push(this.pose(s1));
    return new Polyline(out.map((p) => ({ x: p.x, z: p.z })));
  }

  // Паралельна лінія зі зсувом праворуч (для смуг).
  offset(d: number): Polyline {
    const out: Vec2[] = [];
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i]!;
      const a = this.pts[Math.max(0, i - 1)]!, b = this.pts[Math.min(n - 1, i + 1)]!;
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const hx = (b.x - a.x) / L, hz = (b.z - a.z) / L;
      out.push({ x: p.x - hz * d, z: p.z + hx * d });
    }
    return new Polyline(out);
  }
}

// Дуга проти годинникової стрілки (вид зверху, північ угорі). θ — математичний кут: 0 схід, 90° північ.
export class Arc implements Path {
  readonly length: number;
  constructor(readonly cx: number, readonly cz: number, readonly r: number, readonly t0: number, readonly t1: number) {
    this.length = (t1 - t0) * r;
  }
  pose(s: number): Pose { return ringPose(this.cx, this.cz, this.r, this.t0 + s / this.r); }
  project(x: number, z: number): Projection {
    const th = Math.atan2(-(z - this.cz), x - this.cx);
    const span = this.t1 - this.t0;
    let rel = mod(th - this.t0, TAU);
    if (rel > span + (TAU - span) / 2) rel -= TAU;
    return { s: rel * this.r, d: Math.hypot(x - this.cx, z - this.cz) - this.r };
  }
}

export function ringPose(cx: number, cz: number, r: number, th: number): Pose {
  return { x: cx + r * Math.cos(th), z: cz - r * Math.sin(th), a: wrapAngle(-th) };
}

export function bezierPath(p0: Pose, p3: Pose, d0: number, d1 = d0, n = 28): Polyline {
  const h0x = Math.sin(p0.a), h0z = -Math.cos(p0.a);
  const h1x = Math.sin(p3.a), h1z = -Math.cos(p3.a);
  const p1 = { x: p0.x + h0x * d0, z: p0.z + h0z * d0 };
  const p2 = { x: p3.x - h1x * d1, z: p3.z - h1z * d1 };
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    pts.push({
      x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
      z: b0 * p0.z + b1 * p1.z + b2 * p2.z + b3 * p3.z,
    });
  }
  return new Polyline(pts);
}

export const line = (a: Vec2, b: Vec2): Polyline => new Polyline([a, b]);

export interface Box { x: number; z: number; a: number; hl: number; hw: number }

// Перетин двох повернутих прямокутників (SAT).
export function boxesOverlap(p: Box, q: Box): boolean {
  const axes: [number, number][] = [];
  for (const b of [p, q]) {
    const hx = Math.sin(b.a), hz = -Math.cos(b.a);
    axes.push([hx, hz], [-hz, hx]);
  }
  for (const [ax, az] of axes) {
    const rp = radius(p, ax, az), rq = radius(q, ax, az);
    const dist = Math.abs((q.x - p.x) * ax + (q.z - p.z) * az);
    if (dist > rp + rq) return false;
  }
  return true;
}

function radius(b: Box, ax: number, az: number): number {
  const hx = Math.sin(b.a), hz = -Math.cos(b.a);
  return b.hl * Math.abs(hx * ax + hz * az) + b.hw * Math.abs(-hz * ax + hx * az);
}

export function pointBoxDist(px: number, pz: number, b: Box): number {
  const hx = Math.sin(b.a), hz = -Math.cos(b.a);
  const dx = px - b.x, dz = pz - b.z;
  const lon = dx * hx + dz * hz, lat = dx * -hz + dz * hx;
  const ox = Math.max(0, Math.abs(lon) - b.hl), oz = Math.max(0, Math.abs(lat) - b.hw);
  return Math.hypot(ox, oz);
}
