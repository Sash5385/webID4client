// Рівні якості 3D: низька / середня (за замовчуванням) / висока. Вибір зберігається в localStorage.
export type Quality = 'low' | 'mid' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'mid', 'high'];
export const QUALITY_LABEL: Record<Quality, string> = { low: 'Низька', mid: 'Середня', high: 'Висока' };
const KEY = 'route7.quality';

export function loadQuality(): Quality {
  const q = new URLSearchParams(location.search).get('q'); // ?q=low|mid|high (для знімків)
  if (q === 'low' || q === 'mid' || q === 'high') return q;
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'low' || s === 'mid' || s === 'high') return s;
  } catch { /* приватний режим: працюємо без збереження */ }
  return 'high';
}

export function saveQuality(q: Quality): void {
  try { localStorage.setItem(KEY, q); } catch { /* ігноруємо */ }
}

// Погода: ясно / туман. Зберігається окремо; ?w=fog|clear — для знімків.
export type Weather = 'clear' | 'fog' | 'rain' | 'snow' | 'ice';
export const WEATHERS: readonly Weather[] = ['clear', 'fog', 'rain', 'snow', 'ice'];
export const WEATHER_LABEL: Record<Weather, string> = { clear: 'Ясно', fog: 'Туман', rain: 'Дощ', snow: 'Сніг', ice: 'Ожеледь' };
// Зчеплення шин з дорогою: множник гальмування/розгону (ожеледь — гальмує дуже погано).
export const WEATHER_GRIP: Record<Weather, number> = { clear: 1, fog: 1, rain: 0.62, snow: 0.38, ice: 0.16 };
const isWeather = (w: unknown): w is Weather => typeof w === 'string' && (WEATHERS as readonly string[]).includes(w);
const WKEY = 'route7.weather';
export function loadWeather(): Weather {
  const w = new URLSearchParams(location.search).get('w');
  if (isWeather(w)) return w;
  try { const s = localStorage.getItem(WKEY); if (isWeather(s)) return s; } catch { /* без збереження */ }
  return 'clear';
}
export function saveWeather(w: Weather): void {
  try { localStorage.setItem(WKEY, w); } catch { /* ігноруємо */ }
}

// Коробка передач: автомат / механіка. Зберігається окремо; ?gb=manual|auto — для знімків.
export type Gb = 'auto' | 'manual';
export const GB_LABEL: Record<Gb, string> = { auto: 'Автомат', manual: 'Механіка' };
const GKEY = 'route7.gearbox';
export function loadGb(): Gb {
  const g = new URLSearchParams(location.search).get('gb');
  if (g === 'auto' || g === 'manual') return g;
  try { const s = localStorage.getItem(GKEY); if (s === 'auto' || s === 'manual') return s; } catch { /* без збереження */ }
  return 'auto';
}
export function saveGb(g: Gb): void {
  try { localStorage.setItem(GKEY, g); } catch { /* ігноруємо */ }
}

// Час доби: день / вечір / ніч (фари вмикаються). Зберігається окремо; ?tod=evening|night — для знімків.
export type Tod = 'day' | 'evening' | 'night';
export const TODS: readonly Tod[] = ['day', 'evening', 'night'];
export const TOD_LABEL: Record<Tod, string> = { day: 'День', evening: 'Вечір', night: 'Ніч' };
const TKEY = 'route7.tod';
export function loadTod(): Tod {
  const t = new URLSearchParams(location.search).get('tod');
  if (t === 'day' || t === 'evening' || t === 'night') return t;
  try { const s = localStorage.getItem(TKEY); if (s === 'day' || s === 'evening' || s === 'night') return s; } catch { /* без збереження */ }
  return 'day';
}
export function saveTod(t: Tod): void {
  try { localStorage.setItem(TKEY, t); } catch { /* ігноруємо */ }
}

// Колір кузова авто гравця. «Стандарт» — рідний колір моделі (ID.4 червоний, Cerato білий). ?col=white — для знімків.
export type CarCol = 'default' | 'red' | 'white' | 'silver' | 'blue' | 'green' | 'black' | 'yellow';
export const CARCOLS: readonly CarCol[] = ['default', 'red', 'white', 'silver', 'blue', 'green', 'black', 'yellow'];
export const CARCOL_LABEL: Record<CarCol, string> = { default: 'Стандарт', red: 'Червоний', white: 'Білий', silver: 'Сірий', blue: 'Синій', green: 'Зелений', black: 'Чорний', yellow: 'Жовтий' };
export const CARCOL_HEX: Record<Exclude<CarCol, 'default'>, number> = { red: 0xc4202e, white: 0xf0f2f5, silver: 0xaeb4bc, blue: 0x2b5da8, green: 0x2f7a5a, black: 0x1a1c20, yellow: 0xe9b824 };
const CCKEY = 'route7.carcol';
export function loadCarCol(): CarCol {
  const c = new URLSearchParams(location.search).get('col');
  if (c && (CARCOLS as readonly string[]).includes(c)) return c as CarCol;
  try { const s = localStorage.getItem(CCKEY); if (s && (CARCOLS as readonly string[]).includes(s)) return s as CarCol; } catch { /* без збереження */ }
  return 'default';
}
export function saveCarCol(c: CarCol): void {
  try { localStorage.setItem(CCKEY, c); } catch { /* ігноруємо */ }
}

// Камера: ззаду (за замовчуванням) / з салону. Зберігається окремо; ?cam=cockpit — для знімків.
export type CamMode = 'chase' | 'cockpit';
export const CAM_LABEL: Record<CamMode, string> = { chase: 'Ззаду', cockpit: 'Салон' };
const CKEY = 'route7.cam';
export function loadCam(): CamMode {
  const c = new URLSearchParams(location.search).get('cam');
  if (c === 'chase' || c === 'cockpit') return c;
  try { const s = localStorage.getItem(CKEY); if (s === 'chase' || s === 'cockpit') return s; } catch { /* без збереження */ }
  return 'chase';
}
export function saveCam(c: CamMode): void {
  try { localStorage.setItem(CKEY, c); } catch { /* ігноруємо */ }
}
