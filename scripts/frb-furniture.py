#!/usr/bin/env python3
"""Street furniture in Frederiksberg, the municipality in the map's west that Københavns Kommune's registers stop at:
Frederiksberg Kommune's open data (CC BY 4.0, opendata.dk/city-of-frederiksberg; the downloads as they come, see
docs/COPENHAGEN.md), drawn with the same models as the rest of the city:

  skraldespande.geojson (Skraldespande, EPSG:25832)             -> furniture 'bin'            (src 'frb-skrald')
  parkeringsautomater.geojson (Parkeringsautomater)             -> 'parking-meter'            (src 'frb-automat')
  toiletter.geojson (Offentlige toiletter)                      -> 'toilet' (a small cabin)   (src 'frb-toilet')
  vandposter.geojson (Friluftstilbud, Vandposter)               -> 'drinking-post'            (src 'frb-vand')
  legepladser.geojson, multibaner.geojson (Friluftstilbud)      -> play equipment, 'goal'     (src 'frb-leg')

  python3 scripts/frb-furniture.py <frb dir> copenhagen     (after the kk-*.py furniture; then furniture-ground, indoor-items)

Only added to: a bin or a parking machine with one already within 4 m (a photo detection of the same one), a toilet
within 15 m of one, a drinking post within 5 m of one is left out. Each stands at its register point, turned to the
nearest street or path; if it would touch the drawn carriageway, a cycle track, a house, the water or other ground
furniture it is moved up to 1.5 m (a toilet 2.5 m), failing that left out. Bins the register wants taken down are left
out, and toilets inside a house (a library, a station, a church office): only the free-standing ones (the
register's address says 'fristå.toilet') get a cabin.
The playground and ball-court registers give one point per place, not its equipment: five pieces (swing, slide,
climbing frame, spring rider, sandbox) are set round a playground's point and two goals round a ball court's, on ground
clear of roads, paths, houses, water, trees and furniture, the spots picked from a hash of the place's name (the same
on every build). Rerunning replaces what it added (src 'frb-*').
"""
import gzip, json, math, os, sys, zlib
from collections import defaultdict, Counter
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

SRC, CID = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'copenhagen')
OUT = f'public/cities/{CID}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
mob = json.load(open(f'{OUT}/mobility.json'))
furn_path = f'{OUT}/furniture.json'; furn = json.load(open(furn_path, encoding='utf8'))
furn['items'] = [i for i in furn['items'] if not str(i.get('src')).startswith('frb-')]
to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
utm_local = Transformer.from_crs('EPSG:25832', city['projection'], always_xy=True)
inside = lambda x, z: abs(x) < city['extent'] and abs(z) < city['extent']
def load(name): return json.load(open(f'{SRC}/{name}', encoding='utf8'))['features']
def local(f, tr=to_local):
    c = f['geometry']['coordinates']; c = c[0] if isinstance(c[0], list) else c
    a, b = tr.transform(c[0], c[1]); return a, -b
sets = {n: [(f['properties'], *local(f, utm_local if n == 'skraldespande' else to_local)) for f in load(n + '.geojson') if f.get('geometry')]
        for n in ('skraldespande', 'parkeringsautomater', 'toiletter', 'vandposter', 'legepladser', 'multibaner')}
sets = {n: [r for r in rows if inside(r[1], r[2])] for n, rows in sets.items()}
print('in the map:', {n: len(rows) for n, rows in sets.items()})

# The ground as drawn, rastered over Frederiksberg's part of the map only (the registers' own bounds and 40 m).
pts = [(r[1], r[2]) for rows in sets.values() for r in rows]
X0, Z0 = min(p[0] for p in pts) - 40, min(p[1] for p in pts) - 40; G = .25
NX, NZ = int((max(p[0] for p in pts) + 40 - X0) / G), int((max(p[1] for p in pts) + 40 - Z0) / G)
def raster(polys):
    im = Image.new('1', (NX, NZ), 0); d = ImageDraw.Draw(im)
    for rings in polys:
        if max(p[0] for p in rings[0]) < X0 or min(p[0] for p in rings[0]) > X0 + NX * G: continue
        for k, ring in enumerate(rings):
            if len(ring) > 2: d.polygon([((x - X0) / G, (z - Z0) / G) for x, z in ring], fill=0 if k else 1)
    return np.array(im, dtype=bool)
