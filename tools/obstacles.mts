import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
const sim = new Sim(withConfig({ seed: Number(process.argv[2] ?? 1) }));
for (const c of sim.traffic.cars.filter(c => c.kind !== 'car')) { const q = sim.net.streetSlot(c.x, c.z)!; console.log(c.kind, q.dir, q.lane, q.s.toFixed(1), c.len.toFixed(1)); }
console.log('riders', sim.riders.list.map(r => `${r.kind} ${r.dir} s${r.s.toFixed(0)} v${r.v0.toFixed(1)}`).join(', '));
console.log('peds', sim.peds.list.map(p => p.kind).join(','));
