// Перевірка геометрії маршруту №1: малює зібрану мережу (src/data/route1.json) поверх офіційної схеми.
//   node tools/overlay-route1.mjs [scheme.jpg]           → dist/route1-overlay.png (+ збільшені фрагменти dist/route1-overlay-*.png)
//   node tools/overlay-route1.mjs --world x0 z0 x1 z1 px → dist/route1-world.png (без схеми, px — пікселів на метр)
// Схема: «Маршрут №1 … ТСЦ № 8042», наказ від 24.12.2025 № 287н, північ угорі (підкладка — OSM Carto).
// Вирівнювання: афінне перетворення за найменшими квадратами по орієнтирах (вузол OSM ↔ піксель схеми, 1654×2339).
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadOSM, makeProjection } from './osm-lib.mjs';

const data = JSON.parse(readFileSync('src/data/route1.json', 'utf8'));
const args = process.argv.slice(2);
const world = args[0] === '--world';
const SCHEME_DEFAULT = '/root/.claude/uploads/8d8585ad-2a49-5015-9695-182608719706/d74eb131-image.jpg';
const schemePath = !world ? args[0] ?? (existsSync('data/route1-scheme.jpg') ? 'data/route1-scheme.jpg' : SCHEME_DEFAULT) : null;

// Орієнтири: перехрестя доріг, виміряні на схемі (центр проїзної частини на підкладці OSM Carto) — px оригіналу.
// Звірено візуально на збільшених фрагментах (кільце, Мрії/Турчина, Стеценка/Турчина, Виговського).
const LANDMARKS = [
  { node: 313276316, px: [400.0, 1778.0], what: 'вул. Мрії / вул. Ігоря Турчина' },
  { node: 26331468, px: [1330.6, 1731.5], what: 'вул. Стеценка (на ПЗ) / вул. Івана Виговського' },
  { node: 354998568, px: [427.8, 1111.2], what: 'кільце: зʼїзд на вул. Стеценка' },
  { node: 1663153934, px: [1146.7, 1637.3], what: 'вул. Стеценка: лівий поворот на Турчина' },
  { node: 2032303459, px: [393.0, 1235.0], what: 'вул. Мрії / вул. Кутова' },
];

