#!/usr/bin/env python3
"""The city's current roadworks as barrier rows: Københavns Kommune's traffic messages (k101 trafikmelding, CC BY 4.0,
GeoJSON in EPSG:4326 from wfs-kbhkort.kk.dk), haendelsestype Vejarbejde, as furniture 'barrier' (the red and white
knockable barrier of src/mapped-furniture.js) with a 'cone' past each end of a row.

  python3 scripts/kk-roadworks.py <wfs dir> copenhagen [--date YYYY-MM-DD]
        (after parked-cars.py and parked-lanes.mjs; then furniture-ground, indoor-items: docs/COPENHAGEN.md)

Along each roadworks line, every 1.3 m (on a stretch over 60 m long, a 40 m site every 100 m), a barrier stands in the parking lane just inside the kerb of the road the line
follows (on the line's side of the road; a line down the middle takes the right-hand kerb), turned along the street.
A barrier is left out where it would reach within 1.7 m of a traffic lane's centre line (mobility.json edges at their
lane offsets), so no lane, and no job, race or saga route, is ever closed; where a parked car stands; in a house or the
water. Each item carries the works' dates (`since`, `until`); main.js shows it only while they run (from a day before to
a day after). Works already over at build time (--date, default today), demonstrations and messages whose end comes
before their start are left out. Rerunning replaces what it added (src 'kk-roadworks').
"""
import datetime, gzip, json, math, os, sys
from collections import defaultdict, Counter
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

argv = sys.argv[1:]; TODAY = datetime.date.today().isoformat()
if '--date' in argv: i = argv.index('--date'); TODAY = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
SRC, CID = argv[0], (argv[1] if len(argv) > 1 else 'copenhagen')
OUT = f'public/cities/{CID}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
mob = json.load(open(f'{OUT}/mobility.json'))
furn_path = f'{OUT}/furniture.json'; furn = json.load(open(furn_path, encoding='utf8'))
furn['items'] = [i for i in furn['items'] if i.get('src') != 'kk-roadworks']
to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
EXT = city['extent'] + 100; G = .25; N = int(2 * EXT / G)
def raster(polys):
    im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
    for rings in polys:
        for k, ring in enumerate(rings):
            if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=0 if k else 1)
    return np.array(im, dtype=bool)
road = raster([r['rings'] for r in city['roads'] if 'island' not in str(r.get('kind', ''))])
bld = raster([b['rings'] for b in city['buildings']] + ([b['rings'] for b in json.load(open(f'{OUT}/kk-footprints.json'))] if os.path.exists(f'{OUT}/kk-footprints.json') else []))
wpolys = [Polygon(w['rings'][0], w['rings'][1:]).buffer(0) for w in city['water'] if len(w['rings'][0]) > 2]; wtree = STRtree(wpolys)
def wet(x, z): return any(wpolys[i].contains(Point(x, z)) for i in wtree.query(Point(x, z)))
def hit(m, x, z):
    i, j = int((z + EXT) / G), int((x + EXT) / G)
    return 0 <= i < N and 0 <= j < N and m[i, j]

# road centre lines (for the kerb) and lane centre lines (to stay out of)
C = 20; centre = defaultdict(list); lanes = defaultdict(list)
for e in mob['roads']['edges']:
    if e.get('crossing'): continue
    for a, b in zip(e['points'], e['points'][1:]):
        l = math.dist(a, b)
        if l < .3: continue
        dx, dz = (b[0] - a[0]) / l, (b[1] - a[1]) / l; off = e.get('lane') or 0
        la, lb = (a[0] - dz * off, a[1] + dx * off), (b[0] - dz * off, b[1] + dx * off)  # right of travel (x east, z south)
        for i in range(math.floor((min(a[0], b[0]) - 15) / C), math.floor((max(a[0], b[0]) + 15) / C) + 1):
            for j in range(math.floor((min(a[1], b[1]) - 15) / C), math.floor((max(a[1], b[1]) + 15) / C) + 1):
                centre[i, j].append((a, (dx, dz), l)); lanes[i, j].append((la, lb))
def seg_d(x, z, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz
    t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) if l2 else 0
    return math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)
def nearest_centre(x, z):
    best = None
    for (ax, az), (dx, dz), l in centre.get((math.floor(x / C), math.floor(z / C)), ()):
        t = max(0, min(l, (x - ax) * dx + (z - az) * dz)); px, pz = ax + dx * t, az + dz * t; d = math.hypot(x - px, z - pz)
        if d < 15 and (best is None or d < best[0]): best = (d, (dx, dz), (px, pz))
    return best
def lane_clear(x, z, r=1.7): return all(seg_d(x, z, a, b) >= r for a, b in lanes.get((math.floor(x / C), math.floor(z / C)), ()))
cars = defaultdict(list)
for c in json.load(open(f'{OUT}/parked.json'))['cars']: cars[math.floor(c[0] / 10), math.floor(c[1] / 10)].append(c)
def by_car(x, z):
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for cx, cz, yaw, *_ in cars[math.floor(x / 10) + i, math.floor(z / 10) + j]:
                ux, uz = math.sin(yaw), math.cos(yaw); dx, dz = x - cx, z - cz
                if abs(dx * ux + dz * uz) < 2.9 and abs(dx * uz - dz * ux) < 1.3: return True
    return False

