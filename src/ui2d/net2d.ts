// 2D-малювання маршруту №1 (мережа OSM): ребра, смуги, зʼєднувачі, перехрестя, кільце, переходи, стоп-лінії, світлофори.
// Геометрія береться з sim.net / sim.data (див. tools/overlay-route1.mjs). Усе статичне зібрано один раз у Path2D.
import type { Light } from '../engine/signals';
import type { NetSim } from '../engine/net/sim';
import type { Vec2 } from '../engine/geometry';

const COL = {
  road: '#5b5e66', walk: '#d9d6cf', mark: '#f4f4f4', island: '#7fbf6a', bld: '#cdbfae', bldLine: '#a89a88', foot: '#cfcabd', ctx: '#6a6d75',
  start: '#30d158',
};
const LIGHT_COLOR: Record<Light, string> = { green: '#30d158', greenBlink: '#30d158', yellow: '#ffcc00', red: '#ff3b30', redYellow: '#ff3b30' };
const SIDEWALK = 2.6;

interface Stroke { readonly p: Path2D; readonly w: number; readonly color: string; readonly bb: readonly [number, number, number, number]; readonly dash?: readonly number[]; readonly cap?: CanvasLineCap }
interface Fill { readonly p: Path2D; readonly color: string; readonly line?: string; readonly bb: readonly [number, number, number, number] }
export interface View { readonly x: number; readonly z: number; readonly r: number }

function bbox(pts: readonly Vec2[], pad: number): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
function pathOf(pts: readonly Vec2[], close = false): Path2D {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x, q.z) : p.moveTo(q.x, q.z)));
  if (close) p.closePath();
  return p;
}
const seen = (bb: readonly [number, number, number, number], v: View): boolean => {
  const dx = Math.max(bb[0] - v.x, 0, v.x - bb[2]), dz = Math.max(bb[1] - v.z, 0, v.z - bb[3]);
  return dx * dx + dz * dz <= v.r * v.r;
};

export class Net2D {
  private readonly buildings: Fill[] = [];
  private readonly ctxFoot: Stroke[] = [];
  private readonly ctxRoad: Stroke[] = [];
  private readonly sidewalks: Stroke[] = [];
  private readonly asphalt: Stroke[] = [];
  private readonly junctions: Fill[] = [];
  private readonly marks: Stroke[] = [];
  private readonly zebra: Stroke[] = [];
  private readonly stops: Stroke[] = [];
  private readonly ring: { cx: number; cz: number; r: number; w: number };

