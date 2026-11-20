// Демо-кадр «максимум реалізму» на three.js: PBR, небо з сонцем, відображення, мʼякі тіні, GTAO, bloom.
// Усі текстури процедурні (без зовнішніх файлів). Сцена: вул. Мрії, Нивки, золота година.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import sedanUrl from '../../public/models/sedan.glb';
import suvUrl from '../../public/models/suv.glb';
import taxiUrl from '../../public/models/taxi.glb';
import hatchUrl from '../../public/models/hatchback-sports.glb';
import vanUrl from '../../public/models/van.glb';
import colormapUrl from '../../public/models/colormap.png';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

let seed = 42;
const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const R = (a: number, b: number): number => a + (b - a) * rnd();

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 1500);

// ---------- Небо, сонце, середовище ----------
const sky = new Sky();
sky.scale.setScalar(5000);
const su = sky.material.uniforms;
su['turbidity']!.value = 6;
su['rayleigh']!.value = 1.6;
su['mieCoefficient']!.value = 0.006;
su['mieDirectionalG']!.value = 0.85;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 11), THREE.MathUtils.degToRad(205));
su['sunPosition']!.value.copy(sunDir);
scene.add(sky);

const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(sky.clone());
scene.environment = pmrem.fromScene(envScene, 0.02).texture;
scene.fog = new THREE.FogExp2(0xd9c3a8, 0.0032);

const sun = new THREE.DirectionalLight(0xffd7a8, 4.2);
sun.position.copy(sunDir).multiplyScalar(120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
sun.target.position.set(0, 0, -30);
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x5a4a35, 0.6));

// ---------- Процедурні текстури ----------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1], color = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], spread: number, n: number, size: [number, number]): void {
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const d = R(-spread, spread);
    g.fillStyle = `rgba(${base[0] + d | 0},${base[1] + d | 0},${base[2] + d | 0},${R(0.3, 0.9)})`;
    const s = R(size[0], size[1]);
    g.fillRect(R(0, w), R(0, h), s, s);
  }
}
const asphaltMap = canvasTex(512, 512, (g) => {
  speckle(g, 512, 512, [62, 62, 66], 22, 26000, [1, 2.5]);
  for (let i = 0; i < 18; i++) { // латки і тріщини
    g.fillStyle = `rgba(30,30,33,${R(0.15, 0.35)})`;
    g.beginPath(); g.ellipse(R(0, 512), R(0, 512), R(10, 60), R(6, 30), R(0, 3), 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(20,20,22,0.5)'; g.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) { g.beginPath(); let x = R(0, 512), y = R(0, 512); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += R(-25, 25); y += R(-25, 25); g.lineTo(x, y); } g.stroke(); }
}, [2, 40]);
const asphaltRough = canvasTex(256, 256, (g) => speckle(g, 256, 256, [215, 215, 215], 40, 6000, [1, 3]), [4, 80], false);
const grassMap = canvasTex(512, 512, (g) => {
  speckle(g, 512, 512, [86, 116, 52], 26, 30000, [1, 3]);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${R(120, 150)},${R(110, 130)},60,0.25)`; g.beginPath(); g.arc(R(0, 512), R(0, 512), R(10, 40), 0, 7); g.fill(); }
}, [40, 160]);
const pavingMap = canvasTex(256, 256, (g) => {
  speckle(g, 256, 256, [168, 162, 152], 14, 5000, [1, 2]);
  g.strokeStyle = 'rgba(90,85,78,0.55)'; g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
}, [1, 100]);

// Фасад панельки: вікна, балкони, інколи засклені лоджії.
function facade(cols: number, floors: number, base: string): THREE.CanvasTexture {
  const cw = 32, fh = 40;
  return canvasTex(cols * cw, floors * fh, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, cols * cw, floors * fh);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(0,0,0,${R(0.02, 0.06)})`; g.fillRect(R(0, cols * cw), R(0, floors * fh), R(2, 8), R(2, 8)); }
    g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
    for (let f = 0; f <= floors; f++) { g.beginPath(); g.moveTo(0, f * fh); g.lineTo(cols * cw, f * fh); g.stroke(); }
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + 6, y = f * fh + 9;
        const lit = rnd() < 0.08;
        const sky = R(0, 1);
        g.fillStyle = lit ? `rgb(255,${R(190, 215) | 0},140)` : `rgb(${60 + sky * 50 | 0},${75 + sky * 55 | 0},${95 + sky * 60 | 0})`;
        g.fillRect(x, y, cw - 12, fh - 16);
        g.fillStyle = 'rgba(240,240,235,0.8)'; g.fillRect(x + (cw - 12) / 2 - 1, y, 2, fh - 16);
        if (c % 3 === 1 && rnd() < 0.85) { // балкон
          g.fillStyle = rnd() < 0.5 ? 'rgba(225,222,214,0.95)' : 'rgba(170,190,205,0.95)';
          g.fillRect(x - 4, y + fh - 26, cw - 4, 14);
        }
      }
    }
  });
}
function lightsTex(src: THREE.CanvasTexture): THREE.CanvasTexture {
  // Емісія лише для освітлених вікон.
  const img = src.image as HTMLCanvasElement;
  return canvasTex(img.width, img.height, (g) => {
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const lit = d.data[i]! > 240 && d.data[i + 2]! < 160;
      if (!lit) { d.data[i] = d.data[i + 1] = d.data[i + 2] = 0; }
    }
    g.putImageData(d, 0, 0);
  });
}

