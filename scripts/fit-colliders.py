#!/usr/bin/env python3
"""Footprints that match the houses you see (city.pack buildings).

The car, the walkers and the street furniture treat the city's footprints (city.pack `buildings`, world.buildings in
the game) as the solid houses, but the houses you see are the municipal 3D model (buildings3d tiles). The two come
from different sources and disagreed: footprints of houses the model does not have, or that 1760 hides (the Opera,
BLOX, the Black Diamond...), were walls you hit in an open square; houses the model has but OpenStreetMap does not
(Nyboder's rows in 1760, thousands of back houses today) let the car drive through their walls.

This step, run after scripts/kk-buildings.py, rewrites the footprints of one era:
1. Each footprint gets `cover`, the share of it under the visible houses' roofs (the plan of every roof triangle of
   every part the game shows: era-hidden names, duplicates and, in 1760, buildings standing in the water are left out,
   as main.js does).
2. 1760: footprints mostly not covered (cover < .5) are today's buildings with no house in 1760; they are removed.
   Today: they stay (the game draws an unmodelled house box on them, main.js createFallbackBuildings, now decided by
   `cover` rather than by bounding boxes), except construction sites, canopies and carports, which are removed.
3. Visible houses that no remaining footprint covers get one: their roof plan, pulled in 0.3 m from the eaves, minus
   the carriageway (a passage under a house stays open), with slivers under 0.9 m wide dropped (`kind: 'model'`).
   Earthworks (1760 ramparts) stay walkable.
python3 scripts/fit-colliders.py copenhagen-1760 [--dry]
"""
import sys, os, re, json, gzip
import numpy as np
import shapely
from shapely.geometry import Polygon, MultiPolygon
from shapely.strtree import STRtree

city = sys.argv[1]; DRY = '--dry' in sys.argv; ERA = city.endswith('1760'); root = f'public/cities/{city}'
log = lambda *a: print(*a, file=sys.stderr, flush=True)
idx = json.load(open(f'{root}/buildings3d-index.json'))
data = json.loads(gzip.decompress(open(f'{root}/city.pack', 'rb').read()))
gone = None
if ERA:
    m = re.search(r'const GONE=/(\^.*?\$)/i;', open('src/main.js').read())
    gone = re.compile(m.group(1), re.I)
dups = set(json.load(open(f'{root}/duplicates.json'))) if os.path.exists(f'{root}/duplicates.json') else set()

def poly(rings):
    try:
        g = shapely.make_valid(Polygon(rings[0], rings[1:]))
        return g if not g.is_empty else None
    except Exception:
        return None
water = shapely.union_all([g for g in (poly(w['rings']) for w in data['water']) if g is not None])
shapely.prepare(water)
roads = [g for g in (poly(r['rings']) for r in data['roads'] if 'Koroke' not in (r.get('kind') or '')) if g is not None]
road_tree = STRtree(roads)

# 1760: pieces of today's buildings that 1760 removes by name (the Black Diamond's annexes, the National Bank's wings) are
# unnamed sub-buildings the name filter missed; they stood as hollow shells. They join duplicates.json (hidden in the game).
leftover_in = None
if ERA:
    MODERN = re.compile(r'rådhus|glyptotek|tivoli|hovedbanegård|politigård|nationalmuseet|det kongelige bibliotek|operaen|skuespilhus', re.I)  # kk-buildings.py
    gone_feet = [g for g in (poly(b['rings']) for b in data['buildings'] if (b.get('name') and (gone.search(b['name']) or MODERN.search(b['name'])))) if g is not None]
    leftover_in = shapely.union_all(gone_feet) if gone_feet else None
    if leftover_in is not None: shapely.prepare(leftover_in)
leftovers = []

# --- what you see: one roof plan per visible part ---
parts, plans = [], []
for t in idx['tiles']:
    raw = open(os.path.join(root, t['file']), 'rb').read()
    if raw[:2] == b'\x1f\x8b': raw = gzip.decompress(raw)
    arr = np.frombuffer(raw, dtype=np.float32).reshape(-1, 5)
    for p in t['parts']:
        if gone is not None and gone.search(p.get('name') or ''): continue
        if f"{t['file']}:{p['start']}" in dups: continue
        if ERA:  # main.js: in 1760 buildings standing in the water (4 of 5 points of their box) are hidden
            a, b, c, d = p['bbox']; ix, iz = (c - a) * .25, (d - b) * .25
            pts = np.array([[(a + c) / 2, (b + d) / 2], [a + ix, b + iz], [c - ix, b + iz], [a + ix, d - iz], [c - ix, d - iz]])
            if shapely.contains_xy(water, pts[:, 0], pts[:, 1]).sum() >= 4: continue
        V = arr[p['start']:p['start'] + p['count'], :3].astype(np.float64)
        V = V[:len(V) // 3 * 3].reshape(-1, 3, 3)
        if not len(V): continue
        n = np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0]); l = np.linalg.norm(n, axis=1) + 1e-12
        a2 = np.abs((V[:, 1, 0] - V[:, 0, 0]) * (V[:, 2, 2] - V[:, 0, 2]) - (V[:, 1, 2] - V[:, 0, 2]) * (V[:, 2, 0] - V[:, 0, 0]))
        R = V[(np.abs(n[:, 1] / l) >= .3) & (a2 > 1e-4)][:, :, [0, 2]]
        if not len(R): continue
        plan = shapely.union_all(shapely.polygons(np.concatenate([R, R[:, :1]], axis=1)), grid_size=.01)
        if plan.is_empty or plan.area < 2: continue
        if leftover_in is not None and not p.get('name') and plan.intersection(leftover_in).area > .5 * plan.area:
            leftovers.append(f"{t['file']}:{p['start']}"); continue
        parts.append(p); plans.append(plan)
