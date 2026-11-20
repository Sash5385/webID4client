// Спільне для 2D і 3D: вибір маршруту (URL / localStorage), створення рушія, кнопка «Поворот», автопілот для тестів.
import { withConfig } from '../engine/config';
import type { Controls } from '../engine/sim7';
import { ROUTE1_DATA, Sim, type AnySim, type RouteId } from '../engine/sim';
import type { NetSim } from '../engine/net/sim';

export type { RouteId, AnySim };
const KEY = 'route.pick';

export const ROUTE_LABEL: Record<RouteId, string> = {
  route1: 'Маршрут 1 · пл. Марченка', route3: 'Маршрут 3 · вул. Мрії до Салютної', route4: 'Маршрут 4 · Щербаківського, Салютна', route5: 'Маршрут 5 · вул. Щербаківського', route9: 'Маршрут 9 · бульвар Вірського, Корчака', route10: 'Маршрут 10 · Салютна, Ружинська, Вірського', route12: 'Маршрут 12 · Стеценка на ПнЗ, пл. Марченка', route13: 'Маршрут 13 · як №12 (Стеценка на ПнЗ)', route14: 'Маршрут 14 · вул. Виговського', route15: 'Маршрут 15 · Берестейський проспект', route6: 'Маршрут 6 · вул. Мрії до Турчина', route7: 'Маршрут 7 · вул. Мрії',
};
export const ROUTE_SHORT: Record<RouteId, string> = { route1: 'Маршрут 1', route3: 'Маршрут 3', route4: 'Маршрут 4', route5: 'Маршрут 5', route6: 'Маршрут 6', route9: 'Маршрут 9', route10: 'Маршрут 10', route12: 'Маршрут 12', route13: 'Маршрут 13', route14: 'Маршрут 14', route15: 'Маршрут 15', route7: 'Маршрут 7' };
// Перелік маршрутів (номер — як на схемах ТСЦ № 8042); кнопки в page.html — у тому ж порядку.
export const ROUTE_ORDER: readonly RouteId[] = ['route1', 'route3', 'route4', 'route5', 'route6', 'route7', 'route9', 'route10', 'route12', 'route13', 'route14', 'route15'];
export const routeNo = (r: RouteId): number => Number(r.slice(5));
const FROM_PARAM: Record<string, RouteId> = Object.fromEntries(ROUTE_ORDER.flatMap((r) => [[String(routeNo(r)), r], [r, r]]));

// ?route=N (номер зі схем ТСЦ) перекриває збережений вибір; типово — маршрут 1.
export function pickRoute(): RouteId {
  const q = FROM_PARAM[new URLSearchParams(location.search).get('route') ?? ''];
  if (q) return q;
  try {
    const s = FROM_PARAM[localStorage.getItem(KEY) ?? ''];
    if (s) return s;
  } catch { /* приватний режим: без збереження */ }
  return 'route1';
}

export function saveRoute(r: RouteId): void {
  try { localStorage.setItem(KEY, String(routeNo(r))); } catch { /* ігноруємо */ }
  // Якщо маршрут заданий в URL — оновлюємо його, щоб перезавантаження не повертало старий.
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('route')) { u.searchParams.set('route', String(routeNo(r))); history.replaceState(null, '', u.toString()); }
  } catch { /* file:// тощо */ }
}

export function makeSim(route: RouteId, mode: 'learn' | 'exam', seedParam: string | null): AnySim {
  const seed = Number(seedParam) || Math.floor(Math.random() * 1e6) + 1;
  return new Sim(withConfig({ mode, seed }), route);
}

export function startHintText(route: RouteId): string {
  const base = 'Рушайте до кільця. Поступіться тим, хто на кільці. ';
  if (route === 'route1') return base + 'Зʼїзд — другий, на вул. Стеценка: правий покажчик і «Зʼїзд».';
  if (route === 'route7') return base + 'Зʼїзд — перший, на вул. Мрії: правий покажчик і «Зʼїзд».';
  // Інші маршрути: текст першого кроку «кільце» з даних маршруту («Кільце: третій зʼїзд — на вул. …»).
  const ring = ROUTE1_DATA.routes?.[route]?.steps.find((q) => q.kind === 'ring');
  if (!ring || ring.kind !== 'ring') return base + 'Правий покажчик і «Зʼїзд» за маршрутом.';
  const t = ring.text.replace('Кільце: ', '');
  return base + t.charAt(0).toUpperCase() + t.slice(1) + ': правий покажчик і «Зʼїзд».';
}

// ---------- Кнопка «Поворот» ----------
// Маршрут 7: одна кнопка («Зʼїзд» / «Розворот»). Маршрут 1: на кільці й перед ним — «Зʼїзд», на вулиці — дві кнопки
// «◀ Ліворуч/Розворот» і «Праворуч ▶» (рушій бере поворот у вказаному напрямку).
export interface TurnUi { split: boolean; label: string; left: string; right: string; armed: boolean; armedL: boolean; armedR: boolean }

export function turnUi(sim: AnySim): TurnUi {
  if (sim.route === 'route7') {
    const w = sim.where;
    return { split: false, label: w.mode === 'street' ? 'Розворот' : 'Зʼїзд', left: '', right: '', armed: w.armed !== null, armedL: false, armedR: false };
  }
  const w = sim.where;
  const e = w.edge ? sim.net.edge(w.edge) : null;
  const ringNear = w.mode === 'ring' || (w.mode === 'path' && w.pathKind === 'entry') || (e !== null && e.ringEntry !== null && e.length - w.s < 80);
  if (ringNear) return { split: false, label: 'Зʼїзд', left: '', right: '', armed: w.armedExit !== null, armedL: false, armedR: false };
  let left = 'Ліворуч', right = 'Праворуч';
  if (e && w.mode === 'edge') {
    const near = (dir: -1 | 1): ReturnType<typeof sim.net.conn> | undefined =>
      e.departures.filter((c) => c.dir === dir && c.fromS > w.s - 2 && c.fromS - w.s < 70).sort((a, b) => a.fromS - b.fromS)[0];
    if (near(-1)?.turn === 'uturn' || sim.expectedConn()?.turn === 'uturn') left = 'Розворот';
  }
  const ad = w.armed ? sim.net.conn(w.armed).dir : 0;
  return { split: true, label: '', left, right, armed: false, armedL: ad === -1, armedR: ad === 1 };
}

// side: −1 ліворуч, 1 праворуч, 0 — «як є» (пробіл: за увімкненим покажчиком).
export function pressTurn(sim: AnySim, side: -1 | 0 | 1): void {
  if (sim.route === 'route7') { sim.turn(); return; }
  if (!turnUi(sim).split) { sim.turn(1); return; }
  sim.turn(side !== 0 ? side : sim.sig);
}

// ---------- Автопілот (лише ?auto=1) ----------
export interface Pilot { controls(dt: number): Controls }
export type PilotFactory = (sim: AnySim) => Pilot;
let pilots: Promise<PilotFactory> | null = null;
export function loadPilot(): Promise<PilotFactory> {
  pilots ??= Promise.all([import('../../tests/autopilot'), import('../../tests/autopilot1')]).then(([a7, a1]) => (sim: AnySim): Pilot =>
    sim.route !== 'route7' ? new a1.NetPilot(sim as NetSim) : new a7.Pilot(sim as never));
  return pilots;
}
