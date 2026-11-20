import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const f of ['route7-2d', 'route7-3d']) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => {
    const AC = window.AudioContext; let made = 0, osc = 0;
    window.AudioContext = class extends AC { constructor() { super(); made++; window.__ac = this; } createOscillator() { osc++; window.__osc = osc; return super.createOscillator(); } };
    window.__made = () => made;
  });
  await p.goto('file://' + process.cwd() + `/dist/${f}.html?auto=1`);
  await p.waitForTimeout(1500);
  await p.mouse.click(200, 400);
  await p.waitForTimeout(4000);
  const r = await p.evaluate(() => ({ ctx: window.__ac && window.__ac.state, osc: window.__osc, t: window.__ac && Math.round(window.__ac.currentTime * 10) / 10, icon: document.getElementById('sound').textContent }));
  await p.click('#sound'); const m = await p.evaluate(() => document.getElementById('sound').textContent);
  console.log(f, JSON.stringify(r), 'after toggle:', m, 'errors:', errs);
}
await b.close();
