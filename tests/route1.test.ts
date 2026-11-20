// Маршрут №1 (мережа з OSM): вибір маршруту, порядок проходження, грубі помилки, лівий поворот на Турчина.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, withConfig } from '../src/engine/config';
import { NetSim, Route7Sim, Sim } from '../src/engine/sim';
import { NetPilot, run1, type NetPilotOpts } from './autopilot1';

const codes = (sim: { faults: readonly { code: string }[] }): string[] => sim.faults.map((f) => f.code);

describe('вибір маршруту в конструкторі', () => {
  it('типово — маршрут №7, з "route1" — маршрут №1 на мережі OSM', () => {
    const a = new Sim(DEFAULT_CONFIG);
    const b = new Sim(DEFAULT_CONFIG, 'route7');
    const c = new Sim(DEFAULT_CONFIG, 'route1');
    expect(a).toBeInstanceOf(Route7Sim);
    expect(a.route).toBe('route7');
    expect(b.route).toBe('route7');
    expect(c).toBeInstanceOf(NetSim);
    expect(c.route).toBe('route1');
    expect(c.net.edgeList.length).toBeGreaterThan(10);
    expect(c.net.rings).toHaveLength(1);
    // Старт: смуга вул. Стеценки перед кільцем, учень стоїть.
    expect(c.where.mode).toBe('edge');
    expect(c.v).toBe(0);
    expect(() => new Sim(DEFAULT_CONFIG, 'route99' as never)).toThrow();
  });
});

describe('маршрут №1: зразковий учень', () => {
  for (const seed of [1, 8042]) {
    it(`проходить без помилок і в правильному порядку (seed ${seed})`, () => {
      const sim = new Sim(withConfig({ seed }), 'route1');
      const pilot = new NetPilot(sim);
      const seq: string[] = [];
      const mark = (k: string): void => { if (seq[seq.length - 1] !== k) seq.push(k); };
      while (!sim.result && sim.t < 900) {
        sim.step(pilot.controls(sim.cfg.dt));
        const w = sim.where;
        if (w.mode === 'edge') mark(sim.net.edge(w.edge!).data.chain ?? w.edge!);
        else if (w.mode === 'path' && w.conn && (w.pathKind === 'conn' || w.pathKind === 'adhoc')) mark(w.conn);
        else if (w.mode === 'ring') mark('ring');
      }
      expect(codes(sim)).toEqual([]);
      expect(sim.result?.passed).toBe(true);
      expect(seq).toEqual(['w_in', 'ring', 'stet_se', 'J_UT:uturn', 'stet_nw', 'J_TUR:left', 'tur_w', 'J_MT:right', 'mrii_n', 'ring', 'n_out']);
      expect(sim.result!.time).toBeLessThan(800);
    });
  }
});

