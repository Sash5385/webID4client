// Маршрути ТСЦ № 8041 (мережа OSM): зразковий учень проходить кожен маршрут без помилок.
import { describe, expect, it } from 'vitest';
import { withConfig } from '../src/engine/config';
import { has8041, NET_ROUTES_8041, Sim } from '../src/engine/sim';
import { NetPilot } from './autopilot1';

const IGNORED = new Set(['forcedBraking', 'leftLaneHog']);
const ONLY = process.env.R8041;

describe('ТСЦ 8041: маршрути проходяться автопілотом', () => {
  for (const id of NET_ROUTES_8041) {
    if (!has8041(id) || (ONLY && !id.endsWith(ONLY))) continue;
    for (const seed of [1, 8042]) {
      it(`${id}, seed ${seed}`, () => {
        const sim = new Sim(withConfig({ seed }), id);
        const pilot = new NetPilot(sim);
        while (!sim.result && sim.t < 4500) sim.step(pilot.controls(sim.cfg.dt));
        const codes = sim.faults.map((f) => f.code).filter((c) => !IGNORED.has(c));
        expect(codes).toEqual([]);
        expect(sim.result?.passed).toBe(true);
      }, 120000);
    }
  }
});
