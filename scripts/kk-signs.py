#!/usr/bin/env python3
"""Copenhagen's road signs where the city has them: Københavns Kommune's sign register (k101 skilte_total, CC BY 4.0,
GeoJSON in EPSG:4326 from wfs-kbhkort.kk.dk), each standing post (status Opstillet) with its main plates
(hovedtavle_1/_2, the back plate hovedtavle_1_bagside) and their supplementary plates (undertavle_*), as furniture
'sign' items (src 'kk-skilte') with faces from src/danish-signs.js.

  python3 scripts/kk-signs.py <wfs dir> copenhagen     (after kk-water-toilets.py; then parked-cars, furniture-ground,
                                                         indoor-items: docs/COPENHAGEN.md)

- Faces: the codes src/danish-signs.js draws (the commonest ~70, about 88% of the standing main plates, 90% leaving out
  the bus-stop plates SO, which movia-stops.mjs draws as the stop poles); a post with none of them is left out, and a
  supplementary plate only hangs under a drawn main plate (two at most).
- Place: the register's point when it is clear of the drawn carriageway, the cycle tracks, the houses and the water
  (0.15 m round the post); else moved out from the nearest road up to 4.5 m (or the nearest clear spot within 3 m); else
  left out. Traffic islands are not carriageway (keep-right discs stand on them).
- Facing: the register has no bearing. A plate faces the traffic on its side of the nearest road edge (mobility.json; a
  path sign far from the roads, the walkers on the nearest path):
  on a two-way street the drivers whose right-hand side it stands on, on a one-way street the drivers along it (a no-entry
  disc the wrong-way ones). A back plate and the second plate of a double-sided post face the other way.
- The photo-detected signs (src mapillary) are dropped wherever the register covers the area (100 m cells holding a
  register sign, and their neighbours): Københavns Kommune; Frederiksberg keeps them.
Rerunning replaces what it added.
"""
import gzip, json, math, os, subprocess, sys
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
to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
EXT = city['extent'] + 100; G = .25; N = int(2 * EXT / G)

# ---------- faces: the same code as the game (src/danish-signs.js), through node ----------
feats = [f for f in json.load(open(f'{SRC}/skilte_total.json', encoding='utf8'))['features'] if f.get('geometry')]
MAIN = [('hovedtavle_1', 'tekst_i_hovedtavle_1', ('undertavle_1_1', 'undertavle_1_2', 'undertavle_1_3')),
        ('hovedtavle_2', 'tekst_i_hovedtavle_2', ('undertavle_2_1', 'undertavle_2_2', 'undertavle_2_3'))]
key = lambda code, text: 'DK:%s[%s]' % (code.strip(), (text or '').strip())
props = [f['properties'] for f in feats]
raw = sorted({key(p[k], p.get(t)) for p in props for k, t, _ in MAIN + [('hovedtavle_1_bagside', 'x', ())] if p.get(k)})
unders = sorted({p[u] for p in (f['properties'] for f in feats) for _, _, us in MAIN for u in us if p.get(u)})
js = ("import {danishSign,underKind} from './src/danish-signs.js';const [codes,unders]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
      "console.log(JSON.stringify({faces:Object.fromEntries(codes.map(c=>[c,danishSign(c)])),unders:Object.fromEntries(unders.map(u=>[u,underKind(u)]))}));")
js = js.replace("require('fs')", "(await import('fs'))")
res = json.loads(subprocess.run(['node', '--input-type=module', '-e', js], input=json.dumps([raw, unders]), capture_output=True, text=True, check=True).stdout)
FACES, UNDERS = res['faces'], res['unders']
def face(code, text):
    s = FACES.get(key(code, text))
    return s if s and s['known'] else None

# ---------- what is drawn where ----------
def raster(polys, holes=True):
    im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
    for rings in polys:
        for k, ring in enumerate(rings):
            if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=0 if k and holes else 1)
    return np.array(im, dtype=bool)
road = raster([r['rings'] for r in city['roads'] if 'island' not in str(r.get('kind', ''))])
bld = raster([b['rings'] for b in city['buildings']] + ([b['rings'] for b in json.load(open(f'{OUT}/kk-footprints.json'))] if os.path.exists(f'{OUT}/kk-footprints.json') else []))
wpolys = [Polygon(w['rings'][0], w['rings'][1:]).buffer(0) for w in city['water'] if len(w['rings'][0]) > 2]
wtree = STRtree(wpolys)
def wet(x, z): return any(wpolys[i].contains(Point(x, z)) for i in wtree.query(Point(x, z)))
# Cycle tracks as drawn: the ground surfaces' triangles in the cycle-track colour (as kk-shelters.py).
lin = lambda c: (c / 255) / 12.92 if c / 255 <= .04045 else ((c / 255 + .055) / 1.055) ** 2.4
TRACK = np.array([lin(0xc8), lin(0xb8), lin(0xa5)])
im = Image.new('1', (N, N), 0); dr = ImageDraw.Draw(im); paved = []
for rec in json.load(open(f'{OUT}/surface-index.json')):
    v = np.frombuffer(gzip.decompress(open(f"{OUT}/{rec['file']}.pack", 'rb').read()), dtype=np.float32).reshape(-1, 3, 6)
    for tri in v[np.all(np.abs(v[:, 0, 3:] - TRACK) < .01, axis=1)]:
        dr.polygon([((p[0] + EXT) / G, (p[2] + EXT) / G) for p in tri], fill=1)
    paved.extend(v[np.all(np.abs(v[:, :, 1] - .053) < 1e-4, axis=1)])  # an old track paved over (kk-kerbs.py)
