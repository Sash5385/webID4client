// Спільні утиліти для інструментів маршруту №1: розбір OSM XML (API 0.6), проєкція, геометрія полiліній.
// Дані OSM: © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
import { readFileSync } from 'node:fs';

// ---------- OSM XML ----------

const ENT = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
const decode = (s) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));
const attr = (line, k) => { const m = line.match(new RegExp(` ${k}="([^"]*)"`)); return m ? m[1] : null; };

// Повертає { nodes: Map<id, {id, lat, lon, tags}>, ways: Map<id, {id, nds, tags}> }. Дублікати між тайлами відкидаються.
export function loadOSM(paths) {
  const nodes = new Map(), ways = new Map();
  for (const p of paths) {
    const lines = readFileSync(p, 'utf8').split('\n');
    let cur = null;
    for (const raw of lines) {
      const t = raw.trim();
      if (t.startsWith('<node ')) {
        const id = +attr(t, 'id');
        let n = nodes.get(id);
        const fresh = !n;
        if (fresh) { n = { id, lat: +attr(t, 'lat'), lon: +attr(t, 'lon'), tags: {} }; nodes.set(id, n); }
        cur = t.endsWith('/>') ? null : fresh ? n : { tags: {}, nds: [] };
      } else if (t.startsWith('<way ')) {
        const id = +attr(t, 'id');
        if (ways.has(id)) cur = { tags: {}, nds: [] };
        else { cur = { id, nds: [], tags: {} }; ways.set(id, cur); }
        if (t.endsWith('/>')) cur = null;
      } else if (t.startsWith('<relation')) cur = t.endsWith('/>') ? null : { tags: {}, nds: [] };
      else if (t.startsWith('<nd ') && cur) cur.nds.push(+attr(t, 'ref'));
      else if (t.startsWith('<tag ') && cur) cur.tags[decode(attr(t, 'k'))] = decode(attr(t, 'v'));
      else if (t.startsWith('</')) cur = null;
    }
  }
  return { nodes, ways };
}

// ---------- Проєкція: локальні метри, X на схід, Z на південь ----------

export function makeProjection(lat0, lon0) {
  const φ = (lat0 * Math.PI) / 180;
  // Довжина градуса (WGS84, наближення рядом).
  const kz = 111132.954 - 559.822 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ);
  const kx = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ) + 0.118 * Math.cos(5 * φ);
  return {
    lat0, lon0, kx, kz,
    fwd: (lat, lon) => [(lon - lon0) * kx, -(lat - lat0) * kz],
    inv: (x, z) => [lat0 - z / kz, lon0 + x / kx],
  };
}

// ---------- Геометрія на масивах [x, z] ----------

export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const r2 = (v) => Math.round(v * 100) / 100;

export function cumLen(pts) {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i]));
  return c;
}

// Точка й напрям на відстані s уздовж (з екстраполяцією за кінцями).
export function poseAt(pts, cum, s) {
  const n = pts.length;
  let i = 0;
  if (s >= cum[n - 1]) i = n - 2;
  else if (s > 0) { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; } i = lo; }
  const a = pts[i], b = pts[i + 1];
  const L = Math.max(1e-9, cum[i + 1] - cum[i]);
  const t = (s - cum[i]) / L;
  const hx = (b[0] - a[0]) / L, hz = (b[1] - a[1]) / L;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, hx, hz };
}

// Проекція точки: s уздовж, d > 0 праворуч (як у рушії).
export function project(pts, cum, p) {
  let best = Infinity, bs = 0, bd = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = cum[i + 1] - cum[i];
    if (L < 1e-9) continue;
    const hx = (b[0] - a[0]) / L, hz = (b[1] - a[1]) / L;
    let t = (p[0] - a[0]) * hx + (p[1] - a[1]) * hz;
    t = Math.max(0, Math.min(L, t));
    const px = a[0] + hx * t, pz = a[1] + hz * t;
    const dd = Math.hypot(p[0] - px, p[1] - pz);
    if (dd < best) { best = dd; bs = cum[i] + t; bd = (p[0] - px) * -hz + (p[1] - pz) * hx; }
  }
  return { s: bs, d: bd, dist: best };
}

export function distToPolyline(pts, p) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t));
  }
  return best;
}

export function resample(pts, step) {
  const cum = cumLen(pts);
  const L = cum[cum.length - 1];
  const n = Math.max(1, Math.round(L / step));
  const out = [];
  for (let i = 0; i <= n; i++) { const p = poseAt(pts, cum, (L * i) / n); out.push([p.x, p.z]); }
  return out;
}

// Ковзне середнє за індексом (точки рівновіддалені), кінці закріплені.
export function smoothPts(pts, win) {
  const n = pts.length, out = pts.map((p) => [p[0], p[1]]);
  for (let i = 1; i < n - 1; i++) {
    const w = Math.min(win, i, n - 1 - i);
    let sx = 0, sz = 0;
    for (let k = -w; k <= w; k++) { sx += pts[i + k][0]; sz += pts[i + k][1]; }
    out[i] = [sx / (2 * w + 1), sz / (2 * w + 1)];
  }
  return out;
}

export function smoothVals(v, win) {
  const n = v.length, out = v.slice();
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) { s += v[k]; c++; }
    out[i] = s / c;
  }
  return out;
}

// Нормаль праворуч у вершинах (середня з сусідніх сегментів).
export function rightNormals(pts) {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const L = dist(a, b) || 1;
    const hx = (b[0] - a[0]) / L, hz = (b[1] - a[1]) / L;
    return [-hz, hx];
  });
}

export function offsetPts(pts, offs) {
  const N = rightNormals(pts);
  return pts.map((p, i) => [p[0] + N[i][0] * (typeof offs === 'number' ? offs : offs[i]), p[1] + N[i][1] * (typeof offs === 'number' ? offs : offs[i])]);
}

// Дуглас-Пекер.
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let md = -1, mi = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distToPolyline([pts[i], pts[j]], pts[k]);
      if (d > md) { md = d; mi = k; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Кубічна Безьє між позами {x, z, hx, hz}.
export function bezier(p0, p3, d0, d1, n = 24) {
  const p1 = [p0.x + p0.hx * d0, p0.z + p0.hz * d0];
  const p2 = [p3.x - p3.hx * d1, p3.z - p3.hz * d1];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    out.push([b0 * p0.x + b1 * p1[0] + b2 * p2[0] + b3 * p3.x, b0 * p0.z + b1 * p1[1] + b2 * p2[1] + b3 * p3.z]);
  }
  return out;
}

// Найбільша кривина (1/м) полілінії — для перевірки зʼєднувачів.
export function maxCurvature(pts) {
  let k = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const ab = dist(a, b), bc = dist(b, c), ac = dist(a, c);
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (ab * bc * ac > 1e-9) k = Math.max(k, (2 * area2) / (ab * bc * ac));
  }
  return k;
}

// Коло найменших квадратів (Kåsa).
export function fitCircle(pts) {
  let sx = 0, sz = 0;
  for (const p of pts) { sx += p[0]; sz += p[1]; }
  const mx = sx / pts.length, mz = sz / pts.length;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - mz;
    suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
  const det = suu * svv - suv * suv;
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const cx = mx + uc, cz = mz + vc;
  const r = pts.reduce((acc, p) => acc + dist(p, [cx, cz]), 0) / pts.length;
  return { cx, cz, r };
}

export function convexHull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
