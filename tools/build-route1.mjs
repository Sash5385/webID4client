// Збірка мережі маршруту №1 (ТСЦ 8042) з OSM: node tools/build-route1.mjs → src/data/route1.json
//
// Дані: data/raw/tile-*.osm, map-route1.osm (OSM API 0.6, bbox lon 30.385–30.45, lat 50.452–50.49).
// © OpenStreetMap contributors, ODbL 1.0.
//
// Що робить:
//  1) ланцюжки OSM-ways (у напрямку руху) → проїзні частини: ліва межа (ref), кількість смуг з тегу lanes,
//     плавний перехід між двосторонньою дорогою і розділеними проїзними частинами (див. leftOffset);
//  2) ребра (edges) з постійною кількістю смуг; зміна кількості — лише праворуч (смуга i → смуга i);
//  3) кільце (коло найменших квадратів по OSM), вʼїзди/зʼїзди з кожної смуги;
//  4) перехрестя з маршруту (світлофори, фази A/B), розворот, лівий поворот, бічні вулиці/виїзди (правий поворот);
//  5) переходи (OSM + додані за схемою), стоп-лінії, голови світлофорів, знаки, зупинки, будинки, контекстні дороги;
//  6) маршрут гравця (кроки, контрольні точки, полілінія).
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  bezier, convexHull, cumLen, dist, distToPolyline, fitCircle, loadOSM, makeProjection, maxCurvature, offsetPts, poseAt,
  project, r2, resample, rightNormals, simplify, smoothPts, smoothVals,
} from './osm-lib.mjs';

const W = 3.5;            // ширина смуги, м
const SIDE_W = 3.0;       // смуга бічної вулиці/виїзду
const RAW = 'data/raw/';
const osm = loadOSM(['tile-a.osm', 'tile-b.osm', 'tile-c.osm', 'tile-d.osm', 'map-route1.osm', 'tile-n1.osm'].map((f) => RAW + f));
const { nodes, ways } = osm;
console.log('OSM:', nodes.size, 'nodes,', ways.size, 'ways');

// ---------- Кільце: центр = початок координат ----------
const RING_WAYS = [1093186662, 1188066232, 508333715, 1344028982, 1093186714, 1344028983];
let proj = makeProjection(50.4864, 30.3958);
{
  const pts = [];
  for (const w of RING_WAYS) for (const id of ways.get(w).nds) { const n = nodes.get(id); pts.push(proj.fwd(n.lat, n.lon)); }
  const c = fitCircle(pts);
  const [lat0, lon0] = proj.inv(c.cx, c.cz);
  proj = makeProjection(lat0, lon0);
}
const P = (id) => { const n = nodes.get(id); if (!n) throw new Error('node ' + id); return proj.fwd(n.lat, n.lon); };
const PL = (lat, lon) => proj.fwd(lat, lon);
const ringFit = fitCircle(RING_WAYS.flatMap((w) => ways.get(w).nds.map(P)));
console.log('ring', ringFit.cx.toFixed(2), ringFit.cz.toFixed(2), 'r', ringFit.r.toFixed(2));
const RING = { cx: 0, cz: 0, r: ringFit.r };
const ringTheta = (p) => Math.atan2(-(p[1] - RING.cz), p[0] - RING.cx);

// ---------- Ланцюжки (проїзні частини у напрямку руху) ----------
const MRII_SOUTH = [819267985, 844334865, 844334866, 844334867, 470556291, 844334868, 470556290, 470556289, 844334869, 466653482, 466653476]; // від Салютної до Турчина
const MRII = [...MRII_SOUTH, 466653489, 466653473, 420204508, 470556288, 420204507, 466653470, 420204505, 466653466, 691769729, 376516691, 420204506, 466653465, 250101581, 466653464, 1093245223];
const STET_TWO_A = [1092036048, 1092036049, 1092036050, 1092036051, 1092036052, 1092036053, 1092036054, 1092036055, 1092036056, 5169681];
const STET_SE_LOOP = [702901553, 37555812, 1525715385, 487842245, 622839612, 1167320829, 487842240, 5169679, 1500230777, 1500230779];
const STET_NW_LOOP = [5169678, 1500230780, 487842236, 622839611, 487842249, 1102712004, 50071504, 1188066239];
const STET_C = [1092036057, 1092036058, 164372194]; // від пл. Марченка до перехрестя з бульваром Вірського (вузол 26331445)
const STET_TWO_B = [728339293, 1485641763, 487450912, 191148484, 191148481, 191148482, 191148483];
const VYH = [718783651, 466651649, 618321571, 50071506, 8161090, 8161093, 1097808397, 482040123, 618574696, 470563731, 618574699, 482040124];

const VYH_S = [1416759871, 470563733, 470563732, 470563734, 622835730, 470563735, 470563736, 470563737, 470563738, 470563739, 470563740, 470563741, 470563742, 470563743, 319216289, 470563744]; // від Турчина до Ружинської (вузол 248884812)

const VH_N = [718783651, 470548841, 470548839, 466651648, 470548838, 470546943, 470546941, 470546938, 466651647, 470546934, 470546931, 466651646, 470546926, 470546924, 470546921, 470546916]; // від пл. Марченка до вул. Віктора Некрасова (вузол 347849289)

const MS2_N = [23650186, 684737173, 443872277, 470556293, 470556292]; // Мрія від Берестейського проспекту (вузол 256221809) до Салютної
const BER_W = [229262426, 444172679, 1504006275, 1504006278, 37616631, 1124632954, 37616632]; // Берестейський проспект на захід: від вул. Нивської до Святошина (вузол 254400967)
const BER_E = [452332616, 1473665787, 37616633, 1504006279, 1504006274, 1525715384, 37616634]; // на схід: від Святошина до вул. Нивської (вузол 440015683)

const CHAINS = [
  { id: 'stet_se', name: 'вул. Стеценка', ways: [31729519, ...STET_TWO_A, ...STET_SE_LOOP, ...STET_TWO_B, ...STET_C], start: 354998568, end: 26331445, twin: 'stet_nw', ringStart: true, owner: true, trimEnd: 14 },
  { id: 'stet_nw', name: 'вул. Стеценка', ways: [...STET_C.slice().reverse(), ...STET_TWO_B.slice().reverse(), ...STET_NW_LOOP, ...STET_TWO_A.slice().reverse(), 31729525], start: 26331445, end: 354998575, twin: 'stet_se', ringEnd: true, trimStart: 14 },
  { id: 'w_in', name: 'вул. Стеценка (з боку автодрому)', ways: [1089663285, 31729524], start: 4471461683, end: 354998515, twin: 'n_out', ringEnd: true, owner: true, kind: 'arm', trimStart: 8 },
  { id: 'n_out', name: 'вул. Стеценка (до автодрому)', ways: [31729523, 1089663285], start: 354998578, end: 4471461683, twin: 'w_in', ringStart: true, kind: 'arm', trimEnd: 8 },
  { id: 'tur_w', name: 'вул. Ігоря Турчина', ways: [28519642], start: 26331567, end: 313276316, trimStart: 5.5, trimEnd: 8, owner: true },
  { id: 'tur_e', name: 'вул. Ігоря Турчина', ways: [28519642], start: 313276316, end: 26331567, trimStart: 8, trimEnd: 3.5 },
  { id: 'mrii_n', name: 'вул. Мрії', ways: [...MRII, 31729522], start: 26331313, end: 354998565, twin: 'mrii_s', ringEnd: true, owner: true },
  { id: 'mrii_s', name: 'вул. Мрії', ways: [31729521, ...MRII.slice().reverse()], start: 354998555, end: 26331313, twin: 'mrii_n', ringStart: true, cont: 'ms2_s' },
  { id: 'vyh_s', name: 'вул. Івана Виговського / Данила Щербаківського', ways: VYH, start: 1758132207, end: 8315768936, owner: true, kind: 'cross', cont: 'sh_s' },
  { id: 'sh_s', name: 'вул. Данила Щербаківського', ways: VYH_S, start: 8315768936, end: 248884812, trimEnd: 8, owner: true },
  { id: 'vyh_n', name: 'вул. Данила Щербаківського / Івана Виговського', ways: VYH.slice().reverse(), start: 8315768936, end: 1758132207, kind: 'cross', cont: 'vh_n' },
  { id: 'vh_n', name: 'вул. Івана Виговського', ways: VH_N, start: 1758132207, end: 347849289, trimEnd: 8, owner: true },
  { id: 'vh_s', name: 'вул. Івана Виговського', ways: VH_N.slice().reverse(), start: 347849289, end: 1758132207, trimStart: 8, cont: 'vyh_s' },
  { id: 'sh_n', name: 'вул. Данила Щербаківського', ways: VYH_S.slice().reverse(), start: 248884812, end: 8315768936, trimStart: 8, cont: 'vyh_n' },
  { id: 'sal_w', name: 'вул. Салютна', ways: [1200690577, 319216291, 819267983, 5169675], start: 248885006, end: 26331313, trimStart: 10, trimEnd: 12, owner: true },
  { id: 'ms2_n', name: 'вул. Мрії', ways: MS2_N, start: 256221809, end: 26331313, twin: 'ms2_s', trimStart: 14, cont: 'mrii_n', owner: true },
  { id: 'ms2_s', name: 'вул. Мрії', ways: MS2_N.slice().reverse(), start: 26331313, end: 256221809, twin: 'ms2_n', trimEnd: 14 },
  { id: 'ber_w', name: 'Берестейський проспект', ways: BER_W, start: 440015727, end: 254400967, twin: 'ber_e', trimStart: 12, trimEnd: 14, owner: true },
  { id: 'ber_e', name: 'Берестейський проспект', ways: BER_E, start: 9859720277, end: 440015683, twin: 'ber_w', trimStart: 4, trimEnd: 14 },
  { id: 'ruz_e', name: 'Ружинська вулиця', ways: [1167320833, 1167320831], start: 248884812, end: 248885007, trimStart: 8, trimEnd: 8, owner: true },
  { id: 'ruz_w', name: 'Ружинська вулиця', ways: [1167320831, 1167320833], start: 248885007, end: 248884812, trimStart: 8, trimEnd: 8 },
  { id: 'vir_n', name: 'бульвар Павла Вірського', ways: [1167320830, 23063845, 37555822], start: 1840551865, end: 26331445, twin: 'vir_s', trimEnd: 18, owner: true },
  { id: 'vir_s', name: 'бульвар Павла Вірського', ways: [37555822, 23063793, 1167320832], start: 26331445, end: 248884561, twin: 'vir_n', trimStart: 18, cont: 'kor_ne' },
  { id: 'kor_ne', name: 'вулиця Януша Корчака', ways: [1194657372, 164372189], start: 248884561, end: 10826970510, trimEnd: 8, owner: true },
  { id: 'kor_sw', name: 'вулиця Януша Корчака', ways: [164372189, 1194657372], start: 10826970510, end: 248884561, trimStart: 8 },
  { id: 'gm_w', name: 'вулиця Ґолди Меїр', ways: [8389266], start: 10826970511, end: 248885008, trimStart: 8, trimEnd: 12, owner: true },
  { id: 'gm_e', name: 'вулиця Ґолди Меїр', ways: [8389266], start: 248885008, end: 10826970511, trimStart: 12, trimEnd: 8 },
  { id: 'sal_e', name: 'вул. Салютна', ways: [5169675, 819267983], start: 26331313, end: 26331308, trimStart: 12, trimEnd: 16 },
];
const RING_TRIM = RING.r + W + 6.5;
const RING_MIN_R = 11; // зовнішня межа кільця + 6.5 м: тут кінчається рукав

const LANES_FIX = new Map([466653476, 466653489, 466653473, 420204508, 470556288, 420204507, 466653470, 420204505, 466653466, 691769729].map((id) => [id, 4]));

// Орієнтований ланцюжок вузлів з атрибутами сегментів.
function chainNodes(ch) {
  const ids = [], seg = [];
  let cur = ch.start;
  ch.ways.forEach((wid, k) => {
    const w = ways.get(wid);
    if (!w) throw new Error('way ' + wid);
    const nds = w.nds;
    const i0 = nds.indexOf(cur);
    if (i0 < 0) throw new Error(`${ch.id}: way ${wid} has no node ${cur}`);
    let target;
    if (k === ch.ways.length - 1) target = ch.end;
    else { const nx = ways.get(ch.ways[k + 1]).nds; target = nds.find((id) => nx.includes(id) && id !== cur); }
    const i1 = nds.indexOf(target);
    if (i1 < 0) throw new Error(`${ch.id}: way ${wid} → no link to next`);
    const oneway = w.tags.oneway === 'yes';
    const fwd = i1 > i0;
    if (oneway && !fwd) throw new Error(`${ch.id}: oneway ${wid} reversed`);
    // Мрії між ДС і виїздом до кільця (за супутником — по 2 смуги в кожен бік; в OSM тег lanes=2).
    const lanesTag = LANES_FIX.get(wid) ?? +(w.tags.lanes ?? (oneway ? 1 : 2));
    const dirTag = fwd ? w.tags['lanes:forward'] : w.tags['lanes:backward'];
    const n = oneway ? lanesTag : dirTag ? +dirTag : Math.max(1, Math.round(lanesTag / 2));
    const mh = oneway ? 0 : lanesTag >= 4 ? 0.5 : 0.1;
    const slice = fwd ? nds.slice(i0, i1 + 1) : nds.slice(i1, i0 + 1).reverse();
    for (let i = ids.length ? 1 : 0; i < slice.length; i++) {
      ids.push(slice[i]);
      if (ids.length > 1) seg.push({ way: wid, oneway, n, mh, highway: w.tags.highway, name: w.tags.name ?? '' });
    }
    cur = target;
  });
  return { ids, seg };
}

