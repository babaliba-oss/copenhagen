#!/usr/bin/env python3
"""Trees for parks, lawns and woods that the registers leave bare (park trees are not in the street-tree
register and OpenStreetMap maps few of them). Groves and open lawns follow a low-frequency noise so parks
read as parks, not orchards. Rerunnable: earlier fill trees (fill: 1) are replaced.
  python3 scripts/fill-greenery.py copenhagen
"""
import gzip, json, math, random, sys
import numpy as np
from PIL import Image, ImageDraw

cid = sys.argv[1]; path = f'public/cities/{cid}/city.pack'
city = json.loads(gzip.decompress(open(path, 'rb').read()))
city['trees'] = [t for t in city['trees'] if not t.get('fill')]  # fill 1: parks, fill 2: open ground
EXT = city['extent'] + 100; G = 1.0; N = int(2 * EXT / G)
def mask(polys, grow=0):
    im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
    for p in polys:
        for k, ring in enumerate(p['rings']):
            if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=0 if k else 1, outline=None if k else 1)
    a = np.array(im, dtype=bool)
    for _ in range(grow): a = a | np.roll(a, 1, 0) | np.roll(a, -1, 0) | np.roll(a, 1, 1) | np.roll(a, -1, 1)
    return a
blocked = mask(city['buildings'], 3) | mask(city['roads'], 2) | mask(city['water'], 2) | mask(city.get('pavement', []), 1)
occ = np.zeros((N, N), dtype=bool)
for t in city['trees']:
    i, j = int((t['p'][1] + EXT) / G), int((t['p'][0] + EXT) / G)
    if 0 <= i < N and 0 <= j < N: occ[max(0, i - 5):i + 6, max(0, j - 5):j + 6] = True
rnd = random.Random(3)
def noise(x, z, s):  # value noise
    xi, zi = math.floor(x / s), math.floor(z / s); fx, fz = x / s - xi, z / s - zi
    h = lambda a, b: (math.sin(a * 127.1 + b * 311.7) * 43758.5453) % 1
    fx, fz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    return (h(xi, zi) * (1 - fx) + h(xi + 1, zi) * fx) * (1 - fz) + (h(xi, zi + 1) * (1 - fx) + h(xi + 1, zi + 1) * fx) * fz
SPECIES = {'park': ['Tilia', 'Fagus', 'Quercus', 'Acer', 'Aesculus', 'Betula', 'Fraxinus', 'Platanus'], 'wood': ['Fagus', 'Quercus', 'Betula', 'Alnus', 'Picea', 'Acer']}
added = 0
for p in city['parks']:
    kind = p.get('kind', ''); wood = kind == 'Metsä'
    if kind in ('Kenttä', 'Leikkipaikka'): continue  # pitches and playgrounds stay open
    bb = p['bbox']
    if (bb[2] - bb[0]) * (bb[3] - bb[1]) < 300: continue
    pm = mask([p])
    area = (bb[2] - bb[0]) * (bb[3] - bb[1]); huge = area > 120000 and not wood
    step = 7.5 if wood else (30.0 if huge else 11.0)
    x = bb[0] + rnd.random() * step
    while x < bb[2]:
        z = bb[1] + rnd.random() * step
        while z < bb[3]:
            px, pz = x + (rnd.random() - .5) * step * .8, z + (rnd.random() - .5) * step * .8
            i, j = int((pz + EXT) / G), int((px + EXT) / G)
            dense = noise(px, pz, 55) * .7 + noise(px, pz, 17) * .3
            if 0 <= i < N and 0 <= j < N and pm[i, j] and not blocked[i, j] and not occ[i, j] and (wood or dense > (.66 if huge else .48)):
                sp = rnd.choice(SPECIES['wood' if wood else 'park'])
                city['trees'].append({'p': [round(px, 2), round(pz, 2)], 'species': sp, 'size': '30 - 50 cm', 'height': round(9 + rnd.random() * 11, 1), 'fill': 1})
                occ[max(0, i - 3):i + 4, max(0, j - 3):j + 4] = True; added += 1
            z += step
        x += step
# Second pass: large open ground that is not a mapped park (yards, forecourts, waterfront lots) gets sparse
# tree groups, kept 7 m from buildings and roads, so the city has no bare fields.
from scipy import ndimage
parks_m = mask(city['parks'])
far = ~(mask(city['buildings'], 7) | mask(city['roads'], 5) | mask(city['water'], 4) | mask(city.get('pavement', []), 2))
open_ = far & ~parks_m
yy, xx = np.mgrid[0:N, 0:N]; inside = ((xx * G - EXT) ** 2 + (yy * G - EXT) ** 2) < (city.get('radius', 2200)) ** 2
open_ &= inside
lab, nlab = ndimage.label(open_)
sizes = ndimage.sum(open_, lab, range(1, nlab + 1))
big = np.isin(lab, [i + 1 for i, a in enumerate(sizes) if a * G * G > 1800])
added2 = 0; step = 16.0
for x in np.arange(-EXT, EXT, step):
    for z in np.arange(-EXT, EXT, step):
        px, pz = x + rnd.random() * step * .7, z + rnd.random() * step * .7
        i, j = int((pz + EXT) / G), int((px + EXT) / G)
        if not (0 <= i < N and 0 <= j < N) or not big[i, j] or occ[i, j]: continue
        if noise(px, pz, 40) < .5: continue
        city['trees'].append({'p': [round(px, 2), round(pz, 2)], 'species': rnd.choice(['Tilia', 'Acer', 'Platanus', 'Betula', 'Quercus']), 'size': '30 - 50 cm', 'height': round(8 + rnd.random() * 8, 1), 'fill': 2})
        occ[max(0, i - 4):i + 5, max(0, j - 4):j + 5] = True; added2 += 1
print('open-ground trees', added2)
open(path, 'wb').write(gzip.compress(json.dumps(city, separators=(',', ':')).encode(), 9))
print('fill trees', added, 'total', len(city['trees']))
