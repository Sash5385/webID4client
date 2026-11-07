// Розвороти на вул. Мрії (маршрути 6 і 3): вид зверху й збоку. node tools/shot-uturn.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 700, height: 700 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const SHOTS = JSON.parse(process.argv[2]); // [[route, name, [px,py,pz], [lx,ly,lz]], ...]
for (const [route, name, p, l] of SHOTS) {
  await page.goto(`file://${process.cwd()}/dist/route7-3d.html?route=${route}&q=mid&dbg=1&paused=1&all=1&seed=5`);
  await page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 90000 });
  await page.evaluate(([p, l]) => { window.__dbg.cam({ p, l }); window.__dbg.advance(0.02); }, [p, l]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `dist/uturn-${name}.png` });
}
console.log('errors:', errors);
await browser.close();
