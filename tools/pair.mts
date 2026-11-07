import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
import { boxesOverlap } from '../src/engine/geometry';
const [seed, a, b] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }));
const p = new Pilot(sim);
let first = -1;
while (!sim.result) {
  sim.step(p.controls(sim.cfg.dt));
  const A = sim.traffic.cars.find(c => c.id === a), B = sim.traffic.cars.find(c => c.id === b);
  if (!A || !B) { if (first > 0) break; continue; }
  const d = Math.hypot(A.x - B.x, A.z - B.z);
  if (d < 8) { if (first < 0) first = sim.t; console.log(sim.t.toFixed(2), [A, B].map(c => `#${c.id}(${c.x.toFixed(1)},${c.z.toFixed(1)} a${c.a.toFixed(2)} v${c.v.toFixed(1)} ${c.legs[c.leg]!.kind}${c.legs[c.leg]!.arm ?? ''} s${c.s.toFixed(1)} L${c.legs[c.leg]!.path.length.toFixed(1)})`).join(' '), boxesOverlap(sim.traffic.body(A).box, sim.traffic.body(B).box) ? 'OVERLAP' : ''); }
  if (first > 0 && sim.t > first + 4) break;
}
