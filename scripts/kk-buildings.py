# Copenhagen's official 3D buildings → worldhood building tiles.
#
# Source: "København 3D bymodel" (Københavns Kommune, 2013), CC BY 4.0
#   https://www.opendata.dk/city-of-copenhagen/kobenhavn-3d-bymodel
#   Download "Bymodel 3D København Bygninger DXF" and pass the zip path as the first argument.
# The DXF files are LOD2 meshes (3DFACE, mostly single triangles) in ETRS89 / UTM 32N with three layers: roof
# ("Tagflade"), facade ("Facadeflade") and floor ("Bundflade", skipped).
#
# A city block is one closed mesh; it is split into houses along the OpenStreetMap footprints:
#  1. Triangles are merged into planar facets (a wall rectangle is two or more 3DFACE triangles).
#  2. Roof facets go to the footprint they lie over; a roof plane spanning two houses is cut along the footprint
#     edge (exact polygon clipping), so no roof is split along a triangle diagonal.
#  3. Walls follow the roof just inside their top edge: a facade belongs to the house behind it, a step wall to the
#     taller house. A facade running past several houses is cut vertically where their roofs meet.
#  4. Model faces outside every footprint stay together per block ("kk-<x>-<z>").
#  5. Roof edges and wall bottoms left hanging in the air (a neighbour this era leaves out, or a gap in the model)
#     get a wall down to the next surface or the ground, so no house is open on one side.
#  6. Small model-only structures standing on a road or pavement (metro lifts, vent shafts, kiosks) are left out.
# Earlier builds gave every triangle to a footprint on its own: a wall rectangle often ended up half in one house and
# half in the next (two-tone diagonals) or half dropped (triangle holes). OpenStreetMap buildings from the existing
# build are kept wherever the 2013 model has nothing (newer buildings).
#
#   python3 scripts/kk-buildings.py /path/to/bymodel3dkobenhavnbygningerdxf.zip copenhagen [--faces cache.npz]
#   python3 scripts/kk-buildings.py /path/to/bymodel3dkobenhavnbygningerdxf.zip copenhagen-1760 --era 1760
# --faces: a cache of the parsed DXF faces (written on the first run with --save-faces <file>), for quick reruns.
import gzip, json, math, os, re, sys, zipfile, tempfile, hashlib, shutil, time
import numpy as np
from pyproj import Transformer
from PIL import Image, ImageDraw
import shapely
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

T0 = time.time()
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)
ARGS = sys.argv[1:]
ZIP, CITY = ARGS[0], (ARGS[1] if len(ARGS) > 1 and not ARGS[1].startswith('--') else 'copenhagen')
opt = lambda name: ARGS[ARGS.index(name) + 1] if name in ARGS else None
# --era 1760: only houses on a footprint of the (period-filtered) OSM build are kept, heights are brought down to
# 18th-century eaves, and walls and roofs take period colours (limewash ochre, ox-blood, grey; red tile roofs).
ERA = int(opt('--era')) if opt('--era') else None
reg = next(c for c in json.load(open('public/cities/index.json'))['cities'] if c['id'] == CITY)
OUT = os.path.join('public', reg['dataRoot'].lstrip('/'))
EXTENT = round(json.load(open(f'cities/{CITY}/city.json'))['radiusMetres'] * 1.25)
to_local = Transformer.from_crs('EPSG:25832', reg['projection'], always_xy=True)
to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:25832', always_xy=True)
cx, cy = to_utm.transform(*reg['origin'])
TILE = 200
# The game terrain (scripts/city-terrain.mjs): the model's own heights (DVR90) sit on it within ~0.2 m, so houses keep
# their surveyed heights (relative to the terrain's base level) instead of each being levelled and lifted on its own:
# the walls of neighbouring houses meet exactly, a wing over a passage stays up, a block on a slope keeps its steps.
import struct
_raw = open(os.path.join(OUT, 'terrain.pack'), 'rb').read()
if _raw[:2] == b'\x1f\x8b': _raw = gzip.decompress(_raw)
_L = struct.unpack('<I', _raw[4:8])[0]; TER = json.loads(_raw[8:8 + _L]); _st = (8 + _L + 3) // 4 * 4; _n = TER['size']
_q = np.frombuffer(_raw[_st:_st + _n * _n * 2], dtype='<u2').reshape(_n, _n).astype(np.int64)
TGROUND = ((np.cumsum(_q, axis=1) & 65535) * TER['scale'] + TER['layers'][0]['min'] - TER['base']).astype(np.float32); del _raw, _q
TBASE = float(TER['base'])
def terrain_at(x, z):  # bilinear, like groundAt in src/terrain.js (relative to the terrain base)
    u = np.clip((np.asarray(x) + TER['extent']) / TER['cell'], 0, _n - 1.001); v = np.clip((np.asarray(z) + TER['extent']) / TER['cell'], 0, _n - 1.001)
    i, j = u.astype(int), v.astype(int); a, b = u - i, v - j
    return (TGROUND[j, i] * (1 - a) + TGROUND[j, i + 1] * a) * (1 - b) + (TGROUND[j + 1, i] * (1 - a) + TGROUND[j + 1, i + 1] * a) * b

# ---------------------------------------------------------------- read faces
if opt('--faces'):
    d = np.load(opt('--faces')); V, K = d['V'], d['K']
    keep = (np.abs(V[:, 0, 0] - cx) <= EXTENT + 60) & (np.abs(V[:, 0, 1] - cy) <= EXTENT + 60); V, K = V[keep], K[keep]
else:
    z = zipfile.ZipFile(ZIP); files = []
    for n in z.namelist():
        if not n.endswith('_bfm2011.dxf'): continue
        head = z.open(n).read(6000).decode('latin1')
        ext = [tuple(map(float, re.search(v + r'\s*\n\s*10\s*\n\s*([-\d.]+)\s*\n\s*20\s*\n\s*([-\d.]+)', head).groups())) for v in (r'\$EXTMIN', r'\$EXTMAX')]
        R = EXTENT * 1.05
        if ext[1][0] > cx - R and ext[0][0] < cx + R and ext[1][1] > cy - R and ext[0][1] < cy + R: files.append(n)
    log(len(files), 'district files overlap the city')
    from ezdxf.addons import iterdxf
    faces, kinds = [], []
    tmp = tempfile.mkdtemp()
    for n in files:
        p = z.extract(n, tmp)
        for e in iterdxf.opendxf(p).modelspace():
            if e.dxftype() != '3DFACE': continue
            lay = e.dxf.layer
            k = 2 if 'Bundflade' in lay else (1 if 'Tagflade' in lay else 0)
            v = [tuple(e.dxf.vtx0), tuple(e.dxf.vtx1), tuple(e.dxf.vtx2), tuple(e.dxf.vtx3)]
            if abs(v[0][0] - cx) > EXTENT + 60 or abs(v[0][1] - cy) > EXTENT + 60: continue
            faces.append(v); kinds.append(k)
        os.remove(p)
        log(' ', n.split('/')[-1], len(faces))
    shutil.rmtree(tmp, ignore_errors=True)
    V, K = np.array(faces, dtype=np.float64), np.array(kinds, dtype=np.int8)
    if opt('--save-faces'): np.savez_compressed(opt('--save-faces'), V=V, K=K)
VF = V[K == 2]  # floors: only those high over the ground are kept (the ceiling of a passage, under an overhang)
V, K = V[K != 2], K[K != 2]  # floors at the ground are not drawn
# the district files overlap at their edges: drop faces that appear twice (same corners, any order)
Q = np.round(V * 20).astype(np.int64); Q -= Q.reshape(-1, 3).min(0)
key = np.sort((Q[:, :, 0] << 34) | (Q[:, :, 1] << 14) | Q[:, :, 2], 1)
_, first = np.unique(key, axis=0, return_index=True); first.sort()
log(len(V), 'faces,', len(V) - len(first), 'duplicates dropped'); V, K = V[first], K[first]

# ---------------------------------------------------------------- triangles in game coordinates
def game_triangles(Vx):  # DXF faces (UTM corners, a repeated 4th corner for triangles) -> x, height, z (=-north)
    quad = np.abs(Vx[:, 3] - Vx[:, 2]).sum(1) > 1e-6
    Tx = np.concatenate([Vx[:, [0, 1, 2]], Vx[quad][:, [0, 2, 3]]]); fl = Tx.reshape(-1, 3)
    lx_, ly_ = to_local.transform(fl[:, 0], fl[:, 1])
    return np.stack([np.array(lx_), fl[:, 2], -np.array(ly_)], 1).reshape(-1, 3, 3)
