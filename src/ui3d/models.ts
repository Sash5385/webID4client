// Моделі Kenney (CC0): Car Kit і City Kit Roads, вшиті в сторінку як data-URL. Кожен кіт має власну colormap.png,
// тому окремий LoadingManager на кіт. Кожну модель «запікаємо» в один Mesh (1 draw call на авто).
import { buildCerato, buildId4 } from './id4';
import { Box3, BufferGeometry, LoadingManager, Mesh, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import sedanUrl from '../../public/models/sedan.glb';
import suvUrl from '../../public/models/suv.glb';
import taxiUrl from '../../public/models/taxi.glb';
import hatchUrl from '../../public/models/hatchback-sports.glb';
import vanUrl from '../../public/models/van.glb';
import deliveryUrl from '../../public/models/delivery.glb';
import carMapUrl from '../../public/models/colormap.png';
import lightSquareUrl from '../../public/models/light-square.glb';
import lightCurvedUrl from '../../public/models/light-curved.glb';
import coneUrl from '../../public/models/construction-cone.glb';
import roadMapUrl from '../../public/models/roads-colormap.png';

export type CarKey = 'sedan' | 'suv' | 'taxi' | 'hatch' | 'van' | 'delivery';
export type PropKey = 'lightSquare' | 'lightCurved' | 'cone';

export interface Baked {
  readonly geo: BufferGeometry;
  readonly mat: Material | Material[];
  readonly box: Box3; // у власних одиницях моделі
  readonly exact?: boolean; // справжні пропорції (без «стискання» Kenney)
}
export interface Models {
  readonly cars: Record<CarKey, Baked>;
  readonly id4: Baked; // авто гравця на автоматі — Volkswagen ID.4 (процедурна модель)
  readonly cerato: Baked; // на механіці — Kia Cerato
  readonly props: Record<PropKey, Baked>;
}

export const TRAFFIC_CARS: readonly CarKey[] = ['suv', 'taxi', 'hatch', 'van', 'delivery', 'sedan'];

function loaderFor(map: string): GLTFLoader {
  const mgr = new LoadingManager();
  mgr.setURLModifier((u) => (u.includes('colormap') ? map : u));
  return new GLTFLoader(mgr);
}

async function bake(loader: GLTFLoader, url: string, rotY = 0): Promise<Baked> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const geos: BufferGeometry[] = [], mats: Material[] = [];
  gltf.scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    if (rotY) g.rotateY(rotY);
    geos.push(g); mats.push(m.material as Material);
  });
  const same = mats.every((m) => m === mats[0]);
  const geo = geos.length === 1 ? geos[0]! : mergeGeometries(geos, !same);
  if (!geo) throw new Error('GLB merge failed: ' + url);
  geo.computeBoundingBox();
  geo.userData['shared'] = true;
  for (const m of mats) m.userData['shared'] = true;
  return { geo, mat: same ? mats[0]! : mats, box: geo.boundingBox!.clone() };
}

export async function loadModels(): Promise<Models> {
  const car = loaderFor(carMapUrl), road = loaderFor(roadMapUrl);
  // Моделі Kenney дивляться в +Z, рушій — у -Z, тож розвертаємо на π.
  const carUrls: Record<CarKey, string> = { sedan: sedanUrl, suv: suvUrl, taxi: taxiUrl, hatch: hatchUrl, van: vanUrl, delivery: deliveryUrl };
  const propUrls: Record<PropKey, string> = { lightSquare: lightSquareUrl, lightCurved: lightCurvedUrl, cone: coneUrl };
  const ck = Object.keys(carUrls) as CarKey[], pk = Object.keys(propUrls) as PropKey[];
  const [cb, pb] = await Promise.all([
    Promise.all(ck.map((k) => bake(car, carUrls[k], Math.PI))),
    Promise.all(pk.map((k) => bake(road, propUrls[k]))),
  ]);
  const cars = {} as Record<CarKey, Baked>, props = {} as Record<PropKey, Baked>;
  ck.forEach((k, i) => { cars[k] = cb[i]!; });
  pk.forEach((k, i) => { props[k] = pb[i]!; });
  return { cars, props, id4: buildId4(), cerato: buildCerato() };
}
