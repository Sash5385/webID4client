// Статичний світ: земля, дороги, розмітка, кільце, світлофори, будинки, дерева. Усе з sim.net.
import {
  BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Euler, Group, IcosahedronGeometry, InstancedMesh,
  Float32BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Quaternion, Vector2, Vector3, type Material, type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Dir, Feature, RouteNet } from '../engine/route';
import { Polyline, type Vec2 } from '../engine/geometry';
import type { Light } from '../engine/signals';
import type { AnySim, Sim } from '../engine/sim';
import { dashes, Geo, lineRibbon, ribbon, sector, without } from './geo';
import type { Baked, Models } from './models';
import type { Quality } from './quality';
import type { Pbr, PbrSet } from './pbr';
import { asphaltTex, blobGeometry, FACADE_COLS, FACADE_FLOORS, FACADE_H, FACADE_W, facadeTex, grassTex, pavingTex } from './textures';

export const C = {
  grass: Geo.color(0x9ed486), asphalt: Geo.color(0x565b64), side: Geo.color(0xcdc9c0), curb: Geo.color(0xe6e3dc),
  mark: Geo.color(0xf6f6f6), black: Geo.color(0x20232a), island: Geo.color(0x86c46f), pole: Geo.color(0x4a4f58),
  head: Geo.color(0x23262c), trunk: Geo.color(0x7a5535), stone: Geo.color(0xb9b6ae), red: Geo.color(0xd8312b),
  white: Geo.color(0xffffff), green: Geo.color(0x3fbf5a),
};

export const Y_ASPH = 0.03, Y_MARK = 0.05, Y_SIDE = 0.14;
export const HALF_LINE = 0.07;

