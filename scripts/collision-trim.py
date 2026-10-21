# Collision footprints trimmed to what is drawn, where they reach into the street.
#
# The car, walkers and cameras collide with the mapped (OpenStreetMap) footprints in city.pack, but most houses are drawn
# from the municipal 3D model (scripts/kk-buildings.py), which does not always agree: a footprint that runs a few metres
# past the drawn facade, over an arcade or a passage, or a mapped building the model does not have at all, was an
# invisible wall in the road or on the pavement (Daniel: "stuck in random wall"). This finds the footprints whose
# undrawn part covers road or pavement and writes them cut back to the drawn roofs there (the rest of the footprint,
# in courtyards and gardens, is kept as mapped). main.js swaps the trimmed rings in when the city loads.
#
#   python3 scripts/collision-trim.py copenhagen      -> public/cities/<city>/collision-trim.json  {id: rings}
import gzip, json, sys
import numpy as np
import shapely
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

city = sys.argv[1] if len(sys.argv) > 1 else 'copenhagen'
root = f'public/cities/{city}/'
def read(path):
    raw = open(path, 'rb').read()
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
pack = json.loads(read(root + 'city.pack'))
assert not pack.get('packed'), 'expects the unpacked city.pack'
UNDRAWN = {'roof', 'construction', 'carport', 'bridge'}  # main.js undrawnFootprint: not solid anyway
def poly(f):  # even-odd over all rings, as the game's pointInPolygon (a relation can have several outer rings)
    out = Polygon()
    for r in f['rings']:
        if len(r) > 2: out = out.symmetric_difference(Polygon(r).buffer(0))
    return out
streets = [poly(f) for k in ('roads', 'pavement') for f in pack.get(k, []) if f.get('rings') and len(f['rings'][0]) > 2 and 'island' not in str(f.get('kind', ''))]
street_tree = shapely.STRtree(streets)
# Every drawn roof triangle (any part: model houses, model houses matched to a mapped one, extruded mapped footprints),
# less the flat ones near the street that the game collapses at load (terrain_field.collapsed): a footprint over such a
# plinth or paved deck was an invisible wall on the pavement (Kalvebod Brygge's decks, 3,000 m2 within 2.5 km).
from terrain_field import load_ground, lift_parts, collapsed
ground_at = load_ground(root)
index = json.load(open(root + 'buildings3d-index.json'))
tris = []
for t in index['tiles']:
    a = lift_parts(np.frombuffer(read(root + t['file']), np.float32).reshape(-1, 5), t['parts'], ground_at)[:, :3]
    tri = a[:len(a) // 3 * 3].reshape(-1, 3, 3)
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); ln = np.linalg.norm(n, axis=1)
    tris.append(tri[(ln > 1e-6) & (np.abs(n[:, 1]) / np.maximum(ln, 1e-12) > .35) & ~collapsed(tri, ground_at)][:, :, [0, 2]])
tris = np.concatenate(tris)
lo, hi = tris.min(axis=1), tris.max(axis=1)
tri_tree = shapely.STRtree([box(*l, *h) for l, h in zip(lo, hi)])
print(city, len(tris), 'roof triangles,', len(streets), 'street polygons')
out, trimmed_m2, gone = {}, 0.0, 0
seen = {}  # a few ids repeat (a relation's parts): keyed id, then id#1, id#2 in city.pack order
for b in pack['buildings']:
    k = seen.get(b['id'], 0); seen[b['id']] = k + 1; key = b['id'] if not k else f"{b['id']}#{k}"
    # cover < .5 (scripts/fit-colliders.py): drawn from the footprint itself (main.js createFallbackBuildings), so they agree
    if not b.get('rings') or b.get('kind') in UNDRAWN or len(b['rings'][0]) < 3 or b.get('cover', 0) < .5: continue
    fp = poly(b)
    if fp.is_empty: continue
    near = street_tree.query(fp)
    if not len(near): continue
    street = unary_union([streets[i] for i in near]).intersection(fp)
    if street.area < 2: continue
    ids = tri_tree.query(fp)
    drawn = unary_union([Polygon(tris[i]).buffer(.02) for i in ids if Polygon(tris[i]).area > 1e-4]).buffer(.5) if len(ids) else Polygon()
    cut = street.difference(drawn)
    if cut.area < 2: continue  # within half a metre of the drawn facade: leave it
    keep = fp.difference(cut).simplify(.15)
    parts = [g for g in getattr(keep, 'geoms', [keep]) if g.geom_type == 'Polygon' and g.area >= 3]
    rings = []
    for g in parts:
        rings.append([[round(x, 2), round(z, 2)] for x, z in list(g.exterior.coords)[:-1]])
        rings += [[[round(x, 2), round(z, 2)] for x, z in list(r.coords)[:-1]] for r in g.interiors if Polygon(r).area > 2]
    out[key] = rings or None; trimmed_m2 += fp.area - sum(g.area for g in parts); gone += not rings
json.dump(out, open(root + 'collision-trim.json', 'w'), separators=(',', ':'))
print(f'{city}: {len(out)} footprints trimmed ({gone} left with nothing solid), {trimmed_m2:.0f} m2 of invisible wall removed -> {root}collision-trim.json')