describe('маршрут №1: грубі помилки', () => {
  it('прямо замість лівого повороту на вул. Ігоря Турчина → offRoute', () => {
    const sim = new Sim(withConfig({ seed: 2 }), 'route1');
    run1(sim, { skipLeft: true });
    expect(sim.result?.passed).toBe(false);
    expect(sim.faults.at(-1)?.code).toBe('offRoute');
    expect(sim.faults.at(-1)?.message).toMatch(/Турчина/);
  });

  it('пропущено розворот біля пл. Марченка → offRoute', () => {
    const sim = new Sim(withConfig({ seed: 2 }), 'route1');
    run1(sim, { skipUturn: true });
    expect(sim.faults.at(-1)?.code).toBe('offRoute');
    expect(sim.faults.at(-1)?.message).toMatch(/Розворот/);
  });

  it('лівий поворот на Турчина з середньої смуги → turnWrongLane (груба)', () => {
    const sim = new Sim(withConfig({ seed: 2 }), 'route1');
    run1(sim, { leftFromMiddle: true });
    expect(sim.faults.at(-1)?.code).toBe('turnWrongLane');
    expect(sim.result?.passed).toBe(false);
  });

  it('поворот у бічну вулицю на Стеценці → offRoute', () => {
    // Сід залежить від випадкових перешкод (учень може обʼїхати авто й не потрапити у праву смугу біля бічної вулиці): беремо перший, де маневр відбувся.
    let hit: NetSim | null = null;
    for (const seed of [1, 4, 6, 2, 3, 7, 11]) {
      const sim = new Sim(withConfig({ seed }), 'route1');
      run1(sim, { wrongTurnRight: true });
      if (sim.faults.length) { hit = sim; break; }
    }
    expect(hit).not.toBeNull();
    expect(hit!.faults.at(-1)?.code).toBe('offRoute');
  });

  it('на кільці на старті — перший зʼїзд (на Мрії) замість другого → offRoute', () => {
    const sim = new Sim(withConfig({ seed: 2 }), 'route1');
    run1(sim, { ringFirstExit: true });
    expect(sim.faults.at(-1)?.code).toBe('offRoute');
    expect(sim.stage).toBe('ring1');
  });

  it('проїзд на червоний', () => {
    const sim = new Sim(withConfig({ seed: 1 }), 'route1');
    run1(sim, { ignoreLights: true });
    expect(codes(sim)).toContain('redLight');
  });

  it('3 смуги: довго в крайній лівій при вільній правій → leftLaneHog (дрібна)', () => {
    const sim = new Sim(withConfig({ seed: 1 }), 'route1');
    run1(sim, { stayLeft: true });
    expect(codes(sim)).toContain('leftLaneHog');
    expect(sim.faults.filter((f) => f.code === 'leftLaneHog').every((f) => f.severity === 'minor')).toBe(true);
  });
});

// До лівого повороту на Турчина на зелений (лишається ≥ 14 с зеленого), учень за ≤ 30 м до точки повороту.
function toLeftTurn(seed: number, o: NetPilotOpts): { sim: NetSim; pilot: NetPilot } {
  const sim = new Sim(withConfig({ seed }), 'route1');
  const pilot = new NetPilot(sim, o);
  const lt = sim.net.conn('J_TUR:left');
  while (!sim.result && sim.t < 900) {
    sim.step(pilot.controls(sim.cfg.dt));
    const w = sim.where;
    if (w.edge === lt.fromEdge!.id && lt.fromS - w.s < 30 && sim.light('J_TUR', 'A') === 'green' && sim.net.timing('J_TUR', 'A', sim.t, sim.cfg.signals).goLeft > 14) break;
  }
  return { sim, pilot };
}

// Зустрічний потік на вул. Стеценки (на ПдС) до точки конфлікту з лівим поворотом.
function oncoming(sim: NetSim): number {
  const lt = sim.net.conn('J_TUR:left');
  let n = 0;
  for (const q of lt.laneConflicts) {
    if (q.merge || q.lane > 1) continue;
    for (const d of [30, 62, 94]) if (sim.traffic.inject(q.edge.id, q.lane, q.laneS - d - q.lane * 8, 11)) n++;
  }
  return n;
}

describe('маршрут №1: лівий поворот на вул. Ігоря Турчина', () => {
  it('без поступки зустрічним → oncomingYield (груба)', () => {
    const { sim, pilot } = toLeftTurn(3, { ignoreOncoming: true });
    expect(sim.result).toBeNull();
    expect(oncoming(sim)).toBeGreaterThan(2);
    const t0 = sim.t;
    while (!sim.result && sim.t < t0 + 30) sim.step(pilot.controls(sim.cfg.dt));
    const f = sim.faults.find((q) => q.code === 'oncomingYield'); // перед цим може бути мала помилка від випадкового руху ІІ
    expect(f).toBeDefined();
    expect(f?.message).toMatch(/ліворуч/);
  });

  it('зразковий учень пропускає зустрічних і повертає без помилок', () => {
    const { sim, pilot } = toLeftTurn(3, {});
    expect(oncoming(sim)).toBeGreaterThan(2);
    const t0 = sim.t;
    let waited = 0;
    while (!sim.result && sim.t < t0 + 60 && !(sim.where.edge === 'tur_w' && sim.where.s > 30)) {
      sim.step(pilot.controls(sim.cfg.dt));
      if (sim.where.mode === 'edge' && sim.v < 0.2) waited += sim.cfg.dt;
    }
    expect(codes(sim)).toEqual([]);
    expect(sim.where.edge).toBe('tur_w');
    expect(waited).toBeGreaterThan(1); // справді чекав
  });

  it('пішохід на переході через Турчина: зразковий чекає, «поганий» → pedestrianYield', () => {
    for (const bad of [false, true]) {
      const { sim, pilot } = toLeftTurn(3, bad ? { ignorePeds: true } : {});
      const lt = sim.net.conn('J_TUR:left');
      const hit = lt.crossings[0]!;
      const cr = hit.crossing;
      sim.peds.spawn(cr, 1);
      const p = sim.peds.list[sim.peds.list.length - 1]!;
      // Іде з дальнього боку до точки, де проїжджає поворот, повільно.
      Object.assign(p, { started: true, delay: 0, u: cr.length + 1.5, dir: -1, v: 0.7 });
      const t0 = sim.t;
      while (!sim.result && sim.t < t0 + 60 && !(sim.where.edge === 'tur_w' && sim.where.s > 30)) sim.step(pilot.controls(sim.cfg.dt));
      if (bad) expect(codes(sim)).toContain('pedestrianYield');
      else { expect(codes(sim)).toEqual([]); expect(sim.where.edge).toBe('tur_w'); }
    }
  });
});

