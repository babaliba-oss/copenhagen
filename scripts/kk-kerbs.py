#!/usr/bin/env python3
"""Carriageways as wide as the real ones: today's roads (city.pack, buffered from OpenStreetMap centrelines by a width per
road class) are a median ~1.8 m narrower than the street between the kerbs, so the city's kerbside parking, the edge
lines of its road markings and the parking lane itself lay on the pavement. This widens them out to the kerb lines of
GeoDanmark's road edges (Københavns Kommune's WFS k101 vejkant, vejtype Kørevej, as GeoJSON in EPSG:4326, CC BY 4.0).

Each kerb line, sampled every metre, that runs outside a drawn carriageway within DMAX of it is swept onto that
carriageway (the quad between two neighbouring kerb samples and their nearest points on the road); a sample whose sweep,
continued 2 m on into the road, crosses another kerb line is a kerb behind the street's own (the back of a pavement, the
next street) and is not used. The strips are kept off the houses (OpenStreetMap footprints, the model's own footprints
kk-footprints.json and GeoDanmark's buildings, k101 bygning_kk) by MIN_WALK so the pavement keeps a usable width (by
MIN_WALK + a cycle track's width where a cycle track runs beside the road), off the water, the traffic islands and the
existing roads, and a metre clear of each street tree (the trees in the parking lane stand in beds of their own).
Frederiksberg (no data) and roads drawn wider than the kerbs are left as they are; nothing is narrowed.

Written:
  city.pack roads      + the strips as carriageway (id kk-kerb-<n>, the name and material of the road they widen);
                       the pavement polygons cut back to the new kerb (originals kept in cities/<id>/kerb-pavement.json
                       so a rerun starts from them), so the kerbstones and the walkers follow it
  surfaces/*.bin.pack  + the strips at 6.8 cm (the road band, under the mapped carriageway at 7 cm) in the road's colour;
                       + the cycle tracks moved out with the kerb at 5.2 cm (over the pavement at 5 cm): the track that
                       ran beside a widened road continues from the new kerb, CYCLE wide
  cycle-marks.json     the painted bicycles the wider road now covers moved out onto the track (or dropped)
  furniture.json       ground items now on the carriageway moved back onto the pavement past the kerb (and past a cycle
                       track), or dropped where there is no room (wire lamps hang over the street and stay)
Rerunnable: earlier output (kk-kerb-* roads, the 6.8 / 5.2 cm triangles, the cut pavements) is undone first.
Then, in this order: road-walls, kk-shelters, kk-water-toilets, parked-cars + parked-lanes, surface-fill, kk-surfaces,
kk-markings, furniture-ground, indoor-items, kerb-walks (docs/COPENHAGEN.md).

  python3 scripts/kk-kerbs.py <wfs dir> copenhagen [--dry]
"""
import gzip, json, math, os, sys
import numpy as np
import shapely
from shapely.geometry import shape, box
from pyproj import Transformer

args = [a for a in sys.argv[1:] if not a.startswith('--')]; DRY = '--dry' in sys.argv
SRC, CID = args[0], (args[1] if len(args) > 1 else 'copenhagen')
ROOT = f'public/cities/{CID}/'; SIDE = f'cities/{CID}/kerb-pavement.json'
DMAX, MIN_GAP, PROBE, STEP = 4.5, .25, 2.0, 1.0  # widest widening, smallest worth drawing, the sweep's probe on into the road, kerb sampling
MIN_WALK, CYCLE, TREE = 1.5, 2.3, 1.0
Y_ROAD, Y_TRACK, Y_PAVE, CELL, TILE = .068, .052, .053, 100.0, 300.0
srgb = lambda h: [((v / 255) / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4) for v in bytes.fromhex(h)]
COLOUR = {'Asfaltti': srgb('919d98'), 'Nupukivi': srgb('aaa99e'), 'Betonikivi': srgb('c8c4ba')}  # world-formats.mjs
TRACK, PAVE = srgb('c8b8a5'), srgb('dfdcd1')

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
def triangles(polys):
    out = []
    for p in polys:
        for t in shapely.get_parts(shapely.constrained_delaunay_triangles(p)):
            c = np.asarray(t.exterior.coords)[:3]
            if (c[1, 1] - c[0, 1]) * (c[2, 0] - c[0, 0]) - (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) < 0: c = c[[0, 2, 1]]  # facing up
            out.append(c)
    return np.asarray(out).reshape(-1, 3, 2)
