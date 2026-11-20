// Draw calls / трикутники / час побудови світу: node tools/stats-r1.mjs <1|7> [low|mid|high]
import { chromium } from 'playwright';
const R = process.argv[2] || '1', Q = process.argv[3] || 'mid';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto(`file://${process.cwd()}/dist/route7-3d.html?route=${R}&q=${Q}&auto=1&dbg=1&paused=1&seed=11`);
await page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 90000 });
const spots = [['start', () => true], ['stet', (s) => s.where.edge === 'stet_se_b' && s.where.s > 380], ['loop', (s) => s.stage === 'uturn'], ['tur', (s) => s.stage === 'leftTurn'], ['mrii', (s) => s.where.edge === 'mrii_n_a' && s.where.s > 250]];
for (const [n, c] of spots) {
  if (R === '7' && n !== 'start' && n !== 'stet') continue;
  await page.evaluate((c) => { const d = window.__dbg; d.pause(true); const f = eval('(' + c + ')'); if (!f(d.sim())) d.advanceUntil(f, 900); }, c.toString());
  await page.evaluate(() => window.__dbg.pause(false)); await page.waitForTimeout(1500); await page.evaluate(() => window.__dbg.pause(true)); await page.waitForTimeout(600);
  console.log(R, Q, n, JSON.stringify(await page.evaluate(() => window.__dbg.stats())));
}
await browser.close();
