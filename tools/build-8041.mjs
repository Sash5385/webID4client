// Збірка мереж маршрутів ТСЦ № 8041 з OSM: node tools/build-8041.mjs  (ONLY=1,4 — лише вибрані)
// Вхід: data/raw8041/t_*.osm (API OSM 0.6), tools/data/routes-8041.json ({ "1": { "path": [id вузлів OSM у порядку руху], "marks": [...] } }).
// Вихід: src/data/route8041_<N>.json (RouteData; кожен маршрут — окрема мережа) і src/data/route8041-index.ts.
// © OpenStreetMap contributors, ODbL 1.0.
//
// Маршрут-центрична збірка: мережа складається лише з доріг маршруту (ребра за ходом руху), повороти — зʼєднувачі Безьє,
// світлофори/переходи беруться з тегів вузлів OSM на шляху, «Дай дорогу» — на виїздах з другорядної дороги на головну.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { bezier, cumLen, dist, loadOSM, makeProjection, offsetPts, poseAt, project, r2, resample, smoothPts } from './osm-lib.mjs';

const W = 3.5;
const DIR = 'data/raw8041/';
const STEP = 2;
const TSC = 10314508703;
const IN = JSON.parse(readFileSync('tools/data/routes-8041.json', 'utf8'));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const hdg = (dx, dz) => Math.atan2(dx, -dz); // курс: h = (sin a, −cos a)

const osm = loadOSM(readdirSync(DIR).filter((f) => f.endsWith('.osm')).map((f) => DIR + f));
const { nodes, ways } = osm;
console.log('OSM:', nodes.size, 'вузлів,', ways.size, 'ways');
const pairWay = new Map();
for (const w of ways.values()) {
  if (!w.tags.highway) continue;
  for (let i = 0; i + 1 < w.nds.length; i++) { pairWay.set(w.nds[i] + '>' + w.nds[i + 1], w); if (!pairWay.has(w.nds[i + 1] + '>' + w.nds[i])) pairWay.set(w.nds[i + 1] + '>' + w.nds[i], w); }
}
const o = nodes.get(TSC);
const proj = makeProjection(o.lat, o.lon);
const P = (id) => { const n = nodes.get(id); if (!n) throw new Error('вузол ' + id); return proj.fwd(n.lat, n.lon); };

const CLASS = { service: 0, living_street: 1, residential: 1, unclassified: 1, tertiary: 2, tertiary_link: 2, secondary: 3, secondary_link: 3, primary: 4, primary_link: 4, trunk: 4, trunk_link: 4, motorway: 5, motorway_link: 5 };

function wayAttrs(w, fwd) {
  const t = w.tags, hw = t.highway;
  const ow = t.oneway === 'yes' || t.oneway === '1' || (t.junction === 'roundabout') || hw === 'motorway' || hw === 'motorway_link';
  const lt = parseInt(t.lanes, 10);
  let n;
  if (ow) n = lt > 0 ? lt : (hw === 'primary' || hw === 'secondary' || hw === 'trunk' ? 2 : 1);
  else n = lt > 0 ? Math.max(1, Math.ceil(lt / 2)) : (hw === 'primary' || hw === 'trunk' ? 2 : 1);
  if (t.name === 'Північний міст') n = 3; // у OSM ділянка позначена як construction без смуг
  n = Math.min(n, 4);
  const ms = parseInt(t.maxspeed, 10);
  const speed = ms >= 30 ? ms : 50;
  return { n, ow, speed, name: t.name || '', cls: t.name === 'Північний міст' ? 4 : CLASS[hw] ?? 1, hw, link: /_link$/.test(hw) };
}

