import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
const [seed, t0, t1] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }));
const p = new Pilot(sim, JSON.parse(process.argv[5] ?? '{}'));
let k = 0;
while (!sim.result && sim.t < t1!) {
  const c = p.controls(sim.cfg.dt);
  const ev = sim.step(c);
  for (const e of ev) if (e.type !== 'hint') console.log(sim.t.toFixed(2), JSON.stringify(e).slice(0, 160));
  if (sim.t >= t0! && k++ % 15 === 0) {
    const w = sim.where;
    const feats = sim.net.features.filter(f => Math.abs(f.stop[w.dir] - w.s) < 60).map(f => `${f.def.id}:${sim.light(f)}:${(f.stop[w.dir]-w.s-2.2).toFixed(1)}`).join(',');
    const near = sim.traffic.cars.filter(c => Math.hypot(c.x - sim.x, c.z - sim.z) < 25).map(c => `#${c.id}(${c.x.toFixed(1)},${c.z.toFixed(1)} v${c.v.toFixed(1)} ${c.legs[c.leg]!.kind})`).join(' ');
    console.log(sim.t.toFixed(2), w.mode, w.pathKind, w.dir, 'lane', w.lane, 's', w.s.toFixed(1), 'v', sim.v.toFixed(1), c.gas ? 'G' : c.brake ? 'B' : '-', 'sig', sim.sig, feats, '|', near);
  }
}