log(len(plans), 'visible parts with a roof plan', f'({len(leftovers)} leftovers of buildings 1760 removes hidden)' if ERA else '')
if leftovers and not DRY:
    json.dump(sorted(dups | set(leftovers)), open(f'{root}/duplicates.json', 'w'))
plan_tree = STRtree(plans)

# --- footprints: cover, and which stay ---
kept, dropped = [], []; unmodelled = clipped = 0
for b in data['buildings']:
    g = poly(b['rings'])
    if g is None or g.area <= 0: dropped.append(b); continue
    near = plan_tree.query(g)
    covered = shapely.union_all([plans[i].intersection(g) for i in near]).area if len(near) else 0.0
    cover = min(1.0, covered / g.area); b['cover'] = round(cover, 2)
    bare = g.area - covered
    if cover >= .5 and (bare < 60 or cover >= .9): kept.append((b, g)); continue
    if cover < .5 and (ERA or (b.get('kind') or '') in ('construction', 'roof', 'carport')): dropped.append(b); continue
    if cover < .15: kept.append((b, g)); unmodelled += 1; continue  # no model house here: the game draws a plain house on it
    # partly under a model house (a block the model has only part of, or a courtyard and back lot the footprint takes in,
    # Frederiks Hospital's gardens in 1760): the footprint becomes the part you see
    seen = shapely.union_all([plans[i].intersection(g) for i in near]).buffer(-.3, join_style='mitre')
    seen = max(getattr(seen, 'geoms', [seen]), key=lambda q: q.area) if not seen.is_empty else seen
    if seen.is_empty or seen.geom_type != 'Polygon' or seen.area < 4: dropped.append(b); continue
    seen = seen.simplify(.15); b['rings'] = [[[round(x, 2), round(z, 2)] for x, z in seen.exterior.coords[:-1]]] + [[[round(x, 2), round(z, 2)] for x, z in r.coords[:-1]] for r in seen.interiors]
    x0, z0, x1, z1 = seen.bounds; b['bbox'] = [round(x0, 2), round(z0, 2), round(x1, 2), round(z1, 2)]; b['cover'] = 1.0; clipped += 1
    kept.append((b, seen))
log(len(kept), 'footprints kept (', unmodelled, 'with no model house, drawn as plain houses;', clipped, 'cut to the part the model shows ),', len(dropped), 'removed (no house you can see on them)')
foot_tree = STRtree([g for _, g in kept])
foot_geoms = [g for _, g in kept]

# --- houses with no footprint under them ---
added = []
for p, plan in zip(parts, plans):
    if p.get('embankment') or (p.get('height') or 0) < 2: continue
    rest = plan.buffer(-.3, join_style='mitre')
    if rest.is_empty: continue
    near = foot_tree.query(rest)
    if len(near): rest = rest.difference(shapely.union_all([foot_geoms[i] for i in near]))
    if rest.is_empty or rest.area < 20: continue
    rn = road_tree.query(rest)
    if len(rn): rest = rest.difference(shapely.union_all([roads[i] for i in rn]))
    rest = rest.buffer(-.45, join_style='mitre').buffer(.45, join_style='mitre')  # slivers along a misdrawn footprint: no
    if rest.is_empty: continue
    for k, q in enumerate(getattr(rest, 'geoms', [rest])):
        if q.geom_type != 'Polygon' or q.area < 20: continue
        q = q.simplify(.15)
        if q.is_empty or q.geom_type != 'Polygon': continue
        rings = [[[round(x, 2), round(z, 2)] for x, z in q.exterior.coords[:-1]]] + [[[round(x, 2), round(z, 2)] for x, z in r.coords[:-1]] for r in q.interiors]
        x0, z0, x1, z1 = q.bounds
        added.append({'id': f"model-{p['id']}-{k}", 'name': '', 'address': '', 'rings': rings, 'bbox': [round(x0, 2), round(z0, 2), round(x1, 2), round(z1, 2)],
                      'kind': 'model', 'material': '', 'height': round(float(p.get('height') or 10), 2), 'cover': 1.0})
log(len(added), 'houses given a footprint of their own (', round(sum(Polygon(a['rings'][0]).area for a in added)), 'm² )')
data['buildings'] = [b for b, _ in kept] + added
if not DRY:
    open(f'{root}/city.pack', 'wb').write(gzip.compress(json.dumps(data, separators=(',', ':'), ensure_ascii=False).encode(), 9))
    log('wrote', f'{root}/city.pack')
print(json.dumps({'city': city, 'kept': len(kept), 'removed': [{'name': b.get('name', ''), 'kind': b.get('kind', ''), 'cover': b.get('cover')} for b in dropped][:200], 'added': len(added)}, ensure_ascii=False))
