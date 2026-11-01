#!/usr/bin/env python3
"""Traffic weights per road edge from the City of Copenhagen's traffic counts (Trafiktal, CC BY 4.0,
opendata.dk/city-of-copenhagen/trafiktal): busy streets get more of the game's cars and riders, side streets fewer.

  python3 scripts/traffic-counts.py <trafiktaelling dir> copenhagen

Each road edge in mobility.json is named from the drawn street it runs on (city.pack roads, OSM names). Each count point
(the latest count of each point with a motor-traffic figure) is snapped to the nearest edge of the same street within
60 m, or failing that the nearest edge within 30 m. Every edge of a counted street then takes the count of the nearest
count point along that street; the edges of uncounted streets (and the unnamed links at junctions) take a quiet-street
default, or the mean of their counted neighbours for the short unnamed links. Writes mobility.json `traffic`: one number
per road edge (annual average daily motor vehicles / 10000, rounded), read by src/mobility.js, and `bikeTraffic`
(cyclists likewise) read by src/copenhagen/city-cyclists.js. Run after prune-mobility.py (it rewrites mobility.json).
"""
import gzip, json, math, os, re, sys
from collections import defaultdict
import shapefile
from pyproj import Transformer

SRC, CID = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'copenhagen')
OUT = f'public/cities/{CID}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
mob_text = open(f'{OUT}/mobility.json', encoding='utf8').read()
mob = json.loads(mob_text)
edges = mob['roads']['edges']
to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)

QUIET_CARS, QUIET_BIKES = 1500, 1200  # AADT of a street with no count: a side street
norm = lambda s: re.sub(r'[^a-z0-9æøå]', '', (s or '').lower().replace('gl.', 'gammel'))

# --- name the edges from the drawn street polygons they run in ---
C = 50
grid = defaultdict(list)
for r in city['roads']:
    if not r.get('name') or 'rings' not in r: continue
    x0, z0, x1, z1 = r['bbox']
    for i in range(math.floor(x0 / C), math.floor(x1 / C) + 1):
        for j in range(math.floor(z0 / C), math.floor(z1 / C) + 1): grid[i, j].append(r)

def inside(ring, x, z):
    c = False
    for k in range(len(ring)):
        (ax, az), (bx, bz) = ring[k - 1], ring[k]
        if (az > z) != (bz > z) and x < ax + (z - az) * (bx - ax) / (bz - az): c = not c
    return c

def name_at(x, z):
    for r in grid.get((math.floor(x / C), math.floor(z / C)), ()):
        b = r['bbox']
        if b[0] <= x <= b[2] and b[1] <= z <= b[3] and inside(r['rings'][0], x, z) and not any(inside(h, x, z) for h in r['rings'][1:]): return r['name']
    return None

def along(e, f):
    pts, d = e['points'], e['length'] * f
    for a, b in zip(pts, pts[1:]):
        l = math.dist(a, b)
        if d <= l and l: t = d / l; return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        d -= l
    return tuple(pts[-1])

names = []
for e in edges:
    votes = defaultdict(int)
    for f in (.25, .5, .75):
        n = name_at(*along(e, f))
        if n: votes[n] += 1
    names.append(max(votes, key=votes.get) if votes else None)

def seg_dist(e, x, z):
    best = 1e9
    for a, b in zip(e['points'], e['points'][1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]; l = dx * dx + dz * dz
        t = 0 if not l else max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l))
        best = min(best, math.hypot(a[0] + dx * t - x, a[1] + dz * t - z))
    return best

