// Знімки «цікавих моментів» 3D: автопілот веде учня (?auto=1&dbg=1), поруч із об'єктом ставимо паузу й знімаємо
// вид ззаду + боковий крупний план (камера через window.__dbg.cam).
// Запуск: node tools/shot-3d-scenes.mjs [low|mid|high] [seed] [scene,scene,...]
import { chromium } from 'playwright';
const Q = process.argv[2] || 'low';
const SEED = process.argv[3] || '7';
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const load = async () => {
  await page.goto(`file://${process.cwd()}/dist/route7-3d.html?q=${Q}&auto=1&dbg=1&paused=1&seed=${SEED}`);
  await page.waitForFunction(() => window.__dbg && window.__dbg.ready(), null, { timeout: 60000 });
};

// Умови пошуку: fwd/lat — відносно курсу гравця.
const SCENES = {
  parked: { kind: 'car', pick: 'parked', fmin: 9, fmax: 16, lat: 9 },
  broken: { kind: 'car', pick: 'broken', fmin: 22, fmax: 30, lat: 9 },
  broken2: { kind: 'car', pick: 'broken', fmin: 7, fmax: 12, lat: 9, skip: 1 },
  turner: { kind: 'car', pick: 'turn', fmin: 6, fmax: 18, lat: 9 },
  rider: { kind: 'rider', fmin: 5, fmax: 12, lat: 6 },
  crowd: { kind: 'crowd', fmin: 4, fmax: 22, lat: 14, n: 3 },
  jay: { kind: 'ped', pick: 'jaywalker', fmin: 4, fmax: 28, lat: 12 },
  stop: { kind: 'stop', fmin: 8, fmax: 20 },
  drive: { kind: 'drive', fmin: 6, fmax: 22 },
};
let first = true;
for (const [name, sc] of Object.entries(SCENES)) {
  if (ONLY && !ONLY.includes(name)) continue;
  await load(); // кожна сцена з чистого старту (ті самі seed і автопілот)
  const found = await page.evaluate(({ sc, skip }) => {
    const d = window.__dbg;
    let seenSkip = 0;
    const test = (s) => {
      const p = s.player, hx = Math.sin(p.a), hz = -Math.cos(p.a), rx = Math.cos(p.a), rz = Math.sin(p.a);
      const rel = (o) => { const dx = o.x - p.x, dz = o.z - p.z; return { f: dx * hx + dz * hz, l: dx * rx + dz * rz }; };
      const ok = (o) => { const r = rel(o); return r.f > sc.fmin && r.f < sc.fmax && Math.abs(r.l) < (sc.lat ?? 10); };
      let t = null;
      if (sc.kind === 'car') t = s.traffic.cars.find((c) => ok(c) && (sc.pick === 'turn' ? c.turn !== 0 && c.kind === 'car' : c.kind === sc.pick));
      else if (sc.kind === 'rider') t = s.riders.list.find(ok);
      else if (sc.kind === 'ped') t = s.peds.list.find((q) => q.kind === sc.pick && ok(q));
      else if (sc.kind === 'crowd') { const g = s.peds.list.filter((q) => q.kind === 'crossing' && q.started && ok(q)); if (g.length >= sc.n) t = g[0]; }
      else if (sc.kind === 'stop') t = s.net.busStops.map((b) => ({ x: b.sign * 9, z: b.worldZ })).find(ok);
      else if (sc.kind === 'drive') t = s.net.driveways.map((b) => ({ x: b.sign * 10, z: b.worldZ })).find(ok);
      if (t && sc.kind === 'car' && sc.skip && seenSkip++ < sc.skip) return false;
      if (t) window.__tgt = { x: t.x, z: t.z, a: t.a ?? 0, id: t.id ?? 0, t: s.t, kind: sc.kind === 'stop' || sc.kind === 'drive' ? sc.kind : '' };
      return !!t;
    };
    d.pause(true);
    const ok = d.advanceUntil(test, 600);
    return ok ? window.__tgt : null;
  }, { sc, skip: sc.skip ?? 0 });
  if (!found) { console.log(name, 'not found'); continue; }
  console.log(name, JSON.stringify(found));
  // Вид ззаду (камера гравця) і крупний план збоку.
  await page.evaluate(() => window.__dbg.cam(null));
  await page.waitForTimeout(first ? 2500 : 1800); first = false;
  await page.screenshot({ path: `dist/sc-${Q}-${name}-chase.png` });
  const side = await page.evaluate(() => {
    const t = window.__tgt, p = window.__dbg.sim().player;
    // камера збоку від об'єкта з боку гравця (+ трохи ззаду), на висоті ока
    const ang = t.a;
    const hx = Math.sin(ang), hz = -Math.cos(ang), rx = Math.cos(ang), rz = Math.sin(ang);
    const side = (p.x - t.x) * rx + (p.z - t.z) * rz > 0 ? 1 : -1;
    if (t.kind) { // ділянка з тротуаром/двором: камера зверху-збоку з боку дороги, дивимось на об'єкт
      const sg = Math.sign(t.x) || 1;
      window.__dbg.cam({ p: [t.x - sg * 12, 6, t.z - 14], l: [t.x + sg * 3, 0, t.z + 2] });
      return true;
    }
    window.__dbg.cam({ p: [t.x + rx * side * 8 - hx * 5, 2.0, t.z + rz * side * 8 - hz * 5], l: [t.x, 0.8, t.z] });
    return true;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `dist/sc-${Q}-${name}-side.png` });
  await page.evaluate(() => window.__dbg.cam(null));
}
console.log('errors:', errors);
await browser.close();
