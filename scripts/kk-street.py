#!/usr/bin/env python3
"""Copenhagen street detail from the City of Copenhagen's open registers (CC BY 4.0, data.kk.dk / wfs-kbhkort.kk.dk):

  street trees (gadetraer)          -> city.pack trees, with genus and a height grown from the planting year
  mast-mounted lamps (mastophaengt) -> furniture 'lamp' / 'mast-lamp' / 'park-lamp' by mast height
  wire-hung lamps (wireophaengt)    -> furniture 'wire-lamp' with the span to the facades on each side
  bike racks (cykelstativ)          -> furniture 'bike-rack' turned along the street
  bollards (byinventar, pullerter)  -> furniture 'bollard'

Mapillary detections of the same things are dropped where the register has one close by, so nothing doubles.
Rerunnable: originals are kept in data/raw/cities/<id>/kk-street-backup/ and every run starts from them.
Run after scripts/city-build.mjs and scripts/mapillary-features.mjs:
  python3 scripts/kk-street.py /home/claude/kkdata copenhagen
"""
import gzip, json, math, os, re, shutil, sqlite3, struct, sys
from pyproj import Transformer

SRC, CID = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'copenhagen')
OUT = f'public/cities/{CID}'
BACK = f'data/raw/cities/{CID}/kk-street-backup'
reg = json.load(open('public/cities/index.json'))
entry = next(c for c in reg['cities'] if c['id'] == CID)
os.makedirs(BACK, exist_ok=True)
for f in ('city.pack', 'furniture.json'):
    if not os.path.exists(f'{BACK}/{f}'): shutil.copy(f'{OUT}/{f}', f'{BACK}/{f}')
city = json.loads(gzip.decompress(open(f'{BACK}/city.pack', 'rb').read()))
furn = json.load(open(f'{BACK}/furniture.json'))
mob = json.load(open(f'{OUT}/mobility.json'))
proj = city['projection']; EXT = city['extent']
from_wgs = Transformer.from_crs('EPSG:4326', proj, always_xy=True)
from_utm = Transformer.from_crs('EPSG:25832', proj, always_xy=True)
def loc(t, x, y):
    a, b = t.transform(x, y); return [round(a, 2), round(-b, 2)]
inside = lambda p: abs(p[0]) < EXT and abs(p[1]) < EXT

# ---------- spatial helpers ----------
class Grid:
    def __init__(s, cell): s.c = cell; s.g = {}
    def key(s, x, z): return (math.floor(x / s.c), math.floor(z / s.c))
    def add(s, x, z, v): s.g.setdefault(s.key(x, z), []).append(v)
    def near(s, x, z, r=1):
        kx, kz = s.key(x, z)
        for i in range(kx - r, kx + r + 1):
            for j in range(kz - r, kz + r + 1): yield from s.g.get((i, j), ())
segs = Grid(20)
for e in mob['roads']['edges']:
    pts = e['points']
    for a, b in zip(pts, pts[1:]):
        segs.add((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a, b))
def street_dir(x, z):
    best, bd = None, 1e9
    for a, b in segs.near(x, z, 2):
        dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz
        if not l2: continue
        t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)); d = math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)
        if d < bd: bd, best = d, (dx, dz)
    if not best: return None, 1e9
    l = math.hypot(*best); return (best[0] / l, best[1] / l), bd
walls = Grid(20)
for b in city['buildings']:
    for ring in b['rings']:
        for a, c in zip(ring, ring[1:]):
            n = max(1, int(math.hypot(c[0] - a[0], c[1] - a[1]) / 20) + 1)
            for k in range(n):
                t = (k + .5) / n; walls.add(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, (a, c))
def ray(x, z, dx, dz, maxd=22):
    best = None; seen = set()
    for r in range(0, int(maxd / 20) + 2):
        px, pz = x + dx * r * 20, z + dz * r * 20
        for s in walls.near(px, pz, 1):
            if id(s) in seen: continue
            seen.add(id(s)); (ax, az), (bx, bz) = s
            ex, ez = bx - ax, bz - az; den = dx * ez - dz * ex
            if abs(den) < 1e-9: continue
            t = ((ax - x) * ez - (az - z) * ex) / den; u = ((ax - x) * dz - (az - z) * dx) / den
            if 0.3 < t < maxd and 0 <= u <= 1 and (best is None or t < best): best = t
    return best
def yaw_along(x, z):
    d, dist = street_dir(x, z)
    return (round(math.atan2(d[0], d[1]), 3) if d else 0), d, dist

# ---------- GeoPackage points ----------
def gpkg_points(path):
    c = sqlite3.connect(path); tb = c.execute('select table_name from gpkg_contents').fetchone()[0]
    cols = [r[1] for r in c.execute(f'pragma table_info("{tb}")')]
    for row in c.execute(f'select * from "{tb}"'):
        rec = dict(zip(cols, row)); g = rec['geom']
        flags = g[3]; env = [0, 32, 48, 48, 64][(flags >> 1) & 7]; w = g[8 + env:]
        bo = '<' if w[0] == 1 else '>'; typ = struct.unpack(bo + 'I', w[1:5])[0] % 1000
        if typ == 4: w = w[9:]; bo = '<' if w[0] == 1 else '>'
        x, y = struct.unpack(bo + 'dd', w[5:21]); yield x, y, rec

items = furn['items']; kk = []
# ---------- lamps ----------
lamps = Grid(15)
def mast_height(s):
    m = re.search(r'(\d+(?:[.,]\d+)?)\s*(?:/[\d.,]+\s*)?m', s or '')
    return float(m.group(1).replace(',', '.')) if m else 6.0