const chains = new Map();
for (const ch of CHAINS) {
  const { ids, seg } = chainNodes(ch);
  const raw = ids.map(P);
  // Ресемплінг 1 м, з атрибутом сегмента для кожної точки.
  const cumRaw = cumLen(raw);
  const L = cumRaw[cumRaw.length - 1];
  const N = Math.round(L);
  const pts = [], attrs = [];
  let si = 0;
  for (let i = 0; i <= N; i++) {
    const s = (L * i) / N;
    while (si < seg.length - 1 && cumRaw[si + 1] <= s) si++;
    const p = poseAt(raw, cumRaw, s);
    pts.push([p.x, p.z]);
    attrs.push(seg[si]);
  }
  chains.set(ch.id, { spec: ch, ids, raw, cumRaw, pts, attrs });
}

// Відстань до осі протилежної проїзної частини (лише її односторонні ways): для плавного розходження.
function twinLines(ch) {
  if (!ch.spec.twin) return [];
  const t = chains.get(ch.spec.twin);
  const out = [];
  let cur = null;
  // Сегменти twin, що належать одностороннім ways.
  for (let i = 0; i < t.raw.length - 1; i++) {
    // Атрибут сегмента i: знайдемо за відстанню по cumRaw.
    const sMid = (t.cumRaw[i] + t.cumRaw[i + 1]) / 2;
    const a = t.attrs[Math.min(t.attrs.length - 1, Math.round(sMid))];
    if (a.oneway) { if (!cur) { cur = [t.raw[i]]; out.push(cur); } cur.push(t.raw[i + 1]); } else cur = null;
  }
  return out;
}

// Ліва межа проїзної частини (= ref ребра). Двостороння: вісь + mh праворуч. Одностороння: вісь − n·W/2,
// але не далі, ніж до середини між цією і протилежною віссю (D/2 − mh): так розходження «від вузла» плавне.
for (const ch of chains.values()) {
  const cen = smoothPts(ch.pts, 3);
  const tw = twinLines(ch);
  const off = cen.map((p, i) => {
    const a = ch.attrs[i];
    if (!a.oneway) return a.mh;
    let D = Infinity;
    for (const line of tw) D = Math.min(D, distToPolyline(line, p));
    return -Math.min((a.n * W) / 2, D / 2 - 0.5);
  });
  const offS = smoothVals(off, 12);
  ch.centre = cen;
  ch.off = offS;
  ch.left = offsetPts(cen, offS);
  ch.lanes = ch.attrs.map((a) => a.n);
  ch.cum = cumLen(cen);
}

// Обрізання біля кільця / перехресть.
function trimRange(ch) {
  const n = ch.centre.length;
  let i0 = 0, i1 = n - 1;
  if (ch.spec.ringStart) while (i0 < n - 1 && dist(ch.centre[i0], [RING.cx, RING.cz]) < RING_TRIM) i0++;
  if (ch.spec.ringEnd) while (i1 > 0 && dist(ch.centre[i1], [RING.cx, RING.cz]) < RING_TRIM) i1--;
  if (ch.spec.trimStart) i0 += Math.round(ch.spec.trimStart);
  if (ch.spec.trimEnd) i1 -= Math.round(ch.spec.trimEnd);
  return [i0, i1];
}

// s на осі ланцюжка для вузла OSM.
const chainS = (ch, id) => project(ch.centre, ch.cum, P(id)).s;
const chainSPt = (ch, p) => project(ch.centre, ch.cum, p);

// ---------- Переходи (OSM + схема) ----------
// Перехід = один або кілька вузлів на одній «зебрі»/пішохідній доріжці через усі проїзні частини.
const footByNode = new Map();
for (const w of ways.values()) {
  if (!['footway', 'path', 'pedestrian', 'steps', 'cycleway'].includes(w.tags.highway)) continue;
  for (const id of w.nds) { if (!footByNode.has(id)) footByNode.set(id, []); footByNode.get(id).push(w.id); }
}
const chainOf = new Map(); // way → [chain ids]
for (const ch of chains.values()) for (const w of ch.spec.ways) { if (!chainOf.has(w)) chainOf.set(w, []); chainOf.get(w).push(ch.spec.id); }
// Вузли-світлофори самих перехресть з тегом crossing: окремого переходу там немає (переходи — на плечах).
const NO_XING_NODES = new Set([26331308]);
const XINGS = []; // { id, nodes: [ids], kind, source, pts: [[x,z]], chains: Set }
{
  const seen = new Set();
  const crossNodes = [];
  for (const ch of chains.values()) for (const id of ch.ids) {
    const t = nodes.get(id).tags;
    if (seen.has(id) || NO_XING_NODES.has(id)) continue;
    if (t.crossing === 'unmarked' && t.highway !== 'traffic_signals') continue; // немарковане: пішоходи без переваги, переходу в моделі нема
    if (t.highway === 'crossing' || t.crossing || (t.highway === 'traffic_signals' && footByNode.has(id))) { seen.add(id); crossNodes.push(id); }
  }
  // Групування: вузли однієї пішохідної доріжки (≤ 40 м) — один перехід.
  const used = new Set();
  for (const id of crossNodes) {
    if (used.has(id)) continue;
    const group = [id];
    used.add(id);
    const fw = footByNode.get(id) ?? [];
    for (const o of crossNodes) if (!used.has(o) && (footByNode.get(o) ?? []).some((w) => fw.includes(w)) && dist(P(o), P(id)) < 40) { group.push(o); used.add(o); }
    const tags = group.map((g) => nodes.get(g).tags);
    const sig = tags.some((t) => t.crossing === 'traffic_signals' || t.highway === 'traffic_signals');
    XINGS.push({ id: 'x' + id, nodes: group, kind: sig ? 'signal' : 'zebra', source: 'osm', pts: group.map(P) });
  }
}
// Переходи зі схеми, яких немає в OSM (знаки «Пішохідний перехід» з обох боків). Координати — lat/lon оцінки за схемою.
const SCHEME_XINGS = [
  { id: 'xs_stet_central', lat: 50.48368, lon: 30.40146, chains: ['stet_se', 'stet_nw'], note: 'вул. Стеценка біля Центральної' },
  { id: 'xs_tur_223', lat: 50.48147, lon: 30.39895, chains: ['tur_w', 'tur_e'], note: 'вул. Ігоря Турчина, x≈223' },
  { id: 'xs_tur_338', lat: 50.48150, lon: 30.40057, chains: ['tur_w', 'tur_e'], note: 'вул. Ігоря Турчина, x≈338' },
];
for (const sx of SCHEME_XINGS) XINGS.push({ id: sx.id, nodes: [], kind: 'zebra', source: 'scheme', pts: [PL(sx.lat, sx.lon)], chainsHint: sx.chains, note: sx.note });

// ---------- Перехрестя з маршруту (специфікація) ----------
// group A — головна дорога, B — поперечна. pedGroup: 'acrossA' (пішоходи йдуть, коли A червоний), 'acrossB'.
const JUNCTIONS = [
  {
    id: 'J_TUR', name: 'вул. Стеценка / вул. Ігоря Турчина', kind: 'signal', node: 26331567, offset: 8,
    approaches: [
      { chain: 'stet_se', group: 'A', stopBeforeNode: 4412320928, gap: 3.2, zoneAfterNode: [26331567, 9] },
      { chain: 'stet_nw', group: 'A', stopBeforeNode: 1663153934, gap: 7, zoneAfterNode: [4412320929, 3] },
      { chain: 'tur_e', group: 'B', stopBeforeNode: 4308159134, gap: 3.2, zoneToEnd: true }, // стоп-лінія перед зеброю біля перехрестя
    ],
    crossings: { x4412320928: 'acrossA' },
  },
  {
    id: 'J_VYH', name: 'вул. Стеценка / вул. Івана Виговського (пл. Валерія Марченка)', kind: 'signal', node: 26331468, offset: 22,
    approaches: [
      { chain: 'stet_se', group: 'A', stopBeforeNode: 26304095, gap: 6, zoneAfterNode: [26304095, 8], clearOf: ['vyh_s', 'vyh_n'] },
      { chain: 'stet_nw', group: 'A', stopBeforeNode: 26331468, gap: 6, zoneAfterNode: [26331468, 8], clearOf: ['vyh_s', 'vyh_n'] },
      { chain: 'vyh_s', group: 'B', stopBeforeNode: 26331468, gap: 5, zoneAfterNode: [26331468, 7], clearOf: ['stet_nw'] },
      { chain: 'vyh_s', group: 'B', stopBeforeNode: 26304095, gap: 5, zoneAfterNode: [26304095, 7], clearOf: ['stet_se'] },
      { chain: 'vyh_n', group: 'B', stopBeforeNode: 26304095, gap: 5, zoneAfterNode: [26304095, 7], clearOf: ['stet_se'] },
      { chain: 'vyh_n', group: 'B', stopBeforeNode: 26331468, gap: 5, zoneAfterNode: [26331468, 7], clearOf: ['stet_nw'] },
    ],
    crossings: {},
  },
  {
    id: 'J_MT', name: 'вул. Мрії / вул. Ігоря Турчина', kind: 'signal', node: 313276316, offset: 40,
    approaches: [
      { chain: 'mrii_n', group: 'A', stopBeforeNode: 4308047302, gap: 3.2, zoneAfterNode: [313276316, 6] },
      { chain: 'mrii_s', group: 'A', stopBeforeNode: 4308063897, gap: 3.2, zoneAfterNode: [313276316, 6] },
      { chain: 'tur_w', group: 'B', stopBeforeNode: 4308061890, gap: 3.2, zoneToEnd: true },
    ],
    crossings: { x4308047302: 'acrossA', x4308063897: 'acrossA', x4308061890: 'acrossB' },
  },
  {
    id: 'J_SAL', name: 'вул. Мрії / вул. Салютна', kind: 'signal', node: 26331313, offset: 28,
    approaches: [
      { chain: 'mrii_s', group: 'A', stopAtEnd: 10 },
      { chain: 'ms2_n', group: 'A', stopBeforeNode: 6398094081, gap: 3.2, zoneAfterNode: [26331313, 6] },
      { chain: 'sal_w', group: 'B', stopAtEnd: 3 },
    ],
    crossings: { x6398094081: 'acrossA' },
  },
  {
    id: 'J_SH', name: 'вул. Щербаківського / вул. Салютна', kind: 'signal', node: 26331308, offset: 36,
    approaches: [
      { chain: 'sh_s', group: 'A', stopBeforeNode: 3750772228, gap: 3.2, zoneAfterNode: [26331308, 6] },
      { chain: 'sh_n', group: 'A', stopBeforeNode: 3750772227, gap: 3.2, zoneAfterNode: [26331308, 6] },
      { chain: 'sal_w', group: 'B', stopBeforeNode: 3750772226, gap: 3.2, zoneAfterNode: [26331308, 6] },
      { chain: 'sal_e', group: 'B', stopAtEnd: 8 }, // перед пішохідним переходом x2387943239 (він одразу за обрізаним кінцем ребра)
    ],
    crossings: { x3750772228: 'acrossA', x3750772227: 'acrossA', x3750772226: 'acrossB' },
  },
  {
    id: 'J_RUZ', name: 'вул. Щербаківського / вул. Ружинська', kind: 'signal', node: 248884812, offset: 44,
    approaches: [
      { chain: 'sh_s', group: 'A', stopBeforeNode: 3750743828, gap: 3.2, zoneAfterNode: [3750743828, 5] },
    ],
    crossings: { x3750743828: 'acrossA' },
  },
  {
    id: 'J_VR', name: 'бульвар Павла Вірського / вул. Ружинська', kind: 'signal', node: 248885007, offset: 20,
    approaches: [
      { chain: 'ruz_e', group: 'B', stopBeforeNode: 3781110623, gap: 3.2, zoneToEnd: true },
      { chain: 'vir_s', group: 'A', stopBeforeNode: 248884566, gap: 11.5, zoneAfterNode: [248884566, 5] }, // стоп-лінія перед зеброю (3781110627)
      { chain: 'vir_n', group: 'A', stopBeforeNode: 5082969773, gap: 3.2, zoneAfterNode: [248885007, 6] },
    ],
    crossings: {},
  },
  {
    id: 'J_VS', name: 'бульвар Павла Вірського / вул. Салютна', kind: 'signal', node: 248885006, offset: 30,
    approaches: [
      { chain: 'vir_n', group: 'A', stopBeforeNode: 3781110638, gap: 3.2, zoneAfterNode: [248885006, 6] },
      { chain: 'vir_s', group: 'A', stopBeforeNode: 248884567, gap: 8, zoneAfterNode: [248884567, 6] },
    ],
    crossings: {},
  },
  {
    id: 'J_VIR', name: 'вул. Стеценка / бульвар Павла Вірського', kind: 'signal', node: 26331445, offset: 24,
    approaches: [
      { chain: 'stet_se', group: 'A', stopBeforeNode: 4257920190, gap: 3.2, zoneAfterNode: [26331445, 6] },
      { chain: 'vir_n', group: 'B', stopBeforeNode: 3816354142, gap: 3.2, zoneAfterNode: [26331445, 6] },
    ],
    crossings: { x4257920190: 'acrossA', x3816354142: 'acrossB' },
  },
  {
    id: 'J_NEK', name: 'вул. Виговського / вул. Віктора Некрасова', kind: 'signal', node: 347849289, offset: 12,
    approaches: [
      { chain: 'vh_n', group: 'A', stopBeforeNode: 4328361615, gap: 3.2, zoneAfterNode: [4328361615, 5] },
    ],
    crossings: { x4328361615: 'acrossA' },
  },
  {
    id: 'J_DS', name: 'вул. Мрії / дитячий садок (вул. Мрії, 56)', kind: 'signal', node: 567895869, offset: 52,
    approaches: [
      { chain: 'mrii_n', group: 'A', stopBeforeNode: 567895869, gap: 5, zoneAfterNode: [6398094594, 3] },
      { chain: 'mrii_s', group: 'A', stopBeforeNode: 6398094594, gap: 3.2, zoneAfterNode: [567895869, 3] },
    ],
    crossings: { x6398094594: 'acrossA' },
  },
  {
    id: 'J_PIV', name: 'вул. Мрії / вул. Південна', kind: 'signal', node: 2032303181, offset: 15,
    approaches: [
      { chain: 'mrii_n', group: 'A', stopBeforeNode: 2032303181, gap: 9, zoneAfterNode: [2032303181, 6] },
      { chain: 'mrii_s', group: 'A', stopBeforeNode: 6521644736, gap: 3.2, zoneAfterNode: [2032303181, 6] },
    ],
    crossings: { x6521644736: 'acrossA' },
    stubs: { 431589291: 'B' },
  },
];
const JNODES = new Set([26331445, 26331449, 248885008, 248885006, 248885007, 248884566, 248884567, 347849289, 26331308, 248884812, 26331313, 567895869, 26331567, 1663153934, 26304095, 26331468, 313276316, 2032303181, 26331585, 354996974, 1471021854, 26331433, 347849846, 354996972, 4654899740, 4654899746, 1756783694]);

