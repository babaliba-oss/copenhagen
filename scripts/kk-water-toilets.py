#!/usr/bin/env python3
"""Drinking posts and public toilets where Copenhagen has them (Københavns Kommune, CC BY 4.0, wfs-kbhkort.kk.dk k101
layers as GeoJSON in EPSG:4326):

  dp_vandinstallationer_p (element Drikkepost, active)  -> furniture 'drinking-post' (the green water post, knockable)
  toilet_puma_agg_tmf_kk (status IDrift)                -> furniture 'toilet' (a small cabin, solid)

  python3 scripts/kk-water-toilets.py <wfs dir> copenhagen     (after kk-shelters.py; then furniture-ground, indoor-items)

Each stands at its register point, the toilet's door (+Z) to the nearest street or path. If it would touch the drawn
carriageway, a cycle track, a house or other ground furniture, it is moved up to 2.5 m (a post 1.5 m); failing that it is
left out. A toilet the register files as a building (in a park, on a beach) is left out where a mapped house already
stands on it (OpenStreetMap draws most of those). Cemetery taps, water play and the fountains in the lakes are not
drawn (no model). Rerunning replaces what it added (src 'kk-vand', 'kk-toilet').
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
furn['items'] = [i for i in furn['items'] if i.get('src') not in ('kk-vand', 'kk-toilet')]
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
# The water exactly (a raster of it as well did not fit in memory beside the others).
from shapely.geometry import Point, Polygon
from shapely.prepared import prep
from shapely.strtree import STRtree
wpolys = [Polygon(w['rings'][0], w['rings'][1:]).buffer(0) for w in city['water'] if len(w['rings'][0]) > 2]
wtree = STRtree(wpolys)
def wet(x, z): return any(wpolys[i].contains(Point(x, z)) for i in wtree.query(Point(x, z)))
# Cycle tracks as drawn: the ground surfaces' triangles in the cycle-track colour (scripts/world-formats.mjs, c8b8a5).
lin = lambda c: (c / 255) / 12.92 if c / 255 <= .04045 else ((c / 255 + .055) / 1.055) ** 2.4
TRACK = np.array([lin(0xc8), lin(0xb8), lin(0xa5)])
im = Image.new('1', (N, N), 0); dr = ImageDraw.Draw(im); paved = []
for rec in json.load(open(f'{OUT}/surface-index.json')):
    v = np.frombuffer(gzip.decompress(open(f"{OUT}/{rec['file']}.pack", 'rb').read()), dtype=np.float32).reshape(-1, 3, 6)
    for tri in v[np.all(np.abs(v[:, 0, 3:] - TRACK) < .01, axis=1)]:
        dr.polygon([((p[0] + EXT) / G, (p[2] + EXT) / G) for p in tri], fill=1)
    paved.extend(v[np.all(np.abs(v[:, :, 1] - .053) < 1e-4, axis=1)])  # an old track paved over where the kerb moved out (kk-kerbs.py)
for tri in paved: dr.polygon([((p[0] + EXT) / G, (p[2] + EXT) / G) for p in tri], fill=0)
track = np.array(im, dtype=bool)
def hit(m, x, z):
    i, j = int((z + EXT) / G), int((x + EXT) / G)
    return 0 <= i < N and 0 <= j < N and m[i, j]

# Nearest street or path edge (the toilet's door faces it).
C = 20; eg = defaultdict(list)
for net in ('roads', 'walks'):
    for e in mob.get(net, {}).get('edges', []):
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
def add_ground(it): ground[math.floor(it['x'] / 10), math.floor(it['z'] / 10)].append(it)
for it in furn['items']:
    if it['k'] not in ('wire-lamp', 'sign', 'pole', 'lamp', 'mast-lamp', 'park-lamp', 'crossing-light', 'traffic-light'): add_ground(it)

SIZE = {'drinking-post': (.36, .36), 'toilet': (2.4, 1.8)}  # src/mapped-furniture.js SOLIDS
def clear(x, z, t, n, w, d, gap):
    for a in np.linspace(-w / 2 - .2, w / 2 + .2, int((w + .4) / .2) + 2):
        for b in np.linspace(-d / 2 - .2, d / 2 + .2, int((d + .4) / .2) + 2):
            px, pz = x + a * t[0] + b * n[0], z + a * t[1] + b * n[1]
            if hit(road, px, pz) or hit(bld, px, pz) or hit(track, px, pz) or wet(px, pz): return False
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for it in ground[math.floor(x / 10) + i, math.floor(z / 10) + j]:
                dx, dz = it['x'] - x, it['z'] - z
                if abs(dx * t[0] + dz * t[1]) < w / 2 + gap and abs(dx * n[0] + dz * n[1]) < d / 2 + gap: return False
    return True
def local(f):
    c = f['geometry']['coordinates']; c = c[0] if isinstance(c[0], list) else c
    a, b = to_local.transform(c[0], c[1]); return a, -b
def place(kind, x, z, steps, src, ref):
    w, d = SIZE[kind]; ne = nearest_edge(x, z)
    if ne and ne[0] > .1: t = ne[1]; n = ((x - ne[2][0]) / ne[0], (z - ne[2][1]) / ne[0])  # n: from the path out to the item
    elif ne: t = ne[1]; n = (-t[1], t[0])
    else: t, n = (1, 0), (0, 1)
    t = (-n[1], n[0])  # along the front (n can be off square to the edge at its end)
    for r in steps:
        for k in range(8 if r else 1):
            a = k * math.pi / 4; ox, oz = (n[0] * r, n[1] * r) if k == 0 else (math.cos(a) * r, math.sin(a) * r)
            cx, cz = x + ox, z + oz
            if clear(cx, cz, t, n, w, d, .5 if kind == 'toilet' else .35):
                it = {'k': kind, 'x': round(cx, 2), 'z': round(cz, 2), 'yaw': round(math.atan2(-n[0], -n[1]), 3), 'src': src, 'ref': [ref]}
                add_ground(it); return it
    return None

inside = lambda x, z: abs(x) < city['extent'] and abs(z) < city['extent']
posts, toilets, left = [], [], defaultdict(int)
for f in json.load(open(f'{SRC}/dp_vandinstallationer_p.json', encoding='utf8'))['features']:
    p = f['properties']
    if p.get('element') != 'Drikkepost' or str(p.get('status') or 'aktiv').lower() not in ('aktiv', 'status'): continue
    if 'bygning' in str(p.get('model') or '').lower(): continue  # a tap on a house wall
    x, z = local(f)
    if not inside(x, z): continue
    it = place('drinking-post', x, z, (0, .5, 1, 1.5), 'kk-vand', p['uuid'])
    if it: posts.append(it)
    else: left['drinking-post'] += 1
for f in json.load(open(f'{SRC}/toilet_puma_agg_tmf_kk.json', encoding='utf8'))['features']:
    p = f['properties']
    if not str(p.get('status') or '').startswith('IDrift'): continue
    x, z = local(f)
    if not inside(x, z): continue
    if str(p.get('toilettype_design', '')).startswith('Bygning') and any(hit(bld, x + a, z + b) for a in (-2, 0, 2) for b in (-2, 0, 2)):
        left['toilet (a house there already)'] += 1; continue
    it = place('toilet', x, z, (0, .5, 1, 1.5, 2, 2.5), 'kk-toilet', p['id'])
    if it: it['name'] = p.get('toilet_lokalitet') or ''; toilets.append(it)
    else: left['toilet'] += 1
furn['items'] += posts + toilets
furn['counts']['drinking-post'] = len(posts); furn['counts']['toilet'] = len(toilets)
open(furn_path, 'w', encoding='utf8').write(json.dumps(furn, separators=(',', ':'), ensure_ascii=False))
print(f'drinking posts: {len(posts)} placed; toilets: {len(toilets)} placed; left out: {dict(left)}')
