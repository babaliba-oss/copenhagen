#!/usr/bin/env python3
"""Add the city.json starts that city-build left out (it keeps 8 unless "maxStarts" is set) to an existing
city.pack, snapped to the nearest car edge, without rebuilding.  python3 scripts/add-starts.py copenhagen"""
import gzip, json, math, sys
from pyproj import Transformer
cid = sys.argv[1]; cfg = json.load(open(f'cities/{cid}/city.json'))
pack_path = f'public/cities/{cid}/city.pack'; pack = json.loads(gzip.decompress(open(pack_path, 'rb').read()))
mob = json.load(open(f'public/cities/{cid}/mobility.json'))
fwd = Transformer.from_crs('EPSG:4326', pack['projection'], always_xy=True)
have = {l['name'] for l in pack['landmarks']}
for s in cfg.get('starts', []):
    if s['name'] in have: continue
    x, y = fwd.transform(*s['at']); z = -y; best = None
    for e in mob['roads']['edges']:
        pts = e['points']
        for a, b in zip(pts, pts[1:]):
            dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz
            if not l2: continue
            t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)); px, pz = a[0] + dx * t, a[1] + dz * t; d = math.hypot(px - x, pz - z)
            if best is None or d < best[0]: best = (d, px, pz, dx, dz)
    if not best or best[0] > 120: print('skip', s['name']); continue
    pack['landmarks'].append({'name': s['name'], 'district': cfg['name'], 'street': '', 'x': round(best[1], 2), 'z': round(best[2], 2), 'heading': round(math.atan2(-best[3], -best[4]), 4)})
    print('added', s['name'], round(best[0], 1), 'm from the given point')
open(pack_path, 'wb').write(gzip.compress(json.dumps(pack, separators=(',', ':')).encode(), 9))
