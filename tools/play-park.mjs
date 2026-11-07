import { chromium } from 'playwright';
const segs = JSON.parse(process.argv[3]);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + process.cwd() + '/dist/route7-3d.html?q=low&dbg=1&park=' + process.argv[2]);
await page.waitForTimeout(2000);
await page.evaluate(() => window.__dbg.pause(false));
const gas = await (await page.$('#gas')).boundingBox();
const setSteer = (v) => page.evaluate((v) => { const e = document.getElementById('steer'); e.value = String(Math.round(v * 100)); e.dispatchEvent(new Event('input')); }, v);
for (const g of segs) {
  const rev = await page.evaluate(() => document.getElementById('gear').classList.contains('rev'));
  if (rev !== g.rev) await page.click('#gear');
  await setSteer(g.steer);
  await page.mouse.move(gas.x + 20, gas.y + 20); await page.mouse.down();
  await page.waitForTimeout(g.sec * 1000);
  await page.mouse.up();
}
await page.mouse.move(60, 780); await page.mouse.down(); const br = await (await page.$('#brake')).boundingBox();
await page.mouse.up(); await page.mouse.move(br.x + 20, br.y + 20); await page.mouse.down();
await page.waitForTimeout(6000);
await page.screenshot({ path: 'dist/park-' + process.argv[2] + '-play.png' });
console.log(await page.evaluate(() => document.getElementById('resTitle').textContent + ' | ' + document.getElementById('resReason').textContent), errors);
await browser.close();