def union_near(geoms, tree, g):
    i = tree.query(g)
    return shapely.union_all(geoms[i]) if len(i) else shapely.Polygon()

city = json.loads(read(ROOT + 'city.pack'))
# undo an earlier run
rerun = any(str(r.get('id', '')).startswith('kk-kerb-') for r in city['roads'])  # else a fresh city.pack (city-build.mjs)
city['roads'] = [r for r in city['roads'] if not str(r.get('id', '')).startswith('kk-kerb-')]
if rerun and os.path.exists(SIDE):
    orig = json.load(open(SIDE, encoding='utf8'))
    pave = [p for p in city['pavement'] if not p.get('kerbCut')]
    for i, item in sorted((int(k), v) for k, v in orig['items'].items()): pave.insert(i, item)
    city['pavement'] = pave
index = json.load(open(ROOT + 'surface-index.json'))
tiles, changed, track_tris = {}, set(), []
for rec in index:
    a = np.frombuffer(read(ROOT + rec['file'] + '.pack'), np.float32).reshape(-1, 6)
    a = a[:len(a) // 3 * 3].reshape(-1, 3, 6)
    keep = ~(np.all(np.abs(a[:, :, 1] - Y_ROAD) < 1e-4, axis=1) | np.all(np.abs(a[:, :, 1] - Y_TRACK) < 1e-4, axis=1) | np.all(np.abs(a[:, :, 1] - Y_PAVE) < 1e-4, axis=1))
    if not keep.all(): changed.add(rec['file'])
    a = tiles[rec['file']] = a[keep]
    sel = (np.abs(a[:, 0, 1] - .05) < 1e-4) & (a[:, 0, 3] - a[:, 0, 5] > .15)  # the cycle tracks (c8b8a5)
    if sel.any(): track_tris.append(a[sel][:, :, [0, 2]])
tt = np.concatenate(track_tris); track = shapely.polygons(np.concatenate([tt, tt[:, :1]], axis=1)); track = track[shapely.area(track) > 1e-4]
ttree = shapely.STRtree(track)

to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
local = lambda g: shapely.transform(g, lambda c: np.column_stack(to_local.transform(c[:, 0], c[:, 1])) * [1, -1])
E = city['extent']
base_items = [r for r in city['roads'] if str(r.get('kind', '')).startswith('Ajorata')]
base = np.array([poly(r['rings']) for r in base_items]); ok = np.array([g is not None for g in base]); base_items = [r for r, k in zip(base_items, ok) if k]; base = base[ok]
btree = shapely.STRtree(base)
allroad = np.array([g for g in (poly(r['rings']) for r in city['roads']) if g is not None]); atree = shapely.STRtree(allroad)
water = np.array([g for g in (poly(w['rings']) for w in city['water']) if g is not None]); wtree = shapely.STRtree(water)
houses = [poly(b['rings']) for b in city['buildings']]
if os.path.exists(ROOT + 'kk-footprints.json'): houses += [poly(b['rings']) for b in json.load(open(ROOT + 'kk-footprints.json'))]
if os.path.exists(f'{SRC}/bygning_kk.json'):
    for f in json.load(open(f'{SRC}/bygning_kk.json', encoding='utf8'))['features']:
        if f['geometry']: houses.append(shapely.make_valid(local(shape(f['geometry']))))
houses = np.array([h for h in houses if h is not None and not h.is_empty]); htree = shapely.STRtree(houses)
trees = shapely.points(np.array([t['p'] for t in city['trees']])); trtree = shapely.STRtree(trees)

# kerb lines: the carriageway's (Kørevej) and the cycle tracks' outer edges (Cykelsti langs vej)
def kerb_lines(kind):
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
road_lines, cycle_lines = kerb_lines('Kørevej'), kerb_lines('Cykelsti langs vej')
segs = shapely.linestrings(np.concatenate([np.stack([c[:-1], c[1:]], 1) for c in road_lines + cycle_lines]))
stree = shapely.STRtree(segs)
cycle_edges = shapely.multilinestrings([shapely.linestrings(c) for c in cycle_lines]); cetree = shapely.STRtree(shapely.get_parts(cycle_edges)); cedges = shapely.get_parts(cycle_edges)

def sweep(lines, target, tree, into, label):
    """Quads between neighbouring kerb samples outside `target` (within DMAX) and their nearest points on it, for the
    samples whose way onto it (continued `into` m on; a negative `into` stops short) crosses no other kerb line."""
    P = np.concatenate(lines); line_of = np.concatenate([np.full(len(c), i) for i, c in enumerate(lines)]); pts = shapely.points(P)
    (ip, ir), dist = tree.query_nearest(pts, max_distance=DMAX, return_distance=True)
    near = np.full(len(P), -1); d = np.full(len(P), np.inf)
    for i, r, dd in zip(ip, ir, dist):  # ties: the first
        if near[i] < 0: near[i], d[i] = r, dd
    good = (near >= 0) & (d > MIN_GAP) & (d <= DMAX)
    foot = np.full((len(P), 2), np.nan); gi = np.flatnonzero(good)
    foot[gi] = shapely.get_coordinates(shapely.shortest_line(pts[gi], target[near[gi]])).reshape(-1, 2, 2)[:, 1]
    u = (foot[gi] - P[gi]) / d[gi, None]
    probe = shapely.linestrings(np.stack([P[gi] + u * .02, foot[gi] + u * into], 1))
    qi, qs = stree.query(probe, predicate='intersects')
    own = shapely.distance(segs[qs], pts[gi[qi]]) < .03  # the sample's own kerb segments
    behind = np.zeros(len(gi), bool); behind[np.unique(qi[~own])] = True
    good[gi[behind]] = False
    quads = []
    for i in np.flatnonzero(good[:-1] & good[1:] & (line_of[:-1] == line_of[1:])):
        if math.dist(foot[i], foot[i + 1]) > 3 * STEP: continue  # round a corner of the road: no sweep across it
        quads.append(shapely.convex_hull(shapely.multipoints([P[i], P[i + 1], foot[i + 1], foot[i]])))
    print(f'{CID}: {label}: {len(lines)} lines, {len(P)} samples; {int((near >= 0).sum())} within {DMAX} m, '
          f'{int(((near >= 0) & (d <= MIN_GAP)).sum())} on its edge or inside, {int(behind.sum())} behind another kerb, {len(quads)} sweeps')
    return np.array(quads)
def cells(quads):
    x0, z0, x1, z1 = shapely.total_bounds(quads); qtree = shapely.STRtree(quads)
    for kx in range(math.floor(x0 / CELL), math.floor(x1 / CELL) + 1):
        for kz in range(math.floor(z0 / CELL), math.floor(z1 / CELL) + 1):
            cell = box(kx * CELL, kz * CELL, (kx + 1) * CELL, (kz + 1) * CELL); qi = qtree.query(cell)
            if len(qi): yield cell, shapely.union_all(quads[qi]).intersection(cell), cell.buffer(6)
def houses_near(pad):
    hi = htree.query(pad); return shapely.union_all(houses[hi]) if len(hi) else shapely.Polygon()
clean = lambda g: shapely.make_valid(g.buffer(-.1, quad_segs=1).buffer(.1, quad_segs=1).simplify(.08))

# 1. the carriageway out to its kerbs
added, net = [], 0.0
for cell, grow, pad in cells(sweep(road_lines, base, btree, PROBE, 'carriageway kerbs')):
    roads = union_near(allroad, atree, pad); wet = union_near(water, wtree, pad); hs = houses_near(pad)
    tk = shapely.union(union_near(track, ttree, pad), union_near(cedges, cetree, pad).buffer(1))  # a cycle track runs here
    ti = trtree.query(pad); beds = shapely.union_all(shapely.buffer(trees[ti], TREE, quad_segs=3)) if len(ti) else shapely.Polygon()
    cut = shapely.union_all([roads, wet, hs.buffer(MIN_WALK, quad_segs=2), beds,
                             hs.buffer(MIN_WALK + CYCLE, quad_segs=2).intersection(tk.buffer(3, quad_segs=2))])
    g = grow.difference(cut).buffer(-.1, quad_segs=1).buffer(.1, quad_segs=1).intersection(cell).difference(roads)
    bi = btree.query(pad)
    for p in parts(g, .5):
        net += p.area; probe = p.buffer(.6)
        best = max(bi, key=lambda j: shapely.area(shapely.intersection(base[j], probe)))
        p = shapely.make_valid(p.buffer(.08, join_style='mitre', mitre_limit=2).simplify(.08))  # the 1 m kerb samples, thinned; never short of the road it meets
        for q in parts(p.difference(shapely.union(hs.buffer(MIN_WALK - .1, quad_segs=2), wet)), .5): added.append((q, base_items[best]))
newroad = np.array([p for p, _ in added]); ntree = shapely.STRtree(newroad)
print(f'{CID}: {len(added)} carriageway strips, {net:.0f} m2 more carriageway')

# 2. the cycle tracks: from the new kerb out to their own outer edge where GeoDanmark has one; elsewhere a track that ran
# beside a widened road moves out with the kerb, CYCLE wide. The old track left beyond the new one is paved over.
road2 = np.concatenate([allroad, newroad]); r2tree = shapely.STRtree(road2)
kk_track, extra, paved = [], [], []
cq = sweep(cycle_lines, road2, r2tree, -.3, 'cycle track edges'); cqtree = shapely.STRtree(cq)
for cell, grow, pad in cells(cq):
    roads = union_near(road2, r2tree, pad); wet = union_near(water, wtree, pad); hs = houses_near(pad)
    kk_track += parts(clean(grow.difference(shapely.union_all([roads, wet, hs]))).intersection(cell), .5)
kt = np.array(kk_track); kttree = shapely.STRtree(kt)
x0, z0, x1, z1 = shapely.total_bounds(newroad)
for kx in range(math.floor(x0 / CELL), math.floor(x1 / CELL) + 1):
    for kz in range(math.floor(z0 / CELL), math.floor(z1 / CELL) + 1):
        cell = box(kx * CELL, kz * CELL, (kx + 1) * CELL, (kz + 1) * CELL); pad = cell.buffer(6)
        mine = union_near(newroad, ntree, pad); tk = union_near(track, ttree, pad)
        if mine.is_empty or tk.is_empty: continue
        roads = union_near(road2, r2tree, pad); wet = union_near(water, wtree, pad); hs = houses_near(pad); kk = union_near(kt, kttree, pad)
        e = mine.buffer(CYCLE, quad_segs=2).intersection(tk.buffer(2.5, quad_segs=2)).difference(
            shapely.union_all([roads, wet, hs.buffer(MIN_WALK, quad_segs=2), tk, kk.buffer(2.5, quad_segs=2)])).intersection(cell)
        extra += parts(clean(e), .5)
        if not kk.is_empty:
            o = tk.intersection(kk.buffer(2.5, quad_segs=2)).difference(shapely.union_all([kk, roads])).intersection(cell)
            paved += parts(clean(o), .5)
extra = kk_track + extra
print(f'{CID}: cycle tracks: {len(kk_track)} pieces from the kerb to their outer edge ({sum(p.area for p in kk_track):.0f} m2), {len(extra) - len(kk_track)} moved out with the kerb ({sum(p.area for p in extra[len(kk_track):]):.0f} m2); {sum(p.area for p in paved):.0f} m2 of the old track paved over')

# the new carriageway and track, for moving what stands on them
extra = np.array(extra); etree = shapely.STRtree(extra) if len(extra) else None
def on(geoms, tree, x, z):
    if tree is None: return False
    pt = shapely.Point(x, z); i = tree.query(pt, predicate='intersects'); return len(i) > 0
def in_road(x, z): return on(newroad, ntree, x, z) or on(allroad, atree, x, z)
paved = np.array(paved); ptree = shapely.STRtree(paved) if len(paved) else None
def in_track(x, z): return on(track, ttree, x, z) and not on(paved, ptree, x, z) or on(extra, etree, x, z)
def blocked(x, z): return on(houses, htree, x, z) or on(water, wtree, x, z)
def kerb_out(x, z):
    """The nearest point of the carriageway's edge and the direction out across it, from a point on the carriageway."""
    pt = shapely.Point(x, z); pad = pt.buffer(DMAX + 2)
    i, j = ntree.query(pad), atree.query(pad)
    r = shapely.union_all(np.concatenate([newroad[i], allroad[j]])).buffer(.05, quad_segs=1).buffer(-.05, quad_segs=1)  # no hairline seams
    q = shapely.get_coordinates(shapely.shortest_line(pt, r.boundary))[1]
    v = q - (x, z); n = np.hypot(*v)
    return (q, v / n) if n > 1e-6 else (None, None)

# painted bicycles on the tracks
cm_path = ROOT + 'cycle-marks.json'; cm = json.load(open(cm_path, encoding='utf8'))
marks, mk_moved, mk_dropped = [], 0, 0
for m in cm['marks']:
    x, z, yaw = m
    if on(newroad, ntree, x, z):  # out across the new kerb onto the track
        q, v = kerb_out(x, z); t = q + v * CYCLE / 2 if q is not None else None
    elif on(paved, ptree, x, z) and not in_track(x, z):  # on the old track paved over: in onto the new one
        pt = shapely.Point(x, z); i = etree.query_nearest(pt, max_distance=4)
        t = None
        if len(i):
            q = shapely.get_coordinates(shapely.shortest_line(pt, extra[i[0]]))[1]; v = q - (x, z); n = np.hypot(*v)
            t = q + v / n * .8 if n > 1e-6 else q
    else: marks.append(m); continue
    if t is not None and in_track(*t) and not in_road(*t) and not blocked(*t): marks.append([round(t[0], 2), round(t[1], 2), yaw]); mk_moved += 1
    else: mk_dropped += 1
cm['marks'] = marks
print(f'{CID}: painted bicycles: {mk_moved} moved out onto the track, {mk_dropped} dropped')

# street furniture standing on the wider carriageway
furn = json.load(open(ROOT + 'furniture.json', encoding='utf8'))
kept, moved, dropped = [], {}, {}
for it in furn['items']:
    if it['k'] == 'wire-lamp' or not on(newroad, ntree, it['x'], it['z']): kept.append(it); continue
    q, v = kerb_out(it['x'], it['z']); spot = None
    if q is not None:
        for s in np.arange(.45, 3.01, .25):  # past the kerb, and past a cycle track there
            t = q + v * s
            if in_road(*t) or blocked(*t): break
            if not in_track(*t): spot = t; break
    if spot is None: dropped[it['k']] = dropped.get(it['k'], 0) + 1; continue
    it['x'], it['z'] = round(float(spot[0]), 2), round(float(spot[1]), 2); kept.append(it); moved[it['k']] = moved.get(it['k'], 0) + 1
furn['items'] = kept
print(f'{CID}: furniture on the wider carriageway: {sum(moved.values())} moved onto the pavement {moved}, {sum(dropped.values())} dropped {dropped}')
if DRY: sys.exit()

# city.pack: the strips as carriageway, the pavements cut back to them
for n, (p, r) in enumerate(added):
    rings = rings_of(p); xs = [c[0] for c in rings[0]]; zs = [c[1] for c in rings[0]]
    city['roads'].append({'id': f'kk-kerb-{n}', 'name': r.get('name', ''), 'address': '', 'rings': rings, 'bbox': [min(xs), min(zs), max(xs), max(zs)],
                          'kind': 'Ajorata', 'material': r.get('material') if r.get('material') in COLOUR else 'Asfaltti'})
pave_orig, pave_out, cut_n = {}, [], 0
for i, p in enumerate(city['pavement']):
    g = poly(p['rings'])
    j = ntree.query(g, predicate='intersects') if g is not None else []
    if not len(j): pave_out.append(p); continue
    rest = g.difference(shapely.union_all(newroad[j]))
    if abs(rest.area - g.area) < .05: pave_out.append(p); continue
    pave_orig[str(i)] = p; cut_n += 1
    for q in parts(rest, .2):
        rings = rings_of(q); xs = [c[0] for c in rings[0]]; zs = [c[1] for c in rings[0]]
        pave_out.append({**p, 'rings': rings, 'bbox': [min(xs), min(zs), max(xs), max(zs)], 'kerbCut': 1})
city['pavement'] = pave_out
print(f'{CID}: {cut_n} pavement polygons cut back to the kerb')
open(SIDE, 'w', encoding='utf8').write(json.dumps({'note': 'pavement polygons of city.pack as they were before scripts/kk-kerbs.py cut them back to the kerb (by index)', 'items': pave_orig}, separators=(',', ':'), ensure_ascii=False))
open(ROOT + 'city.pack', 'wb').write(gzip.compress(json.dumps(city, separators=(',', ':'), ensure_ascii=False).encode(), 9, mtime=0))

# surface chunks
add = {}
for (p, r) in added:
    add.setdefault(r.get('material') if r.get('material') in COLOUR else 'Asfaltti', []).append(p)
add = [(Y_ROAD, COLOUR[m], ps) for m, ps in add.items()] + [(Y_TRACK, TRACK, list(extra)), (Y_PAVE, PAVE, list(paved))]
n_tris = 0
for y, colour, ps in add:
    if not ps: continue
    tris = triangles(ps); n_tris += len(tris)
    v = np.zeros((len(tris), 3, 6), np.float32); v[:, :, 0] = tris[:, :, 0]; v[:, :, 2] = tris[:, :, 1]; v[:, :, 1] = y; v[:, :, 3:] = colour
    kx = np.floor(tris[:, :, 0].mean(1) / TILE).astype(int); kz = np.floor(tris[:, :, 1].mean(1) / TILE).astype(int)
    for key in set(zip(kx, kz)):
        file = f'surfaces/{key[0]}_{key[1]}.bin'; sel = (kx == key[0]) & (kz == key[1])
        tiles[file] = np.concatenate([tiles[file], v[sel]]) if file in tiles else v[sel]; changed.add(file)
by_file = {rec['file']: rec for rec in index}
for file in sorted(changed):
    flat = tiles[file].reshape(-1, 6)
    if not len(flat): os.remove(ROOT + file + '.pack'); by_file.pop(file, None); continue
    open(ROOT + file + '.pack', 'wb').write(gzip.compress(flat.astype(np.float32).tobytes(), 9, mtime=0))
    rec = by_file.setdefault(file, {'file': file})
    rec['bbox'] = [int(v) if v == int(v) else v for v in map(float, (flat[:, 0].min(), flat[:, 2].min(), flat[:, 0].max(), flat[:, 2].max()))]
json.dump(list(by_file.values()), open(ROOT + 'surface-index.json', 'w'), separators=(',', ':'))
json.dump(cm, open(cm_path, 'w', encoding='utf8'), separators=(',', ':'), ensure_ascii=False)
open(ROOT + 'furniture.json', 'w', encoding='utf8').write(json.dumps(furn, separators=(',', ':'), ensure_ascii=False))
print(f'{CID}: {n_tris} triangles in {len(changed)} surface chunks written')
