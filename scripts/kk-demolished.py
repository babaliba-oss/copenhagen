#!/usr/bin/env python3
"""Houses the 2013 city model has that have been demolished since (today's Copenhagen).

The model-only houses ("kk-<x>-<z>" parts: model faces with no OpenStreetMap footprint, scripts/kk-buildings.py) come
from the municipal 3D model of 2013. Some were pulled down after it was surveyed (the Botanical Garden's old research
glasshouses, sheds and halls on Carlsberg, Nordhavn and the Sydhavn quays, back houses cleared for new blocks): they
stood in the game on what is now a square, a lawn, a car park or a street. This compares each model-only house's roof
plan, piece by piece, with the buildings GeoDanmark has today (Københavns Kommune WFS layer k101:bygning, GeoJSON in
EPSG:4326, every status): a piece of at least 50 m² that the current buildings cover by less than 10% is taken out,
with its walls. A house with other pieces still standing keeps those.

Left in place, because GeoDanmark does not register them as buildings, so their absence there says nothing:
 - strips under 3 m wide (bicycle sheds and canopies along a wall, a glazed link between two halls);
 - pieces standing open, with no wall down to the ground and no house beside them along 40% of their outline
   (decks and piers over the water, the model's stray sheets), and pieces over a street or the water walled down to
   the ground along under a quarter of their outline (a skyway between two blocks).

  python3 scripts/kk-demolished.py <bygning.json> [copenhagen] [--dry]
  python3 scripts/kk-demolished.py --again [copenhagen]      (after a rebuild of the tiles: the pieces in
                                                            cities/<city>/demolished.json, no WFS download needed)

It edits the built tiles in place (no rebuild from the DXF):
 - the pieces' triangles leave the tile packs (buildings3d/*.pack; the index's starts shift, the file:start keys in
   duplicates.json, insets.json and recolour.json are remapped);
 - a neighbouring house the piece was joined to (a block is one mesh in the model: their party wall was never
   modelled, and a step wall belongs to the taller house) gets a wall wherever its roof edge or wall bottom now hangs
   over open ground, down to the next surface below or into the ground, as kk-buildings.py closes the houses an era
   leaves out;
 - their collision goes: kk-footprints.json, and the `model-<id>-<k>` footprints fit-colliders.py gave them in
   city.pack (and their entries in collision-trim.json), with the pale ground pad (surfaces/, 8.5 cm) drawn under those footprints.
The pieces removed are written to cities/<city>/demolished.json. Then rerun (they read the tiles and footprints):
  node scripts/road-walls.mjs copenhagen && node scripts/indoor-items.mjs copenhagen && python3 scripts/surface-fill.py copenhagen
Rerunnable: a second run finds nothing left to remove.
"""
import gzip, json, math, os, re, sys
import numpy as np
import shapely
from shapely.geometry import Polygon, LineString
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrain_field import load_ground, collapsed

args = [a for a in sys.argv[1:] if not a.startswith('--')]
AGAIN = '--again' in sys.argv; DRY = '--dry' in sys.argv
BYG = None if AGAIN else args.pop(0)
CITY = args[0] if args else 'copenhagen'
assert not CITY.endswith('1760'), 'today only: 1760 keeps the model as it is'
root = f'public/cities/{CITY}/'
LIST = f'cities/{CITY}/demolished.json'
MIN_AREA, MAX_COVER = 50, .10      # a piece of at least 50 m2 with under 10% of it under a current building
MIN_WIDTH, MAX_OPEN = 3.0, .4      # left in place: strips under 3 m wide, pieces open on 40% of their outline,
MIN_GROUNDED = .25                 # and pieces over the street or water with walls down to the ground on under 25% of it
log = lambda *a: print(*a, file=sys.stderr, flush=True)
reg = next(c for c in json.load(open('public/cities/index.json'))['cities'] if c['id'] == CITY)
ground_at = load_ground(root)

def read(path):
    raw = open(path, 'rb').read()
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
idx = json.load(open(root + 'buildings3d-index.json'))
pack = json.loads(read(root + 'city.pack'))
def keys_file(name, default):
    return json.load(open(root + name)) if os.path.exists(root + name) else default
dups = set(keys_file('duplicates.json', []))