export const unitBox = new BoxGeometry(1, 1, 1);
export const unitCyl = new CylinderGeometry(0.5, 0.5, 1, 8);
const tmpP = new Vector3(), tmpS = new Vector3(), tmpQ = new Quaternion(), tmpE = new Euler();
export function mat(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  tmpE.set(0, ry, 0);
  return new Matrix4().compose(tmpP.set(x, y, z), tmpQ.setFromEuler(tmpE), tmpS.set(sx, sy, sz));
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface World {
  readonly group: Group;
  updateLights(sim: AnySim): void;
  setNight(on: boolean): void; // нічне світіння ліхтарів і світлофорів (лише маршрути на мережі OSM)
  dispose(): void;
}

// Текстури створюються один раз і живуть між перебудовами світу (зміна якості).
// Процедурні — лише запасний варіант, якщо фото-текстури не завантажились.
let texCache: { asph: ReturnType<typeof asphaltTex>; paving: ReturnType<typeof pavingTex>; grass: ReturnType<typeof grassTex>; facade: ReturnType<typeof facadeTex>; blob: BufferGeometry } | null = null;
export const textures = (procedural: boolean): NonNullable<typeof texCache> => (texCache ??= procedural
  ? { asph: asphaltTex(), paving: pavingTex(), grass: grassTex(), facade: facadeTex(), blob: blobGeometry() }
  : { blob: blobGeometry() } as unknown as NonNullable<typeof texCache>);
let windowsTex: ReturnType<typeof facadeTex> | null = null;
export const getWindowsTex = (): Texture => (windowsTex ??= facadeTex(true));

// Метри на один тайл фото-текстур (UV = координата / розмір).
export const TILE = { asphalt: 4, paving: 1.8, grass: 6, concrete: 3 };

interface SignalHead { readonly fi: number; readonly lamps: readonly [Mesh, Mesh, Mesh]; state: string }

function addTree(g: Geo, x: number, z: number, s: number, y0 = 0): void {
  g.addGeometry(unitCyl, mat(x, y0 + 0.7 * s, z, 0, 0.3 * s, 1.4 * s, 0.3 * s), C.trunk);
  g.addGeometry(new IcosahedronGeometry(1, 0), mat(x, y0 + 2.5 * s, z, 0, 1.5 * s, 1.7 * s, 1.5 * s), Geo.color(0x4fae56));
}

// Фасад: фото-бетон (діфуз/шорсткість/нормаль, ~3 м на тайл) + процедурні вікна й балкони з альфою поверх нього.
// Колір будинку (vertexColor) тоНУЄ бетон, а не скло: вікна діляться на нього назад.
export function facadeMaterial(c: PbrSet, windows: Texture, normal: boolean): MeshStandardMaterial {
  const rx = (FACADE_COLS * FACADE_W) / TILE.concrete, ry = (FACADE_FLOORS * FACADE_H) / TILE.concrete;
  for (const t of [c.map, c.rough, c.normal]) t?.repeat.set(rx, ry);
  const m = new MeshStandardMaterial({
    map: c.map, roughness: 1, vertexColors: true, ...(c.rough ? { roughnessMap: c.rough } : {}),
    ...(normal && c.normal ? { normalMap: c.normal, normalScale: new Vector2(0.8, 0.8) } : {}),
  });
  m.onBeforeCompile = (sh): void => {
    sh.uniforms['tWin'] = { value: windows };
    sh.vertexShader = 'varying vec2 vWUv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWUv = uv;');
    sh.fragmentShader = 'uniform sampler2D tWin;\nvarying vec2 vWUv;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec4 w = texture2D(tWin, vWUv); vec3 tint = vec3(1.0);
      #ifdef USE_COLOR
        tint = max(vColor, vec3(0.05));
      #endif
        diffuseColor.rgb = mix(diffuseColor.rgb, w.rgb / tint, w.a); }`);
  };
  m.customProgramCacheKey = (): string => 'facade-win';
  return m;
}

export function buildWorld(sim: Sim, q: Quality, models: Models, pbr: Pbr | null): World {
  const tx = q !== 'low'; // середня/висока: текстури; низька: плоскі кольори
  const P = tx ? pbr : null; // фото-текстури Poly Haven (інакше — процедурні)
  const stdMat = q === 'high' || P !== null; // PBR-матеріали (на середній лише з фото-текстурами та середовищем)
  const WHITE = Geo.color(0xffffff);
  // Множники кольору під фото-текстури: підганяють яскравість до того, що було з процедурними.
  const K = P
    ? { grass: [0.9, 1.9, 1.2], asph: Geo.color(0xc0c4cc), side: [2.0, 1.95, 1.8] }
    : { grass: tx ? WHITE : C.grass, asph: tx ? WHITE : C.asphalt, side: tx ? WHITE : C.side };
  const T = tx ? textures(!P) : null;
  const net: RouteNet = sim.net;
  const cfg = sim.cfg;
  const W = net.laneWidth, mh = cfg.road.medianHalf, sw = cfg.road.sidewalk;
  const group = new Group();

  const ground = new Geo(), asph = new Geo(), side = new Geo(), edge = new Geo(), mark = new Geo(), props = new Geo();
  const dirs: Dir[] = ['S', 'N'];
  const z0 = cfg.street.startZ, len = cfg.street.length;

  // --- Земля ---
  ground.quadUp({ x: -700, z: -500 }, { x: 700, z: -500 }, { x: 700, z: len + 600 }, { x: -700, z: len + 600 }, 0, K.grass);

  // --- Перехрестя: зони, які виключаємо з тротуарів/крайових ліній ---
  const inters = net.features.filter((f) => f.def.kind === 'intersection');
  const cutsDir = (f: Feature, d: Dir): boolean => (d === 'S' ? f.def.side !== 'E' : f.def.side !== 'W');
  const exclFor = (d: Dir): [number, number][] => inters.filter((f) => cutsDir(f, d)).map((f) => [f.zone[d][0], f.zone[d][1]] as [number, number]);

  // --- Проїзна частина Мрії ---
  for (const d of dirs) lineRibbon(asph, net.ref[d], W, W + 0.02, Y_ASPH, K.asph);
  lineRibbon(asph, net.ref.S, -mh, mh + 0.03, Y_ASPH, K.asph);

  // --- Тротуари і бордюри ---
  for (const d of dirs) {
    const ref = net.ref[d];
    for (const [a, b] of without(ref.length, exclFor(d))) {
      const sl = ref.slice(a, b);
      lineRibbon(side, sl, 2 * W + sw / 2, sw / 2, Y_SIDE, K.side);
      const inner = sl.offset(2 * W).pts;
      for (let i = 0; i < inner.length - 1; i++) edge.wall(inner[i]!, inner[i + 1]!, Y_ASPH, Y_SIDE, C.curb, true);
      // верхня кромка бордюру
      lineRibbon(edge, sl, 2 * W + 0.1, 0.1, Y_SIDE + 0.005, C.curb);
    }
  }

  // --- Поперечні вулиці ---
  const edgeX = mh + 2 * W;
  for (const f of inters) {
    const hw = f.def.halfWidth;
    for (const sg of [-1, 1]) {
      if (sg === -1 && f.def.side === 'E') continue;
      if (sg === 1 && f.def.side === 'W') continue;
      const p0: Vec2 = { x: sg * (edgeX - 0.3), z: f.worldZ }, p1: Vec2 = { x: sg * 90, z: f.worldZ }; // авто ІІ їдуть до |x| = 80 і там зникають
      ribbon(asph, [p0, p1], hw, Y_ASPH, K.asph);
      const cl = new Polyline([p0, p1]);
      dashes(mark, cl, 0, 3, 6, HALF_LINE, Y_MARK, C.mark, 4, cl.length);
    }
  }

  // --- Проїзди у двори: заїзд з пандусом через тротуар (авто ходять смугами inZ/outZ до edgeX + depth) ---
  const drvCol = Geo.color(P ? 0x8a8e96 : 0x5a5f68);
  for (const dw of net.driveways) {
    const sg = dw.sign, hw = 3.0, z0d = dw.worldZ - hw, z1d = dw.worldZ + hw;
    const q = (xa: number, xb: number, ya: number, yb: number, g: Geo, col: readonly number[]): void => {
      g.triUp(sg * xa, ya, z0d, sg * xb, yb, z0d, sg * xb, yb, z1d, col);
      g.triUp(sg * xa, ya, z0d, sg * xb, yb, z1d, sg * xa, ya, z1d, col);
    };
    const yS = Y_SIDE + 0.015, yA = Y_ASPH + 0.012, xs = dw.edgeX + sw;
    q(dw.edgeX - 0.5, dw.edgeX + 0.3, yA, yS, edge, drvCol); // пандус від проїжджої частини на рівень тротуару
    q(dw.edgeX + 0.3, xs, yS, yS, edge, drvCol);              // перетин тротуару
    q(xs, xs + 0.7, yS, yA, edge, drvCol);                    // спуск на двір
    q(xs + 0.7, dw.edgeX + dw.depth + 1, yA, yA, asph, drvCol);
  }

  // --- Розмітка Мрії ---
  const centre = net.ref.S.offset(-mh);
  lineRibbon(mark, centre, -mh * 0.5, HALF_LINE, Y_MARK, C.mark);
  lineRibbon(mark, centre, mh * 0.5, HALF_LINE, Y_MARK, C.mark);
  for (const d of dirs) {
    const ref = net.ref[d];
    dashes(mark, ref, W, 3, 6, HALF_LINE, Y_MARK, C.mark);
    for (const f of net.features) {
      const a = Math.max(0, f.stop[d] - cfg.rules.solidBeforeStop), b = Math.min(ref.length, f.zone[d][1]);
      if (b > a) lineRibbon(mark, ref.slice(a, b), W, HALF_LINE, Y_MARK, C.mark);
    }
    for (const [a, b] of without(ref.length, exclFor(d))) lineRibbon(mark, ref.slice(a, b), 2 * W - 0.2, HALF_LINE, Y_MARK, C.mark);
  }

  // --- Стоп-лінії, зебри ---
  for (const f of net.features) {
    if (f.signalised) {
      for (const d of dirs) {
        const p = net.ref[d].pose(f.stop[d]);
        const hx = Math.sin(p.a), hz = -Math.cos(p.a), rx = Math.cos(p.a), rz = Math.sin(p.a);
        const o = (lat: number, lon: number): Vec2 => ({ x: p.x + rx * lat + hx * lon, z: p.z + rz * lat + hz * lon });
        mark.quadUp(o(mh, -0.2), o(mh + 2 * W, -0.2), o(mh + 2 * W, 0.2), o(mh, 0.2), Y_MARK, C.mark);
      }
    }
    if (f.def.kind !== 'intersection') {
      const hw = f.def.halfWidth;
      for (const d of dirs) {
        const [x0, x1] = net.carriageway[d];
        for (let x = x0 + 0.3; x < x1 - 0.5; x += 1.1) {
          mark.quadUp({ x, z: f.worldZ - hw + 0.3 }, { x: x + 0.55, z: f.worldZ - hw + 0.3 }, { x: x + 0.55, z: f.worldZ + hw - 0.3 }, { x, z: f.worldZ + hw - 0.3 }, Y_MARK, C.mark);
        }
      }
    }
  }

  // --- Кільце і рукава ---
  const { cx, cz, r, laneWidth: rw } = net.ring;
  const TAU = Math.PI * 2;
  sector(asph, cx, cz, r - rw, r + rw, 0, TAU, Y_ASPH, K.asph);
  const isl = r - rw - 0.3;
  sector(asph, cx, cz, 0, isl, 0, TAU, Y_ASPH, K.asph, 0.3); // під островом, щоб не було щілин
  sector(edge, cx, cz, 0, isl, 0, TAU, Y_SIDE + 0.02, C.island, 0.25);
  sector(edge, cx, cz, isl - 0.35, isl, 0, TAU, Y_SIDE + 0.04, C.curb, 0.2);
  for (let i = 0; i < 32; i++) {
    const t0 = (i / 32) * TAU, t1 = ((i + 1) / 32) * TAU;
    edge.wall({ x: cx + isl * Math.cos(t0), z: cz - isl * Math.sin(t0) }, { x: cx + isl * Math.cos(t1), z: cz - isl * Math.sin(t1) }, Y_ASPH, Y_SIDE + 0.04, C.curb);
  }
  // Дерево і невеличкий монумент на острові.
  props.addGeometry(unitCyl, mat(cx, Y_SIDE + 0.5, cz, 0, 2.6, 1.0, 2.6), C.stone);
  props.addGeometry(unitBox, mat(cx, Y_SIDE + 1.8, cz, 0.4, 1.0, 1.6, 1.0), C.stone);
  addTree(props, cx + 5, cz + 3, 1.3, Y_SIDE);
  addTree(props, cx - 4, cz - 5, 1.1, Y_SIDE);
  addTree(props, cx + 3, cz - 6, 0.9, Y_SIDE);
  // Лінії кільця: внутрішня суцільна, зовнішня з розривами біля рукавів, розділова пунктиром.
  sector(mark, cx, cz, r - rw + 0.15, r - rw + 0.15 + 2 * HALF_LINE, 0, TAU, Y_MARK, C.mark);
  const gaps: [number, number][] = net.armOrder.map((id) => {
    const a = net.arms[id];
    const lo = a.exitTheta - 0.1;
    return [lo, lo + (((a.mergeTheta + 0.1) - lo) % TAU + TAU) % TAU] as [number, number];
  });
  {
    const segs: [number, number][] = [];
    const base = gaps.map(([a, b]) => [((a % TAU) + TAU) % TAU, ((a % TAU) + TAU) % TAU + (b - a)] as [number, number]);
    const norm: [number, number][] = [];
    for (const [a, b] of base) { norm.push([a, b]); if (b > TAU) norm.push([a - TAU, b - TAU]); }
    for (const [a, b] of without(TAU, norm)) segs.push([a, b]);
    for (const [a, b] of segs) sector(mark, cx, cz, r + rw - 0.15 - 2 * HALF_LINE, r + rw - 0.15, a, b, Y_MARK, C.mark);
  }
  for (let t = 0; t < TAU - 0.01; t += 5 / r) sector(mark, cx, cz, r - HALF_LINE, r + HALF_LINE, t, t + 2 / r, Y_MARK, C.mark, 0.1);

  const off = cfg.ring.armLaneOffset;
  const armHalf = 2.2;
  const giveWay = (p: Polyline, s: number, latFrom: number, latTo: number): void => {
    const q = p.pose(s);
    const rx = Math.cos(q.a), rz = Math.sin(q.a), hx = Math.sin(q.a), hz = -Math.cos(q.a);
    for (let l = latFrom; l < latTo - 0.2; l += 0.9) {
      const l1 = Math.min(l + 0.5, latTo);
      mark.quadUp(
        { x: q.x + rx * l - hx * 0.2, z: q.z + rz * l - hz * 0.2 }, { x: q.x + rx * l1 - hx * 0.2, z: q.z + rz * l1 - hz * 0.2 },
        { x: q.x + rx * l1 + hx * 0.2, z: q.z + rz * l1 + hz * 0.2 }, { x: q.x + rx * l + hx * 0.2, z: q.z + rz * l + hz * 0.2 }, Y_MARK, C.mark);
    }
  };
  // «Дати дорогу»: трикутний знак (вістрям вниз) на стійці.
  const yieldSign = (x: number, z: number, a: number): void => {
    props.addGeometry(unitCyl, mat(x, 1.15, z, 0, 0.08, 2.3, 0.08), C.pole);
    const rot = new Matrix4().makeRotationX(Math.PI / 2);
    const base = new Matrix4().makeTranslation(x, 2.55, z).multiply(new Matrix4().makeRotationY(-a));
    const tri = (rad: number, zOff: number, col: readonly number[]): void => {
      props.addGeometry(new CylinderGeometry(rad, rad, 0.05, 3), base.clone().multiply(new Matrix4().makeTranslation(0, 0, zOff)).multiply(rot), col);
    };
    tri(0.62, 0.04, C.red);
    tri(0.40, 0.075, C.white);
    // дзеркальна «спинка» щоб знак не зникав ззаду
  };
  for (const id of net.armOrder) {
    const arm = net.arms[id];
    if (arm.inLine) {
      ribbon(asph, arm.inLine.pts, armHalf, Y_ASPH, K.asph);
      lineRibbon(mark, arm.inLine, -off, HALF_LINE, Y_MARK, C.mark);
      lineRibbon(mark, arm.inLine, armHalf - 0.25, HALF_LINE, Y_MARK, C.mark);
      lineRibbon(mark, arm.outLine, armHalf - 0.25, HALF_LINE, Y_MARK, C.mark);
      giveWay(arm.inLine, arm.inLine.length - 0.4, -armHalf + 0.2, armHalf - 0.2);
      const q = arm.inLine.pose(arm.inLine.length - 1.5);
      yieldSign(q.x + Math.cos(q.a) * (armHalf + 1.2), q.z + Math.sin(q.a) * (armHalf + 1.2), q.a);
      ribbon(asph, net.entryPath(arm.inLine.pose(arm.inLine.length), id, 1).pts, armHalf, Y_ASPH, K.asph);
    }
    ribbon(asph, arm.outLine.pts, armHalf, Y_ASPH, K.asph);
    for (const lane of [0, 1] as const) if (id === 'S' || lane === 1) ribbon(asph, net.exitPath(id, lane).pts, armHalf, Y_ASPH, K.asph);
  }
  for (const lane of [0, 1] as const) {
    const ln = net.lanes.N[lane];
    ribbon(asph, net.entryPath(ln.pose(ln.length), 'S', lane).pts, armHalf, Y_ASPH, K.asph);
  }
  {
    const n = net.ref.N;
    giveWay(n, n.length - 0.4, mh, mh + 2 * W);
    const q = n.pose(n.length - 1.5);
    yieldSign(q.x + Math.cos(q.a) * (mh + 2 * W + 1.0), q.z + Math.sin(q.a) * (mh + 2 * W + 1.0), q.a);
  }

  // --- Старт і фініш ---
  {
    const st = net.startPose.line.pose(net.startPose.s);
    const rx = Math.cos(st.a), rz = Math.sin(st.a), hx = Math.sin(st.a), hz = -Math.cos(st.a);
    const o = (lat: number, lon: number): Vec2 => ({ x: st.x + rx * lat + hx * lon, z: st.z + rz * lat + hz * lon });
    mark.quadUp(o(-armHalf, -0.3), o(armHalf, -0.3), o(armHalf, 0.3), o(-armHalf, 0.3), Y_MARK, C.green);
    const fin = net.finishOut.pose(net.finishS);
    const fx = Math.cos(fin.a), fz = Math.sin(fin.a), gx = Math.sin(fin.a), gz = -Math.cos(fin.a);
    const f = (lat: number, lon: number): Vec2 => ({ x: fin.x + fx * lat + gx * lon, z: fin.z + fz * lat + gz * lon });
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) {
      const l0 = -armHalf + (i * 2 * armHalf) / 8, l1 = l0 + (2 * armHalf) / 8, o0 = -0.6 + j * 0.6;
      mark.quadUp(f(l0, o0), f(l1, o0), f(l1, o0 + 0.6), f(l0, o0 + 0.6), Y_MARK, (i + j) % 2 ? C.black : C.white);
    }
    // Рамка-арка фінішу.
    for (const sg of [-1, 1]) props.addGeometry(unitBox, mat(fin.x + fx * sg * (armHalf + 0.3), 2, fin.z + fz * sg * (armHalf + 0.3), 0, 0.2, 4, 0.2), C.pole);
    const w = armHalf * 2 + 0.8;
    props.addGeometry(unitBox, mat(fin.x, 4.1, fin.z, -fin.a, w, 0.5, 0.15), C.red);
  }

  // --- Світлофори ---
  const heads: SignalHead[] = [];
  const lampGeo = new CircleGeometry(0.15, 10);
  const lampMats = {
    redOn: new MeshBasicMaterial({ color: 0xff3b30, toneMapped: false }), redOff: new MeshBasicMaterial({ color: 0x4a1612, toneMapped: false }),
    yelOn: new MeshBasicMaterial({ color: 0xffcc00, toneMapped: false }), yelOff: new MeshBasicMaterial({ color: 0x4a3d08, toneMapped: false }),
    grnOn: new MeshBasicMaterial({ color: 0x30e060, toneMapped: false }), grnOff: new MeshBasicMaterial({ color: 0x11401e, toneMapped: false }),
  };
  net.features.forEach((f, fi) => {
    if (!f.signalised) return;
    for (const d of dirs) {
      const p = net.ref[d].pose(f.stop[d] - 1.5);
      const lat = mh + 2 * W + 0.9;
      const x = p.x + Math.cos(p.a) * lat, z = p.z + Math.sin(p.a) * lat;
      props.addGeometry(unitCyl, mat(x, 1.8, z, 0, 0.14, 3.6, 0.14), C.pole);
      props.addGeometry(unitBox, mat(x, 3.9, z, -p.a, 0.5, 1.3, 0.3), C.head);
      props.addGeometry(unitBox, mat(x, 3.9, z, -p.a, 0.62, 1.42, 0.12), C.head);
      const lamps: Mesh[] = [];
      for (let k = 0; k < 3; k++) {
        const m = new Mesh(lampGeo, lampMats.redOff);
        const ly = 4.35 - k * 0.45;
        m.position.set(x - Math.sin(p.a) * 0.2, ly, z + Math.cos(p.a) * 0.2); // грань до водія (проти курсу)
        m.rotation.y = -p.a;
        group.add(m);
        lamps.push(m);
      }
      heads.push({ fi, lamps: lamps as unknown as readonly [Mesh, Mesh, Mesh], state: '' });
    }
  });

  // --- Вуличні ліхтарі (Kenney light-square/curved) вздовж Мрії, конуси біля старту і фінішу ---
  const instanced = (b: Baked, ms: Matrix4[]): void => {
    if (!ms.length) return;
    const im = new InstancedMesh(b.geo, b.mat, ms.length);
    ms.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true; im.receiveShadow = false; im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
    group.add(im);
  };
  {
    const lampH = 7.5, lampXZ = 7; // стовп Kenney надто тонкий у масштабі «по висоті» — розтягуємо по XZ менше
    const sq: Matrix4[] = [], cu: Matrix4[] = [];
    for (const d of dirs) {
      const ref = net.ref[d];
      const ex: [number, number][] = [...exclFor(d), ...net.features.map((f) => [f.stop[d] - 8, f.zone[d][1] + 4] as [number, number])];
      let i = 0;
      for (const [a, b] of without(ref.length, ex)) {
        for (let s = a + 12; s < b - 6; s += 32, i++) {
          const p = ref.pose(s), lat = 2 * W + sw - 0.55;
          const sy = lampH / (i % 2 ? models.props.lightCurved.box.max.y : models.props.lightSquare.box.max.y);
          // рука Kenney-ліхтаря дивиться в локальний -Z; повертаємо її на проїжджу частину (ліворуч від напрямку руху).
          (i % 2 ? cu : sq).push(mat(p.x + Math.cos(p.a) * lat, Y_SIDE, p.z + Math.sin(p.a) * lat, Math.PI / 2 - p.a, lampXZ, sy, lampXZ));
        }
      }
    }
    instanced(models.props.lightSquare, sq);
    instanced(models.props.lightCurved, cu);
    // Конуси збоку від дороги: по обидва боки лінії старту і фінішу (не на проїзній частині).
    const cones: Matrix4[] = [];
    const flank = (line: Polyline, s: number): void => {
      const q0 = line.pose(s);
      for (const sg of [-1, 1]) for (const lon of [-0.8, 0.8]) {
        const lat = sg * (armHalf + 0.6);
        cones.push(mat(q0.x + Math.cos(q0.a) * lat + Math.sin(q0.a) * lon, 0, q0.z + Math.sin(q0.a) * lat - Math.cos(q0.a) * lon, 0, 6, 6, 6));
      }
    };
    flank(net.startPose.line, net.startPose.s);
    flank(net.finishOut, net.finishS);
    instanced(models.props.cone, cones);
  }

  // --- Автобусні зупинки: павільйон (дах, скляна стінка, лавка) на тротуарі, відкритий до дороги ---
  const glassMat = new MeshLambertMaterial({ color: 0x9fd4ea, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide });
  {
    const glass = new Geo();
    const metal = Geo.color(0x3b6fa0), wood = Geo.color(0x9a6a3c), dk = Geo.color(0x30343a);
    for (const bs of net.busStops) {
      const sg = bs.sign, z = bs.worldZ, y0 = Y_SIDE;
      const xc = sg * (edgeX + sw - 0.9); // центр павільйону по X (зсув до зовнішнього краю тротуару)
      const xb = sg * (edgeX + sw - 0.25); // тильна стінка
      props.addGeometry(unitBox, mat(xc, y0 + 2.55, z, 0, 1.9, 0.09, 3.4), metal); // дах
      for (const dz of [-1.55, 1.55]) {
        props.addGeometry(unitBox, mat(xb, y0 + 1.25, z + dz, 0, 0.08, 2.5, 0.08), dk); // стійки
        props.addGeometry(unitBox, mat(sg * (edgeX + sw - 1.8), y0 + 1.25, z + dz, 0, 0.08, 2.5, 0.08), dk);
      }
      props.addGeometry(unitBox, mat(sg * (edgeX + sw - 0.55), y0 + 0.5, z, 0, 0.4, 0.07, 2.4), wood); // лавка
      props.addGeometry(unitBox, mat(sg * (edgeX + sw - 0.4), y0 + 0.78, z, 0, 0.06, 0.45, 2.4), wood); // спинка
      glass.addGeometry(unitBox, mat(xb, y0 + 1.3, z, 0, 0.03, 2.2, 3.0), WHITE); // скло (тильна й бічні стінки)
      glass.addGeometry(unitBox, mat(sg * (edgeX + sw - 1.0), y0 + 1.3, z - 1.55, 0, 1.6, 2.2, 0.03), WHITE);
      glass.addGeometry(unitBox, mat(sg * (edgeX + sw - 1.0), y0 + 1.3, z + 1.55, 0, 1.6, 2.2, 0.03), WHITE);
    }
    if (!glass.empty) {
      const gm = new Mesh(glass.build(), glassMat);
      gm.castShadow = false; gm.receiveShadow = false; gm.frustumCulled = false; gm.renderOrder = 2;
      group.add(gm);
    }
  }

  // --- Будівлі й дерева ---
  const rnd = mulberry32(20240607);
  const bPalette = [0xe8d9c5, 0xd9e2ec, 0xf0c9a8, 0xc9d8c5, 0xe9e0a8, 0xd4c1d9, 0xbfd3e0, 0xf2e1d0].map((h) => new Color(h));
  interface B { x: number; z: number; w: number; d: number; h: number }
  const blds: B[] = [];
  const trees: { x: number; z: number; s: number }[] = [];
  const driveBlocked = (sd: -1 | 1, z: number, d: number): boolean => net.driveways.some((dw) => dw.sign === sd && z < dw.worldZ + 7 && z + d > dw.worldZ - 7);
  const crossBlocked = (sd: -1 | 1, z: number, d: number): boolean => driveBlocked(sd, z, d) || inters.some((f) => (sd === -1 ? f.def.side !== 'E' : f.def.side !== 'W') && z < f.worldZ + f.def.halfWidth + 5 && z + d > f.worldZ - f.def.halfWidth - 5);
  for (const sd of [-1, 1] as const) {
    let z = z0 + 22 + rnd() * 6;
    while (z < z0 + len - 20) {
      const w = 10 + rnd() * 8, d = 10 + rnd() * 8, h = 7 + rnd() * rnd() * 20 + rnd() * 5;
      if (!crossBlocked(sd, z, d)) blds.push({ x: sd * (edgeX + sw + 4 + w / 2 + rnd() * 3), z: z + d / 2, w, d, h });
      z += d + 1.5 + rnd() * 5;
    }
    for (let tz = z0 + 14; tz < z0 + len; tz += 12 + rnd() * 14) {
      if (!crossBlocked(sd, tz - 3, 6)) trees.push({ x: sd * (edgeX + sw + 1.6), z: tz, s: 0.8 + rnd() * 0.5 });
    }
  }
  const nearRing: B[] = [
    { x: -42, z: 40, w: 16, d: 14, h: 12 }, { x: 40, z: 30, w: 14, d: 16, h: 9 },
    { x: -12, z: -46, w: 16, d: 12, h: 15 }, { x: 36, z: -58, w: 15, d: 13, h: 10 }, { x: -52, z: -32, w: 14, d: 14, h: 18 },
  ];
  blds.push(...nearRing);
  for (const t of [[-28, 24], [30, 14], [-24, -26], [22, -34], [-48, 12], [52, -4], [8, -30]] as const) trees.push({ x: t[0], z: t[1], s: 1 + rnd() * 0.5 });

  const std = (o: { map?: Texture; color?: number; vertexColors?: boolean }): Material => (stdMat ? new MeshStandardMaterial({ roughness: 0.9, ...o }) : new MeshLambertMaterial(o));
  const flat = (o: { color: number }): Material => (stdMat ? new MeshStandardMaterial({ roughness: 0.9, flatShading: true, ...o }) : new MeshLambertMaterial({ flatShading: true, ...o }));
  const roofs = new InstancedMesh(unitBox, flat({ color: 0x8b8f98 }), blds.length);
  const meshes: InstancedMesh[] = [roofs];
  blds.forEach((b, i) => roofs.setMatrixAt(i, mat(b.x, b.h + 0.15, b.z, 0, b.w + 0.5, 0.3, b.d + 0.5)));
  if (T) {
    // Фасади панельок: одна геометрія, UV підігнані під ціле число колонок/поверхів.
    const geos = blds.map((b) => {
      const g = new BoxGeometry(b.w, b.h, b.d);
      const uv = g.getAttribute('uv'), col: number[] = [], c = bPalette[Math.floor(rnd() * bPalette.length)]!.clone(); if (P) { c.lerp(new Color(0xffffff), 0.35); c.r *= 1.7; c.g *= 1.7; c.b *= 2.1; } // бетон Poly Haven хакі: компенсуємо, щоб панельки були світлі
      for (let v = 0; v < uv.count; v++) {
        const face = Math.floor(v / 4); // px, nx, py, ny, pz, nz
        if (face >= 2 && face < 4) { col.push(c.r, c.g, c.b); continue; }
        const ext = face < 2 ? b.d : b.w;
        const cols = Math.max(1, Math.round(ext / FACADE_W)), floors = Math.max(2, Math.round(b.h / FACADE_H));
        uv.setXY(v, (uv.getX(v) * cols) / FACADE_COLS, (uv.getY(v) * floors) / FACADE_FLOORS);
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new Float32BufferAttribute(col, 3));
      g.translate(b.x, b.h / 2, b.z);
      return g;
    });
    const fm = new Mesh(mergeGeometries(geos)!, P ? facadeMaterial(P.concrete, (windowsTex ??= facadeTex(true)), q === 'high') : std({ map: T.facade, vertexColors: true }));
    fm.castShadow = true; fm.receiveShadow = true; fm.frustumCulled = false;
    group.add(fm);
    geos.forEach((g) => g.dispose());
  } else {
    const bodies = new InstancedMesh(unitBox.clone().translate(0, 0.5, 0), new MeshLambertMaterial({ flatShading: true }), blds.length);
    const bands = new InstancedMesh(unitBox, new MeshLambertMaterial({ color: 0x4f6275, flatShading: true }), blds.length * 2);
    blds.forEach((b, i) => {
      bodies.setMatrixAt(i, mat(b.x, 0, b.z, 0, b.w, b.h, b.d));
      bodies.setColorAt(i, bPalette[Math.floor(rnd() * bPalette.length)]!);
      bands.setMatrixAt(i * 2, mat(b.x, b.h * 0.35, b.z, 0, b.w + 0.1, 1.6, b.d + 0.1));
      bands.setMatrixAt(i * 2 + 1, mat(b.x, b.h * 0.72, b.z, 0, b.w + 0.1, 1.6, b.d + 0.1));
    });
    meshes.push(bodies, bands);
  }
  for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; group.add(m); }

  // Крона: на низькій — один ікосаедр; на середній/високій — 3 згладжені «краплі» на дерево.
  const blobs = T ? 3 : 1;
  const trunks = new InstancedMesh(unitCyl, flat({ color: 0x7a5535 }), trees.length);
  const crowns = new InstancedMesh(T ? T.blob : new IcosahedronGeometry(1, 0), T ? std({ color: 0xffffff }) : new MeshLambertMaterial({ flatShading: true }), trees.length * blobs);
  trees.forEach((t, i) => {
    trunks.setMatrixAt(i, mat(t.x, 0.7 * t.s, t.z, 0, 0.3 * t.s, 1.4 * t.s, 0.3 * t.s));
    const hue = new Color().setHSL(0.3 + rnd() * 0.05, 0.45, 0.38 + rnd() * 0.08);
    for (let k = 0; k < blobs; k++) {
      const j = i * blobs + k;
      if (T) crowns.setMatrixAt(j, mat(t.x + (k ? (k === 1 ? 0.8 : -0.7) * t.s : 0), (2.7 + (k ? 0.1 * k : 0.5)) * t.s, t.z + (k === 2 ? 0.6 * t.s : k === 1 ? -0.5 * t.s : 0), rnd() * 6, (1.3 - 0.15 * k) * t.s, (1.2 - 0.1 * k) * t.s, (1.3 - 0.15 * k) * t.s));
      else crowns.setMatrixAt(j, mat(t.x, 2.5 * t.s, t.z, rnd() * 3, 1.5 * t.s, 1.7 * t.s, 1.5 * t.s));
      crowns.setColorAt(j, k ? hue.clone().offsetHSL(0, 0, 0.03 * k) : hue);
    }
  });
  for (const m of [trunks, crowns]) { m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; group.add(m); }

  // --- Матеріали шарів ---
  // Шар може мати фото-набір (діфуз + шорсткість + нормаль на високій) або лише процедурну карту.
  interface Surf { readonly map: Texture; readonly rough: Texture | null; readonly normal: Texture | null }
  const surf = (p: PbrSet | undefined, legacy: Texture | undefined): Surf | null => (p ? p : legacy ? { map: legacy, rough: null, normal: null } : null);
  const base = (po: number, sf: Surf | null): Material => {
    const o = { vertexColors: true, flatShading: true, side: DoubleSide, ...(sf ? { map: sf.map } : {}), polygonOffset: po !== 0, polygonOffsetFactor: po, polygonOffsetUnits: po };
    if (!stdMat) return new MeshLambertMaterial(o);
    return new MeshStandardMaterial({
      ...o, roughness: sf?.rough ? 1 : 0.92, ...(sf?.rough ? { roughnessMap: sf.rough } : {}),
      ...(q === 'high' && sf?.normal ? { normalMap: sf.normal, normalScale: new Vector2(0.9, 0.9) } : {}),
    });
  };
  // [геометрія, polygonOffset, відкидає тінь, UV-масштаб (м⁻¹), поверхня]
  const layers: [Geo, number, boolean, number, Surf | null][] = [
    [ground, 0, false, 1 / (P ? TILE.grass : 8), surf(P?.grass, T?.grass)], [asph, -1, false, 1 / (P ? TILE.asphalt : 10), surf(P?.asphalt, T?.asph)],
    [side, -2, false, 1 / (P ? TILE.paving : 3.2), surf(P?.paving, T?.paving)],
    [edge, -2, false, 0, null], [mark, -4, false, 0, null], [props, 0, true, 0, null]];
  for (const [g, po, cast, uvs, sf] of layers) {
    if (g.empty) continue;
    const m = new Mesh(g.build(sf ? uvs : 0), base(po, sf));
    m.castShadow = cast; m.receiveShadow = true; m.frustumCulled = false;
    group.add(m);
  }

  const setLamps = (h: SignalHead, red: boolean, yel: boolean, grn: boolean): void => {
    h.lamps[0].material = red ? lampMats.redOn : lampMats.redOff;
    h.lamps[1].material = yel ? lampMats.yelOn : lampMats.yelOff;
    h.lamps[2].material = grn ? lampMats.grnOn : lampMats.grnOff;
  };
  const key = (l: Light, blinkOn: boolean): string => (l === 'greenBlink' ? (blinkOn ? 'gb1' : 'gb0') : l);
  return {
    group,
    dispose(): void {
      group.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        if (!m.geometry.userData['shared'] && m.geometry !== texCache?.blob) m.geometry.dispose();
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (!mt.userData['shared']) mt.dispose();
      });
    },
    setNight(): void { /* маршрут №7: схематична вулиця без нічного світіння */ },
    updateLights(s0: AnySim): void {
      if (s0.route !== 'route7') return;
      const s = s0;
      const blinkOn = Math.floor(s.t * 4) % 2 === 0; // 2 Гц
      for (const h of heads) {
        const l = s.light(s.net.features[h.fi]!);
        const k = key(l, blinkOn);
        if (k === h.state) continue;
        h.state = k;
        setLamps(h, l === 'red' || l === 'redYellow', l === 'yellow' || l === 'redYellow', l === 'green' || (l === 'greenBlink' && blinkOn));
      }
    },
  };
}

