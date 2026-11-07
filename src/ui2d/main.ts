// Тренажер маршрутів №1 і №7: вид зверху (2D) для перевірки правил і балансу до 3D.
// Камера «машина завжди вгору»: світ повертається навколо гравця.

import type { Polyline } from '../engine/geometry';
import type { Light } from '../engine/signals';
import type { Controls, SimEvent } from '../engine/sim7';
import type { Route7Sim } from '../engine/sim';
import { loadPilot, makeSim, pickRoute, ROUTE_ORDER, pressTurn, ROUTE_SHORT, saveRoute, startHintText, turnUi, type AnySim, type Pilot, type PilotFactory, type RouteId } from '../ui-shared/common';
import { Net2D } from './net2d';

type Mode = 'learn' | 'exam';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const ctx = canvas.getContext('2d')!;

const COLORS = {
  grass: '#9fcf8f', road: '#5b5e66', ring: '#5b5e66', island: '#7fbf6a', mark: '#f4f4f4',
  walk: '#d9d6cf', player: '#2f6fd6', ped: '#e05a4f', pedWait: '#c9a0a0',
};
const LIGHT_COLOR: Record<Light, string> = {
  green: '#30d158', greenBlink: '#30d158', yellow: '#ffcc00', red: '#ff3b30', redYellow: '#ff3b30',
};

const QS = new URLSearchParams(location.search);
const AUTO = QS.get('auto') === '1';

let mode: Mode = 'learn';
let route: RouteId = pickRoute();
import { Sound } from '../ui-shared/audio';
const sound = new Sound();
let sim: AnySim = newSim();
let net2d: Net2D | null = sim.route !== 'route7' ? new Net2D(sim) : null;
let keys = { gas: false, brake: false };
let paused = new URLSearchParams(location.search).get('paused') === '1'; // ?paused=1, ?auto=1, ?dbg=1 і ?seed=N — лише для тестів
let zoom = 1;
let toastT = 0;

let pilotMake: PilotFactory | null = null;
let pilot: Pilot | null = null;
let pilotFor: AnySim | null = null;
if (AUTO) void loadPilot().then((f) => { pilotMake = f; });
function controls(): Controls {
  if (!AUTO || !pilotMake) return keys;
  if (pilotFor !== sim) { pilot = pilotMake(sim); pilotFor = sim; }
  return pilot!.controls(sim.cfg.dt);
}

function newSim(): AnySim {
  return makeSim(route, mode, QS.get('seed'));
}

function restart(): void {
  sim = newSim();
  net2d = sim.route !== 'route7' ? new Net2D(sim) : null;
  syncRoute();
  keys = { gas: false, brake: false };
  paused = false;
  $('result').hidden = true;
  $('toast').hidden = true;
  syncModeButtons();
  startHint();
}

function startHint(): void {
  if (mode === 'learn') toast(startHintText(route), 'hint');
}

// ---------- Малювання ----------