for tri in paved: dr.polygon([((p[0] + EXT) / G, (p[2] + EXT) / G) for p in tri], fill=0)
track = np.array(im, dtype=bool); del im, dr, paved
def hit(m, x, z):
    i, j = int((z + EXT) / G), int((x + EXT) / G)
    return 0 <= i < N and 0 <= j < N and m[i, j]
def clear(x, z, r=.15):
    for a, b in ((0, 0), (r, 0), (-r, 0), (0, r), (0, -r)):
        if hit(road, x + a, z + b) or hit(track, x + a, z + b) or hit(bld, x + a, z + b): return False
    return not wet(x, z)

# ---------- road edges, with their direction and whether the street is two-way ----------
edges = mob['roads']['edges']; pairs = {(e['from'], e['to']): k for k, e in enumerate(edges)}
C = 20; eg = defaultdict(list)
for k, e in enumerate(edges):
    if e.get('crossing'): continue
    for a, b in zip(e['points'], e['points'][1:]):
        l = math.dist(a, b)
        if l < .3: continue
        for i in range(math.floor((min(a[0], b[0]) - 25) / C), math.floor((max(a[0], b[0]) + 25) / C) + 1):
            for j in range(math.floor((min(a[1], b[1]) - 25) / C), math.floor((max(a[1], b[1]) + 25) / C) + 1): eg[i, j].append((a, ((b[0] - a[0]) / l, (b[1] - a[1]) / l), l, k))
wg = defaultdict(list)
for e in mob.get('walks', {}).get('edges', []):
    for a, b in zip(e['points'], e['points'][1:]):
        l = math.dist(a, b)
        if l < .3: continue
        for i in range(math.floor((min(a[0], b[0]) - 25) / C), math.floor((max(a[0], b[0]) + 25) / C) + 1):
            for j in range(math.floor((min(a[1], b[1]) - 25) / C), math.floor((max(a[1], b[1]) + 25) / C) + 1): wg[i, j].append((a, ((b[0] - a[0]) / l, (b[1] - a[1]) / l), l, -1))
def nearest_edge(x, z, grid=eg):
    best = None
    for (ax, az), (dx, dz), l, k in grid.get((math.floor(x / C), math.floor(z / C)), ()):
        t = max(0, min(l, (x - ax) * dx + (z - az) * dz)); px, pz = ax + dx * t, az + dz * t; d = math.hypot(x - px, z - pz)
        if d < 25 and (best is None or d < best[0] - .05): best = (d, (dx, dz), (px, pz), k)
    return best
def facing(x, z, wrong_way=False):
    """Yaw of a plate's front (+Z) and the road edge whose traffic it faces."""
    ne = nearest_edge(x, z)
    if not ne:  # a path sign in a park: it faces the walkers coming along the path on its right
        ne = nearest_edge(x, z, wg)
        if not ne: return None, None
        d, (dx, dz), (px, pz), _ = ne
        if (x - px) * -dz + (z - pz) * dx <= 0: dx, dz = -dx, -dz
        return math.atan2(-dx, -dz), None
    d, (dx, dz), (px, pz), k = ne; e = edges[k]
    two_way = (e['to'], e['from']) in pairs
    right = (x - px) * -dz + (z - pz) * dx > 0  # right-hand side of (dx, dz) in x east, z south
    if two_way and not right:  # the drivers coming the other way see it
        dx, dz = -dx, -dz; k = pairs[e['to'], e['from']]
    if wrong_way and not two_way: dx, dz = -dx, -dz
    return math.atan2(-dx, -dz), k

def local(f):
    a, b = to_local.transform(*f['geometry']['coordinates'][:2]); return a, -b
inside = lambda x, z: abs(x) < city['extent'] and abs(z) < city['extent']

# ---------- the register's posts ----------
covered = set()
for f in feats:
    x, z = local(f); covered.add((math.floor(x / 100), math.floor(z / 100)))
