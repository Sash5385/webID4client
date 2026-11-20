import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = []; 
for (const q of ['route=1', 'park=parallel']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('file://' + process.cwd() + '/dist/route7-3d.html?q=low&dbg=1&gb=manual&' + q);
  await page.waitForTimeout(5000);
  const cl = await (await page.$('#clutch')).boundingBox();
  await page.mouse.move(cl.x + 10, cl.y + 10); await page.mouse.down(); await page.waitForTimeout(600);
  await page.click('#gUp'); await page.waitForTimeout(300);
  await page.screenshot({ path: 'dist/gb-' + q.split('=')[0] + '.png' });
  console.log(q, await page.evaluate(() => document.getElementById('gInd').textContent));
  await page.close();
}
console.log(errors);
await browser.close();
