// Тренажер маршрутів №1 і №7: 3D-вид (three.js). Керування, HUD і плашки — як у 2D-версії; рушій той самий.
// Камера ззаду-зверху з легким запізненням. Світ будується з sim.net (№7) або sim.data/sim.net (№1) і перебудовується при зміні якості/маршруту.

import './datafetch';
import {
  ACESFilmicToneMapping, Color, DirectionalLight, Fog, HemisphereLight, NoToneMapping, PCFShadowMap, PCFSoftShadowMap,
  Group, MeshPhysicalMaterial, PerspectiveCamera, PMREMGenerator, Scene, SpotLight, Vector2, Vector3, WebGLRenderer, type Material, type Mesh, type Texture,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { wrapAngle } from '../engine/geometry';
import type { Controls, SimEvent } from '../engine/sim7';
import { loadPilot, makeSim, pickRoute, ROUTE_ORDER, routeNo, pressTurn, ROUTE_SHORT, saveRoute, startHintText, turnUi, type AnySim, type Pilot, type PilotFactory, type RouteId } from '../ui-shared/common';
import { Actors } from './actors';
import { loadModels, type Models } from './models';
import { HDRI_HORIZON, HDRI_SUN_DIR, loadPbr, type Pbr } from './pbr';
import { Mirrors } from './mirrors';
import { loadCam, saveCam, CAM_LABEL, type CamMode } from './quality';
import { GB_LABEL, loadGb, saveGb, type Gb } from './quality';
import { loadWeather, saveWeather, WEATHER_GRIP, WEATHER_LABEL, WEATHERS, type Weather } from './quality';
import { WeatherFx } from './weatherfx';
import { CARCOLS, CARCOL_HEX, CARCOL_LABEL, loadCarCol, saveCarCol, type CarCol } from './quality';
import { Interior } from './interior';
import { facadeNight } from './world';
import { CERATO_PAINT, ID4_PAINT } from './id4';
import { loadTod, saveTod, TODS, TOD_LABEL, type Tod } from './quality';
import { ParkSim, PARK_LABEL, type ParkKind } from '../engine/parking';
import { buildParkWorld } from './parking3d';
import { loadQuality, QUALITIES, QUALITY_LABEL, saveQuality, type Quality } from './quality';
import { buildWorld, type World } from './world';
import { buildWorld1 } from './world1';

type Mode = 'learn' | 'exam';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');

// Параметри лише для тестів/знімків (без них нічого не змінюється): ?seed=N, ?auto=1 (автопілот веде учня), ?dbg=1 (window.__dbg), ?paused=1.
const QS = new URLSearchParams(location.search);
const AUTO = QS.get('auto') === '1';
const DBG = AUTO || QS.get('dbg') === '1';

let mode: Mode = 'learn';
let route: RouteId = pickRoute();
import { Sound } from '../ui-shared/audio';
const sound = new Sound();
let weather: Weather = loadWeather();
let gbMode: Gb = loadGb();
let tod: Tod = loadTod();
let carCol: CarCol = loadCarCol();
let sim: AnySim = newSim();
let keys = { gas: false, brake: false, clutch: false };
let paused = QS.get('paused') === '1';
let toastT = 0;
let pilotMake: PilotFactory | null = null;
let pilot: Pilot | null = null;
let pilotFor: AnySim | null = null;
if (AUTO) void loadPilot().then((f) => { pilotMake = f; });

function newSim(): AnySim {
  const s = makeSim(route, mode, QS.get('seed'));
  s.gb.setManual(gbMode === 'manual');
  s.setGrip(WEATHER_GRIP[weather]);
  return s;
}

// Керування на крок: автопілот (лише ?auto=1) або кнопки.
function controls(): Controls {
  if (!AUTO || !pilotMake) return keys;
  if (pilotFor !== sim) { pilot = pilotMake(sim); pilotFor = sim; }
  return pilot!.controls(sim.cfg.dt);
}

function restart(): void {
  if (park) { startPark(park.kind); return; }
  const rebuild = world !== null && world.route !== route;
  sim = newSim();
  actors?.reset();
  if (rebuild) rebuildWorld();
  syncRoute();
  camInit = false;
  keys = { gas: false, brake: false, clutch: false };
  paused = false;
  $('pause').textContent = '❚❚';
  $('result').hidden = true;
  $('toast').hidden = true;
  syncModeButtons();
  startHint();
}

function startHint(): void {
  if (mode === 'learn') toast(startHintText(route), 'hint');
}

// ---------- 3D сцена ----------

const SKY = 0xa9dcf5;
const HAZE = new Color().setRGB(HDRI_HORIZON[0], HDRI_HORIZON[1], HDRI_HORIZON[2]); // колір горизонту HDRI (туман)
const devDpr = Math.min(window.devicePixelRatio || 1, 2);
let dpr = devDpr;
let quality: Quality = loadQuality();
const renderer = new WebGLRenderer({ canvas, antialias: devDpr < 2, powerPreference: 'high-performance' });
const scene = new Scene();
const camera = new PerspectiveCamera(62, 1, 0.6, 260);
const hemi = new HemisphereLight(0xdff1ff, 0x8aa27a, 1.5);
const sun = new DirectionalLight(0xfff1d6, 2.2);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
scene.add(hemi, sun, sun.target);
const mirrors = new Mirrors(renderer, scene, $('stage'));

// Середня/висока: HDRI Poly Haven як фон і PMREM-середовище (один раз), сонце — за напрямком у HDRI. Висока ще й ACES + GTAO + bloom.
const sunOff = new Vector3(28, 55, 18);
let pbr: Pbr | null = null;
let envTex: Texture | null = null;
let composer: EffectComposer | null = null;

function ensureEnv(): void {
  if (envTex || !pbr) return;
  const pmrem = new PMREMGenerator(renderer);
  envTex = pmrem.fromEquirectangular(pbr.sky).texture;
  pmrem.dispose();
}

// Фото-ресурси вантажимо лише для середньої/високої (на низькій вони не потрібні). Помилка = запасні процедурні текстури й колір неба.
async function ensurePbr(): Promise<void> {
  if (pbr) return;
  try { pbr = await loadPbr(Math.min(8, renderer.capabilities.getMaxAnisotropy())); } catch (e) { console.error('Не вдалося завантажити Poly Haven', e); }
}

function ensureComposer(): EffectComposer {
  if (composer) return composer;
  const c = new EffectComposer(renderer);
  c.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 100, 100);
  gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.4, thickness: 1, scale: 1 });
  c.addPass(gtao);
  c.addPass(new UnrealBloomPass(new Vector2(100, 100), 0.3, 0.5, 0.95));
  c.addPass(new OutputPass());
  composer = c;
  return c;
}

