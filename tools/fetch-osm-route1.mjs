// Завантаження сирих даних OSM для маршруту №1 (лише якщо data/raw/*.osm відсутні): node tools/fetch-osm-route1.mjs
// API OSM 0.6 /map (≤ 50 000 вузлів на запит), з паузою між запитами. © OpenStreetMap contributors, ODbL 1.0.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const TILES = {
  'tile-a': [30.390, 50.455, 30.405, 50.490],
  'tile-b': [30.405, 50.455, 30.420, 50.490],
  'tile-c': [30.420, 50.455, 30.435, 50.490],
  'tile-d': [30.435, 50.455, 30.450, 50.490],
  'map-route1': [30.385, 50.452, 30.420, 50.480],
  'tile-n1': [30.400, 50.489, 30.412, 50.495], // Виговського на північ до «Влади» (маршрут №14)
};
mkdirSync('data/raw', { recursive: true });
for (const [name, bb] of Object.entries(TILES)) {
  const out = `data/raw/${name}.osm`;
  if (existsSync(out)) { console.log('є', out); continue; }
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${bb.join(',')}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ID4Drive-route-sim/0.1' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(out, await res.text());
  console.log('завантажено', out);
  await new Promise((r) => setTimeout(r, 3000));
}
