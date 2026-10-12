#!/usr/bin/env python3
"""Copenhagen in 1760: a second city ('copenhagen-1760') derived from the 2026 raw OpenStreetMap cache.

What changes (sources: the 17th–18th century fortification line, which today's Vester/Nørre/Øster Voldgade
follow on the inside and the park lakes of Ørstedsparken, Botanisk Have and Østre Anlæg preserve on the
outside; Christianshavn's and Kastellet's ramparts still stand; building years from the City of Copenhagen's
SAVE register, CC BY 4.0):
  - Inside the walls (old town, Frederiksstaden, Slotsholmen, Christianshavn) the street plan and building
    plots stay; modern blocks are later restyled as period houses by kk-buildings.py --era 1760.
  - Outside the walls only buildings the register dates to 1760 or earlier remain; the rest is open land
    (grass), with the old country roads out of the gates.
  - The western and northern rampart is rebuilt as a terraced earthwork with bastions, and a moat in front.
  - No trams, buses or bus stops.
Writes data/raw/cities/copenhagen-1760/*.json and cities/copenhagen-1760/city.json; then run
  node scripts/city-build.mjs copenhagen-1760
  python3 scripts/kk-buildings.py <dxf.zip> copenhagen-1760 --era 1760 --save /home/claude/kkdata/save.json
"""
import json, math, os, sys
from pyproj import Transformer
from shapely.geometry import Polygon, LineString, Point, shape, mapping
from shapely.ops import unary_union, transform
from shapely.prepared import prep

SAVE = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/kkdata/save.json'
SRC, DST = 'data/raw/cities/copenhagen', 'data/raw/cities/copenhagen-1760'
os.makedirs(DST, exist_ok=True)
cfg = json.load(open('cities/copenhagen/city.json'))
lon0, lat0 = cfg['origin']
P = f'+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs'
fwd = Transformer.from_crs('EPSG:4326', P, always_xy=True).transform
inv = Transformer.from_crs(P, 'EPSG:4326', always_xy=True).transform
utm = Transformer.from_crs('EPSG:25832', P, always_xy=True).transform
M = lambda pts: [fwd(*p) for p in pts]

# ---- the 1760 line, traced on today's streets (lon, lat) ----
WALL = M([(12.5757, 55.6712), (12.5734, 55.6735), (12.5703, 55.6762), (12.5664, 55.6779), (12.5661, 55.6801), (12.5683, 55.6822),
          (12.5712, 55.6836), (12.5744, 55.6859), (12.5781, 55.6876), (12.5826, 55.6889), (12.5873, 55.6894), (12.5905, 55.6893)])
OLD_TOWN = Polygon(WALL + M([(12.5960, 55.6890), (12.5995, 55.6852), (12.5970, 55.6800), (12.5918, 55.6770), (12.5868, 55.6746), (12.5815, 55.6722)]))
CHRISTIANSHAVN = Polygon(M([(12.5812, 55.6702), (12.5868, 55.6683), (12.5935, 55.6676), (12.5995, 55.6696), (12.6045, 55.6738), (12.6060, 55.6790),
                            (12.6022, 55.6832), (12.5968, 55.6800), (12.5920, 55.6762), (12.5862, 55.6738)]))
KASTELLET = Point(fwd(12.5945, 55.6913)).buffer(330)
ZONE = unary_union([OLD_TOWN, CHRISTIANSHAVN, KASTELLET]); ZP = prep(ZONE)
COUNTRY_ROADS = {'Vesterbrogade', 'Gammel Kongevej', 'Frederiksberg Allé', 'Nørrebrogade', 'Østerbrogade', 'Amagerbrogade', 'Blegdamsvej',
                 'Strandboulevarden', 'Kalkbrænderihavnsgade', 'Torvegade', 'Peblinge Dossering', 'Sortedam Dossering', 'Øster Søgade', 'Nørre Søgade', 'Vester Søgade',
                 'Dronning Louises Bro', 'Fredensbro', 'Langebro'}

# ---- the earthwork: terraced bands outward from the wall line, bastions every ~260 m, moat beyond ----
line = LineString(WALL)
def outward_side():
    # the side away from the town centre (Kongens Nytorv)
    c = Point(fwd(12.5856, 55.6797)); a = line.parallel_offset(40, 'left'); b = line.parallel_offset(40, 'right')
    return 'left' if a.distance(c) > b.distance(c) else 'right'
side = outward_side()
def strip(d0, d1):
    a = line.parallel_offset(d0, side) if d0 > 0 else line; b = line.parallel_offset(d1, side)
    ca, cb = list(a.coords), list(b.coords)
    if Point(ca[0]).distance(Point(cb[0])) > Point(ca[0]).distance(Point(cb[-1])): cb = cb[::-1]
    return Polygon(ca + cb[::-1]).buffer(0)