let world: (World & { route: RouteId }) | null = null;
let actors: Actors | null = null;
let models: Models | null = null;

// Погода: «Туман» — сіра дымка, видимість ~55 м, приглушене сонце (лише вигляд; на правила не впливає).
const wfx = new WeatherFx();
scene.add(wfx.group);
function applyWeather(): void {
  applyWeatherBase();
  applyTod();
}
function applyWeatherBase(): void {
  $('wx').textContent = `Погода: ${WEATHER_LABEL[weather]}`;
  sound.setWeather(weather);
  sim.setGrip(WEATHER_GRIP[weather]);
  park?.setGrip(WEATHER_GRIP[weather]);
  wfx.set(weather, quality === 'low');
  if (weather === 'clear') return;
  const sky: Record<string, [number, number, number, number]> = { // колір, туман near/far (середня+), приглушення сонця
    fog: [0xc4cbd2, 4, 58, 0.35], rain: [0x7d8793, 6, 80, 0.3], snow: [0xdde3e8, 4, 62, 0.45], ice: [0xbfd3e2, 10, 110, 0.6],
  };
  const [c, near, far, sunK] = sky[weather]!;
  const col = new Color(c);
  scene.background = col;
  scene.fog = new Fog(col, near, quality === 'low' ? far * 0.72 : far);
  scene.environmentIntensity *= 0.55 + (weather === 'ice' ? 0.2 : 0);
  sun.intensity *= sunK; hemi.intensity = Math.max(hemi.intensity, 1.1);
  camera.far = Math.min(camera.far, 140);
}

// Фари гравця: два прожектори, їдуть за авто (лише ввечері й уночі).
const headlights = new Group();
const spots: SpotLight[] = [];
for (let i = 0; i < 2; i++) {
  const sp = new SpotLight(0xfff0d6, 380, 70, 0.5, 0.65, 1.4);
  sp.castShadow = false; headlights.add(sp, sp.target); spots.push(sp);
}
headlights.visible = false;
scene.add(headlights);
function updateHeadlights(p: { x: number; z: number; a: number }): void {
  if (!headlights.visible) return;
  const hx = Math.sin(p.a), hz = -Math.cos(p.a), rx = Math.cos(p.a), rz = Math.sin(p.a);
  spots.forEach((sp, i) => {
    const lat = i === 0 ? -0.62 : 0.62;
    sp.position.set(p.x + hx * 2.0 + rx * lat, 0.72, p.z + hz * 2.0 + rz * lat);
    sp.target.position.set(p.x + hx * 22 + rx * lat * 1.6, 0, p.z + hz * 22 + rz * lat * 1.6);
    sp.target.updateMatrixWorld();
  });
}
// Час доби накладається поверх погоди: колір неба/туману, світло сонця/місяця, фари.
function applyTod(): void {
  $('tod').textContent = `Час: ${TOD_LABEL[tod]}`;
  headlights.visible = tod !== 'day';
  facadeNight.value = tod === 'night' ? 1 : tod === 'evening' ? 0.5 : 0;
  world?.setNight(tod !== 'day');
  if (actors) actors.night = tod !== 'day';
  if (tod === 'day') return;
  const night = tod === 'night';
  const fog = scene.fog as Fog | null;
  const far = Math.min(fog?.far ?? 160, night ? 95 : 170);
  const wx = scene.background instanceof Color ? scene.background : HAZE;
  const tint = new Color(night ? 0x0a1022 : 0xe8a679).lerp(wx, weather === 'clear' ? 0 : night ? 0.12 : 0.35);
  scene.background = tint;
  scene.fog = new Fog(tint, night ? 6 : 14, far);
  scene.environmentIntensity = night ? 0.03 : 0.3;
  sun.color.set(night ? 0x7f97d8 : 0xff9a4d); sun.intensity = night ? 0.3 : 1.8;
  sunOff.set(night ? -25 : 70, night ? 45 : 16, night ? -30 : 40);
  hemi.color.set(night ? 0x2b3d6b : 0xffcfa6); hemi.groundColor.set(night ? 0x0b0f18 : 0x5a4a40);
  hemi.intensity = night ? 1.1 : 0.9;
  camera.far = Math.min(camera.far, 260);
}

