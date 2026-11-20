// Збірка 2D-тренажера в один HTML (без мережі): node tools/build-2d.mjs
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const res = await build({ entryPoints: ['src/ui2d/main.ts'], bundle: true, minify: true, format: 'iife', target: 'es2019', write: false });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync('src/ui2d/page.html', 'utf8').replace('%%SCRIPT%%', () => js);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/route7-artifact.html', page);
writeFileSync('dist/route7-2d.html', '<!doctype html>\n<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + page.replace('<div id="app">', '</head><body><div id="app">') + '\n</body></html>\n');
console.log('dist/route7-2d.html', (page.length / 1024).toFixed(1), 'KB');
