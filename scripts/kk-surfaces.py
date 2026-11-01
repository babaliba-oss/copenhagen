#!/usr/bin/env python3
"""Cobbles and gravel where the city has them: Københavns Kommune's register of surfaces in its parks, squares and
cemeteries (k101 dp_belaegninger as GeoJSON in EPSG:4326, CC BY 4.0). Natural stone (Natursten og -fliser) is drawn as
the granite setts of the stone carriageways (colour aaa99e at 7.2 cm, the ground shader's road band), gravel and pea
gravel (Grus, Perlesten, also as ornament) as gravel (colour c4b9a2 at 6.2 cm, its gravel band, src/main.js). Both are
appended to the existing surface chunks, over the mapped pavements and lawns (5 cm, 22 cm down) and cut out of the
carriageway, the houses and the water, so they never cover a road. No new meshes or draw calls: the chunks just hold more
triangles. Rerunnable: earlier output (y = 7.2 and 6.2 cm) is dropped first.

  python3 scripts/kk-surfaces.py <wfs dir> copenhagen [--dry]     (after scripts/surface-fill.py; then furniture-ground)
"""
import gzip, json, math, os, sys
import numpy as np
import shapely
from shapely.geometry import shape, box
from shapely.ops import unary_union
from pyproj import Transformer

args = [a for a in sys.argv[1:] if not a.startswith('--')]; DRY = '--dry' in sys.argv
SRC, CID = args[0], (args[1] if len(args) > 1 else 'copenhagen')
ROOT = f'public/cities/{CID}/'
srgb = lambda h: [((v / 255) / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4) for v in bytes.fromhex(h)]
KINDS = {'stone': (.072, srgb('aaa99e'), ('Natursten og -fliser',)),
         'gravel': (.062, srgb('c4b9a2'), ('Grus', 'Grus (pryd)', 'Perlesten', 'Perlesten (pryd)'))}
CELL = 300.0  # the surface chunks' grid (surfaces/<kx>_<kz>.bin, as surface-fill.py)

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
tiles, changed = {}, set()
for rec in index:
    a = np.frombuffer(read(ROOT + rec['file'] + '.pack'), np.float32).reshape(-1, 6)
    a = a[:len(a) // 3 * 3].reshape(-1, 3, 6)
    keep = ~np.any([np.all(np.abs(a[:, :, 1] - y) < 1e-4, axis=1) for y, _, _ in KINDS.values()], axis=0)
    if not keep.all(): changed.add(rec['file'])
    tiles[rec['file']] = a[keep]

to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
E = city['extent']; area = box(-E, -E, E, E)
blocked = polygons([r for r in city['roads'] if 'island' not in str(r.get('kind', ''))]) + polygons(city['buildings']) + polygons(city['water'])
if os.path.exists(ROOT + 'kk-footprints.json'): blocked += polygons(json.load(open(ROOT + 'kk-footprints.json')))
btree = shapely.STRtree(blocked)
feats = json.load(open(f'{SRC}/dp_belaegninger.json', encoding='utf8'))['features']
added, report = {}, {}
for kind, (Y, colour, names) in KINDS.items():
    geoms = []
    for f in feats:
        if f['properties'].get('under_element') not in names or not f['geometry']: continue
        g = shapely.transform(shapely.make_valid(shape(f['geometry'])), lambda c: np.column_stack(to_local.transform(c[:, 0], c[:, 1])) * [1, -1])
        g = g.intersection(area)
        if not g.is_empty: geoms.append(g)
    if not geoms: continue
    whole = unary_union(geoms)
    x0, z0, x1, z1 = whole.bounds; tris_n = 0; m2 = 0.0
    for kx in range(math.floor(x0 / CELL), math.floor(x1 / CELL) + 1):
        for kz in range(math.floor(z0 / CELL), math.floor(z1 / CELL) + 1):
            cell = box(kx * CELL, kz * CELL, (kx + 1) * CELL, (kz + 1) * CELL)
            part = whole.intersection(cell)
            if part.is_empty: continue
            cut = [blocked[i] for i in btree.query(part)]
            if cut: part = part.difference(unary_union(cut))
            part = part.buffer(-.02, quad_segs=1).buffer(.02, quad_segs=1)
            polys = [g for g in shapely.get_parts(part) if g.geom_type == 'Polygon' and g.area > .3]
            if not polys: continue
            tris = []
            for g in polys:
                for t in shapely.get_parts(shapely.constrained_delaunay_triangles(g)):
                    c = np.asarray(t.exterior.coords)[:3]
                    if (c[1, 1] - c[0, 1]) * (c[2, 0] - c[0, 0]) - (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) < 0: c = c[[0, 2, 1]]  # facing up
                    tris.append(c)
                m2 += g.area
            v = np.zeros((len(tris), 3, 6), np.float32)
            v[:, :, 0] = [[p[0] for p in t] for t in tris]; v[:, :, 2] = [[p[1] for p in t] for t in tris]
            v[:, :, 1] = Y; v[:, :, 3:] = colour
            file = f'surfaces/{kx}_{kz}.bin'
            added[file] = np.concatenate([added[file], v]) if file in added else v
            tris_n += len(tris)
    report[kind] = (len(geoms), round(m2), tris_n)
print(CID, {k: f'{n} polygons, {m} m2, {t} triangles' for k, (n, m, t) in report.items()})
if DRY: sys.exit()
for file, v in added.items():
    tiles[file] = np.concatenate([tiles[file], v]) if file in tiles else v
    changed.add(file)
by_file = {rec['file']: rec for rec in index}
for file in sorted(changed):
    flat = tiles[file].reshape(-1, 6)
    if not len(flat): os.remove(ROOT + file + '.pack'); by_file.pop(file, None); continue
    open(ROOT + file + '.pack', 'wb').write(gzip.compress(flat.astype(np.float32).tobytes(), 9))
    rec = by_file.setdefault(file, {'file': file})
    rec['bbox'] = [int(v) if v == int(v) else v for v in map(float, (flat[:, 0].min(), flat[:, 2].min(), flat[:, 0].max(), flat[:, 2].max()))]
json.dump(list(by_file.values()), open(ROOT + 'surface-index.json', 'w'), separators=(',', ':'))
print(f'{CID}: {len(changed)} surface chunks written')