  constructor(private readonly sim: NetSim) {
    const d = sim.data, net = sim.net, L = sim.cfg.rules.solidBeforeStop;
    for (const b of d.buildings) {
      const pts = b.pts.map((q) => ({ x: q[0], z: q[1] }));
      this.buildings.push({ p: pathOf(pts, true), color: COL.bld, line: COL.bldLine, bb: bbox(pts, 1) });
    }
    for (const c of d.context) {
      const pts = c.pts.map((q) => ({ x: q[0], z: q[1] }));
      const foot = c.kind === 'footway' || c.kind === 'path' || c.kind === 'cycleway' || c.kind === 'pedestrian';
      (foot ? this.ctxFoot : this.ctxRoad).push({ p: pathOf(pts), w: foot ? 1.8 : c.width, color: foot ? COL.foot : COL.ctx, bb: bbox(pts, c.width / 2 + 1), cap: 'round' });
    }
    for (const e of net.edgeList) {
      const w = e.n * e.W;
      const mid = e.ref.offset(w / 2).pts;
      const bb = bbox(mid, w / 2 + SIDEWALK + 1);
      const major = e.kind === 'street' || e.kind === 'arm' || e.kind === 'cross';
      if (major) this.sidewalks.push({ p: pathOf(mid), w: w + 2 * SIDEWALK, color: COL.walk, bb });
      this.asphalt.push({ p: pathOf(mid), w: w + 0.05, color: COL.road, bb });
      // Осьова: подвійна / одинарна суцільна по ref.offset(−median) — малює ребро-власник.
      if (e.data.centreOwner && e.data.centreLine !== 'none') {
        const m = e.data.median;
        this.asphalt.push({ p: pathOf(e.ref.offset(-m).pts), w: 2 * m + 0.1, color: COL.road, bb });
        if (e.data.centreLine === 'double') for (const k of [-1, 1]) this.marks.push({ p: pathOf(e.ref.offset(-m + k * 0.25).pts), w: 0.14, color: COL.mark, bb });
        else this.marks.push({ p: pathOf(e.ref.offset(-m).pts), w: 0.14, color: COL.mark, bb });
      }
      // Розподіл смуг: переривчаста + суцільна перед стоп-лініями/переходами.
      if (major) for (let i = 1; i < e.n; i++) {
        const ln = e.ref.offset(i * e.W);
        this.marks.push({ p: pathOf(ln.pts), w: 0.14, color: COL.mark, bb, dash: [3, 6] });
        for (const f of e.features) {
          if (f.kind !== 'signal' && f.kind !== 'crossing' && f.kind !== 'yield') continue;
          const a = Math.max(0, f.stop - L), b = Math.min(e.length, f.zone[1]);
          if (b > a) { const sl = ln.slice(a, b); this.marks.push({ p: pathOf(sl.pts), w: 0.14, color: COL.mark, bb: bbox(sl.pts, 1) }); }
        }
      }
    }
    for (const c of net.connList) {
      const pts = c.path.pts;
      this.asphalt.push({ p: pathOf(pts), w: 3.7, color: COL.road, bb: bbox(pts, 2.5), cap: 'round' });
    }
    for (const j of d.junctions) {
      const pts = j.poly.map((q) => ({ x: q[0], z: q[1] }));
      this.junctions.push({ p: pathOf(pts, true), color: COL.road, bb: bbox(pts, 1) });
    }
    for (const c of d.crossings) {
      const L2 = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
      const ux = (c.b[0] - c.a[0]) / L2, uz = (c.b[1] - c.a[1]) / L2;
      for (const sp of c.spans) {
        const a = { x: c.a[0] + ux * sp.u0, z: c.a[1] + uz * sp.u0 }, b = { x: c.a[0] + ux * sp.u1, z: c.a[1] + uz * sp.u1 };
        this.zebra.push({ p: pathOf([a, b]), w: c.width, color: 'rgba(244,244,244,0.92)', bb: bbox([a, b], c.width), dash: [0.55, 0.6] });
      }
    }
    for (const s of d.stopLines) {
      if (s.kind === 'crossing') continue;
      const pts = [{ x: s.a[0], z: s.a[1] }, { x: s.b[0], z: s.b[1] }];
      this.stops.push({ p: pathOf(pts), w: s.kind === 'signal' ? 0.4 : 0.35, color: COL.mark, bb: bbox(pts, 1), ...(s.kind === 'signal' ? {} : { dash: [0.55, 0.45] }) });
    }
    const r = d.rings[0]!;
    this.ring = { cx: r.cx, cz: r.cz, r: r.r, w: r.laneWidth };
  }

