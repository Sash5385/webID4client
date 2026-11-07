import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, withConfig } from '../src/engine/config';
import { Sim } from '../src/engine/sim';
import { run } from './autopilot';

const codes = (sim: Sim): string[] => sim.faults.map((f) => f.code);

describe('повний маршрут', () => {
  for (const seed of [1, 7, 42, 2026, 8042]) {
    it(`зразковий учень проходить без помилок (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }));
      run(sim);
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(sim.result!.time).toBeLessThan(420);
    });
  }
});

describe('грубі помилки — одразу «Не склав»', () => {
  it('проїзд на червоний', () => {
    const sim = new Sim(withConfig({ seed: 3 }));
    run(sim, { ignoreLights: true });
    expect(sim.result?.passed).toBe(false);
    expect(codes(sim)).toContain('redLight');
  });

  it('пропущено зʼїзд з кільця', () => {
    const sim = new Sim(DEFAULT_CONFIG);
    run(sim, { neverExit: true });
    expect(sim.result?.passed).toBe(false);
    expect(sim.faults.at(-1)?.code).toBe('offRoute');
  });

  it('розворот не на тому перехресті', () => {
    const sim = new Sim(DEFAULT_CONFIG);
    run(sim, { uturnAtFirst: true });
    expect(sim.faults.at(-1)?.code).toBe('offRoute');
    expect(sim.result?.passed).toBe(false);
  });
});

describe('дрібні помилки', () => {
  it('перевищення швидкості рахується раз за епізод', () => {
    const sim = new Sim(withConfig({ seed: 5 }));
    run(sim, { target: 16 });
    expect(codes(sim)).toContain('speeding');
  });

  it('без покажчиків — 4 помилки й «Не склав»', () => {
    const sim = new Sim(DEFAULT_CONFIG);
    run(sim, { noSignals: true });
    expect(sim.result?.passed).toBe(false);
    expect(sim.result?.minor).toBe(4);
    expect(codes(sim)).toContain('noSignal');
    expect(sim.faults.every((f) => f.severity === 'minor' || f.code === 'uturnWrongLane')).toBe(true);
  });

  it('розворот до середини перехрестя', () => {
    const sim = new Sim(DEFAULT_CONFIG);
    run(sim, { uturnEarly: true });
    expect(codes(sim)).toContain('uturnNotCenter');
  });

  it('довго в лівій смузі при вільній правій', () => {
    // Без перешкод у смугах: інакше права смуга майже весь час «зайнята» (припарковані попереду).
    const obstacles = { ...DEFAULT_CONFIG.obstacles, parkedStretches: [0, 0] as [number, number], brokenPerDir: [0, 0] as [number, number] };
    const sim = new Sim(withConfig({ seed: 1, obstacles }));
    run(sim, { stayLeft: true });
    expect(codes(sim)).toContain('leftLaneHog');
  });

  it('перший зʼїзд з внутрішньої смуги кільця — помилка', () => {
    const sim = new Sim(DEFAULT_CONFIG);
    run(sim, { ring1Inner: true });
    expect(codes(sim)).toContain('ringExitLane');
  });
});

describe('кільце з двома смугами', () => {
  it('з лівої смуги Мрії — у внутрішню, зʼїзд до фінішу з неї без помилки', () => {
    for (const seed of [2, 9]) {
      const sim = new Sim(withConfig({ seed }));
      run(sim, { approachLeft: true });
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
    }
  });
});
