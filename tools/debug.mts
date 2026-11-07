import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { run } from '../tests/autopilot';
const opts = JSON.parse(process.argv[3] ?? '{}');
for (const seed of (process.argv[2] ?? '1,7,42,2026,8042').split(',').map(Number)) {
  const sim = new Sim(withConfig({ seed }));
  run(sim, opts);
  console.log(seed, sim.result?.passed, sim.result?.reason, Math.round(sim.t), sim.faults.map(f => `${f.code}@t${f.t.toFixed(1)} (${f.x.toFixed(1)},${f.z.toFixed(1)}) stage?`).join(' | '), sim.stage);
}
