#!/usr/bin/env python3
"""Play equipment on the city's playgrounds: Københavns Kommune's park register of play and activity items (k101
dp_lege_aktivitetselementer_p, CC BY 4.0, GeoJSON in EPSG:4326 from wfs-kbhkort.kk.dk) and its playgrounds (k101
legeplads), as solid furniture drawn with our own low-poly models (src/mapped-furniture.js):

  Legeredskaber, Naturlegeredskaber   -> 'swing' (A-frame with two seats), 'slide' (platform, ladder, chute),
                                         'climbing-frame', 'spring-rider', 'sandbox' (a timber edge round the sand)
  Boldmål og -net, Legepladsmål og -net -> 'goal' (a small football goal)

  python3 scripts/kk-playgrounds.py <wfs dir> copenhagen     (after kk-roadworks.py; then furniture-ground, indoor-items)

The register says only that an item is play equipment, not which: the kind is picked from a hash of the item's id (the
register's comments name a seesaw, 'Vippe', as a spring rider), the same on every build. An item stands where the register
puts it when it is on park or playground ground (a mapped park, lawn or playground, or within 60 m of one of the city's
playgrounds) and its footprint is clear of roads, cycle tracks, paths and pavements, houses, water, tree trunks and
other furniture; else it is turned or moved up to 3 m, else left out. Fitness and parkour equipment is not drawn.
Rerunning replaces what it added (src 'kk-leg').
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
furn_path = f'{OUT}/furniture.json'; furn = json.load(open(furn_path, encoding='utf8'))
furn['items'] = [i for i in furn['items'] if i.get('src') != 'kk-leg']
to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
EXT = city['extent'] + 100; G = .25; N = int(2 * EXT / G)
def raster(polys):
    im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
    for rings in polys:
        for k, ring in enumerate(rings):
            if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=0 if k else 1)
    return np.array(im, dtype=bool)
# Anything one cannot stand play equipment on: roads, pavements and paths (cycle tracks among them), houses.
hard = raster([r['rings'] for r in city['roads']] + [p['rings'] for p in city.get('pavement', [])] + [b['rings'] for b in city['buildings']]
              + ([b['rings'] for b in json.load(open(f'{OUT}/kk-footprints.json'))] if os.path.exists(f'{OUT}/kk-footprints.json') else []))
park = raster([p['rings'] for p in city.get('parks', [])])
wpolys = [Polygon(w['rings'][0], w['rings'][1:]).buffer(0) for w in city['water'] if len(w['rings'][0]) > 2]; wtree = STRtree(wpolys)
def wet(x, z): return any(wpolys[i].contains(Point(x, z)) for i in wtree.query(Point(x, z)))
def hit(m, x, z):
    i, j = int((z + EXT) / G), int((x + EXT) / G)
    return 0 <= i < N and 0 <= j < N and m[i, j]
def local(c): a, b = to_local.transform(c[0], c[1]); return a, -b
plays = [local(c) for f in json.load(open(f'{SRC}/legeplads.json', encoding='utf8'))['features'] for c in f['geometry']['coordinates']]
def by_playground(x, z): return any(math.hypot(px - x, pz - z) < 60 for px, pz in plays)

SIZE = {'swing': (3.4, 1.9), 'slide': (3.8, 1.2), 'climbing-frame': (2.3, 2.3), 'spring-rider': (.9, .5), 'sandbox': (3.0, 3.0), 'goal': (3.1, 1.2)}  # SOLIDS in src/mapped-furniture.js
occupied = defaultdict(list)  # other furniture and tree trunks: (x, z, r)
def occupy(x, z, r): occupied[math.floor(x / 10), math.floor(z / 10)].append((x, z, r))
for it in furn['items']:
    if it['k'] != 'wire-lamp': occupy(it['x'], it['z'], 1.8 if it['k'] in ('shelter', 'toilet', 'hotdog-stand') else .5)
for t in city['trees']: occupy(t['p'][0], t['p'][1], .6)
def clear(x, z, yaw, w, d):
    c, s = math.cos(yaw), math.sin(yaw)
    for a in np.linspace(-w / 2 - .3, w / 2 + .3, max(3, int(w / .5) + 2)):
        for b in np.linspace(-d / 2 - .3, d / 2 + .3, max(3, int(d / .5) + 2)):
            px, pz = x + a * c + b * s, z - a * s + b * c
            if hit(hard, px, pz) or not (hit(park, px, pz) or by_playground(px, pz)): return False
    if any(wet(x + a * c + b * s, z - a * s + b * c) for a in (-w / 2 - .3, 0, w / 2 + .3) for b in (-d / 2 - .3, d / 2 + .3)) or wet(x, z): return False
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for ox, oz, r in occupied[math.floor(x / 10) + i, math.floor(z / 10) + j]:
                dx, dz = ox - x, oz - z
                if abs(dx * c - dz * s) < w / 2 + r and abs(dx * s + dz * c) < d / 2 + r: return False
    return True

PLAY = ['swing', 'swing', 'slide', 'slide', 'climbing-frame', 'climbing-frame', 'climbing-frame', 'spring-rider', 'spring-rider', 'sandbox']
added, why = [], Counter()
for f in json.load(open(f'{SRC}/dp_lege_aktivitetselementer_p.json', encoding='utf8'))['features']:
    p = f['properties']; ue = p.get('under_element') or ''
    if ue in ('Legeredskaber', 'Naturlegeredskaber'):
        h = zlib.crc32(str(p.get('uuid')).encode()); kind = 'spring-rider' if (p.get('kommentar') or '').strip() == 'Vippe' else PLAY[h % len(PLAY)]
    elif ue in ('Boldmål og -net', 'Legepladsmål og -net'): kind = 'goal'; h = zlib.crc32(str(p.get('uuid')).encode())
    else: why['fitness, not drawn'] += 1; continue
    w, d = SIZE[kind]
    for c in f['geometry']['coordinates']:
        x, z = local(c)
        if abs(x) > city['extent'] or abs(z) > city['extent']: continue
        if not (hit(park, x, z) or by_playground(x, z)): why['not on park or playground ground'] += 1; continue
        base = (h % 4) * math.pi / 2 + ((h >> 4) % 7 - 3) * .08
        spot = None
        for r in (0, .5, 1, 1.5, 2, 2.5, 3):
            for k in range(8 if r else 1):
                cx, cz = x + math.cos(k * math.pi / 4) * r, z + math.sin(k * math.pi / 4) * r
                for yaw in (base, base + math.pi / 2):
                    if clear(cx, cz, yaw, w, d): spot = (cx, cz, yaw); break
                if spot: break
            if spot: break
        if not spot: why['no clear spot'] += 1; continue
        cx, cz, yaw = spot; occupy(cx, cz, max(w, d) / 2)
        added.append({'k': kind, 'x': round(cx, 2), 'z': round(cz, 2), 'yaw': round(yaw, 3), 'src': 'kk-leg', 'ref': [p.get('uuid')]})
furn['items'] += added
furn['counts'] = dict(Counter(i['k'] for i in furn['items']))
open(furn_path, 'w', encoding='utf8').write(json.dumps(furn, separators=(',', ':'), ensure_ascii=False))
print(f'play equipment: {len(added)} placed {dict(Counter(i["k"] for i in added))}; left out {dict(why)}')