  draw(ctx: CanvasRenderingContext2D, v: View, t: number, viewAngle: number): void {
    const sim = this.sim, d = sim.data;
    const stroke = (list: readonly Stroke[]): void => {
      for (const s of list) {
        if (!seen(s.bb, v)) continue;
        ctx.lineWidth = s.w; ctx.strokeStyle = s.color; ctx.lineCap = s.cap ?? 'butt'; ctx.lineJoin = 'round';
        ctx.setLineDash(s.dash ? [...s.dash] : []);
        ctx.stroke(s.p);
      }
      ctx.setLineDash([]);
    };
    const fill = (list: readonly Fill[]): void => {
      for (const f of list) {
        if (!seen(f.bb, v)) continue;
        ctx.fillStyle = f.color; ctx.fill(f.p);
        if (f.line) { ctx.lineWidth = 0.25; ctx.strokeStyle = f.line; ctx.stroke(f.p); }
      }
    };
    fill(this.buildings);
    stroke(this.ctxFoot);
    stroke(this.ctxRoad);
    stroke(this.sidewalks);
    stroke(this.asphalt);
    fill(this.junctions);

    // Кільце, острів, розділова лінія.
    const R = this.ring;
    ctx.beginPath(); ctx.arc(R.cx, R.cz, R.r, 0, Math.PI * 2); ctx.lineWidth = R.w * 2 + 0.05; ctx.strokeStyle = COL.road; ctx.stroke();
    ctx.beginPath(); ctx.arc(R.cx, R.cz, R.r - R.w - 0.3, 0, Math.PI * 2); ctx.fillStyle = COL.island; ctx.fill();
    ctx.beginPath(); ctx.arc(R.cx, R.cz, R.r, 0, Math.PI * 2); ctx.lineWidth = 0.15; ctx.strokeStyle = COL.mark; ctx.setLineDash([2, 3]); ctx.stroke(); ctx.setLineDash([]);

    stroke(this.marks);
    stroke(this.zebra);
    stroke(this.stops);

    // Зупинки.
    ctx.fillStyle = '#3b6fa0';
    for (const b of d.busStops) {
      if (Math.abs(b.x - v.x) > v.r || Math.abs(b.z - v.z) > v.r) continue;
      ctx.save(); ctx.translate(b.x, b.z); ctx.rotate(b.a); ctx.fillRect(-0.6, -1.6, 1.2, 3.2); ctx.restore();
    }

    // Голови світлофорів: колір за станом (миготливий зелений блимає).
    const blinkOff = Math.floor(t * 2) % 2 === 1;
    for (const h of d.signals) {
      if (Math.abs(h.x - v.x) > v.r || Math.abs(h.z - v.z) > v.r) continue;
      let color: string;
      if (h.kind === 'ped') color = sim.pedLight(h.crossing!) === 'walk' ? LIGHT_COLOR.green : LIGHT_COLOR.red;
      else {
        const l = sim.light(h.ctrl, h.group!);
        color = l === 'greenBlink' && blinkOff ? '#244d2f' : LIGHT_COLOR[l];
      }
      const s = h.kind === 'ped' ? 0.55 : 0.8;
      ctx.fillStyle = '#1c1d1f'; ctx.fillRect(h.x - s, h.z - s, 2 * s, 2 * s);
      ctx.beginPath(); ctx.arc(h.x, h.z, s * 0.72, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    }

    // Старт і фініш (підписи залишаються вертикальними: світ повернуто на −a).
    const st = d.route.start, stE = sim.net.edge(st.edge);
    const sp = sim.net.pose(stE, st.s, stE.n * stE.W / 2);
    this.bar(ctx, sp.x, sp.z, sp.a, stE.n * stE.W + 1.2, COL.start, 0.7);
    this.label(ctx, sp.x, sp.z, viewAngle, 'Старт', -4, 0);
    const fin = d.route.steps.find((q) => q.kind === 'finish');
    if (fin && fin.kind === 'finish') {
      const fe = sim.net.edge(fin.edge), fp = sim.net.pose(fe, fin.s, fe.n * fe.W / 2), w = fe.n * fe.W;
      ctx.save(); ctx.translate(fp.x, fp.z); ctx.rotate(fp.a);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; ctx.fillRect(-w / 2 - 0.6 + (i * (w + 1.2)) / 8, -0.5 + j * 0.5, (w + 1.2) / 8, 0.5); }
      ctx.restore();
      this.label(ctx, fp.x, fp.z, viewAngle, 'Фініш', 4, 0);
    }
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, z: number, a: number, w: number, color: string, th: number): void {
    ctx.save(); ctx.translate(x, z); ctx.rotate(a); ctx.fillStyle = color; ctx.fillRect(-w / 2, -th / 2, w, th); ctx.restore();
  }
  private label(ctx: CanvasRenderingContext2D, x: number, z: number, viewAngle: number, text: string, dx: number, dz: number): void {
    ctx.save(); ctx.translate(x, z); ctx.rotate(viewAngle);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.3; ctx.font = 'bold 2px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.strokeText(text, dx, dz); ctx.fillText(text, dx, dz);
    ctx.restore();
  }
}
