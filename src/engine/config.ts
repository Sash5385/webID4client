// Усі числа, які можна (і треба) підкручувати. Позначки «СВЕРИТЬ» — не факт, а припущення.
// Одиниці: метри, секунди, м/с. Координати: X на схід, Z на південь.

export type Severity = 'serious' | 'minor';

export type FaultCode =
  | 'crash'              // зіткнення з авто
  | 'pedestrianHit'      // наїзд на пішохода
  | 'redLight'           // проїзд на червоний
  | 'yellowLight'        // проїзд на жовтий, коли можна було зупинитись
  | 'offRoute'           // поїхав не туди
  | 'pedestrianYield'    // не пропустив пішохода (без наїзду)
  | 'ringYield'          // не поступився транспорту на кільці
  | 'ringExitLane'       // перший зʼїзд з кільця не з зовнішньої смуги
  | 'oncomingYield'      // при розвороті не поступився зустрічному
  | 'noSignal'           // не увімкнув покажчик
  | 'lateSignal'         // увімкнув покажчик невчасно
  | 'solidLine'          // перестроювання через суцільну
  | 'uturnNotCenter'     // розворот не з середини перехрестя
  | 'uturnWrongLane'     // розворот не з крайньої лівої смуги
  | 'turnWrongLane'      // поворот не з крайньої смуги (маршрут №1: лівий на Турчина — з лівої)
  | 'leftLaneHog'        // довго в лівій смузі при вільній правій
  | 'speeding'           // перевищення швидкості
  | 'closeOvertake'      // обгін велосипедиста/самокатника в тій самій смузі з боковим інтервалом < rules.closeOvertakeClear
  | 'skid'              // занесло в повороті на слизькій дорозі (швидкість вища за ту, що тримає зчеплення)
  | 'forcedBraking';     // змусив інше авто різко гальмувати (поворот ІІ з пріоритетом або небезпечне перестроювання)