function buildRoute(no, spec) {
  const path = spec.path;
  const R = path.map(P);
  const rawCum = cumLen(R);
  // Атрибути за кроком шляху.
  const segAttr = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const w = pairWay.get(path[i] + '>' + path[i + 1]);
    segAttr.push(w ? wayAttrs(w) : { n: 1, ow: false, speed: 20, name: '', cls: 0, hw: 'service' });
  }
  // Ресемплінг і згладжування.
  let Q = resample(R, STEP);
  Q = smoothPts(smoothPts(smoothPts(Q, 2), 3), 3); // три проходи: без вигинів з радіусом менше ширини смуги
  const qcum = cumLen(Q);
  const nQ = Q.length;
  const totalQ = qcum[nQ - 1], totalR = rawCum[rawCum.length - 1];
  const rawIdxAt = (i) => { // індекс кроку шляху для точки ресемплу
    const s = (qcum[i] / totalQ) * totalR;
    let lo = 0, hi = rawCum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rawCum[m] <= s) lo = m; else hi = m; }
    return Math.min(lo, segAttr.length - 1);
  };
  const attr = Array.from({ length: nQ }, (_, i) => segAttr[rawIdxAt(i)]);
  // Курс.
  const h = new Array(nQ).fill(0);
  for (let i = 0; i < nQ; i++) {
    const a = Q[Math.max(0, i - 1)], b = Q[Math.min(nQ - 1, i + 1)];
    h[i] = hdg(b[0] - a[0], b[1] - a[1]);
  }
  for (let i = 1; i < nQ; i++) h[i] = h[i - 1] + wrap(h[i] - h[i - 1]);
  // Ділянки поворотів.
  const WIN = 4, THR = 1.1;
  const marked = new Array(nQ).fill(false);
  for (let i = WIN; i < nQ - WIN; i++) if (Math.abs(h[i + WIN] - h[i - WIN]) > THR) marked[i] = true;
  let regions = [];
  for (let i = 0; i < nQ; i++) if (marked[i]) {
    let j = i;
    while (j + 1 < nQ && (marked[j + 1] || (j + 4 < nQ && marked.slice(j + 1, j + 5).some(Boolean)))) j++;
    regions.push([i, j]); i = j;
  }
  // Злиття близьких (щоб ребро між ними було ≥ ~16 м).
  const merged = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && r[0] - 4 - (last[1] + 4) < 14) last[1] = r[1]; else merged.push([r[0], r[1]]);
  }
  regions = merged.map(([i0, i1]) => {
    const a = Math.max(0, i0 - WIN), b = Math.min(nQ - 1, i1 + WIN);
    return { a, b, total: h[b] - h[a] };
  }).filter((r) => Math.abs(r.total) > 0.9); // S-подібні вигини всередині ребра — не поворот
  // Межі ребер: [0..regions[0].a], [regions[0].b .. regions[1].a], ... Додатково ділимо за смугами/швидкістю.
  const runKey = (i) => `${attr[i].n}|${attr[i].ow ? 1 : 0}|${attr[i].speed}`;
  const pieces = []; // { i0, i1, afterTurn:boolean, turn? }
  let start = 0;
  const bounds = [];
  for (const r of regions) { bounds.push([start, r.a, r]); start = r.b; }
  bounds.push([start, nQ - 1, null]);
  const edges = []; // внутрішні об'єкти
  const turns = []; // { from: edgeIdx, to: edgeIdx, region }
  for (const [i0, i1, region] of bounds) {
    // підсегменти за ключем
    const cuts = [i0];
    let cur = runKey(i0), runStart = i0;
    for (let i = i0 + 1; i <= i1; i++) {
      const k = runKey(i);
      if (k !== cur) {
        // новий ключ має тривати ≥ 5 відліків
        let ok = true;
        for (let j = i; j < Math.min(i1 + 1, i + 5); j++) if (runKey(j) !== k) ok = false;
        if (ok && i - runStart >= 8 && i1 - i >= 8) { cuts.push(i); cur = k; runStart = i; }
      }
    }
    cuts.push(i1);
    // Самоперетин: ребро не має проходити те саме місце двічі (інакше переходи/особливості мають лише одну позицію s на ребро).
    {
      const extra = [];
      const cell = new Map();
      let lastCut = i0;
      for (let j = i0; j <= i1; j++) {
        const key = Math.round(Q[j][0] / 8) + ',' + Math.round(Q[j][1] / 8);
        let hit = -1;
        for (let dx = -1; dx <= 1 && hit < 0; dx++) for (let dz = -1; dz <= 1 && hit < 0; dz++) {
          const k2 = (Math.round(Q[j][0] / 8) + dx) + ',' + (Math.round(Q[j][1] / 8) + dz);
          const q = cell.get(k2);
          if (q !== undefined && j - q > 30 && q >= lastCut && dist(Q[q], Q[j]) < 10) hit = q;
        }
        if (hit >= 0) {
          const c = Math.floor((hit + j) / 2);
          if (c - lastCut >= 4 && i1 - c >= 4) { extra.push(c); lastCut = c; for (const [k3, v3] of cell) if (v3 < c) cell.delete(k3); }
        }
        cell.set(key, j);
      }
      for (const c of extra) cuts.splice(cuts.length - 1, 0, c);
      cuts.sort((a, b) => a - b);
    }
    for (let c = 0; c + 1 < cuts.length; c++) {
      const a = cuts[c], b = cuts[c + 1];
      if (b - a < 2) continue;
      const mid = attr[(a + b) >> 1];
      edges.push({ i0: a, i1: b, attr: mid, contPrev: c > 0, region: null });
    }
    if (region) turns.push({ fromEdge: edges.length - 1, region });
  }
  for (let t = 0; t < turns.length; t++) turns[t].toEdge = turns[t].fromEdge + 1;
  // Ланцюжки: максимум смуг для односторонніх (ref — ліва межа, постійний зсув у ланцюжку).
  let chainStart = 0;
  for (let e = 0; e < edges.length; e++) {
    const isEnd = e === edges.length - 1 || !edges[e + 1].contPrev;
    if (isEnd) {
      let mx = 1;
      for (let k = chainStart; k <= e; k++) if (edges[k].attr.ow) mx = Math.max(mx, edges[k].attr.n);
      for (let k = chainStart; k <= e; k++) edges[k].leftOff = edges[k].attr.ow ? (mx * W) / 2 : 0;
      chainStart = e + 1;
    }
  }
  // Побудова EdgeData.
  const ID = (k) => `e${k}`;
  const E = edges.map((e, k) => {
    const C = Q.slice(e.i0, e.i1 + 1);
    // Зсув ref від осі: у середині ребра — своя ширина (кількість смуг), на стиках з сусіднім ребром — середнє значення, плавний перехід ~40 м.
    const offA = edges[k].contPrev ? (edges[k - 1].leftOff + e.leftOff) / 2 : e.leftOff;
    const offB = k + 1 < edges.length && edges[k + 1].contPrev ? (edges[k + 1].leftOff + e.leftOff) / 2 : e.leftOff;
    const cc = cumLen(C), LC = cc[cc.length - 1], RAMP = Math.min(40, LC / 2);
    const ss = (t) => t * t * (3 - 2 * t);
    const offs = C.map((_, i) => {
      const dA = cc[i], dB = LC - cc[i];
      let o = e.leftOff;
      if (dA < RAMP) o = offA + (e.leftOff - offA) * ss(dA / RAMP);
      if (dB < RAMP) o = o + (offB - o) * (1 - ss(dB / RAMP)) ;
      return -o;
    });
    const ref = e.leftOff || offA || offB ? offsetPts(C, offs) : C;
    const cum = cumLen(ref);
    const a = e.attr;
    return {
      id: ID(k), name: a.name || '', chain: null, kind: 'street', lanes: a.n, laneWidth: W, speedKmh: a.speed, median: 0,
      centreLine: !a.ow && a.cls >= 2 ? 'single' : 'none', centreOwner: true, length: r2(cum[cum.length - 1]),
      prev: [], next: [], features: [], osm: [], ref: ref.map((p) => [r2(p[0]), r2(p[1])]),
      noAi: a.cls <= 1 ? true : undefined,
      _q0: e.i0, _q1: e.i1, _cum: cum, _ref: ref, _ow: a.ow, _cls: a.cls,
    };
  });
  for (let k = 0; k < E.length; k++) {
    if (edges[k].contPrev) { E[k - 1].next.push(E[k].id); E[k].prev.push(E[k - 1].id); }
  }
  const lanePose = (e, lane, s) => {
    const p = poseAt(e._ref, e._cum, Math.max(0, Math.min(e.length, s)));
    const d = (lane + 0.5) * W;
    return { x: p.x - p.hz * d, z: p.z + p.hx * d, hx: p.hx, hz: p.hz };
  };
  const refPose = (e, s, d) => {
    const p = poseAt(e._ref, e._cum, Math.max(0, Math.min(e.length, s)));
    return { x: p.x - p.hz * d, z: p.z + p.hx * d, hx: p.hx, hz: p.hz, a: hdg(p.hx, p.hz) };
  };
  // Вузли шляху з тегами → (ребро, s).
  const locate = (k) => {
    // Орієнтовна позиція за довжиною, далі точна проєкція вузла на Q у вікні ±80 м (довжини Q і сирого шляху трохи різняться).
    const sExp = (rawCum[k] / totalR) * totalQ;
    const i0 = Math.max(0, Math.floor((sExp - 80) / STEP)), i1 = Math.min(nQ - 2, Math.ceil((sExp + 80) / STEP));
    const p = R[k];
    let best = Infinity, bs = sExp;
    for (let i = i0; i <= i1; i++) {
      const a = Q[i], b = Q[i + 1];
      const L = qcum[i + 1] - qcum[i];
      if (L < 1e-9) continue;
      const hx = (b[0] - a[0]) / L, hz = (b[1] - a[1]) / L;
      const t = Math.max(0, Math.min(L, (p[0] - a[0]) * hx + (p[1] - a[1]) * hz));
      const dd = Math.hypot(p[0] - (a[0] + hx * t), p[1] - (a[1] + hz * t));
      if (dd < best) { best = dd; bs = qcum[i] + t; }
    }
    const sQ = bs;
    for (let e = 0; e < E.length; e++) {
      const q0 = qcum[E[e]._q0], q1 = qcum[E[e]._q1];
      if (sQ >= q0 - 0.01 && sQ <= q1 + 0.01) {
        const E_ = E[e], sExp2 = ((sQ - q0) / Math.max(1e-6, q1 - q0)) * E_.length;
        // Уточнення: проєкція на ref у вікні (ref зсунутий від осі, на дугах довжини Q і ref розходяться).
        const win = 60 + 0.08 * E_.length;
        let bd = Infinity, bsv = sExp2;
        for (let i = 0; i + 1 < E_._ref.length; i++) {
          if (E_._cum[i + 1] < sExp2 - win || E_._cum[i] > sExp2 + win) continue;
          const a = E_._ref[i], b = E_._ref[i + 1], L = E_._cum[i + 1] - E_._cum[i];
          if (L < 1e-9) continue;
          const hx = (b[0] - a[0]) / L, hz = (b[1] - a[1]) / L;
          const t = Math.max(0, Math.min(L, (p[0] - a[0]) * hx + (p[1] - a[1]) * hz));
          const dd = Math.hypot(p[0] - (a[0] + hx * t), p[1] - (a[1] + hz * t));
          if (dd < bd) { bd = dd; bsv = E_._cum[i] + t; }
        }
        return { e, s: bsv };
      }
    }
    return null;
  };
  // Зʼєднувачі.
  const conns = [];
  const turnAt = new Map(); // edge index → conn
  for (let t = 0; t < turns.length; t++) {
    const { fromEdge, toEdge, region } = turns[t];
    const A = E[fromEdge], B = E[toEdge];
    let kind = region.total > 0 ? 'right' : Math.abs(region.total) > 2.35 ? 'uturn' : 'left';
    if (Math.abs(region.total) > 2.0) { // шпилька/розворот: знак кута неоднозначний (≈ ±π) — напрям за розташуванням початку ребра B відносно кінця A
      const ea = lanePose(A, A.lanes - 1, A.length), sb = lanePose(B, 0, 0);
      const lat = (sb.x - ea.x) * -ea.hz + (sb.z - ea.z) * ea.hx; // > 0 — праворуч
      kind = lat < 0 ? 'uturn' : 'right';
    }
    const la = kind === 'right' ? A.lanes - 1 : 0;
    const lb = kind === 'right' ? B.lanes - 1 : 0;
    const p0 = lanePose(A, la, A.length), p3 = lanePose(B, lb, 0);
    const D = dist([p0.x, p0.z], [p3.x, p3.z]);
    const sharp = Math.abs(region.total) > 2.0; // шпилька / розворот: довші «плечі» Безьє, щоб радіус не був меншим за ~3 м
    // Шпилька: плече Безьє від кута θ і хорди D — наближення дуги кола (без петлі): R = D/(2 sin θ/2), d = 4/3·tan(θ/4)·R.
    const th = Math.min(Math.PI, Math.abs(region.total)), Rr = D / (2 * Math.sin(th / 2));
    const d0 = sharp ? Math.max(1.2, (4 / 3) * Math.tan(th / 4) * Rr) : Math.max(3, Math.min(16, D * 0.45)), d1 = d0;
    let path = bezier(p0, p3, d0, d1, 28);
    const aSpec = wayInfo(A), bSpec = wayInfo(B);
    // Другорядна → головна: «Дай дорогу».
    const giveWay = bSpec.cls > aSpec.cls || (bSpec.cls === aSpec.cls && aSpec.cls >= 2 && kind !== 'right' && false);
    const c = {
      id: `c${t}`, junction: null, turn: kind, rank: giveWay ? 0 : kind === 'right' ? 2 : 1,
      from: { edge: A.id, lane: la, s: A.length }, to: { edge: B.id, lane: lb, s: 0 },
      path: path.map((q) => [r2(q[0]), r2(q[1])]), lock: `L${t}`, minRadius: sharp ? Math.max(2, Math.min(8, Rr)) : 6, playerOnly: true,
      _kind: kind, _t: t, _giveWay: giveWay, _fromIdx: fromEdge, _toIdx: toEdge,
    };
    conns.push(c); turnAt.set(fromEdge, c);
  }
  function wayInfo(e) { return { cls: e._cls }; }
  // Особливості: світлофори, переходи, «дай дорогу».
  let ctlN = 0;
  const controllers = [], junctions = [], crossings = [], stopLines = [], signals = [], signs = [];
  const addFeature = (e, f) => { E[e].features.push(f); };
  const turnDistAfter = (e, s) => (turnAt.has(e) ? E[e].length - s : Infinity);
  const featNodes = [];
  for (let k = 0; k < path.length; k++) {
    const n = nodes.get(path[k]);
    const tg = n.tags || {};
    if (tg.highway === 'traffic_signals' || tg.highway === 'crossing' || tg.crossing || tg.railway === 'level_crossing') featNodes.push({ k, id: path[k], tg });
  }
  const placedSignals = new Set();
  for (const fn of featNodes) {
    const loc = locate(fn.k);
    if (!loc) continue;
    const { e, s } = loc;
    const edge = E[e];
    const isSig = fn.tg.highway === 'traffic_signals';
    const isCross = fn.tg.highway === 'crossing' || !!fn.tg.crossing;
    if (fn.tg.railway === 'level_crossing') continue;
    // Поблизу повороту — сигнал на кінці ребра перед поворотом (і на ребрі після повороту — переносимо назад).
    let eT = e, sT = s;
    if (isSig) {
      const toEnd = turnDistAfter(e, s);
      if (toEnd < 40) { eT = e; sT = edge.length; }
      else if (e > 0 && turnAt.has(e - 1) && s < 30 && !isCross) { eT = e - 1; sT = E[e - 1].length; }
      const key = `${eT}`;
      if (placedSignals.has(key + ':' + Math.round(sT / 40))) continue;
      placedSignals.add(key + ':' + Math.round(sT / 40));
      const ctl = `J${++ctlN}`;
      controllers.push({ id: ctl, offset: (ctlN * 11) % 40, groups: ['A', 'B'] });
      const stop = sT >= E[eT].length - 0.01 ? E[eT].length : Math.max(1, sT - 3);
      const fid = `${ctl}:sig@${E[eT].id}`;
      addFeature(eT, { id: fid, kind: 'signal', ...(sT >= E[eT].length - 0.01 ? { junction: ctl } : {}), ctrl: ctl, group: 'A', s: r2(stop), stop: r2(stop), zone: [r2(stop + 0.5), r2(Math.min(E[eT].length, stop + 20))] });
      if (turnAt.has(eT) && stop >= E[eT].length - 0.01) { const c = turnAt.get(eT); c.ctrl = ctl; c.group = 'A'; c.junction = ctl; }
      const sp = refPose(E[eT], stop, 0), spR = refPose(E[eT], stop, E[eT].lanes * W);
      junctions.push({ id: ctl, name: fn.tg.name || E[eT].name || ctl, kind: 'signal', x: r2(sp.x), z: r2(sp.z), ctrl: ctl, poly: [[r2(sp.x - 6), r2(sp.z - 6)], [r2(sp.x + 6), r2(sp.z - 6)], [r2(sp.x + 6), r2(sp.z + 6)], [r2(sp.x - 6), r2(sp.z + 6)]] });
      stopLines.push({ id: `sl_${fid}`, edge: E[eT].id, s: r2(stop), kind: 'signal', a: [r2(sp.x), r2(sp.z)], b: [r2(spR.x), r2(spR.z)], ctrl: ctl, group: 'A' });
      const hp = refPose(E[eT], stop, E[eT].lanes * W + 1.2);
      signals.push({ id: `${fid}:R`, kind: 'vehicle', ctrl: ctl, group: 'A', edge: E[eT].id, s: r2(stop), x: r2(hp.x), z: r2(hp.z), a: r2(hp.a) });
      continue;
    }
    if (isCross && !isSig) {
      if (s < 14 || edge.length - s < 14) continue;                 // біля стику/повороту — пропуск
      if (e > 0 && edges[e].contPrev === false && s < 20) continue;  // одразу після повороту
      const id = `x${fn.id}`;
      const twoWay = !edge._ow;
      const signalCross = false; // світлофорні переходи без нашої голови світлофора — звичайні зебри (піший світлофор не змодельовано)
      let cr = crossings.find((q) => q.id === id);
      if (!cr) {
        const wLeft = twoWay ? edge.lanes * W + 1.5 : 1.5;
        const a = refPose(edge, s, -wLeft), b = refPose(edge, s, edge.lanes * W + 1.5);
        cr = { id, kind: signalCross ? 'signal' : 'zebra', source: 'osm', osm: [fn.id], a: [r2(a.x), r2(a.z)], b: [r2(b.x), r2(b.z)], width: 4, spans: [] };
        crossings.push(cr);
      }
      { // проміжок цього ребра вздовж осі переходу a→b
        const L = Math.hypot(cr.b[0] - cr.a[0], cr.b[1] - cr.a[1]);
        const ux = (cr.b[0] - cr.a[0]) / L, uz = (cr.b[1] - cr.a[1]) / L;
        const p0 = refPose(edge, s, 0), p1 = refPose(edge, s, edge.lanes * W);
        const u0 = (p0.x - cr.a[0]) * ux + (p0.z - cr.a[1]) * uz, u1 = (p1.x - cr.a[0]) * ux + (p1.z - cr.a[1]) * uz;
        cr.spans.push({ edge: edge.id, s: r2(s), u0: r2(Math.min(u0, u1)), u1: r2(Math.max(u0, u1)) });
      }
      addFeature(e, { id: `${id}@${edge.id}`, kind: 'crossing', crossing: id, s: r2(s), zone: [r2(s - 2), r2(s + 2)], stop: r2(s - 3) });
      const sgn = refPose(edge, s - 3, edge.lanes * W + 1.5);
      signs.push({ kind: 'pedCrossing', edge: edge.id, s: r2(s - 3), x: r2(sgn.x), z: r2(sgn.z), a: r2(sgn.a) });
    }
  }
  // Перехід може перетинати й інші ребра маршруту (паралельні проїзні частини, повторний прохід): додаємо їм ділянку й особливість,
  // щоб пішохід на переході був видимий кожному, хто їде цією смугою.
  for (const cr of crossings) {
    const L = Math.hypot(cr.b[0] - cr.a[0], cr.b[1] - cr.a[1]);
    const ux = (cr.b[0] - cr.a[0]) / L, uz = (cr.b[1] - cr.a[1]) / L;
    for (let ei = 0; ei < E.length; ei++) {
      const e = E[ei];
      if (cr.spans.some((sp) => sp.edge === e.id)) continue;
      let hits = 0, u0 = Infinity, u1 = -Infinity, sSum = 0;
      for (let u = 0; u <= L; u += 0.5) {
        const pt = [cr.a[0] + ux * u, cr.a[1] + uz * u];
        const q = project(e._ref, e._cum, pt);
        if (q.dist < e.lanes * W + 2 && q.d > -0.3 && q.d < e.lanes * W + 0.3 && q.s > 1 && q.s < e.length - 1) { hits++; u0 = Math.min(u0, u); u1 = Math.max(u1, u); sSum += q.s; }
      }
      if (hits < 1) continue;
      const sMid = sSum / hits;
      { // повна ширина проїзної частини ребра в проєкції на вісь переходу (а не лише кілька точок дотику)
        const q0 = refPose(e, sMid, 0), q1 = refPose(e, sMid, e.lanes * W);
        const ua = (q0.x - cr.a[0]) * ux + (q0.z - cr.a[1]) * uz, ub = (q1.x - cr.a[0]) * ux + (q1.z - cr.a[1]) * uz;
        u0 = Math.min(ua, ub); u1 = Math.max(ua, ub);
      }
      // s — перетин осі переходу (середина смуг ребра) з ref ребра, а не середнє по точках дотику
      const um = (u0 + u1) / 2, pm = [cr.a[0] + ux * um, cr.a[1] + uz * um];
      const sx = project(e._ref, e._cum, pm).s;
      cr.spans.push({ edge: e.id, s: r2(sx), u0: r2(u0), u1: r2(u1) });
      addFeature(ei, { id: `${cr.id}@${e.id}`, kind: 'crossing', crossing: cr.id, s: r2(sx), zone: [r2(sx - 2), r2(sx + 2)], stop: r2(sx - 3) });
    }
  }
  // Подовжуємо переходи так, щоб усі їхні ділянки лежали всередині a→b (+1,5 м тротуару з кожного боку).
  for (const cr of crossings) {
    const L = Math.hypot(cr.b[0] - cr.a[0], cr.b[1] - cr.a[1]);
    const ux = (cr.b[0] - cr.a[0]) / L, uz = (cr.b[1] - cr.a[1]) / L;
    const lo = Math.min(0, Math.min(...cr.spans.map((sp) => sp.u0)) - 1.5), hi = Math.max(L, Math.max(...cr.spans.map((sp) => sp.u1)) + 1.5);
    if (lo < -0.01 || hi > L + 0.01) {
      const a0 = cr.a;
      cr.a = [r2(a0[0] + ux * lo), r2(a0[1] + uz * lo)]; cr.b = [r2(a0[0] + ux * hi), r2(a0[1] + uz * hi)];
      cr.spans = cr.spans.map((sp) => ({ ...sp, u0: r2(sp.u0 - lo), u1: r2(sp.u1 - lo) }));
    }
  }
  // «Дай дорогу» перед зʼєднувачами rank 0 (без світлофора).
  for (const c of conns) {
    if (!c._giveWay || c.ctrl) continue;
    const A = E[c._fromIdx];
    const sp = refPose(A, A.length, 0), spR = refPose(A, A.length, A.lanes * W);
    addFeature(c._fromIdx, { id: `${c.id}:giveway`, kind: 'giveWay', s: r2(A.length), stop: r2(A.length), zone: [r2(A.length + 0.5), r2(A.length + 3.6)] });
    stopLines.push({ id: `sl_${c.id}`, edge: A.id, s: r2(A.length), kind: 'giveWay', a: [r2(sp.x), r2(sp.z)], b: [r2(spR.x), r2(spR.z)] });
    const sg = refPose(A, A.length - 1, A.lanes * W + 1.5);
    signs.push({ kind: 'giveWay', edge: A.id, s: r2(A.length - 1), x: r2(sg.x), z: r2(sg.z), a: r2(sg.a) });
  }
  // ІІ — лише на ребрах, що не перекриваються іншими ділянками маршруту (інакше ІІ їздить крізь гравця на стику проходів).
  for (let i = 0; i < E.length; i++) {
    if (E[i].noAi) continue;
    const chain = new Set([E[i].id, ...E[i].next, ...E[i].prev]);
    let hit = 0, tot = 0;
    for (let k = 0; k < E[i]._ref.length; k += 3) {
      tot++;
      const p = E[i]._ref[k];
      if (E.some((o) => !chain.has(o.id) && o._ref.some((q, j) => j % 2 === 0 && Math.abs(q[0] - p[0]) < 12 && Math.abs(q[1] - p[1]) < 12 && dist(q, p) < 12))) hit++;
    }
    if (hit > 0) E[i].noAi = true;
  }
  // Сортуємо особливості.
  for (const e of E) e.features.sort((a, b) => a.s - b.s);
  // Контекст: дороги й будівлі поблизу маршруту.
  const sampleQ = Q.filter((_, i) => i % 5 === 0);
  const near = (p, r) => { for (const q of sampleQ) if (Math.abs(q[0] - p[0]) < r && Math.abs(q[1] - p[1]) < r && dist(q, p) < r) return true; return false; };
  const context = [], buildings = [];
  const onPath = new Set(path);
  for (const w of ways.values()) {
    const t = w.tags;
    if (t.highway && ['primary', 'secondary', 'tertiary', 'residential', 'service', 'unclassified', 'trunk', 'motorway', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link', 'motorway_link', 'living_street'].includes(t.highway)) {
      if (w.nds.every((id) => onPath.has(id))) continue;
      const pts = w.nds.map((id) => { const n = nodes.get(id); return n ? proj.fwd(n.lat, n.lon) : null; }).filter(Boolean);
      if (pts.length < 2 || !pts.some((p) => near(p, 160))) continue;
      const width = ['primary', 'trunk', 'motorway', 'secondary'].includes(t.highway) ? 10 : t.highway === 'service' ? 4 : 6;
      context.push({ kind: t.highway, name: t.name || '', width, oneway: t.oneway === 'yes', osm: w.id, pts: pts.map((p) => [r2(p[0]), r2(p[1])]) });
    } else if (t.building && w.nds.length > 3 && w.nds[0] === w.nds[w.nds.length - 1]) {
      const pts = w.nds.slice(0, -1).map((id) => { const n = nodes.get(id); return n ? proj.fwd(n.lat, n.lon) : null; }).filter(Boolean);
      if (pts.length < 3 || !pts.some((p) => near(p, 120))) continue;
      const lv = parseInt(t['building:levels'], 10);
      const levels = lv > 0 ? lv : 3;
      buildings.push({ pts: pts.map((p) => [r2(p[0]), r2(p[1])]), levels, height: levels * 3, kind: t.building, ...(lv > 0 ? {} : { levelsGuess: true }) });
    }
  }
  // Кроки маршруту.
  const steps = [];
  const nameOf = (e) => E[e].name || 'проїзд';
  for (let k = 0; k < E.length; k++) {
    steps.push({ kind: 'edge', edge: E[k].id });
    const c = turnAt.get(k);
    if (c) {
      const man = c._kind === 'uturn' ? 'uturn' : c._kind;
      const txt = man === 'uturn' ? 'Розворот' : `${man === 'left' ? 'Ліворуч' : 'Праворуч'} на ${nameOf(c._toIdx)}`;
      steps.push({ kind: 'turn', conn: c.id, manoeuvre: man, text: txt });
    }
  }
  const last = E[E.length - 1];
  steps.push({ kind: 'finish', edge: last.id, s: r2(last.length - 3) });
  const sp0 = refPose(E[0], 0, 0);
  const polyline = Q.filter((_, i) => i % 3 === 0).map((p) => [r2(p[0]), r2(p[1])]);
  const def = {
    start: { edge: E[0].id, s: 0, lane: 0 }, steps,
    checkpoints: [{ id: 'start', label: 'Початок', x: r2(sp0.x), z: r2(sp0.z) }, { id: 'finish', label: 'Кінець', x: r2(Q[nQ - 1][0]), z: r2(Q[nQ - 1][1]) }],
    polyline, length: r2(totalQ),
  };
  const id = `r8041_${no}`;
  const clean = (e) => { const o2 = { ...e }; for (const k of Object.keys(o2)) if (k[0] === '_' || o2[k] === undefined) delete o2[k]; return o2; };
  const data = {
    version: 1, id, name: spec.title || `ТСЦ 8041, маршрут ${no}`,
    meta: { origin: { lat: o.lat, lon: o.lon, note: 'ТСЦ 8041 (старт)' }, license: 'Map data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)', laneWidth: W, routeLength: r2(totalQ), built: new Date().toISOString().slice(0, 10), sources: ['OSM API 0.6 /map'] },
    edges: E.map(clean),
    connectors: conns.map(clean).map((c) => { const q = { ...c }; return q; }),
    rings: [{ id: 'R0', name: '', cx: 0, cz: -90000, r: 20, laneWidth: W, lanes: 2, arms: [] }],
    junctions, controllers, crossings, stopLines, signals, signs, busStops: [], stubs: [],
    route: def, routes: { [id]: def }, buildings, context,
  };
  console.log(`маршрут ${no}: ${r2(totalQ)} м, ребер ${E.length}, поворотів ${conns.length} [${conns.map((c) => c._kind[0] + (c._giveWay ? '!' : '')).join('')}], світлофорів ${controllers.length}, переходів ${crossings.length}, будівель ${buildings.length}, контекст ${context.length}`);
  return data;
}

mkdirSync('src/data', { recursive: true });
const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(IN);
for (const no of only) {
  const data = buildRoute(no, IN[no]);
  writeFileSync(`src/data/route8041_${no}.json`, JSON.stringify(data));
}
const all = readdirSync('src/data').filter((f) => /^route8041_\d+\.json$/.test(f)).sort();
writeFileSync('src/data/route8041-index.ts', `// Згенеровано tools/build-8041.mjs — не редагувати.\n${all.map((f) => `import R${f.match(/_(\d+)\.json/)[1]} from './${f}';`).join('\n')}\nexport const DATA_8041: Record<string, unknown> = { ${all.map((f) => `${f.match(/_(\d+)\.json/)[1]}: R${f.match(/_(\d+)\.json/)[1]}`).join(', ')} };\n`);