// ---------- Матеріали ----------
const M = {
  asphalt: new THREE.MeshStandardMaterial({ map: asphaltMap, roughnessMap: asphaltRough, roughness: 0.95, metalness: 0 }),
  grass: new THREE.MeshStandardMaterial({ map: grassMap, roughness: 1 }),
  paving: new THREE.MeshStandardMaterial({ map: pavingMap, roughness: 0.9 }),
  curb: new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.8 }),
  paint: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.45, metalness: 0.8 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 }),
  bark: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.9 }),
};

// ---------- Дорога (вул. Мрії): 2+2 смуги по 3.5 м, подвійна суцільна, тротуари ----------
const L = 900, Z0 = 60;
function plane(w: number, l: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m;
}
plane(2000, 2000, M.grass, 0, -0.02, -400);
plane(15, L, M.asphalt, 0, 0, Z0 - L / 2);
for (const s of [-1, 1]) {
  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, L), M.curb);
  curb.position.set(s * 7.62, 0.075, Z0 - L / 2); curb.castShadow = curb.receiveShadow = true; scene.add(curb);
  plane(3.2, L, M.paving, s * 9.35, 0.13, Z0 - L / 2);
}
const paintLine = (x: number, z0: number, z1: number, w = 0.15): void => { plane(w, z1 - z0, M.paint, x, 0.012, (z0 + z1) / 2); };
paintLine(-0.12, Z0 - L, Z0); paintLine(0.12, Z0 - L, Z0);
for (const s of [-1, 1]) paintLine(s * 7.25, Z0 - L, Z0, 0.2);
const CROSS = -38;
for (const s of [-1, 1]) {
  for (let z = Z0; z > Z0 - L; z -= 12) {
    const solid = z < CROSS + 32 && z > CROSS - 4;
    if (!solid && Math.abs(z - CROSS) > 4) paintLine(s * 3.75, z - 3, z);
  }
  paintLine(s * 3.75, CROSS + 2.5, CROSS + 32); // суцільна перед переходом
}
// Зебра і стоп-лінія.
for (let x = -7; x <= 7; x += 1.1) if (Math.abs(x) > 0.4) plane(0.55, 4, M.paint, x, 0.013, CROSS);
plane(7, 0.4, M.paint, 3.75, 0.013, CROSS + 3.4);

