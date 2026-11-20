// Фотоматеріали Poly Haven (CC0): HDRI неба і PBR-текстури (діфуз, нормаль GL, шорсткість), вшиті як data-URL.
// Файли готує tools/fetch-polyhaven.mjs. Завантажуються один раз; на «низькій» якості не потрібні.
import {
  ClampToEdgeWrapping, DataTexture, DataUtils, EquirectangularReflectionMapping, HalfFloatType, ImageLoader, LinearFilter, LinearSRGBColorSpace,
  RepeatWrapping, RGBAFormat, SRGBColorSpace, Texture, Vector3,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import asphaltDiff from '../../public/polyhaven/asphalt_diff.jpg';
import asphaltNor from '../../public/polyhaven/asphalt_nor.jpg';
import asphaltRough from '../../public/polyhaven/asphalt_rough.jpg';
import pavingDiff from '../../public/polyhaven/paving_diff.jpg';
import pavingNor from '../../public/polyhaven/paving_nor.jpg';
import pavingRough from '../../public/polyhaven/paving_rough.jpg';
import grassDiff from '../../public/polyhaven/grass_diff.jpg';
import concreteDiff from '../../public/polyhaven/concrete_diff.jpg';
import concreteNor from '../../public/polyhaven/concrete_nor.jpg';
import concreteRough from '../../public/polyhaven/concrete_rough.jpg';
import skyHdr from '../../public/polyhaven/sky.hdr';

export interface PbrSet { readonly map: Texture; readonly normal: Texture | null; readonly rough: Texture | null }
export interface Pbr {
  readonly asphalt: PbrSet; readonly paving: PbrSet; readonly grass: PbrSet; readonly concrete: PbrSet;
  readonly sky: DataTexture;
}

// qwantani_afternoon_puresky: напрям сонця в HDRI (центр найяскравішої області) і колір горизонту (лінійний) для туману.
export const HDRI_SUN_DIR = new Vector3(0.611, 0.654, 0.446).normalize();
export const HDRI_HORIZON: readonly [number, number, number] = [0.383, 0.449, 0.518];

const imgLoader = new ImageLoader();
function image(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => imgLoader.load(url, res, undefined, (e) => rej(e instanceof Error ? e : new Error('texture load failed'))));
}
async function tex(url: string, srgb: boolean, aniso: number): Promise<Texture> {
  const t = new Texture(await image(url));
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
async function set(diff: string, nor: string | null, rough: string | null, aniso: number): Promise<PbrSet> {
  const [map, normal, r] = await Promise.all([tex(diff, true, aniso), nor ? tex(nor, false, aniso) : null, rough ? tex(rough, false, aniso) : null]);
  return { map, normal, rough: r };
}

function dataUrlBytes(url: string): ArrayBuffer {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Сонце в HDRI має яскравість у десятки тисяч: у PMREM воно б «пересвітило» середовище (пряме сонце дає DirectionalLight).
// Обрізаємо значення: біти half-float для невід'ємних чисел впорядковані так само, як числа.
const HALF_CLAMP = DataUtils.toHalfFloat(12);
function loadSky(): DataTexture {
  const r = new RGBELoader().setDataType(HalfFloatType).parse(dataUrlBytes(skyHdr));
  const d = Uint16Array.from(r.data as ArrayLike<number>);
  for (let i = 0; i < d.length; i++) if (d[i]! > HALF_CLAMP && d[i]! < 0x7c00) d[i] = HALF_CLAMP;
  const t = new DataTexture(d, r.width, r.height, RGBAFormat, HalfFloatType);
  t.mapping = EquirectangularReflectionMapping;
  t.minFilter = t.magFilter = LinearFilter;
  t.wrapS = RepeatWrapping; t.wrapT = ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.flipY = true;
  t.colorSpace = LinearSRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

let cache: Promise<Pbr> | null = null;
export function loadPbr(aniso: number): Promise<Pbr> {
  cache ??= Promise.all([
    set(asphaltDiff, asphaltNor, asphaltRough, aniso), set(pavingDiff, pavingNor, pavingRough, aniso), set(grassDiff, null, null, Math.min(aniso, 4)),
    set(concreteDiff, concreteNor, concreteRough, aniso),
  ]).then(([asphalt, paving, grass, concrete]) => ({ asphalt, paving, grass, concrete, sky: loadSky() }));
  return cache;
}
