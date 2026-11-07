import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const shots = [['day', 'route=1&q=high', [0, 3.2, -6.5]], ['dayside', 'route=1&q=high', [5, 1.6, 0]], ['night', 'route=1&tod=night&q=high', null]];
for (const [n, q, cam] of shots) {
  const page = await browser.newPage({ viewport: { width: 700, height: 500 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(n + ' ' + String(e)));
  await page.goto('file://' + process.cwd() + '/dist/route7-3d.html?dbg=1&paused=1&' + q);
  await page.waitForTimeout(8000);
  if (cam) {
    await page.evaluate(([c]) => { const s = window.__dbg.sim(); const p = s.player; window.__dbg.cam({ p: [p.x + c[0] * Math.cos(p.a) - c[2] * Math.sin(p.a) * 0 + (c[2]) * Math.sin(p.a) * -1 * 0, c[1], p.z + 0], l: [p.x, 0.9, p.z] }); }, [cam]);
    // кут: камера спереду-збоку від авто
    await page.evaluate(([c]) => { const s = window.__dbg.sim(); const p = s.player; const fx = Math.sin(p.a), fz = -Math.cos(p.a), rx = Math.cos(p.a), rz = Math.sin(p.a); window.__dbg.cam({ p: [p.x + rx * c[0] + fx * c[2], c[1], p.z + rz * c[0] + fz * c[2]], l: [p.x, 0.9, p.z] }); }, [cam]);
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: 'dist/car-' + n + '.png' });
  await page.close();
}
console.log(errors);
await browser.close();
