const { chromium } = require('playwright');
let bad = 0;
(async () => {
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
for (const n of [1, 2, 3, 4, 5]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`file://${process.cwd()}/dist/route7-3d.html?dbg=1&q=low&route=8041.${n}&seed=1`);
  await page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 120000 });
  const info = await page.evaluate(() => { const s = window.__dbg.sim(); return { route: s.route, steps: s.steps_.length, label: document.getElementById('rt').textContent }; });
  await page.evaluate(() => window.__dbg.advance(25));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `work8041/shot${n}.png` });
  console.log(n, JSON.stringify(info), 'errors', JSON.stringify(errors));
  if (errors.length) bad++;
  await ctx.close();
}
// picker
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`file://${process.cwd()}/dist/route7-3d.html?dbg=1&q=low`);
  await page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 120000 });
  await page.click('#rt'); await page.waitForTimeout(200);
  await page.click('#pick-r8041_3'); await page.waitForTimeout(1500);
  console.log('picked', await page.evaluate(() => window.__dbg.sim().route), await page.textContent('#rt'));
  await page.screenshot({ path: 'work8041/shotp.png' });
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
})();
