// Нові учасники руху: перешкоди в смугах, повороти ІІ, вело/самокати, пішоходи поза переходом.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, withConfig } from '../src/engine/config';
import { boxesOverlap, type Path } from '../src/engine/geometry';
import type { Car } from '../src/engine/traffic';
import { Sim } from '../src/engine/sim';
import { Pilot, type PilotOpts } from './autopilot';

const codes = (sim: Sim): string[] => sim.faults.map((f) => f.code);

// Їхати автопілотом, поки pred() не стане true (або кінець).
function drive(sim: Sim, o: PilotOpts, pred: () => boolean, maxT = 900): Pilot {
  const pilot = new Pilot(sim, o);
  while (!sim.result && sim.t < maxT && !pred()) sim.step(pilot.controls(sim.cfg.dt));
  return pilot;
}

describe('розстановка', () => {
  it('перешкоди: обидва напрямки, подалі від переходів, кільця й гравця', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = new Sim(withConfig({ seed }));
      const O = sim.cfg.obstacles;
      const stat = sim.traffic.cars.filter((c) => c.kind !== 'car');
      expect(stat.some((c) => c.kind === 'broken' && c.hazard)).toBe(true);
      expect(stat.some((c) => c.kind === 'parked' && !c.hazard)).toBe(true);
      for (const c of stat) {
        const q = sim.net.streetSlot(c.x, c.z)!;
        expect(q).not.toBeNull();
        expect(c.v).toBe(0);
        if (q.dir === 'N') expect(q.s).toBeLessThan(sim.cfg.street.length - O.ringClear);
        for (const f of sim.net.features) {
          expect(q.s < f.stop[q.dir] - O.clearBeforeStop + 3 || q.s > f.zone[q.dir][1] + O.clearAfterZone - 3).toBe(true);
        }
        expect(Math.hypot(c.x - sim.x, c.z - sim.z)).toBeGreaterThan(O.playerClear);
      }
      for (const dir of ['S', 'N'] as const) expect(stat.some((c) => sim.net.streetSlot(c.x, c.z)!.dir === dir)).toBe(true);
      // Не перетинаються між собою.
      for (let i = 0; i < stat.length; i++) for (let j = i + 1; j < stat.length; j++) {
        expect(boxesOverlap(sim.traffic.body(stat[i]!).box, sim.traffic.body(stat[j]!).box)).toBe(false);
      }
      expect(sim.riders.list.length).toBeGreaterThan(0);
      expect(sim.peds.list.some((p) => p.kind === 'sidewalk')).toBe(true);
      expect(sim.peds.list.some((p) => p.kind === 'stop')).toBe(true);
    }
  });
});

describe('перешкоди в смузі', () => {
  it('обʼїзд припаркованого без покажчика → noSignal', () => {
    const sim = new Sim(withConfig({ seed: 1 }));
    // Перша помилка — зʼїзд з кільця без покажчика, друга — перше перестроювання на Мрії (обʼїзд).
    drive(sim, { noSignals: true }, () => sim.faults.length > 1);
    const f = sim.faults[1]!;
    expect(f.code).toBe('noSignal');
    expect(sim.net.streetSlot(f.x, f.z)).not.toBeNull();
    // Перестроювання почалося через нерухому перешкоду попереду в смузі гравця (до 95 м).
    const q = sim.net.streetSlot(f.x, f.z)!;
    expect(sim.traffic.cars.some((c) => {
      if (c.kind === 'car') return false;
      const o = sim.net.streetSlot(c.x, c.z)!;
      return o.dir === q.dir && o.lane === q.lane && o.s > q.s && o.s - q.s < 95;
    })).toBe(true);
    expect(sim.result).toBeNull(); // дрібна — їдемо далі
  });

  it('торкнувся припаркованого/зламаного → аварія, «Не склав»', () => {
    const sim = new Sim(withConfig({ seed: 1 }));
    drive(sim, { ramStatics: true }, () => false);
    expect(sim.result?.passed).toBe(false);
    expect(sim.faults.at(-1)?.code).toBe('crash');
    expect(sim.result?.reason).toMatch(/припаркованим|аварійці/);
  });
});

describe('велосипедисти й самокатники', () => {
  it('протиснувся повз райдера у своїй смузі → closeOvertake (дрібна), без зіткнення', () => {
    const sim = new Sim(withConfig({ seed: 1 }));
    drive(sim, { squeezeRiders: true }, () => sim.faults.length > 0);
    expect(sim.faults[0]?.code).toBe('closeOvertake');
    expect(sim.faults[0]?.severity).toBe('minor');
  });
});