export interface SimConfig {
  readonly mode: 'learn' | 'exam';
  readonly seed: number;
  readonly dt: number;
  readonly car: { readonly length: number; readonly width: number };
  readonly player: {
    readonly accel: number;      // газ, м/с²
    readonly brake: number;      // гальмо, м/с²
    readonly coast: number;      // накат без педалей, м/с²
    readonly maxV: number;       // м/с
  };
  readonly road: {
    readonly laneWidth: number;
    readonly medianHalf: number; // половина ширини подвійної суцільної по осі
    readonly sidewalk: number;
  };
  readonly street: {
    readonly length: number;     // довжина опорної лінії вул. Мрії (стиснута)
    readonly startZ: number;     // Z, де вул. Мрії стикується з кільцем (лінія «Дати дорогу» для N)
  };
  readonly ring: {
    readonly radius: number;     // радіус лінії між двома смугами кільця
    readonly laneWidth: number;
    readonly mergeAngleDeg: number; // зсув точки вʼїзду/зʼїзду зовнішньої смуги від осі рукава
    readonly innerAngleDeg: number; // те саме для внутрішньої смуги
    readonly armLength: number;  // довжина заглушок рукавів W/N/E
    readonly armLaneOffset: number;
  };
  readonly signals: {
    readonly cycle: number;
    readonly green: number;
    readonly greenBlink: number;
    readonly yellow: number;
    readonly redYellow: number;  // червоний+жовтий перед зеленим
    readonly pedClearance: number; // пішохідний зелений вимикається раніше
  };
  readonly rules: {
    readonly speedLimitKmh: number;
    readonly speedHoldS: number;          // скільки секунд перевищення до помилки
    readonly signalLeadS: number;         // мінімум, скільки покажчик має блимати до маневру (3 блимання)
    readonly leftLaneMaxS: number;
    readonly leftLaneFreeAhead: number;
    readonly leftLaneFreeBehind: number;
    readonly leftLaneStaticAhead: number; // нерухома перешкода в правій смузі ближче — права «не вільна»
    readonly uturnPrepDist: number;       // за скільки до розвороту ліва смуга дозволена без штрафу
    readonly ringPrepDist: number;        // за скільки до кільця ліва смуга дозволена без штрафу
    readonly uturnCenterTol: number;      // наскільки раніше центру перехрестя ще «з середини»
    readonly solidBeforeStop: number;     // суцільна між смугами перед стоп-лінією, м
    readonly yellowComfortDecel: number;  // м/с²: якщо міг зупинитись з таким гальмуванням, жовтий = порушення
    readonly ringYieldTime: number;       // с: якщо авто на кільці доїде до точки вʼїзду швидше — не поступився
    readonly oncomingYieldTime: number;   // с до точки конфлікту
    readonly pedConflictMargin: number;   // м за краєм проїзної частини, коли пішохід «вже йде на тебе»
    readonly maxMinorFaults: number;      // при досягненні — «Не склав»
    readonly missedExitIsOffRoute: boolean;
    readonly closeOvertakeClear: number;  // м: мінімальний боковий інтервал до вело/самоката при обгоні в своїй смузі
    readonly forcedDecel: number;         // м/с²: ІІ гальмує сильніше через гравця → forcedBraking
    readonly forcedTTC: number;           // с: час до зіткнення з ІІ, що має пріоритет (поворот), менший → forcedBraking
    readonly forcedStopDecel: number;     // м/с²: …і щоб зупинитись перед ним, треба гальмувати сильніше
    readonly forcedLaneChangeWindow: number; // с після перестроювання гравця, коли різке гальмування ІІ позаду — його вина
  };
  readonly severity: Readonly<Record<FaultCode, Severity>>;
  readonly traffic: {
    readonly streetCarsPerLane: number;
    readonly ringSpawnInterval: [number, number];
    readonly streetV: [number, number];   // бажана швидкість ІІ, м/с
    readonly ringV: number;
    readonly maxCars: number;             // лише рухомі ІІ (припарковані/зламані не рахуються)
  };
  // Перешкоди у смугах вул. Мрії: припарковані (у правій смузі біля бордюру) і зламані (аварійка).
  readonly obstacles: {
    readonly parkedStretches: [number, number]; // ділянок на напрямок (мін, макс); менше, якщо бракує вільних слотів
    readonly parkedPerStretch: [number, number]; // авто в ділянці
    readonly parkedGap: [number, number];        // м між бамперами в ділянці
    readonly parkedKerbGap: number;              // м від бордюру до борту припаркованого авто
    readonly brokenPerDir: [number, number];
    readonly brokenLeftShare: number;            // частка зламаних у лівій смузі
    readonly clearBeforeStop: number;            // м: перешкода не ближче до наступної стоп-лінії
    readonly clearAfterZone: number;             // м: і не ближче за кінцем попереднього переходу/перехрестя
    readonly clearDriveway: number;              // м від виїзду з двору
    readonly clearBusStop: number;               // м від зупинки
    readonly ringClear: number;                  // м: останні N м перед кільцем (напрям N) вільні
    readonly sMin: number;                       // м: не ближче до кільця на напрямку S
    readonly sMaxS: number;                      // м: на S далі нема сенсу (розворот)
    readonly leftLaneUturnClear: number;         // м: на S у лівій смузі не ближче до розвороту
    readonly playerClear: number;                // м від гравця під час розстановки
  };
  // Велосипедисти й самокатники біля правого краю правої смуги (у напрямку руху).
  readonly riders: {
    readonly perDir: [number, number];
    readonly bikeShare: number;
    readonly bikeV: [number, number];            // м/с
    readonly scooterV: [number, number];
    readonly bike: { readonly len: number; readonly width: number };
    readonly scooter: { readonly len: number; readonly width: number };
    readonly edgeGap: number;                    // м від краю проїзної частини до осі райдера
    readonly wobble: number;                     // м амплітуда виляння
    readonly accel: number;
    readonly decel: number;                      // комфортне гальмування, м/с²
    readonly passClear: number;                  // м: боковий запас райдера при обʼїзді перешкоди
    readonly spawnNAtS: number;                  // гравець на S проїхав стільки — зʼявляються райдери на N (з дворів)
  };
  // ІІ, що повертають з Мрії / на Мрії (перехрестя без розвороту + виїзди з дворів).
  readonly turners: {
    readonly share: number;                      // частка нових авто на Мрії, що повертають
    readonly sideSpawnInterval: [number, number];// с між виїздами з поперечних вулиць/дворів
    readonly turnV: number;                      // м/с у повороті
    readonly accel: number;                      // м/с² у повороті (і в оцінці часу звільнення)
    readonly crossLaneOffset: number;            // м: вісь смуги поперечної вулиці від її осі
    readonly marginAI: number;                   // с запасу до ІІ при рішенні «їду»
    readonly marginPlayer: number;               // с запасу до гравця (гравець має пріоритет)
    readonly signalDist: number;                 // м: покажчик вмикається не пізніше
  };
  // Обʼїзд ІІ перешкод/повільних райдерів сусідньою смугою.
  readonly aiLaneChange: {
    readonly signalS: number;                    // с покажчика до початку маневру
    readonly latSpeed: number;                   // м/с бокова швидкість
    readonly latSpeedMin: number;                // м/с на місці (виїзд з-за перешкоди)
    readonly lookStatic: number;                 // м: бачить перешкоду
    readonly lookRider: number;                  // м: бачить повільного райдера
    readonly slowRiderDv: number;                // м/с: райдер повільніший за бажану швидкість — обганяти
    readonly staticStandoff: number;             // м: зупиняється перед перешкодою з таким запасом
  };
  readonly peds: {
    readonly speed: [number, number];
    readonly zebraTriggerDist: number;    // пішохід виходить, коли учень ближче (СВЕРИТЬ, це для навчання)
    readonly zebraChance: number;
    readonly signalChance: number;
    readonly zebraGroup: [number, number];       // людей у групі на нерегульованому
    readonly signalGroup: [number, number];      // на регульованому
    readonly sidewalkPerSide: [number, number];  // пішоходи вздовж тротуару (не виходять на дорогу)
    readonly sidewalkSpeed: [number, number];
    readonly stopGroup: [number, number];        // на кожній зупинці
    readonly jaywalkChance: number;              // імовірність одного порушника за заїзд
    readonly jaywalkSpeed: [number, number];
    readonly jaywalkMinDist: number;             // м: найменша відстань від гравця, коли виходить
    readonly jaywalkClear: number;               // м від переходів/перехресть
  };
}