function applyQuality(q: Quality): void {
  quality = q;
  if (actors) actors.quality = q;
  const hi = q === 'high', lo = q === 'low';
  dpr = lo ? 1 : devDpr;
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = !lo;
  renderer.shadowMap.type = hi ? PCFSoftShadowMap : PCFShadowMap;
  renderer.toneMapping = hi ? ACESFilmicToneMapping : NoToneMapping;
  renderer.toneMappingExposure = hi ? 0.95 : 0.5;
  sun.castShadow = !lo;
  const SH = hi ? 46 : 42, ms = hi ? 2048 : 1024;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 190 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.mapSize.set(ms, ms);
  sun.shadow.map?.dispose(); sun.shadow.map = null;
  if (!lo && pbr) {
    ensureEnv();
    scene.background = pbr.sky;
    scene.environment = envTex;
    scene.fog = hi ? new Fog(HAZE, 80, 300) : new Fog(HAZE, 45, 150);
    scene.environmentIntensity = hi ? 0.6 : 0.7;
    camera.far = hi ? 520 : 260;
    sun.color.set(0xfff0dc); sun.intensity = hi ? 3.0 : 2.4; hemi.intensity = hi ? 0.35 : 0.8;
    sunOff.copy(HDRI_SUN_DIR).multiplyScalar(90);
  } else {
    scene.background = new Color(SKY);
    scene.environment = null;
    scene.fog = lo ? new Fog(SKY, 25, 90) : new Fog(SKY, 45, 150);
    camera.far = lo ? 110 : 260;
    sun.color.set(0xfff1d6); sun.intensity = 2.2; hemi.intensity = 1.5;
    sunOff.set(28, 55, 18);
  }
  applyWeather();
  camera.updateProjectionMatrix();
  if (hi) sizeComposer(); else if (composer) { composer.dispose(); composer = null; }
  if (models) rebuildWorld();
  if (park) { remakeParkWorld(); if (world) world.group.visible = false; }
  scene.traverse((o) => { // зміна тіней/тон-мапінгу потребує перекомпіляції шейдерів
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (m) for (const mt of Array.isArray(m) ? m : [m]) mt.needsUpdate = true;
  });
  $('qual').textContent = `Якість: ${QUALITY_LABEL[q]}`;
  applyCarColor();
}

let buildMs = 0;
let worldVerts = 0;
// Світ будується під маршрут поточного рушія (№1: комірки з OSM; №7: схематична вулиця).
function rebuildWorld(): void {
  if (!models) return;
  if (world) { scene.remove(world.group); world.dispose(); }
  const t0 = performance.now();
  const w = sim.route !== 'route7' ? buildWorld1(sim, quality, models, pbr) : buildWorld(sim, quality, models, pbr);
  buildMs = performance.now() - t0;
  worldVerts = 0;
  w.group.traverse((o) => { const m = o as Mesh; if (m.isMesh) worldVerts += (m.geometry.getAttribute('position')?.count ?? 0); });
  world = Object.assign(w, { route: sim.route });
  w.setNight(tod !== 'day');
  scene.add(world.group);
  scene.traverse((o) => { // нові матеріали потребують компіляції під поточні тіні/тон-мапінг
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (m) for (const mt of Array.isArray(m) ? m : [m]) mt.needsUpdate = true;
  });
}

function sizeComposer(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!composer && quality !== 'high') return;
  const c = ensureComposer();
  c.setPixelRatio(dpr);
  if (w && h) c.setSize(w, h);
}

let fovBase = 58;
let camMode: CamMode = loadCam();
function resize(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    // У вузькому портреті піднімаємо вертикальний FOV, щоб не було «тунелю».
    fovBase = camera.aspect < 0.75 ? 68 : 58;
    camera.fov = fovBase + (camMode === 'cockpit' ? 8 : 0);
    camera.updateProjectionMatrix();
  }
  mirrors.layout(w, h);
}

