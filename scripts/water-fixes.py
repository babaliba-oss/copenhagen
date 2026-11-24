#!/usr/bin/env python3
"""Straight quay edges where OpenStreetMap's water outline zig-zags in a few metres. Each fix names a water polygon of
city.pack and two vertices of one of its rings; the vertices between them go, so the edge runs straight from one to
the other. The quay walls (quay.js) follow the outline: at Nyhavn's canal head its five little landing notches made
five short walls, each with its dark water-side skirt overlapping the next, and from the quay they read as dark slabs
sunk at the water's edge. The game's shore levelling (terrain.js raiseDryHollows, levelBanks) raises the ground that
becomes land to quay height. Rerunnable: a fix already made changes nothing.

  python3 scripts/water-fixes.py copenhagen
"""
import gzip, json, sys

CID = sys.argv[1] if len(sys.argv) > 1 else 'copenhagen'; ROOT = f'public/cities/{CID}/'; MAX_STRAY = 8.0
FIXES = {'copenhagen': [
    # Nyhavn's canal head, from the south quay to the north quay (the same edge in the canal and in the sea polygon)
    ('osm-relation-6476337', [748.56, -43.57], [760.48, -67.31]),
    ('osm-relation--1000', [748.56, -43.57], [760.48, -67.31]),
]}
city = json.loads(gzip.decompress(open(ROOT + 'city.pack', 'rb').read()))
near = lambda p, q: abs(p[0] - q[0]) < .02 and abs(p[1] - q[1]) < .02
done = 0
for wid, a, b in FIXES.get(CID, []):
    ws = [w for w in city['water'] if w['id'] == wid]  # an id can come twice (the sea is split in pieces)
    if not ws: print(f'{CID}: {wid} not in city.pack'); continue
    for ring in (r for w in ws for r in w['rings']):
        ia = next((i for i, p in enumerate(ring) if near(p, a)), None); ib = next((i for i, p in enumerate(ring) if near(p, b)), None)
        if ia is None or ib is None: continue
        closed = near(ring[0], ring[-1]); pts = ring[:-1] if closed else ring; n = len(pts)
        ia, ib = ia % n, ib % n
        sides = [[(ia + k) % n for k in range(1, (ib - ia) % n)], [(ib + k) % n for k in range(1, (ia - ib) % n)]]
        def off(idx):  # how far the side strays from the straight edge (m)
            ax, az = a; bx, bz = b; L = ((bx - ax) ** 2 + (bz - az) ** 2) ** .5
            return max((abs((bx - ax) * (az - pts[i][1]) - (ax - pts[i][0]) * (bz - az)) / L for i in idx), default=0)
        side = min(sides, key=off)
        if not side: continue
        stray = off(side)
        if stray > MAX_STRAY: print(f'{CID}: {wid}: no side within {MAX_STRAY} m of the edge, left as it is'); continue
        drop = set(side); pts = [p for i, p in enumerate(pts) if i not in drop]
        ring[:] = pts + [pts[0]] if closed else pts; done += 1
        print(f'{CID}: {wid}: {len(drop)} vertices between {a} and {b} taken out (they strayed up to {stray:.1f} m)')
if done: open(ROOT + 'city.pack', 'wb').write(gzip.compress(json.dumps(city, separators=(',', ':'), ensure_ascii=False).encode(), 9, mtime=0))
print(f'{CID}: {done} water edges straightened')
