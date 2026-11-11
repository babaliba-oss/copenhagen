#!/usr/bin/env python3
"""The 1760 map checked against the buildings' real construction years (BBR).

Københavns Kommune's building layer (WFS k101:bygning_kk: GeoDanmark footprints with the BBR fields, among them
opfoerelse_aar, the year built; CC BY 4.0, containing data from GeoDanmark) dates every building standing today. Run
after the 1760 build (last, after fit-colliders and shed-colliders):

  python3 scripts/era-1760-years.py <kk data dir>/wfs/bygning_kk.json   # picks the houses, writes cities/copenhagen-1760/bbr-1760.json
  python3 scripts/era-1760-years.py --again                             # after a rebuild: the same houses, without the download
  add --dry to report only

1. Houses built 1500-1760 that the 1760 map leaves out (years before 1500 are placeholders in BBR) are taken from
   today's model (public/cities/copenhagen/buildings3d) into the 1760 tiles, in the period palette, with a collision
   footprint (fit-colliders' `model-` kind). A part of today's model is taken when 60% of its roof plan stands on
   buildings BBR dates to 1760 or earlier, the 1760 map draws (almost) nothing there, and no earlier choice took it out
   (GONE names in main.js, HIDE_1760, era.json anachronisms: those stay as they are). The National Museum's model
   (MODERN in kk-buildings.py) is Prinsens Palæ in 1760 (1684, rebuilt by Eigtved 1743-44).
2. Anachronisms (ANACHRONISMS below: what BBR dates long after 1760 and stands where the 1760 town had no house)
   join era.json's anachronisms (main.js hides them); their footprints and road walls go.
3. Operaparken (2023): its paths and pavilions' ground are the park's lawn in 1760.
A post-1760 BBR year on an old town plot is not an anachronism: the 1728 and 1795 fires rebuilt much of the centre on
the old plots, and the 1760 build restyles those houses as period houses.
"""
import sys, os, re, json, gzip, hashlib
import numpy as np
import shapely
from shapely.geometry import Polygon, shape
from shapely.strtree import STRtree

ARGS = sys.argv[1:]; DRY = '--dry' in ARGS; AGAIN = '--again' in ARGS
SRC = next((a for a in ARGS if not a.startswith('--')), None)
if not SRC and not AGAIN: sys.exit(__doc__)
T, E = 'public/cities/copenhagen/', 'public/cities/copenhagen-1760/'
PICKS = 'cities/copenhagen-1760/bbr-1760.json'
log = lambda *a: print(*a, file=sys.stderr, flush=True)
read = lambda p: (lambda r: gzip.decompress(r) if r[:2] == b'\x1f\x8b' else r)(open(p, 'rb').read())

ANACHRONISMS = {  # id: why (BBR year, what stood there in 1760)
    'kk-osm-way-28075587': 'Halvtolv, Christiania: housing of 2000-01 out on the Christianshavn ramparts',
    'kk-osm-relation-13732243': 'Gothersgade 135, Frederiksborggade 22, Linnésgade: blocks of 1875-1908 on the levelled rampart by Nørreport',
    'kk-osm-way-407543153': 'Torben Oxes Allé 3-5, Amager: a house of 1901 and its garage, out in the fields',
    'kk-osm-way-1211106912': 'Sverrigsgade 33-35, Amager: a carport and garage, out in the fields',
    'osm-relation-18181071': 'Ekvipagemestervej 14: the 2023 car park under Operaparken',
    'osm-way-1097221498': 'Ekvipagemestervej 14: Operaparken pavilion (2023)',
    'osm-way-1097221499': 'Ekvipagemestervej 14: Operaparken pavilion (2023)',
    'osm-way-1097221500': 'Ekvipagemestervej 14: Operaparken pavilion (2023)',
    'osm-way-539811461': 'Kvæsthusbroen 17: kiosk of 2016 on the rebuilt quay',
    'osm-way-539811463': 'Kvæsthusbroen: kiosk of 2016 on the rebuilt quay',
    'osm-way-539811464': 'Kvæsthusbroen 1: kiosk of 2016 on the rebuilt quay',
    'osm-way-539811468': 'Kvæsthusbroen 3: kiosk of 2016 on the rebuilt quay',
    'osm-way-539811469': 'Kvæsthusbroen 1: kiosk of 2016 on the rebuilt quay',
}
NAMES = {'Nationalmuseet': 'Prinsens Palæ'}  # today's name -> the 1760 one
COLOURS = {'Prinsens Palæ': ('#e6dcc4', '#8a3b2a')}  # plastered fronts under red tile, as the palace still is
WALLS_1760 = ['#d9b26f', '#e8d39a', '#8e3b2e', '#bdb6a6', '#ece4d0', '#d99c7f', '#a8ae96', '#a5503a', '#c99a5b', '#e3d5b8', '#b46e4f']  # kk-buildings.py
ROOFS_1760 = ['#9c4a30', '#8a3f2a', '#a85a3a', '#93442d', '#4d4f52']
pick = lambda pal, s, salt: pal[int(hashlib.md5((salt + s).encode()).hexdigest(), 16) % len(pal)]
hexrgb = lambda h: [round(int(h[i:i + 2], 16) / 255, 3) for i in (1, 3, 5)]