function fitAffine(pairs) {
  // px = A·[x, z, 1]: два незалежні МНК 3×3.
  const solve = (k) => {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
    for (const { w, p } of pairs) {
      const r = [w[0], w[1], 1];
      for (let i = 0; i < 3; i++) { v[i] += r[i] * p[k]; for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; }
    }
    // Гаусс.
    for (let i = 0; i < 3; i++) {
      let m = i; for (let j = i + 1; j < 3; j++) if (Math.abs(M[j][i]) > Math.abs(M[m][i])) m = j;
      [M[i], M[m]] = [M[m], M[i]]; [v[i], v[m]] = [v[m], v[i]];
      for (let j = i + 1; j < 3; j++) { const f = M[j][i] / M[i][i]; for (let q = i; q < 3; q++) M[j][q] -= f * M[i][q]; v[j] -= f * v[i]; }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) { let s = v[i]; for (let j = i + 1; j < 3; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return x;
  };
  return [solve(0), solve(1)];
}

let affine = null;
if (!world) {
  const osm = loadOSM(['data/raw/tile-a.osm', 'data/raw/tile-b.osm']);
  const proj = makeProjection(data.meta.origin.lat, data.meta.origin.lon);
  const pairs = LANDMARKS.map((l) => { const n = osm.nodes.get(l.node); return { w: proj.fwd(n.lat, n.lon), p: l.px, what: l.what }; });
  affine = fitAffine(pairs);
  for (const q of pairs) {
    const x = affine[0][0] * q.w[0] + affine[0][1] * q.w[1] + affine[0][2], y = affine[1][0] * q.w[0] + affine[1][1] * q.w[1] + affine[1][2];
    console.log(`landmark ${q.what}: residual ${Math.hypot(x - q.p[0], y - q.p[1]).toFixed(1)} px`);
  }
  console.log('m/px ≈', (1 / Math.hypot(affine[0][0], affine[1][0])).toFixed(3), (1 / Math.hypot(affine[0][1], affine[1][1])).toFixed(3));
}

const img = schemePath ? 'data:image/jpeg;base64,' + readFileSync(schemePath).toString('base64') : null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const page = await browser.newPage();
const view = world ? args.slice(1, 6).map(Number) : null;
const out = await page.evaluate(async ({ data, img, affine, view }) => {
  const cv = document.createElement('canvas');
  let T;
  let bg = null;
  if (img) {
    bg = new Image(); bg.src = img; await bg.decode();
    cv.width = bg.width; cv.height = bg.height;
    T = (x, z) => [affine[0][0] * x + affine[0][1] * z + affine[0][2], affine[1][0] * x + affine[1][1] * z + affine[1][2]];
  } else {
    const [x0, z0, x1, z1, s] = view;
    cv.width = Math.round((x1 - x0) * s); cv.height = Math.round((z1 - z0) * s);
    T = (x, z) => [(x - x0) * s, (z - z0) * s];
  }
  const sc = img ? Math.hypot(affine[0][0], affine[1][0]) : view[4]; // px на метр
  const g = cv.getContext('2d');
  if (bg) { g.drawImage(bg, 0, 0); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, cv.width, cv.height); }
  else { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, cv.width, cv.height); }
  const line = (pts, color, w, dash = []) => { g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash); g.beginPath(); pts.forEach((p, i) => { const q = T(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke(); g.setLineDash([]); };
  const offset = (pts, d) => pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, hx = (b[0] - a[0]) / L, hz = (b[1] - a[1]) / L;
    return [p[0] - hz * d, p[1] + hx * d];
  });
  const dot = (x, z, r, color, fill = true) => { const q = T(x, z); g.beginPath(); g.arc(q[0], q[1], r, 0, Math.PI * 2); if (fill) { g.fillStyle = color; g.fill(); } else { g.strokeStyle = color; g.lineWidth = 2; g.stroke(); } };
  if (!img) {
    for (const b of data.buildings) { g.fillStyle = '#d9d0c4'; g.beginPath(); b.pts.forEach((p, i) => { const q = T(p[0], p[1]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.fill(); }
    for (const c of data.context) line(c.pts, c.kind === 'footway' || c.kind === 'path' ? '#b9d7b0' : '#c8c8c8', Math.max(1, c.width * sc * 0.8));
  }
  // Проїзні частини (ширина = смуги), осі смуг.
  for (const e of data.edges) {
    const w = e.lanes * e.laneWidth;
    line(offset(e.ref, w / 2), e.kind === 'side' || e.kind === 'driveway' ? 'rgba(0,150,200,0.35)' : 'rgba(0,160,60,0.32)', Math.max(1, w * sc));
  }
  for (const r of data.rings) for (const l of [0, 1]) { const q = T(r.cx, r.cz); g.strokeStyle = 'rgba(0,160,60,0.32)'; g.lineWidth = r.laneWidth * sc; g.beginPath(); g.arc(q[0], q[1], (r.r + (l - 0.5) * r.laneWidth) * sc, 0, Math.PI * 2); g.stroke(); }
  for (const e of data.edges) {
    line(e.ref, '#2a6', 1);
    for (let i = 0; i < e.lanes; i++) line(offset(e.ref, (i + 0.5) * e.laneWidth), '#064', Math.max(0.6, sc * 0.12), [4, 4]);
    const q = T(e.ref[0][0], e.ref[0][1]);
    if (!img || e.kind === 'street') { g.fillStyle = '#064'; g.font = `${Math.max(9, sc * 2.2)}px sans-serif`; g.fillText(e.id, q[0] + 3, q[1] - 3); }
  }
  for (const c of data.connectors) line(c.path, c.id.startsWith('J_') ? '#e07000' : c.id.startsWith('R:') ? '#a060c0' : '#3399cc', Math.max(1, sc * 0.35));
  for (const c of data.crossings) { line([c.a, c.b], c.source === 'scheme' ? 'rgba(255,0,200,0.9)' : c.kind === 'signal' ? 'rgba(220,0,0,0.85)' : 'rgba(255,255,255,0.95)', Math.max(2, c.width * sc)); line([c.a, c.b], '#222', 0.8, [3, 3]); }
  for (const s of data.stopLines) line([s.a, s.b], s.kind === 'signal' ? '#d00' : '#333', Math.max(1.5, sc * 0.4));
  for (const s of data.signals) dot(s.x, s.z, Math.max(2.5, sc * 0.9), s.kind === 'ped' ? '#ff00aa' : '#ff2020');
  for (const b of data.busStops) dot(b.x, b.z, Math.max(2, sc * 0.8), '#0050ff');
  line(data.route.polyline, 'rgba(230,0,0,0.75)', Math.max(2, sc * 0.9), [10, 6]);
  for (const cp of data.route.checkpoints) { dot(cp.x, cp.z, 6, '#000', false); const q = T(cp.x, cp.z); g.fillStyle = '#000'; g.font = 'bold 13px sans-serif'; g.fillText(cp.label, q[0] + 8, q[1] - 6); }
  if (img) {
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(20, cv.height - 120, 760, 100);
    g.fillStyle = '#000'; g.font = '15px sans-serif';
    g.fillText('Зелене — проїзні частини з OSM (смуги), червоний пунктир — маршрут гравця, помаранчеве — зʼєднувачі перехресть,', 30, cv.height - 95);
    g.fillText('фіолетове — кільце, біле — зебри OSM, червоне — регульовані переходи, малинове — переходи, додані за схемою.', 30, cv.height - 75);
    g.fillText('Червоні точки — голови світлофорів, сині — зупинки. Map data © OpenStreetMap contributors, ODbL.', 30, cv.height - 55);
  }
  return cv.toDataURL('image/png');
}, { data, img, affine, view });
mkdirSync('dist', { recursive: true });
const buf = Buffer.from(out.split(',')[1], 'base64');
if (world) { writeFileSync('dist/route1-world.png', buf); console.log('dist/route1-world.png'); }
else {
  writeFileSync('dist/route1-overlay.png', buf);
  console.log('dist/route1-overlay.png');
  // Збільшені фрагменти (px оригіналу схеми).
  const crops = { ring: [140, 860, 420, 380], loop: [1000, 1480, 520, 440], tur: [600, 1520, 620, 330], corner: [300, 1600, 320, 260], mrii: [280, 1150, 300, 520] };
  const page2 = await browser.newPage();
  for (const [name, [x, y, w, h]] of Object.entries(crops)) {
    const u = await page2.evaluate(async ({ src, x, y, w, h }) => {
      const im = new Image(); im.src = src; await im.decode();
      const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, x, y, w, h, 0, 0, w * 2, h * 2);
      return c.toDataURL('image/png');
    }, { src: out, x, y, w, h });
    writeFileSync(`dist/route1-overlay-${name}.png`, Buffer.from(u.split(',')[1], 'base64'));
  }
  console.log('crops:', Object.keys(crops).map((k) => `dist/route1-overlay-${k}.png`).join(' '));
}
await browser.close();
