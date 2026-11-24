#!/usr/bin/env python3
"""Carriageways cut back to the city's kerbs where they reach past them. kk-kerbs.py widens the roads out to GeoDanmark's
kerb lines (Københavns Kommune's WFS k101 vejkant, vejtype Kørevej) but never narrows them, so where an OpenStreetMap
carriageway (a centreline buffered by a width per road class) lies off the real street, its far side runs on over the
kerb onto the pavement: asphalt across corners, round Marmorkirken, along wide streets (Vesterbrogade, Nørrebrogade),
with pavement poking back in where the widening strips stop. This takes what lies beyond a kerb off the carriageway.

For every kerb segment (1 m), the road side is the side nearer the traffic's centrelines (mobility.json roads). The band
beyond it reaches out as far as the way back from it to its nearest centreline still crosses a kerb line (1 to 5 m): a
kerb with traffic on both sides (a narrow island between two carriageways, a mapped median) cuts nothing. The cut is
what of that band the drawn carriageway covers, less a strip round each traffic lane (lane offset + 1.2 m), so no lane,
job route or parked row is ever cut into.

Written:
  city.pack roads      the carriageway polygons less the cut (originals in cities/<id>/kerb-fit.json for a rerun);
                       the cut as pavement (id kerb-fit-<n>), so walkers, kerbstones and the map follow it
  surfaces/*.bin.pack  the cut drawn over the road at 7.7 cm (the ground shader's pavement band above the road's),
                       as pavement (dfdcd1), or as cycle track (c8b8a5) between a kerb and a cycle track's outer edge
                       (vejtype Cykelsti langs vej)
  parked.json          the parked cars standing in the cut set aside (kept in kerb-fit.json, back on a rerun)
Rerunnable: earlier output is undone first. Run after kk-kerbs.py (which undoes it too), then kerb-walks.mjs and
kk-markings.py (which keeps its paint off the cut).

  python3 scripts/kerb-fit.py <wfs dir> copenhagen [--dry]
"""
import gzip, json, math, os, sys
import numpy as np
import shapely
from shapely.geometry import shape, box
from pyproj import Transformer

args = [a for a in sys.argv[1:] if not a.startswith('--')]; DRY = '--dry' in sys.argv
SRC, CID = args[0], (args[1] if len(args) > 1 else 'copenhagen')
ROOT = f'public/cities/{CID}/'; SIDE = f'cities/{CID}/kerb-fit.json'
STEP, REACH, LANE_CLEAR, MIN_SIDE, CYCLE_MAX = 1.0, 5, 1.2, .5, 3.2
Y_COVER, CELL, TILE = .077, 100.0, 300.0
srgb = lambda h: [((v / 255) / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4) for v in bytes.fromhex(h)]
PAVE, TRACK = srgb('dfdcd1'), srgb('c8b8a5')

def read(path):
    raw = open(path, 'rb').read()
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
def poly(rings):
    if not rings or len(rings[0]) < 3: return None
    g = shapely.make_valid(shapely.Polygon(rings[0], [h for h in rings[1:] if len(h) > 2]))
    g = shapely.union_all([p for p in shapely.get_parts(g) if p.geom_type == 'Polygon'])
    return None if g.is_empty else g
def parts(g, least=0.0):
    return [p for p in shapely.get_parts(g) if p.geom_type == 'Polygon' and p.area > least]
def rings_of(p):
    r = lambda c: [[round(x, 2), round(z, 2)] for x, z in c]
    return [r(p.exterior.coords)] + [r(h.coords) for h in p.interiors]
def bbox_of(rings):
    xs = [c[0] for c in rings[0]]; zs = [c[1] for c in rings[0]]; return [min(xs), min(zs), max(xs), max(zs)]
def triangles(polys):
    out = []
    for p in polys:
        for t in shapely.get_parts(shapely.constrained_delaunay_triangles(p)):
            c = np.asarray(t.exterior.coords)[:3]
            if (c[1, 1] - c[0, 1]) * (c[2, 0] - c[0, 0]) - (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) < 0: c = c[[0, 2, 1]]  # facing up
            out.append(c)
    return np.asarray(out).reshape(-1, 3, 2)