// ---------- Будинки: панельки 9–16 поверхів ----------
const bases = ['#e6dfd2', '#d8d4cc', '#e9e2d6', '#cfd3d6', '#e2d6c4'];
function panelBlock(x: number, z: number, w: number, d: number, floors: number, rotY = 0): void {
  const cols = Math.round(w / 2.9);
  const tex = facade(cols, floors, bases[Math.floor(rnd() * bases.length)]!);
  const em = lightsTex(tex);
  const side = facade(Math.round(d / 2.9), floors, '#ddd6ca');
  const mFront = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.85 });
  const mSide = new THREE.MeshStandardMaterial({ map: side, roughness: 0.9 });
  const h = floors * 2.85;
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mSide, mSide, M.roof, M.roof, mFront, mFront]);
  b.position.set(x, h / 2, z); b.rotation.y = rotY; b.castShadow = b.receiveShadow = true; scene.add(b);
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.8, d + 0.3), M.roof);
  parapet.position.set(x, h + 0.4, z); parapet.rotation.y = rotY; parapet.castShadow = true; scene.add(parapet);
}
for (const s of [-1, 1]) {
  let z = 40;
  while (z > -700) {
    const w = R(30, 60), floors = rnd() < 0.5 ? 9 : rnd() < 0.6 ? 12 : 16;
    const rot = rnd() < 0.3 ? Math.PI / 2 : 0;
    const dist = R(24, 40);
    if (rot) panelBlock(s * (dist + w / 2 - 10), z - 6, 12, w, floors, 0);
    else panelBlock(s * (dist + 6), z - w / 2, 12, w, floors, Math.PI / 2);
    z -= w + R(18, 40);
  }
}

// ---------- Дерева: каштани/липи з групи «крапель» ----------
const leafMats = [0x4f7a2e, 0x5d8a35, 0x6b8f3a, 0x3f6b2a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const blob = new THREE.IcosahedronGeometry(1, 4);
{
  const p = blob.attributes['position']!;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (Math.sin(p.getX(i) * 5.1) + Math.cos(p.getY(i) * 4.3) + Math.sin(p.getZ(i) * 6.7)) * 0.07;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  blob.computeVertexNormals();
}
function tree(x: number, z: number, s = 1): void {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 3.2 * s, 7), M.bark);
  trunk.position.y = 1.6 * s; trunk.castShadow = true; g.add(trunk);
  const mat = leafMats[Math.floor(rnd() * leafMats.length)]!;
  for (let i = 0; i < 11; i++) {
    const m = new THREE.Mesh(blob, mat);
    const r = R(1.2, 2.0) * s;
    m.scale.setScalar(r);
    m.position.set(R(-1.3, 1.3) * s, (3.6 + R(0, 2.2)) * s, R(-1.3, 1.3) * s);
    m.castShadow = m.receiveShadow = true; g.add(m);
  }
  g.position.set(x, 0, z); g.rotation.y = R(0, 6); scene.add(g);
}
for (const s of [-1, 1]) for (let z = 30; z > -500; z -= R(9, 14)) if (Math.abs(z - CROSS) > 6) tree(s * R(12.5, 14), z, R(0.9, 1.25));

