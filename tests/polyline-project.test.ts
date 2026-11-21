import { describe, expect, it } from 'vitest';
import { Polyline } from '../src/engine/geometry';

// Еталон: повний перебір сегментів без відкидання.
function brute(pl: Polyline, x: number, z: number): { s: number; d: number } {
  let best = Infinity, bs = 0, bd = 0;
  const n = pl.pts.length;
  for (let i = 0; i < n - 1; i++) {
    const a = pl.pts[i]!, b = pl.pts[i + 1]!, L = pl.cum[i + 1]! - pl.cum[i]!;
    if (L < 1e-9) continue;
    const hx = (b.x - a.x) / L, hz = (b.z - a.z) / L;
    let t = (x - a.x) * hx + (z - a.z) * hz;
    if (i > 0) t = Math.max(0, t);
    if (i < n - 2) t = Math.min(L, t);
    const px = a.x + hx * t, pz = a.z + hz * t, dist = Math.hypot(x - px, z - pz);
    if (dist < best) { best = dist; bs = pl.cum[i]! + t; bd = (x - px) * -hz + (z - pz) * hx; }
  }
  return { s: bs, d: bd };
}

describe('Polyline.project (блочне відкидання)', () => {
  it('збігається з повним перебором', () => {
    let seed = 7; const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const n of [3, 5, 16, 17, 18, 33, 34, 35, 200, 513]) {
      const pts = []; let x = 0, z = 0, a = 0;
      for (let i = 0; i < n; i++) { a += (rnd() - 0.5) * 0.8; x += Math.cos(a) * 2; z += Math.sin(a) * 2; pts.push({ x, z }); }
      const pl = new Polyline(pts);
      for (let k = 0; k < 400; k++) {
        const qx = (rnd() - 0.3) * 600 - 100, qz = (rnd() - 0.5) * 600;
        const p = pl.project(qx, qz), q = brute(pl, qx, qz);
        expect(p.s).toBeCloseTo(q.s, 9); expect(p.d).toBeCloseTo(q.d, 9);
      }
    }
  });
});