// ---------- Ребра ----------
const edges = [];          // результат
const edgeOfChain = new Map(); // chain id → [{edge, i0, i1}]
const xingsOnChain = new Map();

// Позиції, біля яких не можна міняти кількість смуг (переходи, бічні вулиці).
function keepOut(ch) {
  const out = [];
  for (const x of XINGS) for (const id of x.nodes) if (ch.ids.includes(id)) out.push(chainS(ch, id));
  return out;
}

const nodeWays = new Map();
for (const w of ways.values()) if (w.tags.highway) for (const id of w.nds) { if (!nodeWays.has(id)) nodeWays.set(id, []); nodeWays.get(id).push(w.id); }

for (const ch of chains.values()) {
  const [i0, i1] = trimRange(ch);
  // Межі зміни кількості смуг (зсув за перехід/бічну вулицю на 10 м уперед).
  const ko = keepOut(ch);
  for (const id of ch.ids) if ((nodeWays.get(id) ?? []).some((w) => !(chainOf.get(w) ?? []).includes(ch.spec.id))) ko.push(chainS(ch, id));
  const cuts = [];
  for (let i = i0 + 1; i <= i1; i++) if (ch.lanes[i] !== ch.lanes[i - 1]) {
    let s = ch.cum[i];
    for (let it = 0; it < 4; it++) { const k = ko.find((q) => Math.abs(q - s) < 10); if (k === undefined) break; s = k + 10.5; }
    cuts.push({ i: Math.min(i1 - 1, Math.round(s)), from: ch.lanes[i - 1], to: ch.lanes[i] });
  }
  const spans = [];
  let a = i0;
  for (const c of cuts) { spans.push([a, c.i, c.from]); a = c.i; }
  spans.push([a, i1, ch.lanes[i1]]);
  const list = [];
  spans.forEach(([s0, s1, n], k) => {
    const id = spans.length === 1 ? ch.spec.id : `${ch.spec.id}_${'abcdefgh'[k]}`;
    const ref = simplify(ch.left.slice(s0, s1 + 1), 0.04);
    const attrsMid = ch.attrs[Math.round((s0 + s1) / 2)];
    const twoWay = ch.attrs.slice(s0, s1 + 1).some((q) => !q.oneway);
    const mh = Math.max(...ch.attrs.slice(s0, s1 + 1).map((q) => (q.oneway ? 0 : q.mh)));
    const e = {
      id, name: ch.spec.name, chain: ch.spec.id, kind: ch.spec.kind ?? 'street', lanes: n, laneWidth: W, speedKmh: 50,
      median: mh, centreLine: twoWay ? (mh >= 0.4 ? 'double' : 'single') : 'none', centreOwner: !!ch.spec.owner,
      ref, s0: ch.cum[s0], prev: [], next: [], features: [],
      osm: [...new Set(ch.attrs.slice(s0, s1).map((q) => q.way))],
      _ch: ch, _i0: s0, _i1: s1, _refCum: cumLen(ref),
    };
    list.push({ edge: e, i0: s0, i1: s1 });
    edges.push(e);
  });
  for (let k = 1; k < list.length; k++) { list[k - 1].edge.next.push(list[k].edge.id); list[k].edge.prev.push(list[k - 1].edge.id); }
  edgeOfChain.set(ch.spec.id, list);
}
const edgeById = new Map(edges.map((e) => [e.id, e]));
// Продовження ланцюжка іншим (cont): останнє ребро → перше ребро наступного (кількість смуг однакова).
for (const ch of chains.values()) if (ch.spec.cont) {
  const a = edgeOfChain.get(ch.spec.id), b = edgeOfChain.get(ch.spec.cont);
  const ea = a[a.length - 1].edge, eb = b[0].edge;
  ea.next.push(eb.id); eb.prev.push(ea.id);
}

// Точка ланцюжка → (ребро, s по ref).
function onChain(chainId, sChain) {
  const list = edgeOfChain.get(chainId);
  const ch = chains.get(chainId);
  let it = list.find((q) => sChain >= ch.cum[q.i0] - 1e-6 && sChain <= ch.cum[q.i1] + 1e-6);
  if (!it) it = sChain < ch.cum[list[0].i0] ? list[0] : list[list.length - 1];
  const e = it.edge;
  const i = Math.max(0, Math.min(ch.left.length - 1, Math.round(sChain)));
  const s = project(e.ref, e._refCum, ch.left[i]).s;
  return { edge: e, s };
}
const refPose = (e, s) => poseAt(e.ref, e._refCum, s);
// Центр смуги lane (0 — ліва) на ребрі e у точці s.
function lanePose(e, lane, s) {
  const p = refPose(e, s);
  const d = (lane + 0.5) * e.laneWidth;
  return { x: p.x - p.hz * d, z: p.z + p.hx * d, hx: p.hx, hz: p.hz };
}
const edgeLen = (e) => e._refCum[e._refCum.length - 1];

// ---------- Контролери світлофорів ----------
const controllers = [];
for (const j of JUNCTIONS) controllers.push({ id: j.id, offset: j.offset, groups: ['A', 'B'] });

// ---------- Переходи → спани на ребрах ----------
const crossings = [];
for (const x of XINGS) {
  const spans = [];
  const cand = x.chainsHint ?? [...new Set(x.nodes.flatMap((id) => [...chains.values()].filter((ch) => ch.ids.includes(id)).map((ch) => ch.spec.id)))];
  for (const cid of cand) {
    const ch = chains.get(cid);
    if (ch.spec.kind === 'cross') continue;
    // Найближчий вузол групи до цього ланцюжка.
    let best = null;
    for (const p of x.pts) { const q = chainSPt(ch, p); if (!best || q.dist < best.dist) best = q; }
    if (!best || best.dist > 12) continue;
    const [i0, i1] = trimRange(ch);
    if (best.s < ch.cum[i0] + 1) continue;
    let sBest = best.s;
    if (sBest > ch.cum[i1] - 1) { if (sBest > ch.cum[i1] + 10) continue; sBest = ch.cum[i1] - 1.2; } // перехід одразу за обрізаним кінцем ребра: ставимо його на кінець (інакше смуга лишалась би поза переходом)
    const { edge, s } = onChain(cid, sBest);
    spans.push({ edge: edge.id, s: r2(s) });
  }
  if (!spans.length) continue;
  // Геометрія: вісь переходу перпендикулярна першому спану, від крайньої межі до крайньої.
  const e0 = edgeById.get(spans[0].edge), p0 = refPose(e0, spans[0].s);
  const ax = -p0.hz, az = p0.hx; // праворуч від першого ребра
  const ox = p0.x, oz = p0.z;
  const uOf = (x2, z2) => (x2 - ox) * ax + (z2 - oz) * az;
  const vOf = (x2, z2) => (x2 - ox) * p0.hx + (z2 - oz) * p0.hz;
  let umin = Infinity, umax = -Infinity, vsum = 0;
  const spanU = [];
  for (const sp of spans) {
    const e = edgeById.get(sp.edge), p = refPose(e, sp.s);
    const lx = p.x, lz = p.z, rx = p.x - p.hz * e.lanes * e.laneWidth, rz = p.z + p.hx * e.lanes * e.laneWidth;
    const u0 = uOf(lx, lz), u1 = uOf(rx, rz);
    spanU.push([Math.min(u0, u1), Math.max(u0, u1)]);
    umin = Math.min(umin, u0, u1); umax = Math.max(umax, u0, u1);
    vsum += vOf(lx, lz);
  }
  const v = vsum / spans.length;
  const cx = ox + p0.hx * v, cz = oz + p0.hz * v;
  const a = [cx + ax * (umin - 0.3), cz + az * (umin - 0.3)], b = [cx + ax * (umax + 0.3), cz + az * (umax + 0.3)];
  const u0 = umin - 0.3;
  const jn = JUNCTIONS.find((j) => j.crossings[x.id]);
  const c = {
    id: x.id, kind: x.kind, source: x.source, osm: x.nodes, a: [r2(a[0]), r2(a[1])], b: [r2(b[0]), r2(b[1])], width: 4,
    spans: spans.map((sp, k) => ({ ...sp, u0: r2(spanU[k][0] - u0), u1: r2(spanU[k][1] - u0) })),
    ...(x.note ? { note: x.note } : {}),
  };
  if (x.kind === 'signal') {
    if (jn) { c.ctrl = jn.id; c.pedGroup = jn.crossings[x.id]; }
    else { c.ctrl = 'X_' + x.id.slice(1); c.pedGroup = 'acrossA'; controllers.push({ id: c.ctrl, offset: (crossings.length * 17) % 60, groups: ['A'] }); }
  }
  crossings.push(c);
}
for (const c of crossings) for (const sp of c.spans) {
  const e = edgeById.get(sp.edge);
  e.features.push({ id: `${c.id}@${e.id}`, kind: 'crossing', crossing: c.id, s: sp.s, zone: [r2(sp.s - 2), r2(sp.s + 2)], stop: r2(sp.s - 3) });
  // Регульований пішохідний перехід поза перехрестям: власний світлофор для авто.
  if (c.kind === 'signal' && c.ctrl.startsWith('X_')) e.features.push({ id: `${c.id}:sig@${e.id}`, kind: 'signal', ctrl: c.ctrl, group: 'A', s: r2(sp.s - 3), stop: r2(sp.s - 3), zone: [r2(sp.s - 2.5), r2(sp.s + 2)] });
}

// ---------- Підходи до перехресть (стоп-лінії зі світлофором) ----------
const junctions = [];
for (const j of JUNCTIONS) {
  for (const ap of j.approaches) {
    const ch = chains.get(ap.chain);
    let stopChainS, zoneEndChainS;
    const list = edgeOfChain.get(ap.chain);
    if (ap.stopAtEnd !== undefined) {
      const last = list[list.length - 1].edge;
      const L = edgeLen(last);
      last.features.push({ id: `${j.id}:${ap.chain}`, kind: 'signal', junction: j.id, ctrl: j.id, group: ap.group, s: r2(L - ap.stopAtEnd), stop: r2(L - ap.stopAtEnd), zone: [r2(L - ap.stopAtEnd + 0.5), r2(L)] });
      continue;
    }
    stopChainS = chainS(ch, ap.stopBeforeNode) - ap.gap;
    // Косе перехрестя: відступити, доки вся стоп-лінія не буде ≥ 1.5 м від проїзної частини поперечної дороги.
    if (ap.clearOf) {
      const others = ap.clearOf.flatMap((cid) => edgeOfChain.get(cid).map((q) => q.edge));
      const inside = (sc) => {
        const { edge: e0, s: s0 } = onChain(ap.chain, sc);
        const l = refPose(e0, s0);
        for (let u = 0; u <= e0.lanes * e0.laneWidth; u += 0.5) {
          const p = [l.x - l.hz * u, l.z + l.hx * u];
          for (const o of others) { const q = project(o.ref, o._refCum, p); if (q.s > 0 && q.s < edgeLen(o) && q.d > -o.median * 2 - 1.5 && q.d < o.lanes * o.laneWidth + 1.5) return true; }
        }
        return false;
      };
      while (inside(stopChainS)) stopChainS -= 0.5;
    }
    const { edge, s } = onChain(ap.chain, stopChainS);
    let zEnd;
    if (ap.zoneToEnd) zEnd = edgeLen(edge);
    else { zoneEndChainS = chainS(ch, ap.zoneAfterNode[0]) + ap.zoneAfterNode[1]; zEnd = Math.min(edgeLen(edge), onChain(ap.chain, zoneEndChainS).s); }
    edge.features.push({ id: `${j.id}:${ap.chain}:${Math.round(s)}`, kind: 'signal', junction: j.id, ctrl: j.id, group: ap.group, s: r2(s), stop: r2(s), zone: [r2(s + 0.5), r2(zEnd)] });
  }
  const c = P(j.node);
  junctions.push({ id: j.id, name: j.name, kind: j.kind, x: r2(c[0]), z: r2(c[1]), ctrl: j.id, poly: [] });
}

