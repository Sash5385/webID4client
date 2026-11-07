import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
const [seed, back] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }));
const p = new Pilot(sim);
const hist: string[] = [];
while (!sim.result) {
  const c = p.controls(sim.cfg.dt); sim.step(c);
  const near = sim.traffic.cars.filter(c => Math.hypot(c.x - sim.x, c.z - sim.z) < 12).map(c => `#${c.id}(${c.x.toFixed(1)},${c.z.toFixed(1)} a${c.a.toFixed(2)} v${c.v.toFixed(1)} ${c.legs[c.leg]!.kind}${c.legs[c.leg]!.arm ?? ''} s${c.s.toFixed(1)})`).join(' ');
  hist.push(`${sim.t.toFixed(2)} ${sim.where.mode}/${sim.where.pathKind} p(${sim.x.toFixed(1)},${sim.z.toFixed(1)} a${sim.a.toFixed(2)}) v${sim.v.toFixed(1)} ${c.gas?'G':c.brake?'B':'-'} | ${near}`);
}
console.log(hist.slice(-(back ?? 40)).filter((_, i) => i % 5 === 0).join('\n'));
console.log(sim.result?.reason);
