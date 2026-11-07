import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const r = await build({ entryPoints: ['src/demo/beauty.ts'], bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, loader: { '.glb': 'dataurl', '.png': 'dataurl' } });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/beauty.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Маршрут 7 · демо графіки</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}canvas{display:block}</style></head><body><script type="module">${js}</script></body></html>`);
console.log('beauty.html', (js.length / 1024).toFixed(0), 'KB');