main = open('src/main-parts.js').read()
GONE = re.compile(re.search(r'const GONE=/(\^.*?\$)/i;', main).group(1), re.I)
HIDE = set(json.loads(re.search(r'export const HIDE_1760=(\[.*?\]);', open('src/copenhagen/landmarks.js').read()).group(1).replace("'", '"')))
ERA_TXT = open(E + 'era.json').read(); era = json.loads(ERA_TXT)
late = set(era.get('anachronisms', [])) | set(ANACHRONISMS)

def poly(rings):
    try:
        g = shapely.make_valid(Polygon(rings[0], [h for h in rings[1:] if len(h) > 2]))
        return None if g.is_empty else g
    except Exception: return None

def parts_of(root, hidden):  # (tile, part, roof plan, triangles) of every part
    idx = json.load(open(root + 'buildings3d-index.json')); out = []
    for t in idx['tiles']:
        arr = np.frombuffer(read(root + t['file']), dtype=np.float32).reshape(-1, 5)
        for p in t['parts']:
            V = arr[p['start']:p['start'] + p['count']]
            P = V[:len(V) // 3 * 3, :3].astype(np.float64).reshape(-1, 3, 3)
            n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); l = np.linalg.norm(n, axis=1) + 1e-12
            a2 = np.abs((P[:, 1, 0] - P[:, 0, 0]) * (P[:, 2, 2] - P[:, 0, 2]) - (P[:, 1, 2] - P[:, 0, 2]) * (P[:, 2, 0] - P[:, 0, 0]))
            R = P[(np.abs(n[:, 1] / l) >= .3) & (a2 > 1e-4)][:, :, [0, 2]]
            plan = shapely.union_all(shapely.polygons(np.concatenate([R, R[:, :1]], axis=1)), grid_size=.01) if len(R) else None
            out.append(dict(t=t, p=p, plan=plan if plan is not None and plan.area >= 2 else None, V=V, hidden=hidden(t, p)))
    return idx, out

dup_e = set(json.load(open(E + 'duplicates.json'))); dup_t = set(json.load(open(T + 'duplicates.json')))
idx_e, parts_e = parts_of(E, lambda t, p: f"{t['file']}:{p['start']}" in dup_e or p['id'] in late or p['id'] in HIDE or bool(GONE.search(p.get('name') or '')))
ids_e = {q['p']['id'] for q in parts_e}
seen = [q['plan'] for q in parts_e if q['plan'] is not None and not q['hidden']]; seen_tree = STRtree(seen)
city = json.loads(read(E + 'city.pack'))

# ---- 1. pre-1760 houses the map leaves out ----
if AGAIN:
    picks = json.load(open(PICKS))['houses']
