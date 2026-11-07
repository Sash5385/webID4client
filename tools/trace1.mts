// Слід заїзду маршруту №1: npx tsx tools/trace1.mts seed t0 t1 [opts]
import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { NetPilot } from '../tests/autopilot1';
const [seed, t0, t1] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }), 'route1');
const p = new NetPilot(sim, JSON.parse(process.argv[5] ?? '{}'));
let k = 0;
while (!sim.result && sim.t < t1!) {
  const c = p.controls(sim.cfg.dt);
  const ev = sim.step(c);
  for (const e of ev) if (e.type !== 'hint') console.log(sim.t.toFixed(2), JSON.stringify(e).slice(0, 220));
  if (sim.t >= t0! && k++ % 15 === 0) {
    const w = sim.where;
    const near = sim.traffic.cars.filter((q) => Math.hypot(q.x - sim.x, q.z - sim.z) < 25).map((q) => `#${q.id}(${q.x.toFixed(0)},${q.z.toFixed(0)} v${q.v.toFixed(1)} ${q.legs[q.leg]!.kind}${q.kind !== 'car' ? q.kind : ''})`).join(' ');
    console.log(sim.t.toFixed(2), w.mode, w.pathKind ?? '', w.edge ?? w.conn ?? w.ring, 'L', w.lane, 's', w.s.toFixed(1), 'v', sim.v.toFixed(1), c.gas ? 'G' : c.brake ? 'B' : '-', 'sig', sim.sig, 'arm', w.armed ?? w.armedExit ?? '', '|', near);
  }
}
console.log(sim.result?.reason, sim.t.toFixed(1));
