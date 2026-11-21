// Салон для виду «з салону»: передня панель, кермо (крутиться), стійки й стеля, важіль КПП (на механіці). Стоїть у системі авто (вперед −Z, праворуч +X).
// Око водія — (−0,38; 1,2; −0,25). Автомат (ID.4): плаваючий екран і світла нижня частина; механіка (Cerato): магнітола, клімат-регулятори, важіль.
import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace, TorusGeometry, Vector3, type BufferGeometry, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export interface Gauges { speed: number; rpm: number; manual: boolean; gear: string; stalled: boolean; sig: -1 | 0 | 1; blink: boolean; night: boolean; abs?: boolean; slip?: boolean }

const CW = 768, CH = 300; // полотно щитка приладів

// Дрібне «зерно» м'якого пластику: перестає виглядати плоским чорним.
function grainTex(base: [number, number, number], amp: number): CanvasTexture {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d')!, im = x.createImageData(N, N);
  let s = 12345; const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < N * N; i++) { const v = (rnd() - 0.5) * amp; im.data[i * 4] = base[0] + v; im.data[i * 4 + 1] = base[1] + v; im.data[i * 4 + 2] = base[2] + v; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(6, 3); t.colorSpace = SRGBColorSpace;
  return t;
}

// Статичний екран мультимедіа: карта-схема, смуга меню, час.
function screenTex(): CanvasTexture {
  const W = 320, H = 200, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#0c1118'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#2a4a6a'; x.lineWidth = 6; x.beginPath(); x.moveTo(0, 150); x.lineTo(130, 110); x.lineTo(210, 60); x.lineTo(320, 40); x.stroke();
  x.strokeStyle = '#1c2f44'; x.lineWidth = 4; for (const y of [30, 80, 130, 180]) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y + 14); x.stroke(); }
  x.fillStyle = '#35c6ff'; x.beginPath(); x.moveTo(150, 120); x.lineTo(162, 146); x.lineTo(150, 140); x.lineTo(138, 146); x.closePath(); x.fill();
  x.fillStyle = '#10161e'; x.fillRect(0, H - 34, W, 34);
  x.fillStyle = '#9fb0c4'; x.font = '600 15px system-ui, sans-serif'; x.textAlign = 'center';
  ['Навігація', 'Медіа', 'Телефон', 'Авто'].forEach((t, i) => x.fillText(t, 40 + i * 80, H - 12));
  x.fillStyle = '#eaf2ff'; x.font = '700 18px system-ui, sans-serif'; x.textAlign = 'right'; x.fillText('12:30', W - 10, 22);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