// ---------- Світлофори, ліхтарі, знак переходу ----------
function trafficLight(x: number, z: number, face: number, state: 'red' | 'green'): void {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 10), M.metal);
  pole.position.y = 1.7; pole.castShadow = true; g.add(pole);
  const head = new THREE.Mesh(new RoundedBoxGeometry(0.42, 1.15, 0.32, 3, 0.06), M.darkMetal);
  head.position.y = 3.7; head.castShadow = true; g.add(head);
  const cols = [0xff2a1a, 0xffb000, 0x22e06a];
  [0.36, 0, -0.36].forEach((dy, i) => {
    const on = (state === 'red' && i === 0) || (state === 'green' && i === 2);
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), new THREE.MeshStandardMaterial({
      color: on ? cols[i] : 0x222222, emissive: on ? cols[i] : 0x000000, emissiveIntensity: on ? 6 : 0, roughness: 0.3,
    }));
    lamp.position.set(0, 3.7 + dy, 0.165); g.add(lamp);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.18, 16, 1, true, -Math.PI / 2, Math.PI), M.darkMetal);
    visor.rotation.x = Math.PI / 2; visor.rotation.y = Math.PI; visor.position.set(0, 3.72 + dy, 0.25); g.add(visor);
  });
  g.position.set(x, 0.13, z); g.rotation.y = face; scene.add(g);
}
trafficLight(8.3, CROSS + 3.2, 0, 'green');
trafficLight(-8.3, CROSS - 3.2, Math.PI, 'red');
function crossingSign(x: number, z: number, face: number): void {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), M.metal);
  pole.position.y = 1.3; g.add(pole);
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.03), new THREE.MeshStandardMaterial({ color: 0x1458c8, roughness: 0.4 }));
  blue.position.y = 2.5; g.add(blue);
  const tri = new THREE.Mesh(new THREE.CircleGeometry(0.26, 3), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  tri.position.set(0, 2.47, 0.02); tri.rotation.z = Math.PI / 2; g.add(tri);
  g.position.set(x, 0.13, z); g.rotation.y = face; g.traverse((o) => { o.castShadow = true; }); scene.add(g);
}
crossingSign(8.2, CROSS + 2.2, 0);
for (const s of [-1, 1]) for (let z = 20; z > -600; z -= 32) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 9, 8), M.metal);
  pole.position.y = 4.5; g.add(pole);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), M.metal);
  arm.rotation.z = Math.PI / 2; arm.position.set(-1.0, 8.9, 0); g.add(arm);
  const lampHead = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.18, 0.32, 2, 0.06), M.darkMetal);
  lampHead.position.set(-2.1, 8.85, 0); g.add(lampHead);
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(s * 8.1, 0.13, z); g.rotation.y = s > 0 ? 0 : Math.PI; scene.add(g);
}