road = raster([r['rings'] for r in city['roads'] if 'island' not in str(r.get('kind', ''))])
bld = raster([b['rings'] for b in city['buildings']] + ([b['rings'] for b in json.load(open(f'{OUT}/kk-footprints.json'))] if os.path.exists(f'{OUT}/kk-footprints.json') else []))
paths = raster([r['rings'] for r in city['roads']] + [p['rings'] for p in city.get('pavement', [])])  # no play equipment on these
wpolys = [Polygon(w['rings'][0], w['rings'][1:]).buffer(0) for w in city['water'] if len(w['rings'][0]) > 2]; wtree = STRtree(wpolys)
def wet(x, z): return any(wpolys[i].contains(Point(x, z)) for i in wtree.query(Point(x, z)))
# Cycle tracks as drawn: the ground surfaces' triangles in the cycle-track colour (scripts/world-formats.mjs, c8b8a5).
lin = lambda c: (c / 255) / 12.92 if c / 255 <= .04045 else ((c / 255 + .055) / 1.055) ** 2.4
TRACK = np.array([lin(0xc8), lin(0xb8), lin(0xa5)])
im = Image.new('1', (NX, NZ), 0); dr = ImageDraw.Draw(im); paved = []
for rec in json.load(open(f'{OUT}/surface-index.json')):
    v = np.frombuffer(gzip.decompress(open(f"{OUT}/{rec['file']}.pack", 'rb').read()), dtype=np.float32).reshape(-1, 3, 6)
    for tri in v[np.all(np.abs(v[:, 0, 3:] - TRACK) < .01, axis=1)]:
        dr.polygon([((p[0] - X0) / G, (p[2] - Z0) / G) for p in tri], fill=1)
    paved.extend(v[np.all(np.abs(v[:, :, 1] - .053) < 1e-4, axis=1)])  # an old track paved over where the kerb moved out (kk-kerbs.py)
for tri in paved: dr.polygon([((p[0] - X0) / G, (p[2] - Z0) / G) for p in tri], fill=0)
track = np.array(im, dtype=bool)
def hit(m, x, z):
    i, j = int((z - Z0) / G), int((x - X0) / G)
    return 0 <= i < NZ and 0 <= j < NX and m[i, j]

# Nearest street or path edge (what an item is turned to).
C = 20; eg = defaultdict(list)
for net in ('roads', 'walks'):
    for e in mob.get(net, {}).get('edges', []):
        if e.get('crossing'): continue
        for a, b in zip(e['points'], e['points'][1:]):
            l = math.dist(a, b)
            if l < .5 or min(a[0], b[0]) > X0 + NX * G + 25: continue
            for i in range(math.floor((min(a[0], b[0]) - 25) / C), math.floor((max(a[0], b[0]) + 25) / C) + 1):
                for j in range(math.floor((min(a[1], b[1]) - 25) / C), math.floor((max(a[1], b[1]) + 25) / C) + 1): eg[i, j].append((a, ((b[0] - a[0]) / l, (b[1] - a[1]) / l), l))
def nearest_edge(x, z):
    best = None
    for (ax, az), (dx, dz), l in eg.get((math.floor(x / C), math.floor(z / C)), ()):
        t = max(0, min(l, (x - ax) * dx + (z - az) * dz)); px, pz = ax + dx * t, az + dz * t; d = math.hypot(x - px, z - pz)
        if d < 25 and (best is None or d < best[0]): best = (d, (dx, dz), (px, pz))
    return best
ground = defaultdict(list)  # everything standing on the ground: (x, z, r, kind)
def add_ground(x, z, r, k): ground[math.floor(x / 10), math.floor(z / 10)].append((x, z, r, k))
for it in furn['items']:
    if it['k'] != 'wire-lamp': add_ground(it['x'], it['z'], 1.8 if it['k'] in ('shelter', 'toilet', 'hotdog-stand') else 0, it['k'])
for t in city['trees']: add_ground(t['p'][0], t['p'][1], .3, 'tree')
def around(x, z):
    for i in (-2, -1, 0, 1, 2):
        for j in (-2, -1, 0, 1, 2): yield from ground[math.floor(x / 10) + i, math.floor(z / 10) + j]
def has(kind, x, z, r): return any(k == kind and math.hypot(ox - x, oz - z) < r for ox, oz, _, k in around(x, z))

# Footprints as src/mapped-furniture.js draws them (SOLIDS; the bin and the parking machine are knockable posts).
SIZE = {'bin': (.5, .5), 'parking-meter': (.3, .3), 'drinking-post': (.36, .36), 'toilet': (2.4, 1.8),
        'swing': (3.4, 1.9), 'slide': (3.8, 1.2), 'climbing-frame': (2.3, 2.3), 'spring-rider': (.9, .5), 'sandbox': (3.0, 3.0), 'goal': (3.1, 1.2)}
def clear(x, z, t, n, w, d, gap, off=()):
    for a in np.linspace(-w / 2 - .2, w / 2 + .2, int((w + .4) / .2) + 2):
        for b in np.linspace(-d / 2 - .2, d / 2 + .2, int((d + .4) / .2) + 2):
            px, pz = x + a * t[0] + b * n[0], z + a * t[1] + b * n[1]
            if hit(road, px, pz) or hit(bld, px, pz) or hit(track, px, pz) or wet(px, pz) or any(hit(m, px, pz) for m in off): return False
    for ox, oz, r, _ in around(x, z):
        dx, dz = ox - x, oz - z
        if abs(dx * t[0] + dz * t[1]) < w / 2 + gap + r and abs(dx * n[0] + dz * n[1]) < d / 2 + gap + r: return False
    return True
