// Стан поворотів/замків ІІ на момент T: npx tsx tools/turners.mts seed T
import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
const [seed, T] = process.argv.slice(2).map(Number);
const sim = new Sim(withConfig({ seed }));
const p = new Pilot(sim);
while (!sim.result && sim.t < T!) sim.step(p.controls(sim.cfg.dt));
const tr = sim.traffic as any;
console.log('why', [...(tr.why as Map<number,string>).entries()].join(' | '));
console.log('locks', [...tr.locks.entries()], 'holding', [...tr.holding]);
for (const c of sim.traffic.cars) {
  if (c.kind !== 'car') continue;
  if (Math.hypot(c.x - sim.x, c.z - sim.z) > 90) continue;
  const leg = c.legs[c.leg]!;
  console.log(`#${c.id} (${c.x.toFixed(1)},${c.z.toFixed(1)}) v${c.v.toFixed(1)} leg${c.leg}:${leg.kind}${leg.dir ?? ''}${leg.lane ?? ''} s${c.s.toFixed(1)}/${leg.path.length.toFixed(1)} off${c.off.toFixed(2)}/${c.offT.toFixed(2)} turn${c.turn} lead${c.leadId} acc${c.acc.toFixed(1)}`, c.plan ? `plan ${c.plan.key} dir${c.plan.dir} left${c.plan.left} main${c.plan.fromMain} done${c.plan.done} commit${c.commit}` : '');
}
for (const r of sim.riders.list) console.log('rider', r.id, r.dir, r.x.toFixed(1), r.z.toFixed(1), 'v', r.v.toFixed(1), r.turn ? 'turning' : '');
