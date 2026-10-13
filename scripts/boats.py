#!/usr/bin/env python3
"""Moored boats along the quays: walk every water edge, and where the water 4–10 m out from it is open,
moor a boat parallel to the quay (sailboats and small motor boats; wooden boats in Nyhavn and the
Christianshavn canal). Also a few loops for moving canal tour boats along the harbour.
Writes public/cities/<id>/boats.json.   python3 scripts/boats.py copenhagen [--era 1760]"""
import gzip, json, math, random, sys
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer

cid = sys.argv[1]; ERA = '--era' in sys.argv
city = json.loads(gzip.decompress(open(f'public/cities/{cid}/city.pack', 'rb').read()))
fwd = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
L = lambda lon, lat: (lambda p: (p[0], -p[1]))(fwd.transform(lon, lat))
EXT = city['extent'] + 100; G = 1.0; N = int(2 * EXT / G)
im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
for w in city['water']:
    for k, ring in enumerate(w['rings']):
        if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=0 if k else 1)
water = np.array(im, dtype=bool)
im2 = Image.new('1', (N, N), 0); d2 = ImageDraw.Draw(im2)
for r in city['roads']:
    for ring in r['rings'][:1]:
        if len(ring) > 2: d2.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=1)
roads = np.array(im2, dtype=bool)  # bridges cross the water: no boats under them
def wet(x, z):
    i, j = int((z + EXT) / G), int((x + EXT) / G)
    return 0 <= i < N and 0 <= j < N and water[i, j] and not roads[i, j]
NYHAVN = L(12.5905, 55.6798); CHAVN = L(12.5915, 55.6735)
rnd = random.Random(11); boats = []; taken = set()
NOBOATS = ('lake', 'moat', 'pond', 'basin', 'reflecting_pool', 'reflection_pool', 'fountain')
def navigable(w):  # harbour, canals and sea only: no ships in the Lakes, the moats or a fountain
    n = (w.get('name') or '').lower()
    return w.get('kind') not in NOBOATS and not any(k in n for k in ('grav', 'sø', 'spring', 'dam'))
for w in city['water']:
    if not navigable(w): continue
    for ring in w['rings']:
        for a, b in zip(ring, ring[1:]):
            dx, dz = b[0] - a[0], b[1] - a[1]; Lg = math.hypot(dx, dz)
            if Lg < 8: continue
            ux, uz = dx / Lg, dz / Lg
            s = 4 + rnd.random() * 6
            while s < Lg - 4:
                x, z = a[0] + ux * s, a[1] + uz * s
                if math.hypot(x, z) > 2300: s += 12; continue
                for sgn in (1, -1):
                    nx, nz = -uz * sgn, ux * sgn
                    if wet(x + nx * 2.5, z + nz * 2.5) and wet(x + nx * 4, z + nz * 4) and wet(x + nx * 9, z + nz * 9) and wet(x + nx * 4 + ux * 5, z + nz * 4 + uz * 5) and wet(x + nx * 4 - ux * 5, z + nz * 4 - uz * 5):
                        px, pz = x + nx * 3.4, z + nz * 3.4; key = (round(px / 7), round(pz / 7))
                        if key in taken: break
                        taken.add(key)
                        canal = min(math.hypot(px - NYHAVN[0], pz - NYHAVN[1]), math.hypot(px - CHAVN[0], pz - CHAVN[1])) < 260
                        if rnd.random() < (.9 if canal else (.18 if ERA else .32)):
                            kind = ('ship' if math.hypot(px, pz) < 1700 and wet(x + nx * 40, z + nz * 40) and wet(x + nx * 70, z + nz * 70) and rnd.random() < .45 else 'wooden') if ERA else ('wooden' if canal and rnd.random() < .6 else rnd.choice(['sail', 'sail', 'motor']))
                            boats.append([round(px, 2), round(pz, 2), round(math.atan2(ux, uz) + (math.pi if rnd.random() < .5 else 0), 3), kind, round(.8 + rnd.random() * .3, 2)])
                        break
                s += 7.5 + rnd.random() * 5
# Tour boat loops through the inner harbour (lon, lat), checked against the water mask
LOOPS = [[(12.5905, 55.6796), (12.5960, 55.6794), (12.5995, 55.6830), (12.5965, 55.6870), (12.5990, 55.6910), (12.5985, 55.6870), (12.5960, 55.6810), (12.5915, 55.6760), (12.5860, 55.6735), (12.5810, 55.6712), (12.5860, 55.6740), (12.5920, 55.6775)]]
routes = []
for loop in LOOPS:
    pts = []
    for lon, lat in loop:  # snap each waypoint to the nearest open water within 80 m (well clear of the quay)
        x0, z0 = L(lon, lat); best = None
        for r in range(0, 80, 4):
            for k in range(16 if r else 1):
                a = k / 16 * 2 * math.pi; x, z = x0 + math.cos(a) * r, z0 + math.sin(a) * r
                if all(wet(x + math.cos(b) * 7, z + math.sin(b) * 7) for b in (0, 1.57, 3.14, 4.71)) and wet(x, z): best = (x, z); break
            if best: break
        if best: pts.append([round(best[0], 1), round(best[1], 1)])
    if len(pts) >= 4: routes.append(pts)
json.dump({'boats': boats, 'routes': routes}, open(f'public/cities/{cid}/boats.json', 'w'), separators=(',', ':'))
from collections import Counter
print('boats', len(boats), Counter(b[3] for b in boats), 'routes', [len(r) for r in routes])
