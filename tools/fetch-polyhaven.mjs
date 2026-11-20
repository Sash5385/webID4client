// Завантажує CC0-ресурси Poly Haven і готує їх для вшивання в HTML: node tools/fetch-polyhaven.mjs
// (потрібні curl і ImageMagick `convert`). Результат: public/polyhaven/*.jpg|hdr (лише вони йдуть у git; сирі файли в tmp).
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = 'public/polyhaven';
mkdirSync(OUT, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'ph-'));
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const api = (path) => JSON.parse(sh('curl', ['-sSf', '--max-time', '60', 'https://api.polyhaven.com/' + path]));

// [id, ключ, {diff:[розмір,якість], nor:[...], rough:[...]}]
const TEX = [
  ['asphalt_04', 'asphalt', { diff: [1024, 78], nor: [1024, 82], rough: [512, 70] }],
  ['large_square_pattern_01', 'paving', { diff: [512, 78], nor: [512, 82], rough: [512, 70] }],
  ['leafy_grass', 'grass', { diff: [1024, 78] }],
  ['concrete_wall_008', 'concrete', { diff: [1024, 80], nor: [1024, 82], rough: [512, 70] }],
];
const MAPS = { diff: 'Diffuse', nor: 'nor_gl', rough: 'Rough' };
for (const [id, key, maps] of TEX) {
  const files = api('files/' + id);
  for (const [m, [size, q]] of Object.entries(maps)) {
    const raw = join(tmp, `${id}_${m}.jpg`);
    sh('curl', ['-sSf', '--max-time', '120', '-o', raw, files[MAPS[m]]['1k'].jpg.url]);
    const extra = m === 'rough' ? ['-colorspace', 'Gray'] : [];
    sh('convert', [raw, '-resize', `${size}x${size}`, ...extra, '-strip', '-interlace', 'none', '-sampling-factor', '4:2:0', '-quality', String(q), `${OUT}/${key}_${m}.jpg`]);
  }
}
// HDRI: небо без наземних обʼєктів («puresky»), 1k .hdr
const HDRI = 'qwantani_afternoon_puresky';
const hf = api('files/' + HDRI);
sh('curl', ['-sSf', '--max-time', '120', '-o', join(tmp, 'sky.hdr'), hf.hdri['1k'].hdr.url]);
copyFileSync(join(tmp, 'sky.hdr'), `${OUT}/sky.hdr`);
for (const f of ['asphalt', 'paving', 'grass', 'concrete'].flatMap((k) => ['diff', 'nor', 'rough'].map((m) => `${k}_${m}.jpg`)).concat('sky.hdr')) {
  try { console.log(f, (statSync(`${OUT}/${f}`).size / 1024).toFixed(0), 'KB'); } catch { /* немає такої карти */ }
}