// ---------- Зʼєднувачі ----------
const connectors = [];
let connN = 0;
function mkConn(o) {
  const c = { id: o.id ?? `c${++connN}`, junction: o.junction ?? null, turn: o.turn, rank: o.rank, from: o.from, to: o.to, path: o.path.map((p) => [r2(p[0]), r2(p[1])]) };
  if (o.ctrl) { c.ctrl = o.ctrl; c.group = o.group; }
  if (o.lock) c.lock = o.lock;
  if (o.playerOnly) c.playerOnly = true;
  const k = maxCurvature(o.path);
  c.minRadius = r2(k > 0 ? 1 / k : 999);
  connectors.push(c);
  return c;
}
// Між смугами двох ребер: from — у точці sFrom (на ref), to — у точці sTo.
function laneConn(o) {
  const e0 = edgeById.get(o.fromEdge), e1 = edgeById.get(o.toEdge);
  const p0 = lanePose(e0, o.fromLane, o.sFrom), p3 = lanePose(e1, o.toLane, o.sTo);
  const ch = dist([p0.x, p0.z], [p3.x, p3.z]);
  const path = bezier(p0, p3, ch * (o.k0 ?? 0.4), ch * (o.k1 ?? o.k0 ?? 0.4), o.n ?? 24);
  return mkConn({ ...o, from: { edge: e0.id, lane: o.fromLane, s: r2(o.sFrom) }, to: { edge: e1.id, lane: o.toLane, s: r2(o.sTo) }, path });
}
const chainEdgeS = (chainId, nodeId, delta = 0) => onChain(chainId, chainS(chains.get(chainId), nodeId) + delta);
const firstEdge = (cid) => edgeOfChain.get(cid)[0].edge;
const lastEdge = (cid) => { const l = edgeOfChain.get(cid); return l[l.length - 1].edge; };

// J_TUR: лівий з Стеценки (на ПЗ) на Турчина (маршрут); правий з Стеценки (на ПдС) на Турчина; правий з Турчина на Стеценка.
{
  const a = chainEdgeS('stet_nw', 1663153934, -1);
  const turW = firstEdge('tur_w');
  laneConn({ id: 'J_TUR:left', junction: 'J_TUR', turn: 'left', rank: 1, ctrl: 'J_TUR', group: 'A', lock: 'J_TUR', fromEdge: a.edge.id, fromLane: 0, sFrom: a.s, toEdge: turW.id, toLane: 0, sTo: 6.5, k0: 0.42 });
  const b = chainEdgeS('stet_se', 26331567, -11);
  const seE = b.edge;
  laneConn({ id: 'J_TUR:right_in', junction: 'J_TUR', turn: 'right', rank: 2, ctrl: 'J_TUR', group: 'A', lock: 'J_TUR', fromEdge: seE.id, fromLane: seE.lanes - 1, sFrom: b.s, toEdge: turW.id, toLane: 0, sTo: 6.5, k0: 0.45 });
  const turE = lastEdge('tur_e');
  const c = chainEdgeS('stet_se', 26331567, 9);
  laneConn({ id: 'J_TUR:right_out', junction: 'J_TUR', turn: 'right', rank: 0, ctrl: 'J_TUR', group: 'B', lock: 'J_TUR', fromEdge: turE.id, fromLane: 0, sFrom: edgeLen(turE), toEdge: c.edge.id, toLane: c.edge.lanes - 1, sTo: c.s, k0: 0.45 });
}
// Розворот біля пл. Марченка (OSM 5169677): з лівої смуги Стеценки на ПдС у ліву смугу на ПЗ.
{
  const a = chainEdgeS('stet_se', 26331433, -2);
  const b = chainEdgeS('stet_nw', 347849846, 3);
  const p0 = lanePose(a.edge, 0, a.s), p3 = lanePose(b.edge, 0, b.s);
  // Через середню точку OSM-проїзду (798.5, 633.9) — дві Безьє з горизонтальною дотичною.
  const mid = P(2311631383);
  const mx = (p0.hx - p3.hx), mz = (p0.hz - p3.hz); const ml = Math.hypot(mx, mz) || 1;
  const pm = { x: mid[0] - 1.2 * (mx / ml) * 0, z: mid[1], hx: (p3.x - p0.x) / dist([p0.x, p0.z], [p3.x, p3.z]), hz: (p3.z - p0.z) / dist([p0.x, p0.z], [p3.x, p3.z]) };
  const d1 = dist([p0.x, p0.z], [pm.x, pm.z]), d2 = dist([pm.x, pm.z], [p3.x, p3.z]);
  const path = [...bezier(p0, pm, d1 * 0.55, d1 * 0.45, 16), ...bezier(pm, p3, d2 * 0.45, d2 * 0.55, 16).slice(1)];
  mkConn({ id: 'J_UT:uturn', junction: 'J_UT', turn: 'uturn', rank: 0, lock: 'J_UT', from: { edge: a.edge.id, lane: 0, s: r2(a.s) }, to: { edge: b.edge.id, lane: 0, s: r2(b.s) }, path });
  junctions.push({ id: 'J_UT', name: 'Розворот біля пл. Валерія Марченка', kind: 'uturn', x: r2(mid[0]), z: r2(mid[1]), poly: [] });
}
// J_VYH: праві повороти з правої смуги Стеценки на Виговського/Щербаківського.
{
  const vs = edgeOfChain.get('vyh_s'), vn = edgeOfChain.get('vyh_n');
  // ПЗ → Виговського на північ (права смуга ПЗ закінчується тут: through|through|slight_right).
  const a = chainEdgeS('stet_nw', 26331468, -6);
  const b = chainEdgeS('vyh_n', 26331468, 8);
  laneConn({ id: 'J_VYH:nw_right', junction: 'J_VYH', turn: 'right', rank: 2, ctrl: 'J_VYH', group: 'A', lock: 'J_VYH', fromEdge: a.edge.id, fromLane: a.edge.lanes - 1, sFrom: a.s, toEdge: b.edge.id, toLane: b.edge.lanes - 1, sTo: b.s, k0: 0.45 });
  const c = chainEdgeS('stet_se', 26304095, -6);
  const d = chainEdgeS('vyh_s', 26304095, 8);
  laneConn({ id: 'J_VYH:se_right', junction: 'J_VYH', turn: 'right', rank: 2, ctrl: 'J_VYH', group: 'A', lock: 'J_VYH', fromEdge: c.edge.id, fromLane: c.edge.lanes - 1, sFrom: c.s, toEdge: d.edge.id, toLane: d.edge.lanes - 1, sTo: d.s, k0: 0.45 });
  void vs; void vn;
}
// J_MT: Турчина → Мрії (праворуч — маршрут; ліворуч), Мрії → Турчина (праворуч з N, ліворуч з S).
{
  const tw = lastEdge('tur_w'), te = firstEdge('tur_e');
  const n1 = chainEdgeS('mrii_n', 313276316, 12);
  laneConn({ id: 'J_MT:right', junction: 'J_MT', turn: 'right', rank: 2, ctrl: 'J_MT', group: 'B', lock: 'J_MT', fromEdge: tw.id, fromLane: 0, sFrom: edgeLen(tw), toEdge: n1.edge.id, toLane: n1.edge.lanes - 1, sTo: n1.s, k0: 0.5 });
  const s1 = chainEdgeS('mrii_s', 313276316, 7);
  laneConn({ id: 'J_MT:left', junction: 'J_MT', turn: 'left', rank: 1, ctrl: 'J_MT', group: 'B', lock: 'J_MT', fromEdge: tw.id, fromLane: 0, sFrom: edgeLen(tw), toEdge: s1.edge.id, toLane: 0, sTo: s1.s, k0: 0.45 });
  const n0 = chainEdgeS('mrii_n', 313276316, -7);
  laneConn({ id: 'J_MT:n_right', junction: 'J_MT', turn: 'right', rank: 2, ctrl: 'J_MT', group: 'A', lock: 'J_MT', fromEdge: n0.edge.id, fromLane: n0.edge.lanes - 1, sFrom: n0.s, toEdge: te.id, toLane: 0, sTo: 0, k0: 0.5 });
  const s0 = chainEdgeS('mrii_s', 313276316, -2);
  laneConn({ id: 'J_MT:s_left', junction: 'J_MT', turn: 'left', rank: 1, ctrl: 'J_MT', group: 'A', lock: 'J_MT', fromEdge: s0.edge.id, fromLane: 0, sFrom: s0.s, toEdge: te.id, toLane: 0, sTo: 0, k0: 0.45 });
}
// Розвороти на вул. Мрії (маршрути №6 і №3): з лівої смуги (ПдС) у ліву смугу на ПнС; лише для гравця (ІІ тут не розвертаються).
function mriiUturn(o) {
  const e0 = o.fromEdge, e1 = o.toEdge;
  const p0 = lanePose(e0, 0, o.sFrom), p3 = lanePose(e1, 0, o.sTo);
  // Пряма L0 → півколо ліворуч радіусом R (всередині перехрестя) → плавна S-крива до лівої смуги зустрічного напрямку.
  const R = o.R ?? 3.4, L0 = o.L0;
  const path = [[p0.x, p0.z]];
  const lx = p0.hz, lz = -p0.hx; // ліворуч від напрямку руху
  for (let l = 0.5; l <= L0; l += 0.5) path.push([p0.x + p0.hx * l, p0.z + p0.hz * l]);
  const sx = p0.x + p0.hx * L0, sz = p0.z + p0.hz * L0;
  const cx = sx + lx * R, cz = sz + lz * R; // центр півкола
  const N = 40;
  let last = null;
  for (let i = 1; i <= N; i++) {
    const f = (Math.PI * i) / N, c = Math.cos(f), si = Math.sin(f);
    const hx = p0.hx * c + lx * si, hz = p0.hz * c + lz * si;       // напрямок
    const llx = lx * c - p0.hx * si, llz = lz * c - p0.hz * si;     // «ліворуч» після повороту
    last = { x: cx - llx * R, z: cz - llz * R, hx, hz };
    path.push([last.x, last.z]);
  }
  const ch = dist([last.x, last.z], [p3.x, p3.z]);
  const tail = bezier(last, p3, ch * 0.4, ch * 0.4, 30);
  for (const p of tail.slice(1)) path.push(p);
  return mkConn({ id: o.id, junction: o.junction, turn: 'uturn', rank: 1, ...(o.noCtrl ? {} : { ctrl: o.junction, group: 'A' }), lock: o.junction, playerOnly: true,
    from: { edge: e0.id, lane: 0, s: r2(o.sFrom) }, to: { edge: e1.id, lane: 0, s: r2(o.sTo) }, path });
}
{
  const a = chainEdgeS('mrii_s', 313276316, -2);
  const b = chainEdgeS('mrii_n', 313276316, 12);
  mriiUturn({ id: 'J_MT:uturn', junction: 'J_MT', fromEdge: a.edge, sFrom: a.s, toEdge: b.edge, sTo: b.s, L0: 4 });
  const sa = lastEdge('mrii_s'), sb = firstEdge('mrii_n');
  mriiUturn({ id: 'J_SAL:uturn', junction: 'J_SAL', fromEdge: sa, sFrom: edgeLen(sa) - 7, toEdge: sb, sTo: 7, L0: 8, R: 3.0 });
}
// Маршрути №4 і №5: Щербаківського ↔ Салютна ↔ Мрії.
{
  const a = chainEdgeS('sh_s', 26331308, -8);
  const sw0 = chainEdgeS('sal_w', 26331308, 14), sw = sw0.edge;
  laneConn({ id: 'J_SH:right', junction: 'J_SH', turn: 'right', rank: 2, ctrl: 'J_SH', group: 'A', lock: 'J_SH', fromEdge: a.edge.id, fromLane: a.edge.lanes - 1, sFrom: a.s, toEdge: sw.id, toLane: 0, sTo: sw0.s, k0: 0.45 });
  const swEnd = lastEdge('sal_w'), mn0 = firstEdge('mrii_n');
  laneConn({ id: 'J_SAL:right', junction: 'J_SAL', turn: 'right', rank: 2, ctrl: 'J_SAL', group: 'B', lock: 'J_SAL', fromEdge: swEnd.id, fromLane: 0, sFrom: edgeLen(swEnd), toEdge: mn0.id, toLane: mn0.lanes - 1, sTo: 13, k0: 0.5 });
  const ru = lastEdge('sh_s'), rn = firstEdge('sh_n');
  mriiUturn({ id: 'J_RUZ:uturn', junction: 'J_RUZ', fromEdge: ru, sFrom: edgeLen(ru), toEdge: rn, sTo: 0, L0: 8, R: 3.0 });
  // З Щербаківського (на північ) ліворуч на Стеценку (на ПЗ).
  const nl = chainEdgeS('vyh_n', 26304095, -2), nb = chainEdgeS('stet_nw', 26331468, 8);
  laneConn({ id: 'J_VYH:n_left', junction: 'J_VYH', turn: 'left', rank: 1, ctrl: 'J_VYH', group: 'B', lock: 'J_VYH', fromEdge: nl.edge.id, fromLane: 0, sFrom: nl.s, toEdge: nb.edge.id, toLane: 0, sTo: nb.s, k0: 0.42 });
}
// Маршрут №14: Стеценка (на ПдС) → ліворуч на Виговського (на північ) → розворот біля вул. Некрасова → на південь → праворуч на Стеценку (на ПЗ).
{
  const l0 = chainEdgeS('stet_se', 26304095, -8), l1 = chainEdgeS('vyh_n', 26331468, 14);
  laneConn({ id: 'J_VYH:se_left', junction: 'J_VYH', turn: 'left', rank: 1, ctrl: 'J_VYH', group: 'A', lock: 'J_VYH', fromEdge: l0.edge.id, fromLane: 0, sFrom: l0.s, toEdge: l1.edge.id, toLane: 0, sTo: l1.s, k0: 0.42 });
  const r0 = chainEdgeS('vyh_s', 26331468, -14), r1 = chainEdgeS('stet_nw', 26331468, 16);
  laneConn({ id: 'J_VYH:s_right', junction: 'J_VYH', turn: 'right', rank: 2, ctrl: 'J_VYH', group: 'B', lock: 'J_VYH', fromEdge: r0.edge.id, fromLane: r0.edge.lanes - 1, sFrom: r0.s, toEdge: r1.edge.id, toLane: r1.edge.lanes - 1, sTo: r1.s, k0: 0.55 });
  const nu = lastEdge('vh_n'), su = firstEdge('vh_s');
  mriiUturn({ id: 'J_NEK:uturn', junction: 'J_NEK', fromEdge: nu, sFrom: edgeLen(nu), toEdge: su, sTo: 10, L0: 8, R: 3.2 }); // посадка за пішохідним переходом
}
// Маршрут №10: Мрія (на південь) → ліворуч на Салютну → праворуч на Щербаківського → ліворуч на Ружинську → ліворуч на Вірського → ліворуч на Салютну (на захід) → праворуч на Мрію.
{
  const ms = lastEdge('mrii_s'), se0 = firstEdge('sal_e');
  laneConn({ id: 'J_SAL:left', junction: 'J_SAL', turn: 'left', rank: 1, ctrl: 'J_SAL', group: 'A', lock: 'J_SAL', fromEdge: ms.id, fromLane: 0, sFrom: edgeLen(ms) - 7, toEdge: se0.id, toLane: 0, sTo: 2, k0: 0.45 });
  const seEnd = lastEdge('sal_e'), sh0 = chainEdgeS('sh_s', 26331308, 18);
  laneConn({ id: 'J_SH:e_right', junction: 'J_SH', turn: 'right', rank: 2, ctrl: 'J_SH', group: 'B', lock: 'J_SH', fromEdge: seEnd.id, fromLane: 0, sFrom: edgeLen(seEnd), toEdge: sh0.edge.id, toLane: sh0.edge.lanes - 1, sTo: sh0.s, k0: 0.5 });
  const shEnd = lastEdge('sh_s'), re0 = firstEdge('ruz_e');
  laneConn({ id: 'J_RUZ:left', junction: 'J_RUZ', turn: 'left', rank: 1, ctrl: 'J_RUZ', group: 'A', lock: 'J_RUZ', fromEdge: shEnd.id, fromLane: 0, sFrom: edgeLen(shEnd), toEdge: re0.id, toLane: 0, sTo: 2, k0: 0.45 });
  const reEnd = lastEdge('ruz_e'), vn0e = chainEdgeS('vir_n', 248885007, 14), vn0 = vn0e.edge;
  laneConn({ id: 'J_VR:left', junction: 'J_VR', turn: 'left', rank: 1, ctrl: 'J_VR', group: 'B', lock: 'J_VR', fromEdge: reEnd.id, fromLane: 0, sFrom: edgeLen(reEnd), toEdge: vn0.id, toLane: 0, sTo: vn0e.s, k0: 0.45 });
  const vnEndE = chainEdgeS('vir_n', 248885006, -2), vnEnd = vnEndE.edge, sw1 = firstEdge('sal_w');
  laneConn({ id: 'J_VS:left', junction: 'J_VS', turn: 'left', rank: 1, ctrl: 'J_VS', group: 'A', lock: 'J_VS', fromEdge: vnEnd.id, fromLane: 0, sFrom: vnEndE.s, toEdge: sw1.id, toLane: 0, sTo: 14, k0: 0.45 }); // посадка за смугами зустрічного напряму (vir_s)
}
// Маршрут №9: Стеценка до бульвару Вірського (на південь) → вул. Корчака → мінікруг (ліворуч на Ґолди Меїр) → праворуч на Вірського (на північ) → ліворуч на Стеценку.
{
  const sr0 = lastEdge('stet_se'), vs0 = firstEdge('vir_s');
  laneConn({ id: 'J_VIR:se_right', junction: 'J_VIR', turn: 'right', rank: 2, ctrl: 'J_VIR', group: 'A', lock: 'J_VIR', fromEdge: sr0.id, fromLane: sr0.lanes - 1, sFrom: edgeLen(sr0), toEdge: vs0.id, toLane: vs0.lanes - 1, sTo: 10, k0: 0.5 }); // посадка за переходом біля перехрестя
  const vnE = lastEdge('vir_n'), sn0 = firstEdge('stet_nw');
  laneConn({ id: 'J_VIR:n_left', junction: 'J_VIR', turn: 'left', rank: 1, ctrl: 'J_VIR', group: 'B', lock: 'J_VIR', fromEdge: vnE.id, fromLane: 0, sFrom: edgeLen(vnE), toEdge: sn0.id, toLane: 0, sTo: 3, k0: 0.45 });
  const ke = lastEdge('kor_ne'), gm0 = firstEdge('gm_w');
  laneConn({ id: 'J_KOR:left', junction: 'J_KOR', turn: 'left', rank: 0, lock: 'J_KOR', fromEdge: ke.id, fromLane: 0, sFrom: edgeLen(ke), toEdge: gm0.id, toLane: 0, sTo: 2, k0: 0.45 });
  junctions.push({ id: 'J_KOR', name: 'Мінікруг вул. Корчака / вул. Ґолди Меїр', kind: 'uturn', x: 0, z: 0, poly: [] });
  const ge = lastEdge('gm_w'), vn1 = chainEdgeS('vir_n', 248885008, 12);
  laneConn({ id: 'J_GM:right', junction: 'J_GM', turn: 'right', rank: 0, lock: 'J_GM', fromEdge: ge.id, fromLane: 0, sFrom: edgeLen(ge), toEdge: vn1.edge.id, toLane: vn1.edge.lanes - 1, sTo: vn1.s, k0: 0.5 });
  junctions.push({ id: 'J_GM', name: 'вул. Ґолди Меїр / бульвар Павла Вірського', kind: 'giveway', x: 0, z: 0, poly: [] });
  ge.features.push({ id: 'J_GM:giveway', kind: 'giveWay', s: r2(edgeLen(ge) - 3.6), stop: r2(edgeLen(ge) - 3.6), zone: [r2(edgeLen(ge) - 3.1), r2(edgeLen(ge))] });
}
// Маршрути №12 і №13: заїзд на північний захід по Стеценці до розвороту біля дальнього кінця (за автодромом) і назад на кільце.
{
  const nu = lastEdge('n_out'), wu = firstEdge('w_in');
  mriiUturn({ id: 'J_NW:uturn', junction: 'J_NW', fromEdge: nu, sFrom: edgeLen(nu), toEdge: wu, sTo: 0, L0: 6, R: 3.4, noCtrl: true });
  junctions.push({ id: 'J_NW', name: 'Розворот на вул. Стеценка (за автодромом)', kind: 'uturn', x: 0, z: 0, poly: [] });
}
// Маршрут №15: Мрія на південь до Берестейського проспекту → праворуч (на захід) до розвороту біля Святошина → на схід до розвороту біля вул. Нивської → на захід → праворуч на Мрію.
{
  const s2 = lastEdge('ms2_s');
  const bw = chainEdgeS('ber_w', 256221809, 18);
  laneConn({ id: 'J_BER:s_right', junction: 'J_BER', turn: 'right', rank: 0, lock: 'J_BER', fromEdge: s2.id, fromLane: 0, sFrom: edgeLen(s2), toEdge: bw.edge.id, toLane: bw.edge.lanes - 1, sTo: bw.s, k0: 0.5 });
  junctions.push({ id: 'J_BER', name: 'вул. Мрії / Берестейський проспект', kind: 'giveway', x: 0, z: 0, poly: [] });
  s2.features.push({ id: 'J_BER:giveway', kind: 'giveWay', s: r2(edgeLen(s2) - 3.6), stop: r2(edgeLen(s2) - 3.6), zone: [r2(edgeLen(s2) - 3.1), r2(edgeLen(s2))] });
  const wr = chainEdgeS('ber_w', 256221809, -18), n2 = firstEdge('ms2_n');
  laneConn({ id: 'J_BER:w_right', junction: 'J_BER', turn: 'right', rank: 2, lock: 'J_BER', fromEdge: wr.edge.id, fromLane: wr.edge.lanes - 1, sFrom: wr.s, toEdge: n2.id, toLane: n2.lanes - 1, sTo: 8, k0: 0.5 }); // посадка за зеброю на Мрії
  const we = lastEdge('ber_w'), eb0 = firstEdge('ber_e');
  mriiUturn({ id: 'J_BERW:uturn', junction: 'J_BERW', fromEdge: we, sFrom: edgeLen(we), toEdge: eb0, sTo: 45, L0: 30, R: 3.4, noCtrl: true });
  junctions.push({ id: 'J_BERW', name: 'Розворот на Берестейському проспекті (Святошин)', kind: 'uturn', x: 0, z: 0, poly: [] });
  const ee = lastEdge('ber_e'), wb0 = firstEdge('ber_w');
  mriiUturn({ id: 'J_BERE:uturn', junction: 'J_BERE', fromEdge: ee, sFrom: edgeLen(ee), toEdge: wb0, sTo: 12, L0: 14, R: 3.4, noCtrl: true });
  junctions.push({ id: 'J_BERE', name: 'Розворот на Берестейському проспекті (вул. Нивська)', kind: 'uturn', x: 0, z: 0, poly: [] });
}
// Продовження ланцюжків при зміні кількості смуг — без зʼєднувачів (ребра стикуються, смуга i → смуга i).

