#!/usr/bin/env python3
"""District colours on top of the per-house palette, from street photos and the city's look:
  Nyboder              Christian IV's sailors' rows: ochre-yellow render, red tile roofs
  Christianshavn       18th-century merchant houses and warehouses: dark red-brown brick, white frames,
                       with some ochre and grey render
  Frederiksstaden      Eigtved's grey, sand and pale ochre palace fronts, slate and copper roofs
Sets part color/roofColor in public/cities/<id>/buildings3d-index.json (run after kk-buildings.py).
  python3 scripts/district-styles.py copenhagen"""
import json, sys, hashlib
from pyproj import Transformer
from shapely.geometry import Polygon, Point
cid = sys.argv[1]; P = f'public/cities/{cid}/buildings3d-index.json'
reg = next(c for c in json.load(open('public/cities/index.json'))['cities'] if c['id'] == cid)
f = Transformer.from_crs('EPSG:4326', reg['projection'], always_xy=True)
poly = lambda pts: Polygon([(lambda p: (p[0], -p[1]))(f.transform(lo, la)) for lo, la in pts])
D = {
 'nyboder': (poly([(12.5838, 55.6879), (12.5905, 55.6900), (12.5925, 55.6885), (12.5858, 55.6862)]), ['#e6b13c', '#e3ab35', '#dca63a', '#e8b84a'], ['#9a4630', '#8e3f2b']),
 'christianshavn': (poly([(12.5840, 55.6712), (12.5905, 55.6690), (12.5960, 55.6715), (12.5985, 55.6760), (12.5915, 55.6785), (12.5862, 55.6745)]),
    ['#6e3a2c', '#7a4030', '#5f3427', '#8a4a35', '#d9b26f', '#bdb6a6', '#6a3a2e'], ['#8e3f2b', '#5a5f66', '#9a4630']),
 'frederiksstaden': (poly([(12.5870, 55.6830), (12.5935, 55.6812), (12.5985, 55.6858), (12.5925, 55.6878)]), ['#d9cfbf', '#cfc4ae', '#e3d3a8', '#bfb7a6', '#d8c49a'], ['#4b4f55', '#6f8f7a', '#5a5f66']),
}
hexrgb = lambda h: [round(int(h[i:i + 2], 16) / 255, 3) for i in (1, 3, 5)]
pick = lambda pal, s: pal[int(hashlib.md5(s.encode()).hexdigest(), 16) % len(pal)]
d = json.load(open(P)); n = {k: 0 for k in D}
for t in d['tiles']:
    for p in t['parts']:
        if p.get('noFacade') or p['height'] > 32: continue
        c = Point((p['bbox'][0] + p['bbox'][2]) / 2, (p['bbox'][1] + p['bbox'][3]) / 2)
        for k, (pg, walls, roofs) in D.items():
            if pg.contains(c): p['color'] = hexrgb(pick(walls, p['id'])); p['roofColor'] = hexrgb(pick(roofs, p['id'] + 'r')); n[k] += 1; break
json.dump(d, open(P, 'w')); print(n)