export class Interior {
  readonly group = new Group();
  private readonly wheel = new Group();
  private readonly shifter = new Group();
  private readonly ev = new Group();      // лише автомат (ID.4)
  private readonly ice = new Group();     // лише механіка (Cerato)
  private readonly mats: Material[] = [];
  private readonly glow: MeshStandardMaterial[] = []; // матеріали з «відбитим» світлом (удень яскравіші, вночі ледь видно)
  private night = false;
  private readonly geos: BufferGeometry[] = [];
  private readonly texs: CanvasTexture[] = [];
  private readonly cv = document.createElement('canvas');
  private readonly tex: CanvasTexture;
  private lastDraw = 0;
  private lastKey = '';
  constructor() {
    this.cv.width = CW; this.cv.height = CH;
    this.tex = new CanvasTexture(this.cv); this.tex.colorSpace = SRGBColorSpace;
    const M = (c: number, r = 0.8, m = 0.05, map?: CanvasTexture): MeshStandardMaterial => { const x = new MeshStandardMaterial({ color: c, roughness: r, metalness: m, envMapIntensity: 1.6, emissive: c, emissiveIntensity: m > 0.5 ? 0 : 0.3, ...(map ? { map, emissiveMap: map } : {}) }); this.mats.push(x); if (x.emissiveIntensity > 0) this.glow.push(x); return x; }; // емісія — «відбите» світло в закритому салоні
    const g1 = grainTex([112, 116, 124], 36), g2 = grainTex([86, 89, 96], 30); this.texs.push(g1, g2);
    const top = M(0xffffff, 0.92, 0.02, g1), soft = M(0xffffff, 0.95, 0.02, g2), trim = M(0x9097a2, 0.32, 0.85), piano = M(0x07080a, 0.14, 0.3);
    const lining = M(0xb4b2ab, 0.97), fabric = M(0x6e6f73, 0.98), pillar = M(0x8c8e93, 0.95), leather = M(0x15161a, 0.55, 0.02), light = M(0xa9aeb5, 0.85, 0.02), glass = M(0x57606c, 0.08, 0.9), vent = M(0x0d0e10, 0.7);
    const add = (g: BufferGeometry, m: Material, x: number, y: number, z: number, parent: Group = this.group, rx = 0, ry = 0, rz = 0): Mesh => {
      this.geos.push(g); const o = new Mesh(g, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); parent.add(o); return o;
    };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: Material, parent?: Group, rx = 0, ry = 0, rz = 0): Mesh => add(new BoxGeometry(w, h, d), m, x, y, z, parent, rx, ry, rz);
    const rbox = (w: number, h: number, d: number, r: number, x: number, y: number, z: number, m: Material, parent?: Group, rx = 0, ry = 0, rz = 0): Mesh => add(new RoundedBoxGeometry(w, h, d, 3, r), m, x, y, z, parent, rx, ry, rz);
    // Стійка/планка між двома точками.
    const strut = (a: [number, number, number], b: [number, number, number], w: number, d: number, m: Material): Mesh => {
      const A = new Vector3(...a), B = new Vector3(...b), dir = B.clone().sub(A), len = dir.length();
      const o = new Mesh(new BoxGeometry(w, len, d), m); this.geos.push(o.geometry);
      o.position.copy(A.clone().add(B).multiplyScalar(0.5)); o.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
      this.group.add(o); return o;
    };
    // ---- Передня панель: монолітна подушка зі скругленнями, козирок над щитком, шов-акцент.
    rbox(1.84, 0.2, 0.52, 0.06, 0, 0.77, -0.96, top, this.group, -0.1);
    rbox(1.9, 0.36, 0.14, 0.05, 0, 0.62, -0.74, soft);
    box(1.8, 0.012, 0.012, 0, 0.848, -0.74, trim, this.group, -0.1);       // хромований шов по верху
    rbox(1.7, 0.05, 0.22, 0.02, 0, 0.62, -0.7, light);                      // світла смуга низу панелі
    // ---- Дефлектори: бічні й центральні (корпус + ламелі).
    const slots = (x: number, y: number, z: number, w: number): void => {
      rbox(w, 0.055, 0.03, 0.01, x, y, z, vent, this.group, -0.15);
      for (let i = 0; i < 4; i++) box(w - 0.03, 0.004, 0.02, x, y - 0.02 + i * 0.013, z + 0.012, trim, this.group, -0.15);
    };
    slots(-0.76, 0.785, -0.8, 0.12); slots(0.76, 0.785, -0.8, 0.12);
    // ---- Автомат (ID.4): плаваючий екран і сенсорні ряди; нижня частина світла.
    {
      const sm = new MeshBasicMaterial({ map: screenTex(), toneMapped: false }); this.mats.push(sm);
      this.texs.push(sm.map as CanvasTexture);
      const frame = rbox(0.42, 0.27, 0.04, 0.02, 0.2, 0.935, -0.93, piano, this.ev, -0.25, -0.3);
      frame.castShadow = false;
      const sp = new Mesh(new PlaneGeometry(0.38, 0.234), sm); this.geos.push(sp.geometry); sp.position.set(0.2, 0.935, -0.895); sp.rotation.set(-0.25, -0.3, 0); this.ev.add(sp);
      rbox(0.4, 0.06, 0.2, 0.025, 0.2, 0.74, -0.86, light, this.ev, -0.1, -0.3);
      slots(0.2, 0.69, -0.78, 0.22);
    }
    // ---- Механіка (Cerato): магнітола, регулятори клімату, центральні дефлектори.
    {
      const sm = new MeshBasicMaterial({ map: screenTex(), toneMapped: false }); this.mats.push(sm);
      this.texs.push(sm.map as CanvasTexture);
      rbox(0.4, 0.24, 0.1, 0.02, 0.1, 0.72, -0.83, piano, this.ice, -0.35, -0.28);
      const sp = new Mesh(new PlaneGeometry(0.3, 0.15), sm); this.geos.push(sp.geometry); sp.position.set(0.098, 0.745, -0.768); sp.rotation.set(-0.35, -0.28, 0); this.ice.add(sp);
      for (let i = 0; i < 3; i++) { const k = new CylinderGeometry(0.022, 0.022, 0.025, 14); k.rotateX(Math.PI / 2 - 0.35); this.geos.push(k); const m = new Mesh(k, trim); m.position.set(0.0 + i * 0.09, 0.61, -0.76); this.ice.add(m); }
      slots(0.1, 0.8, -0.86, 0.2);
    }
    // ---- Стійки, дах, козирки, дзеркало.
    for (const k of [-1, 1]) {
      strut([k * 0.8, 0.86, -1.02], [k * 0.7, 1.5, -0.34], 0.055, 0.06, pillar);      // A-стійка під нахил лобового
      strut([k * 0.9, 0.86, 0.5], [k * 0.78, 1.5, 0.6], 0.06, 0.1, pillar);             // B-стійка
      rbox(0.07, 0.34, 1.0, 0.03, k * 0.95, 0.84, 0.15, k < 0 ? light : light);     // верх дверної карти (бокова)
      box(0.05, 0.02, 0.95, k * 0.92, 0.99, 0.12, trim);                              // молдинг під склом
      rbox(0.4, 0.015, 0.24, 0.006, k * 0.42, 1.455, -0.5, fabric, this.group, 0.22, 0, 0); // сонцезахисний козирок
    }
    box(1.7, 0.06, 0.08, 0, 1.5, -0.34, fabric);                                      // верхня балка лобового скла
    box(1.76, 0.03, 1.9, 0, 1.52, 0.1, lining);                                       // стеля
    {
      // Салонне дзеркало: корпус, скло, кронштейн.
      const mir = new Group(); mir.position.set(0, 1.36, -0.55); mir.rotation.y = -0.4; this.group.add(mir);
      rbox(0.19, 0.055, 0.03, 0.014, 0, 0, 0, soft, mir);
      box(0.172, 0.04, 0.004, 0, 0, 0.016, glass, mir);
      box(0.014, 0.1, 0.014, 0, 0.065, -0.012, soft, mir);
    }
    // ---- Кермо: шкіряний обід, ступиця-подушка, спиці, кнопки; колонка.
    const rim = new TorusGeometry(0.18, 0.022, 14, 40); this.geos.push(rim);
    this.wheel.add(new Mesh(rim, leather));
    const pad = new RoundedBoxGeometry(0.13, 0.1, 0.05, 3, 0.03); this.geos.push(pad);
    this.wheel.add(new Mesh(pad, soft));
    for (const a of [Math.PI / 2, -Math.PI / 2 + 0.5, -Math.PI / 2 - 0.5]) {
      const sg = new BoxGeometry(0.12, 0.034, 0.018); this.geos.push(sg);
      const s = new Mesh(sg, leather); s.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0); s.rotation.z = a; this.wheel.add(s);
    }
    for (const sx of [-0.115, 0.115]) { const bg = new BoxGeometry(0.03, 0.05, 0.006); this.geos.push(bg); const b = new Mesh(bg, trim); b.position.set(sx, 0.015, 0.03); this.wheel.add(b); }
    const lg0 = new CylinderGeometry(0.03, 0.03, 0.006, 16); lg0.rotateX(Math.PI / 2); this.geos.push(lg0);
    { const m = new Mesh(lg0, trim); m.position.z = 0.03; this.wheel.add(m); }
    this.wheel.position.set(-0.38, 0.86, -0.7);
    this.wheel.rotation.x = -0.38; // нахил кермової колонки
    this.group.add(this.wheel);
    rbox(0.14, 0.14, 0.3, 0.03, -0.38, 0.8, -0.86, soft, this.group, -0.38);
    // ---- Важіль КПП (на механіці) у центральному тунелі.
    rbox(0.3, 0.3, 0.7, 0.05, 0.1, 0.42, -0.28, soft);
    const lg = new CylinderGeometry(0.013, 0.015, 0.2, 10); this.geos.push(lg);
    const lv = new Mesh(lg, trim); lv.position.y = 0.1; this.shifter.add(lv);
    const kg = new CylinderGeometry(0.03, 0.025, 0.07, 14); this.geos.push(kg);
    const kn = new Mesh(kg, leather); kn.position.y = 0.23; this.shifter.add(kn);
    this.shifter.position.set(0.1, 0.57, -0.28);
    this.group.add(this.shifter);
    this.group.add(this.ev, this.ice);
    // ---- Щиток приладів у «козирку»: полотно з живими показниками.
    const cg = new PlaneGeometry(0.46, 0.18); this.geos.push(cg);
    const cm = new MeshBasicMaterial({ map: this.tex, toneMapped: false }); this.mats.push(cm);
    const cl = new Mesh(cg, cm); cl.position.set(-0.38, 1.03, -0.93); cl.rotation.x = -0.45; this.group.add(cl);
    rbox(0.49, 0.2, 0.02, 0.01, -0.38, 1.03, -0.945, piano, this.group, -0.45);   // рамка щитка
    this.group.visible = false;
  }

  private draw(g: Gauges): void {
    const c = this.cv.getContext('2d')!, W = CW, H = CH;
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a1017'); bg.addColorStop(1, '#03060a');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    // Шкала: фонове коло, поділки кожні 10 (довгі кожні 20/1000), кольорова дуга значення, червона зона.
    const dial = (cx: number, cy: number, r: number, v: number, vmax: number, red: number, step: number, long: number, num: (i: number) => string, label: string): void => {
      const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
      c.lineWidth = 9; c.strokeStyle = '#1b2431'; c.beginPath(); c.arc(cx, cy, r, a0, a0 + sweep); c.stroke();
      if (red < vmax) { c.strokeStyle = '#8c1d1d'; c.beginPath(); c.arc(cx, cy, r, a0 + sweep * red / vmax, a0 + sweep); c.stroke(); }
      c.strokeStyle = g.manual && cx > W / 2 ? '#ffb84a' : '#5db7ff'; c.beginPath(); c.arc(cx, cy, r, a0, a0 + sweep * Math.min(1, v / vmax)); c.stroke();
      for (let i = 0, n = Math.round(vmax / step); i <= n; i++) {
        const a = a0 + sweep * i / n, big = i % long === 0, r0 = r - (big ? 24 : 16), r1 = r - 11;
        c.lineWidth = big ? 3 : 1.5; c.strokeStyle = big ? '#dfe8f4' : '#6e7b8c';
        c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
        if (big) { c.fillStyle = '#aebccd'; c.font = '600 17px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(num(i), cx + Math.cos(a) * (r - 42), cy + Math.sin(a) * (r - 42)); }
      }
      c.textBaseline = 'alphabetic'; c.fillStyle = '#8796aa'; c.font = '600 18px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(label, cx, cy + r * 0.82);
    };
    // Спідометр (зліва).
    dial(185, 150, 120, g.speed, 240, 999, 10, 2, (i) => String(i * 20), 'км/год');
    c.fillStyle = '#eef5ff'; c.font = '700 84px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(String(Math.round(g.speed)), 185, 172);
    // Тахометр (механіка) або передача (автомат).
    if (g.manual) {
      dial(583, 150, 120, g.stalled ? 0 : g.rpm, 7000, 6000, 500, 2, (i) => String(i / 2), 'об/хв ×1000');
      c.fillStyle = g.stalled ? '#ff5a4e' : '#eef5ff'; c.font = '700 56px system-ui, sans-serif';
      c.fillText(g.stalled ? '!' : (g.rpm / 1000).toFixed(1).replace('.', ','), 583, 168);
      c.fillStyle = '#ffd25a'; c.font = '700 54px system-ui, sans-serif'; c.fillText(g.gear, 384, 190);
    } else {
      c.fillStyle = '#eef5ff'; c.font = '700 120px system-ui, sans-serif'; c.fillText(g.gear, 583, 180);
      c.fillStyle = '#8796aa'; c.font = '600 20px system-ui, sans-serif'; c.fillText('передача', 583, 224);
      c.strokeStyle = '#1b2431'; c.lineWidth = 2; c.beginPath(); c.arc(583, 150, 120, 0, Math.PI * 2); c.stroke();
    }
    // Покажчики поворотів і сигнал заглушеного двигуна.
    c.font = '700 62px system-ui, sans-serif';
    c.fillStyle = g.sig === -1 && g.blink ? '#35e06a' : '#12301c'; c.fillText('◀', 344, 70);
    c.fillStyle = g.sig === 1 && g.blink ? '#35e06a' : '#12301c'; c.fillText('▶', 424, 70);
    // Слизька дорога (❄) і робота ABS.
    c.font = '700 32px system-ui, sans-serif';
    if (g.slip) { c.fillStyle = '#8fd3ff'; c.fillText('❄', 338, 130); }
    if (g.abs) { c.fillStyle = '#ffc247'; c.font = '800 32px system-ui, sans-serif'; c.fillText('ABS', 428, 130); }
    if (g.stalled) { c.fillStyle = '#ff5a4e'; c.font = '700 26px system-ui, sans-serif'; c.fillText('ДВИГУН ЗАГЛУХ', 384, 276); }
    else if (g.night) { c.fillStyle = '#6fb6ff'; c.font = '600 22px system-ui, sans-serif'; c.fillText('ближнє світло', 384, 276); }
    // Блиск скла зверху.
    const gl = c.createLinearGradient(0, 0, 0, H * 0.45); gl.addColorStop(0, 'rgba(255,255,255,0.07)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gl; c.fillRect(0, 0, W, H * 0.45);
    this.tex.needsUpdate = true;
  }
  // p — поза авто; steer −1…1 (кермо), manual — механіка (Cerato), інакше автомат (ID.4).
  update(p: { x: number; z: number; a: number }, steer: number, manual: boolean, visible: boolean, gauges?: Gauges): void {
    this.group.visible = visible;
    if (!visible) return;
    const now = performance.now();
    // Перемальовуємо щиток лише коли змінилося видиме (швидкість до км/год, передача, прапорці) і не частіше за 70 мс.
    if (gauges && now - this.lastDraw > 70) {
      const key = `${Math.round(gauges.speed)}|${Math.round(gauges.rpm / 50)}|${gauges.gear}|${gauges.stalled}|${gauges.sig}|${gauges.blink}|${gauges.night}|${gauges.abs}|${gauges.slip}|${gauges.manual}`;
      if (key !== this.lastKey) { this.lastKey = key; this.lastDraw = now; this.draw(gauges); }
    }
    if (gauges && gauges.night !== this.night) { this.night = gauges.night; for (const m of this.glow) m.emissiveIntensity = this.night ? 0.05 : 0.3; }
    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = -p.a;
    this.wheel.rotation.z = -steer * Math.PI * 1.4;
    this.shifter.visible = manual;
    this.ice.visible = manual; this.ev.visible = !manual;
  }
  dispose(): void { this.tex.dispose(); this.texs.forEach((t) => t.dispose()); this.mats.forEach((m) => m.dispose()); this.geos.forEach((g) => g.dispose()); }
}