// ---------- Кільце ----------
const RING_ARMS = [
  { id: 'W', name: 'вул. Стеценка (автодром)', chain: 'w_in', kind: 'entry', node: 354998515 },
  { id: 'MRII_OUT', name: 'вул. Мрії', chain: 'mrii_s', kind: 'exit', node: 354998555 },
  { id: 'MRII_IN', name: 'вул. Мрії', chain: 'mrii_n', kind: 'entry', node: 354998565 },
  { id: 'SE', name: 'вул. Стеценка (на пл. Марченка)', chain: 'stet_se', kind: 'exit', node: 354998568 },
  { id: 'NE', name: 'вул. Стеценка (від пл. Марченка)', chain: 'stet_nw', kind: 'entry', node: 354998575 },
  { id: 'N', name: 'вул. Стеценка (до автодрому)', chain: 'n_out', kind: 'exit', node: 354998578 },
];
const ringLaneR = (l) => RING.r + (l - 0.5) * W; // 0 — внутрішня, 1 — зовнішня
const ringPose = (r, th) => ({ x: RING.cx + r * Math.cos(th), z: RING.cz - r * Math.sin(th), hx: -Math.sin(th), hz: -Math.cos(th) });
const rings = [{ id: 'R', name: 'Кільце (вул. Стеценка / вул. Мрії)', cx: RING.cx, cz: RING.cz, r: r2(RING.r), laneWidth: W, lanes: 2, arms: [] }];
const TAU = Math.PI * 2;
const modT = (a) => ((a % TAU) + TAU) % TAU;
for (const arm of RING_ARMS) {
  const thNode = modT(ringTheta(P(arm.node)));
  const e = arm.kind === 'entry' ? lastEdge(arm.chain) : firstEdge(arm.chain);
  const th = [0, 0];
  for (const lane of [0, 1]) {
    const el = Math.min(lane, e.lanes - 1);
    const pe = arm.kind === 'entry' ? lanePose(e, el, edgeLen(e)) : lanePose(e, el, 0);
    // Кут злиття/відходу: найближчий до вузла OSM, за якого радіус Безьє ≥ RING_MIN_R (інакше — найплавніший).
    let best = null, smooth = null;
    for (let dd = -10; dd <= 45; dd += 0.5) {
      const t = modT(thNode + ((arm.kind === 'entry' ? dd : -dd) * Math.PI) / 180);
      const pr = ringPose(ringLaneR(lane), t);
      const ch = dist([pe.x, pe.z], [pr.x, pr.z]);
      const path = arm.kind === 'entry' ? bezier(pe, pr, ch * 0.45, ch * 0.45, 20) : bezier(pr, pe, ch * 0.45, ch * 0.45, 20);
      const k = maxCurvature(path);
      if (!smooth || k < smooth.k) smooth = { k, t, path, dd };
      if (!best && k < 1 / RING_MIN_R) best = { k, t, path, dd };
    }
    if (!best) best = smooth;
    console.log('  ', arm.id, 'lane', lane, 'dd', best.dd, 'R', (1 / best.k).toFixed(1));
    th[lane] = best.t;
    const ring = { ring: 'R', lane, theta: r2(best.t * 1000) / 1000 };
    if (arm.kind === 'entry') mkConn({ id: `R:${arm.id}:in${lane}`, junction: 'R', turn: 'entry', rank: 0, from: { edge: e.id, lane: el, s: r2(edgeLen(e)) }, to: ring, path: best.path });
    else mkConn({ id: `R:${arm.id}:out${lane}`, junction: 'R', turn: 'exit', rank: 3, from: ring, to: { edge: e.id, lane: el, s: 0 }, path: best.path });
  }
  rings[0].arms.push({ id: arm.id, name: arm.name, kind: arm.kind, edge: e.id, theta: [r2(th[0] * 1000) / 1000, r2(th[1] * 1000) / 1000], node: r2(thNode * 1000) / 1000 });
  e.features.push(arm.kind === 'entry'
    ? { id: `R:${arm.id}:yield`, kind: 'yield', ring: 'R', s: r2(edgeLen(e) - 0.3), stop: r2(edgeLen(e) - 0.3), zone: [r2(edgeLen(e)), r2(edgeLen(e))] }
    : { id: `R:${arm.id}:exit`, kind: 'ringExit', ring: 'R', s: 0, stop: 0, zone: [0, 0] });
}
rings[0].arms.sort((a, b) => a.node - b.node);
for (const a of rings[0].arms) console.log('arm', a.id, a.kind, 'θ', (a.node * 180 / Math.PI).toFixed(1), 'lanes θ', a.theta.map((t) => (t * 180 / Math.PI).toFixed(1)).join('/'));

