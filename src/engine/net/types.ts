// Формат src/data/route1.json (будує tools/build-route1.mjs з OSM). Це ж — контракт для рендерів (лише читати).
// Координати: метри, X на схід, Z на південь, початок — центр кільця. Курс a: h = (sin a, −cos a).
// Ребро (edge) — проїзна частина одного напрямку з постійною кількістю смуг. ref — ЛІВА межа (біля осі дороги),
// смуга i (0 — ліва) має вісь ref.offset((i + 0.5)·laneWidth), d > 0 праворуч. s — уздовж ref.

export type XZ = [number, number];

export type EdgeKind = 'street' | 'arm' | 'cross' | 'side' | 'driveway';

export type FeatureKindN = 'crossing' | 'signal' | 'yield' | 'giveWay' | 'ringExit';

export interface EdgeFeatureData {
  readonly id: string;
  readonly kind: FeatureKindN;
  readonly s: number;               // уздовж ref
  readonly stop: number;            // стоп-лінія (передній бампер не далі)
  readonly zone: readonly [number, number]; // зона (перехід/перехрестя) уздовж ref
  readonly crossing?: string;       // kind 'crossing'
  readonly junction?: string;       // kind 'signal'
  readonly ctrl?: string;           // контролер світлофора
  readonly group?: 'A' | 'B';       // група фаз
  readonly ring?: string;           // 'yield' / 'ringExit'
}

export interface EdgeData {
  readonly id: string;
  readonly name: string;
  readonly chain: string | null;    // ланцюжок (вулиця одного напрямку), напр. 'stet_se'
  readonly kind: EdgeKind;
  readonly lanes: number;
  readonly laneWidth: number;
  readonly speedKmh: number;
  readonly median: number;          // половина ширини осьової (для двосторонніх; від осі дороги до ref)
  readonly centreLine: 'double' | 'single' | 'none'; // розмітка по ref.offset(−median)
  readonly centreOwner: boolean;    // малювати осьову з цього ребра (щоб не двічі)
  readonly length: number;
  readonly prev: readonly string[];
  readonly next: readonly string[]; // продовження: смуга i → смуга i (зміна кількості смуг — праворуч)
  readonly features: readonly EdgeFeatureData[];
  readonly osm: readonly number[];
  readonly ref: readonly XZ[];
}

export interface ConnEndEdge { readonly edge: string; readonly lane: number; readonly s: number }
export interface ConnEndRing { readonly ring: string; readonly lane: number; readonly theta: number }
export type TurnKind = 'left' | 'right' | 'straight' | 'uturn' | 'entry' | 'exit';

export interface ConnectorData {
  readonly id: string;
  readonly junction: string | null;
  readonly turn: TurnKind;
  // 3 — головний (зʼїзд з кільця), 2 — правий з головної, 1 — лівий з головної (поступається зустрічним),
  // 0 — другорядний (виїзд з бічної вулиці, вʼїзд на кільце, розворот через проїзд): поступається всім.
  readonly rank: number;
  readonly from: ConnEndEdge | ConnEndRing;
  readonly to: ConnEndEdge | ConnEndRing;
  readonly path: readonly XZ[];
  readonly ctrl?: string;
  readonly group?: 'A' | 'B';
  readonly lock?: string;           // замок (один поворот ІІ за раз)
  readonly playerOnly?: boolean;    // лише для гравця (ІІ цим зʼєднувачем не користується: напр. розворот на Мрії)
  readonly minRadius: number;
  readonly crossings?: readonly { readonly crossing: string; readonly s: number; readonly u: number }[];
}

export interface RingArmData {
  readonly id: string;
  readonly name: string;
  readonly kind: 'entry' | 'exit';
  readonly edge: string;
  readonly theta: readonly [number, number]; // кут злиття/відходу для [внутрішньої, зовнішньої] смуги
  readonly node: number;            // кут вузла OSM (порядок рукавів)
}
export interface RingData {
  readonly id: string; readonly name: string;
  readonly cx: number; readonly cz: number;
  readonly r: number;               // межа між смугами; осі смуг r ± laneWidth/2 (0 — внутрішня)
  readonly laneWidth: number; readonly lanes: number;
  readonly arms: readonly RingArmData[]; // за зростанням кута (проти годинникової = напрям руху)
}

