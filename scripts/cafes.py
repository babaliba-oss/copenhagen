#!/usr/bin/env python3
"""Café tables on Nyhavn's north quay: between the house fronts and the quay edge, a table with chairs
and an umbrella every ~4 m, from the water and building outlines. Writes public/cities/<id>/cafes.json.
  python3 scripts/cafes.py copenhagen"""
import gzip, json, math, sys
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
cid = sys.argv[1]; OUT = f'public/cities/{cid}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
f = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
L = lambda lo, la: (lambda p: (p[0], -p[1]))(f.transform(lo, la))
EXT = city['extent'] + 100; G = .5; N = int(2 * EXT / G)
def mask(polys):
    im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
    for p in polys:
        for ring in p['rings'][:1]:
            if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=1)
    return np.array(im, dtype=bool)
water, bld = mask(city['water']), mask(city['buildings'])
at = lambda m, x, z: (lambda i, j: 0 <= i < N and 0 <= j < N and m[i, j])(int((z + EXT) / G), int((x + EXT) / G))
(x0, z0), (x1, z1) = L(12.5884, 55.6801), L(12.5935, 55.6797)
ux, uz = x1 - x0, z1 - z0; Ln = math.hypot(ux, uz); ux /= Ln; uz /= Ln; nx, nz = uz, -ux
cafes = []
s = 95.0
while s < Ln - 5:
    bx, bz = x0 + ux * s, z0 + uz * s
    q = next((o for o in np.arange(0, 40, .5) if not at(water, bx + nx * o, bz + nz * o)), None)
    if q is not None:
        h = next((o for o in np.arange(q, q + 30, .5) if at(bld, bx + nx * o, bz + nz * o)), None)
        if h is not None and 6 < h - q < 26:
            for frac in (.62, .82):
                o = q + (h - q) * frac
                cafes.append([round(bx + nx * o, 2), round(bz + nz * o, 2), round(math.atan2(ux, uz), 3), len(cafes) % 4])
    s += 4.2
json.dump({'tables': cafes}, open(f'{OUT}/cafes.json', 'w'))
print('cafe tables', len(cafes))