function strokePath(p: Polyline, width: number, color: string, dash?: number[]): void {
  ctx.beginPath();
  p.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.z) : ctx.moveTo(q.x, q.z)));
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.setLineDash(dash ?? []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function strokeSub(p: Polyline, s0: number, s1: number, width: number, color: string): void {
  const a = Math.max(0, s0), b = Math.min(p.length, s1);
  if (b > a) strokePath(p.slice(a, b), width, color);
}

function drawWorld7(sim: Route7Sim): void {
  const net = sim.net;
  const W = net.laneWidth;
  const { r, laneWidth: rw } = net.ring;
  ctx.lineCap = 'butt';

  // Поперечні вулиці на перехрестях.
  ctx.fillStyle = COLORS.road;
  for (const f of net.features) {
    if (f.def.kind !== 'intersection') continue;
    const hw = f.def.halfWidth;
    if (f.def.side !== 'W') ctx.fillRect(0, f.worldZ - hw, 90, hw * 2);
    if (f.def.side !== 'E') ctx.fillRect(-90, f.worldZ - hw, 90, hw * 2);
  }

  // Тротуари і проїзна частина Мрії.
  for (const dir of ['S', 'N'] as const) {
    strokePath(net.ref[dir].offset(W), 2 * W + 2 * 3.2, COLORS.walk);
  }
  for (const dir of ['S', 'N'] as const) strokePath(net.ref[dir].offset(W), 2 * W + 0.3, COLORS.road);
  strokePath(net.ref.S, 2 * sim.cfg.road.medianHalf + 0.2, COLORS.road);

  // Рукави, вʼїзди, зʼїзди.
  for (const id of net.armOrder) {
    const arm = net.arms[id];
    if (arm.inLine) strokePath(arm.inLine, 4.2, COLORS.road);
    strokePath(arm.outLine, 4.2, COLORS.road);
    for (const lane of [0, 1] as const) {
      if (id === 'S' || lane === 1) strokePath(net.exitPath(id, lane), 4.2, COLORS.road);
    }
    if (arm.inLine) strokePath(net.entryPath(arm.inLine.pose(arm.inLine.length), id, 1), 4.2, COLORS.road);
  }
  for (const lane of [0, 1] as const) {
    const ln = net.lanes.N[lane];
    strokePath(net.entryPath(ln.pose(ln.length), 'S', lane), 4.2, COLORS.road);
  }

  // Кільце.
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.lineWidth = rw * 2 + 0.6;
  ctx.strokeStyle = COLORS.ring;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r - rw - 0.3, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.island;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.lineWidth = 0.15;
  ctx.strokeStyle = COLORS.mark;
  ctx.setLineDash([2, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Розмітка вулиці: подвійна суцільна по осі, переривчаста між смугами, суцільна перед переходами.
  const mh = sim.cfg.road.medianHalf;
  strokePath(net.ref.S.offset(-mh + 0.25), 0.15, COLORS.mark);
  strokePath(net.ref.S.offset(-mh - 0.25), 0.15, COLORS.mark);
  for (const dir of ['S', 'N'] as const) {
    const div = net.ref[dir].offset(W);
    strokePath(div, 0.15, COLORS.mark, [3, 6]);
    for (const f of net.features) strokeSub(div, f.stop[dir] - sim.cfg.rules.solidBeforeStop, f.zone[dir][1], 0.15, COLORS.mark);
    strokePath(net.ref[dir].offset(2 * W), 0.15, COLORS.mark);
  }

  // Стоп-лінії, зебри, світлофори.
  for (const f of net.features) {
    for (const dir of ['S', 'N'] as const) {
      const ref = net.ref[dir];
      if (f.signalised) {
        const p0 = ref.pose(f.stop[dir]);
        const hx = Math.sin(p0.a), hz = -Math.cos(p0.a);
        const rx = -hz, rz = hx;
        ctx.beginPath();
        ctx.moveTo(p0.x + rx * mh, p0.z + rz * mh);
        ctx.lineTo(p0.x + rx * (mh + 2 * W), p0.z + rz * (mh + 2 * W));
        ctx.lineWidth = 0.4;
        ctx.strokeStyle = COLORS.mark;
        ctx.stroke();
        const l = sim.light(f);
        const blinkOff = l === 'greenBlink' && Math.floor(sim.t * 2) % 2 === 1;
        const lx = p0.x + rx * (mh + 2 * W + 1.2), lz = p0.z + rz * (mh + 2 * W + 1.2);
        ctx.fillStyle = '#1c1d1f';
        ctx.fillRect(lx - 0.8, lz - 0.8, 1.6, 1.6);
        ctx.beginPath();
        ctx.arc(lx, lz, 0.6, 0, Math.PI * 2);
        ctx.fillStyle = blinkOff ? '#244d2f' : LIGHT_COLOR[l];
        ctx.fill();
      }
    }
    if (f.def.kind !== 'intersection') {
      ctx.fillStyle = COLORS.mark;
      const edge = mh + 2 * W;
      for (let x = -edge + 0.3; x < edge - 0.3; x += 1.1) {
        if (Math.abs(x) < mh + 0.2) continue;
        ctx.fillRect(x, f.worldZ - f.def.halfWidth + 0.3, 0.55, f.def.halfWidth * 2 - 0.6);
      }
    }
  }

  // Старт і фініш.
  const st = net.startPose.line.pose(net.startPose.s);
  const fin = net.finishOut.pose(net.finishS);
  ctx.fillStyle = '#ffffff';
  ctx.font = '2px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillRect(fin.x - 0.3, fin.z - 2, 0.6, 4);
  ctx.save();
  ctx.translate(st.x - 6, st.z + 4);
  ctx.fillText('Старт', 0, 0);
  ctx.restore();
}

function drawYards(sim: Route7Sim): void {
  ctx.fillStyle = COLORS.road;
  for (const d of sim.net.driveways) ctx.fillRect(d.sign > 0 ? d.edgeX : -d.edgeX - d.depth, d.worldZ - 3, d.depth, 6);
  ctx.fillStyle = '#3b6fa0';
  for (const b of sim.net.busStops) ctx.fillRect(b.sign * 9.6 - 0.6, b.worldZ - 1.6, 1.2, 3.2);
}

function drawCar(x: number, z: number, a: number, len: number, wid: number, color: string, opts: { brake?: boolean; sig?: number; hazard?: boolean; dim?: boolean; phase?: number } = {}): void {
  ctx.save();
  ctx.translate(x, z);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.fillRect(-wid / 2, -len / 2, wid, len);
  ctx.fillStyle = 'rgba(20,30,50,0.55)';
  ctx.fillRect(-wid / 2 + 0.2, -len / 2 + 0.9, wid - 0.4, 0.9);
  if (opts.brake) {
    ctx.fillStyle = '#ff2a2a';
    ctx.fillRect(-wid / 2, len / 2 - 0.35, 0.5, 0.35);
    ctx.fillRect(wid / 2 - 0.5, len / 2 - 0.35, 0.5, 0.35);
  }
  if (opts.dim) { ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.12; ctx.strokeRect(-wid / 2, -len / 2, wid, len); }
  if ((opts.sig || opts.hazard) && Math.floor((opts.phase ?? sim.t) * 3) % 2 === 0) {
    ctx.fillStyle = '#ffa31a';
    for (const side of opts.hazard ? [-1, 1] : [opts.sig!]) {
      const sx = side < 0 ? -wid / 2 - 0.15 : wid / 2 - 0.35;
      ctx.fillRect(sx, -len / 2, 0.5, 0.6);
      ctx.fillRect(sx, len / 2 - 0.6, 0.5, 0.6);
    }
  }
  ctx.restore();
}

function hex(n: number): string { return '#' + n.toString(16).padStart(6, '0'); }

function draw(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, w, h);

  const p = sim.player;
  const scale = (Math.min(w, h * 0.8) / 42) * zoom;
  ctx.save();
  ctx.translate(w / 2, h * 0.68);
  ctx.scale(scale, scale);
  ctx.rotate(-p.a);
  ctx.translate(-p.x, -p.z);
  if (sim.route !== 'route7') net2d!.draw(ctx, { x: p.x, z: p.z, r: Math.hypot(w / 2, h * 0.7) / scale + 6 }, sim.t, p.a);
  else { drawWorld7(sim); drawYards(sim); }
  for (const ped of sim.peds.list) {
    ctx.beginPath();
    ctx.arc(ped.x, ped.z, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = ped.kind === 'jaywalker' ? '#b3261e' : ped.started ? COLORS.ped : COLORS.pedWait;
    ctx.fill();
  }
  for (const c of sim.traffic.cars) {
    drawCar(c.x, c.z, c.a, c.len, sim.cfg.car.width, hex(c.color), c.kind === 'parked' ? { dim: true } : { brake: c.braking, sig: c.turn, hazard: c.hazard });
  }
  for (const r of sim.riders.list) { // вело — жовтий, самокат — бірюзовий
    ctx.save();
    ctx.translate(r.x, r.z);
    ctx.rotate(r.a);
    ctx.fillStyle = r.kind === 'bike' ? '#f2c230' : '#2bb5b0';
    ctx.fillRect(-r.width / 2, -r.len / 2, r.width, r.len);
    ctx.restore();
  }
  drawCar(p.x, p.z, p.a, sim.cfg.car.length, sim.cfg.car.width, COLORS.player, { brake: p.braking, sig: p.sig, phase: p.sigT });
  ctx.restore();
}

// ---------- HUD ----------

function hud(): void {
  $('speed').textContent = String(Math.round(sim.v * 3.6));
  const n = sim.next;
  $('next').textContent = n.dist > 1 ? `Далі: ${n.text} · ${Math.round(n.dist)} м` : `Далі: ${n.text}`;
  $('faults').textContent = mode === 'learn' ? `Помилки ${sim.minorCount}/${sim.cfg.rules.maxMinorFaults}` : 'Іспит';
  $('faults').classList.toggle('warn', mode === 'learn' && sim.minorCount > 0);
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
    if (e.type === 'fault' && mode === 'learn') toast(e.fault.message, 'fault');
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
}

// ---------- Керування ----------

function hold(id: string, key: 'gas' | 'brake'): void {
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
tap('sigL', () => sim.toggleSignal(-1));
tap('sigR', () => sim.toggleSignal(1));
tap('laneL', () => sim.changeLane(-1));
tap('laneR', () => sim.changeLane(1));
tap('turn', () => pressTurn(sim, 0));
tap('turnL', () => pressTurn(sim, -1));
tap('turnR', () => pressTurn(sim, 1));
tap('again', restart);
tap('restart', restart);
const syncSound = (): void => { $('sound').textContent = sound.muted ? '🔇' : '🔊'; };
tap('sound', () => { sound.unlock(); sound.setMuted(!sound.muted); syncSound(); });
syncSound();
window.addEventListener('pointerdown', () => sound.unlock(), { passive: true });
window.addEventListener('keydown', () => sound.unlock());
tap('pause', () => { paused = !paused; $('pause').textContent = paused ? '▶' : '❚❚'; });
tap('zin', () => { zoom = Math.min(2.2, zoom * 1.25); });
tap('zout', () => { zoom = Math.max(0.4, zoom / 1.25); });
tap('mLearn', () => { mode = 'learn'; restart(); });
tap('mExam', () => { mode = 'exam'; restart(); });

// ---------- Вибір маршруту ----------
let pausedBeforePick = false;
function syncRoute(): void {
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
  if (r === route) return;
  route = r;
  saveRoute(r);
  restart(); // новий сід (якщо не заданий ?seed=)
}
$('rt').addEventListener('click', () => openPicker(true)); // click (як і вибір пункту): інакше «привидний» click після pointerdown одразу обирає пункт під пальцем
$('pickClose').addEventListener('click', () => openPicker(false));
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
  if (e.code === 'ArrowUp') keys.gas = true;
  else if (e.code === 'ArrowDown') keys.brake = true;
  else if (!e.repeat && KEYMAP[e.code]) KEYMAP[e.code]!();
  else return;
  e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'ArrowUp') keys.gas = false;
  if (e.code === 'ArrowDown') keys.brake = false;
});

// ---------- Цикл ----------

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused && !sim.result) {
    acc += dt;
    const step = sim.cfg.dt;
    while (acc >= step) {
      onEvents(sim.step(controls(), step));
      acc -= step;
      if (sim.result) break;
    }
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').hidden = true; }
  draw();
  sound.update(sim, controls().gas, !paused && !sim.result);
  hud();
  requestAnimationFrame(frame);
}
syncModeButtons();
syncRoute();
startHint();
requestAnimationFrame(frame);

if (AUTO || QS.get('dbg') === '1') {
  (window as unknown as { __dbg: object }).__dbg = {
    sim: () => sim, ready: () => !AUTO || pilotMake !== null, pause: (b: boolean) => { paused = b; }, setRoute: (r: RouteId) => setRoute(r),
    zoom: (z: number) => { zoom = z; },
    advance(sec: number): void { for (let i = 0, n = Math.round(sec / sim.cfg.dt); i < n && !sim.result; i++) onEvents(sim.step(controls(), sim.cfg.dt)); },
    advanceUntil(pred: (s: AnySim) => boolean, maxSec: number): boolean {
      for (let i = 0, n = Math.round(maxSec / sim.cfg.dt); i < n && !sim.result; i++) { onEvents(sim.step(controls(), sim.cfg.dt)); if (pred(sim)) return true; }
      return false;
    },
  };
}
