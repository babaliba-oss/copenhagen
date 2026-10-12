# Copenhagen's official 3D buildings → worldhood building tiles.
#
# Source: "København 3D bymodel" (Københavns Kommune, 2013), CC BY 4.0
#   https://www.opendata.dk/city-of-copenhagen/kobenhavn-3d-bymodel
#   Download "Bymodel 3D København Bygninger DXF" and pass the zip path as the first argument.
# The DXF files are LOD2 meshes (3DFACE) in ETRS89 / UTM 32N with three layers: roof
# ("Tagflade"), facade ("Facadeflade") and floor ("Bundflade", skipped).
#
# Faces are grouped into buildings by shared vertices, levelled to their lowest point, split into a
# wall part and a roof part, coloured from a Copenhagen palette and written as the same gzip Float32
# (x, y, z, u, v) tiles that scripts/city-build.mjs produces. OpenStreetMap buildings from the
# existing build are kept wherever the 2013 model has nothing (newer buildings).
#
#   python3 scripts/kk-buildings.py /path/to/bymodel3dkobenhavnbygningerdxf.zip copenhagen
import gzip, json, math, os, re, sys, zipfile, tempfile, hashlib
import numpy as np
from pyproj import Transformer
from ezdxf.addons import iterdxf

ZIP, CITY = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 'copenhagen')
# --era 1760: only faces on a footprint of the (period-filtered) OSM build are kept, heights are brought down to
# 18th-century eaves, and walls and roofs take period colours (limewash ochre, ox-blood, grey; red tile roofs).
ERA = int(sys.argv[sys.argv.index('--era') + 1]) if '--era' in sys.argv else None
reg = next(c for c in json.load(open('public/cities/index.json'))['cities'] if c['id'] == CITY)
OUT = os.path.join('public', reg['dataRoot'].lstrip('/'))
EXTENT = round(json.load(open(f'cities/{CITY}/city.json'))['radiusMetres'] * 1.25)
to_local = Transformer.from_crs('EPSG:25832', reg['projection'], always_xy=True)
to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:25832', always_xy=True)
cx, cy = to_utm.transform(*reg['origin'])
TILE = 200

# --- which district files reach the play area (read the DXF header extents only) ---
z = zipfile.ZipFile(ZIP)
files = []
for n in z.namelist():
    if not n.endswith('_bfm2011.dxf'): continue
    head = z.open(n).read(6000).decode('latin1')
    ext = [tuple(map(float, re.search(v + r'\s*\n\s*10\s*\n\s*([-\d.]+)\s*\n\s*20\s*\n\s*([-\d.]+)', head).groups())) for v in (r'\$EXTMIN', r'\$EXTMAX')]
    R = EXTENT * 1.05
    if ext[1][0] > cx - R and ext[0][0] < cx + R and ext[1][1] > cy - R and ext[0][1] < cy + R: files.append(n)
print(len(files), 'district files overlap the city', flush=True)

# --- read faces ---
tris, kinds = [], []  # tris: (3,3) UTM xyz ; kinds: 0 wall, 1 roof
tmp = tempfile.mkdtemp()
for n in files:
    p = z.extract(n, tmp)
    for e in iterdxf.opendxf(p).modelspace():
        if e.dxftype() != '3DFACE': continue
        lay = e.dxf.layer
        if 'Bundflade' in lay: continue
        k = 1 if 'Tagflade' in lay else 0
        v = [tuple(e.dxf.vtx0), tuple(e.dxf.vtx1), tuple(e.dxf.vtx2), tuple(e.dxf.vtx3)]
        if abs(v[0][0] - cx) > EXTENT + 60 or abs(v[0][1] - cy) > EXTENT + 60: continue
        tris.append(v[:3]); kinds.append(k)
        if v[3] != v[2]: tris.append([v[0], v[2], v[3]]); kinds.append(k)
    os.remove(p)
    print(' ', n.split('/')[-1], len(tris), flush=True)
T = np.array(tris, dtype=np.float64); K = np.array(kinds, dtype=np.int8)
# drop degenerate faces
a = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1)
T, K = T[a > 1e-4], K[a > 1e-4]
print(len(T), 'faces', flush=True)