else:
    from pyproj import Transformer
    reg = next(c for c in json.load(open('public/cities/index.json'))['cities'] if c['id'] == 'copenhagen-1760')
    fwd = Transformer.from_crs('EPSG:4326', reg['projection'], always_xy=True)
    old = []
    for f in json.load(open(SRC))['features']:
        q = f['properties']; y = q.get('opfoerelse_aar')
        if not y or not 1500 <= y <= 1760 or q.get('objekt_status') == 'Under nedlæggelse' or not f['geometry']: continue
        g = shapely.transform(shapely.make_valid(shape(f['geometry'])), lambda c: (lambda X, Y: np.stack([X, -np.asarray(Y)], 1))(*fwd.transform(c[:, 0], c[:, 1])))
        if g.area >= 15: old.append((g, y, f"{q.get('vejnavn') or ''} {q.get('hus_nr') or ''}".strip()))
    log(len(old), 'buildings BBR dates 1500-1760')
    old_tree = STRtree([g for g, _, _ in old])
    _, parts_t = parts_of(T, lambda t, p: f"{t['file']}:{p['start']}" in dup_t)
    picks = []
    for q in parts_t:
        p, plan = q['p'], q['plan']
        if q["hidden"] or plan is None or plan.area < 10 or p['id'] in ids_e or p['id'] in late or p['id'] in HIDE or GONE.search(p.get('name') or ''): continue
        near = old_tree.query(plan)
        if not len(near): continue
        on = [i for i in near if old[i][0].intersection(plan).area > 1]
        if not on or shapely.union_all([old[i][0] for i in on]).intersection(plan).area < .6 * plan.area: continue
        drawn = seen_tree.query(plan)
        if len(drawn) and shapely.union_all([seen[i] for i in drawn]).intersection(plan).area > .2 * plan.area: continue
        picks.append({'id': p['id'], 'name': NAMES.get(p.get('name') or '', p.get('name') or ''), 'years': sorted({old[i][1] for i in on}),
                      'address': sorted({old[i][2] for i in on})[:4], 'm2': round(plan.area)})
    if not DRY:
        json.dump({'source': 'Københavns Kommune, WFS k101:bygning_kk (GeoDanmark footprints, BBR opfoerelse_aar), CC BY 4.0, containing data from GeoDanmark',
                   'note': "today's model houses on buildings BBR dates 1500-1760 that the 1760 build left out (scripts/era-1760-years.py)",
                   'houses': picks}, open(PICKS, 'w'), ensure_ascii=False, indent=0)
log(len(picks), 'pre-1760 houses to add:', ', '.join(f"{h['id']} {h['name']} {h['years']} {h['m2']} m2" for h in picks))

