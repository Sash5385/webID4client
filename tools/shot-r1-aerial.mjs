// Огляд маршруту №1 з висоти (?all=1 показує всі комірки): node tools/shot-r1-aerial.mjs [low|mid|high] [name,...]
import { chromium } from 'playwright';
const Q = process.argv[2] || 'mid';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`file://${process.cwd()}/dist/route7-3d.html?route=1&q=${Q}&dbg=1&paused=1&all=1&seed=5`);
await page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 90000 });
// [назва, ціль x,z, зсув камери dx,h,dz]
const VIEWS = {
  ring: [0, 0, 60, 45, 60], ring2: [0, 0, -50, 25, -50], tur: [553, 447, 50, 40, 50], tur2: [553, 447, -45, 30, 40], loop: [830, 660, 60, 50, 20], mt: [0, 554, 40, 30, 40], vyh: [712, 517, 55, 45, 55],
  start: [-30, -20, 45, 30, 35], bld: [-120, 120, 60, 40, 60],
};
// Крупні плани з явною камерою: [pos, look]. head — голова світлофора, що дивиться на водія (курс a).
const hd = (x, z, a, back, h, side = 0) => [[x - Math.sin(a) * back + Math.cos(a) * side, h, z + Math.cos(a) * back + Math.sin(a) * side], [x, 3.5, z]];
const CLOSE = {
  head: hd(746.04, 616.6, 2.26528, 16, 3.0),
  pedhead: hd(556.44, 425.12, -2.37094, 14, 2.6, -3),
  bus: [[617.75 + 8, 4, 508.84 - 10], [617.75, 1.2, 508.84]],
  sign: hd(43.42, -6.55, -0.88101, 12, 2.5),
  zebra: [[75.27 - 12, 6, 40.92 + 8], [78, 0, 38]],
  uturn: [[800, 18, 600], [820, 0, 650]],
};
const ALL = [...Object.entries(VIEWS).map(([n, [x, z, dx, h, dz]]) => [n, [x + dx, h, z + dz], [x, 0, z]]), ...Object.entries(CLOSE).map(([n, [p, l]]) => [n, p, l])];
for (const [name, p, l] of ALL) {
  if (ONLY && !ONLY.includes(name)) continue;
  await page.evaluate(([p, l]) => { window.__dbg.cam({ p, l }); window.__dbg.advance(0.02); }, [p, l]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `dist/r1-aerial-${Q}-${name}.png` });
}
console.log('errors:', errors);
await browser.close();
