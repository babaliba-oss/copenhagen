#!/usr/bin/env python3
"""Road markings where the city has them: Københavns Kommune's register of road markings (k101 afmaerkning_total as GeoJSON
in EPSG:4326, CC BY 4.0), drawn as paint on today's carriageways and cycle tracks. The register's polygons are the painted
shapes themselves (each zebra stripe, lane line, stop line, give-way tooth and arrow), so they are appended to the existing
surface chunks as flat triangles at 9.5 cm (2.5 cm over the road at 7 cm; the ground shader's catch-all band keeps their
colour): white lines, zebra crossings, arrows and speed-bump teeth in white, yellow lines in yellow, the blue cycle
crossings in blue and the red bus surface in red. No new meshes or draw calls.

Every marking is clipped to what is drawn: the road band of the surface chunks (not the traffic islands; with the strips
kk-kerbs.py adds out to the city's kerbs) and the cycle tracks, less the houses. Edge lines beyond the drawn kerb (roads
without the city's kerb data, Frederiksberg's) are cut away, not moved. Left out: the parking bays (mostly beyond the drawn kerb; 100k triangles for what is left),
the road symbols (bicycles, BUS, text: 143k triangles for 2,400 m2; the generated bicycles on the cycle tracks stay), the
cycle ramps and prefabricated bumps (objects, not paint).

Also written: road-markings.json, the 16 m cells where the register has markings within 48 m (a bitmask). There the
game's own generated centre dashes and zebra stripes (street-life.js) are not drawn, so the city's paint is not doubled;
outside it (Frederiksberg, the edges of the map) they stay. Rerunnable: earlier output (y = 9.5 cm) is dropped first.

  python3 scripts/kk-markings.py <wfs dir> copenhagen [--dry]     (after kk-surfaces.py)
"""
import base64, gzip, json, math, os, sys
import numpy as np
import shapely
from shapely.geometry import shape, box
from pyproj import Transformer

args = [a for a in sys.argv[1:] if not a.startswith('--')]; DRY = '--dry' in sys.argv; STATS = '--stats' in sys.argv; vstat = {}
SRC, CID = args[0], (args[1] if len(args) > 1 else 'copenhagen')
ROOT = f'public/cities/{CID}/'
srgb = lambda h: [((v / 255) / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4) for v in bytes.fromhex(h)]
Y = .095
PAINT = {'white': srgb('dedbcf'), 'yellow': srgb('d6ae48'), 'blue': srgb('2f63ab'), 'red': srgb('9a4a3c')}
TYPES = {'Hvidafmærkning': 'white', 'Fodgængerfelt': 'white', 'Pileafmærkning': 'white',
         'Vejbump': 'white', 'Gul afmærkning': 'yellow',  # not 'Servicemarkering (10m regel)': the register draws each as a 1.5 m symbol (the real one is a hand-sized triangle on the kerb): 2,277 big yellow triangles lay in the road
         'Blå cykelfelt': 'blue', 'Rød belægning (OB)': 'red'}
SIMPLIFY = {'Hvidafmærkning': .02, 'Gul afmærkning': .02, 'Pileafmærkning': .03, 'Vejbump': .04, 'Fodgængerfelt': .02}
CELL, TILE, GRID = 100.0, 300.0, 16.0  # work cells; the surface chunks' grid (surfaces/<kx>_<kz>.bin); coverage cells

def read(path):
    raw = open(path, 'rb').read()
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
def polygons(items):
    out = []
    for p in items:
        r = p.get('rings')
        if not r or len(r[0]) < 3: continue
        g = shapely.make_valid(shapely.Polygon(r[0], [h for h in r[1:] if len(h) > 2]))
        if not g.is_empty: out.append(g)
    return out

