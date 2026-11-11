#!/usr/bin/env python3
"""Stray roof sheets cut off the drawn houses (today's map), by hand-picked house. Edits the built tiles in place.

  python3 scripts/building-trim.py [copenhagen] [--dry]

The 2013 model has a few roof triangles with one corner pulled to a far point, and kk-buildings.py hands the whole
triangle to the house under most of it: a sheet or spike hanging over the street (scripts/building-strays.py lists
them; church spires look the same to it, so the houses are named here, not found).
 TRIM   every triangle of the house with a corner more than FAR m outside its mapped footprint is cut to the footprint
        (the part over the house stays, so its roof keeps no hole; walls and triangles wholly outside go).
 BLOCK  a house whose model is another building altogether (pulled down since 2013, a new one mapped on the plot) is
        drawn as its footprint pushed up to the given height, standing on the terrain.
Run last, after kk-demolished.py --again; running it again changes nothing. As kk-demolished.py does: a tile that
changes is rewritten, the index's starts shift and the file:start keys in duplicates.json, insets.json and
recolour.json follow; the `model-<id>-<k>` footprints fit-colliders.py gave the sheets (city.pack) go where the
house's roofs no longer cover half of them, with their entries in collision-trim.json and the ground pads under them
(surfaces/, 8.5 cm); a BLOCK house is solid on its whole mapped footprint again (its collision-trim.json entry goes).
Then `node scripts/road-walls.mjs <city>` for the camera's walls.
"""
import gzip, json, os, re, struct, sys
import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

FAR = 15
TRIM = {
    'kk-osm-way-67528468',   # Wakeup Copenhagen, Carsten Niebuhrs Gade: a sheet of the deck at its foot out to -575,1514
    'kk-osm-way-253797399',  # the pavilion on that deck: sheets to the same point and to -544,1491
    'kk-osm-way-105951035',  # Nyboder row at 434,-872: a sliver along the ridge on to 396,-806
    'kk-osm-way-133961765',  # 355,-304: a sheet at 16 m over the neighbour to 385,-286
}
BLOCK = {
    'kk-osm-way-1103097512': 32.09,  # Locke Aparthotel (Postbyen): the model had pieces of the old post terminal here
}

args = [a for a in sys.argv[1:] if not a.startswith('--')]
CITY = args[0] if args else 'copenhagen'; root = f'public/cities/{CITY}/'; DRY = '--dry' in sys.argv
def read(path):
    raw = open(path, 'rb').read()
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
idx = json.load(open(root + 'buildings3d-index.json'))
pack = json.loads(read(root + 'city.pack'))
foot = {'kk-' + b['id']: b for b in pack['buildings'] if 'kk-' + b['id'] in TRIM | set(BLOCK)}
def footprint(pid):
    rr = [r for r in foot[pid]['rings'] if len(r) > 2]
    return shapely.make_valid(Polygon(rr[0], rr[1:]))

_raw = read(root + 'terrain.pack')  # as kk-buildings.py: heights relative to the terrain's base level
_L = struct.unpack('<I', _raw[4:8])[0]; TER = json.loads(_raw[8:8 + _L]); _st = (8 + _L + 3) // 4 * 4; _n = TER['size']
_q = np.frombuffer(_raw[_st:_st + _n * _n * 2], dtype='<u2').reshape(_n, _n).astype(np.int64)
TGROUND = ((np.cumsum(_q, axis=1) & 65535) * TER['scale'] + TER['layers'][0]['min'] - TER['base']).astype(np.float32)
def terrain_at(x, z):
    u = np.clip((np.asarray(x) + TER['extent']) / TER['cell'], 0, _n - 1.001); v = np.clip((np.asarray(z) + TER['extent']) / TER['cell'], 0, _n - 1.001)
    i, j = u.astype(int), v.astype(int); a, b = u - i, v - j
    return (TGROUND[j, i] * (1 - a) + TGROUND[j, i + 1] * a) * (1 - b) + (TGROUND[j + 1, i] * (1 - a) + TGROUND[j + 1, i + 1] * a) * b

def flat(g):  # triangles of a plan polygon
    out = []
    for part in getattr(g, 'geoms', [g]):
        if part.geom_type != 'Polygon' or part.area < 1e-4: continue
        for tr in shapely.constrained_delaunay_triangles(part).geoms:
            c = list(tr.exterior.coords)[:3]
            if Polygon(c).area > 1e-5: out.append(c)
    return out
