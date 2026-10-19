#!/usr/bin/env python3
"""Paving for the unmapped strips between the streets and the houses.

Where no pavement polygon is mapped (much of Nyhavn), the rendered ground stopped at the carriageway's edge and the bare
terrain, half a metre below street level (terrain-mesh.js), showed between the road and the facades: a dark trench along
the foot of the houses, with the ground under each building (its mapped outline, surfaceChunks) as a pale line beyond it.
This fills what lies within 5 m of a road and is covered by nothing else (no surface, building or water) with pavement,
appended to the existing surface chunks at 4.5 cm: in the pavement band (the ground shader's slab texture) and under
the mapped pavement (5 cm), so it never covers a mapped surface. Rerunnable: earlier fill (y = 4.5 cm) is dropped first.

  python3 scripts/surface-fill.py copenhagen [--dry]        (after scripts/surface-dissolve.mjs)
"""
import gzip, json, math, os, sys
import numpy as np
import shapely
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

CID = next((a for a in sys.argv[1:] if not a.startswith('--')), 'copenhagen'); DRY = '--dry' in sys.argv  # --dry: report only
ROOT = f'public/cities/{CID}/'
FILL_Y, REACH, CELL = .045, 5.0, 300.0
srgb = lambda h: [((v / 255) / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4) for v in bytes.fromhex(h)]
COLOR = np.array(srgb('dfdcd1'), np.float32)  # the mapped pavement's colour (world-formats.mjs)

def read(path):
    raw = open(path, 'rb').read()
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw

def polygons(items):
    out = []
    for p in items:
        r = p.get('rings')
        if not r or len(r[0]) < 3: continue
        g = shapely.make_valid(Polygon(r[0], [h for h in r[1:] if len(h) > 2]))
        if not g.is_empty: out.append(g)
    return out

city = json.loads(read(ROOT + 'city.pack'))
index = json.load(open(ROOT + 'surface-index.json'))
tiles, changed = {}, set()
for rec in index:
    a = np.frombuffer(read(ROOT + rec['file'] + '.pack'), np.float32).reshape(-1, 6)
    a = a[:len(a) // 3 * 3].reshape(-1, 3, 6)
    keep = ~np.all(np.abs(a[:, :, 1] - FILL_Y) < 1e-4, axis=1)  # earlier fill out
    if not keep.all(): changed.add(rec['file'])
    tiles[rec['file']] = a[keep]
print(CID, len(tiles), 'surface chunks,', sum(len(t) for t in tiles.values()), 'triangles')

roads = polygons(city['roads']); solid = polygons(city['buildings']) + polygons(city['water'])
road_tree, solid_tree = shapely.STRtree(roads), shapely.STRtree(solid)
tri_all = np.concatenate([t[:, :, [0, 2]] for t in tiles.values()])
tri_geoms = shapely.polygons(np.concatenate([tri_all, tri_all[:, :1]], axis=1))
tri_tree = shapely.STRtree(tri_geoms)

x0, z0, x1, z1 = shapely.total_bounds(roads)
added, area = {}, 0.0
for kx in range(math.floor(x0 / CELL), math.floor(x1 / CELL) + 1):
    for kz in range(math.floor(z0 / CELL), math.floor(z1 / CELL) + 1):
        cell = box(kx * CELL, kz * CELL, (kx + 1) * CELL, (kz + 1) * CELL)
        near = road_tree.query(cell.buffer(REACH))
        if not len(near): continue
        corridor = unary_union([roads[i] for i in near]).buffer(REACH, quad_segs=2).intersection(cell)
        if corridor.is_empty: continue
        covered = [tri_geoms[i] for i in tri_tree.query(corridor)] + [solid[i] for i in solid_tree.query(corridor)]
        fill = corridor.difference(unary_union(covered)) if covered else corridor
        fill = fill.buffer(-.02, quad_segs=1).buffer(.02, quad_segs=1)  # numerical slivers along shared edges
        parts = [g for g in getattr(fill, 'geoms', [fill]) if g.geom_type == 'Polygon' and g.area > .05]
        if not parts: continue
        tris = []
        for g in parts:
            for t in shapely.get_parts(shapely.constrained_delaunay_triangles(g)):
                c = np.asarray(t.exterior.coords)[:3]
                if (c[1, 1] - c[0, 1]) * (c[2, 0] - c[0, 0]) - (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) < 0: c = c[[0, 2, 1]]  # facing up
                tris.append(c)
            area += g.area
        v = np.zeros((len(tris), 3, 6), np.float32)
        v[:, :, 0] = [[p[0] for p in t] for t in tris]; v[:, :, 2] = [[p[1] for p in t] for t in tris]
        v[:, :, 1] = FILL_Y; v[:, :, 3:] = COLOR
        added[f'surfaces/{kx}_{kz}.bin'] = v

if DRY: print(f'{CID}: {area:.0f} m2 would be paved ({sum(len(v) for v in added.values())} triangles in {len(added)} chunks)'); sys.exit()
for file, v in added.items():
    tiles[file] = np.concatenate([tiles[file], v]) if file in tiles else v
    changed.add(file)
by_file = {rec['file']: rec for rec in index}
for file in sorted(changed):
    flat = tiles[file].reshape(-1, 6)
    if not len(flat):  # a chunk that held nothing but earlier fill
        os.remove(ROOT + file + '.pack'); by_file.pop(file, None); continue
    open(ROOT + file + '.pack', 'wb').write(gzip.compress(flat.astype(np.float32).tobytes(), 9))
    rec = by_file.setdefault(file, {'file': file})
    rec['bbox'] = [int(v) if v == int(v) else v for v in map(float, (flat[:, 0].min(), flat[:, 2].min(), flat[:, 0].max(), flat[:, 2].max()))]  # as surfaceBounds writes them
json.dump(list(by_file.values()), open(ROOT + 'surface-index.json', 'w'), separators=(',', ':'))
print(f'{CID}: {area:.0f} m2 of unmapped street edge paved, {sum(len(v) for v in added.values())} triangles in {len(added)} chunks')