city = json.loads(read(ROOT + 'city.pack'))
index = json.load(open(ROOT + 'surface-index.json'))
tiles, changed, road_tris, cycle_tris, paved_tris = {}, set(), [], [], []
for rec in index:
    a = np.frombuffer(read(ROOT + rec['file'] + '.pack'), np.float32).reshape(-1, 6)
    a = a[:len(a) // 3 * 3].reshape(-1, 3, 6)
    keep = ~np.all(np.abs(a[:, :, 1] - Y) < 1e-4, axis=1)
    if not keep.all(): changed.add(rec['file'])
    a = tiles[rec['file']] = a[keep]
    y = a[:, 0, 1]
    road = ((np.abs(y - .07) < 1e-4) | (np.abs(y - .068) < 1e-4)) & (a[:, 0, 3] < .6)  # carriageway (asphalt, setts, pavers; out to the kerb, kk-kerbs.py), not the pale islands
    cyc = ((np.abs(y - .05) < 1e-4) | (np.abs(y - .052) < 1e-4)) & (a[:, 0, 3] - a[:, 0, 5] > .15)  # cycle-track asphalt (c8b8a5)
    paved = np.abs(y - .053) < 1e-4  # old track paved over by kk-kerbs.py
    for sel, out in ((road, road_tris), (cyc, cycle_tris), (paved, paved_tris)):
        if sel.any(): out.append(a[sel][:, :, [0, 2]])
mk = lambda arr: shapely.polygons(np.concatenate([arr, arr[:, :1]], axis=1)) if len(arr) else np.array([])
road_tris = mk(np.concatenate(road_tris)); cycle_tris = mk(np.concatenate(cycle_tris)); paved_tris = mk(np.concatenate(paved_tris)) if paved_tris else np.array([])
road_tris = road_tris[shapely.area(road_tris) > 1e-4]; cycle_tris = cycle_tris[shapely.area(cycle_tris) > 1e-4]
rtree, ctree, ptree = shapely.STRtree(road_tris), shapely.STRtree(cycle_tris), shapely.STRtree(paved_tris)
houses = polygons(city['buildings'])
if os.path.exists(ROOT + 'kk-footprints.json'): houses += polygons(json.load(open(ROOT + 'kk-footprints.json')))
htree = shapely.STRtree(houses)

to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
E = city['extent']; area = box(-E, -E, E, E)
feats = json.load(open(f'{SRC}/afmaerkning_total.json', encoding='utf8'))['features']
cells, n_in, per_type = {}, 0, {}
N = int(math.ceil(2 * E / GRID)); cover = np.zeros((N, N), bool)
for f in feats:
    t = f['properties'].get('type'); paint = TYPES.get(t)
    if not paint or not f['geometry']: continue
    g = shapely.transform(shape(f['geometry']), lambda c: np.column_stack(to_local.transform(c[:, 0], c[:, 1])) * [1, -1])
    if not g.intersects(area): continue
    g = shapely.make_valid(g)
    if t in SIMPLIFY: g = g.simplify(SIMPLIFY[t])
    n_in += 1; per_type[t] = per_type.get(t, 0) + 1
    x0, z0, x1, z1 = g.bounds
    cx, cz = int((((x0 + x1) / 2) + E) // GRID), int((((z0 + z1) / 2) + E) // GRID)
    if 0 <= cx < N and 0 <= cz < N: cover[cz, cx] = True
    for kx in range(math.floor(x0 / CELL), math.floor(x1 / CELL) + 1):
        for kz in range(math.floor(z0 / CELL), math.floor(z1 / CELL) + 1):
            cells.setdefault((kx, kz), []).append((paint, t, g))

added, tris_by, m2_by = {}, {}, {}
for (kx, kz), items in sorted(cells.items()):
    cell = box(kx * CELL, kz * CELL, (kx + 1) * CELL, (kz + 1) * CELL)
    ri, ci = rtree.query(cell, 'intersects'), ctree.query(cell, 'intersects')
    if not len(ri) and not len(ci): continue
    road = shapely.union_all(road_tris[ri]) if len(ri) else shapely.Polygon()
    cyc = shapely.union_all(cycle_tris[ci]) if len(ci) else shapely.Polygon()
    pi = ptree.query(cell, 'intersects')
    if len(pi) and not cyc.is_empty: cyc = cyc.difference(shapely.union_all(paved_tris[pi]))
    mask = shapely.union(road, cyc).intersection(cell)
    hi = htree.query(cell, 'intersects')
    if len(hi): mask = mask.difference(shapely.union_all([houses[i] for i in hi]))
    mask = mask.buffer(0)
    if mask.is_empty: continue
    groups = {}
    for paint, t, g in items: groups.setdefault(paint, []).append(g)
    if STATS:
        for paint, t, g in items: vstat[t] = vstat.get(t, 0) + shapely.get_num_coordinates(g.intersection(cell).intersection(mask))
    painted = {p: shapely.union_all(gs).intersection(cell).intersection(mask) for p, gs in groups.items()}
    if 'white' in painted:  # white symbols over the blue and red fills, not under them
        for p in ('blue', 'red'):
            if p in painted: painted[p] = painted[p].difference(painted['white'])
    for paint, geom in painted.items():
        geom = geom.simplify(.015)  # the cut along the drawn kerb follows its every vertex
        polys = [p for p in shapely.get_parts(geom) if p.geom_type == 'Polygon' and p.area > .008]
        if not polys: continue
        tris = []
        for p in polys:
            for tri in shapely.get_parts(shapely.constrained_delaunay_triangles(p)):
                c = np.asarray(tri.exterior.coords)[:3]
                if (c[1, 1] - c[0, 1]) * (c[2, 0] - c[0, 0]) - (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) < 0: c = c[[0, 2, 1]]  # facing up
                tris.append(c)
            m2_by[paint] = m2_by.get(paint, 0) + p.area
        if not tris: continue
        tris = np.asarray(tris)
        v = np.zeros((len(tris), 3, 6), np.float32)
        v[:, :, 0] = tris[:, :, 0]; v[:, :, 2] = tris[:, :, 1]; v[:, :, 1] = Y; v[:, :, 3:] = PAINT[paint]
        cxs = tris[:, :, 0].mean(1); czs = tris[:, :, 1].mean(1)
        for key in set(zip(np.floor(cxs / TILE).astype(int), np.floor(czs / TILE).astype(int))):
            sel = (np.floor(cxs / TILE) == key[0]) & (np.floor(czs / TILE) == key[1])
            file = f'surfaces/{key[0]}_{key[1]}.bin'
            added.setdefault(file, []).append(v[sel])
        tris_by[paint] = tris_by.get(paint, 0) + len(tris)

if STATS: print('vertices after clipping', vstat)
print(CID, n_in, 'register markings in the map', per_type)
print(CID, {p: f'{round(m2_by.get(p, 0))} m2, {tris_by.get(p, 0)} triangles' for p in PAINT}, 'total', sum(tris_by.values()), 'triangles')

# coverage: the register's cells, 48 m round
grown = cover.copy()
for dz in range(-3, 4):
    for dx in range(-3, 4):
        if dx * dx + dz * dz > 10: continue
        grown |= np.roll(np.roll(cover, dz, 0), dx, 1)
bits = np.packbits(grown.reshape(-1), bitorder='little')
coverage = {'source': 'Københavns Kommune, Afmærkning (k101 afmaerkning_total), CC BY 4.0 (wfs-kbhkort.kk.dk)',
            'note': 'cells (row z, column x, little-endian bits) where the city registers road markings within 48 m: the generated centre dashes and zebra stripes are left out there (scripts/kk-markings.py)',
            'origin': -E, 'cell': GRID, 'n': N, 'bits': base64.b64encode(bits.tobytes()).decode()}
print(CID, int(grown.sum()), 'of', N * N, f'{GRID:g} m cells covered')

if DRY: sys.exit()
for file, vs in added.items():
    v = np.concatenate(vs)
    tiles[file] = np.concatenate([tiles[file], v]) if file in tiles else v
    changed.add(file)
by_file = {rec['file']: rec for rec in index}
for file in sorted(changed):
    flat = tiles[file].reshape(-1, 6)
    if not len(flat): os.remove(ROOT + file + '.pack'); by_file.pop(file, None); continue
    open(ROOT + file + '.pack', 'wb').write(gzip.compress(flat.astype(np.float32).tobytes(), 9, mtime=0))
    rec = by_file.setdefault(file, {'file': file})
    rec['bbox'] = [int(v) if v == int(v) else v for v in map(float, (flat[:, 0].min(), flat[:, 2].min(), flat[:, 0].max(), flat[:, 2].max()))]
json.dump(list(by_file.values()), open(ROOT + 'surface-index.json', 'w'), separators=(',', ':'))
json.dump(coverage, open(ROOT + 'road-markings.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print(f'{CID}: {len(changed)} surface chunks written')