def facing(tri, up):  # a plan triangle wound to face up (or down)
    (ax, az), (bx, bz), (cx, cz) = tri
    return [tri[0], tri[2], tri[1]] if ((bx - ax) * (cz - az) - (cx - ax) * (bz - az) > 0) == up else list(tri)

def trim(V, fp):  # V: (n, 5) vertices -> the same with the far triangles cut to the footprint
    T = V.reshape(-1, 3, 5); P = T[:, :, :3].astype(np.float64)
    far = shapely.distance(fp, shapely.points(P[:, :, 0], P[:, :, 2])).max(1) > FAR
    if not far.any(): return V, 0
    add = []
    for p in P[far]:
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if abs(n[1]) < .3 * np.linalg.norm(n): continue  # a wall
        d = n @ p[0]
        for tri in flat(Polygon(p[:, [0, 2]]).buffer(0).intersection(fp)):
            add.append([(x, (d - n[0] * x - n[2] * z) / n[1], z, x / 3.2, z / 3.2) for x, z in facing(tri, n[1] > 0)])
    return np.concatenate([T[~far].reshape(-1, 5), np.array(add, dtype=np.float32).reshape(-1, 5)]), int(far.sum())

def block(fp, H):  # the footprint pushed up H m from the ground under it; wall feet half a metre into the lowest ground
    out = []; polys = [orient(g, 1) for g in getattr(fp, 'geoms', [fp]) if g.geom_type == 'Polygon']
    pts = np.concatenate([np.array(r.coords) for g in polys for r in [g.exterior, *g.interiors]])
    gr = terrain_at(pts[:, 0], pts[:, 1]); top = float(np.median(gr)) + H; lo = float(gr.min()) - .5
    for g in polys:
        for tri in flat(g): out.append([(x, top, z, x / 3.2, z / 3.2) for x, z in facing(tri, True)])
        for ring in [g.exterior, *g.interiors]:
            c = np.array(ring.coords)
            for (ax, az), (bx, bz) in zip(c[:-1], c[1:]):
                L = float(np.hypot(bx - ax, bz - az))
                if L < 1e-3: continue
                ux, uz = (bx - ax) / L, (bz - az) / L; ua, ub = (ax * ux + az * uz) / 3.2, (bx * ux + bz * uz) / 3.2
                A, B, C, D = (ax, lo, az, ua, lo / 3.2), (bx, lo, bz, ub, lo / 3.2), (bx, top, bz, ub, top / 3.2), (ax, top, az, ua, top / 3.2)
                out += [[A, C, B], [A, D, C]]  # facing out of a ring that runs anticlockwise in x, z
    return np.array(out, dtype=np.float32).reshape(-1, 5)

def roof_plan(V):  # as fit-colliders.py: the plan of the roof triangles
    P = V[:, :3].astype(np.float64).reshape(-1, 3, 3); n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    R = P[np.abs(n[:, 1]) >= .3 * (np.linalg.norm(n, axis=1) + 1e-12)][:, :, [0, 2]]
    return shapely.union_all(shapely.polygons(np.concatenate([R, R[:, :1]], axis=1)), grid_size=.01)

remap, changed, said, plan_now = {}, [], [], {}
for t in idx['tiles']:
    if not any(p['id'] in TRIM or p['id'] in BLOCK for p in t['parts']): continue
    a = np.frombuffer(gzip.decompress(open(root + t['file'], 'rb').read()), dtype=np.float32).reshape(-1, 5)
    chunks, s, dirty = [], 0, False
    for p in t['parts']:
        V = a[p['start']:p['start'] + p['count']]; key = f"{t['file']}:{p['start']}"
        if p['id'] in TRIM | set(BLOCK):
            was = V; fp = footprint(p['id'])
            if p['id'] in BLOCK:
                V = block(fp, BLOCK[p['id']]); note = f"drawn as its footprint, {BLOCK[p['id']]} m ({len(was) // 3} -> {len(V) // 3} triangles)"
                if len(V) != len(was) or not np.array_equal(V, was): p['height'] = BLOCK[p['id']]
            else:
                V, n = trim(V, fp); note = f'{n} triangles cut to the footprint ({len(was) // 3} -> {len(V) // 3})'
                if n: p['height'] = round(float(p.get('height') or 0) - (float(was[:, 1].max()) - float(V[:, 1].max())), 2)
            if len(V) != len(was) or not np.array_equal(V, was):
                dirty = True; plan_now[p['id']] = roof_plan(V); said.append(f"{p['id']} {p.get('name') or '-'}: {note}")
                p['bbox'] = [round(float(V[:, 0].min()), 2), round(float(V[:, 2].min()), 2), round(float(V[:, 0].max()), 2), round(float(V[:, 2].max()), 2)]
        remap[key] = f"{t['file']}:{s}"; p['start'] = s; p['count'] = len(V); s += len(V); chunks.append(V)
    if dirty:
        t['bbox'] = [min(p['bbox'][0] for p in t['parts']), min(p['bbox'][1] for p in t['parts']), max(p['bbox'][2] for p in t['parts']), max(p['bbox'][3] for p in t['parts'])]
        changed.append((t['file'], np.concatenate(chunks).astype(np.float32)))