# --- what stands today ---
if AGAIN:
    prev = json.load(open(LIST))
    old = [shapely.make_valid(Polygon(p['ring'])) for p in prev['pieces']]
    old_tree = shapely.STRtree(old)
    log(len(old), 'pieces listed in', LIST)
else:
    from pyproj import Transformer
    to_local = Transformer.from_crs('EPSG:4326', reg['projection'], always_xy=True)
    lim = json.load(open(f'cities/{CITY}/city.json'))['radiusMetres'] * 1.3 + 500
    cur = []
    for f in json.load(open(BYG))['features']:
        geom = f.get('geometry')
        if not geom: continue
        for poly in (geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]):
            rings = []
            for r in poly:
                a = np.asarray(r, np.float64)[:, :2]; x, y = to_local.transform(a[:, 0], a[:, 1])
                rings.append(np.stack([x, -np.asarray(y)], 1))  # game z = -north
            if np.abs(rings[0]).max() > lim: continue
            g = shapely.make_valid(Polygon(rings[0], rings[1:]))
            if not g.is_empty and g.area > 0: cur.append(g)
    cur_tree = shapely.STRtree(cur)
    log(len(cur), 'current buildings (GeoDanmark) in the extent')

def polys(items):
    out = []
    for f in items:
        r = [q for q in (f.get('rings') or []) if len(q) > 2]
        if r:
            g = shapely.make_valid(Polygon(r[0], r[1:]))
            if not g.is_empty: out.append(g)
    return out
street_plan = shapely.union_all(polys(pack['roads']) + polys(pack['pavement']) + polys(pack['water'])); shapely.prepare(street_plan)
MODEL_ONLY = re.compile(r'^kk-(?!osm-)')
tiles = [np.frombuffer(read(root + t['file']), np.float32).reshape(-1, 5) for t in idx['tiles']]
def tri_of(ti, p):
    v = tiles[ti][p['start']:p['start'] + p['count'], :3].astype(np.float64)
    return v[:len(v) // 3 * 3].reshape(-1, 3, 3)
def normals(tri):
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); l = np.linalg.norm(n, axis=1)
    return n / np.maximum(l, 1e-12)[:, None], l
def parts_near(x0, z0, x1, z1, pad=2.0):
    for ti, t in enumerate(idx['tiles']):
        b = t['bbox']
        if b[0] > x1 + pad or b[2] < x0 - pad or b[1] > z1 + pad or b[3] < z0 - pad: continue
        for pi, p in enumerate(t['parts']):
            q = p['bbox']
            if q[0] > x1 + pad or q[2] < x0 - pad or q[1] > z1 + pad or q[3] < z0 - pad: continue
            if f"{t['file']}:{p['start']}" in dups: continue
            yield ti, pi, p

def openness(g, mine, others):
    """Share of the piece's outline with neither a wall of its own reaching down to the ground (1.5 m) nor another
    house's surface within 0.6 m in plan; and the share with a wall of its own down to the ground."""
    segs = []
    if len(mine):
        n, _ = normals(mine)
        for T in mine[np.abs(n[:, 1]) < .3]:
            lo = np.flatnonzero(T[:, 1] - ground_at(T[:, 0], T[:, 2]) < 1.5)
            if len(lo) >= 2 and np.hypot(*(T[lo[0], [0, 2]] - T[lo[1], [0, 2]])) > .01: segs.append(LineString(T[lo[:2]][:, [0, 2]]))
    walls = shapely.union_all(segs).buffer(.6) if segs else Polygon()
    near = Polygon()
    if len(others):
        flat = shapely.polygons(np.concatenate([others[:, :, [0, 2]], others[:, :1, [0, 2]]], 1))
        shapes = []
        for q, T in zip(flat, others):
            if shapely.area(q) > 1e-3: shapes.append(q.buffer(.6))
            else:
                u = np.unique(np.round(T[:, [0, 2]], 3), axis=0)
                if len(u) > 1: shapes.append(LineString(u[[0, -1]]).buffer(.6))
        near = shapely.union_all(shapes) if shapes else Polygon()
    ring = g.exterior; L = ring.length; n_ = max(4, int(L))
    pts = shapely.points([ring.interpolate(k * L / n_).coords[0] for k in range(n_)])
    a, b = shapely.intersects(walls, pts), shapely.intersects(near, pts)
    return float((~a & ~b).mean()), float(a.mean())