def slot(x, z, side_hint=None):
    """A spot just inside the kerb beside (x, z): (bx, bz, yaw) or why not."""
    ne = nearest_centre(x, z)
    if not ne: return 'no road'
    d, (dx, dz), (px, pz) = ne; nx, nz = -dz, dx
    side = side_hint or (1 if d < .8 or (x - px) * nx + (z - pz) * nz > 0 else -1)
    k = 0.
    while k < 14 and hit(road, px + nx * side * (k + .1), pz + nz * side * (k + .1)): k += .1
    if k < 2: return 'no road'
    bx, bz = px + nx * side * (k - .45), pz + nz * side * (k - .45)
    if not lane_clear(bx, bz): return 'traffic lane'
    if by_car(bx, bz): return 'parked car'
    if hit(bld, bx, bz) or wet(bx, bz): return 'house or water'
    return (round(bx, 2), round(bz, 2), round(math.atan2(-dz, dx), 3), side)

works, why, added = Counter(), Counter(), []
taken = defaultdict(list)
def free(x, z):
    return all(math.hypot(o[0] - x, o[1] - z) >= 1.1 for i in (-1, 0, 1) for j in (-1, 0, 1) for o in taken[math.floor(x / 5) + i, math.floor(z / 5) + j])
for f in json.load(open(f'{SRC}/trafikmelding.json', encoding='utf8'))['features']:
    p = f['properties']
    if p.get('haendelsestype') != 'Vejarbejde': works['not roadworks (' + str(p.get('haendelsestype')) + ')'] += 1; continue
    since, until = (p.get('starttidspunkt') or '')[:10], (p.get('sluttidspunkt') or '')[:10]
    if not until or until < since: works['dates inconsistent'] += 1; continue
    if until < TODAY: works['over by ' + TODAY] += 1; continue
    pts = [(a, -b) for a, b in (to_local.transform(*c[:2]) for c in f['geometry']['coordinates'])]
    if not any(abs(x) < city['extent'] and abs(z) < city['extent'] for x, z in pts): works['outside the map'] += 1; continue
    total = sum(math.dist(a, b) for a, b in zip(pts, pts[1:])); run = 0.; row = []
    for (ax, az), (bx, bz) in zip(pts, pts[1:]):
        l = math.dist((ax, az), (bx, bz))
        for t in np.arange(0, l, 1.3):
            along = run + t
            if total > 60 and along % 100 >= 40: continue  # a long stretch: a 40 m site every 100 m, not one fence along it all
            s = slot(ax + (bx - ax) * t / l, az + (bz - az) * t / l)
            if isinstance(s, str): why[s] += 1; continue
            if not free(s[0], s[1]): continue
            row.append(s); taken[math.floor(s[0] / 5), math.floor(s[1] / 5)].append(s)
        run += l
    if not row: works['no room for a barrier'] += 1; continue
    works['placed'] += 1
    ref = p.get('uuid') or p.get('id'); meta = {'src': 'kk-roadworks', 'ref': [ref], 'since': since, 'until': until}
    added += [{'k': 'barrier', 'x': x, 'z': z, 'yaw': yaw, **meta} for x, z, yaw, _ in row]
    # a cone a metre past each end of every unbroken run of barriers
    runs = [[row[0]]]
    for q in row[1:]:
        if math.dist(q[:2], runs[-1][-1][:2]) < 3: runs[-1].append(q)
        else: runs.append([q])
    for r in runs:
        for end, prev in ((r[0], r[1] if len(r) > 1 else None), (r[-1], r[-2] if len(r) > 1 else None)):
            if prev is None: continue
            dx, dz = end[0] - prev[0], end[1] - prev[1]; l = math.hypot(dx, dz) or 1; cx, cz = end[0] + dx / l * 1.1, end[1] + dz / l * 1.1
            if lane_clear(cx, cz, 1.4) and not by_car(cx, cz) and hit(road, cx, cz) and not hit(bld, cx, cz) and not wet(cx, cz) and free(cx, cz):
                added.append({'k': 'cone', 'x': round(cx, 2), 'z': round(cz, 2), 'yaw': 0, **meta}); taken[math.floor(cx / 5), math.floor(cz / 5)].append((cx, cz))
furn['items'] += added
furn['counts'] = dict(Counter(i['k'] for i in furn['items']))
open(furn_path, 'w', encoding='utf8').write(json.dumps(furn, separators=(',', ':'), ensure_ascii=False))
c = Counter(i['k'] for i in added)
print(f'roadworks on {TODAY}: {dict(works)}; {c["barrier"]} barriers and {c["cone"]} cones; barrier spots left out {dict(why)}')
