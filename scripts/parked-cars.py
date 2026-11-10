#!/usr/bin/env python3
"""Parked cars along the kerbs, kept only where the carriageway surface is there and no building, traffic lane, crossing
or junction is. Writes public/cities/<id>/parked.json ({cars:[[x, z, yaw, paint]]}).

  python3 scripts/parked-cars.py copenhagen [<wfs dir> [<frb dir>]] && node scripts/parked-lanes.mjs copenhagen  (drops cars in any traffic lane, and overlaps)

With <wfs dir> (Københavns Kommune map data, CC BY 4.0, wfs-kbhkort.kk.dk k101 p_pladser as GeoJSON in EPSG:4326) the
cars stand where the city's parking register has kerbside parking. Each stretch of it is cut into its number of spaces
(antal_pladser), at least 5.4 m apart (angled bays are filled parallel to the kerb, so they hold fewer cars), about 1 in
7 left free. A car stands beside the road edge its stretch runs along, on that side, facing the traffic of that side,
moved from the register's kerb line in towards the middle until the drawn carriageway (city.pack roads) holds it
clear of buildings; it is left out if it would then stand within 1.95 m of a lane line, 11 m of a junction or 5 m of
a pedestrian crossing, or on street furniture (furniture.json, the overhead wire lamps aside). The carriageways reach the city's kerbs (scripts/kk-kerbs.py,
run first); a street still drawn narrower than it is (OSM widths, no kerb data) has no room beside the lanes and stays empty. Left out of the register: suspended stretches (midlertidigt nedlagt), no-parking and
no-stopping ones, the taxi, motorcycle and coach bays, and car parks (P-område). The stretches end at junctions and
driveways, so the cars do too. Without <wfs dir>: a slot every ~6 m beyond the lane of every road edge, 78% filled.
With <frb dir> as well (Frederiksberg Kommune, Parkeringspladser, CC BY 4.0, opendata.dk/city-of-frederiksberg:
parkeringspladser.geojson, the marked parking strips as polygons) the strips of Frederiksberg, which Copenhagen's
register stops at, are stretches too, after the city's: a strip's long axis, a space every 5.4 m. The motorcycle and
taxi bays, the parking cellars and the strips with no type are left out.
"""
import gzip, json, math, random, sys
from collections import defaultdict
from PIL import Image, ImageDraw
import numpy as np

cid = sys.argv[1]; OUT = f'public/cities/{cid}'; KK = sys.argv[2] if len(sys.argv) > 2 else None; FRB = sys.argv[3] if len(sys.argv) > 3 else None
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
PAINT = ['#e9e9e6', '#1c1d1f', '#8a8f94', '#c7cacc', '#2b3a55', '#7a2522', '#3f4a3c', '#d9d2c0', '#5b6168', '#a32b25', '#1f3b5b', '#efe9d8']
def edge_slots():
    """Every kerb slot the drawn street has room for, along the road edges: [x, z, yaw, ux, uz]."""
    rnd = random.Random(7); slots = []; taken = set()
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
                        slots.append([round(px, 2), round(pz, 2), round(math.atan2(ux, uz) + (math.pi if sgn < 0 else 0), 3), ux, uz])
                        break
                s += 5.8 + rnd.random() * .8
            run += L
    print('kerb slots', len(slots)); return slots, rnd


if not KK:
    slots, rnd = edge_slots()
    cars = [[x, z, yaw, rnd.randrange(len(PAINT))] for x, z, yaw, _, _ in slots if rnd.random() < .78]
    meta = {}
