// Налагоджувальні знімки зверху: node tools/shot-3d-top.mjs  (?top=H піднімає камеру)
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + process.cwd() + '/dist/route7-3d.html?top=70');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'dist/3d-top-1.png' });
await page.click('#sigR');
const gas = await page.$('#gas'); const b = await gas.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
await page.waitForTimeout(7000);
await page.screenshot({ path: 'dist/3d-top-2.png' });
await page.mouse.up();
console.log(errors);
await browser.close();