todo = [h for h in picks if h['id'] not in ids_e]
if todo:
    want = {h['id']: h for h in todo}; got = {}
    for t in json.load(open(T + 'buildings3d-index.json'))['tiles']:
        hit = [p for p in t['parts'] if p['id'] in want]
        if hit:
            arr = np.frombuffer(read(T + t['file']), dtype=np.float32).reshape(-1, 5)
            for p in hit: got[p['id']] = (p, arr[p['start']:p['start'] + p['count']].copy())
    tiles = {t['file']: t for t in idx_e['tiles']}; centre = lambda b: ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    append = {}
    for i, (pid, (p, V)) in enumerate(got.items()):
        cx, cz = centre(p['bbox'])
        t = min(idx_e['tiles'], key=lambda t: (centre(t['bbox'])[0] - cx) ** 2 + (centre(t['bbox'])[1] - cz) ** 2)
        h = float(p.get('height') or 10)
        q = {'id': pid, 'abs': 1, 'bbox': p['bbox'], 'height': p['height'], 'texture': None,
             'color': hexrgb(pick(WALLS_1760, pid, 'w')), 'roofColor': hexrgb(pick(ROOFS_1760, pid, 'r') if h < 24 else '#6f8f7a'),
             'count': len(V), 'address': '', 'name': want[pid]['name'], 'year': min(want[pid]['years'])}
        append.setdefault(t['file'], []).append((q, V))
    for file, items in append.items():
        t = tiles[file]; arr = np.frombuffer(read(E + file), dtype=np.float32).reshape(-1, 5)
        for q, V in items:
            q['start'] = len(arr); arr = np.concatenate([arr, V]); t['parts'].append(q)
            b = t['bbox']; t['bbox'] = [min(b[0], q['bbox'][0]), min(b[1], q['bbox'][1]), max(b[2], q['bbox'][2]), max(b[3], q['bbox'][3])]
        if not DRY: open(E + file, 'wb').write(gzip.compress(arr.astype(np.float32).tobytes(), 9, mtime=0))
    if not DRY: json.dump(idx_e, open(E + 'buildings3d-index.json', 'w'))
    log(len(got), 'houses added to', len(append), 'tiles', '' if len(got) == len(todo) else f'({len(todo) - len(got)} not in today\'s model)')
    # their footprints: the roof plan 0.3 m in from the eaves, minus other footprints and the carriageway (fit-colliders.py)
    feet = [g for g in (poly(b['rings']) for b in city['buildings']) if g is not None]; ftree = STRtree(feet)
    roads = [g for g in (poly(r['rings']) for r in city['roads'] if 'Koroke' not in (r.get('kind') or '')) if g is not None]; rtree = STRtree(roads)
    added = []
    for pid, (p, V) in got.items():
        P = V[:len(V) // 3 * 3, :3].astype(np.float64).reshape(-1, 3, 3)
        n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); l = np.linalg.norm(n, axis=1) + 1e-12
        a2 = np.abs((P[:, 1, 0] - P[:, 0, 0]) * (P[:, 2, 2] - P[:, 0, 2]) - (P[:, 1, 2] - P[:, 0, 2]) * (P[:, 2, 0] - P[:, 0, 0]))
        R = P[(np.abs(n[:, 1] / l) >= .3) & (a2 > 1e-4)][:, :, [0, 2]]
        if not len(R): continue
        rest = shapely.union_all(shapely.polygons(np.concatenate([R, R[:, :1]], axis=1)), grid_size=.01).buffer(-.3, join_style='mitre')
        for tree, geoms in ((ftree, feet), (rtree, roads)):
            near = tree.query(rest)
            if len(near) and not rest.is_empty: rest = rest.difference(shapely.union_all([geoms[i] for i in near]))
        rest = rest.buffer(-.45, join_style='mitre').buffer(.45, join_style='mitre')
        for k, g in enumerate(getattr(rest, 'geoms', [rest])):
            if g.is_empty or g.geom_type != 'Polygon' or g.area < 20: continue
            g = g.simplify(.15)
            if g.is_empty or g.geom_type != 'Polygon': continue
            x0, z0, x1, z1 = g.bounds
            added.append({'id': f'model-{pid}-{k}', 'name': '', 'address': '', 'rings': [[[round(x, 2), round(z, 2)] for x, z in g.exterior.coords[:-1]]] + [[[round(x, 2), round(z, 2)] for x, z in r.coords[:-1]] for r in g.interiors],
                          'bbox': [round(x0, 2), round(z0, 2), round(x1, 2), round(z1, 2)], 'kind': 'model', 'material': '', 'height': round(float(p.get('height') or 10), 2), 'cover': 1.0})
    city['buildings'] += added
    log(len(added), 'footprints added (', round(sum(Polygon(a['rings'][0]).area for a in added)), 'm2 )')
    # trees and lanterns that now stand inside them
    inside = shapely.union_all([poly(a['rings']) for a in added]) if added else None
    if inside is not None:
        n0 = len(city['trees']); city['trees'] = [t for t in city['trees'] if not inside.contains(shapely.Point(t['p']))]
        fur = json.load(open(E + 'furniture.json')); m0 = len(fur['items'])
        fur['items'] = [i for i in fur['items'] if not inside.contains(shapely.Point(i['x'], i['z']))]
        log(n0 - len(city['trees']), 'trees and', m0 - len(fur['items']), 'lanterns inside them removed')
        if m0 != len(fur['items']) and not DRY:
            fur['counts'] = {k: sum(i['k'] == k for i in fur['items']) for k in fur['counts']}
            json.dump(fur, open(E + 'furniture.json', 'w'), separators=(',', ':'), ensure_ascii=False)

