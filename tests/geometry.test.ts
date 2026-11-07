import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { Arc, bezierPath, boxesOverlap, line, ringPose } from '../src/engine/geometry';
import { buildRoute } from '../src/engine/route';
import { lightAt, pedLightAt } from '../src/engine/signals';

describe('геометрія', () => {
  it('проекція на лінію: d > 0 праворуч', () => {
    const south = line({ x: 0, z: 0 }, { x: 0, z: 100 }); // на південь: праворуч = захід (-X)
    expect(south.project(-3, 40)).toEqual({ s: 40, d: 3 });
    expect(south.pose(10).a).toBeCloseTo(Math.PI);
  });

  it('кільце проти годинникової: праворуч = назовні', () => {
    const arc = new Arc(0, 0, 10, 0, Math.PI);
    const p = arc.project(0, -12); // північ, за радіусом
    expect(p.s).toBeCloseTo(10 * Math.PI / 2);
    expect(p.d).toBeCloseTo(2);
    expect(ringPose(0, 0, 10, Math.PI / 2).a).toBeCloseTo(-Math.PI / 2); // на півночі рух на захід
  });

  it('Безьє зберігає кінці', () => {
    const b = bezierPath({ x: 0, z: 0, a: Math.PI }, { x: 4, z: -2, a: 0 }, 8);
    expect(b.pose(0).x).toBeCloseTo(0);
    expect(b.pose(b.length).x).toBeCloseTo(4);
    expect(b.pose(b.length).a).toBeCloseTo(0, 1);
  });

  it('перетин прямокутників', () => {
    const a = { x: 0, z: 0, a: 0, hl: 2.2, hw: 0.9 };
    expect(boxesOverlap(a, { ...a, x: 1.7 })).toBe(true);
    expect(boxesOverlap(a, { ...a, x: 1.9 })).toBe(false);
    expect(boxesOverlap(a, { ...a, x: 2.5, a: Math.PI / 2 })).toBe(true);
  });
});

describe('маршрут', () => {
  const net = buildRoute(DEFAULT_CONFIG);
  it('смуги: на південь — захід, на північ — схід', () => {
    expect(net.lanes.S[1].pose(0).x).toBeLessThan(net.lanes.S[0].pose(0).x);
    expect(net.lanes.N[1].pose(0).x).toBeGreaterThan(net.lanes.N[0].pose(0).x);
    expect(net.lanes.S[0].pose(0).x).toBeLessThan(0);
  });
  it('зʼїзд на Мрії стикується з правою смугою', () => {
    const e = net.exitPath('S', 1);
    const end = e.pose(e.length), st = net.lanes.S[1].pose(0);
    expect(Math.hypot(end.x - st.x, end.z - st.z)).toBeLessThan(0.01);
  });
  it('перший зʼїзд від автодрому — Мрії, другий від Мрії — автодром', () => {
    const order = net.armOrder;
    const after = (from: string, n: number): string => order[(order.indexOf(from as never) + n) % order.length]!;
    expect(after('W', 1)).toBe('S');
    expect(after('S', 2)).toBe('W');
  });
  it('кільце: дві смуги, внутрішня ближче до центру', () => {
    expect(net.laneR(0)).toBeLessThan(net.laneR(1));
    const e0 = net.exitPath('S', 0), e1 = net.exitPath('S', 1);
    expect(e0.pose(e0.length).x).toBeCloseTo(net.lanes.S[0].pose(0).x);
    expect(e1.pose(e1.length).x).toBeCloseTo(net.lanes.S[1].pose(0).x);
  });
});

describe('світлофор', () => {
  const c = DEFAULT_CONFIG.signals;
  it('фази по колу', () => {
    expect(lightAt(0, 0, c)).toBe('green');
    expect(lightAt(31, 0, c)).toBe('greenBlink');
    expect(lightAt(34, 0, c)).toBe('yellow');
    expect(lightAt(40, 0, c)).toBe('red');
    expect(lightAt(59, 0, c)).toBe('redYellow');
  });
  it('пішохідний зелений лише при червоному для авто', () => {
    for (let t = 0; t < 60; t += 0.5) {
      if (pedLightAt(t, 0, c) === 'walk') expect(lightAt(t, 0, c)).toBe('red');
    }
  });
});