covered = {(i + a, j + b) for i, j in covered for a in (-1, 0, 1) for b in (-1, 0, 1)}
added, why, used, speed, oneway = [], Counter(), {}, Counter(), Counter()
limits = mob.get('speedLimit') or []
for f in feats:
    p = f['properties']
    if p.get('status') != 'Opstillet': continue
    x, z = local(f)
    if not inside(x, z): continue
    double = 'begge sider' in str(p.get('placering') or '')
    plates = []  # (face spec, side: 0 front / 1 back)
    for n, (k, t, us) in enumerate(MAIN):
        if not p.get(k): continue
        s = face(p[k], p.get(t))
        if not s: continue
        side = 1 if n and double else 0; plates.append((s, side))
        for u in [u for u in us if p.get(u)][:2]:
            kind = UNDERS.get(p[u]) or 'text'; plates.append(({'code': f'DK:U:{kind}', 'face': f'dk-u-{kind}', 'dk': 'U', 'shape': 'small'}, side))
    if not plates: why['no drawn face' if not str(p.get('hovedtavle_1') or '').startswith('SO') else 'bus stop plate (stop poles)'] += 1; continue
    back = p.get('hovedtavle_1_bagside') and face(p['hovedtavle_1_bagside'], '')
    if back: plates.append((back, 1))
    elif double and not any(q[1] for q in plates): plates.append((plates[0][0], 1))
    # a spot clear of the road, the cycle track, the houses and the water
    spot = (x, z) if clear(x, z) else None
    if not spot:
        ne = nearest_edge(x, z)
        if ne and ne[0] > .05:
            ux, uz = (x - ne[2][0]) / ne[0], (z - ne[2][1]) / ne[0]
            spot = next(((x + ux * r, z + uz * r) for r in np.arange(.25, 4.51, .25) if clear(x + ux * r, z + uz * r)), None)
        if not spot:
            spot = next(((x + math.cos(a) * r, z + math.sin(a) * r) for r in np.arange(.25, 3.01, .25) for a in np.arange(0, 2 * math.pi, math.pi / 8) if clear(x + math.cos(a) * r, z + math.sin(a) * r)), None)
    if not spot: why['no clear spot'] += 1; continue
    sx, sz = spot
    yaw, k = facing(sx, sz, wrong_way=plates[0][0]['dk'] == 'C19')
    if yaw is None: why['no road near'] += 1; continue
    if plates[0][0]['dk'] == 'C55' and k is not None and k < len(limits) and limits[k]:
        # The game's limits are the city's speed lines (traffic-rules.py); where the plate's own number differs from the
        # edge it faces (26 of 156), it shows the limit the game keeps there, so a plate never says what the road does not.
        ok = str(limits[k]) == plates[0][0].get('text'); speed['agrees' if ok else 'set to the road edge'] += 1
        if not ok:
            s0 = FACES.get(key('C55', str(limits[k]))) or json.loads(subprocess.run(['node', '--input-type=module', '-e', "import {danishSign} from './src/danish-signs.js';console.log(JSON.stringify(danishSign(process.argv[1])))", f'DK:C55[{limits[k]}]'], capture_output=True, text=True, check=True).stdout)
            FACES[key('C55', str(limits[k]))] = s0; plates[0] = (s0, plates[0][1])
    if plates[0][0]['dk'] in ('E19', 'E19,1', 'E19,2', 'E19,3', 'C19') and k is not None:
        oneway['one-way in the game' if (edges[k]['to'], edges[k]['from']) not in pairs else 'two-way in the game'] += 1
    faces = [q[0]['face'] for q in plates]; yaws = [round(yaw + math.pi * q[1], 3) for q in plates]
    for q in plates: used[q[0]['face']] = q[0]['code']
    it = {'k': 'sign', 'x': round(sx, 2), 'z': round(sz, 2), 'yaw': yaws[0], 'faces': faces, 'yaws': yaws, 'src': 'kk-skilte', 'ref': [p.get('uuid') or p.get('id')]}
    if math.hypot(sx - x, sz - z) > .01: it['moved'] = round(math.hypot(sx - x, sz - z), 2)
    added.append(it)

before = len(furn['items'])
photo = sum(1 for i in furn['items'] if i['k'] == 'sign' and i.get('src') == 'mapillary' and (math.floor(i['x'] / 100), math.floor(i['z'] / 100)) in covered)
furn['items'] = [i for i in furn['items'] if i.get('src') != 'kk-skilte' and not (i['k'] == 'sign' and i.get('src') == 'mapillary' and (math.floor(i['x'] / 100), math.floor(i['z'] / 100)) in covered)]
furn['items'] += added
keep = {f for i in furn['items'] if i['k'] == 'sign' for f in i.get('faces', [])}
furn['faces'] = sorted([f for f in furn['faces'] if f['face'] in keep and not f['face'].startswith('dk-')] + [{'face': k, 'code': v} for k, v in used.items()], key=lambda f: f['face'])
furn['counts'] = dict(Counter(i['k'] for i in furn['items']))
line = " Road signs in Københavns Kommune from the city's sign register (k101 skilte_total, CC BY 4.0) in place of the photo detections there."
if line.strip() not in (furn.get('note') or ''): furn['note'] = (furn.get('note') or '') + line
open(furn_path, 'w', encoding='utf8').write(json.dumps(furn, separators=(',', ':'), ensure_ascii=False))
plates_n = sum(len(i['faces']) for i in added)
print(f'register signs: {len(added)} posts, {plates_n} plates ({sum(1 for i in added if i.get("moved"))} moved off the road/track/houses); left out {dict(why)}')
print(f'photo signs dropped where the register covers: {photo}; faces in the atlas: {len(furn["faces"])} ({len(used)} Danish); C55 speed plates against the road edge they face: {dict(speed)}; one-way and no-entry plates: {dict(oneway)}')