// ---------- Бічні вулиці й виїзди (лише правий поворот) ----------
const SIDE_HW = new Set(['residential', 'unclassified', 'living_street', 'service', 'tertiary']);
const stubs = [];
{
  const taken = new Map(); // edge id → [s]
  const jCentres = JUNCTIONS.map((j) => P(j.node));
  for (const ch of chains.values()) {
    if (ch.spec.kind === 'arm' || ch.spec.kind === 'cross') continue;
    const [i0, i1] = trimRange(ch);
    for (const id of ch.ids) {
      if (JNODES.has(id)) continue;
      const others = (nodeWays.get(id) ?? []).filter((w) => !chainOf.has(w));
      for (const wid of others) {
        const w = ways.get(wid);
        if (!SIDE_HW.has(w.tags.highway) || w.tags.service === 'parking_aisle' || w.tags.access === 'no' || w.tags.area === 'yes') continue;
        const pN = P(id);
        if (jCentres.some((c) => dist(c, pN) < 30) || dist(pN, [0, 0]) < 70) continue;
        const sC = chainS(ch, id);
        if (sC < ch.cum[i0] + 25 || sC > ch.cum[i1] - 25) continue;
        // Напрям гілки від вузла (обидва боки, якщо вулиця перетинає дорогу).
        const k = w.nds.indexOf(id);
        for (const dirSign of [1, -1]) {
          const seq = [];
          for (let q = k; q >= 0 && q < w.nds.length; q += dirSign) seq.push(w.nds[q]);
          if (seq.length < 2) continue;
          const pts = seq.map(P);
          let L = 0; const cut = [pts[0]];
          for (let q = 1; q < pts.length && L < 45; q++) { L += dist(pts[q - 1], pts[q]); cut.push(pts[q]); }
          if (L < 18) continue;
          const pc = poseAt(ch.centre, ch.cum, sC);
          const away = [cut[Math.min(2, cut.length - 1)][0] - pN[0], cut[Math.min(2, cut.length - 1)][1] - pN[1]];
          const side = away[0] * -pc.hz + away[1] * pc.hx; // > 0 праворуч від руху
          if (side <= 0) continue;
          const { edge, s } = onChain(ch.spec.id, sC);
          // Не біля переходів/стоп-ліній/зміни ребра.
          if (s < 22 || s > edgeLen(edge) - 22) continue;
          if (edge.features.some((f) => s > f.stop - 18 && s < f.zone[1] + 14)) continue;
          const tk = taken.get(edge.id) ?? [];
          if (tk.some((q) => Math.abs(q - s) < 28)) continue;
          tk.push(s); taken.set(edge.id, tk);
          stubs.push({ id: `st${stubs.length + 1}`, way: wid, node: id, name: w.tags.name ?? '', highway: w.tags.highway, edge: edge.id, s, cut, chain: ch.spec.id });
        }
      }
    }
  }
}
// Геометрія виїзду: від краю проїзної частини назовні, дві смуги по 3 м (in — у двір, out — з двору).
for (const st of stubs) {
  const e = edgeById.get(st.edge);
  const kerb = lanePose(e, e.lanes - 1, st.s); // центр правої смуги
  const kp = [kerb.x - kerb.hz * (W / 2), kerb.z + kerb.hx * (W / 2)]; // бордюр
  // Вісь виїзду: від бордюру вздовж OSM-гілки, гладко.
  const cut = st.cut;
  const away = cut[cut.length - 1];
  let axis = resample([kp, ...cut.filter((p) => dist(p, kp) > 4 && dist(p, cut[0]) > 3)], 1);
  if (axis.length < 3) axis = resample([kp, away], 1);
  axis = smoothPts(axis, 3);
  const len = cumLen(axis);
  const L = len[len.length - 1];
  if (L < 14) { st.skip = true; continue; }
  // ref кожної смуги: «in» (у двір) — ліва межа = вісь; «out» — розвернута вісь.
  const inRef = simplify(axis, 0.05);
  const outRef = simplify(axis.slice().reverse(), 0.05);
  const name = st.name || (st.highway === 'service' ? 'виїзд' : 'бічна вулиця');
  const kind = st.highway === 'service' ? 'driveway' : 'side';
  const eIn = { id: `${st.id}_in`, name, chain: null, kind, lanes: 1, laneWidth: SIDE_W, speedKmh: 20, median: 0, centreLine: 'none', centreOwner: false, ref: inRef, s0: 0, prev: [], next: [], features: [], osm: [st.way], _refCum: cumLen(inRef) };
  const eOut = { id: `${st.id}_out`, name, chain: null, kind, lanes: 1, laneWidth: SIDE_W, speedKmh: 20, median: 0, centreLine: 'none', centreOwner: false, ref: outRef, s0: 0, prev: [], next: [], features: [], osm: [st.way], _refCum: cumLen(outRef) };
  edges.push(eIn, eOut); edgeById.set(eIn.id, eIn); edgeById.set(eOut.id, eOut);
  const sig = JUNCTIONS.find((j) => j.stubs && j.stubs[st.way]);
  // Відкинути виїзди під гострим кутом (Безьє з петлею): кут осі до дороги має бути 50–130°.
  {
    const a0 = axis[0], a1 = axis[Math.min(8, axis.length - 1)];
    const ax = (a1[0] - a0[0]) / dist(a0, a1), az = (a1[1] - a0[1]) / dist(a0, a1);
    const cosA = ax * kerb.hx + az * kerb.hz;
    if (Math.abs(cosA) > Math.cos((50 * Math.PI) / 180)) { console.log("  skip stub angle", st.id, st.name, (Math.acos(cosA) * 180 / Math.PI).toFixed(0)); st.skip = true; edges.splice(edges.indexOf(eIn), 2); edgeById.delete(eIn.id); edgeById.delete(eOut.id); continue; }
  }
  const rIn = laneConn({ junction: sig?.id ?? null, turn: 'right', rank: 2, lock: st.id, ...(sig ? { ctrl: sig.id, group: 'A' } : {}), fromEdge: e.id, fromLane: e.lanes - 1, sFrom: Math.max(0, st.s - 8.5), toEdge: eIn.id, toLane: 0, sTo: 4.5, k0: 0.5, n: 16 });
  const rOut = laneConn({ junction: sig?.id ?? null, turn: 'right', rank: 0, lock: st.id, ...(sig ? { ctrl: sig.id, group: sig.stubs[st.way] } : {}), fromEdge: eOut.id, fromLane: 0, sFrom: edgeLen(eOut) - 4.5, toEdge: e.id, toLane: e.lanes - 1, sTo: st.s + 9, k0: 0.5, n: 16 });
  if (sig) eOut.features.push({ id: `${sig.id}:${st.id}`, kind: 'signal', junction: sig.id, ctrl: sig.id, group: sig.stubs[st.way], s: r2(edgeLen(eOut) - 3.6), stop: r2(edgeLen(eOut) - 3.6), zone: [r2(edgeLen(eOut) - 3.1), r2(edgeLen(eOut))] });
  else eOut.features.push({ id: `${st.id}:giveway`, kind: 'giveWay', s: r2(edgeLen(eOut) - 3.6), stop: r2(edgeLen(eOut) - 3.6), zone: [r2(edgeLen(eOut) - 3.1), r2(edgeLen(eOut))] });
  if (rIn.minRadius < 3 || rOut.minRadius < 3) {
    console.log("  skip stub radius", st.id, st.name, rIn.minRadius, rOut.minRadius);
    st.skip = true;
    connectors.splice(connectors.indexOf(rIn), 1); connectors.splice(connectors.indexOf(rOut), 1);
    edges.splice(edges.indexOf(eIn), 2); edgeById.delete(eIn.id); edgeById.delete(eOut.id);
    e.features = e.features.filter((f) => true);
    continue;
  }
  st.in = eIn.id; st.out = eOut.id; st.conns = [rIn.id, rOut.id];
  st.kerb = kp;
}
const stubsOut = stubs.filter((s) => !s.skip);
console.log('stubs', stubsOut.length);

// ---------- Знаки, стоп-лінії, голови світлофорів, зупинки ----------
const signs = [], stopLines = [], signals = [];
for (const e of edges) {
  for (const f of e.features) {
    if (!['signal', 'crossing', 'yield', 'giveWay'].includes(f.kind)) continue;
    const s = f.stop;
    const l = refPose(e, s), r = lanePose(e, e.lanes - 1, s);
    const rx = r.x - r.hz * (e.laneWidth / 2), rz = r.z + r.hx * (e.laneWidth / 2);
    stopLines.push({ id: f.id, edge: e.id, s, kind: f.kind, a: [r2(l.x), r2(l.z)], b: [r2(rx), r2(rz)], ...(f.ctrl ? { ctrl: f.ctrl, group: f.group } : {}) });
    const a = Math.atan2(l.hx, -l.hz);
    if (f.kind === 'signal') {
      signals.push({ id: `${f.id}:R`, kind: 'vehicle', ctrl: f.ctrl, group: f.group, edge: e.id, s, x: r2(rx - l.hz * 0.8), z: r2(rz + l.hx * 0.8), a: r2(a * 1000) / 1000 });
      if (e.lanes >= 2) signals.push({ id: `${f.id}:L`, kind: 'vehicle', ctrl: f.ctrl, group: f.group, edge: e.id, s, x: r2(l.x + l.hz * 0.6), z: r2(l.z - l.hx * 0.6), a: r2(a * 1000) / 1000 });
    }
    if (f.kind === 'yield' || f.kind === 'giveWay') signs.push({ kind: 'giveWay', edge: e.id, s, x: r2(rx - l.hz * 1.2), z: r2(rz + l.hx * 1.2), a: r2(a * 1000) / 1000 });
    if (f.kind === 'yield') signs.push({ kind: 'roundabout', edge: e.id, s: r2(s - 8), x: r2(rx - l.hz * 1.2 - l.hx * 8), z: r2(rz + l.hx * 1.2 - l.hz * 8), a: r2(a * 1000) / 1000 });
  }
}
for (const c of crossings) {
  const a = c.a, b = c.b;
  const ang = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
  if (c.kind === 'signal') {
    signals.push({ id: `${c.id}:pedA`, kind: 'ped', crossing: c.id, ctrl: c.ctrl, pedGroup: c.pedGroup, x: a[0], z: a[1], a: r2(ang * 1000) / 1000 });
    signals.push({ id: `${c.id}:pedB`, kind: 'ped', crossing: c.id, ctrl: c.ctrl, pedGroup: c.pedGroup, x: b[0], z: b[1], a: r2((ang + Math.PI) * 1000) / 1000 });
  } else {
    for (const sp of c.spans) {
      const e = edgeById.get(sp.edge);
      const r = lanePose(e, e.lanes - 1, sp.s - 2.5);
      signs.push({ kind: 'pedCrossing', edge: e.id, s: r2(sp.s - 2.5), x: r2(r.x - r.hz * (W / 2 + 1)), z: r2(r.z + r.hx * (W / 2 + 1)), a: r2(Math.atan2(r.hx, -r.hz) * 1000) / 1000 });
    }
  }
}
const busStops = [];
for (const n of nodes.values()) {
  if (n.tags.highway !== 'bus_stop' && n.tags.public_transport !== 'platform') continue;
  const p = proj.fwd(n.lat, n.lon);
  let best = null;
  for (const e of edges) {
    if (e.kind !== 'street' && e.kind !== 'arm') continue;
    const q = project(e.ref, e._refCum, p);
    const w = e.lanes * e.laneWidth;
    if (q.s < 15 || q.s > edgeLen(e) - 10 || q.d < w - 3 || q.d > w + 12) continue;
    if (!best || Math.abs(q.d - w) < Math.abs(best.q.d - w)) best = { e, q };
  }
  if (!best || busStops.some((b) => b.edge === best.e.id && Math.abs(b.s - best.q.s) < 40)) continue;
  const lp = lanePose(best.e, best.e.lanes - 1, best.q.s);
  busStops.push({ id: 'bs' + n.id, name: n.tags.name ?? '', edge: best.e.id, s: r2(best.q.s), x: r2(lp.x - lp.hz * (W / 2 + 1.6)), z: r2(lp.z + lp.hx * (W / 2 + 1.6)), a: r2(Math.atan2(lp.hx, -lp.hz) * 1000) / 1000 });
}

// ---------- Площі перехресть (опукла оболонка зʼєднувачів) ----------
for (const j of junctions) {
  const pts = [];
  for (const c of connectors) if (c.junction === j.id) for (const p of c.path) pts.push(p);
  if (j.kind === 'signal') for (const e of edges) for (const f of e.features) if (f.junction === j.id && f.kind === 'signal') {
    for (const s of [f.stop, f.zone[1]]) { const l = refPose(e, s), r = lanePose(e, e.lanes - 1, s); pts.push([l.x, l.z], [r.x - r.hz * W / 2, r.z + r.hx * W / 2]); }
  }
  j.poly = convexHull(pts).map((p) => [r2(p[0]), r2(p[1])]);
}

