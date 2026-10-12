#!/usr/bin/env python3
"""Oil lanterns for Copenhagen 1760: posts along the town's streets every ~38 m at the house side,
written as furniture.json ('park-lamp' posts, which glow at night). Only inside the walls.
  python3 scripts/lanterns-1760.py"""
import gzip, json, math
cid = 'copenhagen-1760'; OUT = f'public/cities/{cid}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
mob = json.load(open(f'{OUT}/mobility.json'))
from PIL import Image, ImageDraw
import numpy as np
EXT = city['extent'] + 100; G = .5; N = int(2 * EXT / G)
im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
for b in city['buildings']:
    for ring in b['rings'][:1]:
        if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=1)
bld = np.array(im, dtype=bool)
pave = Image.new('1', (N, N), 0); d2 = ImageDraw.Draw(pave)
for p in city['pavement']:
    if p.get('name') == 'Brosten':
        for ring in p['rings'][:1]:
            if len(ring) > 2: d2.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=1)
town = np.array(pave, dtype=bool)
at = lambda m, x, z: (lambda i, j: 0 <= i < N and 0 <= j < N and m[i, j])(int((z + EXT) / G), int((x + EXT) / G))
items = []; taken = set()
for e in mob['roads']['edges']:
    pts = e['points']; run = 0
    for a, b in zip(pts, pts[1:]):
        dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
        if L < 1: continue
        ux, uz = dx / L, dz / L; s = 19 - run % 38
        while s < L:
            x, z = a[0] + ux * s, a[1] + uz * s
            for off in (e['lane'] + 3.0, e['lane'] + 2.2):
                px, pz = x - uz * off, z + ux * off
                if at(town, px, pz) and not at(bld, px, pz) and not at(bld, px - uz * .8, pz + ux * .8):
                    k = (round(px / 12), round(pz / 12))
                    if k not in taken: taken.add(k); items.append({'k': 'lantern', 'x': round(px, 2), 'z': round(pz, 2), 'yaw': 0, 'src': 'era-1760'})
                    break
            s += 38
        run += L
json.dump({'source': 'Oil lanterns placed along the 1760 streets (procedural)', 'licence': '', 'counts': {'lantern': len(items)}, 'faces': [], 'items': items}, open(f'{OUT}/furniture.json', 'w'), separators=(',', ':'))
reg = json.load(open('public/cities/index.json'))
for c in reg['cities']:
    if c['id'] == cid: c['furniture'] = 'furniture.json'
json.dump(reg, open('public/cities/index.json', 'w'), indent=1, ensure_ascii=False)
print('lanterns', len(items))
