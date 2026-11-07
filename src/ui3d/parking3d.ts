// 3D-майданчик для парковки: фото-асфальт (Poly Haven, якщо завантажений), бордюри, тротуар із плиткою, стіни й перемичка гаража,
// конуси Kenney, біла розмітка зони, осьова лінія, дерева, ліхтарі й будинки на фоні. Авто малює Actors (через ParkSim).
import {
  BoxGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, Vector2,
  type BufferGeometry, type Material, type Texture,
} from 'three';
import type { Obb, ParkSim } from '../engine/parking';
import type { Models } from './models';
import type { Pbr, PbrSet } from './pbr';
import type { Quality } from './quality';
import { TILE } from './world';

export function buildParkWorld(sim: ParkSim, models: Models | null, pbr: Pbr | null, q: Quality): { group: Group; dispose: () => void } {
  const g = new Group();
  const mats: Material[] = [], geos: BufferGeometry[] = [], texs: Texture[] = [];
  const std = q !== 'low';
  const M = (c: number, rough = 0.9): Material => { const m = std ? new MeshStandardMaterial({ color: c, roughness: rough }) : new MeshLambertMaterial({ color: c }); mats.push(m); return m; };
  // Матеріал із PBR-набору: текстури клонуємо, щоб своє повторення (метри на плитку) не чіпало світ маршрутів.
  const P = (set: PbrSet | undefined, tile: number, w: number, h: number, fallback: number): Material => {
    if (!set || !std) return M(fallback);
    const t = (x: Texture | null): Texture | null => { if (!x) return null; const c = x.clone(); c.wrapS = c.wrapT = RepeatWrapping; c.repeat.set(w / tile, h / tile); c.needsUpdate = true; texs.push(c); return c; };
    const m = new MeshStandardMaterial({ map: t(set.map), roughnessMap: t(set.rough), roughness: set.rough ? 1 : 0.9, ...(q === 'high' && set.normal ? { normalMap: t(set.normal), normalScale: new Vector2(0.9, 0.9) } : {}) });
    mats.push(m);
    return m;
  };
  const plane = (x0: number, x1: number, z0: number, z1: number, y: number, m: Material): Mesh => {
    const geo = new PlaneGeometry(x1 - x0, z1 - z0); geos.push(geo);
    const o = new Mesh(geo, m);
    o.rotation.x = -Math.PI / 2; o.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); o.receiveShadow = true;
    g.add(o);
    return o;
  };
  const block = (b: Obb, h: number, m: Material, y0 = 0): void => {
    const geo = new BoxGeometry(b.hw * 2, h, b.hl * 2); geos.push(geo);
    const o = new Mesh(geo, m);
    o.position.set(b.x, y0 + h / 2, b.z); o.rotation.y = -b.a; o.castShadow = true; o.receiveShadow = true;
    g.add(o);
  };
  const strip = (x: number, z: number, hx: number, hz: number, c: number, y = 0.05): void => {
    const geo = new PlaneGeometry(hx * 2, hz * 2); geos.push(geo);
    const o = new Mesh(geo, new MeshLambertMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })); mats.push(o.material as Material);
    o.rotation.x = -Math.PI / 2; o.position.set(x, y, z); g.add(o);
  };
  const tree = (x: number, z: number, s: number): void => {
    const tg = new CylinderGeometry(0.12 * s, 0.18 * s, 1.6 * s, 6); geos.push(tg);
    const t = new Mesh(tg, M(0x6b4a2b)); t.position.set(x, 0.8 * s, z); t.castShadow = true; g.add(t);
    const cg = new IcosahedronGeometry(1.1 * s, 0); geos.push(cg);
    const c = new Mesh(cg, M(0x3f7f3a, 1)); c.position.set(x, 2.2 * s, z); c.scale.set(1, 1.15, 1); c.castShadow = true; g.add(c);
  };
  const lampPost = (x: number, z: number, side: 1 | -1): void => {
    const pg = new CylinderGeometry(0.06, 0.08, 5.5, 6); geos.push(pg);
    const p = new Mesh(pg, M(0x50555c, 0.6)); p.position.set(x, 2.75, z); p.castShadow = true; g.add(p);
    const ag = new BoxGeometry(0.1, 0.1, 1.4); geos.push(ag);
    const a = new Mesh(ag, M(0x50555c, 0.6)); a.position.set(x, 5.5, z - side * 0.6); g.add(a);
  };
  const building = (x0: number, x1: number, zc: number, d: number, h: number, c: number): void => {
    const geo = new BoxGeometry(x1 - x0, h, d); geos.push(geo);
    const o = new Mesh(geo, M(c, 0.95)); o.position.set((x0 + x1) / 2, h / 2, zc); o.castShadow = true; o.receiveShadow = true; g.add(o);
  };

  const L = sim.layout;
  const asph = (x0: number, x1: number, z0: number, z1: number): void => { plane(x0, x1, z0, z1, 0, P(pbr?.asphalt, TILE.asphalt, x1 - x0, z1 - z0, 0x3a3d42)); };
  const side = (x0: number, x1: number, z0: number, z1: number): void => { plane(x0, x1, z0, z1, 0.02, P(pbr?.paving, TILE.paving, x1 - x0, z1 - z0, 0xb9b3a6)); };
  plane(-120, 120, -120, 120, -0.02, P(pbr?.grass, TILE.grass, 240, 240, 0x6f9a55)); // трава
  let roadZ0: number, roadZ1: number;
  if (sim.kind === 'turn') { roadZ0 = -8.0; roadZ1 = 3.4; }
  else if (sim.kind === 'parallel') { roadZ0 = -4.6; roadZ1 = 2.9; }
  else { roadZ0 = -6.3; roadZ1 = 3.0; }
  asph(-30, 40, roadZ0, roadZ1);
  side(-30, 40, roadZ1 + 0.3, roadZ1 + 6);
  side(-30, 40, roadZ0 - 6.3, roadZ0 - 0.3);
  if (sim.kind === 'garage') plane(9, 12.6, 3.0, 8.6, 0.03, P(pbr?.concrete, TILE.concrete, 3.6, 5.6, 0x8b8b8b));
  // Осьова розмітка вулиці (пунктир) — крім вправ, де вона заважає.
  const mid = (roadZ0 + roadZ1) / 2;
  for (let x = -28; x < 38; x += 4) strip(x + 1, mid, 1, 0.07, 0xf2f2f2);
  const curbM = M(0xc9c6bd, 0.8), wallM = M(0xd8c9ab, 0.9);
  for (const o of L.obstacles) {
    if (o.kind === 'curb') block(o, o.h, curbM);
    else if (o.kind === 'wall') block(o, o.h, wallM);
    else if (o.kind === 'cone') {
      if (models) { // конус Kenney: розмір ≈ 0,7 м заввишки
        const b = models.props.cone, h = b.box.max.y - b.box.min.y || 1, sc = 0.7 / h;
        const cm = new Mesh(b.geo, b.mat); cm.scale.setScalar(sc); cm.position.set(o.x, -b.box.min.y * sc, o.z); cm.castShadow = true; g.add(cm);
      } else {
        const cg = new CylinderGeometry(0.05, 0.22, 0.7, 12); geos.push(cg);
        const m = new Mesh(cg, M(0xff7a1a)); m.position.set(o.x, 0.35, o.z); m.castShadow = true; g.add(m);
      }
    }
  }
  if (sim.kind === 'garage') { // перемичка над прорізом і стовпи по краях
    const lintel: Obb = { x: 10.8, z: 3.0, hl: 0.25, hw: 2.4, a: 0 };
    block(lintel, 0.35, wallM, 2.45);
  }
  // Біла розмітка зони: рамка навколо місця (для розвороту — смуга призначення).
  const z = L.zone, t = 0.1;
  const alongX = Math.abs(Math.sin(z.a)) > 0.5;
  const hx = alongX ? z.hl : z.hw, hz = alongX ? z.hw : z.hl;
  strip(z.x, z.z - hz, hx, t, 0xffffff); strip(z.x, z.z + hz, hx, t, 0xffffff); strip(z.x - hx, z.z, t, hz, 0xffffff); strip(z.x + hx, z.z, t, hz, 0xffffff);
  // Окруження: дерева, ліхтарі, будинки на фоні.
  if (q !== 'low') {
    const sz = roadZ1 + 5, nz = roadZ0 - 5.6;
    for (let x = -24; x <= 36; x += 9) { tree(x + (x % 2 ? 1.5 : -1), sz + 1.2, 1 + ((x * 7) & 3) * 0.1); tree(x + 3, nz - 1, 0.9 + ((x * 5) & 3) * 0.1); }
    for (let x = -22; x <= 34; x += 18) { lampPost(x, roadZ1 + 0.9, 1); lampPost(x + 9, roadZ0 - 0.9, -1); }
    building(-40, -6, sz + 14, 10, 14, 0xc9b9a3); building(-2, 24, sz + 15, 9, 20, 0xb9c2c9); building(28, 60, sz + 13, 10, 12, 0xd2c4b0);
    building(-36, -10, nz - 14, 9, 17, 0xbdb5ab); building(0, 30, nz - 15, 10, 22, 0xa9b2bb);
  }
  void DoubleSide;
  return { group: g, dispose: () => { mats.forEach((m) => m.dispose()); geos.forEach((q2) => q2.dispose()); texs.forEach((t2) => t2.dispose()); } };
}
