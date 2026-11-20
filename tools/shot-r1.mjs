// Знімки маршруту №1: node tools/shot-r1.mjs <2d|3d> [low|mid|high] [seed] [scene,scene...]
// Рушій розганяється автопілотом без рендера (?auto=1 &dbg=1 &paused=1), на місці — знімок 390x844.
import { chromium } from 'playwright';
const VIEW = process.argv[2] || '2d';
const Q = process.argv[3] || 'low';
const SEED = process.argv[4] || '11';
const ONLY = process.argv[5] ? process.argv[5].split(',') : null;
const file = VIEW === '3d' ? 'route7-3d.html' : 'route7-2d.html';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`file://${process.cwd()}/dist/${file}?route=1&q=${Q}&auto=1&dbg=1&paused=1&seed=${SEED}`);
await page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 90000 });
// Сцени по порядку проїзду: [назва, умова, додаткові секунди після умови]
const SCENES = [
  ['1-start', () => true, 0],
  ['2-stetsenka', (s) => s.where.edge === 'stet_se_b' && s.where.s > 380, 0],
  ['3-loop-marchenka', (s) => s.stage === 'uturn', 9],
  ['3b-stet-nw', (s) => s.where.edge === 'stet_nw_a' && s.where.s > 300, 0],
  ['4-turchyna-left', (s) => s.stage === 'leftTurn', 1.5],
  ['4b-turchyna-street', (s) => s.where.edge === 'tur_w' && s.where.s > 250, 0],
  ['4c-corner-right', (s) => s.stage === 'rightTurn', 2],
  ['5-mrii-north', (s) => s.where.edge === 'mrii_n_a' && s.where.s > 250, 0],
  ['6-ring-finish', (s) => s.stage === 'ring2' && s.where.mode === 'ring', 0],
];
for (const [name, cond, extra] of SCENES) {
  if (!ONLY || ONLY.includes(name) || ONLY.includes(name.split('-')[0])) {
    const ok = await page.evaluate(([c, extra]) => {
      const d = window.__dbg; d.pause(true);
      const f = eval('(' + c + ')');
      let r = f(d.sim()) ? true : d.advanceUntil(f, 900);
      if (r && extra) d.advance(extra);
      return r;
    }, [cond.toString(), extra]);
    if (!ok) { console.log(name, 'NOT REACHED'); continue; }
    await page.waitForTimeout(VIEW === '3d' ? 1800 : 300);
    await page.screenshot({ path: `dist/r1-${VIEW}-${Q}-${name}.png` });
    const info = await page.evaluate(() => { const s = window.__dbg.sim(); return `t=${s.t.toFixed(0)} stage=${s.stage} edge=${s.where.edge} s=${s.where.s.toFixed(0)} faults=${s.faults.length}`; });
    console.log(name, info);
  }
}
console.log('errors:', errors);
await browser.close();