egrid = defaultdict(list)
for i, e in enumerate(edges):
    m = e['points'][len(e['points']) // 2]; egrid[math.floor(m[0] / C), math.floor(m[1] / C)].append(i)
def edges_near(x, z, r):
    k = math.ceil(r / C) + 2; i0, j0 = math.floor(x / C), math.floor(z / C)
    return [e for a in range(i0 - k, i0 + k + 1) for b in range(j0 - k, j0 + k + 1) for e in egrid.get((a, b), ())]

# --- count points: the latest count of each point (t_nr, or the same street within 15 m) ---
rd = shapefile.Reader(os.path.join(SRC, 'trafiktaelling'), encoding='latin-1')
points = []
for s, rec in zip(rd.shapes(), rd.records()):
    if not s.points or not rec['aadt_koret'] and not rec['ktj_7_19']: continue
    a, b = to_local.transform(*s.points[0]); x, z = a, -b
    if abs(x) > city['extent'] + 50 or abs(z) > city['extent'] + 50: continue
    cars = rec['aadt_koret'] or round(rec['ktj_7_19'] * 1.17)  # 07-19 is ~85% of the day
    bikes = rec['aadt_cykle'] or (round(rec['cykler_7_1'] * 1.17) if rec['cykler_7_1'] else None)
    points.append(dict(id=rec['t_nr'], street=rec['vejnavn'], x=x, z=z, date=rec['taelle_dat'] or 0, cars=cars, bikes=bikes))
points.sort(key=lambda p: -p['date'])
latest = []
for p in points:
    if any(q['id'] == p['id'] or norm(q['street']) == norm(p['street']) and math.hypot(q['x'] - p['x'], q['z'] - p['z']) < 15 for q in latest): continue
    latest.append(p)

# --- snap each point to a street (its own name within 60 m, else the nearest edge within 30 m) ---
snapped = defaultdict(list)  # street name -> points
by_name, unmatched = 0, 0
for p in latest:
    want = norm(p['street'].split('/')[0])
    near = [(seg_dist(edges[i], p['x'], p['z']), i) for i in edges_near(p['x'], p['z'], 60)]
    same = [t for t in near if t[0] < 60 and names[t[1]] and norm(names[t[1]]) == want]
    pick = min(same) if same else min([t for t in near if t[0] < 30] or [(None, None)])
    if pick[1] is None: unmatched += 1; continue
    by_name += bool(same)
    p['edge'] = pick[1]; snapped[names[pick[1]] or f'#{pick[1]}'].append(p)

# --- spread along each street: every edge takes the nearest count on its street ---
cars, bikes = [None] * len(edges), [None] * len(edges)
for i, e in enumerate(edges):
    pts = snapped.get(names[i]) if names[i] else None
    if not pts: continue
    m = along(e, .5)
    p = min(pts, key=lambda q: math.hypot(q['x'] - m[0], q['z'] - m[1]))
    if math.hypot(p['x'] - m[0], p['z'] - m[1]) > 2500: continue
    cars[i] = p['cars']; bikes[i] = p['bikes'] or None
for key, ps in snapped.items():  # counts snapped to an unnamed edge hold for that edge
    if key.startswith('#'): i = int(key[1:]); cars[i] = ps[0]['cars']; bikes[i] = ps[0]['bikes']

# Short unnamed links (junction pieces, slip lanes) carry what the counted streets either side carry.
nodes_edges = defaultdict(list)
for i, e in enumerate(edges): nodes_edges[e['from']].append(i); nodes_edges[e['to']].append(i)
for vals in (cars, bikes):
    for _ in range(3):
        fill = {}
        for i, e in enumerate(edges):
            if vals[i] is not None or names[i]: continue
            nb = [vals[j] for n in (e['from'], e['to']) for j in nodes_edges[n] if j != i and vals[j] is not None]
            if nb: fill[i] = sum(nb) / len(nb)
        for i, v in fill.items(): vals[i] = v

mob['traffic'] = [round((v or QUIET_CARS) / 10000, 3) for v in cars]
mob['bikeTraffic'] = [round((v or QUIET_BIKES) / 10000, 3) for v in bikes]
mob['trafficSource'] = 'Traffic counts: Københavns Kommune, Trafiktal (CC BY 4.0), opendata.dk/city-of-copenhagen/trafiktal'
open(f'{OUT}/mobility.json', 'w', encoding='utf8').write(json.dumps(mob, separators=(',', ':'), ensure_ascii=False))

counted = sum(v is not None for v in cars)
print(f'{len(latest)} count points ({by_name} by street name, {len(latest) - by_name - unmatched} nearest edge, {unmatched} off the network);'
      f' {counted}/{len(edges)} edges counted, {sum(1 for n in names if n)} named')
for s in ('H.C. Andersens Boulevard', 'Åboulevard', 'Bredgade', 'Nørre Voldgade', 'Store Kongensgade', 'Nyhavn', 'Strandgade'):
    v = [cars[i] for i in range(len(edges)) if names[i] == s]
    print(f'  {s}: {len(v)} edges, cars/day {min((x or QUIET_CARS) for x in v) if v else "-"}..{max((x or QUIET_CARS) for x in v) if v else "-"}')
