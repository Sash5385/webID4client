// Жива зміна якості на високу на маршруті №1 (і заодно на №7): node tools/shot-r1-high.mjs [1|7]
import { chromium } from 'playwright';
const R = process.argv[2] || '1';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`file://${process.cwd()}/dist/route7-3d.html?route=${R}&q=low&auto=1&dbg=1&paused=1&seed=11`);
await page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 90000 });
await page.evaluate((R) => { const d = window.__dbg; d.pause(true); d.advanceUntil((s) => (R === '1' ? s.where.edge === 'stet_se_b' && s.where.s > 380 : s.t > 40), 900); window.__dbg.setQuality('high'); }, R);
await page.waitForTimeout(9000);
await page.screenshot({ path: `dist/r${R}-3d-high-switch.png` });
console.log(JSON.stringify(await page.evaluate(() => window.__dbg.stats())), 'errors:', errors);
await browser.close();