else:
    from pyproj import Transformer
    to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
    SKIP_RULE = {'Standsningsforbud', 'Parkeringsforbud', 'Forbeholdt busser', 'Forbeholdt turistbusser'}
    SKIP_KIND = ('Taxi', 'Motorcykel', 'Turistbus')
    stretches = []  # [id, spaces, [polyline]]
    for f in json.load(open(f'{KK}/p_pladser.json', encoding='utf8'))['features']:
        p = f['properties']
        if not p.get('antal_pladser') or p.get('p_status') == 'midlertidigt nedlagt' or p.get('restriktionstype') in SKIP_RULE: continue
        if any(k in (p.get('p_ordning') or '') for k in SKIP_KIND) or p.get('vejside') == 'P-område/areal': continue
        for line in f['geometry']['coordinates']:
            pl = [to_local.transform(*q[:2]) for q in line]; pl = [(a, -b) for a, b in pl]
            if all(abs(x) < EXT and abs(z) < EXT for x, z in pl) and len(pl) > 1: stretches.append([len(stretches), p['antal_pladser'], pl, p.get('vejnavn')])
    if FRB:  # pladstype 1-3 disabled, 4 cars, 5 shared cars, 6 and 9 electric cars; not 7 motorcycles, 8 taxis, 10 cellars
        from shapely.geometry import Polygon
        for f in json.load(open(f'{FRB}/parkeringspladser.geojson', encoding='utf8'))['features']:
            if not f.get('geometry') or f['properties'].get('pladstype') not in (1, 2, 3, 4, 5, 6, 9): continue
            ring = [to_local.transform(*q[:2]) for q in f['geometry']['coordinates'][0]]; ring = [(a, -b) for a, b in ring]
            if not all(abs(x) < EXT and abs(z) < EXT for x, z in ring): continue
            c = list(Polygon(ring).minimum_rotated_rectangle.exterior.coords)
            if len(c) < 5: continue
            if math.dist(c[0], c[1]) < math.dist(c[1], c[2]): c = c[1:] + c[1:2]
            pl = [((c[0][0] + c[3][0]) / 2, (c[0][1] + c[3][1]) / 2), ((c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2)]; L = math.dist(*pl)
            if L >= 5.2: stretches.append([len(stretches), int(L // 5.4) or 1, pl, None])
    # The road graph's lane lines (each edge's lane offset right of travel) and junction nodes, for placing the cars.
    nodes = mob['roads']['nodes']; deg = defaultdict(int)
    for e in mob['roads']['edges']: deg[e['from']] += 1; deg[e['to']] += 1
    C = 20; eg = defaultdict(list); xg = defaultdict(list); jg = defaultdict(list)
    def cells(a, b, pad):
        for i in range(math.floor((min(a[0], b[0]) - pad) / C), math.floor((max(a[0], b[0]) + pad) / C) + 1):
            for j in range(math.floor((min(a[1], b[1]) - pad) / C), math.floor((max(a[1], b[1]) + pad) / C) + 1): yield i, j
    for e in mob['roads']['edges']:
        for a, b in zip(e['points'], e['points'][1:]):
            l = math.dist(a, b)
            if l < .05: continue
            seg = (a, ((b[0] - a[0]) / l, (b[1] - a[1]) / l), l, e['lane'])
            for k in cells(a, b, 12): (xg if e.get('crossing') else eg)[k].append(seg)
    for i, nd in enumerate(nodes):
        if deg[i] >= 3:
            p = (nd[0], nd[1]) if isinstance(nd, (list, tuple)) else (nd['x'], nd['z'])
            for k in cells(p, p, 10): jg[k].append(p)
    def segs(g, x, z): return g.get((math.floor(x / C), math.floor(z / C)), ())
    def lateral(seg, x, z):
        (ax, az), (dx, dz), l, lane = seg; t = (x - ax) * dx + (z - az) * dz
        return t, (x - ax) * -dz + (z - az) * dx  # along, and right of travel (+)
    def fits(x, z, ux, uz):
        rx, rz = -uz, ux
        return all(at(road, x + ux * f * 2.4 + rx * g * 1.0, z + uz * f * 2.4 + rz * g * 1.0) and not at(bld, x + ux * f * 2.4 + rx * g * 1.0, z + uz * f * 2.4 + rz * g * 1.0) for f in (-1, -.5, 0, .5, 1) for g in (-1, 1))
    def lanes_clear(x, z, ux, uz):
        """No lane line of any road edge running past within 1.95 m of the car's long axis (parked-lanes.mjs keeps 1.88)."""
        for seg in segs(eg, x, z):
            (ax, az), (dx, dz), l, lane = seg
            for f in (-2.15, 0, 2.15):
                px, pz = x + ux * f, z + uz * f; t, d = lateral(seg, px, pz)
                if -1 <= t <= l + 1 and abs(d - lane) < 1.95 and abs(dx * ux + dz * uz) > .5: return False
                if -1 <= t <= l + 1 and abs(d - lane) < 1.2: return False  # a lane crossing the car at an angle
        return True
    def clear_of_junctions(x, z):
        if any(math.hypot(px - x, pz - z) < 11 for px, pz in segs(jg, x, z)): return False
        for seg in segs(xg, x, z):
            t, d = lateral(seg, x, z)
            if -4 <= t <= seg[2] + 4 and abs(d) < 5: return False  # a pedestrian crossing
        return True
    placed = defaultdict(list); WHY = defaultdict(int)
    # Street furniture standing on the ground (furniture.json: posts, racks, bins, shelters...; the lamps hung on span
    # wires are overhead): no car on one.
    stand = defaultdict(list)
    if os.path.exists(f'{OUT}/furniture.json'):
        for it in json.load(open(f'{OUT}/furniture.json', encoding='utf8'))['items']:
            if it['k'] != 'wire-lamp' and it.get('src') != 'kk-roadworks': stand[math.floor(it['x'] / 10), math.floor(it['z'] / 10)].append((it['x'], it['z'], .3 if it['k'] != 'shelter' else 2.0))
    def on_furniture(x, z, ux, uz):
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for fx, fz, r in stand[math.floor(x / 10) + i, math.floor(z / 10) + j]:
                    dx, dz = fx - x, fz - z
                    if abs(dx * ux + dz * uz) < 2.15 + r and abs(dx * uz - dz * ux) < .9 + r: return True
        return False
    def free(x, z):
        k = (math.floor(x / 10), math.floor(z / 10))
        return all(math.hypot(px - x, pz - z) >= 5.0 for i in (-1, 0, 1) for j in (-1, 0, 1) for px, pz in placed[k[0] + i, k[1] + j])
    def slot_on(P, u):
        """A car standing at the register's kerb point P (stretch direction u): on the drawn carriageway beside the edge
        it runs along, as far towards the kerb as the drawn street has room for, clear of the lanes. [x, z, yaw] or None."""
        best = None
        for seg in segs(eg, *P):
            (ax, az), (dx, dz), l, lane = seg
            if abs(dx * u[0] + dz * u[1]) < .85: continue
            t, d = lateral(seg, *P)
            if -2 <= t <= l + 2 and abs(d) < 12 and (best is None or abs(d) < abs(best[1])): best = (seg, d, t)
        if not best: WHY['no edge'] += 1; return None
        seg, d, t = best; (ax, az), (dx, dz), l, lane = seg; s = 1 if d > 0 else -1
        ux, uz = (dx, dz) if s > 0 else (-dx, -dz)  # facing the way the traffic beside it drives (right-hand)
        fx, fz = ax + dx * t, az + dz * t
        o = abs(d) + .3
        while o > 2.3:
            x, z = fx + -dz * s * o, fz + dx * s * o
            if fits(x, z, ux, uz):
                if not lanes_clear(x, z, ux, uz): WHY['lane'] += 1; return None
                if not clear_of_junctions(x, z): WHY['junction'] += 1; return None
                if on_furniture(x, z, ux, uz): WHY['furniture'] += 1; return None
                return [round(x, 2), round(z, 2), round(math.atan2(ux, uz), 3)]
            o -= .1
        WHY['no room'] += 1; return None
    cars = []; with_car = 0; tried = 0
    for sid, n, pl, name in stretches:
        r = random.Random(sid * 7919 + 13); L = sum(math.dist(a, b) for a, b in zip(pl, pl[1:]))
        step = max(5.4, L / n); k = int((L - 5.2) // step) + 1 if L >= 5.2 else 0
        if k <= 0: continue
        pad = (L - (k - 1) * step) / 2; got = 0
        for i in range(k):
            s = pad + i * step + (r.random() - .5) * .4; acc = 0
            for a, b in zip(pl, pl[1:]):
                l = math.dist(a, b)
                if s <= acc + l and l: break
                acc += l
            t = (s - acc) / l if l else 0; P = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); u = ((b[0] - a[0]) / l, (b[1] - a[1]) / l) if l else (1, 0)
            tried += 1
            if r.random() >= .86: continue  # a free space
            c = slot_on(P, u)
            if c and free(c[0], c[1]):
                placed[math.floor(c[0] / 10), math.floor(c[1] / 10)].append((c[0], c[1])); cars.append(c + [r.randrange(len(PAINT))]); got += 1
        with_car += got > 0
    print(f'{len(stretches)} parking stretches ({sum(n for _, n, _, _ in stretches)} spaces), {tried} spaces along them as parallel bays, {with_car} stretches with a car; left empty: {dict(WHY)}')
    meta = {'source': 'Kerbside parking: Københavns Kommune, Parkeringspladser (p_pladser), CC BY 4.0 (wfs-kbhkort.kk.dk)' + ('; in Frederiksberg: Frederiksberg Kommune, Parkeringspladser, CC BY 4.0 (opendata.dk/city-of-frederiksberg)' if FRB else '')}
json.dump({'paints': PAINT, **meta, 'cars': cars}, open(f'{OUT}/parked.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print('parked cars', len(cars))