print('\n'.join(said) or 'nothing to trim'); print(len(changed), 'tiles rewritten' + (' (dry run)' if DRY else ''))
if changed and not DRY:
    for file, data in changed: open(root + file, 'wb').write(gzip.compress(data.tobytes(), 9, mtime=0))
    json.dump(idx, open(root + 'buildings3d-index.json', 'w'))
    move = lambda k: remap.get(k, k)
    for name in ('duplicates.json', 'insets.json'):
        if os.path.exists(root + name) and json.load(open(root + name)):
            json.dump([move(k) for k in json.load(open(root + name))], open(root + name, 'w'), separators=(',', ':'))
    if os.path.exists(root + 'recolour.json') and json.load(open(root + 'recolour.json')):
        rec = json.load(open(root + 'recolour.json'))
        json.dump({move(k): [[move(o) for o in owners], fl] for k, (owners, fl) in rec.items()}, open(root + 'recolour.json', 'w'), separators=(',', ':'))

    # --- collision: the footprints the cut sheets had, and the ground pads under them ---
    MODEL_FOOT = re.compile(r'^model-(kk-.*)-\d+$'); pads, keep = [], []
    for b in pack['buildings']:
        m = MODEL_FOOT.match(b['id']); g = shapely.make_valid(Polygon(b['rings'][0], b['rings'][1:])) if m and m.group(1) in plan_now else None
        if g is not None and g.area > 0 and g.intersection(plan_now[m.group(1)].buffer(.5)).area < .5 * g.area: pads.append(g)
        else: keep.append(b)
    gone = {b['id'] for b in pack['buildings']} - {b['id'] for b in keep} | {k[3:] for k in plan_now if k in BLOCK}
    print(len(pads), 'model footprints out of city.pack')
    if pads:
        pack['buildings'] = keep
        open(root + 'city.pack', 'wb').write(gzip.compress(json.dumps(pack, separators=(',', ':'), ensure_ascii=False).encode(), 9, mtime=0))
    if os.path.exists(root + 'collision-trim.json'):
        cut = json.load(open(root + 'collision-trim.json'))
        if any(k.split('#')[0] in gone for k in cut):
            json.dump({k: v for k, v in cut.items() if k.split('#')[0] not in gone}, open(root + 'collision-trim.json', 'w'), separators=(',', ':'), ensure_ascii=False)
    if pads:  # surface-dissolve drew a pad (8.5 cm, world-formats.mjs) on every footprint
        pad_plan = shapely.union_all(pads).buffer(.05); shapely.prepare(pad_plan); px0, pz0, px1, pz1 = pad_plan.bounds
        sidx = json.load(open(root + 'surface-index.json')); n_pad = 0
        for r in sidx:
            b = r['bbox']
            if b[0] > px1 or b[2] < px0 or b[1] > pz1 or b[3] < pz0: continue
            a = np.frombuffer(read(root + r['file'] + '.pack'), np.float32).reshape(-1, 3, 6)
            c = a[:, :, [0, 2]].mean(1)
            hit = (np.abs(a[:, 0, 1] - .085) < .002) & shapely.contains_xy(pad_plan, c[:, 0], c[:, 1])
            if not hit.any(): continue
            n_pad += int(hit.sum()); a = a[~hit]
            open(root + r['file'] + '.pack', 'wb').write(gzip.compress(a.astype(np.float32).tobytes(), 9, mtime=0))
            if len(a): r['bbox'] = [float(a[:, :, 0].min()), float(a[:, :, 2].min()), float(a[:, :, 0].max()), float(a[:, :, 2].max())]
        if n_pad: json.dump(sidx, open(root + 'surface-index.json', 'w'), separators=(',', ':'))
        print(n_pad, 'ground pad triangles under them taken up')
