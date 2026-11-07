// Механіка: розгін по передачах, глухнення, відмова перемикання без зчеплення; автомат не змінився.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { NetSim, Sim } from '../src/engine/sim';

const mk = (): NetSim => { const s = new Sim(DEFAULT_CONFIG, 'route1') as NetSim; s.gb.setManual(true); return s; };
const go = (s: NetSim, sec: number, c: { gas?: boolean; brake?: boolean; clutch?: boolean }): void => { for (let i = 0; i < sec * 60 && !s.result; i++) s.step({ gas: !!c.gas, brake: !!c.brake, clutch: !!c.clutch }); };

describe('механіка', () => {
  it('без зчеплення передачу не вмикає', () => {
    const s = mk();
    expect(s.gb.shift(1)).toBe(false);
    expect(s.gb.gear).toBe(0);
    go(s, 0.5, { clutch: true });
    expect(s.gb.shift(1)).toBe(true);
    expect(s.gb.gear).toBe(1);
  });
  it('рушання з газом на 1-й їде, без газу — глухне', () => {
    const a = mk(); go(a, 0.5, { clutch: true }); a.gb.shift(1); go(a, 3, { gas: true });
    expect(a.v).toBeGreaterThan(3);
    expect(a.gb.stalled).toBe(false);
    const b = mk(); go(b, 0.5, { clutch: true }); b.gb.shift(1); go(b, 2, {});
    expect(b.gb.stalled).toBe(true);
    expect(b.v).toBe(0);
  });
  it('розгін 1→2→3 і вища передача дає більшу швидкість', () => {
    const s = mk(); go(s, 0.5, { clutch: true }); s.gb.shift(1); go(s, 3.5, { gas: true });
    const v1 = s.v;
    go(s, 0.5, { clutch: true }); s.gb.shift(1); go(s, 5, { gas: true });
    expect(s.gb.gear).toBe(2);
    expect(s.v).toBeGreaterThan(v1 + 1);
  });
  it('глухне при рушанні на 4-й, після зчеплення двигун запускається', () => {
    const s = mk(); go(s, 0.5, { clutch: true }); s.gb.shift(1); s.gb.shift(1); s.gb.shift(1); s.gb.shift(1); go(s, 2, { gas: true });
    expect(s.gb.gear).toBe(4); expect(s.gb.stalled).toBe(true);
    go(s, 1.5, { clutch: true });
    expect(s.gb.stalled).toBe(false);
  });
  it('автомат не торкається коробки', () => {
    const s = new Sim(DEFAULT_CONFIG, 'route1') as NetSim;
    go(s, 3, { gas: true });
    expect(s.v).toBeGreaterThan(4);
    expect(s.gb.manual).toBe(false);
  });
});
