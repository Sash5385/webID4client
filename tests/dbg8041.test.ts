import { it } from 'vitest';
import { withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { NetPilot } from './autopilot1';
it('dbg', () => {
  const id = process.env.R8041 ? 'r8041_' + process.env.R8041 : 'r8041_1';
  const sim = new Sim(withConfig({ seed: Number(process.env.SEED ?? 1) }), id);
  const pilot = new NetPilot(sim);
  let last = -1, still = 0;
  while (!sim.result && sim.t < 4500) {
    sim.step(pilot.controls(sim.cfg.dt));
    const w = sim.where;
    still = sim.player.v < 0.05 ? still + 1 : 0;
    if (still > 60 * 40) { const sm = sim as any; console.log('PEDS', JSON.stringify(sim.peds.list.filter((q: any) => Math.hypot(q.x - sim.player.x, q.z - sim.player.z) < 40).map((q: any) => [Math.round(q.x - sim.player.x), Math.round(q.z - sim.player.z), q.kind, q.started])), 'riders', JSON.stringify(sim.riders.list.filter((q: any) => Math.hypot(q.x - sim.player.x, q.z - sim.player.z) < 40).map((q: any) => [Math.round(q.x - sim.player.x), Math.round(q.z - sim.player.z)])));
      console.log('LANEBLK', JSON.stringify(sm.traffic.cars.filter((c: any) => Math.hypot(c.x - sim.player.x, c.z - sim.player.z) < 60).map((c: any) => [c.kind, Math.round(c.x - sim.player.x), Math.round(c.z - sim.player.z), c.v.toFixed(1), c.legs[c.leg]?.edge?.id, c.legs[c.leg]?.lane, c.s.toFixed(0)])), 'prep', JSON.stringify(sim.prepDistances()), 'dbg', JSON.stringify(pilot.dbg), 'lane', w.lane, 'sig', sim.sig);
      { const pp = pilot as any; const e = sim.net.edge(w.edge!); console.log('GAPS', 'cars', pp.carsAhead(40, 1.8, 6), 'turner', pp.turnerGap(), 'jay', JSON.stringify(sim.peds.jaywalkersOn(e.id, 3).map((j: any) => j.s)), 'obstIn', pp.obstacleIn(e, 1, 0, 150, 45, 9));
      console.log('INT', 'blocker', JSON.stringify(pp.laneBlocker(e, 0)), 'solid', pp.inSolid(e, w.s), 'sigWait', pp.sigWait, 'nextedge', JSON.stringify(sim.steps_[w.step + 1]), 'changing', w.changing, 'sim.sig', sim.sig); }
      console.log('PL', sim.player.x.toFixed(0), sim.player.z.toFixed(0), 'CAR0', JSON.stringify(sm.traffic.cars.slice(0,3).map((c: any) => [c.x.toFixed(0), c.z.toFixed(0), c.leg, c.s.toFixed(0), c.kind])));
      console.log('CARS', JSON.stringify(sm.traffic.cars.filter((c: any) => Math.hypot(c.x - sim.player.x, c.z - sim.player.z) < 25).map((c: any) => [JSON.stringify(c.legs?.map((l: any) => l.edge?.id ?? l.conn?.id ?? Object.keys(l).join('/')).slice(0, 3)), c.leg, c.s?.toFixed?.(0), c.lane, c.v.toFixed(1), c.mode])));
      console.log('PILOT', JSON.stringify(pilot.dbg), 'lane', w.lane, 'n', sim.net.edge(w.edge!).n, 'sig', sim.sig);
      console.log('STUCK', w.mode, w.edge, w.s, 'hold', sm.hold, 'next', JSON.stringify(sim.next), 'obst', sm.traffic.cars.filter((c: any) => Math.hypot(c.x - sim.player.x, c.z - sim.player.z) < 25).map((c: any) => [c.kind, Math.round(c.x - sim.player.x), Math.round(c.z - sim.player.z), c.v.toFixed(1)].join(':')).join(' ')); break; }
    if (Math.floor(sim.t) % 20 === 0 && Math.floor(sim.t) !== last) { last = Math.floor(sim.t); console.log(Math.floor(sim.t), w.mode, w.edge ?? w.conn, 'lane', w.lane, 's', w.s.toFixed(0), 'v', sim.player.v.toFixed(1), 'step', w.step); }
  }
  if (sim.result && !sim.result.passed) { const sm = sim as any; console.log('NEAR', JSON.stringify(sm.traffic.cars.filter((c: any) => Math.hypot(c.x - sim.player.x, c.z - sim.player.z) < 30).map((c: any) => [c.kind, Math.round(c.x - sim.player.x), Math.round(c.z - sim.player.z), c.v.toFixed(1), c.legs.map((l: any) => l.edge?.id ?? l.conn?.id).slice(0, 4).join('>')]))); }
  console.log('WHERE', JSON.stringify(sim.where));
  console.log('END', sim.t.toFixed(0), JSON.stringify(sim.result), sim.faults.map((f) => f.code + ':' + (f.message ?? '')).join(' | '));
}, 300000);