// ---------- Маршрути гравця (спільна мережа, різні кроки) ----------
const conn = (id) => connectors.find((c) => c.id === id);
const chainEdges = (cid) => edgeOfChain.get(cid).map((q) => q.edge.id);
const armTh = (id, lane) => rings[0].arms.find((a) => a.id === id).theta[lane];
const ringArcPts = (out, thFrom, thTo, lane) => { let t1 = thTo; while (t1 <= thFrom) t1 += TAU; for (let t = thFrom; t <= t1; t += 0.05) { const p = ringPose(ringLaneR(lane), t); out.push([r2(p.x), r2(p.z)]); } };
// plan: [{k:'edges', ids:[...]}, {k:'ring', entry, exit, exitNo, text}, {k:'turn', conn, manoeuvre, text}, {k:'finish', edge, s}]
function buildRoute(plan, startS) {
  const steps = [], pts = [], checkpoints = [];
  const cpIds = new Set();
  const cp = (id, label, p) => { let k = id, n = 1; while (cpIds.has(k)) k = id + (++n); cpIds.add(k); checkpoints.push({ id: k, label, x: r2(p[0]), z: r2(p[1]) }); };
  const pushLane = (e, lane, s0, s1) => { for (let s = s0; s <= s1; s += 4) { const p = lanePose(e, lane, s); pts.push([r2(p.x), r2(p.z)]); } };
  let ringN = 0;
  plan.forEach((it, i) => {
    if (it.k === 'edges') {
      const prev = plan[i - 1], next = plan[i + 1];
      it.ids.forEach((id, j) => {
        steps.push({ kind: 'edge', edge: id });
        const e = edgeById.get(id);
        let s0 = i === 0 && j === 0 ? startS : 0, s1 = edgeLen(e), lane = e.lanes - 1;
        if (prev?.k === 'turn' && j === 0) { const c = conn(prev.conn); if (c.to.edge === id) s0 = c.to.s; }
        if (next?.k === 'turn' && j === it.ids.length - 1) { const c = conn(next.conn); if (c.from.edge === id) { s1 = c.from.s; if (c.turn !== 'right') lane = 0; } }
        if (next?.k === 'finish' && j === it.ids.length - 1) s1 = next.s;
        if (i === 0 && j === 0) cp('start', 'Початок', (() => { const p = lanePose(e, lane, s0); return [p.x, p.z]; })());
        pushLane(e, lane, s0, s1);
      });
    } else if (it.k === 'ring') {
      steps.push({ kind: 'ring', ring: 'R', entry: it.entry, exit: it.exit, exitNo: it.exitNo, text: it.text });
      ringArcPts(pts, armTh(it.entry, 1), armTh(it.exit, 1), 1);
      cp('ring' + (++ringN), it.text, pts[pts.length - 1]);
    } else if (it.k === 'turn') {
      steps.push({ kind: 'turn', conn: it.conn, manoeuvre: it.manoeuvre, text: it.text });
      const c = conn(it.conn);
      for (const p of c.path) pts.push(p);
      cp(it.manoeuvre, it.text, c.path[Math.floor(c.path.length / 2)]);
    } else if (it.k === 'finish') {
      steps.push({ kind: 'finish', edge: it.edge, s: it.s });
      cp('finish', 'Кінець', pts[pts.length - 1]);
    }
  });
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  const first = steps[0];
  const e0 = edgeById.get(first.edge);
  return { start: { edge: e0.id, s: r2(startS), lane: e0.lanes - 1 }, steps, checkpoints, polyline: simplify(pts, 0.2), length: Math.round(len), _pts: pts };
}
const wInE = lastEdge('w_in'), nOutE = firstEdge('n_out');
const wInStart = r2(edgeLen(wInE) - 30);
const seIds = chainEdges('stet_se'), nwIds = chainEdges('stet_nw'), mnIds = chainEdges('mrii_n'), msIds = chainEdges('mrii_s');
const upTo = (ids, last) => ids.slice(0, ids.indexOf(last) + 1);
const from = (ids, first) => ids.slice(ids.indexOf(first));
const ut = conn('J_UT:uturn'), lt = conn('J_TUR:left'), rt = conn('J_MT:right');
const mtU = conn('J_MT:uturn'), salU = conn('J_SAL:uturn');
// Спільний хвіст: Стеценка → розворот на пл. Марченка → лівий на Турчина → правий на Мрію → кільце → фініш.
const tail = [
  { k: 'edges', ids: upTo(seIds, ut.from.edge) },
  { k: 'turn', conn: ut.id, manoeuvre: 'uturn', text: 'Розворот біля пл. Валерія Марченка' },
  { k: 'edges', ids: upTo(from(nwIds, ut.to.edge), lt.from.edge) },
  { k: 'turn', conn: lt.id, manoeuvre: 'left', text: 'Ліворуч на вул. Ігоря Турчина' },
  { k: 'edges', ids: [firstEdge('tur_w').id] },
  { k: 'turn', conn: rt.id, manoeuvre: 'right', text: 'Праворуч на вул. Мрії' },
  { k: 'edges', ids: from(mnIds, rt.to.edge) },
  { k: 'ring', entry: 'MRII_IN', exit: 'N', exitNo: 2, text: 'Кільце: другий зʼїзд — до автодрому (фініш)' },
  { k: 'edges', ids: [nOutE.id] },
  { k: 'finish', edge: nOutE.id, s: 40 },
];
const ROUTE_PLANS = {
  route1: [
    { k: 'edges', ids: [wInE.id] },
    { k: 'ring', entry: 'W', exit: 'SE', exitNo: 2, text: 'Кільце: другий зʼїзд — на вул. Стеценка' },
    ...tail,
  ],
  // №6: кільце → Мрії на південь до Турчина → розворот → на північ до кільця → далі як №1.
  route6: [
    { k: 'edges', ids: [wInE.id] },
    { k: 'ring', entry: 'W', exit: 'MRII_OUT', exitNo: 1, text: 'Кільце: перший зʼїзд — на вул. Мрії' },
    { k: 'edges', ids: upTo(msIds, mtU.from.edge) },
    { k: 'turn', conn: mtU.id, manoeuvre: 'uturn', text: 'Розворот на вул. Мрії біля вул. Ігоря Турчина' },
    { k: 'edges', ids: from(mnIds, mtU.to.edge) },
    { k: 'ring', entry: 'MRII_IN', exit: 'SE', exitNo: 1, text: 'Кільце: перший зʼїзд — на вул. Стеценка' },
    ...tail,
  ],
  // №3: кільце → Мрії на південь до Салютної → розворот → на північ до кільця → далі як №1.
  route3: [
    { k: 'edges', ids: [wInE.id] },
    { k: 'ring', entry: 'W', exit: 'MRII_OUT', exitNo: 1, text: 'Кільце: перший зʼїзд — на вул. Мрії' },
    { k: 'edges', ids: msIds },
    { k: 'turn', conn: salU.id, manoeuvre: 'uturn', text: 'Розворот на вул. Мрії біля вул. Салютна' },
    { k: 'edges', ids: mnIds },
    { k: 'ring', entry: 'MRII_IN', exit: 'SE', exitNo: 1, text: 'Кільце: перший зʼїзд — на вул. Стеценка' },
    ...tail,
  ],
};
// №4: Стеценка → правий на Щербаківського → правий на Салютну → правий на Мрію (на північ) → кільце → фініш.
const seRight = conn('J_VYH:se_right'), shRight = conn('J_SH:right'), salRight = conn('J_SAL:right'), ruU = conn('J_RUZ:uturn'), nLeft = conn('J_VYH:n_left');
const vsIds = [...chainEdges('vyh_s'), ...chainEdges('sh_s')], vnIds = [...chainEdges('sh_n'), ...chainEdges('vyh_n')];
const finishTail = [
  { k: 'ring', entry: 'MRII_IN', exit: 'N', exitNo: 2, text: 'Кільце: другий зʼїзд — до автодрому (фініш)' },
  { k: 'edges', ids: [nOutE.id] },
  { k: 'finish', edge: nOutE.id, s: 40 },
];
const toSE = [
  { k: 'edges', ids: [wInE.id] },
  { k: 'ring', entry: 'W', exit: 'SE', exitNo: 2, text: 'Кільце: другий зʼїзд — на вул. Стеценка' },
  { k: 'edges', ids: upTo(seIds, seRight.from.edge) },
  { k: 'turn', conn: seRight.id, manoeuvre: 'right', text: 'Праворуч на вул. Щербаківського' },
];
ROUTE_PLANS.route4 = [
  ...toSE,
  { k: 'edges', ids: upTo(from(vsIds, seRight.to.edge), shRight.from.edge) },
  { k: 'turn', conn: shRight.id, manoeuvre: 'right', text: 'Праворуч на вул. Салютна' },
  { k: 'edges', ids: from(chainEdges('sal_w'), shRight.to.edge) },
  { k: 'turn', conn: salRight.id, manoeuvre: 'right', text: 'Праворуч на вул. Мрії' },
  { k: 'edges', ids: mnIds },
  ...finishTail,
];
// №5: Стеценка → правий на Щербаківського → на південь до Ружинської → розворот → на північ → лівий на Стеценку → кільце → фініш.
ROUTE_PLANS.route5 = [
  ...toSE,
  { k: 'edges', ids: upTo(from(vsIds, seRight.to.edge), ruU.from.edge) },
  { k: 'turn', conn: ruU.id, manoeuvre: 'uturn', text: 'Розворот на вул. Щербаківського біля вул. Ружинська' },
  { k: 'edges', ids: upTo(from(vnIds, ruU.to.edge), nLeft.from.edge) },
  { k: 'turn', conn: nLeft.id, manoeuvre: 'left', text: 'Ліворуч на вул. Стеценка (до кільця)' },
  { k: 'edges', ids: from(nwIds, nLeft.to.edge) },
  { k: 'ring', entry: 'NE', exit: 'N', exitNo: 1, text: 'Кільце: перший зʼїзд — до автодрому (фініш)' },
  { k: 'edges', ids: [nOutE.id] },
  { k: 'finish', edge: nOutE.id, s: 40 },
];
// №14: Стеценка → ліворуч на Виговського → до вул. Некрасова → розворот → на південь → праворуч на Стеценку (до кільця) → фініш.
{
  const seLeft = conn('J_VYH:se_left'), sRight = conn('J_VYH:s_right'), nekU = conn('J_NEK:uturn');
  const vnAll = [...chainEdges('vyh_n'), ...chainEdges('vh_n')], vsAll = [...chainEdges('vh_s'), ...chainEdges('vyh_s')];
  ROUTE_PLANS.route14 = [
    { k: 'edges', ids: [wInE.id] },
    { k: 'ring', entry: 'W', exit: 'SE', exitNo: 2, text: 'Кільце: другий зʼїзд — на вул. Стеценка' },
    { k: 'edges', ids: upTo(seIds, seLeft.from.edge) },
    { k: 'turn', conn: seLeft.id, manoeuvre: 'left', text: 'Ліворуч на вул. Виговського' },
    { k: 'edges', ids: upTo(from(vnAll, seLeft.to.edge), nekU.from.edge) },
    { k: 'turn', conn: nekU.id, manoeuvre: 'uturn', text: 'Розворот біля вул. Віктора Некрасова' },
    { k: 'edges', ids: upTo(from(vsAll, nekU.to.edge), sRight.from.edge) },
    { k: 'turn', conn: sRight.id, manoeuvre: 'right', text: 'Праворуч на вул. Стеценка (до кільця)' },
    { k: 'edges', ids: from(nwIds, sRight.to.edge) },
    { k: 'ring', entry: 'NE', exit: 'N', exitNo: 1, text: 'Кільце: перший зʼїзд — до автодрому (фініш)' },
    { k: 'edges', ids: [nOutE.id] },
    { k: 'finish', edge: nOutE.id, s: 40 },
  ];
}
// №10: кільце → Мрія на південь → ліворуч на Салютну → праворуч на Щербаківського → ліворуч на Ружинську → ліворуч на бульвар Вірського → ліворуч на Салютну (на захід) → праворуч на Мрію → кільце → фініш.
{
  const salL = conn('J_SAL:left'), shE = conn('J_SH:e_right'), ruzL = conn('J_RUZ:left'), vrL = conn('J_VR:left'), vsL = conn('J_VS:left');
  ROUTE_PLANS.route10 = [
    { k: 'edges', ids: [wInE.id] },
    { k: 'ring', entry: 'W', exit: 'MRII_OUT', exitNo: 1, text: 'Кільце: перший зʼїзд — на вул. Мрії' },
    { k: 'edges', ids: msIds },
    { k: 'turn', conn: salL.id, manoeuvre: 'left', text: 'Ліворуч на вул. Салютна' },
    { k: 'edges', ids: chainEdges('sal_e') },
    { k: 'turn', conn: shE.id, manoeuvre: 'right', text: 'Праворуч на вул. Щербаківського' },
    { k: 'edges', ids: upTo(from(vsIds, shE.to.edge), ruzL.from.edge) },
    { k: 'turn', conn: ruzL.id, manoeuvre: 'left', text: 'Ліворуч на вул. Ружинська' },
    { k: 'edges', ids: chainEdges('ruz_e') },
    { k: 'turn', conn: vrL.id, manoeuvre: 'left', text: 'Ліворуч на бульвар Павла Вірського' },
    { k: 'edges', ids: upTo(from(chainEdges('vir_n'), vrL.to.edge), vsL.from.edge) },
    { k: 'turn', conn: vsL.id, manoeuvre: 'left', text: 'Ліворуч на вул. Салютна' },
    { k: 'edges', ids: chainEdges('sal_w') },
    { k: 'turn', conn: salRight.id, manoeuvre: 'right', text: 'Праворуч на вул. Мрії' },
    { k: 'edges', ids: mnIds },
    ...finishTail,
  ];
}
// №9: кільце → Мрія на південь → ліворуч на Турчина → праворуч на Стеценку → праворуч на бульвар Вірського → Корчака, мінікруг → Ґолди Меїр → праворуч на Вірського → ліворуч на Стеценку → кільце → фініш.
{
  const mtLeft = conn('J_MT:s_left'), tRight = conn('J_TUR:right_out'), vRight = conn('J_VIR:se_right'), kLeft = conn('J_KOR:left'), gRight = conn('J_GM:right'), vLeft = conn('J_VIR:n_left');
  ROUTE_PLANS.route9 = [
    { k: 'edges', ids: [wInE.id] },
    { k: 'ring', entry: 'W', exit: 'MRII_OUT', exitNo: 1, text: 'Кільце: перший зʼїзд — на вул. Мрії' },
    { k: 'edges', ids: upTo(msIds, mtLeft.from.edge) },
    { k: 'turn', conn: mtLeft.id, manoeuvre: 'left', text: 'Ліворуч на вул. Ігоря Турчина' },
    { k: 'edges', ids: chainEdges('tur_e') },
    { k: 'turn', conn: tRight.id, manoeuvre: 'right', text: 'Праворуч на вул. Стеценка' },
    { k: 'edges', ids: from(seIds, tRight.to.edge) },
    { k: 'turn', conn: vRight.id, manoeuvre: 'right', text: 'Праворуч на бульвар Павла Вірського' },
    { k: 'edges', ids: [...from(chainEdges('vir_s'), vRight.to.edge), ...chainEdges('kor_ne')] },
    { k: 'turn', conn: kLeft.id, manoeuvre: 'left', text: 'Мінікруг: ліворуч на вул. Ґолди Меїр' },
    { k: 'edges', ids: chainEdges('gm_w') },
    { k: 'turn', conn: gRight.id, manoeuvre: 'right', text: 'Праворуч на бульвар Павла Вірського' },
    { k: 'edges', ids: from(chainEdges('vir_n'), gRight.to.edge) },
    { k: 'turn', conn: vLeft.id, manoeuvre: 'left', text: 'Ліворуч на вул. Стеценка (до кільця)' },
    { k: 'edges', ids: from(nwIds, vLeft.to.edge) },
    { k: 'ring', entry: 'NE', exit: 'N', exitNo: 1, text: 'Кільце: перший зʼїзд — до автодрому (фініш)' },
    { k: 'edges', ids: [nOutE.id] },
    { k: 'finish', edge: nOutE.id, s: 40 },
  ];
}
// №12 і №13: кільце (3-й зʼїзд) → Стеценка на ПнЗ до розвороту → назад на кільце (вʼїзд W) → далі як №1 (Стеценка на ПдС, розворот на пл. Марченка, лівий на Турчина, правий на Мрію, кільце, фініш).
{
  const nwU = conn('J_NW:uturn');
  const nwOut = chainEdges('n_out'), wIn = chainEdges('w_in');
  const plan12 = [
    { k: 'edges', ids: [wInE.id] },
    { k: 'ring', entry: 'W', exit: 'N', exitNo: 3, text: 'Кільце: третій зʼїзд — на вул. Стеценка (до автодрому)' },
    { k: 'edges', ids: nwOut },
    { k: 'turn', conn: nwU.id, manoeuvre: 'uturn', text: 'Розворот на вул. Стеценка за автодромом' },
    { k: 'edges', ids: wIn },
    { k: 'ring', entry: 'W', exit: 'SE', exitNo: 2, text: 'Кільце: другий зʼїзд — на вул. Стеценка' },
    ...tail,
  ];
  ROUTE_PLANS.route12 = plan12;
  ROUTE_PLANS.route13 = plan12;
}
// №15: кільце → Мрія на південь до Берестейського проспекту → праворуч → на захід до розвороту (Святошин) → на схід до розвороту (вул. Нивська) → на захід → праворуч на Мрію → на північ → кільце → фініш.
{
  const sR = conn('J_BER:s_right'), wR = conn('J_BER:w_right'), wU = conn('J_BERW:uturn'), eU = conn('J_BERE:uturn');
  ROUTE_PLANS.route15 = [
    { k: 'edges', ids: [wInE.id] },
    { k: 'ring', entry: 'W', exit: 'MRII_OUT', exitNo: 1, text: 'Кільце: перший зʼїзд — на вул. Мрії' },
    { k: 'edges', ids: [...msIds, ...chainEdges('ms2_s')] },
    { k: 'turn', conn: sR.id, manoeuvre: 'right', text: 'Праворуч на Берестейський проспект' },
    { k: 'edges', ids: from(chainEdges('ber_w'), sR.to.edge) },
    { k: 'turn', conn: wU.id, manoeuvre: 'uturn', text: 'Розворот на Берестейському проспекті (Святошин)' },
    { k: 'edges', ids: chainEdges('ber_e') },
    { k: 'turn', conn: eU.id, manoeuvre: 'uturn', text: 'Розворот на Берестейському проспекті (вул. Нивська)' },
    { k: 'edges', ids: upTo(from(chainEdges('ber_w'), eU.to.edge), wR.from.edge) },
    { k: 'turn', conn: wR.id, manoeuvre: 'right', text: 'Праворуч на вул. Мрії' },
    { k: 'edges', ids: [...chainEdges('ms2_n'), ...mnIds] },
    ...finishTail,
  ];
}
const ROUTES = {};
for (const [id, plan] of Object.entries(ROUTE_PLANS)) {
  ROUTES[id] = buildRoute(plan, wInStart);
  console.log(id, 'length', ROUTES[id].length, 'm,', ROUTES[id].steps.length, 'steps');
}
const routePts = Object.values(ROUTES).flatMap((r) => r._pts);
for (const r of Object.values(ROUTES)) delete r._pts;
const routeLen = ROUTES.route1.length;