# --- group faces into buildings: union-find over shared (rounded) vertices ---
keys = np.round(T.reshape(-1, 3)[:, :2] * 20).astype(np.int64)  # 5 cm grid, plan only (walls share roof edges)
kid = keys[:, 0] * 4000003 + keys[:, 1]
uniq, inv = np.unique(kid, return_inverse=True)
parent = np.arange(len(uniq))
def find(i):
    r = i
    while parent[r] != r: r = parent[r]
    while parent[i] != r: parent[i], i = r, parent[i]
    return r
inv = inv.reshape(-1, 3)
for a_, b_, c_ in inv:
    ra, rb, rc = find(a_), find(b_), find(c_)
    parent[rb] = ra; parent[rc] = ra
comp = np.array([find(i) for i in inv[:, 0]])

# --- to local game coordinates ---
flat = T.reshape(-1, 3)
lx, ly = to_local.transform(flat[:, 0], flat[:, 1])
L = np.stack([np.array(lx), flat[:, 2], -np.array(ly)], 1).reshape(-1, 3, 3)  # x, height, z (=-north)

# --- split connected blocks into individual houses using the OpenStreetMap footprints ---
# Terraced houses share walls, so the mesh alone merges a whole block. Each face goes to the OSM
# footprint under it (walls: probed 0.6 m to either side), keeping per-house colours and names.
from PIL import Image, ImageDraw
pack = json.loads(gzip.decompress(open(os.path.join(OUT, 'city.pack'), 'rb').read()))
G = 1.0; N = int(2 * (EXTENT + 100) / G); off = EXTENT + 100
img = Image.new('I', (N, N), 0); dr = ImageDraw.Draw(img)
osm = [None]
for bld in pack['buildings']:
    for ring in bld['rings'][:1]:
        if len(ring) > 2: dr.polygon([((x + off) / G, (z + off) / G) for x, z in ring], fill=len(osm))
    osm.append(bld)
grid = np.array(img, dtype=np.int32)
def look(x, z):
    i = np.clip(((z + off) / G).astype(int), 0, N - 1); j = np.clip(((x + off) / G).astype(int), 0, N - 1)
    return grid[i, j]
c = L.mean(1); cx_, cz_ = c[:, 0], c[:, 2]
own = look(cx_, cz_)
d = L[:, 1] - L[:, 0]; nx, nz = -d[:, 2], d[:, 0]; nl = np.hypot(nx, nz) + 1e-9; nx, nz = nx / nl * .6, nz / nl * .6
wall = K == 0
o1, o2 = look(cx_ + nx, cz_ + nz), look(cx_ - nx, cz_ - nz)
own = np.where(wall & (own == 0), np.where(o1 > 0, o1, o2), own)
group = np.where(own > 0, own, len(osm) + comp)  # unmatched faces keep their mesh component
bids, bidx = np.unique(group, return_inverse=True)
print(len(bids), 'buildings', int((own > 0).mean() * 100), '% of faces matched to an OSM footprint', flush=True)

WALLS_1760 = ['#d9b26f', '#e8d39a', '#8e3b2e', '#bdb6a6', '#ece4d0', '#d99c7f', '#a8ae96', '#a5503a', '#c99a5b', '#e3d5b8', '#b46e4f']
ROOFS_1760 = ['#9c4a30', '#8a3f2a', '#a85a3a', '#93442d', '#4d4f52']
MODERN = re.compile(r'rådhus|glyptotek|tivoli|hovedbanegård|politigård|nationalmuseet|det kongelige bibliotek|operaen|skuespilhus', re.I)
LANDMARK = re.compile(r'kirke|kirken|tårn|børsen|slot|christiansborg|kastellet|amalienborg|church|tower|palace', re.I)
WALLS = ['#e8d9b0', '#f0e2c4', '#e5c27a', '#d9a45b', '#c8664a', '#b5523b', '#efe9dc', '#d8d2c4', '#9c4f3a', '#e9c9a1', '#cfd8c4', '#e2b8a4', '#f2efe6', '#bfb7a6']
ROOFS = ['#8a3e2c', '#7a3626', '#9a4a32', '#4b4f55', '#3f4348', '#5a5f66', '#6f8f7a']
def pick(pal, s, salt):
    h = int(hashlib.md5((salt + s).encode()).hexdigest(), 16)
    return pal[h % len(pal)]
