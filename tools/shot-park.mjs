import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const k of ['turn', 'parallel']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + process.cwd() + '/dist/route7-3d.html?q=mid&dbg=1&park=' + k);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'dist/park-' + k + '-top.png' });
  await page.evaluate(() => document.getElementById('cam').click()); await page.waitForTimeout(800);
  await page.screenshot({ path: 'dist/park-' + k + '-chase.png' });
  await page.close();
}
console.log('errors:', errors);
await browser.close();
