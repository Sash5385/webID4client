import type { SimConfig } from './config';
import { mod } from './geometry';

export type Light = 'green' | 'greenBlink' | 'yellow' | 'red' | 'redYellow';
export type PedLight = 'walk' | 'stop';

// Фаза для вул. Мрії. Поперечний напрямок і пішоходи отримують зелений, коли тут червоний.
export function lightAt(t: number, offset: number, c: SimConfig['signals']): Light {
  const p = mod(t + offset, c.cycle);
  if (p < c.green) return 'green';
  if (p < c.green + c.greenBlink) return 'greenBlink';
  if (p < c.green + c.greenBlink + c.yellow) return 'yellow';
  if (p < c.cycle - c.redYellow) return 'red';
  return 'redYellow';
}

export function pedLightAt(t: number, offset: number, c: SimConfig['signals']): PedLight {
  const p = mod(t + offset, c.cycle);
  const from = c.green + c.greenBlink + c.yellow + 1;
  const to = c.cycle - c.redYellow - c.pedClearance;
  return p >= from && p < to ? 'walk' : 'stop';
}

// Скільки секунд минуло від початку жовтого (для перевірки «міг зупинитись»).
export function sinceYellow(t: number, offset: number, c: SimConfig['signals']): number {
  return mod(t + offset, c.cycle) - (c.green + c.greenBlink);
}

export const isStopLight = (l: Light): boolean => l === 'red' || l === 'redYellow';
