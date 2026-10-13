#!/usr/bin/env python3
"""Parked cars along the kerbs: for every car edge long enough, slots on its right-hand side just
beyond the driving lane, kept only where the carriageway surface is there and no building, crossing
or junction is. Writes public/cities/<id>/parked.json ({cars:[[x, z, yaw, paint]]}).
  python3 scripts/parked-cars.py copenhagen
"""
import gzip, json, math, random, sys
from PIL import Image, ImageDraw
import numpy as np

cid = sys.argv[1]; OUT = f'public/cities/{cid}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
mob = json.load(open(f'{OUT}/mobility.json'))
EXT = city['extent'] + 100; G = .5; N = int(2 * EXT / G)
def mask(polys):
    im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
    for p in polys:
        for k, ring in enumerate(p['rings']):
            if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=0 if k else 1)
    return np.array(im, dtype=bool)
road = mask([r for r in city['roads'] if 'island' not in str(r.get('kind', ''))])
bld = mask(city['buildings'])
# The drawn buildings come from the municipal 3D model, not OSM footprints: add every roof triangle of the rendered tiles.
import os
idx = json.load(open(f'{OUT}/buildings3d-index.json'))
im = Image.new('1', (N, N), 0); dr = ImageDraw.Draw(im); tris = 0
for t in idx['tiles']:
    a = np.frombuffer(gzip.decompress(open(f"{OUT}/{t['file']}", 'rb').read()), dtype=np.float32).reshape(-1, 3, 5)
    p0, p1, p2 = a[:, 0, :3], a[:, 1, :3], a[:, 2, :3]
    n = np.cross(p1 - p0, p2 - p0); keep = np.abs(n[:, 1]) > .3 * (np.linalg.norm(n, axis=1) + 1e-9)
    for tri in a[keep]:
        dr.polygon([((v[0] + EXT) / G, (v[2] + EXT) / G) for v in tri], fill=1); tris += 1
bld |= np.array(im, dtype=bool)
from scipy.ndimage import binary_dilation
bld = binary_dilation(bld, iterations=2)  # 1 m clearance from walls
print('roof triangles', tris)
def at(m, x, z):
    i, j = int((z + EXT) / G), int((x + EXT) / G)
    return 0 <= i < N and 0 <= j < N and m[i, j]
nodes_deg = {}
for e in mob['roads']['edges']:
    nodes_deg[e['from']] = nodes_deg.get(e['from'], 0) + 1; nodes_deg[e['to']] = nodes_deg.get(e['to'], 0) + 1
PAINT = ['#e9e9e6', '#1c1d1f', '#8a8f94', '#c7cacc', '#2b3a55', '#7a2522', '#3f4a3c', '#d9d2c0', '#5b6168', '#a32b25', '#1f3b5b', '#efe9d8']
rnd = random.Random(7); cars = []; taken = set()
for e in mob['roads']['edges']:
    if e.get('crossing') or e['length'] < 24: continue
    pts = e['points']; run = 0
    for a, b in zip(pts, pts[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
        if L < 6: run += L; continue
        ux, uz = dx / L, dz / L; rx, rz = -uz, ux  # right of travel in this x/z frame? checked below with lane side
        off = e['lane'] + 2.25
        s = 9.0
        while s < L - 9:
            along = run + s
            if along < 12 or along > e['length'] - 12: s += 5.8; continue
            x, z = a[0] + ux * s, a[1] + uz * s
            # the side the lane offset uses (routePoint offsets to the right): test both, keep the one on the carriageway
            for sgn in (1, -1):
                px, pz = x + rx * off * sgn, z + rz * off * sgn
                qx, qz = x + rx * (off + .8) * sgn, z + rz * (off + .8) * sgn
                cx, cz = x + rx * (off + .35) * sgn, z + rz * (off + .35) * sgn  # car centre
                corners = [(cx + ux * f * 2.4 + rx * g * 1.0, cz + uz * f * 2.4 + rz * g * 1.0) for f in (-1, 0, 1) for g in (-1, 1)]
                if at(road, px, pz) and at(road, qx, qz) and all(at(road, *c) and not at(bld, *c) for c in corners) and not at(bld, qx + rx * 1.2 * sgn, qz + rz * 1.2 * sgn):
                    key = (round(px / 3), round(pz / 3))
                    if key in taken: break
                    taken.add(key)
                    if rnd.random() < .78:
                        cars.append([round(px, 2), round(pz, 2), round(math.atan2(ux, uz) + (math.pi if sgn < 0 else 0), 3), rnd.randrange(len(PAINT))])
                    break
            s += 5.8 + rnd.random() * .8
        run += L
json.dump({'paints': PAINT, 'cars': cars}, open(f'{OUT}/parked.json', 'w'), separators=(',', ':'))
print('parked cars', len(cars))
