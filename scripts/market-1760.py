#!/usr/bin/env python3
"""Market stalls on the 1760 squares (Gammeltorv, Amagertorv, Højbro Plads, Kultorvet, Nytorv, Gråbrødretorv):
stalls ring each square's open centre, clear of houses and roads' carriageways. Writes
public/cities/copenhagen-1760/stalls.json.   python3 scripts/market-1760.py"""
import gzip, json, math, random
import numpy as np
from PIL import Image, ImageDraw
cid = 'copenhagen-1760'; OUT = f'public/cities/{cid}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
EXT = city['extent'] + 100; G = .5; N = int(2 * EXT / G)
im = Image.new('1', (N, N), 0); d = ImageDraw.Draw(im)
for b in city['buildings'] + city['water']:
    for ring in b['rings'][:1]:
        if len(ring) > 2: d.polygon([((x + EXT) / G, (z + EXT) / G) for x, z in ring], fill=1)
blocked = np.array(im, dtype=bool)
free = lambda x, z, r=2.5: all(not blocked[int((z + dz + EXT) / G), int((x + dx + EXT) / G)] for dx in (-r, 0, r) for dz in (-r, 0, r))
want = {'Gammeltorv', 'Amagertorv', 'Højbro Plads', 'Kultorvet', 'Gråbrødretorv', 'Kongens Nytorv'}
rnd = random.Random(1760); stalls = []
for l in city['landmarks']:
    if l['name'] not in want: continue
    placed = 0
    for k in range(400):
        r = 6 + rnd.random() * 22; a = rnd.random() * 2 * math.pi
        x, z = l['x'] + math.cos(a) * r, l['z'] + math.sin(a) * r
        if free(x, z) and all(math.hypot(x - s[0], z - s[1]) > 4.2 for s in stalls):
            stalls.append([round(x, 2), round(z, 2), round(a + math.pi / 2 + (rnd.random() - .5) * .4, 3), rnd.randrange(4)]); placed += 1
            if placed >= (14 if l['name'] == 'Kongens Nytorv' else 9): break
json.dump({'stalls': stalls}, open(f'{OUT}/stalls.json', 'w'))
print('stalls', len(stalls))
