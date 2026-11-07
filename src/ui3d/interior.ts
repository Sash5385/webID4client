// Салон для виду «з салону»: передня панель, кермо (крутиться), стійки й стеля, важіль КПП (на механіці). Стоїть у системі авто (вперед −Z, праворуч +X).
import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, TorusGeometry, type BufferGeometry, type Material } from 'three';

export interface Gauges { speed: number; rpm: number; manual: boolean; gear: string; stalled: boolean; sig: -1 | 0 | 1; blink: boolean; night: boolean }

export class Interior {
  readonly group = new Group();
  private readonly wheel = new Group();
  private readonly shifter = new Group();
  private readonly mats: Material[] = [];
  private readonly geos: BufferGeometry[] = [];
  private readonly cv = document.createElement('canvas');
  private readonly tex: CanvasTexture;
  private lastDraw = 0;
  constructor() {
    this.cv.width = 512; this.cv.height = 200;
    this.tex = new CanvasTexture(this.cv);
    const M = (c: number, r = 0.8, m = 0.05): MeshStandardMaterial => { const x = new MeshStandardMaterial({ color: c, roughness: r, metalness: m }); this.mats.push(x); return x; };
    const dark = M(0x2a2d33), mid = M(0x3b3f47), trim = M(0x5a606b, 0.5, 0.3), lining = M(0x7a7c80, 0.95);
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: Material, parent: Group = this.group, rx = 0, rz = 0): Mesh => {
      const g = new BoxGeometry(w, h, d); this.geos.push(g);
      const o = new Mesh(g, m); o.position.set(x, y, z); o.rotation.x = rx; o.rotation.z = rz; parent.add(o); return o;
    };
    // Передня панель: верхня полиця, козирок щитка, центральна консоль.
    box(1.9, 0.08, 0.55, 0, 0.8, -1.0, dark, this.group, -0.06);
    box(1.9, 0.36, 0.12, 0, 0.6, -0.76, mid);
    box(0.36, 0.5, 0.7, 0, 0.42, -0.3, mid);                           // консоль
    box(1.9, 0.03, 0.4, 0, 0.78, -0.62, trim);
    // Стійки і стеля (їх видно по краях лобового скла).
    for (const k of [-1, 1]) {
      box(0.07, 0.75, 0.12, k * 0.92, 1.28, -0.7, dark, this.group, -0.5, k * 0.2);  // A-стійка
      box(0.07, 0.8, 0.14, k * 0.9, 1.25, 0.55, dark, this.group, 0, k * 0.12);       // B-стійка
      box(0.04, 0.5, 0.9, k * 0.95, 0.8, 0.2, mid);                                    // двері (верх)
    }
    box(1.8, 0.04, 1.9, 0, 1.5, 0.1, lining);       // стеля
    box(0.22, 0.07, 0.04, 0, 1.36, -0.6, mid);       // салонне дзеркало
    // Кермо: обід, ступиця, 3 спиці; стійка рульового.
    const tg = new TorusGeometry(0.19, 0.02, 10, 28); this.geos.push(tg);
    this.wheel.add(new Mesh(tg, M(0x15161a, 0.7)));
    const hg = new CylinderGeometry(0.06, 0.06, 0.04, 14); hg.rotateX(Math.PI / 2); this.geos.push(hg);
    this.wheel.add(new Mesh(hg, trim));
    for (const a of [0, 2.1, -2.1]) {
      const sg = new BoxGeometry(0.17, 0.028, 0.02); this.geos.push(sg);
      const s = new Mesh(sg, M(0x15161a, 0.7)); s.position.set(Math.sin(a) * 0.1, -Math.cos(a) * 0.1, 0); s.rotation.z = -a + Math.PI / 2; this.wheel.add(s);
    }
    this.wheel.position.set(-0.38, 0.8, -0.58);
    this.wheel.rotation.x = -0.45; // нахил кермової колонки
    this.group.add(this.wheel);
    box(0.08, 0.08, 0.35, -0.38, 0.7, -0.74, dark, this.group, -0.45);
    // Важіль КПП (на механіці).
    const lg = new CylinderGeometry(0.014, 0.014, 0.22, 8); this.geos.push(lg);
    const lv = new Mesh(lg, trim); lv.position.y = 0.11; this.shifter.add(lv);
    const kg = new CylinderGeometry(0.03, 0.03, 0.06, 10); this.geos.push(kg);
    const kn = new Mesh(kg, dark); kn.position.y = 0.24; this.shifter.add(kn);
    this.shifter.position.set(0, 0.45, -0.3);
    this.group.add(this.shifter);
    // Щиток приладів: полотно з живими показниками (спідометр, тахометр / передача, покажчики).
    const cg = new PlaneGeometry(0.4, 0.156); this.geos.push(cg);
    const cm = new MeshBasicMaterial({ map: this.tex, toneMapped: false }); this.mats.push(cm);
    const cl = new Mesh(cg, cm); cl.position.set(-0.38, 1.0, -0.88); cl.rotation.x = -0.6; this.group.add(cl);
    this.group.visible = false;
  }

  private draw(g: Gauges): void {
    const c = this.cv.getContext('2d')!, W = 512, H = 200;
    c.fillStyle = '#05080c'; c.fillRect(0, 0, W, H);
    const arc = (cx: number, cy: number, r: number, v: number, vmax: number, red: number, label: string): void => {
      const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
      c.lineWidth = 6; c.strokeStyle = '#26303c'; c.beginPath(); c.arc(cx, cy, r, a0, a0 + sweep); c.stroke();
      if (red < vmax) { c.strokeStyle = '#a02020'; c.beginPath(); c.arc(cx, cy, r, a0 + sweep * red / vmax, a0 + sweep); c.stroke(); }
      c.strokeStyle = '#6fb6ff'; c.beginPath(); c.arc(cx, cy, r, a0, a0 + sweep * Math.min(1, v / vmax)); c.stroke();
      c.fillStyle = '#9fb0c4'; c.font = '600 16px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText(label, cx, cy + r * 0.78);
    };
    // Спідометр (зліва).
    arc(120, 100, 82, g.speed, 180, 999, 'км/год');
    c.fillStyle = '#eaf2ff'; c.font = '700 64px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(String(Math.round(g.speed)), 120, 118);
    // Тахометр (механіка) або передача (автомат).
    if (g.manual) {
      arc(392, 100, 82, g.stalled ? 0 : g.rpm, 7000, 6000, 'об/хв ×1000');
      c.fillStyle = g.stalled ? '#ff5a4e' : '#eaf2ff'; c.font = '700 46px system-ui, sans-serif';
      c.fillText(g.stalled ? '!' : (g.rpm / 1000).toFixed(1).replace('.', ','), 392, 112);
      c.fillStyle = '#ffd25a'; c.font = '700 40px system-ui, sans-serif'; c.fillText(g.gear, 256, 150);
    } else {
      c.fillStyle = '#eaf2ff'; c.font = '700 84px system-ui, sans-serif'; c.fillText(g.gear, 392, 124);
      c.fillStyle = '#9fb0c4'; c.font = '600 16px system-ui, sans-serif'; c.fillText('передача', 392, 160);
    }
    // Покажчики поворотів і сигнал заглушеного двигуна.
    c.font = '700 54px system-ui, sans-serif';
    c.fillStyle = g.sig === -1 && g.blink ? '#35e06a' : '#12301c'; c.fillText('◀', 232, 58);
    c.fillStyle = g.sig === 1 && g.blink ? '#35e06a' : '#12301c'; c.fillText('▶', 280, 58);
    if (g.stalled) { c.fillStyle = '#ff5a4e'; c.font = '700 22px system-ui, sans-serif'; c.fillText('ДВИГУН ЗАГЛУХ', 256, 186); }
    else if (g.night) { c.fillStyle = '#6fb6ff'; c.font = '600 18px system-ui, sans-serif'; c.fillText('ближнє світло', 256, 186); }
    this.tex.needsUpdate = true;
  }
  // p — поза авто; steer −1…1 (кермо), manual — показувати важіль.
  update(p: { x: number; z: number; a: number }, steer: number, manual: boolean, visible: boolean, gauges?: Gauges): void {
    this.group.visible = visible;
    if (!visible) return;
    const now = performance.now();
    if (gauges && now - this.lastDraw > 70) { this.lastDraw = now; this.draw(gauges); }
    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = -p.a;
    this.wheel.rotation.z = -steer * Math.PI * 1.4;
    this.shifter.visible = manual;
  }
  dispose(): void { this.tex.dispose(); this.mats.forEach((m) => m.dispose()); this.geos.forEach((g) => g.dispose()); }
}