// ---------- Автомобілі: седан з профілю, лак з clearcoat, скло, диски ----------
function car(color: number, x: number, z: number, rotY: number): THREE.Group {
  const g = new THREE.Group();
  const prof = [[-2.25, 0.32], [-2.28, 0.78], [-2.08, 0.99], [2.0, 0.93], [2.3, 0.64], [2.24, 0.32]]; // кузов до лінії вікон
  const sh = new THREE.Shape(); prof.forEach(([a, b], i) => (i ? sh.lineTo(a!, b!) : sh.moveTo(a!, b!)));
  const body = new THREE.ExtrudeGeometry(sh, { depth: 1.66, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.1, bevelSegments: 4, curveSegments: 4 });
  body.translate(0, 0, -0.83);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const bm = new THREE.Mesh(body, paint); bm.castShadow = bm.receiveShadow = true; g.add(bm);
  // Салон: скляна «теплиця» + дах у колір кузова.
  const gp = [[-1.35, 1.02], [-0.85, 1.43], [0.45, 1.46], [1.2, 1.02]];
  const gs = new THREE.Shape(); gp.forEach(([a, b], i) => (i ? gs.lineTo(a!, b!) : gs.moveTo(a!, b!)));
  const glassG = new THREE.ExtrudeGeometry(gs, { depth: 1.52, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3 });
  glassG.translate(0, 0, -0.76);
  const glass = new THREE.Mesh(glassG, new THREE.MeshPhysicalMaterial({ color: 0x101820, metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 }));
  glass.castShadow = true; g.add(glass);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(1.42, 0.07, 1.56, 3, 0.03), paint);
  roof.position.set(-0.2, 1.48, 0); roof.castShadow = true; g.add(roof);
  for (const px of [-1.1, 0.95]) for (const pz of [-0.79, 0.79]) { // стійки
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.06), paint);
    pil.position.set(px, 1.24, pz); pil.rotation.z = px < 0 ? -0.75 : 0.85; g.add(pil);
  }
  const tireM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const rimM = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.25 });
  for (const wx of [-1.42, 1.42]) for (const wz of [-0.86, 0.86]) {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 24), tireM);
    tire.rotation.x = Math.PI / 2; tire.position.set(wx, 0.34, wz); tire.castShadow = true; g.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 12), rimM);
    rim.rotation.x = Math.PI / 2; rim.position.set(wx, 0.34, wz); g.add(rim);
  }
  const tail = new THREE.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xff1a10, emissiveIntensity: 1.6, roughness: 0.3 });
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 1.2, roughness: 0.2 });
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.16, 0.42, 2, 0.03), tail); t.position.set(-2.33, 0.82, s * 0.6); g.add(t);
    const h = new RoundedBoxGeometry(0.06, 0.14, 0.38, 2, 0.03); const hm = new THREE.Mesh(h, head); hm.position.set(2.33, 0.7, s * 0.62); g.add(hm);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.52), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 }));
  plate.position.set(-2.36, 0.5, 0); g.add(plate);
  g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
  return g;
}
// Kenney Car Kit (CC0): .glb вшиті в сторінку як data-URL.
const mgr = new THREE.LoadingManager();
mgr.setURLModifier((u) => (u.includes('colormap') ? colormapUrl : u));
const loader = new GLTFLoader(mgr);
const load = (url: string): Promise<THREE.Group> => new Promise((res, rej) => loader.load(url, (g) => res(g.scene), undefined, rej));
const placed: { url: string; x: number; z: number; ry: number; tint?: number }[] = [
  { url: sedanUrl, x: 5.3, z: 0, ry: Math.PI },
  { url: suvUrl, x: 1.85, z: -24, ry: Math.PI },
  { url: taxiUrl, x: -5.3, z: -70, ry: 0 },
  { url: hatchUrl, x: -1.9, z: -120, ry: 0 },
  { url: vanUrl, x: 5.3, z: -150, ry: Math.PI },
];
const player = new THREE.Group();
const models = await Promise.all(placed.map((p) => load(p.url)));
placed.forEach((p, i) => {
  const m = models[i]!.clone(true);
  const box = new THREE.Box3().setFromObject(m);
  const size = box.getSize(new THREE.Vector3());
  m.scale.setScalar(4.5 / Math.max(size.x, size.z)); // довжина авто 4.5 м
  const b2 = new THREE.Box3().setFromObject(m);
  m.position.y -= b2.min.y;
  m.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) { me.castShadow = me.receiveShadow = true; } });
  const g = new THREE.Group(); g.add(m); g.position.set(p.x, 0, p.z); g.rotation.y = p.ry; scene.add(g);
  if (i === 0) { player.position.copy(g.position); }
});

// Пішоходи на переході (прості фігури).
function person(x: number, z: number, coat: number): void {
  const g = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.7, 4, 8), new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.9 }));
  legs.position.y = 0.5; g.add(legs);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 10), new THREE.MeshStandardMaterial({ color: coat, roughness: 0.85 }));
  torso.position.y = 1.25; g.add(torso);
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), new THREE.MeshStandardMaterial({ color: 0xd9a77f, roughness: 0.7 }));
  headM.position.y = 1.72; g.add(headM);
  g.traverse((o) => { o.castShadow = true; });
  g.position.set(x, 0, z); scene.add(g);
}
person(-4.6, CROSS + 0.3, 0x9c3b2e);
person(-9.4, CROSS - 0.8, 0x2f5f8a);

// ---------- Камера «за машиною» + постобробка ----------
camera.position.set(player.position.x - 0.6, 2.7, player.position.z + 8.2);
camera.lookAt(player.position.x - 0.9, 1.3, player.position.z - 14);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, W, H);
gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1, scale: 1 });
composer.addPass(gtao);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.35, 0.5, 0.92));
composer.addPass(new OutputPass());
for (let i = 0; i < 2; i++) composer.render();
(window as unknown as { __done: boolean }).__done = true;
