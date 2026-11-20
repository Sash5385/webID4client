#!/bin/bash
# Завантаження OSM для маршрутів ТСЦ № 8041 (56 тайлів 0.01°, lat 50.462–50.532, lon 30.480–30.560) у data/raw8041/.
# © OpenStreetMap contributors, ODbL 1.0. Запуск з кореня: bash tools/fetch-osm-8041.sh
mkdir -p data/raw8041 && cd data/raw8041 || exit 1
for i in 0 1 2 3 4 5 6 7; do for j in 0 1 2 3 4 5 6; do
  la=$(python3 -c "print(round(50.462+$i*0.01,3))"); lo=$(python3 -c "print(round(30.480+$j*0.01,3))")
  la2=$(python3 -c "print(round(50.462+($i+1)*0.01,3))"); lo2=$(python3 -c "print(round(30.480+($j+1)*0.01,3))")
  f=t_${i}_${j}.osm; [ -s $f ] && continue
  for try in 1 2 3; do
    curl -s -m 60 -A "ID4Drive-route-sim/0.1" "https://api.openstreetmap.org/api/0.6/map?bbox=$lo,$la,$lo2,$la2" -o $f && grep -q "<osm" $f && break
    rm -f $f; sleep 5
  done
done; done