describe('пішохід поза переходом', () => {
  it('наїзд на порушника → pedestrianHit', () => {
    const sim = new Sim(withConfig({ seed: 3, peds: { ...DEFAULT_CONFIG.peds, jaywalkChance: 0 } }));
    const pilot = drive(sim, {}, () => sim.stage === 'south' && sim.where.mode === 'street' && sim.where.s > 70 && sim.v > 8 && !sim.where.changing);
    // Виходить просто перед капотом у смузі гравця.
    const p = sim.peds.spawnJaywalker('S', sim.z + 7);
    p.x = sim.x - 1.2;
    while (!sim.result && sim.t < 900) { pilot.controls(sim.cfg.dt); sim.step({ gas: true, brake: false }); }
    expect(sim.faults.at(-1)?.code).toBe('pedestrianHit');
  });

  it('зразковий учень зупиняється перед порушником і проходить без помилок', () => {
    let seen = 0;
    for (const seed of [2, 4]) {
      const sim = new Sim(withConfig({ seed, peds: { ...DEFAULT_CONFIG.peds, jaywalkChance: 1 } }));
      const pilot = new Pilot(sim);
      let jw = false;
      while (!sim.result && sim.t < 900) {
        sim.step(pilot.controls(sim.cfg.dt));
        if (sim.peds.list.some((q) => q.kind === 'jaywalker')) jw = true;
      }
      if (jw) seen++;
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('не пропустив порушника на своїй половині → pedestrianYield', () => {
    const sim = new Sim(withConfig({ seed: 2, peds: { ...DEFAULT_CONFIG.peds, jaywalkChance: 1 } }));
    drive(sim, { ignoreJaywalker: true }, () => false);
    expect(codes(sim)).toContain('pedestrianYield');
  });
});

describe('повороти ІІ', () => {
  type SideTurn = { key: string; inPath: Path; turn: Path; dir: 'S' | 'N'; lane: 0 | 1; sJoin: number; sign: -1 | 1; left: boolean };
  // Сценарій: учень на правій смузі S за ~34 м до місця, де авто з двору (d2) вже рушило на Мрію (має перевагу).
  function scenario(seed: number, o: PilotOpts): { sim: Sim; pilot: Pilot; car: Car } {
    const sim = new Sim(withConfig({ seed }));
    const st = (sim.traffic as unknown as { sideTurns: SideTurn[] }).sideTurns.find((q) => q.key === '' && q.dir === 'S' && q.sJoin > 200)!;
    const pilot = drive(sim, o, () => sim.stage === 'south' && sim.where.mode === 'street' && sim.where.s > st.sJoin - 34);
    const lane = sim.net.lanes[st.dir][st.lane];
    const s0 = st.inPath.length - 0.5, p = st.inPath.pose(s0);
    const car: Car = {
      id: 999, legs: [
        { path: st.inPath, kind: 'side' }, { path: st.turn, kind: 'turn' },
        { path: lane.slice(st.sJoin, lane.length), kind: 'lane', dir: st.dir, lane: st.lane, sOffset: st.sJoin },
      ], leg: 0, s: s0, v: 4, v0: 12, len: 4.4, color: 0xffffff, x: p.x, z: p.z, a: p.a, braking: false,
      kind: 'car', hazard: false, turn: 1, off: 0, offT: 0, lcSig: 0, acc: 0, leadId: -1,
      plan: { key: '', dir: 1, turnLeg: 1, fromMain: false, left: false, feature: null, done: false }, commit: true, // уже рушив
    };
    sim.traffic.cars.push(car);
    return { sim, pilot, car };
  }

  it('не поступився ІІ, що вже виїжджає з двору перед ним → forcedBraking', () => {
    const { sim, pilot } = scenario(6, { ignoreTurners: true });
    expect(sim.where.lane).toBe(1);
    while (!sim.result && sim.faults.length === 0 && sim.t < 900) { pilot.controls(sim.cfg.dt); sim.step({ gas: true, brake: false }); }
    expect(sim.faults[0]?.code).toBe('forcedBraking');
  });

  it('зразковий учень у тій самій ситуації поступається — без помилок', () => {
    const { sim, pilot } = scenario(6, {});
    const t0 = sim.t;
    while (!sim.result && sim.t < t0 + 15) sim.step(pilot.controls(sim.cfg.dt));
    expect(codes(sim)).toEqual([]);
  });
});