city = json.loads(read(ROOT + 'city.pack'))
parked = json.load(open(ROOT + 'parked.json', encoding='utf8'))
# undo an earlier run
if os.path.exists(SIDE):
    old = json.load(open(SIDE, encoding='utf8'))
    city['roads'] = [r for r in city['roads'] if not r.get('kerbFit')] + list(old['roads'].values())
    parked['cars'] += old.get('cars', [])
city['pavement'] = [p for p in city['pavement'] if not str(p.get('id', '')).startswith('kerb-fit-')]
index = json.load(open(ROOT + 'surface-index.json'))
tiles, changed = {}, set()
for rec in index:
    a = np.frombuffer(read(ROOT + rec['file'] + '.pack'), np.float32).reshape(-1, 6)
    a = a[:len(a) // 3 * 3].reshape(-1, 3, 6)
    keep = ~np.all(np.abs(a[:, :, 1] - Y_COVER) < 1e-4, axis=1)
    if not keep.all(): changed.add(rec['file'])
    tiles[rec['file']] = a[keep]

to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
local = lambda g: shapely.transform(g, lambda c: np.column_stack(to_local.transform(c[:, 0], c[:, 1])) * [1, -1])
E = city['extent']
def lines(kind):
    out = []
    for f in VEJKANT:
        if f['properties'].get('vejtype') != kind or not f['geometry']: continue
        g = local(shape(f['geometry']))
        if not g.intersects(box(-E - 20, -E - 20, E + 20, E + 20)): continue
        for part in shapely.get_parts(shapely.segmentize(g, STEP)):
            c = np.asarray(part.coords)[:, :2]
            if len(c) > 1: out.append(c)
    return out
VEJKANT = json.load(open(f'{SRC}/vejkant.json', encoding='utf8'))['features']
kerbs, cycles = lines('Kørevej'), lines('Cykelsti langs vej')
A = np.concatenate([c[:-1] for c in kerbs]); B = np.concatenate([c[1:] for c in kerbs])
segs = shapely.linestrings(np.stack([A, B], 1)); stree = shapely.STRtree(segs)

# the traffic's centrelines, and the strip round each lane that is never cut
mob = json.load(open(ROOT + 'mobility.json', encoding='utf8'))['roads']['edges']
cl_a, cl_b, guard = [], [], []
for e in mob:
    p = np.asarray(e['points'], float)
    if len(p) < 2: continue
    cl_a.append(p[:-1]); cl_b.append(p[1:]); guard.append(shapely.buffer(shapely.linestrings(p), abs(e.get('lane', 1.6)) + LANE_CLEAR, quad_segs=2))
cl = shapely.linestrings(np.stack([np.concatenate(cl_a), np.concatenate(cl_b)], 1)); ctree = shapely.STRtree(cl)
guard = np.array(guard); gtree = shapely.STRtree(guard)

def nearest(pts):
    """Distance from each point to its nearest centreline, and the nearest point on it."""
    (ip, ic), d = ctree.query_nearest(pts, return_distance=True, all_matches=False)
    dist = np.full(len(pts), np.inf); dist[ip] = d; foot = np.full((len(pts), 2), np.nan)
    foot[ip] = shapely.get_coordinates(shapely.shortest_line(pts[ip], cl[ic])).reshape(-1, 2, 2)[:, 1]
    return dist, foot

# 1. the band beyond each kerb segment
mid = (A + B) / 2; t = B - A; ln = np.hypot(*t.T); ok = ln > .05
nrm = np.zeros_like(t); nrm[ok] = np.stack([-t[ok, 1], t[ok, 0]], 1) / ln[ok, None]
dp, _ = nearest(shapely.points(mid + nrm * .6)); dm, _ = nearest(shapely.points(mid - nrm * .6))
out = np.where((dp > dm)[:, None], nrm, -nrm); ok &= np.abs(dp - dm) >= MIN_SIDE
reach = np.zeros(len(A), int); live = ok.copy()
for k in range(1, REACH + 1):  # as far out as the way back to the traffic still crosses a kerb
    idx = np.flatnonzero(live)
    if not len(idx): break
    p = shapely.points(mid[idx] + out[idx] * k); _, foot = nearest(p)
    back = shapely.linestrings(np.stack([mid[idx] + out[idx] * k, foot], 1))
    qi, _ = stree.query(back, predicate='intersects')
    hit = np.zeros(len(idx), bool); hit[np.unique(qi)] = True
    reach[idx[hit]] = k; live[idx[~hit]] = False
sel = np.flatnonzero(reach > 0)
bands = shapely.polygons(np.stack([A[sel], B[sel], B[sel] + out[sel] * reach[sel, None], A[sel] + out[sel] * reach[sel, None], A[sel]], 1))
bands = bands[shapely.is_valid(bands)]; btree = shapely.STRtree(bands)
print(f'{CID}: {len(A)} kerb segments, {int(ok.sum())} with a clear road side, {len(sel)} with a band beyond '
      f'(median {np.median(reach[sel]) if len(sel) else 0:.0f} m)')

# between a kerb and a cycle track's outer edge: the track
if cycles:
    P = np.concatenate(cycles); line_of = np.concatenate([np.full(len(c), i) for i, c in enumerate(cycles)]); pts = shapely.points(P)
    (ip, ir), d = stree.query_nearest(pts, max_distance=CYCLE_MAX, return_distance=True, all_matches=False)
    foot = np.full((len(P), 2), np.nan); foot[ip] = shapely.get_coordinates(shapely.shortest_line(pts[ip], segs[ir])).reshape(-1, 2, 2)[:, 1]
    good = ~np.isnan(foot[:, 0]); q = []
    for i in np.flatnonzero(good[:-1] & good[1:] & (line_of[:-1] == line_of[1:])):
        if math.dist(foot[i], foot[i + 1]) <= 3 * STEP: q.append(shapely.convex_hull(shapely.multipoints([P[i], P[i + 1], foot[i + 1], foot[i]])))
    tracks = np.array(q)
else: tracks = np.array([])
ttree = shapely.STRtree(tracks) if len(tracks) else None

# 2. the cut: the drawn carriageway in the bands, less the lanes' strips
roads = [(i, r, poly(r['rings'])) for i, r in enumerate(city['roads'])]
roads = [(i, r, g) for i, r, g in roads if g is not None and r.get('kind') != 'traffic_island']
rgeo = np.array([g for _, _, g in roads]); rtree = shapely.STRtree(rgeo)
cut_parts = []
x0, z0, x1, z1 = shapely.total_bounds(bands)
for kx in range(math.floor(x0 / CELL), math.floor(x1 / CELL) + 1):
    for kz in range(math.floor(z0 / CELL), math.floor(z1 / CELL) + 1):
        cell = box(kx * CELL, kz * CELL, (kx + 1) * CELL, (kz + 1) * CELL)
        bi = btree.query(cell)
        if not len(bi): continue
        ri = rtree.query(cell)
        if not len(ri): continue
        band = shapely.union_all(bands[bi]).buffer(.06, quad_segs=1)  # the seams between neighbouring segments' bands
        g = shapely.intersection(band, shapely.union_all(rgeo[ri])).intersection(cell)
        gi = gtree.query(cell)
        if len(gi): g = g.difference(shapely.union_all(guard[gi]))
        g = g.buffer(-.15, quad_segs=1).buffer(.15, quad_segs=1)  # no hairlines
        cut_parts += parts(shapely.make_valid(g.intersection(cell)), .5)
cut = np.array(cut_parts); cutree = shapely.STRtree(cut)
print(f'{CID}: {len(cut)} pieces of carriageway beyond a kerb, {sum(p.area for p in cut):.0f} m2')
if DRY: sys.exit()

# 3. city.pack: roads less the cut, the cut as pavement
orig, new_roads, n_cut = {}, [], 0
cut_of = {}
for i, r, g in roads:
    j = cutree.query(g, predicate='intersects')
    if len(j): cut_of[i] = (g, j)
for i, r in enumerate(city['roads']):
    if i not in cut_of: new_roads.append(r); continue
    g, j = cut_of[i]; rest = g.difference(shapely.union_all(cut[j]))
    if g.area - rest.area < .05: new_roads.append(r); continue
    orig[str(r['id']) + '#' + str(i)] = r; n_cut += 1
    for q in parts(shapely.make_valid(rest.simplify(.05)), .2):
        rings = rings_of(q); new_roads.append({**r, 'rings': rings, 'bbox': bbox_of(rings), 'kerbFit': 1})
city['roads'] = new_roads
pave_cells = {}  # one pavement polygon per piece and 300 m cell after merging (8,700 small ones made city.pack too big to parse in the tests)
for p in cut: pave_cells.setdefault((math.floor(p.centroid.x / TILE), math.floor(p.centroid.y / TILE)), []).append(p)
n = 0
for ps in pave_cells.values():
    for p in parts(shapely.make_valid(shapely.union_all([q.buffer(.05, join_style='mitre') for q in ps]).simplify(.08)), .5):
        rings = rings_of(p); n += 1
        city['pavement'].append({'id': f'kerb-fit-{n}', 'name': '', 'address': '', 'rings': rings, 'bbox': bbox_of(rings), 'kind': 'Jalkakäytävä', 'material': 'Betonikivi'})
print(f'{CID}: {n_cut} carriageway polygons cut back to the kerb')

# parked cars standing in the cut
zone = shapely.STRtree(np.array([p.buffer(.6, quad_segs=1) for p in cut]))
keep_cars, set_aside = [], []
for car in parked['cars']:
    (set_aside if len(zone.query(shapely.Point(car[0], car[1]), predicate='intersects')) else keep_cars).append(car)
parked['cars'] = keep_cars
print(f'{CID}: {len(set_aside)} parked cars set aside ({len(keep_cars)} left)')

open(ROOT + 'city.pack', 'wb').write(gzip.compress(json.dumps(city, separators=(',', ':'), ensure_ascii=False).encode(), 9, mtime=0))
json.dump(parked, open(ROOT + 'parked.json', 'w', encoding='utf8'), separators=(',', ':'), ensure_ascii=False)
os.makedirs(os.path.dirname(SIDE), exist_ok=True)
json.dump({'note': 'carriageway polygons of city.pack before scripts/kerb-fit.py cut them back to the kerb, and the parked cars it set aside',
           'roads': orig, 'cars': set_aside}, open(SIDE, 'w', encoding='utf8'), separators=(',', ':'), ensure_ascii=False)

# 4. surface chunks: the cut drawn over the road
tk = [shapely.union_all(tracks[ttree.query(p)]) if ttree is not None and len(ttree.query(p)) else shapely.Polygon() for p in cut]
groups = {'pave': [], 'track': []}
for p, t in zip(cut, tk):
    on_track = shapely.make_valid(p.intersection(t)) if not t.is_empty else shapely.Polygon()
    groups['track'] += parts(on_track, .3); groups['pave'] += parts(shapely.make_valid(p.difference(on_track)), .05)
n_tris = 0
for name, colour in (('pave', PAVE), ('track', TRACK)):
    if not groups[name]: continue
    tris = triangles(groups[name]); n_tris += len(tris)
    v = np.zeros((len(tris), 3, 6), np.float32); v[:, :, 0] = tris[:, :, 0]; v[:, :, 2] = tris[:, :, 1]; v[:, :, 1] = Y_COVER; v[:, :, 3:] = colour
    kx = np.floor(tris[:, :, 0].mean(1) / TILE).astype(int); kz = np.floor(tris[:, :, 1].mean(1) / TILE).astype(int)
    for key in set(zip(kx, kz)):
        file = f'surfaces/{key[0]}_{key[1]}.bin'; s = (kx == key[0]) & (kz == key[1])
        tiles[file] = np.concatenate([tiles[file], v[s]]) if file in tiles else v[s]; changed.add(file)
by_file = {rec['file']: rec for rec in index}
for file in sorted(changed):
    flat = tiles[file].reshape(-1, 6)
    if not len(flat): os.remove(ROOT + file + '.pack'); by_file.pop(file, None); continue
    open(ROOT + file + '.pack', 'wb').write(gzip.compress(flat.astype(np.float32).tobytes(), 9, mtime=0))
    rec = by_file.setdefault(file, {'file': file})
    rec['bbox'] = [int(v) if v == int(v) else v for v in map(float, (flat[:, 0].min(), flat[:, 2].min(), flat[:, 0].max(), flat[:, 2].max()))]
json.dump(list(by_file.values()), open(ROOT + 'surface-index.json', 'w'), separators=(',', ':'))
print(f'{CID}: {n_tris} triangles ({sum(p.area for p in groups["track"]):.0f} m2 of it cycle track) in {len(changed)} surface chunks written')