# --- pieces of each model-only house: the connected parts of its roof plan ---
gone = {}     # (tile, part) -> triangle mask to drop
removed, kept_back = [], []
for ti, t in enumerate(idx['tiles']):
    for pi, p in enumerate(t['parts']):
        if not MODEL_ONLY.match(p['id']) or f"{t['file']}:{p['start']}" in dups: continue
        tri = tri_of(ti, p)
        if not len(tri): continue
        n, l = normals(tri)
        roof = (l > 1e-6) & (np.abs(n[:, 1]) > .35) & ~collapsed(tri, ground_at)
        if not roof.any(): continue
        if AGAIN:  # only parts under a listed piece are looked at closely
            x0, z0 = tri[roof][:, :, [0, 2]].min((0, 1)); x1, z1 = tri[roof][:, :, [0, 2]].max((0, 1))
            if not len(old_tree.query(shapely.box(x0, z0, x1, z1))): continue
        plan = shapely.union_all([q.buffer(.02) for q in shapely.polygons(tri[roof][:, :, [0, 2]]) if q.area > 1e-4]).buffer(-.02)
        pieces = [g for g in getattr(plan, 'geoms', [plan]) if g.geom_type == 'Polygon' and g.area > 1]
        out = []
        for k, g in enumerate(pieces):
            if g.area < MIN_AREA: continue
            if AGAIN:
                hit = old_tree.query(g)
                if len(hit) and shapely.union_all([old[i].intersection(g) for i in hit]).area >= .5 * g.area: out.append((k, g, None))
                continue
            near = cur_tree.query(g)
            cover = shapely.union_all([cur[i].intersection(g) for i in near]).area / g.area if len(near) else 0.0
            if cover < MAX_COVER: out.append((k, g, cover))
        if not out: continue
        # every triangle goes with the piece of the house nearest to it (walls stand on a piece's edge)
        cen = shapely.points(tri[:, :, [0, 2]].mean(1))
        owner = np.stack([shapely.distance(g, cen) for g in pieces], 1).argmin(1)
        drop = np.zeros(len(tri), bool)
        for k, g, cover in out:
            rec = dict(id=p['id'], area=round(g.area), height=p.get('height'), x=round(g.centroid.x, 1), z=round(g.centroid.y, 1))
            if cover is not None: rec['cover'] = round(cover, 3)
            if not AGAIN:
                width = 2 * shapely.maximum_inscribed_circle(g).length
                if width < MIN_WIDTH: kept_back.append({**rec, 'why': f'strip {width:.1f} m wide'}); continue
                x0, z0, x1, z1 = g.bounds
                others = [tri_of(tj, q) for tj, pj, q in parts_near(x0, z0, x1, z1) if (tj, pj) != (ti, pi)]
                others = np.concatenate(others + [tri[owner != k]]) if others else tri[owner != k]
                if len(others): others = others[~collapsed(others, ground_at)]
                op, grounded = openness(g, tri[(owner == k)], others)
                if op >= MAX_OPEN: kept_back.append({**rec, 'why': f'open on {op:.0%} of its outline'}); continue
                street = shapely.intersection(g, street_plan).area / g.area
                if grounded < MIN_GROUNDED and street >= .3:
                    kept_back.append({**rec, 'why': f'lifted ({grounded:.0%} of its outline walled to the ground) over {street:.0%} street or water'}); continue
                rec['open'] = round(op, 2); rec['grounded'] = round(grounded, 2); rec['street'] = round(street, 2)
            drop |= owner == k
            removed.append({**rec, 'tile': t['file'], 'ring': [[round(x, 2), round(z, 2)] for x, z in g.exterior.coords[:-1]]})
        if drop.any(): gone[(ti, pi)] = drop
log(len(removed), 'pieces of', len({r['id'] for r in removed}), 'model-only houses gone,', round(sum(r['area'] for r in removed)), 'm²;',
    len(kept_back), 'left in place (', round(sum(r['area'] for r in kept_back)), 'm² )')
if DRY:
    print(json.dumps({'removed': sorted(removed, key=lambda r: -r['area']), 'kept': sorted(kept_back, key=lambda r: -r['area'])}, ensure_ascii=False, indent=0))
    sys.exit()
if not removed:
    log('nothing to remove'); sys.exit()