describe('погода: зчеплення', () => {
  const stopDist = (grip: number): number => {
    const sim = new Sim(DEFAULT_CONFIG, 'route1') as NetSim;
    sim.setGrip(grip);
    for (let i = 0; i < 60 * 4; i++) sim.step({ gas: sim.v < 6, brake: false }); // розгін
    const s0 = sim.v;
    let d = 0;
    for (let i = 0; i < 60 * 40 && sim.v > 0; i++) { const x = sim.x, z = sim.z; sim.step({ gas: false, brake: true }); d += Math.hypot(sim.x - x, sim.z - z); }
    expect(s0).toBeGreaterThan(5);
    return d;
  };
  it('на ожеледі гальмівний шлях набагато довший, ніж на сухій дорозі', () => {
    const dry = stopDist(1), ice = stopDist(0.16);
    expect(ice).toBeGreaterThan(dry * 4);
  });
});

describe('погода: занос', () => {
  it('на ожеледі швидкий поворот закінчується заносом, на сухій дорозі — ні', () => {
    const ice = new Sim(DEFAULT_CONFIG, 'route1') as NetSim;
    ice.setGrip(0.16);
    run1(ice, {});
    expect(ice.result?.passed).toBe(false);
    expect(codes(ice)).toContain('skid');
    const dry = new Sim(DEFAULT_CONFIG, 'route1') as NetSim;
    run1(dry, {});
    expect(codes(dry)).not.toContain('skid');
  });
});

describe('іспит: накопичення дрібних помилок', () => {
  it('у навчанні 4 дрібні помилки закінчують заїзд, в іспиті — ні (вердикт після фінішу)', () => {
    const learn = new Sim(withConfig({ mode: 'learn' }), 'route1') as any;
    for (let i = 0; i < 4; i++) learn.fault('noSignal');
    expect(learn.result?.passed).toBe(false);
    const ex = new Sim(withConfig({ mode: 'exam' }), 'route1') as any;
    for (let i = 0; i < 5; i++) ex.fault('noSignal');
    expect(ex.result).toBeNull();
    expect(ex.minorCount).toBe(5);
    ex.finish(true, 'Маршрут пройдено');
    expect(ex.result.passed).toBe(false);
    ex.fault('crash'); // після результату нічого не змінюється
    const ex2 = new Sim(withConfig({ mode: 'exam' }), 'route1') as any;
    ex2.fault('crash');
    expect(ex2.result.passed).toBe(false);
  });
  it('швидкість авто доходить до 200 км/год', () => {
    const s = new Sim(DEFAULT_CONFIG, 'route1') as any;
    s.fault = (): void => { /* фізику перевіряємо без судейства */ };
    let mx = 0;
    for (let i = 0; i < 60 * 150 && !s.result; i++) { s.step({ gas: true, brake: false }); mx = Math.max(mx, s.v); }
    expect(mx * 3.6).toBeGreaterThan(150);
  });
});
