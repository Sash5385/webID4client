// Процедурні текстури (без файлів): асфальт, плитка тротуару, трава, фасад панельки, крона дерева. Створюються один раз.
import { CanvasTexture, IcosahedronGeometry, RepeatWrapping, SRGBColorSpace, type BufferGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

let seed = 42;
const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const R = (a: number, b: number): number => a + (b - a) * rnd();

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, aniso = 8): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = SRGBColorSpace;
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

// Базові тони підібрані так, щоб разом із білим кольором вершин виходив той самий вигляд, що й у плоскому режимі.
export const asphaltTex = (): CanvasTexture => canvasTex(512, 512, (g) => {
  speckle(g, 512, 512, [88, 92, 100], 20, 22000, [1, 2.5]);
  for (let i = 0; i < 10; i++) {
    g.fillStyle = `rgba(50,52,58,${R(0.1, 0.25)})`;
    g.beginPath(); g.ellipse(R(0, 512), R(0, 512), R(10, 50), R(6, 24), R(0, 3), 0, 7); g.fill();
  }
});
export const pavingTex = (): CanvasTexture => canvasTex(256, 256, (g) => {
  speckle(g, 256, 256, [208, 204, 195], 12, 4000, [1, 2]);
  g.strokeStyle = 'rgba(110,105,98,0.6)'; g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
});
export const grassTex = (): CanvasTexture => canvasTex(256, 256, (g) => {
  speckle(g, 256, 256, [158, 212, 134], 22, 12000, [1, 3]);
  for (let i = 0; i < 16; i++) { g.fillStyle = `rgba(${R(150, 190) | 0},${R(190, 215) | 0},110,0.25)`; g.beginPath(); g.arc(R(0, 256), R(0, 256), R(8, 30), 0, 7); g.fill(); }
}, 4);

// Плитка фасаду: FACADE_COLS колонок × FACADE_FLOORS поверхів (балкони через кожні 3 колонки). 1 колонка = 2.9 м, 1 поверх = 2.85 м.
export const FACADE_COLS = 6, FACADE_FLOORS = 4, FACADE_W = 2.9, FACADE_H = 2.85;
// overlay=true: прозорий фон (лише вікна, балкони, шви поверхів) у подвійному розширенні; бетон під ним — фото Poly Haven.
export const facadeTex = (overlay = false): CanvasTexture => {
  const k = overlay ? 2 : 1, cw = 48, fh = 60, W = FACADE_COLS * cw, H = FACADE_FLOORS * fh;
  return canvasTex(W * k, H * k, (g) => {
    g.scale(k, k);
    if (!overlay) {
      g.fillStyle = 'rgb(236,232,224)'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${R(0.02, 0.06)})`; g.fillRect(R(0, W), R(0, H), R(2, 10), R(2, 10)); }
    }
    g.strokeStyle = 'rgba(0,0,0,0.14)'; g.lineWidth = 1.5;
    for (let f = 0; f <= FACADE_FLOORS; f++) { g.beginPath(); g.moveTo(0, f * fh); g.lineTo(W, f * fh); g.stroke(); }
    for (let f = 0; f < FACADE_FLOORS; f++) {
      for (let c = 0; c < FACADE_COLS; c++) {
        const x = c * cw + 9, y = f * fh + 13, sky = R(0, 1);
        g.fillStyle = `rgb(${70 + sky * 50 | 0},${88 + sky * 55 | 0},${110 + sky * 60 | 0})`;
        g.fillRect(x, y, cw - 18, fh - 24);
        g.fillStyle = 'rgba(245,245,240,0.85)'; g.fillRect(x + (cw - 18) / 2 - 1, y, 2, fh - 24);
        if (c % 3 === 1) { // балкон
          g.fillStyle = f % 2 ? 'rgba(210,206,198,0.98)' : 'rgba(170,190,205,0.98)';
          g.fillRect(x - 6, y + fh - 38, cw - 6, 20);
        }
      }
    }
  }, overlay ? 8 : 4);
};

// Крона-«крапля»: ікосаедр із легким спотворенням і згладженими нормалями.
export function blobGeometry(): BufferGeometry {
  const ico = new IcosahedronGeometry(1, 2);
  ico.deleteAttribute('uv'); ico.deleteAttribute('normal');
  const g = mergeVertices(ico);
  const p = g.attributes['position']!;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (Math.sin(p.getX(i) * 5.1) + Math.cos(p.getY(i) * 4.3) + Math.sin(p.getZ(i) * 6.7)) * 0.08;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