export interface JunctionData { readonly id: string; readonly name: string; readonly kind: string; readonly x: number; readonly z: number; readonly ctrl?: string; readonly poly: readonly XZ[] }
export interface ControllerData { readonly id: string; readonly offset: number; readonly groups: readonly ('A' | 'B')[] }

export interface CrossingData {
  readonly id: string;
  readonly kind: 'zebra' | 'signal';
  readonly source: 'osm' | 'scheme';
  readonly osm: readonly number[];
  readonly a: XZ; readonly b: XZ;   // від бордюру до бордюру (через усі проїзні частини)
  readonly width: number;
  // u — відстань від a уздовж переходу; [u0, u1] — проїзна частина ребра.
  readonly spans: readonly { readonly edge: string; readonly s: number; readonly u0: number; readonly u1: number }[];
  readonly ctrl?: string;
  readonly pedGroup?: 'acrossA' | 'acrossB'; // пішоходи йдуть, коли червоний для групи A / B
  readonly note?: string;
}

export interface StopLineData { readonly id: string; readonly edge: string; readonly s: number; readonly kind: string; readonly a: XZ; readonly b: XZ; readonly ctrl?: string; readonly group?: 'A' | 'B' }
export interface SignalHeadData {
  readonly id: string; readonly kind: 'vehicle' | 'ped';
  readonly ctrl: string; readonly group?: 'A' | 'B'; readonly pedGroup?: 'acrossA' | 'acrossB';
  readonly edge?: string; readonly s?: number; readonly crossing?: string;
  readonly x: number; readonly z: number; readonly a: number; // a — курс руху, який регулює голова
}
export interface SignData { readonly kind: 'giveWay' | 'roundabout' | 'pedCrossing'; readonly edge: string; readonly s: number; readonly x: number; readonly z: number; readonly a: number }
export interface BusStopData { readonly id: string; readonly name: string; readonly edge: string; readonly s: number; readonly x: number; readonly z: number; readonly a: number }
export interface StubData { readonly id: string; readonly name: string; readonly kind: string; readonly edge: string; readonly s: number; readonly in: string; readonly out: string; readonly connectors: readonly string[]; readonly osm: number }
export interface BuildingData { readonly pts: readonly XZ[]; readonly levels: number; readonly height: number; readonly kind: string; readonly name?: string; readonly levelsGuess?: boolean }
export interface ContextRoadData { readonly kind: string; readonly name: string; readonly width: number; readonly oneway?: boolean; readonly service?: string; readonly osm: number; readonly pts: readonly XZ[] }

export type RouteStepData =
  | { readonly kind: 'edge'; readonly edge: string }
  | { readonly kind: 'ring'; readonly ring: string; readonly entry: string; readonly exit: string; readonly exitNo: number; readonly text: string }
  | { readonly kind: 'turn'; readonly conn: string; readonly manoeuvre: 'left' | 'right' | 'uturn'; readonly text: string }
  | { readonly kind: 'finish'; readonly edge: string; readonly s: number };

export interface RouteDef {
  readonly start: { readonly edge: string; readonly s: number; readonly lane: number };
  readonly steps: readonly RouteStepData[];
  readonly checkpoints: readonly { readonly id: string; readonly label: string; readonly x: number; readonly z: number }[];
  readonly polyline: readonly XZ[];
  readonly length: number;
}

export interface RouteData {
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly meta: { readonly origin: { readonly lat: number; readonly lon: number }; readonly license: string; readonly laneWidth: number; readonly routeLength: number; readonly [k: string]: unknown };
  readonly edges: readonly EdgeData[];
  readonly connectors: readonly ConnectorData[];
  readonly rings: readonly RingData[];
  readonly junctions: readonly JunctionData[];
  readonly controllers: readonly ControllerData[];
  readonly crossings: readonly CrossingData[];
  readonly stopLines: readonly StopLineData[];
  readonly signals: readonly SignalHeadData[];
  readonly signs: readonly SignData[];
  readonly busStops: readonly BusStopData[];
  readonly stubs: readonly StubData[];
  readonly route: RouteDef;                         // вибраний маршрут (ставить NetSim з routes)
  readonly routes?: Readonly<Record<string, RouteDef>>; // усі маршрути на цій мережі
  readonly buildings: readonly BuildingData[];
  readonly context: readonly ContextRoadData[];
}
