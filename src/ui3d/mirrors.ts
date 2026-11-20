// Дзеркала заднього виду: ліве, праве, салонне. Кожне — окремий рендер сцени з точки на авто назад у малу текстуру,
// потім кадр дзеркально відображається по горизонталі й малюється в куток екрана (scissor).
// За кадр оновлюється одне дзеркало (по колу) — додаткове навантаження ~1 малий рендер на кадр. Лише вигляд: на правила не впливає.
import { Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3, WebGLRenderTarget, type WebGLRenderer } from 'three';

interface Rect { x: number; y: number; w: number; h: number }
interface Mir { cam: PerspectiveCamera; rt: WebGLRenderTarget; el: HTMLElement; mat: ShaderMaterial; quad: Mesh; rect: Rect; side: -1 | 0 | 1 }

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;
const FRAG = `uniform sampler2D map; varying vec2 vUv;
void main(){
  gl_FragColor = vec4(texture2D(map, vec2(1.0 - vUv.x, vUv.y)).rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Mirrors {
  private readonly ms: Mir[] = [];
  private readonly qs = new Scene();
  private readonly qcam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private W = 0; private H = 0;
  private readonly tmp = new Vector3();

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, stage: HTMLElement) {
    // [бік, fov, ширина текстури, висота текстури]: ліве, праве, салонне
    const defs: [-1 | 0 | 1, number, number, number, string][] = [[-1, 38, 192, 140, 'mirL'], [1, 38, 192, 140, 'mirR'], [0, 22, 320, 82, 'mirC']];
    for (const [side, fov, tw, th, id] of defs) {
      const rt = new WebGLRenderTarget(tw, th, { depthBuffer: true });
      const mat = new ShaderMaterial({ uniforms: { map: { value: rt.texture } }, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
      const quad = new Mesh(new PlaneGeometry(1, 1), mat);
      quad.frustumCulled = false;
      const el = document.createElement('div');
      el.className = 'mirror'; el.id = id; el.setAttribute('aria-hidden', 'true');
      stage.appendChild(el);
      this.ms.push({ cam: new PerspectiveCamera(fov, tw / th, 0.3, 200), rt, el, mat, quad, rect: { x: 0, y: 0, w: 1, h: 1 }, side });
    }
  }

  // Розкладка в CSS-пікселях відносно полотна (полотно займає всю сцену).
  layout(W: number, H: number): void {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    const sw = Math.round(Math.min(112, W * 0.27)), sh = Math.round(sw * 0.73), sy = 8; // бокові дзеркала — угорі, на одному рівні з салонним
    const cw = Math.round(Math.min(190, W * 0.44)), ch = Math.round(cw * 0.25);
    const rects: Rect[] = [{ x: 6, y: sy, w: sw, h: sh }, { x: W - sw - 6, y: sy, w: sw, h: sh }, { x: Math.round((W - cw) / 2), y: 6, w: cw, h: ch }];
    this.ms.forEach((m, i) => {
      const r = rects[i]!; m.rect = r;
      m.el.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
      m.cam.aspect = r.w / r.h; m.cam.updateProjectionMatrix();
    });
  }

  setHidden(h: boolean): void { for (const m of this.ms) m.el.hidden = h; }

  // p — поза гравця; frame — лічильник кадрів; setPlayerVisible — ховає власне авто на час рендера дзеркала.
  render(p: { x: number; z: number; a: number }, frame: number, far: number, playerHidden: boolean, setPlayerVisible: (v: boolean) => void, hideExtra?: (hide: boolean) => void): void {
    const r = this.renderer;
    const hx = Math.sin(p.a), hz = -Math.cos(p.a), rx = Math.cos(p.a), rz = Math.sin(p.a);
    const m = this.ms[frame % 3]!;
    // позиція й напрямок «назад» (бічні трохи розвернуті назовні)
    const fwd = m.side === 0 ? -0.2 : 0.9, lat = m.side === 0 ? 0 : m.side * 1.0, y = m.side === 0 ? 1.3 : 1.05;
    const px = p.x + hx * fwd + rx * lat, pz = p.z + hz * fwd + rz * lat;
    m.cam.position.set(px, y, pz);
    const out = m.side * 0.22;
    m.cam.lookAt(this.tmp.set(px - hx + rx * out, y - 0.04, pz - hz + rz * out));
    m.cam.far = far; m.cam.updateProjectionMatrix();
    const ac = r.autoClear, au = r.shadowMap.autoUpdate;
    r.autoClear = true; r.shadowMap.autoUpdate = false; // тіні не перераховуємо: беремо з основного кадру
    setPlayerVisible(false); hideExtra?.(true);
    r.setRenderTarget(m.rt); r.render(this.scene, m.cam); r.setRenderTarget(null);
    setPlayerVisible(!playerHidden); hideExtra?.(false);
    r.shadowMap.autoUpdate = au;
    // малюємо всі три в кутки (scissor)
    r.autoClear = false; r.setScissorTest(true);
    for (const q of this.ms) {
      const { x, y: ty, w, h } = q.rect, vy = this.H - ty - h;
      r.setViewport(x, vy, w, h); r.setScissor(x, vy, w, h);
      this.qs.clear(); this.qs.add(q.quad);
      r.render(this.qs, this.qcam);
    }
    r.setScissorTest(false); r.setViewport(0, 0, this.W, this.H); r.autoClear = ac;
  }
}