coloured = 0
for t in idx_e['tiles']:
    for q in t['parts']:
        if q['id'] in {h['id'] for h in picks} and q.get('name') in COLOURS:
            c = [hexrgb(h) for h in COLOURS[q['name']]]
            if [q['color'], q['roofColor']] != c: q['color'], q['roofColor'] = c; coloured += 1
if coloured and not DRY: json.dump(idx_e, open(E + 'buildings3d-index.json', 'w'))

# ---- 2. anachronisms ----
new_late = [i for i in ANACHRONISMS if i not in era.get('anachronisms', []) and i in ids_e]
if new_late and not DRY:
    m = re.search(r'"anachronisms":\[(.*?)\]', ERA_TXT, re.S)
    body = m.group(1) + ''.join((',' if m.group(1).strip() or k else '') + json.dumps(i) for k, i in enumerate(new_late))
    open(E + 'era.json', 'w').write(ERA_TXT[:m.start(1)] + body + ERA_TXT[m.end(1):])
log(len(new_late), 'anachronisms added to era.json', new_late)
gone_plans = [q['plan'] for q in parts_e if q['p']['id'] in ANACHRONISMS and q['plan'] is not None]
if gone_plans:
    gp = shapely.union_all(gone_plans); kept = []; dropped = 0
    for b in city['buildings']:
        g = poly(b['rings'])
        if g is not None and g.area > 0 and g.intersection(gp).area > .5 * g.area:
            near = seen_tree.query(g); vis = shapely.union_all([seen[i] for i in near]).intersection(g).area if len(near) else 0
            if vis < .5 * g.area: dropped += 1; continue
        kept.append(b)
    city['buildings'] = kept
    walls = json.load(open(E + 'road-walls.json')); w0 = len(walls); walls = [w for w in walls if w['id'] not in ANACHRONISMS]
    if w0 != len(walls) and not DRY: json.dump(walls, open(E + 'road-walls.json', 'w'), separators=(',', ':'))
    log(dropped, 'footprints and', w0 - len(walls), 'road walls of the anachronisms removed')

# ---- 3. Operaparken (2023): paths and pavilion ground become its lawn ----
park = next((p for p in city['parks'] if p.get('name') == 'Operaparken'), None)
if park:
    pg = poly(park['rings']); n_pv = len(city['pavement'])
    city['pavement'] = [p for p in city['pavement'] if not ((g := poly(p['rings'])) is not None and g.area > 0 and g.intersection(pg).area > .5 * g.area)]
    index = json.load(open(E + 'surface-index.json')); recoloured = 0
    for rec in index:
        b = rec['bbox']; x0, z0, x1, z1 = pg.bounds
        if b[2] < x0 or b[0] > x1 or b[3] < z0 or b[1] > z1: continue
        v = np.frombuffer(read(E + rec['file'] + '.pack'), dtype=np.float32).reshape(-1, 3, 6).copy()
        c = v[:, :, [0, 2]].mean(1); inp = shapely.contains_xy(pg, c[:, 0], c[:, 1])
        lawn = inp & np.isclose(v[:, 0, 1], .025)
        if not lawn.any(): continue
        grass = v[lawn][0, 0, 3:].copy()
        hard = inp & (np.isclose(v[:, 0, 1], .05) | np.isclose(v[:, 0, 1], .085))
        if hard.any():
            v[hard, :, 1] = .025; v[hard, :, 3:] = grass; recoloured += int(hard.sum())
            if not DRY: open(E + rec['file'] + '.pack', 'wb').write(gzip.compress(v.reshape(-1).astype(np.float32).tobytes(), 9, mtime=0))
    log('Operaparken:', n_pv - len(city['pavement']), 'path pieces out of city.pack,', recoloured, 'surface triangles laid as lawn')

if not DRY:
    open(E + 'city.pack', 'wb').write(gzip.compress(json.dumps(city, separators=(',', ':'), ensure_ascii=False).encode(), 9, mtime=0))
    log('wrote', E + 'city.pack')