export const DEFAULT_CONFIG: SimConfig = {
  mode: 'learn',
  seed: 7,
  dt: 1 / 60,
  car: { length: 4.4, width: 1.8 },
  player: { accel: 2.6, brake: 7, coast: 0.35, maxV: 22 },
  road: { laneWidth: 3.5, medianHalf: 0.5, sidewalk: 3 },
  street: { length: 950, startZ: 30 },
  ring: { radius: 14, laneWidth: 3.5, mergeAngleDeg: 25, innerAngleDeg: 10, armLength: 60, armLaneOffset: 2 },
  // «Звичайні» фази: 30 з зелений, 3 миготливий, 3 жовтий, решта червоний (СВЕРИТЬ на місці).
  signals: { cycle: 60, green: 30, greenBlink: 3, yellow: 3, redYellow: 2, pedClearance: 4 },
  rules: {
    speedLimitKmh: 50,
    speedHoldS: 1,
    signalLeadS: 2,   // 3 блимання при 1,5 Гц (період 2/3 с) — мінімум до початку перестроювання/повороту
    leftLaneMaxS: 10,
    leftLaneFreeAhead: 50,
    leftLaneFreeBehind: 15,
    leftLaneStaticAhead: 70,
    uturnPrepDist: 350,
    ringPrepDist: 250,
    uturnCenterTol: 3,
    solidBeforeStop: 30,
    yellowComfortDecel: 4,
    ringYieldTime: 2,
    oncomingYieldTime: 4,
    pedConflictMargin: 2,
    maxMinorFaults: 4,
    missedExitIsOffRoute: true,
    closeOvertakeClear: 1.0,
    forcedDecel: 6,
    forcedTTC: 1.2,
    forcedStopDecel: 3.5,
    forcedLaneChangeWindow: 2,
  },
  // Від власника: авария, пішохід, червоний, не туди = одразу «Не склав».
  // Решта «серйозних» — як на реальному іспиті, підтверджено власником.
  severity: {
    crash: 'serious',
    pedestrianHit: 'serious',
    redLight: 'serious',
    offRoute: 'serious',
    yellowLight: 'serious',
    pedestrianYield: 'serious',
    ringYield: 'serious',
    oncomingYield: 'serious',
    ringExitLane: 'minor', // СВЕРИТЬ: власник не уточнив тяжкість
    noSignal: 'minor',
    lateSignal: 'minor',
    solidLine: 'minor',
    uturnNotCenter: 'minor',
    uturnWrongLane: 'serious',
    turnWrongLane: 'serious', // СВЕРИТЬ: як розворот не з лівої смуги
    leftLaneHog: 'minor',
    speeding: 'minor',
    closeOvertake: 'minor',
    forcedBraking: 'minor',
    skid: 'serious',
  },
  traffic: {
    streetCarsPerLane: 5,
    ringSpawnInterval: [5, 10],
    streetV: [11, 14],
    ringV: 7,
    maxCars: 26,
  },
  obstacles: {
    parkedStretches: [3, 5],
    parkedPerStretch: [1, 3],
    parkedGap: [0.8, 6],
    parkedKerbGap: 0.3,
    brokenPerDir: [1, 2],
    brokenLeftShare: 0.25,
    clearBeforeStop: 40,
    clearAfterZone: 30,
    clearDriveway: 25,
    clearBusStop: 15,
    ringClear: 300,
    sMin: 60,
    sMaxS: 770,
    leftLaneUturnClear: 380,
    playerClear: 40,
  },
  riders: {
    perDir: [1, 3],
    bikeShare: 0.6,
    bikeV: [4, 7],
    scooterV: [3, 5],
    bike: { len: 1.8, width: 0.55 }, // ширина по керму
    scooter: { len: 1.2, width: 0.5 },
    // Власник просив ~0.7 м від краю; при ширині авто 1.8 у смузі 3.5 тоді обʼїзд у своїй смузі = дотик.
    // 0.5 м лишає ~0.1 м: «протиснутись» можна (closeOvertake), але не зачепивши.
    edgeGap: 0.5,
    wobble: 0.05,
    accel: 1.0,
    decel: 2.5,
    passClear: 0.45,
    spawnNAtS: 560,
  },
  turners: {
    share: 0.3,
    sideSpawnInterval: [9, 20],
    turnV: 5.5,
    accel: 2.0,
    crossLaneOffset: 2.5,
    marginAI: 1.5,
    marginPlayer: 3,
    signalDist: 40,
  },
  aiLaneChange: {
    signalS: 2,
    latSpeed: 1.2,
    latSpeedMin: 0.5,
    lookStatic: 60,
    lookRider: 30,
    slowRiderDv: 3,
    staticStandoff: 5,
  },
  peds: {
    speed: [1.1, 1.5],
    zebraTriggerDist: 45,
    zebraChance: 0.7,
    signalChance: 0.8,
    zebraGroup: [1, 3],
    signalGroup: [2, 5],
    sidewalkPerSide: [4, 7],
    sidewalkSpeed: [1.0, 1.5],
    stopGroup: [2, 4],
    jaywalkChance: 0.5,
    jaywalkSpeed: [1.3, 1.6],
    jaywalkMinDist: 35,
    jaywalkClear: 30,
  },
};

