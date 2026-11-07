import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const w of ['rain', 'snow', 'ice']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + process.cwd() + '/dist/route7-3d.html?q=mid&route=route1&dbg=1&w=' + w);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'dist/wx-' + w + '.png' });
  await page.close();
}
console.log('errors:', errors);
await browser.close();
