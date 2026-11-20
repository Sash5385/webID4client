// Имитация просмотрщика артефактов: fetch() по data: запрещён. Использование: node tools/shot-3d-csp.mjs [1|7] [artifact]
// (без аргумента — маршрут 7; 1 — маршрут 1: dist/3d-csp-r1.png)
import { chromium } from 'playwright';
const ROUTE = process.argv[2] === '1' ? '1' : '7', FILE = process.argv[3] === 'artifact' ? 'route7-3d-artifact.html' : 'route7-3d.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => {
  const f = window.fetch.bind(window);
  window.fetch = (i, o) => { const u = typeof i === 'string' ? i : i.url; if (String(u).startsWith('data:')) return Promise.reject(new TypeError('Refused to connect (CSP simulated)')); return f(i, o); };
});
await page.goto('file://' + process.cwd() + '/dist/' + FILE + '?q=low&route=' + ROUTE);
await page.waitForTimeout(2500);
await page.screenshot({ path: ROUTE === '1' ? 'dist/3d-csp-r1.png' : 'dist/3d-csp.png' });
console.log('errors:', errors);
await browser.close();