// Камера: згладжені позиція і курс.
const DEBUG_TOP = Number(new URLSearchParams(location.search).get('top')) || 0; // ?top=80 — вид зверху для налагодження
let camInit = false;
let cx = 0, cz = 0, cyaw = 0;
let camOverride: { p: [number, number, number]; l: [number, number, number] } | null = null; // лише ?dbg=1
const CAM_BACK = 8.5, CAM_UP = 4.2, LOOK_AHEAD = 7;
// Обертання камери пальцем/мишею: «хапаємо» сцену. Ззаду — орбіта навколо авто, у салоні — поворот голови. Після відпускання повертається.
let tgtYaw = 0, tgtPitch = 0, offYaw = 0, offPitch = 0;
// Згладжена поза гравця для вигляду (камера, дзеркала, салон, фари, модель авто): курс рушія змінюється ривками на вершинах доріг.
const sp = { x: 0, z: 0, a: 0, init: false };
function smoothPlayer(dt: number): typeof sp {
  const r = park ? park.player : sim.player;
  if (!camInit) sp.init = false;
  if (!sp.init) { sp.a = r.a; sp.init = true; }
  sp.x = r.x; sp.z = r.z;
  if (dt > 0) sp.a += wrapAngle(r.a - sp.a) * (1 - Math.exp(-dt * 12));
  return sp;
}
function updateCamera(dt: number): void {
  const p = sp;
  if (!camInit) { cx = p.x; cz = p.z; cyaw = p.a; camInit = true; }
  const kp = 1 - Math.exp(-dt * 9), ky = 1 - Math.exp(-dt * 3.2), ko = 1 - Math.exp(-dt * 6);
  cx += (p.x - cx) * kp;
  cz += (p.z - cz) * kp;
  cyaw += wrapAngle(p.a - cyaw) * ky;
  offYaw += (tgtYaw - offYaw) * ko; offPitch += (tgtPitch - offPitch) * ko;
  const hx = Math.sin(cyaw), hz = -Math.cos(cyaw);
  const wantFov = fovBase + (camMode === 'cockpit' ? 8 : 0), wantNear = camMode === 'cockpit' && !park ? 0.15 : 0.6;
  if (camera.fov !== wantFov || camera.near !== wantNear) { camera.fov = wantFov; camera.near = wantNear; camera.updateProjectionMatrix(); }
  camera.up.set(0, 1, 0);
  if (park && parkTop) {
    camera.position.set(cx, park.kind === 'garage' ? 27 : park.kind === 'turn' ? 22 : 24, cz + 0.01);
    camera.up.set(0, 0, -1);
    camera.lookAt(cx, 0, cz);
  } else if (camOverride) {
    camera.position.set(...camOverride.p);
    camera.lookAt(...camOverride.l);
  } else if (DEBUG_TOP) {
    camera.position.set(cx, DEBUG_TOP, cz + 0.01);
    camera.up.set(0, 0, -1);
    camera.lookAt(cx, 0, cz);
  } else if (camMode === 'cockpit') {
    // Око водія: ліворуч від осі, трохи вперед; голову можна повертати
    const ph = Math.sin(p.a), pv = -Math.cos(p.a);
    camera.position.set(p.x + ph * 0.25 - Math.cos(p.a) * 0.38, 1.2, p.z + pv * 0.25 - Math.sin(p.a) * 0.38);
    const ya = p.a + offYaw, pt = offPitch;
    camera.lookAt(camera.position.x + Math.sin(ya) * Math.cos(pt) * 20, 1.2 + Math.sin(pt) * 20, camera.position.z - Math.cos(ya) * Math.cos(pt) * 20);
  } else {
    const dist = Math.hypot(CAM_BACK, CAM_UP), el = Math.min(1.4, Math.max(0.05, Math.atan2(CAM_UP, CAM_BACK) + offPitch));
    const ya = cyaw + offYaw;
    camera.position.set(cx - Math.sin(ya) * dist * Math.cos(el), dist * Math.sin(el), cz + Math.cos(ya) * dist * Math.cos(el));
    const k = Math.min(1, (Math.abs(offYaw) + Math.abs(offPitch)) / 0.4); // при обертанні дивимось на авто, а не вперед
    camera.lookAt(cx + hx * LOOK_AHEAD * (1 - k), 0.8 + 0.4 * k, cz + hz * LOOK_AHEAD * (1 - k));
  }
  sun.position.set(p.x + sunOff.x, sunOff.y, p.z + sunOff.z);
  sun.target.position.set(p.x, 0, p.z);
  sun.target.updateMatrixWorld();
}

// ---------- HUD ----------

function hud(): void {
  if (park) { parkHud(); return; }
  gbHud(sim.gb);
  $('speed').textContent = String(Math.round(sim.v * 3.6));
  const n = sim.next;
  $('next').textContent = n.dist > 1 ? `Далі: ${n.text} · ${Math.round(n.dist)} м` : `Далі: ${n.text}`;
  $('faults').textContent = `⚠ ${sim.minorCount}/${sim.cfg.rules.maxMinorFaults}${mode === 'exam' ? ' іспит' : ''}`;
  $('faults').classList.toggle('warn', sim.minorCount > 0);
  const tu = turnUi(sim);
  $('turn').hidden = tu.split; $('turnL').hidden = $('turnR').hidden = !tu.split;
  if (tu.split) { $('turnL').textContent = '◀ ' + tu.left; $('turnR').textContent = tu.right + ' ▶'; } else $('turn').textContent = tu.label;
  $('turnL').classList.toggle('armed', tu.armedL); $('turnR').classList.toggle('armed', tu.armedR);
  $('sigL').classList.toggle('on', sim.sig === -1 && Math.floor(sim.player.sigT * 3) % 2 === 0);
  $('sigR').classList.toggle('on', sim.sig === 1 && Math.floor(sim.player.sigT * 3) % 2 === 0);
  $('sigL').classList.toggle('armed', sim.sig === -1);
  $('sigR').classList.toggle('armed', sim.sig === 1);
  $('turn').classList.toggle('armed', tu.armed);
  $('speed').classList.toggle('over', sim.v * 3.6 > sim.cfg.rules.speedLimitKmh);
}

function toast(text: string, kind: 'fault' | 'hint' | 'info'): void {
  const el = $('toast');
  el.textContent = text;
  el.className = kind;
  el.hidden = false;
  toastT = kind === 'hint' ? 6 : 3.5;
}

function onEvents(evs: SimEvent[]): void {
  for (const e of evs) {
    if (e.type === 'fault') sound.fault(e.fault);
    else if (e.type === 'finish') sound.finish(e.result.passed);
    if (e.type === 'fault') toast(`${e.fault.severity === 'serious' ? '⛔ ' : '⚠ '}${e.fault.message}`, 'fault');
    else if (e.type === 'hint') toast(e.text, 'hint');
    else if (e.type === 'info') toast(e.text, 'info');
    else if (e.type === 'finish') showResult();
  }
}

