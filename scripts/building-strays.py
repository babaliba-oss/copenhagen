#!/usr/bin/env python3
"""Stray geometry in the drawn 3D buildings (public/cities/<city>/buildings3d): candidates only, nothing is changed.

  python3 scripts/building-strays.py copenhagen [out.json] [--radius 2300]

Per house (a part of a tile), with its vertices welded at 1 cm:
  spike   a vertex 15 m or more from every other vertex of the house, where the house has at most three such vertices and
          they are under 5% of its vertices (a plain big hall's corners are all far apart), with the triangles on it
          covering 1 m2 or more: 'up' when it stands 10 m or more over everything else on under 30 m2 of plan (a needle),
          'out' when it lies 15 m or more outside the outline of the rest (a sheet pulled to a far point);
  piece   a group of triangles sharing no vertex with the house's main body, 4 m2 or more, every vertex 4 m or more
          outside the mapped footprint (kk-osm-/osm- houses, city.pack). With --pieces also model-only houses' groups
          10 m or more from the main body (many: the model's leftover groups are scattered pieces under one id).
Church spires, masts and flagpoles on a roof show up as spikes too: look before trimming (scripts/building-trim.py
cuts the houses named there). Parts the game does not draw (duplicates.json) are skipped. Worst first.
"""
import gzip, json, os, sys
import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import Polygon, MultiPoint, Point

args = [a for a in sys.argv[1:] if not a.startswith('--')]
CID = args[0] if args else 'copenhagen'; R = f'public/cities/{CID}/'
RADIUS = float(sys.argv[sys.argv.index('--radius') + 1]) if '--radius' in sys.argv else 2300
idx = json.load(open(R + 'buildings3d-index.json'))
raw = open(R + 'city.pack', 'rb').read(); city = json.loads(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw)
def poly(f):
    out = Polygon()
    for r in f['rings']:
        if len(r) > 2: out = out.symmetric_difference(Polygon(r).buffer(0))
    return out
foot = {b['id']: b for b in city['buildings']}
hidden = set(json.load(open(R + 'duplicates.json'))) if os.path.exists(R + 'duplicates.json') else set()
out = []
for t in idx['tiles']:
    bb = t['bbox']
    if min(abs(bb[0]), abs(bb[2])) > RADIUS and bb[0] * bb[2] > 0 or min(abs(bb[1]), abs(bb[3])) > RADIUS and bb[1] * bb[3] > 0: continue
    a = np.frombuffer(gzip.decompress(open(R + t['file'], 'rb').read()), dtype=np.float32).reshape(-1, 5)
    for p in t['parts']:
        T = a[p['start']:p['start'] + p['count'], :3].reshape(-1, 3, 3).astype(np.float64)
        if len(T) < 6 or f"{t['file']}:{p['start']}" in hidden: continue
        V, inv = np.unique(np.round(T.reshape(-1, 3), 2), axis=0, return_inverse=True); F = inv.reshape(-1, 3)
        c = np.median(V, 0)
        if np.hypot(c[0], c[2]) > RADIUS: continue
        area = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) / 2
        found = []
        # spikes: up (a needle over the roof) or out (a sheet pulled to a point beyond the house)
        d = cKDTree(V).query(V, k=2)[0][:, 1]; iso = np.where(d >= 15)[0]
        if 0 < len(iso) <= 3 and len(iso) < .05 * len(V):
            for v in iso:
                tri = np.any(F == v, axis=1); A = float(area[tri].sum())
                if A < 1: continue
                rest = np.delete(V, v, 0); up = float(V[v][1] - rest[:, 1].max()); tt = T[tri]
                e1, e2 = tt[:, 1] - tt[:, 0], tt[:, 2] - tt[:, 0]; plan = float(np.abs(e1[:, 0] * e2[:, 2] - e1[:, 2] * e2[:, 0]).sum() / 2)
                hull = MultiPoint(rest[:, [0, 2]]).convex_hull; outside = float(hull.distance(Point(V[v][0], V[v][2])))
                kind = 'spike up' if up >= 10 and plan < 30 else 'spike out' if outside >= 15 else None
                if kind: found.append({'what': kind, 'at': [round(float(V[v][0]), 1), round(float(V[v][2]), 1)], 'y': round(float(V[v][1]), 1), 'from': round(up if kind == 'spike up' else outside, 1), 'area': round(A, 1), 'triangles': np.where(tri)[0].tolist()})
        # pieces
        parent = np.arange(len(V))
        def find(i):
            while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
            return i
        for f in F:
            r0 = find(f[0])
            for v in f[1:]:
                r1 = find(v)
                if r1 != r0: parent[r1] = r0
        comp = np.array([find(f[0]) for f in F]); ids, ci = np.unique(comp, return_inverse=True)
        if len(ids) > 1:
            ca = np.bincount(ci, weights=area); main = int(np.argmax(ca)); fp = foot.get(p['id'].replace('kk-osm-', 'osm-')) if 'osm-' in p['id'] else None
            fpoly = poly(fp) if fp else None; mainV = cKDTree(V[np.unique(F[ci == main])][:, [0, 2]])
            for k in range(len(ids)):
                if k == main or ca[k] < 4: continue
                tri = np.where(ci == k)[0]; P = V[np.unique(F[tri])][:, [0, 2]]
                gap = float(mainV.query(P)[0].min())
                far = float(fpoly.distance(MultiPoint(P).convex_hull)) if fpoly is not None and not fpoly.is_empty else None
                if far is not None and far >= 4 or far is None and gap >= 10 and '--pieces' in sys.argv:
                    m = P.mean(0); found.append({'what': 'piece', 'at': [round(float(m[0]), 1), round(float(m[1]), 1)], 'y': round(float(V[np.unique(F[tri])][:, 1].max()), 1), 'from': round(far if far is not None else gap, 1), 'area': round(float(ca[k]), 1), 'triangles': tri.tolist()})
        if found:
            out.append({'id': p['id'], 'name': p.get('name', ''), 'x': round(float(c[0]), 1), 'z': round(float(c[2]), 1), 'height': p['height'], 'triangles': len(T), 'tile': t['file'], 'start': p['start'], 'count': p['count'],
                        'worst': max(f['from'] for f in found), 'found': found})
out.sort(key=lambda r: -r['worst'])
for r in out:
    print(f"{r['id']} {r['name'] or '-'} at {r['x']},{r['z']} ({r['triangles']} triangles, {r['height']} m): " + '; '.join(f"{f['what']} at {f['at'][0]},{f['at'][1]} y {f['y']}, {f['from']} m off, {f['area']} m2" for f in r['found']))
print(f"{CID}: {len(out)} houses with stray geometry candidates within {RADIUS:.0f} m ({sum(1 for r in out if any(f['what'].startswith('spike') for f in r['found']))} with spikes, {sum(1 for r in out if any(f['what']=='piece' for f in r['found']))} with pieces)")
if len(args) > 1: json.dump(out, open(args[1], 'w'))