gone_plan = shapely.union_all([Polygon(r['ring']).buffer(0) for r in removed])
shapely.prepare(gone_plan)
gone_near = gone_plan.buffer(3); shapely.prepare(gone_near)  # where neighbours can have been joined to them
def near_gone(P): return gone_near.intersects(shapely.box(*P[:, :, [0, 2]].min((0, 1)), *P[:, :, [0, 2]].max((0, 1))))

# --- the neighbours: close what now hangs over open ground ---
# Every triangle left standing near the removed pieces (all parts, as drawn), and the removed ones.
rx0, rz0, rx1, rz1 = gone_plan.bounds
rest, rest_at, cut, n_rest = [], {}, [], 0
for ti, t in enumerate(idx['tiles']):
    for pi, p in enumerate(t['parts']):
        if f"{t['file']}:{p['start']}" in dups: continue
        tri = tri_of(ti, p)
        if not len(tri): continue
        if (ti, pi) in gone:
            cut.append(tri[gone[(ti, pi)]]); tri = tri[~gone[(ti, pi)]]
        if not len(tri) or not near_gone(tri): continue
        rest.append(tri); rest_at[(ti, pi)] = slice(n_rest, n_rest + len(tri)); n_rest += len(tri)
REST = np.concatenate(rest); CUT = np.concatenate(cut)
log(len(CUT), 'triangles removed')
CELL = 2.0
def build_hash(x0, z0, x1, z1):  # every 2 m cell of each triangle's box -> triangle number (sorted by cell)
    c0x, c0z = np.floor(x0 / CELL).astype(np.int64), np.floor(z0 / CELL).astype(np.int64)
    nx, nz = np.floor(x1 / CELL).astype(np.int64) - c0x + 1, np.floor(z1 / CELL).astype(np.int64) - c0z + 1
    big = nx * nz > 400; nx[big] = nz[big] = 1  # the model's stray sheets hundreds of metres long: their first cell only
    cnt = nx * nz; start = np.concatenate([[0], np.cumsum(cnt)[:-1]]); rep = np.repeat(np.arange(len(x0)), cnt); off = np.arange(cnt.sum()) - start[rep]
    keys = (c0x[rep] + off % nx[rep] + 10000) * 100000 + (c0z[rep] + off // nx[rep] + 10000)
    o = np.argsort(keys, kind='stable'); return keys[o], rep[o]
def lookup(H, x, z):
    k = (math.floor(x / CELL) + 10000) * 100000 + (math.floor(z / CELL) + 10000)
    lo, hi = np.searchsorted(H[0], k), np.searchsorted(H[0], k, side='right'); return H[1][lo:hi]
RN, _ = normals(REST); RROOF = np.abs(RN[:, 1]) >= .3
RH = build_hash(REST[:, :, 0].min(1), REST[:, :, 2].min(1), REST[:, :, 0].max(1), REST[:, :, 2].max(1))
CH = build_hash(CUT[:, :, 0].min(1), CUT[:, :, 2].min(1), CUT[:, :, 0].max(1), CUT[:, :, 2].max(1))
def seg_dist(P, A, B):  # distance of point P to segments A-B (arrays)
    AB = B - A; L2 = np.einsum('ij,ij->i', AB, AB) + 1e-12
    u = np.clip(np.einsum('ij,ij->i', P - A, AB) / L2, 0, 1); return np.linalg.norm(P - (A + u[:, None] * AB), axis=1)
def on_removed_edge(P):  # P lies on an edge of a removed triangle (they were one mesh)
    c = lookup(CH, P[0], P[2])
    if not len(c): return False
    T = CUT[c]
    return bool(min(seg_dist(P, T[:, a], T[:, (a + 1) % 3]).min() for a in range(3)) < .05)
def roof_heights(x, z):  # heights of the remaining roofs over (x, z)
    c = lookup(RH, x, z); c = c[RROOF[c]]
    if not len(c): return np.zeros(0)
    A, B, C = REST[c, 0], REST[c, 1], REST[c, 2]
    v0x, v0z, v1x, v1z = B[:, 0] - A[:, 0], B[:, 2] - A[:, 2], C[:, 0] - A[:, 0], C[:, 2] - A[:, 2]
    px, pz = x - A[:, 0], z - A[:, 2]; den = v0x * v1z - v1x * v0z; den = np.where(np.abs(den) < 1e-9, 1e-9, den)
    u = (px * v1z - v1x * pz) / den; v = (v0x * pz - px * v0z) / den
    inside = (u >= -1e-3) & (v >= -1e-3) & (u + v <= 1 + 1e-3)
    return (A[:, 1] + u * (B[:, 1] - A[:, 1]) + v * (C[:, 1] - A[:, 1]))[inside]
def on_wall_edge(M, d, below):  # a remaining wall edge runs through M along d (below: a wall reaching down from there)
    c = lookup(RH, M[0], M[2]); c = c[~RROOF[c]]
    if not len(c): return False
    for a in range(3):
        A, B, C = REST[c, a], REST[c, (a + 1) % 3], REST[c, (a + 2) % 3]
        AB = B - A; L = np.linalg.norm(AB, axis=1) + 1e-12
        ok = (seg_dist(M, A, B) < .05) & (np.abs(AB @ d) / L > .97)
        if below: ok &= C[:, 1] < M[1] - .05
        if ok.any(): return True
    return False

added = {}  # (tile, part) -> list of triangles
for (ti, pi), sl in rest_at.items():
    p = idx['tiles'][ti]['parts'][pi]
    if not p['id'].startswith('kk-'): continue  # OpenStreetMap boxes are closed shells of their own
    P = REST[sl]
    keys = np.round(P * 50).astype(np.int64)
    cnt = {}
    for t in range(len(P)):
        for a in range(3):
            ka, kb = tuple(keys[t, a]), tuple(keys[t, (a + 1) % 3]); k_ = (ka, kb) if ka < kb else (kb, ka); cnt[k_] = cnt.get(k_, 0) + 1
    n, _ = normals(P); isw = np.abs(n[:, 1]) < .3
    add = []
    for t in range(len(P)):
        for a in range(3):
            ka, kb = tuple(keys[t, a]), tuple(keys[t, (a + 1) % 3])
            if cnt[(ka, kb) if ka < kb else (kb, ka)] != 1: continue
            A, B, C = P[t, a], P[t, (a + 1) % 3], P[t, (a + 2) % 3]
            dx, dz = B[0] - A[0], B[2] - A[2]; L = math.hypot(dx, dz)
            if L < .3: continue  # vertical edges: the roof edge above closes the side
            if isw[t] and C[1] < max(A[1], B[1]) - .05: continue  # walls: only a bottom edge can hang
            if not on_removed_edge((A + B) / 2) and not on_removed_edge(A) and not on_removed_edge(B): continue
            ox, oz = dz / L, -dx / L
            if (C[0] - (A[0] + B[0]) / 2) * ox + (C[2] - (A[2] + B[2]) / 2) * oz > 0: ox, oz = -ox, -oz  # away from the triangle
            d = (B - A) / np.linalg.norm(B - A); m = max(1, int(round(L))); run = None
            for k in range(m + 1):
                piece = None
                if k < m:
                    A1, B1 = A + (B - A) * (k / m), A + (B - A) * ((k + 1) / m); M = (A1 + B1) / 2; y = M[1]
                    gr = float(ground_at(M[0], M[2]))
                    if y > gr + .4 and on_removed_edge(M) and not on_wall_edge(M, d, bool(isw[t])):  # joined to a removed piece here
                        hs = np.concatenate([roof_heights(M[0] + ox * .3, M[2] + oz * .3), roof_heights(M[0] - ox * .3, M[2] - oz * .3)]) if isw[t] else roof_heights(M[0] + ox * .3, M[2] + oz * .3)
                        if not hs[(hs >= y - .4) & (hs <= y + .4)].size:  # nothing carries on at this height
                            below = hs[hs < y - .4]
                            bottom = below.max() - .1 if below.size and below.max() > gr + .4 else gr - .5  # the foot reaches into the ground
                            if y - bottom >= .3: piece = (A1, B1, round(float(bottom), 2))
                if run and piece and abs(run[2] - piece[2]) < .05 and np.allclose(run[1], piece[0]): run = (run[0], piece[1], run[2])
                else:
                    if run:
                        A1_, B1_, bot = run; Ad, Bd = A1_.copy(), B1_.copy(); Ad[1] = Bd[1] = bot
                        add += [np.array([A1_, B1_, Bd]), np.array([A1_, Bd, Ad])]
                    run = piece
    if add: added[(ti, pi)] = add
log(len(added), 'neighbouring houses closed where they were joined to a removed piece,', sum(len(v) for v in added.values()), 'triangles added')

# --- rewrite the tiles ---
def uv_of(P):  # UVs in metres as kk-buildings.py writes them (walls: along the wall / up; roofs: plan)
    n, _ = normals(P); isw = (np.abs(n[:, 1]) < .3)[:, None]
    hl = np.hypot(n[:, 0], n[:, 2]) + 1e-12; ux, uz = -n[:, 2] / hl, n[:, 0] / hl
    uv = np.zeros(P.shape[:2] + (2,))
    uv[:, :, 0] = np.where(isw, (P[:, :, 0] * ux[:, None] + P[:, :, 2] * uz[:, None]) / 3.2, P[:, :, 0] / 3.2)
    uv[:, :, 1] = np.where(isw, P[:, :, 1] / 3.2, P[:, :, 2] / 3.2)
    return uv
remap, dropped_parts, changed_tiles = {}, set(), set()
for ti, t in enumerate(idx['tiles']):
    if not any((ti, pi) in gone or (ti, pi) in added for pi in range(len(t['parts']))): continue
    a = tiles[ti]; chunks, parts, s = [], [], 0
    for pi, p in enumerate(t['parts']):
        V = a[p['start']:p['start'] + p['count']]
        q = dict(p)
        if (ti, pi) in gone or (ti, pi) in added:
            keep = V.reshape(-1, 3, 5)
            if (ti, pi) in gone: keep = keep[~gone[(ti, pi)]]
            if (ti, pi) in added:
                W = np.array(added[(ti, pi)]); keep = np.concatenate([keep, np.concatenate([W, uv_of(W)], 2).astype(np.float32)])
            V = keep.reshape(-1, 5)
            if not len(V): dropped_parts.add(f"{t['file']}:{p['start']}"); continue
            q['bbox'] = [round(float(V[:, 0].min()), 2), round(float(V[:, 2].min()), 2), round(float(V[:, 0].max()), 2), round(float(V[:, 2].max()), 2)]
            top_was = float(a[p['start']:p['start'] + p['count'], 1].max())
            q['height'] = round(float(p.get('height') or 0) - (top_was - float(V[:, 1].max())), 2)
        remap[f"{t['file']}:{p['start']}"] = f"{t['file']}:{s}"
        q['start'] = s; q['count'] = len(V); s += len(V); chunks.append(V); parts.append(q)
    t['parts'] = parts; changed_tiles.add(ti)
    if parts:
        t['bbox'] = [min(q['bbox'][0] for q in parts), min(q['bbox'][1] for q in parts), max(q['bbox'][2] for q in parts), max(q['bbox'][3] for q in parts)]
    tiles[ti] = np.concatenate(chunks).astype(np.float32) if chunks else np.zeros((0, 5), np.float32)
log(len(dropped_parts), 'model-only houses gone entirely,', len(changed_tiles), 'tiles rewritten')
for ti in sorted(changed_tiles):
    t = idx['tiles'][ti]
    open(root + t['file'], 'wb').write(gzip.compress(tiles[ti].tobytes(), 9, mtime=0))
empty = [t for t in idx['tiles'] if not t['parts']]
for t in empty: os.remove(root + t['file'])
idx['tiles'] = [t for t in idx['tiles'] if t['parts']]
idx['buildings'] = idx.get('buildings', 0) - len(dropped_parts)
json.dump(idx, open(root + 'buildings3d-index.json', 'w'))
def move(k):  # file:start keys of the rewritten tiles; None for a part that is gone
    if k in dropped_parts: return None
    return remap.get(k, k)
for name in ('duplicates.json', 'insets.json'):
    if os.path.exists(root + name) and json.load(open(root + name)):
        json.dump([m for m in (move(k) for k in json.load(open(root + name))) if m], open(root + name, 'w'), separators=(',', ':'))
if os.path.exists(root + 'recolour.json') and json.load(open(root + 'recolour.json')):
    rec = json.load(open(root + 'recolour.json')); out = {}
    for k, (owners, flat) in rec.items():
        if move(k): out[move(k)] = [[move(o) or o for o in owners], flat]
    json.dump(out, open(root + 'recolour.json', 'w'), separators=(',', ':'))

# --- their collision: kk-footprints.json and fit-colliders' `model-` footprints, and the ground pads under them ---
gone_ids = {r['id'] for r in removed}
def mostly_gone(rings):
    g = shapely.make_valid(Polygon(rings[0], rings[1:]))
    return not g.is_empty and g.area > 0 and g.intersection(gone_plan.buffer(.5)).area >= .5 * g.area
feet = json.load(open(root + 'kk-footprints.json'))
keep = [f for f in feet if not (f['id'] in gone_ids and mostly_gone(f['rings']))]
log(len(feet) - len(keep), 'footprints out of kk-footprints.json')
json.dump(keep, open(root + 'kk-footprints.json', 'w'), separators=(',', ':'))
MODEL_FOOT = re.compile(r'^model-(kk-.*)-\d+$')
pads, keep = [], []
for b in pack['buildings']:
    m = MODEL_FOOT.match(b['id'])
    if m and m.group(1) in gone_ids and mostly_gone(b['rings']): pads.append(shapely.make_valid(Polygon(b['rings'][0], b['rings'][1:])))
    else: keep.append(b)
log(len(pack['buildings']) - len(keep), 'model footprints out of city.pack')
gone_feet = {b['id'] for b in pack['buildings']} - {b['id'] for b in keep}
if os.path.exists(root + 'collision-trim.json'):  # their trimmed rings (collision-trim.py) go with them
    trim = json.load(open(root + 'collision-trim.json'))
    json.dump({k: v for k, v in trim.items() if k.split('#')[0] not in gone_feet}, open(root + 'collision-trim.json', 'w'), separators=(',', ':'), ensure_ascii=False)
pack['buildings'] = keep
open(root + 'city.pack', 'wb').write(gzip.compress(json.dumps(pack, separators=(',', ':'), ensure_ascii=False).encode(), 9, mtime=0))
if pads:  # surface-dissolve drew a pad (8.5 cm, world-formats.mjs) on every footprint
    pad_plan = shapely.union_all(pads).buffer(.05); shapely.prepare(pad_plan); px0, pz0, px1, pz1 = pad_plan.bounds
    sidx = json.load(open(root + 'surface-index.json')); n_pad = 0
    for r in sidx:
        b = r['bbox']
        if b[0] > px1 or b[2] < px0 or b[1] > pz1 or b[3] < pz0: continue
        a = np.frombuffer(read(root + r['file'] + '.pack'), np.float32).reshape(-1, 3, 6)
        c = a[:, :, [0, 2]].mean(1)
        hit = (np.abs(a[:, 0, 1] - .085) < .002) & shapely.contains_xy(pad_plan, c[:, 0], c[:, 1])
        if not hit.any(): continue
        n_pad += int(hit.sum()); a = a[~hit]
        open(root + r['file'] + '.pack', 'wb').write(gzip.compress(a.astype(np.float32).tobytes(), 9, mtime=0))
        if len(a): r['bbox'] = [float(a[:, :, 0].min()), float(a[:, :, 2].min()), float(a[:, :, 0].max()), float(a[:, :, 2].max())]
    json.dump(sidx, open(root + 'surface-index.json', 'w'), separators=(',', ':'))
    log(n_pad, 'ground pad triangles under them taken up')

# --- the list, for --again and the tests ---
if not AGAIN:
    json.dump({'source': 'GeoDanmark buildings via Københavns Kommune (WFS k101:bygning); compared with the 2013 city model by scripts/kk-demolished.py',
               'note': f'model-only pieces of at least {MIN_AREA} m2 that current buildings cover by under {MAX_COVER:.0%}; x, z in game metres',
               'pieces': [{**{k: r[k] for k in ('id', 'area', 'height', 'cover', 'x', 'z')}, 'ring': [[round(x, 1), round(z, 1)] for x, z in Polygon(r['ring']).simplify(.3).exterior.coords[:-1]]}
                          for r in sorted(removed, key=lambda r: (r['id'], r['x']))],
               'leftInPlace': [{k: r[k] for k in ('id', 'area', 'x', 'z', 'why')} for r in sorted(kept_back, key=lambda r: -r['area'])]},
              open(LIST, 'w'), ensure_ascii=False, separators=(',', ':'))
    log('wrote', LIST)
