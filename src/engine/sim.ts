// Фасад тренажера: один конструктор для обох маршрутів.
//   new Sim(cfg)            — маршрут №7 (типово; Route7Sim, як і раніше)
//   new Sim(cfg, 'route7')  — те саме
//   new Sim(cfg, 'route1')  — маршрут №1 на мережі з OSM (NetSim, дані src/data/route1.json)
// Тип `Sim` лишається типом маршруту №7 (сумісність з UI/тестами); для обох — `AnySim` (розрізняти за sim.route).
import ROUTE1 from '../data/route1.json';
import { DEFAULT_CONFIG, type SimConfig } from './config';
import { NetSim } from './net/sim';
import type { RouteData } from './net/types';
import { Route7Sim } from './sim7';

export * from './sim7';
export { NetSim } from './net/sim';
// Маршрути на мережі OSM (NetSim) і схематичний маршрут №7.
export const NET_ROUTES = ['route1', 'route3', 'route4', 'route5', 'route6', 'route9', 'route10', 'route12', 'route13', 'route14', 'route15'] as const;
export type NetRouteId = (typeof NET_ROUTES)[number];
export type RouteId = NetRouteId | 'route7';
export type AnySim = Route7Sim | NetSim;

export const ROUTE1_DATA = ROUTE1 as unknown as RouteData;

interface SimCtor {
  new (cfg?: SimConfig): Route7Sim;
  new (cfg: SimConfig, route: 'route7'): Route7Sim;
  new (cfg: SimConfig, route: NetRouteId): NetSim;
  new (cfg: SimConfig, route: RouteId): AnySim;
}

// Конструктор-функція: `new` повертає обʼєкт потрібного класу.
export const Sim = function (cfg: SimConfig = DEFAULT_CONFIG, route: RouteId = 'route7'): AnySim {
  if ((NET_ROUTES as readonly string[]).includes(route)) return new NetSim(cfg, ROUTE1_DATA, route as NetRouteId);
  if (route !== 'route7') throw new Error('Невідомий маршрут: ' + String(route));
  return new Route7Sim(cfg);
} as unknown as SimCtor;
export type Sim = Route7Sim;
