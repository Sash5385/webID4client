// Ефекти погоди для 3D: опади (дощ — риски, сніг — крапки) навколо камери + напівпрозоре покриття дороги (мокро / сніг / лід).
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Points, PointsMaterial, type Material, type Vector3 } from 'three';
import type { Weather } from './quality';

const BOX = 16; // півсторона куба опадів навколо камери, м
const H = 14;   // висота куба

export class WeatherFx {
  readonly group = new Group();
  private kind: Weather = 'clear';
  private rain: LineSegments | null = null;
  private snow: Points | null = null;
  private cover: Mesh | null = null;
  private pos: Float32Array = new Float32Array(0);
  private vel: Float32Array = new Float32Array(0);

  constructor() { this.group.frustumCulled = false; }

  set(kind: Weather, low: boolean): void {
    this.kind = kind;
    for (const o of [this.rain, this.snow, this.cover]) if (o) { this.group.remove(o); (o.geometry as BufferGeometry).dispose(); (o.material as { dispose(): void }).dispose(); }
    this.rain = this.snow = this.cover = null;
    if (kind === 'rain' || kind === 'snow') {
      const n = kind === 'rain' ? (low ? 700 : 1800) : (low ? 500 : 1200);
      this.pos = new Float32Array(n * 3);
      this.vel = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        this.pos[i * 3] = (Math.random() * 2 - 1) * BOX;
        this.pos[i * 3 + 1] = Math.random() * H;
        this.pos[i * 3 + 2] = (Math.random() * 2 - 1) * BOX;
        this.vel[i] = kind === 'rain' ? 16 + Math.random() * 6 : 1.2 + Math.random() * 1.2;
      }
    }
    if (kind === 'rain') {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(this.vel.length * 6), 3));
      this.rain = new LineSegments(g, new LineBasicMaterial({ color: 0xe4ecf5, transparent: true, opacity: 0.7, depthWrite: false, fog: false }));
      this.rain.frustumCulled = false;
      this.group.add(this.rain);
    } else if (kind === 'snow') {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(this.vel.length * 3), 3));
      this.snow = new Points(g, new PointsMaterial({ color: 0xffffff, size: 0.085, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending }));
      this.snow.frustumCulled = false;
      this.group.add(this.snow);
    }
    // Покриття дороги: мокрий асфальт / сніг / лід. Плоский шар трохи над землею, їде за камерою.
    const cov = kind === 'rain' ? { c: 0x0e141c, o: 0.3 } : kind === 'snow' ? { c: 0xf2f6fa, o: 0.62 } : kind === 'ice' ? { c: 0xb9dcf2, o: 0.34 } : null;
    if (cov) {
      const o = { color: new Color(cov.c), transparent: true, opacity: cov.o, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
      // Мокрий асфальт і лід віддзеркалюють небо (середовище сцени) — лише на середній/високій якості.
      const m: Material = !low && (kind === 'rain' || kind === 'ice') ? new MeshStandardMaterial({ ...o, roughness: kind === 'ice' ? 0.04 : 0.1, metalness: 0.2, envMapIntensity: 1.6 }) : new MeshBasicMaterial(o);
      this.cover = new Mesh(new PlaneGeometry(400, 400), m);
      this.cover.rotation.x = -Math.PI / 2;
      this.cover.renderOrder = 1;
      this.cover.frustumCulled = false;
      this.group.add(this.cover);
    }
  }

  // Щокадру: зсув опадів і покриття за камерою.
  update(dt: number, cam: Vector3): void {
    if (this.cover) this.cover.position.set(cam.x, 0.04, cam.z);
    const n = this.vel.length;
    if (!n || this.kind === 'clear') return;
    const t = performance.now() / 1000;
    for (let i = 0; i < n; i++) {
      let y = this.pos[i * 3 + 1]! - this.vel[i]! * Math.max(0, dt);
      if (y < 0 || y > H) { y = y < 0 ? y + H : Math.random() * H; this.pos[i * 3] = (Math.random() * 2 - 1) * BOX; this.pos[i * 3 + 2] = (Math.random() * 2 - 1) * BOX; }
      this.pos[i * 3 + 1] = y;
    }
    const wrap = (v: number, c: number): number => { let d = (v - c) % (2 * BOX); if (d > BOX) d -= 2 * BOX; else if (d < -BOX) d += 2 * BOX; return c + d; };
    if (this.rain) {
      const a = this.rain.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < n; i++) {
        const x = wrap(this.pos[i * 3]!, cam.x), z = wrap(this.pos[i * 3 + 2]!, cam.z), y = this.pos[i * 3 + 1]!;
        a.setXYZ(i * 2, x, y, z);
        a.setXYZ(i * 2 + 1, x + 0.08, y + 1.3, z + 0.03);
      }
      a.needsUpdate = true;
    } else if (this.snow) {
      const a = this.snow.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < n; i++) {
        const x = wrap(this.pos[i * 3]!, cam.x) + Math.sin(t * 0.8 + i) * 0.3, z = wrap(this.pos[i * 3 + 2]!, cam.z) + Math.cos(t * 0.7 + i * 1.3) * 0.3;
        a.setXYZ(i, x, this.pos[i * 3 + 1]!, z);
      }
      a.needsUpdate = true;
    }
  }
}
