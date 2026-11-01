#!/usr/bin/env python3
"""Bus shelters where Copenhagen has them: the city's register of street furniture carrying adverts (Københavns Kommune,
AFA byudstyr, CC BY 4.0, wfs-kbhkort.kk.dk k101 afa_byudstyr as GeoJSON in EPSG:4326), its active bus shelters
(familie Læskærm) as furniture 'shelter' (the stop shelter of src/mapped-furniture.js, 3.6 x 1.5 m, solid).

  python3 scripts/kk-shelters.py <wfs dir> copenhagen     (after kk-street.py, furniture-ground and indoor-items)

Each shelter stands at its register point, its open side to the road edge nearest it, parallel to the street. If the
footprint would touch the drawn carriageway, a cycle track, a building or other ground furniture there, it steps back
from the road (or forward) up to 2.5 m; failing that it is left out. The register's poster columns, MUPI panels,
screens and toilets are not drawn (no model). Rerunning replaces the shelters it added (src 'kk-afa').
"""
import gzip, json, math, os, sys
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer

SRC, CID = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'copenhagen')
OUT = f'public/cities/{CID}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
mob = json.load(open(f'{OUT}/mobility.json'))
furn_path = f'{OUT}/furniture.json'; furn = json.load(open(furn_path, encoding='utf8'))
furn['items'] = [i for i in furn['items'] if i.get('src') != 'kk-afa']
to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
EXT = city['extent'] + 100; G = .25; N = int(2 * EXT / G)

def raster(polys, holes=True):
    im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
    for rings in polys:
        for k, ring in enumerate(rings):
            if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=0 if k and holes else 1)
    return np.array(im, dtype=bool)
road = raster([r['rings'] for r in city['roads'] if 'island' not in str(r.get('kind', ''))])
bld = raster([b['rings'] for b in city['buildings']] + ([b['rings'] for b in json.load(open(f'{OUT}/kk-footprints.json'))] if os.path.exists(f'{OUT}/kk-footprints.json') else []))
# Cycle tracks as drawn: the ground surfaces' triangles in the cycle-track colour (scripts/world-formats.mjs, c8b8a5).
lin = lambda c: (c / 255) / 12.92 if c / 255 <= .04045 else ((c / 255 + .055) / 1.055) ** 2.4
TRACK = np.array([lin(0xc8), lin(0xb8), lin(0xa5)])
im = Image.new('1', (N, N), 0); dr = ImageDraw.Draw(im)
for rec in json.load(open(f'{OUT}/surface-index.json')):
    v = np.frombuffer(gzip.decompress(open(f"{OUT}/{rec['file']}.pack", 'rb').read()), dtype=np.float32).reshape(-1, 3, 6)
    for tri in v[np.all(np.abs(v[:, 0, 3:] - TRACK) < .01, axis=1)]:
        dr.polygon([((p[0] + EXT) / G, (p[2] + EXT) / G) for p in tri], fill=1)
track = np.array(im, dtype=bool)
def hit(m, x, z):
    i, j = int((z + EXT) / G), int((x + EXT) / G)
    return 0 <= i < N and 0 <= j < N and m[i, j]

C = 20; eg = defaultdict(list)
for e in mob['roads']['edges']:
    if e.get('crossing'): continue
    for a, b in zip(e['points'], e['points'][1:]):
        l = math.dist(a, b)
        if l < .5: continue
        for i in range(math.floor((min(a[0], b[0]) - 25) / C), math.floor((max(a[0], b[0]) + 25) / C) + 1):
            for j in range(math.floor((min(a[1], b[1]) - 25) / C), math.floor((max(a[1], b[1]) + 25) / C) + 1): eg[i, j].append((a, ((b[0] - a[0]) / l, (b[1] - a[1]) / l), l))
def nearest_edge(x, z):
    best = None
    for (ax, az), (dx, dz), l in eg.get((math.floor(x / C), math.floor(z / C)), ()):
        t = max(0, min(l, (x - ax) * dx + (z - az) * dz)); px, pz = ax + dx * t, az + dz * t; d = math.hypot(x - px, z - pz)
        if d < 25 and (best is None or d < best[0]): best = (d, (dx, dz), (px, pz))
    return best
ground = defaultdict(list)
for it in furn['items']:
    if it['k'] not in ('wire-lamp', 'sign', 'pole', 'lamp', 'mast-lamp', 'park-lamp', 'crossing-light', 'traffic-light'): ground[math.floor(it['x'] / 10), math.floor(it['z'] / 10)].append(it)
W, D = 3.6, 1.5
def clear(x, z, t, n):
    for a in np.linspace(-W / 2 - .2, W / 2 + .2, 9):
        for b in np.linspace(-D / 2 - .2, D / 2 + .2, 4):
            px, pz = x + a * t[0] + b * n[0], z + a * t[1] + b * n[1]
            if hit(road, px, pz) or hit(bld, px, pz) or hit(track, px, pz): return False
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for it in ground[math.floor(x / 10) + i, math.floor(z / 10) + j]:
                dx, dz = it['x'] - x, it['z'] - z
                if abs(dx * t[0] + dz * t[1]) < W / 2 + .6 and abs(dx * n[0] + dz * n[1]) < D / 2 + .6: return False
    return True

added, left = [], 0
for f in json.load(open(f'{SRC}/afa_byudstyr.json', encoding='utf8'))['features']:
    p = f['properties']
    if p.get('familie') != 'Læskærm' or p.get('status') != 'Aktiv': continue
    a, b = to_local.transform(*f['geometry']['coordinates'][0][:2]); x, z = a, -b
    if abs(x) > city['extent'] or abs(z) > city['extent']: continue
    ne = nearest_edge(x, z)
    if not ne: left += 1; continue
    d, t, (fx, fz) = ne
    n = ((x - fx) / d, (z - fz) / d) if d > .1 else (-t[1], t[0])  # from the road out to the shelter
    for back in (0, .5, 1, 1.5, 2, 2.5, -.5, -1):
        cx, cz = x + n[0] * back, z + n[1] * back
        if clear(cx, cz, t, n):
            # Its +Z (open side, src/mapped-furniture.js) to the road; local x along the street.
            added.append({'k': 'shelter', 'x': round(cx, 2), 'z': round(cz, 2), 'yaw': round(math.atan2(-n[0], -n[1]), 3), 'src': 'kk-afa', 'ref': [p['jcdnr']]})
            break
    else: left += 1
furn['items'] += added
furn['counts']['shelter'] = len(added)
open(furn_path, 'w', encoding='utf8').write(json.dumps(furn, separators=(',', ':'), ensure_ascii=False))
print(f'bus shelters: {len(added)} placed, {left} left out (no room clear of the road, cycle track, houses and furniture)')
