// Перевірка ІІ: перетини авто-авто й авто-райдер, «застрягання» (ніхто з ІІ не рухається довго).
// npx tsx tools/overlap.mts 1,7,42
import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { Pilot } from '../tests/autopilot';
import { boxesOverlap } from '../src/engine/geometry';
for (const seed of (process.argv[2] ?? "1,7,42,99,123").split(",").map(Number)) {
  const sim = new Sim(withConfig({ seed }));
  const p = new Pilot(sim);
  const pairs = new Set<string>(), riderPairs = new Set<string>(); let stuck = 0;
  const stillSince = new Map<number, number>(); let longest = 0, longestId = 0;
  while (!sim.result && sim.t < 900) {
    sim.step(p.controls(sim.cfg.dt));
    const cars = sim.traffic.cars;
    const b = cars.map(c => sim.traffic.body(c));
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      if (cars[i]!.kind !== 'car' && cars[j]!.kind !== 'car') continue;
      if (boxesOverlap(b[i]!.box, b[j]!.box)) pairs.add(`${b[i]!.id}-${b[j]!.id}@${Math.round(b[i]!.box.x)},${Math.round(b[i]!.box.z)}`);
    }
    for (const r of sim.riders.bodies()) for (const q of b) if (boxesOverlap(r.box, q.box)) riderPairs.add(`${r.id}-${q.id}@${Math.round(r.box.x)},${Math.round(r.box.z)}`);
    stuck = Math.max(stuck, cars.filter(c => c.kind === 'car' && c.v < 0.1).length);
    for (const c of cars) {
      if (c.kind !== 'car') continue;
      if (c.v > 0.1) stillSince.delete(c.id);
      else if (!stillSince.has(c.id)) stillSince.set(c.id, sim.t);
      else { const d = sim.t - stillSince.get(c.id)!; if (d > longest) { longest = d; longestId = c.id; } }
    }
  }
  console.log(seed, sim.result?.passed ?? 'timeout', 'AI overlaps:', pairs.size, [...pairs].slice(0, 6).join(' '), 'rider overlaps:', riderPairs.size, [...riderPairs].slice(0, 4).join(' '),
    'max stopped', stuck, 'longest stop', longest.toFixed(0) + 's #' + longestId, 'cars', sim.traffic.cars.filter(c => c.kind === 'car').length);
}