function fmt(t: number): string {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showResult(): void {
  const r = sim.result!;
  $('resTitle').textContent = r.passed ? 'Склав' : 'Не склав';
  $('resTitle').className = r.passed ? 'ok' : 'bad';
  $('resReason').textContent = `${r.reason} · час ${fmt(r.time)}`;
  const list = $('resList');
  list.innerHTML = '';
  if (!r.faults.length) list.innerHTML = '<li>Без зауважень</li>';
  for (const f of r.faults) {
    const li = document.createElement('li');
    li.textContent = `${fmt(f.t)} — ${f.message}${f.severity === 'serious' ? ' (груба)' : ''}`;
    list.appendChild(li);
  }
  $('result').hidden = false;
  reportResult(r);
}

// Якщо тренажер відкрито в застосунку (iframe), передаємо результат сторінці-обгортці — вона збереже його в базі.
function reportResult(r: NonNullable<AnySim['result']>): void {
  if (AUTO || window.parent === window) return;
  try {
    window.parent.postMessage({
      type: 'route-trainer-result',
      v: 1,
      route: routeNo(route),
      mode,
      passed: r.passed,
      reason: String(r.reason).slice(0, 160),
      time: Math.round(r.time),
      minor: r.minor,
      faults: r.faults.slice(0, 30).map((f) => ({ code: f.code, severity: f.severity, message: String(f.message).slice(0, 120), t: Math.round(f.t) })),
      at: Date.now(),
    }, window.location.origin);
  } catch { /* батьківська сторінка недоступна */ }
}

// ---------- Колір кузова, салон ----------
const interior = new Interior();
scene.add(interior.group);
let steerVis = 0, prevA = 0;
const wob = { yaw: 0, vel: 0, dir: 1 };
function applyCarColor(): void {
  if (!models) return;
  for (const [m, def] of [[models.id4, ID4_PAINT], [models.cerato, CERATO_PAINT]] as const) {
    const mats = m.mat as MeshPhysicalMaterial[];
    const col = carCol === 'default' ? def : CARCOL_HEX[carCol];
    mats[0]!.color.set(col);
    // Без HDRI (низька якість) лак виглядає тьмяно: додаємо трохи власного світіння фарби й скла.
    mats[0]!.emissive.set(col).multiplyScalar(quality === 'low' ? 0.2 : 0);
    mats[1]!.emissive.set(quality === 'low' ? 0x142234 : 0x000000);
  }
  $('col').textContent = `Колір: ${CARCOL_LABEL[carCol]}`;
}

// ---------- Коробка передач ----------
let lastNote = '';
function gbHud(gb: { manual: boolean; label: string; rpm: number; stalled: boolean; note: string }): void {
  const man = gb.manual;
  $('pad').classList.toggle('man', man);
  $('gb').textContent = `Коробка: ${GB_LABEL[gbMode]}`;
  if (!man) { lastNote = ''; return; }
  $('gInd').textContent = gb.stalled ? 'ЗАГЛУХ' : `${gb.label} · ${(gb.rpm / 1000).toFixed(1).replace('.', ',')}k`;
  $('gInd').classList.toggle('stall', gb.stalled);
  if (gb.note && gb.note !== lastNote) toast(gb.note, 'fault');
  lastNote = gb.note;
}
function applyGb(): void {
  const man = gbMode === 'manual';
  sim.gb.setManual(man);
  park?.gb.setManual(man);
  setReverse(false);
}
const shiftBy = (d: 1 | -1): void => { (park ? park.gb : sim.gb).shift(d); };

// ---------- Парковка ----------
let park: ParkSim | null = null;
let parkWorld: { group: import('three').Group; dispose: () => void } | null = null;
let parkTop = true;
let steerVal = 0, reverse = false;
const wheelEl = $('wheel');
let wheelHeld = false; // кермо тримають пальцем — самоповернення не діє
const WHEEL_LOCK = 210; // градусів повороту керма до упору в кожен бік
function setSteer(v: number): void {
  steerVal = Math.max(-1, Math.min(1, v));
  wheelEl.style.transform = `rotate(${(steerVal * WHEEL_LOCK).toFixed(1)}deg)`;
  wheelEl.setAttribute('aria-valuenow', String(Math.round(steerVal * 100)));
}
{ // кермо крутиться пальцем: кут беремо від центру колеса, зміна кута додається до поточного повороту
  let drag: { id: number; last: number } | null = null;
  const ang = (e: PointerEvent): number => { const r = wheelEl.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
  wheelEl.addEventListener('pointerdown', (e) => { e.preventDefault(); drag = { id: e.pointerId, last: ang(e) }; wheelHeld = true; wheelEl.setPointerCapture(e.pointerId); });
  wheelEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const a = ang(e); let d = a - drag.last; drag.last = a;
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    setSteer(steerVal + (d * 180 / Math.PI) / WHEEL_LOCK);
  });
  const end = (e: PointerEvent): void => { if (drag && e.pointerId === drag.id) { drag = null; wheelHeld = false; } };
  wheelEl.addEventListener('pointerup', end); wheelEl.addEventListener('pointercancel', end);
}
function syncGear(): void { $('gear').textContent = reverse ? 'Назад (Р)' : 'Вперед'; $('gear').classList.toggle('rev', reverse); }
function setReverse(b: boolean): void { reverse = b; syncGear(); }

