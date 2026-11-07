// Двофазні світлофори мережі: група A — головна дорога (як на маршруті №7), група B — поперечна
// (зелений лише в межах червоного A, з 1 с «усі червоні»). Пішоходи: acrossA — через дорогу A (поки A червоний),
// acrossB — через дорогу B (поки A зелений).
import type { SimConfig } from '../config';
import { mod } from '../geometry';
import { lightAt, pedLightAt, type Light, type PedLight } from '../signals';

type SC = SimConfig['signals'];
export type Group = 'A' | 'B';
export type PedGroup = 'acrossA' | 'acrossB';

const ALL_RED = 1;

// Межі фаз групи B у циклі.
function bWin(c: SC): { ry: number; g: number; blink: number; y: number; red: number } {
  const aRed = c.green + c.greenBlink + c.yellow;
  const ry = aRed + ALL_RED;
  const red = c.cycle - c.redYellow;          // B червоний, коли A — червоний+жовтий
  const y = red - c.yellow;
  return { ry, g: ry + c.redYellow, blink: y - c.greenBlink, y, red };
}

export function groupLight(t: number, offset: number, group: Group, c: SC): Light {
  if (group === 'A') return lightAt(t, offset, c);
  const p = mod(t + offset, c.cycle), w = bWin(c);
  if (p >= w.ry && p < w.g) return 'redYellow';
  if (p >= w.g && p < w.blink) return 'green';
  if (p >= w.blink && p < w.y) return 'greenBlink';
  if (p >= w.y && p < w.red) return 'yellow';
  return 'red';
}

// Скільки секунд від початку жовтого (може бути від’ємним — ще не жовтий).
export function groupSinceYellow(t: number, offset: number, group: Group, c: SC): number {
  const p = mod(t + offset, c.cycle);
  if (group === 'A') return p - (c.green + c.greenBlink);
  return p - bWin(c).y;
}

// Скільки ще триває «можна їхати» (зелений + миготливий) і через скільки наступний зелений.
export function groupTiming(t: number, offset: number, group: Group, c: SC): { goLeft: number; untilGreen: number } {
  const p = mod(t + offset, c.cycle);
  const [g0, g1] = group === 'A' ? [0, c.green + c.greenBlink] : [bWin(c).g, bWin(c).y];
  if (p >= g0 && p < g1) return { goLeft: g1 - p, untilGreen: 0 };
  return { goLeft: 0, untilGreen: mod(g0 - p, c.cycle) };
}

export function pedGroupLight(t: number, offset: number, g: PedGroup, c: SC): PedLight {
  if (g === 'acrossA') return pedLightAt(t, offset, c);
  const p = mod(t + offset, c.cycle);
  return p >= 1 && p < c.green - c.pedClearance ? 'walk' : 'stop';
}
