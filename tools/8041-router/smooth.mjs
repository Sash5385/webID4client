import { readFileSync } from 'node:fs';
const W = 3.5;
const hd = (a, b) => Math.atan2(b[0] - a[0], -(b[1] - a[1]));
const wr = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function minR(pts) { let best = 1e9, at = 0; for (let i = 1; i + 1 < pts.length; i++) { const a = pts[i - 1], b = pts[i], c = pts[i + 1]; const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ac = Math.hypot(c[0] - a[0], c[1] - a[1]); const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); if (ar > 1e-6) { const R = (ab * bc * ac) / (2 * ar); if (R < best) { best = R; at = i; } } } return { R: best, i: at }; }
function lane(e, l) { const d = (l + 0.5) * W; const r = e.ref; return r.map((p, i) => { const a = r[Math.max(0, i - 1)], b = r[Math.min(r.length - 1, i + 1)]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const hx = (b[0] - a[0]) / L, hz = (b[1] - a[1]) / L; return [p[0] - hz * d, p[1] + hx * d]; }); }
for (const n of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(`src/data/route8041_${n}.json`, 'utf8'));
  const E = Object.fromEntries(d.edges.map((e) => [e.id, e]));
  console.log(`=== маршрут ${n}: ребер ${d.edges.length}, з'єднувачів ${d.connectors.length}`);
  const bad = [];
  for (const e of d.edges) {
    for (const l of [0, e.lanes - 1]) { const m = minR(lane(e, l)); if (m.R < 12) bad.push(`  ребро ${e.id} смуга ${l}: R=${m.R.toFixed(1)} м у вузлі ${m.i}/${e.ref.length} (${e.ref[m.i].map(Math.round)})`); }
    // різкі злами ref
    for (let i = 1; i + 1 < e.ref.length; i++) { const t = Math.abs(wr(hd(e.ref[i], e.ref[i + 1]) - hd(e.ref[i - 1], e.ref[i]))); if (t > 0.5) { bad.push(`  ребро ${e.id}: злам ${(t * 57.3).toFixed(0)}° у вузлі ${i} (${e.ref[i].map(Math.round)})`); break; } }
    if (e.length < 15) bad.push(`  ребро ${e.id}: коротке ${e.length.toFixed(1)} м`);
  }
  for (const c of d.connectors) {
    const m = minR(c.path); const A = E[c.from.edge], B = E[c.to.edge];
    const la = lane(A, c.from.lane), lb = lane(B, c.to.lane);
    const p0 = c.path[0], p1 = c.path.at(-1);
    const gA = Math.hypot(p0[0] - la.at(-1)[0], p0[1] - la.at(-1)[1]), gB = Math.hypot(p1[0] - lb[0][0], p1[1] - lb[0][1]);
    const hA = Math.abs(wr(hd(c.path[0], c.path[2]) - hd(la.at(-2), la.at(-1)))), hB = Math.abs(wr(hd(c.path.at(-3), c.path.at(-1)) - hd(lb[0], lb[1])));
    const flag = m.R < 5 || gA > 0.6 || gB > 0.6 || hA > 0.25 || hB > 0.25;
    console.log(`  ${flag ? '!!' : '  '} ${c.id} ${c.turn.padEnd(5)} R=${m.R.toFixed(1)} зазор ${gA.toFixed(2)}/${gB.toFixed(2)} кут ${(hA * 57.3).toFixed(0)}°/${(hB * 57.3).toFixed(0)}° ${c.from.edge}>${c.to.edge}`);
  }
  // стики next
  for (const e of d.edges) for (const nx of e.next) { const B = E[nx]; for (let l = 0; l < Math.min(e.lanes, B.lanes); l++) { const a = lane(e, l).at(-1), b = lane(B, l)[0]; const g = Math.hypot(a[0] - b[0], a[1] - b[1]); const h = Math.abs(wr(hd(lane(e, l).at(-2), a) - hd(b, lane(B, l)[1]))); if (g > 0.5 || h > 0.2) bad.push(`  стик ${e.id}>${nx} смуга ${l}: зсув ${g.toFixed(2)} м, злам ${(h * 57.3).toFixed(0)}°`); } }
  console.log(bad.length ? bad.join('\n') : '  ребра/стики: ок');
}
