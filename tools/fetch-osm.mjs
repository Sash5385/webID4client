// Скачування даних OpenStreetMap для маршруту №7 (вул. Мрії, Київ).
// Запуск (PowerShell, Node 18+):
//   node fetch-osm.mjs
// Результат: route7-osm-raw.json поруч зі скриптом. Його треба надіслати назад у чат.
// Дані: © OpenStreetMap contributors, ODbL.

import { writeFileSync } from 'node:fs';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'ID4Drive-route7-sim/0.1 (personal training project)';
const KYIV = '50.21,30.24,50.59,30.83'; // грубий bbox Києва

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  return res.json();
}

// 1) Знайти вулицю Мрії та визначити її межі.
console.log('Шукаю вулицю Мрії...');
const street = await overpass(`[out:json][timeout:60];way["highway"]["name"~"Мрії"](${KYIV});out geom;`);
const ways = street.elements.filter((e) => e.type === 'way' && e.geometry);
if (!ways.length) throw new Error('Вулицю Мрії не знайдено. Перевірте назву в OSM.');
let s = 90, w = 180, n = -90, e = -180;
for (const way of ways) for (const p of way.geometry) {
  s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon);
}
const pad = 0.004; // ~300-400 м запасу (кільце на півночі, розворот на півдні)
const bbox = `${(s - pad).toFixed(5)},${(w - pad).toFixed(5)},${(n + pad).toFixed(5)},${(e + pad).toFixed(5)}`;
console.log('Знайдено частин вулиці:', ways.length, 'bbox:', bbox);

// 2) Усе потрібне в цих межах.
console.log('Завантажую дороги, світлофори, переходи, будинки...');
const data = await overpass(`[out:json][timeout:90];
(
  way["highway"](${bbox});
  node["highway"="traffic_signals"](${bbox});
  node["highway"="crossing"](${bbox});
  node["highway"="give_way"](${bbox});
  node["highway"="stop"](${bbox});
  way["building"](${bbox});
  way["junction"="roundabout"](${bbox});
);
out body; >; out skel qt;`);

writeFileSync(new URL('./route7-osm-raw.json', import.meta.url), JSON.stringify({ bbox, fetchedAt: new Date().toISOString(), data }));
console.log('Готово: route7-osm-raw.json, елементів:', data.elements.length);
