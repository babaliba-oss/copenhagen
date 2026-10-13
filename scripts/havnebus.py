#!/usr/bin/env python3
"""Harbour bus route (Havnebussen) through the inner harbour: waypoints at real stops, each snapped to the
middle of the channel nearby, joined by least-cost paths on a water raster that prefer open water.
Adds {'ferries': [{'name', 'path': [[x, z], ...], 'stops': [index, ...]}]} to boats.json.
  python3 scripts/havnebus.py copenhagen
"""
import gzip, json, sys
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy import ndimage
from skimage.graph import route_through_array
cid = sys.argv[1]; OUT = f'public/cities/{cid}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
tr = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
def ll(lat, lon): x, y = tr.transform(lon, lat); return (x, -y)
EXT = city['extent'] + 100; G = 4.0; N = int(2 * EXT / G)
im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
for w in city['water']:
    for k, ring in enumerate(w['rings']):
        if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=0 if k else 1)
wet = np.array(im, dtype=bool); dt = ndimage.distance_transform_edt(wet) * G
STOPS = [('Nordre Toldbod', 55.6905, 12.5985), ('Nyhavn', 55.6798, 12.5945), ('Operaen', 55.6815, 12.5985),
         ('Knippelsbro', 55.6745, 12.5872), ('Det Kongelige Bibliotek', 55.6730, 12.5835), ('Islands Brygge', 55.6665, 12.5775)]
def snap(x, z, r=260):
    i0, j0 = int((z + EXT) / G), int((x + EXT) / G); R = int(r / G)
    sub = dt[max(0, i0 - R):i0 + R, max(0, j0 - R):j0 + R].copy()
    ii, jj = np.mgrid[max(0, i0 - R):i0 + R, max(0, j0 - R):j0 + R]
    score = np.minimum(sub, 40) - np.hypot(ii - i0, jj - j0) * G * .15; score[sub < 12] = -1e9
    k = np.unravel_index(np.argmax(score), score.shape); return (ii[k], jj[k])
nodes = [snap(*ll(a, b)) for _, a, b in STOPS]
cost = np.where(wet, 1.0 / (np.minimum(dt, 40) + 2), 1e6)
path = []; stops = []
for a, b in zip(nodes, nodes[1:]):
    p, _ = route_through_array(cost, a, b, fully_connected=True, geometric=True)
    if path: p = p[1:]
    stops.append(len(path)); path += p
stops.append(len(path) - 1)
pts = [[j * G - EXT + G / 2, i * G - EXT + G / 2] for i, j in path]
# smooth and thin to ~12 m
for _ in range(6): pts = [pts[0]] + [[(pts[k - 1][0] + 2 * pts[k][0] + pts[k + 1][0]) / 4, (pts[k - 1][1] + 2 * pts[k][1] + pts[k + 1][1]) / 4] for k in range(1, len(pts) - 1)] + [pts[-1]]
keep = [0]; acc = 0
for k in range(1, len(pts)):
    acc += np.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
    if acc >= 12 or k in stops: keep.append(k); acc = 0
idx = {k: n for n, k in enumerate(keep)}
route = [[round(pts[k][0], 1), round(pts[k][1], 1)] for k in keep]
stop_idx = [idx.get(s, min(idx, key=lambda q: abs(q - s))) if s in idx else idx[min(idx, key=lambda q: abs(q - s))] for s in stops]
boats = json.load(open(f'{OUT}/boats.json'))
boats['ferries'] = [{'name': 'Havnebussen', 'path': route, 'stops': stop_idx, 'stopNames': [s[0] for s in STOPS]}]
json.dump(boats, open(f'{OUT}/boats.json', 'w'), separators=(',', ':'))
L = sum(np.hypot(route[k][0] - route[k - 1][0], route[k][1] - route[k - 1][1]) for k in range(1, len(route)))
print('havnebus route', len(route), 'points', round(L), 'm, stops', stop_idx)
