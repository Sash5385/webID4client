// Розгін маршруту №1: npx tsx tools/r1.mts 1,2,3 ['{"opts":...}'] [--overlap]
// Друкує: seed, пройдено, причина, час заїзду, помилки, етап; з --overlap — перетини ІІ-ІІ / ІІ-райдер і найдовшу зупинку ІІ.
import { withConfig } from '../src/engine/config';
import { boxesOverlap } from '../src/engine/geometry';
import { Sim } from '../src/engine/sim';
import { NetPilot } from '../tests/autopilot1';
const args = process.argv.slice(2);
const overlap = args.includes('--overlap');
const pos = args.filter((a) => !a.startsWith('--'));
const opts = JSON.parse(pos[1] ?? '{}');
for (const seed of (pos[0] ?? '1,7,42,2026,8042').split(',').map(Number)) {
  const t0 = Date.now();
  const sim = new Sim(withConfig({ seed }), 'route1');
  const pilot = new NetPilot(sim, opts);
  const pairs = new Set<string>(), riderPairs = new Set<string>();
  const stillSince = new Map<number, number>(); let longest = 0, longestAt = '';
  while (!sim.result && sim.t < 900) {
    sim.step(pilot.controls(sim.cfg.dt));
    if (!overlap) continue;
    const cars = sim.traffic.cars;
    const b = cars.map((c) => sim.traffic.body(c));
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      if (cars[i]!.kind !== 'car' && cars[j]!.kind !== 'car') continue;
      if (Math.abs(b[i]!.box.x - b[j]!.box.x) > 8 || Math.abs(b[i]!.box.z - b[j]!.box.z) > 8) continue;
      if (boxesOverlap(b[i]!.box, b[j]!.box)) pairs.add(`${b[i]!.id}-${b[j]!.id}@${Math.round(b[i]!.box.x)},${Math.round(b[i]!.box.z)}t${Math.round(sim.t)}`);
    }
    for (const r of sim.riders.bodies()) for (const q of b) if (Math.abs(r.box.x - q.box.x) < 6 && Math.abs(r.box.z - q.box.z) < 6 && boxesOverlap(r.box, q.box)) riderPairs.add(`${r.id}-${q.id}@${Math.round(r.box.x)},${Math.round(r.box.z)}`);
    for (const c of cars) {
      if (c.kind !== 'car') continue;
      if (c.v > 0.1) stillSince.delete(c.id);
      else if (!stillSince.has(c.id)) stillSince.set(c.id, sim.t);
      else { const d = sim.t - stillSince.get(c.id)!; if (d > longest) { longest = d; longestAt = `#${c.id}@${Math.round(c.x)},${Math.round(c.z)}`; } }
    }
  }
  const ov = overlap ? ` | AI overlaps ${pairs.size} ${[...pairs].slice(0, 4).join(' ')} rider overlaps ${riderPairs.size} ${[...riderPairs].slice(0, 3).join(' ')} longest stop ${longest.toFixed(0)}s ${longestAt}` : '';
  console.log(seed, sim.result?.passed, sim.result?.reason, Math.round(sim.t), sim.faults.map((f) => `${f.code}@t${f.t.toFixed(1)} (${f.x.toFixed(1)},${f.z.toFixed(1)})`).join(' | '), sim.stage, `${Date.now() - t0}ms${ov}`);
}
