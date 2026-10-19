# Collision footprints for the 3D buildings that have no OpenStreetMap footprint of their own.
#
# The car, the walkers and the cameras collide with the mapped footprints (city.pack buildings). The 2013 city model
# (scripts/kk-buildings.py) also draws model-only structures ("kk-<x>-<z>" parts: courtyard wings, annexes, whole
# houses missing from the map) that had no footprint, so the car drove straight into them. This writes their
# footprints from the tiles: the union of each part's roof triangles seen from above, less the mapped roads (a deck
# or a passage over a street stays drivable), small slivers dropped.
#
#   python3 scripts/kk-collision.py copenhagen        (and copenhagen-1760) -> public/cities/<city>/kk-footprints.json
import gzip, json, sys
import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union

city = sys.argv[1] if len(sys.argv) > 1 else 'copenhagen'
root = f'public/cities/{city}/'
index = json.load(open(root + 'buildings3d-index.json'))
import os
dup = set(json.load(open(root + 'duplicates.json'))) if os.path.exists(root + 'duplicates.json') else set()

def read(path):
    raw = open(path, 'rb').read()
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
pack = json.loads(read(root + 'city.pack'))
roads = [Polygon(r['rings'][0], r['rings'][1:]).buffer(0) for r in pack.get('roads', []) if r.get('rings') and len(r['rings'][0]) > 2]
road_tree = shapely.STRtree(roads)
print(city, len(roads), 'road polygons')

out, parts_n, dropped = [], 0, 0
for t in index['tiles']:
    mine = [p for p in t['parts'] if p['id'].startswith('kk-') and not p['id'].startswith('kk-osm') and f"{t['file']}:{p['start']}" not in dup and p.get('height', 0) >= 2.2]
    if not mine: continue
    a = np.frombuffer(read(root + t['file']), np.float32).reshape(-1, 5)
    for p in mine:
        v = a[p['start']:p['start'] + p['count'], :3].astype(np.float64)
        tri = v[:len(v) // 3 * 3].reshape(-1, 3, 3)
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); ln = np.linalg.norm(n, axis=1)
        roof = (ln > 1e-6) & (np.abs(n[:, 1]) / np.maximum(ln, 1e-12) > .35)
        if not roof.any(): continue
        polys = [Polygon(t2[:, [0, 2]]) for t2 in tri[roof]]
        shape = unary_union([q.buffer(.02) for q in polys if q.area > 1e-4]).buffer(-.02)
        near = road_tree.query(shape)
        if len(near): shape = shape.difference(unary_union([roads[i] for i in near]))
        shape = shape.simplify(.15)
        for g in getattr(shape, 'geoms', [shape]):
            if g.geom_type != 'Polygon' or g.area < 3: dropped += 1; continue
            rings = [[[round(x, 1), round(z, 1)] for x, z in list(g.exterior.coords)[:-1]]] + [[[round(x, 1), round(z, 1)] for x, z in list(r.coords)[:-1]] for r in g.interiors if Polygon(r).area > 2]
            x0, z0, x1, z1 = g.bounds
            out.append({'id': p['id'], 'rings': rings, 'bbox': [round(x0, 1), round(z0, 1), round(x1, 1), round(z1, 1)], 'height': round(p['height'], 1)})
        parts_n += 1
if out: json.dump(out, open(root + 'kk-footprints.json', 'w'), separators=(',', ':'))
print(f'{city}: {len(out)} footprints from {parts_n} model-only parts ({dropped} slivers dropped) -> {root}kk-footprints.json')
