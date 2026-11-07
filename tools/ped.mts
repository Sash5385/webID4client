import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
const [seed, t0] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }));
const p = new Pilot(sim);
let k = 0;
while (!sim.result) {
  const c = p.controls(sim.cfg.dt); sim.step(c);
  if (sim.t > t0! && k++ % 6 === 0) {
    const w = sim.where;
    const f = sim.net.features.find(f => Math.abs(f.zone[w.dir][0] - w.s) < 40 && f.def.kind !== 'intersection');
    const peds = sim.peds.list.map(q => `${q.featureId} x${q.x.toFixed(1)} d${q.dir} dl${q.delay.toFixed(1)}`).join(' ');
    console.log(sim.t.toFixed(2), w.dir, 's', w.s.toFixed(1), 'v', sim.v.toFixed(1), c.gas?'G':c.brake?'B':'-', f ? `${f.def.id} zone ${f.zone[w.dir][0]} front ${(w.s+2.2).toFixed(1)} confl3 ${sim.peds.conflict(f.def.id, w.dir, 3)}` : '', '|', peds);
  }
}
console.log(sim.result?.reason);