hexrgb = lambda h: [round(int(h[i:i + 2], 16) / 255, 3) for i in (1, 3, 5)]

tiles = {}
occ = set()  # 4 m cells covered by the model, to keep only OSM buildings it lacks
order = np.argsort(bidx)
starts = np.searchsorted(bidx[order], np.arange(len(bids)))
ends = np.append(starts[1:], len(order))
count = 0
for b in range(len(bids)):
    fi = order[starts[b]:ends[b]]
    pts = L[fi]
    xs, zs, ys = pts[:, :, 0], pts[:, :, 2], pts[:, :, 1]
    mx, mz = xs.mean(), zs.mean()
    if abs(mx) > EXTENT or abs(mz) > EXTENT: continue
    base = ys.min(); h = ys.max() - base
    if h < 2 or len(fi) < 4: continue
    gid = int(bids[b]); ob = osm[gid] if gid < len(osm) else None
    if ERA and (not ob or ob.get('name') == 'Volden' or MODERN.search(ob.get('name') or '')): continue
    bid = 'kk-' + (ob['id'] if ob else f'{int(round(mx))}-{int(round(mz))}')
    bbox = [round(float(xs.min()), 2), round(float(zs.min()), 2), round(float(xs.max()), 2), round(float(zs.max()), 2)]
    if (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 60000: continue
    for gx in range(int(bbox[0] // 4), int(bbox[2] // 4) + 1):
        for gz in range(int(bbox[1] // 4), int(bbox[3] // 4) + 1): occ.add((gx, gz))
    key = (int(mx // TILE), int(mz // TILE))
    t = tiles.setdefault(key, {'arr': [], 'parts': []})
    sel = fi
    P = L[sel].copy(); P[:, :, 1] = P[:, :, 1] - base + .12
    name = (ob or {}).get('name', '')
    if ERA:
        cap = 7 if re.search(r'frederiks kirke|marmorkirken', name, re.I) else (None if LANDMARK.search(name) else 16)
        if cap and h > cap: P[:, :, 1] *= cap / h; h = cap
    # UVs in metres (walls: along the wall / up; roofs: plan), only used if a texture is added later
    uv = np.zeros(P.shape[:2] + (2,))
    d = P[:, 1] - P[:, 0]; ln = np.hypot(d[:, 0], d[:, 2]) + 1e-9
    ux, uz = d[:, 0] / ln, d[:, 2] / ln
    isw = (K[sel] == 0)[:, None]
    uv[:, :, 0] = np.where(isw, (P[:, :, 0] * ux[:, None] + P[:, :, 2] * uz[:, None]) / 3.2, P[:, :, 0] / 3.2)
    uv[:, :, 1] = np.where(isw, P[:, :, 1] / 3.2, P[:, :, 2] / 3.2)
    V = np.concatenate([P, uv], 2).reshape(-1, 5).astype(np.float32)
    start = sum(len(x) for x in t['arr']) // 5
    t['arr'].append(V.ravel())
    t['parts'].append({'id': bid, 'bbox': bbox, 'height': round(float(h), 2), 'texture': None,
                       'color': hexrgb(pick(WALLS_1760 if ERA else WALLS, bid, 'w')), 'roofColor': hexrgb(pick(ROOFS_1760 if ERA else ROOFS, bid, 'r') if h < (24 if ERA else 40) else '#6f8f7a'),
                       'start': start, 'count': len(V), 'address': (ob or {}).get('address', ''), 'name': (ob or {}).get('name', '')})
    count += 1
print(count, 'buildings kept in the city square', flush=True)

# --- keep OSM buildings the 2013 model does not have ---
# city-build's own OpenStreetMap buildings are set aside the first time (data/raw/cities/<id>/buildings3d-osm/), so reruns start from them.
import shutil
OSMD = os.path.join('data/raw/cities', CITY, 'buildings3d-osm')
cur = json.load(open(os.path.join(OUT, 'buildings3d-index.json')))
if not str(cur.get('source', '')).startswith('København'):
    shutil.rmtree(OSMD, ignore_errors=True); shutil.copytree(os.path.join(OUT, 'buildings3d'), OSMD)
    json.dump(cur, open(os.path.join(OSMD, 'index.json'), 'w'))
if not os.path.exists(OSMD):  # older builds: only the previous output is left; keep what it kept
    OSMD = os.path.join(OUT, 'buildings3d'); json.dump(cur, open('/tmp/kk-prev-index.json', 'w'))
    old = cur
    import io
    _cache = {os.path.basename(t['file']): open(os.path.join(OSMD, os.path.basename(t['file'])), 'rb').read() for t in cur['tiles']}
else:
    old = json.load(open(os.path.join(OSMD, 'index.json'))); _cache = None
kept = 0
for ot in old['tiles']:
    raw = _cache[os.path.basename(ot['file'])] if _cache else open(os.path.join(OSMD, os.path.basename(ot['file'])), 'rb').read()
    arr = np.frombuffer(gzip.decompress(raw), dtype=np.float32)
    for p in ot['parts']:
        b = p['bbox']; gx, gz = int(((b[0] + b[2]) / 2) // 4), int(((b[1] + b[3]) / 2) // 4)
        if ERA and MODERN.search(p.get('name') or ''): continue
        if not (ERA and p.get('name') == 'Volden') and any((gx + i, gz + j) in occ for i in (-1, 0, 1) for j in (-1, 0, 1)): continue
        mx, mz = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        t = tiles.setdefault((int(mx // TILE), int(mz // TILE)), {'arr': [], 'parts': []})
        V = arr[p['start'] * 5:(p['start'] + p['count']) * 5]
        start = sum(len(x) for x in t['arr']) // 5
        q = {**p, 'start': start}
        if ERA and p.get('name') == 'Volden': q.update(color=hexrgb('#6f8a4a'), roofColor=hexrgb('#7d9a52'), noFacade=True)
        elif ERA: q.update(color=hexrgb(pick(WALLS_1760, p['id'], 'w')), roofColor=hexrgb(pick(ROOFS_1760, p['id'], 'r')))
        t['arr'].append(V); t['parts'].append(q); kept += 1
print(kept, 'OpenStreetMap buildings kept where the model has none', flush=True)

# --- write ---
d3 = os.path.join(OUT, 'buildings3d')
for f in os.listdir(d3): os.remove(os.path.join(d3, f))
out = []
for i, (k, t) in enumerate(sorted(tiles.items())):
    data = np.concatenate(t['arr']).astype(np.float32)
    file = f'buildings3d/{i}.pack'
    open(os.path.join(OUT, file), 'wb').write(gzip.compress(data.tobytes(), 9))
    bb = [min(p['bbox'][0] for p in t['parts']), min(p['bbox'][1] for p in t['parts']), max(p['bbox'][2] for p in t['parts']), max(p['bbox'][3] for p in t['parts'])]
    out.append({'file': file, 'bbox': bb, 'parts': t['parts']})
json.dump({'source': 'København 3D bymodel (Københavns Kommune, 2013, CC BY 4.0) + OpenStreetMap for newer buildings',
           'tiles': out, 'buildings': count + kept}, open(os.path.join(OUT, 'buildings3d-index.json'), 'w'))
credit = 'Buildings: København 3D bymodel © Københavns Kommune 2013, CC BY 4.0.'
idx = json.load(open('public/cities/index.json'))
for c in idx['cities']:
    if c['id'] == CITY and credit not in c.get('attribution', ''): c['attribution'] = (c.get('attribution', '') + ' ' + credit).strip()
    if c['id'] == CITY: c['estimatedFacades'] = True
json.dump(idx, open('public/cities/index.json', 'w'), indent=1, ensure_ascii=False)
print(len(out), 'tiles written', flush=True)