T = game_triangles(V)
# ceilings: floor faces more than 1.8 m over the terrain close a passage or an overhang from below (seen from the street,
# a facade over a passage otherwise ends in the air and the house is hollow above it)
TF = game_triangles(VF) if len(VF) else np.zeros((0, 3, 3))
if len(TF):
    _a = np.linalg.norm(np.cross(TF[:, 1] - TF[:, 0], TF[:, 2] - TF[:, 0]), axis=1) / 2
    _h = TF[:, :, 1].mean(1) - TBASE - terrain_at(TF[:, :, 0].mean(1), TF[:, :, 2].mean(1))
    TF = TF[(_a > .05) & (_h > 1.8)]
    _q = np.round(TF * 20).astype(np.int64); _q -= _q.reshape(-1, 3).min(0)  # drop repeats (district files overlap)
    _, _f = np.unique(np.sort((_q[:, :, 0] << 34) | (_q[:, :, 2] << 14) | _q[:, :, 1], 1), axis=0, return_index=True); TF = TF[np.sort(_f)]
del VF
nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); area = np.linalg.norm(nrm, axis=1) / 2
ok = area > 1e-3
T, nrm, area = T[ok], nrm[ok], area[ok]
nrm /= (2 * area)[:, None]
wallish = np.abs(nrm[:, 1]) < .3
log(len(T), 'triangles', int(wallish.sum()), 'walls', int((~wallish).sum()), 'roofs')

