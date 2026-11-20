import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
const [seed, T, id] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }));
const p = new Pilot(sim);
while (!sim.result && sim.t < T!) sim.step(p.controls(sim.cfg.dt));
const tr = sim.traffic as any;
const c = tr.cars.find((q: any) => q.id === id);
const bodies = [{ id: 0, box: { x: sim.x, z: sim.z, a: sim.a, hl: 2.2, hw: 0.9 }, v: sim.v }, ...tr.cars.map((q: any) => tr.body(q))];
for (const b of bodies) {
  const leg = c.legs[c.leg]; const pr = leg.path.project(b.box.x, b.box.z);
  if (Math.abs(pr.d) < 2.5) console.log('body', b.id, b.box.x.toFixed(1), b.box.z.toFixed(1), 'proj s', pr.s.toFixed(1), 'd', pr.d.toFixed(2), 'c.s', c.s.toFixed(1));
}
console.log('lead', tr.leader(c, sim.t, bodies, [], sim.peds));
console.log('mustYield', tr.mustYield(c, c.legs[c.leg], bodies, [], 2.5), 'player', sim.x.toFixed(1), sim.z.toFixed(1));
