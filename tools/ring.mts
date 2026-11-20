import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
import { mod } from '../src/engine/geometry';
const [seed, t0] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }));
const p = new Pilot(sim);
let k = 0;
while (!sim.result) {
  const c = p.controls(sim.cfg.dt); sim.step(c);
  if (sim.t > t0! && k++ % 10 === 0) {
    const th = sim.net.arms.S.mergeTheta;
    const ring = sim.traffic.cars.filter(c => Math.abs(Math.hypot(c.x, c.z) - 14) < 3.5).map(c => { const up = mod(th - Math.atan2(-c.z, c.x), 2*Math.PI) * 14; return `#${c.id} up${up.toFixed(1)} v${c.v.toFixed(1)} t${(up/Math.max(1,c.v)).toFixed(1)} ${c.legs[c.leg]!.kind}`; }).join(' ');
    console.log(sim.t.toFixed(2), sim.where.mode, (sim.where.pathLength - sim.where.s).toFixed(1), 'v', sim.v.toFixed(1), c.gas?'G':c.brake?'B':'-', '|', ring);
  }
}
console.log(sim.result?.reason);