// ---------- Будинки й контекстні дороги (до 160 м від маршруту/ребер) ----------
const nearPts = [];
for (const e of edges) if (e.kind !== 'side' && e.kind !== 'driveway') for (let i = 0; i < e.ref.length; i++) nearPts.push(e.ref[i]);
const grid = new Map();
const GK = 40;
for (const p of resample(routePts, 10).concat(nearPts)) { const k = `${Math.floor(p[0] / GK)},${Math.floor(p[1] / GK)}`; grid.set(k, true); }
const near = (p, R) => {
  const gx = Math.floor(p[0] / GK), gz = Math.floor(p[1] / GK), n = Math.ceil(R / GK);
  for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) if (grid.has(`${gx + dx},${gz + dz}`)) return true;
  return false;
};
const buildings = [];
for (const w of ways.values()) {
  if (!w.tags.building || w.nds.length < 4) continue;
  const pts = w.nds.filter((id) => nodes.has(id)).map(P);
  if (pts.length < 4) continue;
  const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
  if (!near(c, 120)) continue;
  const lv = w.tags['building:levels'] ? +w.tags['building:levels'] : null;
  const h = w.tags.height ? parseFloat(w.tags.height) : null;
  const kind = w.tags.building;
  const levels = lv ?? (kind === 'house' || kind === 'detached' ? 2 : kind === 'garage' || kind === 'garages' || kind === 'shed' || kind === 'kiosk' ? 1 : kind === 'apartments' ? 9 : 3);
  const poly = simplify(pts.slice(0, -1), 0.3);
  buildings.push({ pts: poly.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), levels, height: Math.round((h ?? levels * 3) * 10) / 10, kind, ...(w.tags.name ? { name: w.tags.name } : {}), ...(lv === null && !h ? { levelsGuess: true } : {}) });
}
const context = [];
const inChain = new Set(CHAINS.flatMap((c) => c.ways));
for (const w of ways.values()) {
  const h = w.tags.highway;
  if (!h || inChain.has(w.id) || RING_WAYS.includes(w.id)) continue;
  if (!['residential', 'service', 'unclassified', 'living_street', 'tertiary', 'secondary', 'secondary_link', 'tertiary_link', 'footway', 'pedestrian', 'path', 'cycleway'].includes(h)) continue;
  const pts = w.nds.filter((id) => nodes.has(id)).map(P);
  if (!pts.some((p) => near(p, 90))) continue;
  const lanes = +(w.tags.lanes ?? 0);
  const width = ['footway', 'pedestrian', 'path', 'cycleway'].includes(h) ? 2 : lanes ? lanes * 3.2 : h === 'service' ? 4 : h === 'secondary' || h === 'tertiary' ? 7 : 6;
  context.push({ kind: h, name: w.tags.name ?? '', width, ...(w.tags.oneway === 'yes' ? { oneway: true } : {}), ...(w.tags.service ? { service: w.tags.service } : {}), osm: w.id, pts: simplify(pts, 0.3).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) });
}

// ---------- Переходи, які перетинають зʼєднувачі (повороти через «зебру») ----------
for (const c of connectors) {
  const hits = [];
  const cum = cumLen(c.path);
  for (const x of crossings) {
    // Відрізок переходу продовжуємо на 3,2 м з обох боків: пішохід біля краю зебри теж у зоні повороту (півширини авто).
    const L0 = Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) || 1, EXT = 3.2;
    const ux = (x.b[0] - x.a[0]) / L0, uz = (x.b[1] - x.a[1]) / L0;
    const ax = x.a[0] - ux * EXT, az = x.a[1] - uz * EXT, bx = x.b[0] + ux * EXT, bz = x.b[1] + uz * EXT;
    const L = L0 + 2 * EXT;
    for (let i = 0; i < c.path.length - 1; i++) {
      const p = c.path[i], q = c.path[i + 1];
      const rx = q[0] - p[0], rz = q[1] - p[1], sx = bx - ax, sz = bz - az;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - p[0]) * sz - (az - p[1]) * sx) / den, u = ((ax - p[0]) * rz - (az - p[1]) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { hits.push({ crossing: x.id, s: r2(cum[i] + t * Math.hypot(rx, rz)), u: r2(Math.max(0, Math.min(L0, u * L - EXT))) }); break; }
    }
  }
  if (hits.length) c.crossings = hits;
}

// ---------- Вивід ----------
const outEdges = edges.map((e) => {
  const L = edgeLen(e);
  e.features.sort((a, b) => a.stop - b.stop);
  return {
    id: e.id, name: e.name, chain: e.chain, kind: e.kind, lanes: e.lanes, laneWidth: e.laneWidth, speedKmh: e.speedKmh,
    median: e.median, centreLine: e.centreLine, centreOwner: e.centreOwner, length: r2(L), prev: e.prev, next: e.next,
    features: e.features, osm: e.osm, ref: e.ref.map((p) => [r2(p[0]), r2(p[1])]),
  };
});
for (const c of connectors) if (c.minRadius < 4) console.warn('tight connector', c.id, c.minRadius);
const data = {
  version: 1, id: 'route1', name: 'Маршрут №1, ТСЦ № 8042 (наказ РСЦ ГСЦ МВС в м. Києві від 24.12.2025 № 287н)',
  meta: {
    origin: { lat: proj.lat0, lon: proj.lon0, note: 'центр кільця Стеценка/Мрії (коло найменших квадратів)' },
    projection: 'локальна рівнокутна наближено: X = (lon − lon0)·kx (схід), Z = −(lat − lat0)·kz (південь), метри',
    kx: proj.kx, kz: proj.kz,
    license: 'Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)',
    sources: ['data/raw/tile-a.osm', 'data/raw/tile-b.osm', 'data/raw/tile-c.osm', 'data/raw/tile-d.osm', 'data/raw/map-route1.osm', 'data/raw/tile-n1.osm'],
    built: new Date().toISOString().slice(0, 10), laneWidth: W, routeLength: Math.round(routeLen),
    conventions: 'ref — ліва межа проїзної частини у напрямку руху; смуга i (0 — ліва) має вісь ref.offset((i+0.5)·laneWidth); d > 0 праворуч; кільце проти годинникової (θ — математичний кут, 0 — схід, Z на південь); зміна кількості смуг — лише праворуч',
  },
  edges: outEdges, connectors, rings, junctions, controllers, crossings, stopLines, signals, signs, busStops,
  stubs: stubsOut.map((s) => ({ id: s.id, name: s.name, kind: s.highway, edge: s.edge, s: r2(s.s), in: s.in, out: s.out, connectors: s.conns, osm: s.way })),
  route: ROUTES.route1, routes: ROUTES,
  buildings, context,
};
mkdirSync('src/data', { recursive: true });
const json = JSON.stringify(data);
writeFileSync('src/data/route1.json', json);
console.log('src/data/route1.json', (json.length / 1024).toFixed(0), 'KB;', outEdges.length, 'edges,', connectors.length, 'connectors,', crossings.length, 'crossings,', buildings.length, 'buildings,', context.length, 'context');
for (const e of outEdges) if (e.kind === 'street' || e.kind === 'arm' || e.kind === 'cross') console.log(' ', e.id, e.lanes, 'lanes', e.length, 'm', e.features.map((f) => `${f.kind}@${Math.round(f.stop)}`).join(' '));