bastions = []
L = line.length; n = int(L // 260)
for k in range(1, n + 1):
    s = k * L / (n + 1); p = line.interpolate(s); q = line.interpolate(min(L, s + 1)); r = line.interpolate(max(0, s - 1))
    dx, dz = q.x - r.x, q.y - r.y; l = math.hypot(dx, dz); tx, tz = dx / l, dz / l
    nx, nz = (-tz, tx) if side == 'left' else (tz, -tx)
    bastions.append(Polygon([(p.x - tx * 55, p.y - tz * 55), (p.x - tx * 40 + nx * 40, p.y - tz * 40 + nz * 40), (p.x + nx * 85, p.y + nz * 85),
                             (p.x + tx * 40 + nx * 40, p.y + tz * 40 + nz * 40), (p.x + tx * 55, p.y + tz * 55)]))
rampart = unary_union([strip(0, 34)] + bastions)
terraces = [(rampart.buffer(-0.0), 2.6), (rampart.buffer(-6), 5.0), (rampart.buffer(-12), 7.2)]
moat = unary_union([strip(30, 110)] + [b.buffer(26) for b in bastions]).difference(rampart).difference(OLD_TOWN)

def ring_geo(poly):
    polys = [poly] if poly.geom_type == 'Polygon' else list(poly.geoms)
    return [[{'lat': la, 'lon': lo} for lo, la in (inv(x, y) for x, y in g.exterior.coords)] for g in polys if g.area > 20]

# ---- SAVE: buildings standing in 1760 ----
old = []
for f in json.load(open(SAVE))['features']:
    y = f['properties'].get('opfoerelse_aar') or 9999
    if y <= 1760 and f['geometry']:
        try: old.append(transform(lambda x, y, z=None: utm(x, y), shape(f['geometry'])).buffer(1))
        except Exception: pass
OLD = prep(unary_union(old)) if old else None
print('buildings dated <= 1760:', len(old))

def centroid(geom):
    xs = [g['lon'] for g in geom]; ys = [g['lat'] for g in geom]; return Point(fwd(sum(xs) / len(xs), sum(ys) / len(ys)))
def keep_building(pt): return ZP.contains(pt) or (OLD and OLD.contains(pt))

# ---- areas ----
areas = json.load(open(f'{SRC}/areas.json'))['elements']; out = []; dropped = 0
for e in areas:
    t = e.get('tags', {})
    geom = e.get('geometry') or next((m.get('geometry') for m in e.get('members', []) if m.get('role') == 'outer' and m.get('geometry')), None)
    if not geom: continue
    c = centroid(geom)
    if 'building' in t:
        if not keep_building(c): dropped += 1; continue
    elif t.get('leisure') in ('pitch', 'playground') or (t.get('area:highway') and not ZP.contains(c)):
        continue
    elif not ZP.contains(c) and t.get('leisure') in ('garden',):
        continue
    out.append(e)
# open land outside the walls: grass over the whole square except water and the town
ext = cfg['radiusMetres'] * 1.25 * 1.45
field = Polygon([(-ext, -ext), (ext, -ext), (ext, ext), (-ext, ext)]).difference(ZONE.buffer(10))
for i, g in enumerate(ring_geo(field)): out.append({'type': 'way', 'id': -(50000 + i), 'tags': {'landuse': 'meadow', 'name': 'Fælled'}, 'geometry': g})
# the town's open ground (yards, squares, the strip between street and house) is cobbled
greens = []
for e in out:
    t = e.get('tags', {})
    if (t.get('leisure') in ('park', 'garden') or t.get('landuse') in ('grass', 'cemetery', 'forest') or t.get('natural') == 'water') and e.get('geometry') and len(e['geometry']) > 3:
        try: greens.append(Polygon([fwd(g['lon'], g['lat']) for g in e['geometry']]).buffer(0))
        except Exception: pass
    if t.get('natural') == 'water' and e.get('members'):
        for m in e['members']:
            if m.get('role') == 'outer' and m.get('geometry') and len(m['geometry']) > 3:
                try: greens.append(Polygon([fwd(g['lon'], g['lat']) for g in m['geometry']]).buffer(0))
                except Exception: pass
paved = unary_union([OLD_TOWN, CHRISTIANSHAVN]).difference(unary_union(greens).buffer(1) if greens else Polygon()).difference(rampart.buffer(4)).difference(moat.buffer(2))
for i, g in enumerate(ring_geo(paved)): out.append({'type': 'way', 'id': -(53000 + i), 'tags': {'highway': 'pedestrian', 'area': 'yes', 'surface': 'sett', 'name': 'Brosten'}, 'geometry': g})
for i, g in enumerate(ring_geo(moat)): out.append({'type': 'way', 'id': -(51000 + i), 'tags': {'natural': 'water', 'name': 'Voldgrav'}, 'geometry': g})
for j, (poly, h) in enumerate(terraces):
    for i, g in enumerate(ring_geo(poly)):
        out.append({'type': 'way', 'id': -(52000 + j * 100 + i), 'tags': {'building': 'rampart', 'height': str(h), 'roof:shape': 'flat', 'name': 'Volden', 'era': '1760'}, 'geometry': g})
json.dump({'elements': out}, open(f'{DST}/areas.json', 'w')); print('areas', len(out), 'buildings dropped', dropped)

# ---- highways ----
hw = json.load(open(f'{SRC}/highways.json'))['elements']
nodes = {e['id']: e for e in hw if e['type'] == 'node'}; ways = []
for e in hw:
    if e['type'] != 'way': continue
    t = e['tags']; k = t.get('highway', '')
    if k in ('motorway', 'motorway_link', 'trunk', 'trunk_link', 'busway', 'platform', 'proposed', 'construction', 'raceway', 'elevator', 'cycleway', 'bus_stop', 'corridor'): continue
    pts = [nodes[n] for n in e['nodes'] if n in nodes]
    if not pts: continue
    inside = sum(ZP.contains(Point(fwd(p['lon'], p['lat']))) for p in pts) / len(pts)
    if inside >= .5 or t.get('name') in COUNTRY_ROADS:
        t = {k2: v for k2, v in t.items() if not k2.startswith(('cycleway', 'bus', 'psv', 'maxspeed', 'lanes'))}
        t['surface'] = 'sett' if inside >= .5 else 'gravel'  # cobbled town, gravel country roads
        ways.append({**e, 'tags': t})
used = {n for w in ways for n in w['nodes']}
json.dump({'elements': ways + [n for i, n in nodes.items() if i in used]}, open(f'{DST}/highways.json', 'w')); print('highways', len(ways))

# ---- points, places, transit ----
pts = json.load(open(f'{SRC}/nodes.json'))['elements']
trees = [e for e in pts if e.get('tags', {}).get('natural') == 'tree' and ZP.contains(Point(fwd(e['lon'], e['lat'])))]
# lime rows on the rampart crest, every 12 m
crest = line.parallel_offset(14, side); nid = -900000
for s in range(0, int(crest.length), 12):
    p = crest.interpolate(s); lo, la = inv(p.x, p.y); nid -= 1
    trees.append({'type': 'node', 'id': nid, 'lat': la, 'lon': lo, 'tags': {'natural': 'tree', 'species': 'Tilia'}})
json.dump({'elements': trees}, open(f'{DST}/nodes.json', 'w')); print('trees', len(trees))
pl = json.load(open(f'{SRC}/places.json'))['elements']
def place_ok(e):
    c = e.get('center') or e; p = Point(fwd(c['lon'], c['lat']))
    return ZP.contains(p) or (OLD and OLD.contains(p))
json.dump({'elements': [e for e in pl if place_ok(e)]}, open(f'{DST}/places.json', 'w'))
for f in ('transit', 'stops'): json.dump({'elements': []}, open(f'{DST}/{f}.json', 'w'))

c2 = dict(cfg); c2['id'] = 'copenhagen-1760'; c2['name'] = 'Copenhagen 1760'; c2['era'] = 1760
c2['starts'] = [s for s in cfg['starts'] if ZP.contains(Point(fwd(*s['at'])))] + [{'name': 'Vesterport', 'at': [12.5684, 55.6762]}, {'name': 'Nørreport', 'at': [12.5716, 55.6832]}]
c2['note'] = 'Copenhagen around 1760: built by scripts/era-1760.py from the 2026 city.'
os.makedirs('cities/copenhagen-1760', exist_ok=True)
json.dump(c2, open('cities/copenhagen-1760/city.json', 'w'), indent=1, ensure_ascii=False)
mills = []
for b in bastions:
    c = b.centroid; mills.append([round(c.x, 1), round(-c.y, 1)])
os.makedirs('public/cities/copenhagen-1760', exist_ok=True)
json.dump({'mills': mills}, open('public/cities/copenhagen-1760/era.json', 'w'))
json.dump({'zone': mapping(ZONE), 'rampart': mapping(rampart), 'moat': mapping(moat), 'wall': WALL}, open(f'{DST}/era.json', 'w'))
print('starts', [s['name'] for s in c2['starts']])