function remakeParkWorld(): void {
  if (!park) return;
  if (parkWorld) { scene.remove(parkWorld.group); parkWorld.dispose(); }
  parkWorld = buildParkWorld(park, models, pbr, quality);
  scene.add(parkWorld.group);
  scene.traverse((o) => { const m = (o as Mesh).material as Material | Material[] | undefined; if (m) for (const mt of Array.isArray(m) ? m : [m]) mt.needsUpdate = true; });
}
function startPark(kind: ParkKind): void {
  if (!models || !actors) return;
  if (world) world.group.visible = false;
  if (parkWorld) { scene.remove(parkWorld.group); parkWorld.dispose(); }
  park = new ParkSim(kind);
  park.setGrip(WEATHER_GRIP[weather]);
  park.gb.setManual(gbMode === 'manual');
  remakeParkWorld();
  actors.reset();
  keys = { gas: false, brake: false, clutch: false };
  setSteer(0); setReverse(false);
  camInit = false; paused = false;
  $('pause').textContent = '❚❚';
  $('result').hidden = true;
  $('pad').classList.add('park');
  mirrors.setHidden(true);
  $('rt').textContent = 'Парковка ▾';
  $('osm').hidden = true;
  $('mLearn').hidden = $('mExam').hidden = true;
  syncCam();
  toast(park.layout.hint, 'hint');
}
function exitPark(): void {
  if (parkWorld) { scene.remove(parkWorld.group); parkWorld.dispose(); parkWorld = null; }
  park = null;
  if (world) world.group.visible = true;
  actors?.reset();
  $('pad').classList.remove('park');
  mirrors.setHidden(false);
  $('mLearn').hidden = $('mExam').hidden = false;
  syncCam();
}
function parkHud(): void {
  const k = park!;
  gbHud(k.gb);
  $('speed').textContent = String(Math.round(Math.abs(k.v) * 3.6));
  $('speed').classList.remove('over');
  const m = k.metrics;
  const cur = m.curb !== null ? ` · до бордюру ${m.curb.toFixed(1).replace('.', ',')} м` : '';
  $('next').textContent = `${PARK_LABEL[k.kind]} · кут ${Math.round(Math.abs(m.angle))}°${cur}`;
  $('faults').textContent = `Поправок ${k.corrections}`;
  $('faults').classList.remove('warn');
  $('gear').classList.toggle('rev', reverse);
}
function showParkResult(): void {
  const r = park!.result!;
  sound.finish(r.passed);
  $('resTitle').textContent = r.passed ? (park!.kind === 'turn' ? 'Розвернулись' : 'Припарковано') : 'Не вийшло';
  $('resTitle').className = r.passed ? 'ok' : 'bad';
  $('resReason').textContent = `${r.reason} · час ${fmt(r.time)}`;
  $('resList').innerHTML = '';
  $('result').hidden = false;
}

// ---------- Керування ----------