def place(kind, x, z, steps, src, ref):
    w, d = SIZE[kind]; ne = nearest_edge(x, z)
    if ne and ne[0] > .1: n = ((x - ne[2][0]) / ne[0], (z - ne[2][1]) / ne[0])  # n: from the street out to the item
    elif ne: n = (-ne[1][1], ne[1][0])
    else: n = (0, 1)
    t = (-n[1], n[0])
    for r in steps:
        for k in range(8 if r else 1):
            a = k * math.pi / 4; ox, oz = (n[0] * r, n[1] * r) if k == 0 else (math.cos(a) * r, math.sin(a) * r)
            cx, cz = x + ox, z + oz
            if clear(cx, cz, t, n, w, d, .5 if kind == 'toilet' else .35):
                it = {'k': kind, 'x': round(cx, 2), 'z': round(cz, 2), 'yaw': round(math.atan2(-n[0], -n[1]), 3), 'src': src, 'ref': [ref]}
                add_ground(cx, cz, 1.8 if kind == 'toilet' else 0, kind); return it
    return None

added, left = [], Counter()
for p, x, z in sets['skraldespande']:
    if 'nedlægges' in ' '.join(str(p.get(f'status{i}') or '') for i in range(1, 6)): left['bin (to be taken down)'] += 1; continue
    if has('bin', x, z, 4): left['bin (one there already)'] += 1; continue
    it = place('bin', x, z, (0, .5, 1, 1.5), 'frb-skrald', p['id'])
    if it: added.append(it)
    else: left['bin (no clear spot)'] += 1
for p, x, z in sets['parkeringsautomater']:
    if has('parking-meter', x, z, 4): left['parking machine (one there already)'] += 1; continue
    it = place('parking-meter', x, z, (0, .5, 1, 1.5), 'frb-automat', p['anlaeg'])
    if it: added.append(it)
    else: left['parking machine (no clear spot)'] += 1
for p, x, z in sets['toiletter']:
    if has('toilet', x, z, 15): left['toilet (one there already)'] += 1; continue
    if 'fristå' not in str(p.get('adresse')) or any(hit(bld, x + a, z + b) for a in (-2, 0, 2) for b in (-2, 0, 2)): left['toilet (in a house)'] += 1; continue
    it = place('toilet', x, z, (0, .5, 1, 1.5, 2, 2.5), 'frb-toilet', p['id'])
    if it: added.append(it)
    else: left['toilet (no clear spot)'] += 1
for p, x, z in sets['vandposter']:
    if has('drinking-post', x, z, 5): left['drinking post (one there already)'] += 1; continue
    it = place('drinking-post', x, z, (0, .5, 1, 1.5), 'frb-vand', p['gid'])
    if it: added.append(it)
    else: left['drinking post (no clear spot)'] += 1
# Playgrounds and ball courts: pieces on rings round the register's point, the first clear spot from a hashed bearing.
def play(kinds, name, x, z, ref):
    h = zlib.crc32(name.encode()); got = 0
    for n, kind in enumerate(kinds):
        w, d = SIZE[kind]; spot = None
        for r in (5, 7, 9, 11, 3):
            for k in range(12):
                a = (h % 360) * math.pi / 180 + n * 2 * math.pi / len(kinds) + (k + 1) // 2 * (-1) ** k * math.pi / 12
                cx, cz = x + math.cos(a) * r, z + math.sin(a) * r
                for yaw in (a, a + math.pi / 2):
                    c, s = math.cos(yaw), math.sin(yaw)
                    if clear(cx, cz, (c, -s), (s, c), w, d, .4, (paths,)): spot = (cx, cz, yaw); break
                if spot: break
            if spot: break
        if not spot: left[f'{kind} (no clear spot)'] += 1; continue
        cx, cz, yaw = spot; add_ground(cx, cz, max(w, d) / 2, kind); got += 1
        added.append({'k': kind, 'x': round(cx, 2), 'z': round(cz, 2), 'yaw': round(yaw % (2 * math.pi), 3), 'src': 'frb-leg', 'ref': [ref]})
    return got
for p, x, z in sets['legepladser']: play(['swing', 'slide', 'climbing-frame', 'spring-rider', 'sandbox'], p['navn'], x, z, f"legeplads-{p['gid']}")
for p, x, z in sets['multibaner']: play(['goal', 'goal'], p['navn'], x, z, f"multibane-{p['id']}")

furn['items'] += added
for k in dict.fromkeys(i['k'] for i in added): furn['counts'][k] = sum(1 for i in furn['items'] if i['k'] == k)
NOTE = ' In Frederiksberg, bins, parking machines, public toilets, drinking posts and playgrounds from Frederiksberg Kommune\'s open data (opendata.dk/city-of-frederiksberg, CC BY 4.0; src frb-*) beside the photo detections.'
if NOTE not in furn['note']: furn['note'] += NOTE
if 'Frederiksberg' not in furn['licence']: furn['licence'] += '; Frederiksberg Kommune open data CC BY 4.0'
open(furn_path, 'w', encoding='utf8').write(json.dumps(furn, separators=(',', ':'), ensure_ascii=False))
print(f'added {len(added)}: {dict(Counter(i["k"] for i in added))}; left out: {dict(left)}')
