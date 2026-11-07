// Парковка: вправи розвʼязувані (пошук випадковими маневрами), зіткнення фіксуються, гальмівний шлях залежить від зчеплення.
import { describe, expect, it } from 'vitest';
import { obbHit, ParkSim, type ParkKind } from '../src/engine/parking';

interface Seg { rev: boolean; steer: number; sec: number; gas: boolean }

function run(kind: ParkKind, segs: Seg[]): ParkSim {
  const s = new ParkSim(kind);
  for (const sg of segs) {
    for (let i = 0, n = Math.round(sg.sec * 60); i < n && !s.result; i++) s.step({ gas: sg.gas, brake: false, steer: sg.steer, reverse: sg.rev });
    if (s.result) return s;
  }
  for (let i = 0; i < 60 * 8 && !s.result; i++) s.step({ gas: false, brake: true, steer: 0, reverse: false }); // зупинка
  return s;
}

// Простий генератор для відтворюваності.
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

export function search(kind: ParkKind, seed: number, tries: number): Seg[] | null {
  const r = rng(seed);
  const steers = [-1, -0.6, 0, 0.6, 1];
  for (let k = 0; k < tries; k++) {
    const n = kind === 'turn' ? 3 : 3 + Math.floor(r() * 4);
    const segs: Seg[] = [];
    for (let i = 0; i < n; i++) segs.push({ rev: kind === 'turn' ? i === 1 : i === 0 ? false : r() < 0.7, steer: steers[Math.floor(r() * steers.length)]!, sec: 0.4 + r() * 4, gas: true });
    const s = run(kind, segs);
    if (s.result?.passed) return segs;
  }
  return null;
}

describe('парковка', () => {
  it('OBB: перетин і розрив', () => {
    expect(obbHit({ x: 0, z: 0, hl: 2, hw: 1, a: 0 }, { x: 1.5, z: 0, hl: 1, hw: 1, a: 0 })).toBe(true);
    expect(obbHit({ x: 0, z: 0, hl: 2, hw: 1, a: 0 }, { x: 5, z: 0, hl: 1, hw: 1, a: 0 })).toBe(false);
    expect(obbHit({ x: 0, z: 0, hl: 2, hw: 0.5, a: Math.PI / 2 }, { x: 0, z: 1.2, hl: 0.4, hw: 0.4, a: 0 })).toBe(false);
  });
  it('наїзд на авто — провал із повідомленням', () => {
    const s = new ParkSim('parallel');
    for (let i = 0; i < 60 * 6 && !s.result; i++) s.step({ gas: true, brake: false, steer: 0.3, reverse: false });
    expect(s.result?.passed).toBe(false);
  });
  it('на ожеледі гальмівний шлях довший', () => {
    const d = (g: number): number => { const s = new ParkSim("parallel"); s.setGrip(g); s.setGrip(g); for (let i = 0; i < 400; i++) s.step({ gas: true, brake: false, steer: 0, reverse: false }); const x0 = s.x; for (let i = 0; i < 600 && s.v > 0; i++) s.step({ gas: false, brake: true, steer: 0, reverse: false }); return s.x - x0; };
    expect(d(0.16)).toBeGreaterThan(d(1) * 3);
  });
  // Відомі розвʼязки (знайдені пошуком): рушій їх відтворює; зміна фізики/розмітки, що ламає вправу, зупинить тест.
  const SOLUTIONS: Record<ParkKind, Seg[]> = {
    parallel: [{ rev: false, steer: 0, sec: 1.36, gas: true }, { rev: true, steer: 0.6, sec: 3.38, gas: true }, { rev: true, steer: 0, sec: 2.47, gas: true }, { rev: true, steer: -1, sec: 0.58, gas: true }],
    garage: [{ rev: false, steer: 0, sec: 4.84, gas: true }, { rev: true, steer: -1, sec: 2.78, gas: true }, { rev: true, steer: 1, sec: 3.32, gas: true }, { rev: true, steer: 0, sec: 1.88, gas: true }],
    turn: [{ rev: false, steer: -1, sec: 4.378, gas: true }, { rev: true, steer: -1, sec: 3.986, gas: true }, { rev: false, steer: -1, sec: 2.842, gas: true }],
  };
  for (const kind of ['parallel', 'garage', 'turn'] as const) {
    it(`${kind}: вправа розвʼязувана`, () => {
      const s = run(kind, SOLUTIONS[kind]);
      expect(s.result?.passed, s.result?.reason).toBe(true);
    });
  }
});
