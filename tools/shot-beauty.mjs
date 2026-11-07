import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, w, h, dpr] of [['phone', 390, 844, 2], ['wide', 1280, 720, 1.5]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto('file://' + process.cwd() + '/dist/beauty.html');
  await page.waitForFunction(() => window.__done === true, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `dist/beauty-${name}.png` });
  console.log(name, 'errors:', errs);
  await page.close();
}
await browser.close();