for x, y, r in gpkg_points(f'{SRC}/masts.gpkg'):
    p = loc(from_utm, x, y)
    if not inside(p): continue
    h = mast_height(r.get('maste_data'))
    if not 2 <= h <= 14: h = 6.0
    park = bool(re.search(r'park|LP-lygte|Metropol', r.get('maste_data') or '', re.I)) or h <= 3.6
    k = 'park-lamp' if park else ('lamp' if h >= 7.5 else 'mast-lamp')
    yaw, d, dist = yaw_along(*p)
    # arms reach over the road: +Z of the template points away from the kerb towards the road centre line
    if d and k == 'lamp':
        a, b = d[1], -d[0]  # one perpendicular
        yaw = round(math.atan2(a, b), 3)
    it = {'k': k, 'x': p[0], 'z': p[1], 'yaw': yaw, 'src': 'kk-belysning'}
    kk.append(it); lamps.add(*p, it)
nw = 0
for x, y, r in gpkg_points(f'{SRC}/wires.gpkg'):
    p = loc(from_utm, x, y)
    if not inside(p): continue
    yaw, d, dist = yaw_along(*p)
    if not d: d = (0, 1)
    n = (-d[1], d[0])
    a = ray(p[0], p[1], n[0], n[1]); b = ray(p[0], p[1], -n[0], -n[1])
    it = {'k': 'wire-lamp', 'x': p[0], 'z': p[1], 'yaw': round(math.atan2(n[0], n[1]), 3), 'a': round(a or 7, 1), 'b': round(b or 7, 1),
          'pa': a is None, 'pb': b is None, 'src': 'kk-belysning'}
    kk.append(it); lamps.add(*p, it); nw += 1

# ---------- bike racks ----------
racks = Grid(15)
for f in json.load(open(f'{SRC}/bikeracks.json'))['features']:
    g = f['geometry']
    if not g: continue
    c = g['coordinates'] if g['type'] == 'Point' else g['coordinates'][0]
    p = loc(from_wgs, *c)
    if not inside(p): continue
    yaw, d, dist = yaw_along(*p)
    n = int(f['properties'].get('antal_pladser') or 6)
    # one rack model holds ~5 bikes: long rows become several racks in a line along the kerb
    for k in range(max(1, min(6, round(n / 6)))):
        off = (k - (max(1, min(6, round(n / 6))) - 1) / 2) * 2.6
        q = [round(p[0] + (d[0] if d else 0) * off, 2), round(p[1] + (d[1] if d else 0) * off, 2)]
        it = {'k': 'bike-rack', 'x': q[0], 'z': q[1], 'yaw': yaw, 'src': 'kk-cykelstativ'}
        kk.append(it); racks.add(*q, it)

# ---------- bollards ----------
for f in json.load(open(f'{SRC}/furniture_p.json'))['features']:
    pr = f['properties']
    if pr.get('under_element') != 'Borner, pullerter mv.': continue
    for c in (f['geometry'] or {}).get('coordinates', []):
        p = loc(from_wgs, *c)
        if inside(p): kk.append({'k': 'bollard', 'x': p[0], 'z': p[1], 'yaw': 0, 'src': 'kk-byinventar'})

def near(grid, it, r):
    return any(math.hypot(o['x'] - it['x'], o['z'] - it['z']) < r for o in grid.near(it['x'], it['z'], 1))
kept = [it for it in items if not ((it['k'] == 'lamp' and near(lamps, it, 12)) or (it['k'] == 'bike-rack' and near(racks, it, 8)))]
furn['items'] = kept + kk
furn['note'] = (furn.get('note') or '') + ' Lamps, bike racks and bollards from the City of Copenhagen registers (CC BY 4.0) replace nearby photo detections.'
furn['licence'] = (furn.get('licence') or '') + '; City of Copenhagen open data CC BY 4.0'
counts = {}
for it in furn['items']: counts[it['k']] = counts.get(it['k'], 0) + 1
furn['counts'] = counts
json.dump(furn, open(f'{OUT}/furniture.json', 'w'), separators=(',', ':'))

# ---------- trees ----------
tg = Grid(10); kt = []
for f in json.load(open(f'{SRC}/streettrees.json'))['features']:
    g = f['geometry']
    if not g: continue
    c = g['coordinates'] if g['type'] == 'Point' else g['coordinates'][0]
    p = loc(from_wgs, *c)
    if not inside(p): continue
    pr = f['properties']; sp = pr.get('traeart') or pr.get('slaegt') or ''
    try: age = max(1, 2026 - int(pr.get('planteaar')))
    except Exception: age = 25
    small = bool(re.search(r'^(Sorbus|Prunus|Malus|Crataegus|Pyrus|Amelanchier)', sp))
    h = min(9 if small else 19, 3.5 + age * (.22 if small else .36))
    t = {'p': p, 'species': sp, 'size': '30 - 50 cm' if age > 20 else '10 - 20 cm', 'height': round(h, 1)}
    kt.append(t); tg.add(*p, t)
osm = [t for t in city['trees'] if not any(math.hypot(o['p'][0] - t['p'][0], o['p'][1] - t['p'][1]) < 4 for o in tg.near(*t['p'], 1))]
city['trees'] = kt + osm
open(f'{OUT}/city.pack', 'wb').write(gzip.compress(json.dumps(city, separators=(',', ':')).encode(), 9))

# credit
line = 'Street trees, street lights, bike racks and bollards: City of Copenhagen open data (CC BY 4.0).'
if line not in entry.get('attribution', ''): entry['attribution'] = (entry.get('attribution', '') + ' ' + line).strip()
json.dump(reg, open('public/cities/index.json', 'w'), indent=1, ensure_ascii=False)
print('furniture', counts, 'wire lamps', nw, 'trees', len(kt), 'register +', len(osm), 'osm')
