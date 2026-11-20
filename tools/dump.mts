import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
const [seed, T] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }));
const p = new Pilot(sim);
while (!sim.result && sim.t < T!) sim.step(p.controls(sim.cfg.dt));
for (const c of sim.traffic.cars) { const r = Math.hypot(c.x, c.z); if (r < 45) console.log(c.id, c.x.toFixed(1), c.z.toFixed(1), 'r', r.toFixed(1), 'v', c.v.toFixed(2), c.legs.map((l, i) => (i === c.leg ? '*' : '') + l.kind + (l.arm ?? '')).join('>'), 's', c.s.toFixed(1)); }
