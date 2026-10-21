#!/usr/bin/env python3
"""Oil lanterns for Copenhagen 1760: posts along the town's streets every ~38 m at the house side,
written as furniture.json ('park-lamp' posts, which glow at night). Only inside the walls, and off the coaches' driving
lines (every road edge at its lane offset, 1.2 m either side: on narrow streets and at corners a post stood in the other
direction's or a side street's line, and the traffic coaches drove through it).
  python3 scripts/lanterns-1760.py            # place them
  python3 scripts/lanterns-1760.py --prune    # only drop the placed posts that stand in a driving line (keeps the rest as they are)"""
import gzip, json, math, sys
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
lanes_im = Image.new('1', (N, N), 0); d3 = ImageDraw.Draw(lanes_im)
for e in mob['roads']['edges']:
    pts, off, line = e['points'], e['lane'], []
    for i, (x, z) in enumerate(pts):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]; dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz) or 1
        line.append(((x - dz / L * off + EXT) / G, (z + dx / L * off + EXT) / G))  # mobility.js routePoint's offset
    d3.line(line, fill=1, width=int(round(2 * 1.2 / G)) + 1)
lanes = np.array(lanes_im, dtype=bool)
at = lambda m, x, z: (lambda i, j: 0 <= i < N and 0 <= j < N and m[i, j])(int((z + EXT) / G), int((x + EXT) / G))
if '--prune' in sys.argv:
    layer = json.load(open(f'{OUT}/furniture.json')); n = len(layer['items'])
    layer['items'] = [it for it in layer['items'] if not at(lanes, it['x'], it['z'])]; layer['counts'] = {'lantern': len(layer['items'])}
    json.dump(layer, open(f'{OUT}/furniture.json', 'w'), separators=(',', ':')); print('lanterns', n, '->', len(layer['items'])); sys.exit()
items = []; taken = set(); near = {}
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
                if at(town, px, pz) and not at(bld, px, pz) and not at(bld, px - uz * .8, pz + ux * .8) and not at(lanes, px, pz):
                    k = (round(px / 12), round(pz / 12))
                    c4 = (math.floor(px / 4), math.floor(pz / 4))  # two 12 m cells meet: no second post within 4 m (12 pairs stood grown into each other)
                    if k not in taken and not any(math.hypot(q['x'] - px, q['z'] - pz) < 4 for i in (-1, 0, 1) for j in (-1, 0, 1) for q in near.get((c4[0] + i, c4[1] + j), ())):
                        taken.add(k); items.append({'k': 'lantern', 'x': round(px, 2), 'z': round(pz, 2), 'yaw': 0, 'src': 'era-1760'}); near.setdefault(c4, []).append(items[-1])
                    break
            s += 38
        run += L
json.dump({'source': 'Oil lanterns placed along the 1760 streets (procedural)', 'licence': '', 'counts': {'lantern': len(items)}, 'faces': [], 'items': items}, open(f'{OUT}/furniture.json', 'w'), separators=(',', ':'))
reg = json.load(open('public/cities/index.json'))
for c in reg['cities']:
    if c['id'] == cid: c['furniture'] = 'furniture.json'
json.dump(reg, open('public/cities/index.json', 'w'), indent=1, ensure_ascii=False)
print('lanterns', len(items))
