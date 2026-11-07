import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const shots = [['night', 'route=1&tod=night&q=high'], ['evening', 'route=1&tod=evening&q=high'], ['rainhigh', 'route=1&w=rain&q=high'], ['parknight', 'park=parallel&tod=night&q=high'], ['park', 'park=garage&q=high&cam=chase']];
for (const [n, q] of shots) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(n + ' ' + String(e)));
  await page.goto('file://' + process.cwd() + '/dist/route7-3d.html?dbg=1&' + q);
  await page.waitForTimeout(9000);
  if (n.startsWith('park')) { await page.evaluate(() => document.getElementById('cam').click()); await page.waitForTimeout(1500); }
  await page.screenshot({ path: 'dist/tod-' + n + '.png' });
  await page.close();
}
console.log(errors);
await browser.close();