# vertices shared by triangles (2 cm): edges, blocks and facets
VQ = np.round(T.reshape(-1, 3) * 50).astype(np.int64)
vkey, vid = np.unique(VQ, axis=0, return_inverse=True); vid = vid.reshape(-1, 3)
# blocks: triangles connected through shared plan positions (walls share their top corners with the roof)
pkey, pid = np.unique(VQ[:, [0, 2]] // 2.5, axis=0, return_inverse=True); pid = pid.reshape(-1, 3)
g = coo_matrix((np.ones(len(T) * 2), (np.concatenate([pid[:, 0], pid[:, 1]]), np.concatenate([pid[:, 1], pid[:, 2]]))), shape=(len(pkey), len(pkey)))
_, plab = connected_components(g, directed=False); comp = plab[pid[:, 0]]
# edges: (vertex a, vertex b) -> triangles
ea = np.concatenate([vid[:, 0], vid[:, 1], vid[:, 2]]); eb = np.concatenate([vid[:, 1], vid[:, 2], vid[:, 0]])
et = np.tile(np.arange(len(T)), 3)
lo, hi = np.minimum(ea, eb), np.maximum(ea, eb)
ekey = lo * len(vkey) + hi
order = np.argsort(ekey, kind='stable'); ekey_s, et_s = ekey[order], et[order]
same = ekey_s[1:] == ekey_s[:-1]
pa, pb = et_s[:-1][same], et_s[1:][same]  # pairs of triangles sharing an edge
# facets: neighbours on the same plane (either winding: about half the model is wound inside out)
dots = np.einsum('ij,ij->i', nrm[pa], nrm[pb]); sg = np.sign(dots)
# distance of the neighbour's corners from this triangle's plane, in local differences (the absolute coordinates are
# thousands of metres: plane offsets n.p lost the centimetres and split coplanar walls)
off = np.abs(np.einsum('ikj,ij->ik', T[pb] - T[pa, 0][:, None, :], nrm[pa])).max(1)
cop = (np.abs(dots) > .999) & (np.abs(off) < .05)
# a wall rectangle is one facet even when its two triangles are a little out of plane (survey noise): wall pairs
# meeting along a diagonal (not a vertical corner) with nearly the same horizontal normal; roofs within 3.6 degrees
ev_a, ev_b = T[pa], T[pb]
nh_a = nrm[pa][:, [0, 2]] / (np.linalg.norm(nrm[pa][:, [0, 2]], axis=1, keepdims=True) + 1e-12); nh_b = nrm[pb][:, [0, 2]] / (np.linalg.norm(nrm[pb][:, [0, 2]], axis=1, keepdims=True) + 1e-12)
both_w = wallish[pa] & wallish[pb]
cop |= both_w & (np.abs(np.einsum('ij,ij->i', nh_a, nh_b)) > .996) & (np.abs(off) < .25)
cop |= (~wallish[pa]) & (~wallish[pb]) & (np.abs(dots) > .998) & (np.abs(off) < .1)
g = coo_matrix((np.ones(int(cop.sum())), (pa[cop], pb[cop])), shape=(len(T), len(T)))
nfac, facet = connected_components(g, directed=False)
log(nfac, 'planar facets in', comp.max() + 1, 'blocks')

# ---------------------------------------------------------------- OpenStreetMap footprints
pack = json.loads(gzip.decompress(open(os.path.join(OUT, 'city.pack'), 'rb').read()))
osm, polys = [None], [None]
for bld in pack['buildings']:
    rings = [r for r in bld.get('rings', []) if len(r) > 2]
    if not rings: continue
    try:
        pg = Polygon(rings[0], [r for r in rings[1:]]); pg = pg if pg.is_valid else shapely.make_valid(pg).buffer(0)
    except Exception: continue
    if pg.is_empty or pg.area < 1: continue
    osm.append(bld); polys.append(pg)
NOSM = len(osm)
G = 1.0; N = int(2 * (EXTENT + 100) / G); OFF = EXTENT + 100
def raster(mode, items):
    img = Image.new(mode, (N, N), 0); dr = ImageDraw.Draw(img)
    for pts, val in items: dr.polygon([((x + OFF) / G, (z + OFF) / G) for x, z in pts], fill=val)
    return np.array(img)
def cells(x, z):
    i = np.clip(((np.asarray(z) + OFF) / G).astype(np.int64), 0, N - 1); j = np.clip(((np.asarray(x) + OFF) / G).astype(np.int64), 0, N - 1)
    return i, j
order_osm = sorted(range(1, NOSM), key=lambda i: -polys[i].area)  # small buildings drawn last: on top of a courtyard host
def poly_items(i):
    pg = polys[i]
    for part in getattr(pg, 'geoms', [pg]):
        if part.geom_type == 'Polygon': yield list(part.exterior.coords), i
OSMR = raster('I', (it for i in order_osm for it in poly_items(i)))
osm_at = lambda x, z: OSMR[cells(x, z)]
log(NOSM - 1, 'footprints rastered')

# ---------------------------------------------------------------- roofs: by footprint, cut along footprint edges
def group_of_unmatched(c): return NOSM + int(c)  # model faces outside every footprint stay together per block
tri_owner = np.full(len(T), -1, dtype=np.int64)
R = np.where(~wallish)[0]
# area shares of each footprint per roof facet, from samples spaced about 0.5 m over every triangle
kk = np.clip(np.ceil(np.sqrt(2 * area[R]) / .6), 3, 60).astype(int)
SK, SS = [], []
for k in np.unique(kk):
    allsel = R[kk == k]
    ii, jj = np.meshgrid(np.arange(k), np.arange(k)); m = ii + jj < k
    b1 = ((ii[m] + 1 / 3) / k); b2 = ((jj[m] + 1 / 3) / k)  # interior barycentric grid
    step = max(1, 2000000 // len(b1))
    for c0 in range(0, len(allsel), step):
        sel = allsel[c0:c0 + step]
        P = T[sel, 0][:, None, :] + b1[None, :, None] * (T[sel, 1] - T[sel, 0])[:, None, :] + b2[None, :, None] * (T[sel, 2] - T[sel, 0])[:, None, :]
        o = osm_at(P[:, :, 0], P[:, :, 2]).astype(np.int64)
        fk = np.repeat(facet[sel].astype(np.int64), o.shape[1]) * (NOSM + 1) + o.ravel()
        uk, inv = np.unique(fk, return_inverse=True); SK.append(uk); SS.append(np.bincount(inv, np.repeat(area[sel] / o.shape[1], o.shape[1])))
SK, inv = np.unique(np.concatenate(SK), return_inverse=True); SS = np.bincount(inv, np.concatenate(SS)); del inv
SF, SO = SK // (NOSM + 1), SK % (NOSM + 1)
def shares(f):
    lo_, hi_ = np.searchsorted(SF, f), np.searchsorted(SF, f, side='right')
    return dict(zip(SO[lo_:hi_].tolist(), SS[lo_:hi_].tolist()))
def by_facet(idx):  # (facet, [triangles]) runs
    o_ = idx[np.argsort(facet[idx], kind='stable')]; fv = facet[o_]
    cuts = np.flatnonzero(np.diff(fv)) + 1; starts = np.concatenate([[0], cuts]); ends = np.concatenate([cuts, [len(o_)]])
    for a_, b_ in zip(starts, ends): yield int(fv[a_]), o_[a_:b_].tolist()
pieces = []  # extra triangles from cut roofs: (3x3 array, owner, comp)
cut_facets = 0
def lift(pts2, t):
    n = nrm[t]; d = n @ T[t, 0]
    return [(x, (d - n[0] * x - n[2] * z) / n[1], z) for x, z in pts2]
def polyonly(g):  # polygonal parts only (intersections can return lines and points too)
    if g.is_empty or g.geom_type in ('Polygon', 'MultiPolygon'): return g
    return unary_union([x for x in getattr(g, 'geoms', []) if x.geom_type in ('Polygon', 'MultiPolygon')]) if hasattr(g, 'geoms') else Polygon()
def triangulate(pg):
    out = []
    for part in getattr(pg, 'geoms', [pg]):
        if part.geom_type != 'Polygon' or part.area < 1e-4: continue
        for tr in shapely.constrained_delaunay_triangles(part).geoms:
            c = list(tr.exterior.coords)[:3]
            if Polygon(c).area > 1e-5: out.append(c)
    return out
for f, tris in by_facet(R):
    sh = shares(f); tot = sum(sh.values()) or 1
    # houses under this roof plane claim their part of it (a long roof runs over several narrow houses: Nyhavn); a
    # footprint that only grazes it (a strip under a metre wide: the map and the model disagree) does not, and the
    # part outside every footprint never splits a plane
    cand = [o for o, a in sh.items() if o and a >= 1]
    claim = cand
    if len(cand) >= 2:
        fp = unary_union([Polygon(T[t][:, [0, 2]]) for t in tris]).buffer(0)
        claim = []
        for o in cand:
            it = polyonly(fp.intersection(polys[o]))
            if it.is_empty or it.area < 2.5: continue
            r = it.minimum_rotated_rectangle; xy = np.array(r.exterior.coords) if r.geom_type == 'Polygon' else None
            thin = min(np.linalg.norm(xy[1] - xy[0]), np.linalg.norm(xy[2] - xy[1])) if xy is not None and len(xy) >= 4 else 0
            if thin >= 1.2 or it.area >= .25 * fp.area: claim.append(o)
    if len(claim) <= 1:
        o = claim[0] if claim else (max((o for o in sh if o), key=sh.get, default=0) if sum(a for o, a in sh.items() if o) / tot >= .5 else 0)
        tri_owner[tris] = o if o else group_of_unmatched(comp[tris[0]]); continue
    cut_facets += 1
    named = claim; top = max(claim, key=sh.get)
    for t in tris:
        tp = Polygon(T[t][:, [0, 2]])
        if not tp.is_valid or tp.area < 1e-4:
            tri_owner[t] = top; continue
        got = []
        for o in named:
            p = polyonly(tp.intersection(polys[o]))
            if not p.is_empty and p.area > 1e-3: got.append([o, p])
        rest = polyonly(tp.difference(unary_union([p for _, p in got]))) if got else tp
        if not rest.is_empty and got:  # the rest (misalignment, unmapped strips) joins the piece it shares the longest border with
            for r in getattr(rest, 'geoms', [rest]):
                if r.area < 1e-5: continue
                best = max(got, key=lambda g_: r.boundary.intersection(g_[1].boundary).length)
                best[1] = polyonly(best[1].union(r))
        if not got:
            tri_owner[t] = top; continue
        tri_owner[t] = -2  # replaced by its pieces
        for o, p in got:
            for c in triangulate(p): pieces.append((np.array(lift(c, t)), o, comp[t]))
log('roofs:', len(R), 'triangles,', cut_facets, 'roof planes cut along a footprint edge into', len(pieces), 'pieces')

# roof triangles as drawn: owner and height rasters (highest roof wins), for the walls below them
RT = [(T[t], int(tri_owner[t])) for t in R if tri_owner[t] >= 0] + [(p, o) for p, o, _ in pieces]
RT.sort(key=lambda r: r[0][:, 1].max())
ROWN = raster('I', ((r[0][:, [0, 2]].tolist(), r[1]) for r in RT))
RH = raster('F', ((r[0][:, [0, 2]].tolist(), float(r[0][:, 1].max())) for r in RT))
log('roof rasters')
# roof edges by 1 m cell, for "which roof touches this wall's top edge"
RTA = np.array([r[0] for r in RT]); RTO = np.array([r[1] for r in RT], dtype=np.int64)
EA = np.concatenate([RTA[:, 0], RTA[:, 1], RTA[:, 2]]); EB = np.concatenate([RTA[:, 1], RTA[:, 2], RTA[:, 0]]); EO = np.tile(RTO, 3)
ck = lambda x, z: (np.floor(x).astype(np.int64) + 5000) * 20000 + (np.floor(z).astype(np.int64) + 5000)
EM = (EA + EB) / 2
ekeys = np.concatenate([ck(EA[:, 0], EA[:, 2]), ck(EB[:, 0], EB[:, 2]), ck(EM[:, 0], EM[:, 2])]); eidx = np.tile(np.arange(len(EA)), 3)
o_ = np.argsort(ekeys, kind='stable'); ekeys, eidx = ekeys[o_], eidx[o_]
def edges_near(A, B):
    pts = A[None, :] + np.linspace(0, 1, max(2, int(np.hypot(B[0] - A[0], B[2] - A[2])) + 2))[:, None] * (B - A)[None, :]
    keys_ = np.unique(np.concatenate([ck(pts[:, 0] + dx, pts[:, 2] + dz) for dx in (-.5, 0, .5) for dz in (-.5, 0, .5)]))
    lo_, hi_ = np.searchsorted(ekeys, keys_), np.searchsorted(ekeys, keys_, side='right')
    if not (hi_ > lo_).any(): return np.zeros(0, dtype=np.int64)
    return np.unique(np.concatenate([eidx[a:b] for a, b in zip(lo_, hi_) if b > a]))
def seg_dists(P, A, B):  # distances of points P (n,3) to segment AB
    AB = B - A; L2 = AB @ AB
    u = np.clip(((P - A) @ AB) / (L2 if L2 > 1e-12 else 1), 0, 1)
    return np.linalg.norm(P - (A + u[:, None] * AB), axis=1)
# ---------------------------------------------------------------- walls: follow the roof inside their top edge
W = np.where(wallish)[0]
def seg_dist(P, A, B):
    AB = B - A; L2 = AB @ AB
    if L2 < 1e-12: return np.linalg.norm(P - A)
    u = np.clip((P - A) @ AB / L2, 0, 1); return np.linalg.norm(P - (A + u * AB))
def clip_halfspace(poly, tdir, c, keep_below):
    out = []
    for i in range(len(poly)):
        A, B = poly[i], poly[(i + 1) % len(poly)]
        sa, sb = A[0] * tdir[0] + A[2] * tdir[1] - c, B[0] * tdir[0] + B[2] * tdir[1] - c
        if keep_below: sa, sb = -sa, -sb
        if sa >= 0: out.append(A)
        if (sa >= 0) != (sb >= 0): out.append(A + (B - A) * (sa / (sa - sb)))
    return out
wall_pieces = []  # (3x3, owner, comp)
cut_walls = fallback = 0
nwf = 0
for f, tris in by_facet(W):
    nwf += 1
    n = nrm[tris[0]]; nh = np.array([n[0], n[2]]); nh /= (np.linalg.norm(nh) or 1)
    tdir = np.array([-nh[1], nh[0]])
    s_of = lambda P: P[0] * tdir[0] + P[2] * tdir[1]
    pts = T[tris].reshape(-1, 3); ss = pts[:, 0] * tdir[0] + pts[:, 2] * tdir[1]
    s0, s1 = ss.min(), ss.max(); ymid = (pts[:, 1].min() + pts[:, 1].max()) / 2
    c0 = comp[tris[0]]
    # boundary edges of the facet that have nothing of the facet above them: its top
    ecount = {}
    for t in tris:
        for a in range(3):
            k_ = tuple(sorted((int(vid[t, a]), int(vid[t, (a + 1) % 3])))); ecount[k_] = ecount.get(k_, 0) + 1
    intervals = []
    if s1 - s0 > .25:
        for t in tris:
            for a in range(3):
                ia, ib = int(vid[t, a]), int(vid[t, (a + 1) % 3])
                if ecount[tuple(sorted((ia, ib)))] != 1: continue
                A, B = T[t, a], T[t, (a + 1) % 3]
                if abs(s_of(A) - s_of(B)) < .2: continue  # a vertical side
                C = T[t, 3 - a - (a + 1) % 3]
                if C[1] > max(A[1], B[1]) + .05: continue  # the triangle stands on this edge: a bottom edge
                cand = edges_near(A, B)
                if not len(cand): continue
                good = cand[(seg_dists(EA[cand], A, B) < .05) & (seg_dists(EB[cand], A, B) < .05)]
                for e in good:
                    a_, b_ = sorted((s_of(EA[e]), s_of(EB[e])))
                    if b_ - a_ > .05: intervals.append((a_, b_, int(EO[e])))
    # what the roofs above don't settle: the higher roof beside the wall is inside it
    def probe(s):
        q = np.array([0., 0.]); base = pts[np.argmin(np.abs(ss - s))]
        qx, qz = base[0] + (s - s_of(base)) * tdir[0], base[2] + (s - s_of(base)) * tdir[1]
        pp, pm = (qx + nh[0] * 1.1, qz + nh[1] * 1.1), (qx - nh[0] * 1.1, qz - nh[1] * 1.1)
        hp, hm = RH[cells(*pp)], RH[cells(*pm)]
        if abs(hp - hm) >= .5:
            o = int(ROWN[cells(*(pp if hp > hm else pm))])
            if o: return o
        op, om = int(ROWN[cells(*pp)]), int(ROWN[cells(*pm)])
        if op and op == om: return op
        if op or om: return op or om
        op, om = int(osm_at(qx + nh[0] * 1.1, qz + nh[1] * 1.1)), int(osm_at(qx - nh[0] * 1.1, qz - nh[1] * 1.1))
        return op or om or group_of_unmatched(c0)
    span = []  # (s_a, s_b, owner) covering [s0, s1]
    intervals.sort()
    cur = s0
    for a_, b_, o in intervals:
        if b_ <= cur + .02: continue
        if a_ > cur + .3:
            fallback += 1
            m = max(1, int(np.ceil((a_ - cur) / .5)))
            for k in range(m): span.append((cur + (a_ - cur) * k / m, cur + (a_ - cur) * (k + 1) / m, probe(cur + (a_ - cur) * (k + .5) / m)))
        span.append((max(a_, cur), b_, o)); cur = b_
    if s1 > cur + .02:
        if not span or s1 - cur > .3:
            fallback += 1
            m = max(1, int(np.ceil((s1 - cur) / .5)))
            for k in range(m): span.append((cur + (s1 - cur) * k / m, cur + (s1 - cur) * (k + 1) / m, probe(cur + (s1 - cur) * (k + .5) / m)))
        else: span[-1] = (span[-1][0], s1, span[-1][2])
    # merge runs of one owner; runs under 0.2 m join their longer neighbour
    runs = []
    for a_, b_, o in span:
        if runs and runs[-1][2] == o: runs[-1][1] = b_
        else: runs.append([a_, b_, o])
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for i, r in enumerate(runs):
            if r[1] - r[0] < .2:
                j = i - 1 if i == len(runs) - 1 or (i > 0 and runs[i - 1][1] - runs[i - 1][0] >= runs[i + 1][1] - runs[i + 1][0]) else i + 1
                if j < i: runs[j][1] = r[1]
                else: runs[j][0] = r[0]
                runs.pop(i); changed = True; break
        merged = []
        for r in runs:
            if merged and merged[-1][2] == r[2]: merged[-1][1] = r[1]
            else: merged.append(r)
        runs = merged
    if len(runs) <= 1:
        tri_owner[tris] = runs[0][2] if runs else group_of_unmatched(c0); continue
    cut_walls += 1
    tri_owner[tris] = -2
    for t in tris:
        poly = [T[t, 0], T[t, 1], T[t, 2]]
        for i, (a_, b_, o) in enumerate(runs):
            p = poly
            if i > 0: p = clip_halfspace(p, tdir, a_, False)
            if i < len(runs) - 1 and len(p) >= 3: p = clip_halfspace(p, tdir, b_, True)
            if len(p) < 3: continue
            for k in range(1, len(p) - 1):
                tr = np.array([p[0], p[k], p[k + 1]])
                if np.linalg.norm(np.cross(tr[1] - tr[0], tr[2] - tr[0])) > 2e-4: wall_pieces.append((tr, o, c0))
log('walls:', len(W), 'triangles in', nwf, 'facets,', cut_walls, 'cut where two houses meet,', fallback, 'spans owned by probing')

# ---------------------------------------------------------------- houses
keep_t = np.where(tri_owner >= 0)[0]
extra = pieces + wall_pieces
ALL = np.concatenate([T[keep_t], np.array([p_[0] for p_ in extra]).reshape(-1, 3, 3)])
OWN = np.concatenate([tri_owner[keep_t], np.array([p_[1] for p_ in extra], dtype=np.int64)])
CMP = np.concatenate([comp[keep_t], np.array([p_[2] for p_ in extra], dtype=np.int64)])
del extra, pieces, wall_pieces
groups = {}  # owner -> triangle indices into ALL
o_ = np.argsort(OWN, kind='stable'); ov = OWN[o_]; cuts = np.flatnonzero(np.diff(ov)) + 1
for a_, b_ in zip(np.concatenate([[0], cuts]), np.concatenate([cuts, [len(o_)]])): groups[int(ov[a_])] = o_[a_:b_]
log(len(groups), 'houses and block remainders')
comp_base = np.full(comp.max() + 1, np.inf); np.minimum.at(comp_base, comp, T[:, :, 1].min(1))
WALLS_1760 = ['#d9b26f', '#e8d39a', '#8e3b2e', '#bdb6a6', '#ece4d0', '#d99c7f', '#a8ae96', '#a5503a', '#c99a5b', '#e3d5b8', '#b46e4f']
ROOFS_1760 = ['#9c4a30', '#8a3f2a', '#a85a3a', '#93442d', '#4d4f52']
MODERN = re.compile(r'rådhus|glyptotek|tivoli|hovedbanegård|politigård|nationalmuseet|det kongelige bibliotek|operaen|skuespilhus', re.I)
LANDMARK = re.compile(r'kirke|kirken|tårn|børsen|slot|christiansborg|kastellet|amalienborg|church|tower|palace', re.I)
# today's street furniture the 1760 footprints still carry (Nørreport station entrances, a kiosk on Amagertorv, toilets)
MODERN_KIND = re.compile(r'^(kiosk|toilets|train_station|transportation|station|bus_station|shelter|service|parking|garages?|carport|roof|construction|container)$', re.I)
WALLS = ['#e8d9b0', '#f0e2c4', '#e5c27a', '#d9a45b', '#c8664a', '#b5523b', '#efe9dc', '#d8d2c4', '#9c4f3a', '#e9c9a1', '#cfd8c4', '#e2b8a4', '#f2efe6', '#bfb7a6']
ROOFS = ['#8a3e2c', '#7a3626', '#9a4a32', '#4b4f55', '#3f4348', '#5a5f66', '#6f8f7a']
def pick(pal, s, salt):
    h = int(hashlib.md5((salt + s).encode()).hexdigest(), 16)
    return pal[h % len(pal)]
hexrgb = lambda h: [round(int(h[i:i + 2], 16) / 255, 3) for i in (1, 3, 5)]

# tiny remainders (a sliver of a footprint over a neighbour's roof edge) join the house they touch most
q_ = np.round(ALL * 50).astype(np.int64)
VK = ((q_[:, :, 0] + 200000) << 33) | ((q_[:, :, 2] + 200000) << 14) | (q_[:, :, 1] + 2000)  # (n, 3) vertex keys
tri_area = np.linalg.norm(np.cross(ALL[:, 1] - ALL[:, 0], ALL[:, 2] - ALL[:, 0]), axis=1) / 2
small = [o for o, ix in groups.items() if len(ix) < 4 or tri_area[ix].sum() < 3]
if small:
    sset = set(small); joined = 0
    small_keys = np.unique(np.concatenate([VK[groups[o]].ravel() for o in small]))
    hit = np.isin(VK, small_keys).any(1); hit_t = np.flatnonzero(hit)
    for o in small:
        if o not in groups: continue
        mine = np.unique(VK[groups[o]].ravel())
        cand = hit_t[np.isin(VK[hit_t], mine).any(1)]
        votes = {}
        for o2 in OWN[cand].tolist():
            if o2 != o and o2 in groups and o2 not in sset: votes[o2] = votes.get(o2, 0) + 1
        if votes:
            to = max(votes, key=votes.get); groups[to] = np.concatenate([groups[to], groups.pop(o)]); OWN[groups[to]] = to; joined += 1
    log(joined, 'slivers joined to the house they touch')
del q_, VK

# Model-only structures of a few square metres standing in the street (a metro lift, a vent shaft, a kiosk or toilet
# that OpenStreetMap does not map as a building) were drawn as little brick houses in the road: they are left out.
STREET = []
for layer in ('roads', 'pavement'):
    for f in pack[layer]:
        r = f.get('rings')
        if not r or len(r[0]) < 3: continue
        try: g = Polygon(r[0], [h for h in r[1:] if len(h) > 2]).buffer(0)
        except Exception: continue
        if not g.is_empty: STREET.append(g)
STREET_T = shapely.STRtree(STREET)
def roof_plan(P):  # the plan of a house's roof surfaces
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); l = np.linalg.norm(n, axis=1) + 1e-12
    tri = [Polygon(q[:, [0, 2]]).buffer(.01) for q in P[np.abs(n[:, 1] / l) >= .3]
           if abs((q[1, 0] - q[0, 0]) * (q[2, 2] - q[0, 2]) - (q[1, 2] - q[0, 2]) * (q[2, 0] - q[0, 0])) > 1e-6]
    return unary_union(tri) if tri else None
street_drop = 0

kept = {}
for o, ix in groups.items():
    ob = osm[o] if 0 < o < NOSM else None
    if ERA and (not ob or ob.get('name') == 'Volden' or MODERN.search(ob.get('name') or '') or MODERN_KIND.match(ob.get('kind') or '')): continue
    P = ALL[ix]; comps = set(np.unique(CMP[ix]).tolist()); l = ix
    mx, mz = P[:, :, 0].mean(), P[:, :, 2].mean()
    if abs(mx) > EXTENT or abs(mz) > EXTENT: continue
    base = P[:, :, 1].min()
    h = P[:, :, 1].max() - base
    if h < 2 and len(l) < 6: continue
    bbox = [round(float(P[:, :, 0].min()), 2), round(float(P[:, :, 2].min()), 2), round(float(P[:, :, 0].max()), 2), round(float(P[:, :, 2].max()), 2)]
    if (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 160000: continue
    foot = max(1.0, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
    if not ERA and ob is None and foot < 150:
        fp = roof_plan(P)
        if fp is not None and 0 < fp.area < 60 and sum(fp.intersection(STREET[i]).area for i in STREET_T.query(fp)) >= .5 * fp.area:
            street_drop += 1; continue
    sculpture = foot < 60 and len(ix) / foot > 20  # a statue or fountain modelled in detail, not a house
    if sculpture and ERA and not LANDMARK.search((ob or {}).get('name') or ''): continue
    kept[o] = dict(P=P, ob=ob, base=base, h=h, bbox=bbox, mx=mx, mz=mz, sculpture=sculpture)
log(len(kept), 'houses kept' + (f', {street_drop} model-only structures in the street left out' if street_drop else ''))

if len(TF):
    _i, _j = cells(TF[:, :, 0].mean(1), TF[:, :, 2].mean(1)); _own = ROWN[_i, _j]; _by = {}
    for t_, o in enumerate(_own.tolist()):
        if o in kept: _by.setdefault(o, []).append(t_)
    for o, ts in _by.items(): kept[o]['P'] = np.concatenate([kept[o]['P'], TF[ts]])
    log(sum(len(v) for v in _by.values()), 'ceiling triangles (passages, overhangs) under', len(_by), 'houses')
del TF

# ---------------------------------------------------------------- close houses left open
# A roof edge with no wall under it and no roof carrying on beside it, or a wall bottom with nothing under it, hangs in
# the air (a neighbour this era leaves out, a lower wing the model left as a gap, a hall the model has only as roof and
# eaves). Both get a wall down to the next surface below or the ground. Surfaces are looked up exactly (plane heights),
# in absolute model heights. (A wall bottom used to find its own edge as "a wall carrying on" and was never closed.)
del OSMR, ROWN, RH
del ALL, OWN, CMP, groups, T, VQ, vkey, vid, pkey, pid, facet
import gc; gc.collect()
AT = np.concatenate([b['P'] for b in kept.values()])
an = np.cross(AT[:, 1] - AT[:, 0], AT[:, 2] - AT[:, 0]); al = np.linalg.norm(an, axis=1) + 1e-12; an /= al[:, None]
aroof = np.abs(an[:, 1]) >= .3; del an, al
CELL = 2.0
def cellkeys(x, z): return (np.floor(np.asarray(x) / CELL).astype(np.int64) + 10000) * 100000 + (np.floor(np.asarray(z) / CELL).astype(np.int64) + 10000)
def build_hash(ids, x0, z0, x1, z1):  # every 2 m cell of each item's box -> item id (sorted by cell)
    cx0, cz0 = np.floor(x0 / CELL).astype(np.int64), np.floor(z0 / CELL).astype(np.int64)
    nx, nz = np.floor(x1 / CELL).astype(np.int64) - cx0 + 1, np.floor(z1 / CELL).astype(np.int64) - cz0 + 1
    cnt = nx * nz; start = np.concatenate([[0], np.cumsum(cnt)[:-1]]); tot = int(cnt.sum())
    rep = np.repeat(np.arange(len(ids)), cnt); off = np.arange(tot) - start[rep]
    keys = (cx0[rep] + off % nx[rep] + 10000) * 100000 + (cz0[rep] + off // nx[rep] + 10000)
    o_ = np.argsort(keys, kind='stable'); return keys[o_], np.asarray(ids)[rep][o_]
ri = np.where(aroof)[0]
RK, RI = build_hash(ri, AT[ri, :, 0].min(1), AT[ri, :, 2].min(1), AT[ri, :, 0].max(1), AT[ri, :, 2].max(1))
wi = np.where(~aroof)[0]
WE_A = np.concatenate([AT[wi, 0], AT[wi, 1], AT[wi, 2]]); WE_B = np.concatenate([AT[wi, 1], AT[wi, 2], AT[wi, 0]])
WE_C = np.concatenate([AT[wi, 2], AT[wi, 0], AT[wi, 1]])[:, 1]  # height of each edge's third corner
WTK, WTI = build_hash(wi, AT[wi, :, 0].min(1), AT[wi, :, 2].min(1), AT[wi, :, 0].max(1), AT[wi, :, 2].max(1))
def wall_within(O, D, maxd):  # a kept wall crosses the horizontal ray O + t D (0 < t <= maxd)
    c = np.unique(np.concatenate([lookup(WTK, WTI, O[0] + D[0] * t, O[2] + D[2] * t) for t in np.arange(0, maxd + CELL, CELL)]))
    if not len(c): return False
    A, B, C = AT[c, 0], AT[c, 1], AT[c, 2]; e1, e2 = B - A, C - A; pv = np.cross(D, e2); det = np.einsum('ij,ij->i', e1, pv)
    ok = np.abs(det) > 1e-9; inv = np.where(ok, 1 / np.where(ok, det, 1), 0); tv = O - A
    u = np.einsum('ij,ij->i', tv, pv) * inv; qv = np.cross(tv, e1); v = (qv @ D) * inv; t = np.einsum('ij,ij->i', e2, qv) * inv
    return bool((ok & (u >= -1e-4) & (v >= -1e-4) & (u + v <= 1 + 1e-4) & (t > 1e-3) & (t <= maxd)).any())
WK, WI = build_hash(np.arange(len(WE_A)), np.minimum(WE_A[:, 0], WE_B[:, 0]), np.minimum(WE_A[:, 2], WE_B[:, 2]), np.maximum(WE_A[:, 0], WE_B[:, 0]), np.maximum(WE_A[:, 2], WE_B[:, 2]))
def lookup(K_, I_, x, z):
    k = cellkeys(x, z); lo_, hi_ = np.searchsorted(K_, k), np.searchsorted(K_, k, side='right'); return I_[lo_:hi_]
def roof_heights(x, z):  # heights of every kept roof surface over (x, z)
    c = lookup(RK, RI, x, z)
    if not len(c): return np.zeros(0)
    A, B, C = AT[c, 0], AT[c, 1], AT[c, 2]
    v0x, v0z, v1x, v1z = B[:, 0] - A[:, 0], B[:, 2] - A[:, 2], C[:, 0] - A[:, 0], C[:, 2] - A[:, 2]
    px, pz = x - A[:, 0], z - A[:, 2]; den = v0x * v1z - v1x * v0z; den = np.where(np.abs(den) < 1e-9, 1e-9, den)
    u = (px * v1z - v1x * pz) / den; v = (v0x * pz - px * v0z) / den
    inside = (u >= -1e-3) & (v >= -1e-3) & (u + v <= 1 + 1e-3)
    return (A[:, 1] + u * (B[:, 1] - A[:, 1]) + v * (C[:, 1] - A[:, 1]))[inside]
def on_wall_edge(M, d, below=False):  # a kept wall edge runs through point M along direction d (T-junctions of the model)
    c = lookup(WK, WI, M[0], M[2])  # below: only a wall reaching down from there (the top edge of the wall underneath)
    if not len(c): return False
    A, B = WE_A[c], WE_B[c]; AB = B - A; L2 = np.einsum('ij,ij->i', AB, AB) + 1e-12
    u = np.clip(np.einsum('ij,ij->i', M - A, AB) / L2, 0, 1); dist = np.linalg.norm(M - (A + u[:, None] * AB), axis=1)
    ok = (dist < .05) & (np.abs(AB @ d) / np.sqrt(L2) > .97)
    if below: ok &= WE_C[c] < M[1] - .05
    return bool(ok.any())
closing = 0; added = 0
for o, b in kept.items():
    P = b['P']; nP = len(P)
    keys = np.round(P.reshape(-1, 3) * 50).astype(np.int64).reshape(-1, 3, 3)
    cnt = {}
    for t in range(nP):
        for a in range(3):
            ka, kb = tuple(keys[t, a]), tuple(keys[t, (a + 1) % 3])
            k_ = (ka, kb) if ka < kb else (kb, ka); cnt[k_] = cnt.get(k_, 0) + 1
    nn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); nl = np.linalg.norm(nn, axis=1) + 1e-12
    isw = np.abs(nn[:, 1] / nl) < .3
    add = []
    for t in range(nP):
        for a in range(3):
            ka, kb = tuple(keys[t, a]), tuple(keys[t, (a + 1) % 3])
            if cnt[(ka, kb) if ka < kb else (kb, ka)] != 1: continue
            A, B = P[t, a], P[t, (a + 1) % 3]; C = P[t, 3 - a - (a + 1) % 3]
            if min(A[1], B[1]) < b['base'] + .4: continue
            dx, dz = B[0] - A[0], B[2] - A[2]; L = math.hypot(dx, dz)
            if L < .3: continue  # vertical edges: the roof edge above closes the side
            ox, oz = dz / L, -dx / L
            if (C[0] - (A[0] + B[0]) / 2) * ox + (C[2] - (A[2] + B[2]) / 2) * oz > 0: ox, oz = -ox, -oz  # away from the triangle
            if isw[t] and C[1] < max(A[1], B[1]) - .05: continue  # walls: only a bottom edge can hang
            d = (B - A) / np.linalg.norm(B - A)
            m = max(1, int(round(L)))
            run = None  # consecutive 1 m pieces with the same bottom join into one wall
            for k in range(m + 1):
                piece = None
                if k < m:
                    A1, B1 = A + (B - A) * (k / m), A + (B - A) * ((k + 1) / m); M = (A1 + B1) / 2; y = M[1]
                    gr = float(terrain_at(M[0], M[2])) + TBASE
                    if y > gr + .4 and not on_wall_edge(M, d, below=bool(isw[t])):  # (a wall bottom: its own edge doesn't count)
                        hs = np.concatenate([roof_heights(M[0] + ox * .3, M[2] + oz * .3), roof_heights(M[0] - ox * .3, M[2] - oz * .3)]) if isw[t] else roof_heights(M[0] + ox * .3, M[2] + oz * .3)
                        if not (hs[(hs >= y - .4) & (hs <= y + .4)].size):  # nothing carries on at this height
                            below = hs[hs < y - .4]; bottom = max(b['base'], gr - .3, (below.max() - .1) if below.size else b['base'])
                            # a wall bottom hanging in front of (or behind) another wall is a bay window or an overhang
                            # over a recessed ground floor, not a gap: probe for a wall just below, either side
                            if isw[t] and y - bottom >= 1.5:
                                Q = M.copy(); Q[1] = y - min(1.2, (y - bottom) / 2); nh = np.array([ox, 0, oz])
                                if wall_within(Q, nh, 2.5) or wall_within(Q, -nh, 2.5): bottom = y
                            if y - bottom >= .3: piece = (A1, B1, round(float(bottom), 1))
                if run and piece and abs(run[2] - piece[2]) < .05 and np.allclose(run[1], piece[0]): run = (run[0], piece[1], run[2])
                else:
                    if run:
                        A1_, B1_, bot = run; Ad, Bd = A1_.copy(), B1_.copy(); Ad[1] = Bd[1] = bot
                        add += [np.array([A1_, B1_, Bd]), np.array([A1_, Bd, Ad])]
                    run = piece
    if add:
        b['P'] = np.concatenate([P, np.array(add)]); closing += 1; added += len(add)
log(closing, 'houses closed where they hung open,', added, 'triangles added')

# What the model covers: the plan of every kept roof, 1 m cells. An OpenStreetMap building is kept unless the model
# covers most of its footprint. (A box test - any 4 m cell in a kept house's bounding box, give or take a cell -
# dropped small houses standing next to a big irregular block, which then stood in the street as invisible walls.)
_cov = Image.new('I', (N, N), 0); _dr = ImageDraw.Draw(_cov); HOUSE_NO = {}
for k, (o, b) in enumerate(kept.items()):  # cell -> number of the house whose roof is over it (0: open ground)
    HOUSE_NO[o] = k + 1; P = b['P']; nP = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    for q in P[np.abs(nP[:, 1] / (np.linalg.norm(nP, axis=1) + 1e-12)) >= .3][:, :, [0, 2]]: _dr.polygon([((x + OFF) / G, (z + OFF) / G) for x, z in q], fill=k + 1)
COVER = np.array(_cov); del _cov, _dr

# ---------------------------------------------------------------- walls along the footprint
# The model has a few houses only as roof and eaves on one side (a hall whose glass walls were never modelled): the
# mesh is closed, so no edge hangs, but from the street you look in under the eaves. Along each OpenStreetMap outline
# a house's roof stands over and that faces open ground (no roof of the model there), a stretch with no wall within reach (2.5 m either side,
# at a third and two thirds of the height) gets one from the roof down to the ground. Passages (a road or pavement
# running in under the house) stay open, and a house open on most of its outline is an open shed or canopy by design.
AT = np.concatenate([b['P'] for b in kept.values()])
an = np.cross(AT[:, 1] - AT[:, 0], AT[:, 2] - AT[:, 0]); aroof = np.abs(an[:, 1] / (np.linalg.norm(an, axis=1) + 1e-12)) >= .3; del an
wi = np.where(~aroof)[0]; WTK, WTI = build_hash(wi, AT[wi, :, 0].min(1), AT[wi, :, 2].min(1), AT[wi, :, 0].max(1), AT[wi, :, 2].max(1))
def rays_hit(O, D, maxd, cand):  # per ray: does it cross one of the candidate triangles within maxd?
    if not len(cand) or not len(O): return np.zeros(len(O), bool)
    A, B, C = AT[cand, 0], AT[cand, 1], AT[cand, 2]; e1, e2 = B - A, C - A
    pv = np.cross(D[:, None, :], e2[None]); det = np.einsum('ntk,tk->nt', pv, e1); ok = np.abs(det) > 1e-9
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0); tv = O[:, None, :] - A[None]
    u = np.einsum('ntk,ntk->nt', tv, pv) * inv; qv = np.cross(tv, e1[None]); v = np.einsum('ntk,nk->nt', qv, D) * inv; t = np.einsum('ntk,tk->nt', qv, e2) * inv
    return (ok & (u >= -1e-4) & (v >= -1e-4) & (u + v <= 1 + 1e-4) & (t > 1e-3) & (t <= maxd)).any(1)
curtained = 0; curtain_tris = 0
FOOT_T = shapely.STRtree(polys[1:])  # a stretch with another house's footprint outside it is a party wall, inside the block
for o, b in kept.items():
    if not b['ob'] or b['h'] < 2.5 or not (0 < o < NOSM): continue
    pg = polys[o]; P = b['P']
    nP = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); R_ = P[np.abs(nP[:, 1] / (np.linalg.norm(nP, axis=1) + 1e-12)) >= .3]
    if not len(R_): continue
    pieces = []  # A, B (plan), inward normal
    for part in getattr(pg, 'geoms', [pg]):
        if part.geom_type != 'Polygon': continue
        for ring in [part.exterior, *part.interiors]:
            c = np.asarray(ring.coords)
            for a_, b_ in zip(c[:-1], c[1:]):
                L = math.hypot(*(b_ - a_))
                if L < .3: continue
                m = max(1, int(round(L))); d = (b_ - a_) / L; nrm = np.array([-d[1], d[0]])
                mid = (a_ + b_) / 2
                if not pg.contains(Point(*(mid + nrm * .3))): nrm = -nrm
                for k in range(m): pieces.append((a_ + (b_ - a_) * k / m, a_ + (b_ - a_) * (k + 1) / m, nrm))
    if not pieces: continue
    Pa = np.array([q[0] for q in pieces]); Pb = np.array([q[1] for q in pieces]); Nn = np.array([q[2] for q in pieces]); M_ = (Pa + Pb) / 2; I_ = M_ + Nn * .6
    # this house's roof over the inside points
    A, B, C = R_[:, 0], R_[:, 1], R_[:, 2]; v0x, v0z, v1x, v1z = B[:, 0] - A[:, 0], B[:, 2] - A[:, 2], C[:, 0] - A[:, 0], C[:, 2] - A[:, 2]
    den = v0x * v1z - v1x * v0z; den = np.where(np.abs(den) < 1e-9, 1e-9, den)
    px = I_[:, 0, None] - A[None, :, 0]; pz = I_[:, 1, None] - A[None, :, 2]
    uu = (px * v1z - v1x * pz) / den; vv = (v0x * pz - px * v0z) / den; ins = (uu >= -1e-3) & (vv >= -1e-3) & (uu + vv <= 1 + 1e-3)
    hh = np.where(ins, A[None, :, 1] + uu * (B[None, :, 1] - A[None, :, 1]) + vv * (C[None, :, 1] - A[None, :, 1]), -np.inf); top = hh.max(1)
    gr = terrain_at(M_[:, 0], M_[:, 1]) + TBASE
    cand_pieces = np.flatnonzero(np.isfinite(top) & (top - gr >= 2.5))
    if not len(cand_pieces): continue
    x0_, z0_, x1_, z1_ = b['bbox']; cells_ = [lookup(WTK, WTI, x, z) for x in np.arange(x0_ - 4, x1_ + 4 + CELL, CELL) for z in np.arange(z0_ - 4, z1_ + 4 + CELL, CELL)]
    cand = np.unique(np.concatenate(cells_)) if cells_ else np.zeros(0, np.int64)
    covered = np.zeros(len(pieces), bool)
    for frac in (.35, .7):
        Y = gr[cand_pieces] + (top[cand_pieces] - gr[cand_pieces]) * frac
        O = np.stack([I_[cand_pieces, 0], Y, I_[cand_pieces, 1]], 1); D3 = np.stack([-Nn[cand_pieces, 0], np.zeros(len(cand_pieces)), -Nn[cand_pieces, 1]], 1)
        hit = np.zeros(len(cand_pieces), bool)
        for s0 in range(0, len(cand_pieces), 64):  # rays in batches (rays x triangles stays small)
            sl = slice(s0, s0 + 64)
            hit[sl] = rays_hit(O[sl], D3[sl], 3.1, cand) | rays_hit(O[sl], -D3[sl], 2.5, cand)
        covered[cand_pieces] |= hit
    gap = np.zeros(len(pieces), bool); gap[cand_pieces] = ~covered[cand_pieces]
    if not gap.any(): continue
    # passages and arcades (a road or pavement running in under the house), and party walls (another house outside)
    for i in np.flatnonzero(gap):
        q_ = Point(*I_[i]); out_ = Point(*(M_[i] - Nn[i] * .6)); far_ = Point(*(M_[i] - Nn[i] * 2.0))
        if any(STREET[j].contains(q_) for j in STREET_T.query(q_)) or any(j + 1 != o and polys[j + 1].contains(out_) for j in FOOT_T.query(out_)): gap[i] = False
        elif COVER[cells(far_.x, far_.y)] not in (0, HOUSE_NO[o]): gap[i] = False  # only where open ground (a street, a square, a yard, its own eaves) looks in
    perim = sum(np.linalg.norm(Pb - Pa, axis=1)); gl = float(np.linalg.norm(Pb - Pa, axis=1)[gap].sum())
    if not gap.any() or gl > .7 * perim: continue
    add = []
    for i in np.flatnonzero(gap):
        t_, g_ = float(top[i]) - .05, float(gr[i]) - .3
        a3, b3 = np.array([Pa[i, 0], t_, Pa[i, 1]]), np.array([Pb[i, 0], t_, Pb[i, 1]]); ad, bd = a3.copy(), b3.copy(); ad[1] = bd[1] = g_
        add += [np.array([a3, b3, bd]), np.array([a3, bd, ad])]
    b['P'] = np.concatenate([P, np.array(add)]); curtained += 1; curtain_tris += len(add)
log(curtained, 'houses given walls along their footprint where the model had none,', curtain_tris, 'triangles')
del AT, aroof

# ---------------------------------------------------------------- write tiles
tiles = {}
occ = set()  # 4 m cells covered by the model, to keep only OSM buildings it lacks
used_ids = set(); count = 0
for o, b in sorted(kept.items(), key=lambda kv: (kv[1]['mx'], kv[1]['mz'])):
    ob = b['ob']; P = b['P'].copy(); base = b['base']; h = b['h']
    bid = 'kk-' + (ob['id'] if ob else f"{int(round(b['mx']))}-{int(round(b['mz']))}")
    while bid in used_ids: bid += 'b'
    used_ids.add(bid)
    bbox = b['bbox']
    for gx in range(int(bbox[0] // 4), int(bbox[2] // 4) + 1):
        for gz in range(int(bbox[1] // 4), int(bbox[3] // 4) + 1): occ.add((gx, gz))
    t = tiles.setdefault((int(b['mx'] // TILE), int(b['mz'] // TILE)), {'arr': [], 'parts': []})
    P[:, :, 1] -= TBASE  # surveyed height above the terrain's base level
    lo = base - TBASE
    name = (ob or {}).get('name', '')
    if ERA:
        cap = 7 if re.search(r'frederiks kirke|marmorkirken', name, re.I) else (None if LANDMARK.search(name) else 16)
        if cap and h > cap: P[:, :, 1] = lo + (P[:, :, 1] - lo) * (cap / h); h = cap
    # the foot of every wall reaches a little below the ground (the terrain is smoothed; never a slit of daylight)
    nn0 = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); isw0 = np.abs(nn0[:, 1]) / (np.linalg.norm(nn0, axis=1) + 1e-12) < .3
    feet = isw0[:, None] & (P[:, :, 1] <= lo + .05)
    if feet.any():
        gx, gz = P[:, :, 0][feet], P[:, :, 2][feet]; gr = terrain_at(gx, gz)
        if lo - float(np.median(gr)) < 1.5:  # standing on the ground (not a wing raised over a passage)
            P[:, :, 1][feet] = np.maximum(np.minimum(P[:, :, 1][feet] - .5, gr - .3), P[:, :, 1][feet] - 3)
    # UVs in metres (walls: along the wall / up; roofs: plan), only used if a texture is added later
    nn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); nl = np.linalg.norm(nn, axis=1) + 1e-12
    isw = (np.abs(nn[:, 1] / nl) < .3)[:, None]
    hx, hz = nn[:, 0], nn[:, 2]; hl = np.hypot(hx, hz) + 1e-12; ux, uz = -hz / hl, hx / hl
    uv = np.zeros(P.shape[:2] + (2,))
    uv[:, :, 0] = np.where(isw, (P[:, :, 0] * ux[:, None] + P[:, :, 2] * uz[:, None]) / 3.2, P[:, :, 0] / 3.2)
    uv[:, :, 1] = np.where(isw, P[:, :, 1] / 3.2, P[:, :, 2] / 3.2)
    Vv = np.concatenate([P, uv], 2).reshape(-1, 5).astype(np.float32)
    start = sum(len(x) for x in t['arr']) // 5
    t['arr'].append(Vv.ravel())
    t['parts'].append({'id': bid, 'abs': 1, 'bbox': bbox, 'height': round(float(h), 2), 'texture': None,
                       'color': hexrgb(pick(WALLS_1760 if ERA else WALLS, bid, 'w')), 'roofColor': hexrgb(pick(ROOFS_1760 if ERA else ROOFS, bid, 'r') if h < (24 if ERA else 40) else '#6f8f7a'),
                       'start': start, 'count': len(Vv), 'address': (ob or {}).get('address', ''), 'name': name})
    if b.get('sculpture'): t['parts'][-1]['noFacade'] = True  # dressed stone, no windows
    count += 1
log(count, 'buildings kept in the city square')

# --- keep OSM buildings the 2013 model does not have ---
# city-build's own OpenStreetMap buildings are set aside the first time (data/raw/cities/<id>/buildings3d-osm/), so reruns start from them.
OSMD = os.path.join('data/raw/cities', CITY, 'buildings3d-osm')
cur = json.load(open(os.path.join(OUT, 'buildings3d-index.json')))
if not str(cur.get('source', '')).startswith('København'):
    shutil.rmtree(OSMD, ignore_errors=True); shutil.copytree(os.path.join(OUT, 'buildings3d'), OSMD)
    json.dump(cur, open(os.path.join(OSMD, 'index.json'), 'w'))
if not os.path.exists(OSMD):  # older builds: set aside the OpenStreetMap buildings the previous output kept
    os.makedirs(OSMD); kept_idx = {'tiles': []}
    for ti, ct in enumerate(cur['tiles']):
        arr = np.frombuffer(gzip.decompress(open(os.path.join(OUT, ct['file']), 'rb').read()), dtype=np.float32)
        ps = [p for p in ct['parts'] if not p['id'].startswith('kk-')]
        if not ps: continue
        chunks, nparts, s = [], [], 0
        for p in ps:
            chunks.append(arr[p['start'] * 5:(p['start'] + p['count']) * 5]); nparts.append({**p, 'start': s}); s += p['count']
        f = f'{ti}.pack'; open(os.path.join(OSMD, f), 'wb').write(gzip.compress(np.concatenate(chunks).tobytes(), 9))
        kept_idx['tiles'].append({'file': 'buildings3d/' + f, 'bbox': ct['bbox'], 'parts': nparts})
    json.dump(kept_idx, open(os.path.join(OSMD, 'index.json'), 'w'))
old = json.load(open(os.path.join(OSMD, 'index.json')))
kind_of = {b['id']: b.get('kind') or '' for b in pack['buildings']}
RAMPART = re.compile(r'^volden$|bastion|skanse', re.I); ramparts = []
nkept = 0
foot_of = {}
for bld in pack['buildings']:
    rr = [r for r in bld.get('rings', []) if len(r) > 2]
    if rr:
        try: foot_of[bld['id']] = shapely.make_valid(Polygon(rr[0], rr[1:]))
        except Exception: pass
def model_share(pid, bb):  # share of an OSM footprint the model's roofs cover (None: footprint unknown)
    fp = foot_of.get(pid)
    if fp is None or fp.is_empty: return None
    xs, zs = np.meshgrid(np.arange(bb[0] + .5, bb[2], 1.0), np.arange(bb[1] + .5, bb[3], 1.0)); xs, zs = xs.ravel(), zs.ravel()
    inside = shapely.contains_xy(fp, xs, zs)
    if not inside.any(): return None
    return float((COVER[cells(xs[inside], zs[inside])] > 0).mean())
for ot in old['tiles']:
    arr = np.frombuffer(gzip.decompress(open(os.path.join(OSMD, os.path.basename(ot['file'])), 'rb').read()), dtype=np.float32)
    for p in ot['parts']:
        b = p['bbox']; gx, gz = int(((b[0] + b[2]) / 2) // 4), int(((b[1] + b[3]) / 2) // 4)
        if ERA and (MODERN.search(p.get('name') or '') or MODERN_KIND.match(kind_of.get(p['id'], ''))): continue
        if not (ERA and RAMPART.search(p.get('name') or '')):
            share = model_share(p['id'], b)
            if (share >= .5) if share is not None else any((gx + i, gz + j) in occ for i in (-1, 0, 1) for j in (-1, 0, 1)): continue
        mx, mz = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        t = tiles.setdefault((int(mx // TILE), int(mz // TILE)), {'arr': [], 'parts': []})
        Vv = arr[p['start'] * 5:(p['start'] + p['count']) * 5]
        start = sum(len(x) for x in t['arr']) // 5
        q = {**p, 'start': start}
        if ERA and RAMPART.search(p.get('name') or ''): ramparts.append(p); continue  # rebuilt below as smooth earthworks
        elif ERA: q.update(color=hexrgb(pick(WALLS_1760, p['id'], 'w')), roofColor=hexrgb(pick(ROOFS_1760, p['id'], 'r')))
        t['arr'].append(Vv); t['parts'].append(q); nkept += 1
log(nkept, 'OpenStreetMap buildings kept where the model has none')

# --- 1760 ramparts: one smooth earthwork per stretch ---
# The ramparts came as three or four nested extrusions (2.6, 5, 7.2 m terraces) whose top edges were pulled inward at
# load time: on bends and narrow pieces the pulled corners crossed over and stood up as loose slabs of grass. Each
# stretch is now one surface: its outline at the foot, rising 0.7 m per metre inland up to its highest terrace, so it
# closes into a ridge where it is narrow and leaves a flat terreplein where it is wide.
if ERA and ramparts:
    foot = {b['id']: Polygon(b['rings'][0]).buffer(0) for b in pack['buildings'] if b.get('rings') and RAMPART.search(b.get('name') or '')}
    rs = sorted([r for r in ramparts if r['id'] in foot and foot[r['id']].area > 4], key=lambda r: -foot[r['id']].area)
    used, earthworks = set(), 0
    for r in rs:
        if r['id'] in used: continue
        P = foot[r['id']]; used.add(r['id']); H = r['height']
        for r2 in rs:
            if r2['id'] in used: continue
            if foot[r2['id']].intersection(P).area >= .9 * foot[r2['id']].area: used.add(r2['id']); H = max(H, r2['height'])
        pts = []
        for part in getattr(P, 'geoms', [P]):
            for ring in [part.exterior, *part.interiors]:
                L = ring.length; n = max(4, int(L / 2))
                pts += [ring.interpolate(k * L / n).coords[0] for k in range(n)]
        x0, z0, x1, z1 = P.bounds
        gx, gz = np.meshgrid(np.arange(x0 + 1.5, x1, 3.0), np.arange(z0 + 1.5, z1, 3.0))
        inner = [(x, z) for x, z in zip(gx.ravel(), gz.ravel()) if P.contains(Point(x, z)) and P.boundary.distance(Point(x, z)) > .8]
        tri = shapely.delaunay_triangles(shapely.MultiPoint(pts + inner))
        rise = lambda x, z: .12 + min(H, P.boundary.distance(Point(x, z)) * .7)
        out = []
        for tg in tri.geoms:
            c = list(tg.exterior.coords)[:3]
            if not P.contains(Polygon(c).representative_point()): continue
            v = [(x, rise(x, z), z) for x, z in c]
            (ax, ay, az), (bx, by, bz), (cx_, cy_, cz) = v
            if (bx - ax) * (cz - az) - (cx_ - ax) * (bz - az) > 0: v = [v[0], v[2], v[1]]  # facing up
            out.append(v)
        if not out: continue
        Pt = np.array(out, dtype=np.float64)
        uv = np.stack([Pt[:, :, 0] / 3.2, Pt[:, :, 2] / 3.2], 2)
        Vv = np.concatenate([Pt, uv], 2).reshape(-1, 5).astype(np.float32)
        mx, mz = P.centroid.x, P.centroid.y
        t = tiles.setdefault((int(mx // TILE), int(mz // TILE)), {'arr': [], 'parts': []})
        start = sum(len(x) for x in t['arr']) // 5
        bb = [round(x0, 2), round(z0, 2), round(x1, 2), round(z1, 2)]
        t['arr'].append(Vv.ravel()); t['parts'].append({'id': r['id'], 'bbox': bb, 'height': round(float(H), 2), 'texture': None, 'name': r.get('name') or 'Volden',
            'color': hexrgb('#6f8a4a'), 'roofColor': hexrgb('#7d9a52'), 'noFacade': True, 'embankment': 1, 'start': start, 'count': len(Vv), 'address': ''})
        earthworks += 1
    log(earthworks, 'rampart stretches as smooth earthworks (from', len(ramparts), 'terrace pieces)')

# --- write --- (a tile holds at most 255 parts: the near-tile shell mask addresses 256)
d3 = os.path.join(OUT, 'buildings3d')
if opt('--out'): d3 = opt('--out'); os.makedirs(d3, exist_ok=True)
for f in os.listdir(d3): os.remove(os.path.join(d3, f))
out = []
for k, t in sorted(tiles.items()):
    for c0 in range(0, len(t['parts']), 255):
        ps = t['parts'][c0:c0 + 255]; arr_all = np.concatenate(t['arr'])
        chunks, nparts, s = [], [], 0
        for p in ps:
            chunks.append(arr_all[p['start'] * 5:(p['start'] + p['count']) * 5]); nparts.append({**p, 'start': s}); s += p['count']
        data = np.concatenate(chunks).astype(np.float32)
        file = f'buildings3d/{len(out)}.pack'
        open(os.path.join(d3, os.path.basename(file)), 'wb').write(gzip.compress(data.tobytes(), 9))
        bb = [min(p['bbox'][0] for p in nparts), min(p['bbox'][1] for p in nparts), max(p['bbox'][2] for p in nparts), max(p['bbox'][3] for p in nparts)]
        out.append({'file': file, 'bbox': bb, 'parts': nparts})
idx_path = os.path.join(os.path.dirname(d3), 'buildings3d-index.json') if not opt('--out') else os.path.join(d3, '..', 'buildings3d-index.json')
json.dump({'source': 'København 3D bymodel (Københavns Kommune, 2013, CC BY 4.0) + OpenStreetMap for newer buildings',
           'tiles': out, 'buildings': count + nkept}, open(idx_path, 'w'))
credit = 'Buildings: København 3D bymodel © Københavns Kommune 2013, CC BY 4.0.'
idx = json.load(open('public/cities/index.json'))
for c in idx['cities']:
    if c['id'] == CITY and credit not in c.get('attribution', ''): c['attribution'] = (c.get('attribution', '') + ' ' + credit).strip()
    if c['id'] == CITY: c['estimatedFacades'] = True
json.dump(idx, open('public/cities/index.json', 'w'), indent=1, ensure_ascii=False)
log(len(out), 'tiles written')