function hold(id: string, key: 'gas' | 'brake' | 'clutch'): void {
  const b = $(id);
  const on = (e: Event): void => { e.preventDefault(); keys[key] = true; b.classList.add('down'); };
  const off = (): void => { keys[key] = false; b.classList.remove('down'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointerleave', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}
function tap(id: string, fn: () => void): void {
  $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
}

hold('gas', 'gas');
hold('brake', 'brake');
hold('clutch', 'clutch');
tap('sigL', () => sim.toggleSignal(-1));
tap('sigR', () => sim.toggleSignal(1));
tap('laneL', () => sim.changeLane(-1));
tap('laneR', () => sim.changeLane(1));
tap('turn', () => pressTurn(sim, 0));
tap('turnL', () => pressTurn(sim, -1));
tap('turnR', () => pressTurn(sim, 1));
tap('again', restart);
tap('gb', () => { gbMode = gbMode === 'auto' ? 'manual' : 'auto'; saveGb(gbMode); applyGb(); });
tap('gUp', () => shiftBy(1));
tap('gDn', () => shiftBy(-1));
tap('steer0', () => setSteer(0));
tap('gear', () => setReverse(!reverse));
tap('goParallel', () => { startPark('parallel'); });
tap('goGarage', () => { startPark('garage'); });
tap('goTurn', () => { startPark('turn'); });
tap('restart', restart);
const syncSound = (): void => { $('sound').textContent = sound.muted ? '🔇' : '🔊'; };
tap('sound', () => { sound.unlock(); sound.setMuted(!sound.muted); syncSound(); });
syncSound();
window.addEventListener('pointerdown', () => sound.unlock(), { passive: true });
window.addEventListener('keydown', () => sound.unlock());
tap('pause', () => { paused = !paused; $('pause').textContent = paused ? '▶' : '❚❚'; });
tap('mLearn', () => { mode = 'learn'; restart(); });
tap('mExam', () => { mode = 'exam'; restart(); });
function syncCam(): void { $('cam').textContent = park ? `Камера: ${parkTop ? 'Зверху' : 'Ззаду'}` : `Камера: ${CAM_LABEL[camMode]}`; }
tap('cam', () => {
  if (park) { parkTop = !parkTop; tgtYaw = tgtPitch = offYaw = offPitch = 0; syncCam(); return; } camMode = camMode === 'chase' ? 'cockpit' : 'chase'; saveCam(camMode); tgtYaw = tgtPitch = offYaw = offPitch = 0; syncCam(); });
syncCam();
{ // перетягування по сцені: обертання камери (лише по полотну; кнопки пульта не зачіпає)
  let drag: { id: number; x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (camMode === 'cockpit') { tgtYaw = Math.max(-2.2, Math.min(2.2, tgtYaw - dx * 0.006)); tgtPitch = Math.max(-0.5, Math.min(0.5, tgtPitch + dy * 0.004)); }
    else { tgtYaw = Math.max(-Math.PI, Math.min(Math.PI, tgtYaw + dx * 0.008)); tgtPitch = Math.max(-0.5, Math.min(1.0, tgtPitch + dy * 0.006)); }
  });
  const end = (e: PointerEvent): void => { if (drag && e.pointerId === drag.id) { drag = null; tgtYaw = 0; tgtPitch = 0; } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
}
tap('col', () => { carCol = CARCOLS[(CARCOLS.indexOf(carCol) + 1) % CARCOLS.length]!; saveCarCol(carCol); applyCarColor(); });
$('cfg').addEventListener('click', () => { const p = $('cfgPanel'); p.hidden = !p.hidden; });
tap('tod', () => {
  tod = TODS[(TODS.indexOf(tod) + 1) % TODS.length]!;
  saveTod(tod);
  applyQuality(quality);
});
tap('wx', () => {
  weather = WEATHERS[(WEATHERS.indexOf(weather) + 1) % WEATHERS.length]!;
  saveWeather(weather);
  applyQuality(quality);
  const g = WEATHER_GRIP[weather];
  if (g < 1) toast(`${WEATHER_LABEL[weather]}: зчеплення ${Math.round(g * 100)}% — гальмуйте заздалегідь`, 'hint');
});
tap('qual', () => {
  const q = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]!;
  saveQuality(q);
  if (q !== 'low' && !pbr) void ensurePbr().then(() => applyQuality(q)); else applyQuality(q);
});

// ---------- Вибір маршруту ----------
let pausedBeforePick = false;
function syncRoute(): void {
  if (park) { $('rt').textContent = 'Парковка ▾'; return; }
  $('rt').textContent = ROUTE_SHORT[route] + ' ▾';
  $('osm').hidden = route === 'route7';
  for (const r of ROUTE_ORDER) $('pick-' + r).classList.toggle('cur', r === route);
}
function openPicker(open: boolean): void {
  if (open === !$('picker').hidden) return;
  $('picker').hidden = !open;
  if (open) { pausedBeforePick = paused; paused = true; } else paused = pausedBeforePick;
}
function setRoute(r: RouteId): void {
  openPicker(false);
  if (park) { exitPark(); route = r; saveRoute(r); restart(); return; }
  if (r === route) return;
  route = r;
  saveRoute(r);
  restart(); // новий сід (якщо не заданий ?seed=), світ перебудовується
}
$('rt').addEventListener('click', () => openPicker(true)); // click (як і вибір пункту): інакше «привидний» click після pointerdown одразу обирає пункт під пальцем
$('pickClose').addEventListener('click', () => openPicker(false));
$('pick-parallel').addEventListener('click', () => { openPicker(false); startPark('parallel'); });
$('pick-garage').addEventListener('click', () => { openPicker(false); startPark('garage'); });
$('pick-turn').addEventListener('click', () => { openPicker(false); startPark('turn'); });
for (const r of ROUTE_ORDER) $('pick-' + r).addEventListener('click', () => setRoute(r)); // click, не pointerdown: інакше дотик при прокрутці списку одразу обирає маршрут

function syncModeButtons(): void {
  $('mLearn').classList.toggle('armed', mode === 'learn');
  $('mExam').classList.toggle('armed', mode === 'exam');
}

const KEYMAP: Record<string, () => void> = {
  KeyQ: () => sim.toggleSignal(-1), KeyE: () => sim.toggleSignal(1),
  KeyA: () => sim.changeLane(-1), KeyD: () => sim.changeLane(1), Space: () => pressTurn(sim, 0),
  KeyZ: () => pressTurn(sim, -1), KeyC: () => pressTurn(sim, 1),
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyX') { keys.clutch = true; $('clutch').classList.add('down'); }
  else if (!e.repeat && e.code === 'KeyW') shiftBy(1);
  else if (!e.repeat && e.code === 'KeyS') shiftBy(-1);
  else if (park && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) setSteer(steerVal + (e.code === 'ArrowLeft' ? -0.15 : 0.15));
  else if (park && e.code === 'KeyR') { if (!e.repeat) setReverse(!reverse); }
  else if (e.code === 'ArrowUp') keys.gas = true;
  else if (e.code === 'ArrowDown') keys.brake = true;
  else if (!e.repeat && KEYMAP[e.code]) KEYMAP[e.code]!();
  else return;
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyX') { keys.clutch = false; $('clutch').classList.remove('down'); }
  if (e.code === 'ArrowUp') keys.gas = false;
  if (e.code === 'ArrowDown') keys.brake = false;
});

// ---------- Адаптивна роздільність ----------
// Якщо кадри повільні (слабкий телефон), знижуємо роздільність малювання (не нижче 0,7), коли швидкі — підвищуємо назад.
let ema = 1 / 60, adaptN = 0;
function adaptDpr(dt: number): void {
  if (DBG || quality === 'low' || document.visibilityState !== 'visible' || dt <= 0) return;
  ema += (Math.min(dt, 0.1) - ema) * 0.05;
  if (++adaptN % 90 !== 0) return;
  let d = dpr;
  if (ema > 1 / 38 && dpr > 0.71) d = Math.max(0.7, dpr - 0.25);
  else if (ema < 1 / 56 && dpr < devDpr) d = Math.min(devDpr, dpr + 0.25);
  if (d === dpr) return;
  dpr = d;
  renderer.setPixelRatio(dpr);
  composer?.setPixelRatio(dpr);
}

// ---------- Цикл ----------

let last = performance.now();
let acc = 0;
let frameNo = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (park) {
    if (!paused && !park.result) {
      // Самоповернення керма: кермо випрямляється тим швидше, чим швидше їде авто (як у реальному авто); на місці не вертається.
      if (!wheelHeld && steerVal !== 0) {
        const back = Math.min(1.6, Math.max(0, Math.abs(park.v) - 0.15) * 0.55) * dt;
        setSteer(Math.abs(steerVal) <= back ? 0 : steerVal - Math.sign(steerVal) * back);
      }
      acc += dt;
      while (acc >= park.cfg.dt) { park.step({ gas: keys.gas, brake: keys.brake, clutch: keys.clutch, steer: steerVal, reverse }, park.cfg.dt); acc -= park.cfg.dt; if (park.result) { showParkResult(); break; } }
    }
  } else if (!paused && !sim.result) {
    acc += dt;
    const step = sim.cfg.dt;
    while (acc >= step) {
      onEvents(sim.step(controls(), step));
      acc -= step;
      if (sim.result) break;
    }
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').hidden = true; }
  resize();
  smoothPlayer(dt);
  { // Занос при гальмуванні на слизькій дорозі (лише вигляд): авто «виляє» кормою, тим сильніше, чим швидше і слизькіше.
    const src = park ?? sim, g = src.grip, v = Math.abs(src.player.v);
    if (g < 0.55 && src.player.braking && v > 6) wob.vel += wob.dir * (1 - g) * Math.min(1.6, v / 14) * 7 * dt;
    else if (v < 1.5) wob.vel *= 0.9;
    wob.vel += (-wob.yaw * 38 - wob.vel * 3.2) * dt; wob.yaw += wob.vel * dt;
    if (Math.abs(wob.yaw) < 0.002 && !src.player.braking) wob.dir = Math.random() < 0.5 ? -1 : 1;
    wob.yaw = Math.max(-0.35, Math.min(0.35, wob.yaw));
  }
  actors!.playerYaw = sp.a + wob.yaw;
  updateCamera(dt);
  {
    const pl = park ? park.player : sim.player, g = park ? park.gb : sim.gb;
    const yaw = dt > 0 ? wrapAngle(sp.a - prevA) / dt : 0; prevA = sp.a;
    const tgt = park ? park.wheel : Math.max(-1, Math.min(1, yaw * 1.1));
    steerVis += (tgt - steerVis) * (1 - Math.exp(-dt * 8));
    const gaugeData = { speed: Math.abs(pl.v) * 3.6, rpm: g.rpm, manual: g.manual, gear: g.manual ? g.label : park && park.reverse ? 'R' : 'D', stalled: g.stalled, sig: park ? 0 : sim.sig, blink: Math.floor((park ? 0 : sim.player.sigT) * 3) % 2 === 0, night: tod !== 'day' };
    interior.update(sp, steerVis, g.manual, camMode === 'cockpit' && !park, gaugeData);
  }
  actors!.manual = (park ? park.gb : sim.gb).manual;
  actors!.update(park ?? sim);
  wfx.update(dt, camera.position);
  updateHeadlights(sp);
  adaptDpr(dt);
  if (!park) world!.updateLights(sim);
  actors!.setPlayerVisible(park ? true : camMode !== 'cockpit');
  if (composer && quality === 'high') composer.render(); else renderer.render(scene, camera);
  if (park) sound.update(park, keys.gas, !paused && !park.result);
  if (!park) {
    mirrors.render(sp, frameNo++, camera.far, camMode === 'cockpit', (v) => actors!.setPlayerVisible(v), (h) => { if (camMode === 'cockpit') interior.group.visible = !h; });
    sound.update(sim, controls().gas, !paused && !sim.result);
  }
  hud();
  requestAnimationFrame(frame);
}
syncModeButtons();
syncRoute();
startHint();
$('qual').textContent = `Якість: ${QUALITY_LABEL[quality]}`;
Promise.all([loadModels(), quality !== 'low' ? ensurePbr() : Promise.resolve()]).then(([m]) => {
  models = m;
  actors = new Actors(m, quality);
  scene.add(actors.group);
  applyQuality(quality);
  if (actors) actors.night = tod !== 'day';
  const pk = QS.get('park'); // ?park=parallel|garage — відразу вправа парковки (для знімків і посилань)
  if (pk === 'parallel' || pk === 'garage' || pk === 'turn') startPark(pk);
  last = performance.now();
  requestAnimationFrame(frame);
}).catch((e: unknown) => { console.error('Не вдалося завантажити моделі', e); toast('Не вдалося завантажити моделі', 'fault'); });

// Відладочний handle (лише ?dbg=1 / ?auto=1): прогін рушія без рендера, камера довільно.
if (DBG) {
  interface Dbg { sim(): AnySim; advance(sec: number): void; advanceUntil(pred: (s: AnySim) => boolean, maxSec: number): boolean; pause(b: boolean): void; cam(o: typeof camOverride): void; ready(): boolean; setQuality(q: Quality): void; setRoute(r: RouteId): void; stats(): { calls: number; triangles: number; buildMs: number; worldVerts: number; geometries: number; textures: number } }
  const dbg: Dbg = {
    sim: () => sim,
    advance(sec) { for (let i = 0, n = Math.round(sec / sim.cfg.dt); i < n && !sim.result; i++) onEvents(sim.step(controls(), sim.cfg.dt)); },
    advanceUntil(pred, maxSec) {
      for (let i = 0, n = Math.round(maxSec / sim.cfg.dt); i < n && !sim.result; i++) { onEvents(sim.step(controls(), sim.cfg.dt)); if (pred(sim)) return true; }
      return false;
    },
    pause(b) { paused = b; },
    cam(o) { camOverride = o; },
    ready: () => actors !== null && (!AUTO || pilotMake !== null),
    setRoute: (r) => setRoute(r),
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, buildMs, worldVerts, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
    setQuality(q) { if (q !== 'low' && !pbr) void ensurePbr().then(() => applyQuality(q)); else applyQuality(q); },
  };
  (window as unknown as { __dbg: Dbg }).__dbg = dbg;
}
