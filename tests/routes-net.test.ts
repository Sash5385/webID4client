// Маршрути №6 і №3 (та сама мережа OSM, що й №1): порядок проходження, розворот на вул. Мрії, помилки.
import { describe, expect, it } from 'vitest';
import { withConfig } from '../src/engine/config';
import { NET_ROUTES, Sim } from '../src/engine/sim';
import { NetPilot, run1 } from './autopilot1';

// forcedBraking і leftLaneHog — малі помилки (випадковий рух ІІ при перестроюванні; перебування в лівій смузі); решта має бути порожня.
const IGNORED = new Set(['forcedBraking', 'leftLaneHog']);
const codes = (sim: { faults: readonly { code: string }[] }): string[] => sim.faults.map((f) => f.code).filter((c) => !IGNORED.has(c));

function sequence(sim: InstanceType<typeof import('../src/engine/sim').NetSim>, pilot: NetPilot, maxT: number): string[] {
  const seq: string[] = [];
  const mark = (k: string): void => { if (seq[seq.length - 1] !== k) seq.push(k); };
  while (!sim.result && sim.t < maxT) {
    sim.step(pilot.controls(sim.cfg.dt));
    const w = sim.where;
    if (w.mode === 'edge') mark(sim.net.edge(w.edge!).data.chain ?? w.edge!);
    else if (w.mode === 'path' && w.conn && (w.pathKind === 'conn' || w.pathKind === 'adhoc')) mark(w.conn);
    else if (w.mode === 'ring') mark('ring');
  }
  return seq;
}

const TAIL = ['stet_se', 'J_UT:uturn', 'stet_nw', 'J_TUR:left', 'tur_w', 'J_MT:right', 'mrii_n', 'ring', 'n_out'];

describe('маршрути на мережі: список і дані', () => {
  it('усі NET_ROUTES створюються, мають кроки, старт і фініш', () => {
    for (const id of NET_ROUTES) {
      const sim = new Sim(withConfig({ seed: 3 }), id);
      expect(sim.route).toBe(id);
      const steps = sim.steps_;
      expect(steps[0]!.kind).toBe('edge');
      expect(steps.at(-1)!.kind).toBe('finish');
      expect(sim.data.route.length).toBeGreaterThan(2000);
    }
  });
});

describe('маршрут №6: Мрії до Турчина, розворот', () => {
  for (const seed of [1, 8042, 5]) {
    it(`зразковий учень проходить без помилок (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }), 'route6');
      const seq = sequence(sim, new NetPilot(sim), 1500);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'mrii_s', 'J_MT:uturn', 'mrii_n', 'ring', ...TAIL]);
    });
  }
  it('пропущено розворот на Мрії → offRoute', () => {
    const sim = new Sim(withConfig({ seed: 2 }), 'route6');
    run1(sim, { skipUturn: true });
    expect(sim.result?.passed).toBe(false);
    expect(sim.faults.at(-1)?.code).toBe('offRoute');
    expect(sim.faults.at(-1)?.message).toMatch(/Розворот/);
  });
});

describe('маршрут №3: Мрії до Салютної, розворот', () => {
  for (const seed of [1, 8042]) {
    it(`зразковий учень проходить без помилок (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }), 'route3');
      const seq = sequence(sim, new NetPilot(sim), 1800);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'mrii_s', 'J_SAL:uturn', 'mrii_n', 'ring', ...TAIL]);
    });
  }
});

describe('маршрут №4: Щербаківського → Салютна → Мрії', () => {
  for (const seed of [1, 8042]) {
    it(`зразковий учень проходить без помилок (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }), 'route4');
      const seq = sequence(sim, new NetPilot(sim), 1800);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'stet_se', 'J_VYH:se_right', 'vyh_s', 'sh_s', 'J_SH:right', 'sal_w', 'J_SAL:right', 'mrii_n', 'ring', 'n_out']);
    });
  }
});

describe('маршрут №5: Щербаківського до Ружинської, розворот', () => {
  for (const seed of [1, 8042]) {
    it(`зразковий учень проходить без помилок (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }), 'route5');
      const seq = sequence(sim, new NetPilot(sim), 1800);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'stet_se', 'J_VYH:se_right', 'vyh_s', 'sh_s', 'J_RUZ:uturn', 'sh_n', 'vyh_n', 'J_VYH:n_left', 'stet_nw', 'ring', 'n_out']);
    });
  }
  it('прямо замість лівого на Стеценку → offRoute', () => {
    const sim = new Sim(withConfig({ seed: 2 }), 'route5');
    run1(sim, { skipLeft: true }, 1500);
    expect(sim.result?.passed).toBe(false);
    expect(sim.faults.at(-1)?.code).toBe('offRoute');
  });
});

describe('маршрут №14: Виговського до вул. Некрасова, розворот', () => {
  for (const seed of [1, 8042]) {
    it(`зразковий учень проходить без помилок (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }), 'route14');
      const seq = sequence(sim, new NetPilot(sim), 1800);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'stet_se', 'J_VYH:se_left', 'vyh_n', 'vh_n', 'J_NEK:uturn', 'vh_s', 'vyh_s', 'J_VYH:s_right', 'stet_nw', 'ring', 'n_out']);
    });
  }
});

describe('маршрут №10: Салютна, Щербаківського, Ружинська, бульвар Вірського', () => {
  for (const seed of [1, 8042]) {
    it(`зразковий учень проходить без помилок (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }), 'route10');
      const seq = sequence(sim, new NetPilot(sim), 2400);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'mrii_s', 'J_SAL:left', 'sal_e', 'J_SH:e_right', 'sh_s', 'J_RUZ:left', 'ruz_e', 'J_VR:left', 'vir_n', 'J_VS:left', 'sal_w', 'J_SAL:right', 'mrii_n', 'ring', 'n_out']);
    });
  }
});

describe('маршрут №9: бульвар Вірського, Корчака, мінікруг', () => {
  for (const seed of [1, 8042]) {
    it(`зразковий учень проходить без помилок (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }), 'route9');
      const seq = sequence(sim, new NetPilot(sim), 2800);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'mrii_s', 'J_MT:s_left', 'tur_e', 'J_TUR:right_out', 'stet_se', 'J_VIR:se_right', 'vir_s', 'kor_ne', 'J_KOR:left', 'gm_w', 'J_GM:right', 'vir_n', 'J_VIR:n_left', 'stet_nw', 'ring', 'n_out']);
    });
  }
});

describe('маршрути №12 і №13: заїзд по Стеценці на північний захід', () => {
  for (const id of ['route12', 'route13'] as const) {
    it(`${id}: зразковий учень проходить без помилок`, () => {
      const sim = new Sim(withConfig({ seed: 1 }), id);
      const seq = sequence(sim, new NetPilot(sim), 1800);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'n_out', 'J_NW:uturn', 'w_in', 'ring', ...TAIL]);
    });
  }
});

describe('маршрут №15: Берестейський проспект, два розвороти', () => {
  it('зразковий учень проходить без помилок (seed 1)', () => {
    const sim = new Sim(withConfig({ seed: 1 }), 'route15');
    const seq = sequence(sim, new NetPilot(sim), 3600);
    expect(codes(sim)).toEqual([]);
    expect(sim.result?.passed).toBe(true);
    expect(seq).toEqual(['w_in', 'ring', 'mrii_s', 'ms2_s', 'J_BER:s_right', 'ber_w', 'J_BERW:uturn', 'ber_e', 'J_BERE:uturn', 'ber_w', 'J_BER:w_right', 'ms2_n', 'mrii_n', 'ring', 'n_out']);
  }, 600000);
});
