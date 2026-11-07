// Перевірка вибору маршруту: кнопка, збереження, ?route=, перезапуск. node tools/check-picker.mjs [file.html ...]
import { chromium } from 'playwright';
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['route7-2d.html', 'route7-artifact.html', 'route7-3d.html', 'route7-3d-artifact.html'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const f of files) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `file://${process.cwd()}/dist/${f}`;
  const ready = () => page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 60000 });
  const route = () => page.evaluate(() => window.__dbg.sim().route);
  const seed = () => page.evaluate(() => window.__dbg.sim().cfg.seed);
  const out = [];
  await page.goto(url + '?dbg=1&q=low'); await ready();
  out.push(['default', await route()]);
  const s0 = await seed();
  await page.click('#rt'); await page.waitForTimeout(100);
  out.push(['picker open', await page.evaluate(() => !document.getElementById('picker').hidden)]);
  await page.click('#pick-route1'); await page.waitForTimeout(800);
  out.push(['after pick 1', await route(), 'seed changed', (await seed()) !== s0, 'label', await page.textContent('#rt'), 'picker closed', await page.evaluate(() => document.getElementById('picker').hidden)]);
  await page.goto(url + '?dbg=1&q=low'); await ready();
  out.push(['reload remembers', await route()]);
  await page.goto(url + '?dbg=1&q=low&route=7'); await ready();
  out.push(['?route=7 overrides', await route()]);
  await page.click('#rt'); await page.click('#pick-route1'); await page.waitForTimeout(500);
  out.push(['pick1 via url-param page', await route(), 'url', new URL(page.url()).search.includes('route=1')]);
  await page.click('#rt'); await page.click('#pick-route7'); await page.waitForTimeout(500);
  out.push(['pick 7 back', await route(), 'turn visible', await page.evaluate(() => !document.getElementById('turn').hidden && document.getElementById('turnL').hidden)]);
  console.log(f, JSON.stringify(out), 'errors', errors);
  if (errors.length) bad++;
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