export type FeatureKind = 'zebra' | 'signalCrossing' | 'intersection';

export interface FeatureDef {
  readonly id: string;
  readonly kind: FeatureKind;
  readonly s: number;            // від початку вул. Мрії (біля кільця) на південь
  readonly name?: string;
  readonly halfWidth: number;    // половина довжини зони вздовж вулиці
  readonly side?: 'E' | 'W' | 'both'; // для перехресть: куди йде поперечна вулиця
  readonly offset?: number;      // зсув фази світлофора, с
  readonly uturn?: boolean;      // тут розворот за маршрутом
}

// Схематична розстановка за схемою маршруту №7 (стиснуто, СВЕРИТЬ з OSM).
export const FEATURES: readonly FeatureDef[] = [
  { id: 'z1', kind: 'zebra', s: 50, halfWidth: 2, name: 'Зелена' },
  { id: 'c1', kind: 'signalCrossing', s: 150, halfWidth: 2, offset: 0 },
  { id: 'i1', kind: 'intersection', s: 250, halfWidth: 7, side: 'E', name: 'вул. Ігоря Турчина', offset: 10 },
  { id: 'z2', kind: 'zebra', s: 370, halfWidth: 2 },
  { id: 'c2', kind: 'signalCrossing', s: 470, halfWidth: 2, offset: 25 },
  { id: 'i2', kind: 'intersection', s: 580, halfWidth: 7, side: 'both', name: 'вул. Салютна', offset: 35 },
  { id: 'z3', kind: 'zebra', s: 690, halfWidth: 2 },
  { id: 'i3', kind: 'intersection', s: 800, halfWidth: 7, side: 'both', name: 'вул. Естонська', offset: 48, uturn: true },
];

// Виїзди з дворів (лише правий поворот): s — як у FEATURES, side — бік вулиці (W біля смуг S, E біля смуг N).
export interface DrivewayDef { readonly id: string; readonly s: number; readonly side: 'W' | 'E' }
export const DRIVEWAYS: readonly DrivewayDef[] = [
  { id: 'd1', s: 128, side: 'W' },
  { id: 'd2', s: 345, side: 'W' },
  { id: 'd3', s: 485, side: 'E' },
  { id: 'd4', s: 715, side: 'E' },
];

// Автобусні зупинки (лише пішоходи, що чекають).
export interface BusStopDef { readonly id: string; readonly s: number; readonly side: 'W' | 'E' }
export const BUS_STOPS: readonly BusStopDef[] = [
  { id: 'b1', s: 165, side: 'W' },
  { id: 'b2', s: 455, side: 'E' },
];

export function withConfig(over: Partial<SimConfig>): SimConfig {
  return { ...DEFAULT_CONFIG, ...over };
}
