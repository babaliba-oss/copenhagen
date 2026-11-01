#!/usr/bin/env python3
"""Copenhagen's own traffic rules on the road graph: one-way streets and signalled junctions, from the City of Copenhagen's
map data (Københavns Kommune, CC BY 4.0, wfs-kbhkort.kk.dk k101: ensrettede_gader, trafiksignal_oversigt; GeoJSON in EPSG:4326).

  python3 scripts/traffic-rules.py <wfs dir> copenhagen

Each road edge in mobility.json is named from the drawn street it runs on (city.pack roads, OSM names, as
traffic-counts.py). Then:
- One-way: an edge runs along a KK one-way street when at least two of its quarter points lie within 6 m of one of the
  street's lines (same name, or the edge unnamed within 3 m), parallel to it. Of a two-way pair the edge against the
  street's direction is dropped (the other keeps to the middle, as OSM one-ways); a single edge the wrong way is turned
  round. A change that would leave part of the network unreachable by car (a one-way stub at the map's edge) is undone.
  The per-edge arrays already there (traffic, bikeTraffic) are kept in step.
- Signals: every KK signalled junction with no road edge carrying a signal ending within 30 m gets one, at its point,
  on the edges ending within 27 m (the rule city-build.mjs uses for OSM's highway=traffic_signals).
Run after traffic-counts.py. Rerunning changes nothing more.
"""
import gzip, json, math, re, sys
from collections import defaultdict
from pyproj import Transformer
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.prepared import prep

SRC, CID = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'copenhagen')
OUT = f'public/cities/{CID}'
city = json.loads(gzip.decompress(open(f'{OUT}/city.pack', 'rb').read()))
mob = json.load(open(f'{OUT}/mobility.json', encoding='utf8'))
nodes, edges = mob['roads']['nodes'], mob['roads']['edges']
to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
def local(lon, lat): a, b = to_local.transform(lon, lat); return a, -b
norm = lambda s: re.sub(r'[^a-z0-9æøå]', '', re.sub(r'\(.*?\)', '', (s or '').lower().replace('gl.', 'gammel').replace('farimagsg.', 'farimagsgade')))
load = lambda name: json.load(open(f'{SRC}/{name}.json', encoding='utf8'))['features']

# --- name the edges from the drawn street polygons they run in (as traffic-counts.py) ---
C = 50
grid = defaultdict(list)
for r in city['roads']:
    if not r.get('name') or 'rings' not in r: continue
    x0, z0, x1, z1 = r['bbox']
    for i in range(math.floor(x0 / C), math.floor(x1 / C) + 1):
        for j in range(math.floor(z0 / C), math.floor(z1 / C) + 1): grid[i, j].append(r)

def inside(ring, x, z):
    c = False
    for k in range(len(ring)):
        (ax, az), (bx, bz) = ring[k - 1], ring[k]
        if (az > z) != (bz > z) and x < ax + (z - az) * (bx - ax) / (bz - az): c = not c
    return c

def name_at(x, z):
    for r in grid.get((math.floor(x / C), math.floor(z / C)), ()):
        b = r['bbox']
        if b[0] <= x <= b[2] and b[1] <= z <= b[3] and inside(r['rings'][0], x, z) and not any(inside(h, x, z) for h in r['rings'][1:]): return r['name']
    return None

def length(pts): return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
def along(pts, f):
    """Point and unit direction a fraction f along a polyline."""
    d = length(pts) * f
    for a, b in zip(pts, pts[1:]):
        l = math.dist(a, b)
        if d <= l and l: t = d / l; return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), ((b[0] - a[0]) / l, (b[1] - a[1]) / l)
        d -= l
    a, b = pts[-2], pts[-1]; l = math.dist(a, b) or 1
    return tuple(pts[-1]), ((b[0] - a[0]) / l, (b[1] - a[1]) / l)

def edge_name(e):
    votes = defaultdict(int)
    for f in (.25, .5, .75):
        n = name_at(*along(e['points'], f)[0])
        if n: votes[n] += 1
    return max(votes, key=votes.get) if votes else None

# --- KK lines as segments in a grid ---
class Lines:
    def __init__(self, feats, key):
        self.cells = defaultdict(list)
        for f in feats:
            g = f['geometry']; parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
            p = f['properties']
            for part in parts:
                pts = [local(*c[:2]) for c in part]
                for a, b in zip(pts, pts[1:]):
                    if a == b: continue
                    s = (a, b, norm(p.get('vejnavn')), key(p))
                    for i in range(math.floor(min(a[0], b[0]) / C) - 1, math.floor(max(a[0], b[0]) / C) + 2):
                        for j in range(math.floor(min(a[1], b[1]) / C) - 1, math.floor(max(a[1], b[1]) / C) + 2): self.cells[i, j].append(s)
    def near(self, x, z, r):
        """(distance, cos of the segment's direction against d, name, value) of the segments within r."""
        out = []
        for a, b, name, val in self.cells.get((math.floor(x / C), math.floor(z / C)), ()):
            dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz
            t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2))
            d = math.hypot(a[0] + dx * t - x, a[1] + dz * t - z)
            if d < r: l = math.sqrt(l2); out.append((d, (dx / l, dz / l), name, val))
        return out

def match(lines, pts, name, r_named, r_any, parallel=.8):
    """Per quarter point the best matching KK segment: (sign of direction, value) or None."""
    res = []
    for f in (.25, .5, .75):
        (x, z), (ux, uz) = along(pts, f)
        best = None
        for d, (sx, sz), n, val in lines.near(x, z, r_named):
            c = ux * sx + uz * sz
            if abs(c) < parallel: continue
            ok = n and name and n == name or d < r_any and (not name or not n)
            if ok and (best is None or d < best[0]): best = (d, 1 if c > 0 else -1, val)
        res.append(best and best[1:])
    return res

names = [edge_name(e) for e in edges]
nnames = [norm(n) if n else None for n in names]
print(f'{sum(1 for n in names if n)}/{len(edges)} road edges named')

# ================= one-way streets =================
ow_feats = load('ensrettede_gader')
oneway = Lines(ow_feats, lambda p: p.get('ogc_fid'))
found = set()
geo_key = lambda e: (e['from'], e['to'], tuple(map(tuple, e['points'])))
by_geo = {geo_key(e): i for i, e in enumerate(edges)}
def twin(i):
    e = edges[i]; return by_geo.get((e['to'], e['from'], tuple(map(tuple, reversed(e['points'])))))

drop, flip, kept = set(), set(), set()
already = 0
for i, e in enumerate(edges):
    if i in drop or i in flip: continue
    m = [s for s in match(oneway, e['points'], nnames[i], 6, 3, .85) if s]
    if len(m) < 2 or len({s[0] for s in m}) > 1: continue
    sign = m[0][0]; t = twin(i); found.update(s[1] for s in m)
    if t is not None:
        if sign < 0: drop.add(i); kept.add(t)
        else: drop.add(t); kept.add(i)
    elif sign < 0: flip.add(i)
    else: already += 1

def scc_nodes(es):
    """Nodes of the largest strongly connected component (iterative Tarjan, as prune-mobility.py)."""
    n = len(nodes); adj = [[] for _ in range(n)]
    for f, t in es: adj[f].append(t)
    idx = [None] * n; low = [0] * n; on = [False] * n; stack = []; best = []; counter = 0
    for s in range(n):
        if idx[s] is not None or not adj[s]: continue
        work = [(s, 0)]
        while work:
            v, i = work.pop()
            if i == 0: idx[v] = low[v] = counter; counter += 1; stack.append(v); on[v] = True
            recurse = False
            while i < len(adj[v]):
                w = adj[v][i]; i += 1
                if idx[w] is None: work.append((v, i)); work.append((w, 0)); recurse = True; break
                elif on[w]: low[v] = min(low[v], idx[w])
            if recurse: continue
            if low[v] == idx[v]:
                comp = []
                while True:
                    w = stack.pop(); on[w] = False; comp.append(w)
                    if w == v: break
                if len(comp) > len(best): best = comp
            if work: u = work[-1][0]; low[u] = min(low[u], low[v])
    return set(best)

def directed():
    for i, e in enumerate(edges):
        if i in drop: continue
        yield (e['to'], e['from']) if i in flip else (e['from'], e['to'])
full = scc_nodes((e['from'], e['to']) for e in edges)
reverted = 0
while True:
    lost = full - scc_nodes(directed())
    if not lost: break
    undo = {i for i in drop | flip if edges[i]['from'] in lost or edges[i]['to'] in lost}
    if not undo: undo = drop | flip
    for i in undo:
        if i in drop: drop.discard(i); t = twin(i); kept.discard(t)
        flip.discard(i); reverted += 1
print(f'one-way: {len({f["properties"]["ogc_fid"] for f in ow_feats} & found)}/{len(ow_feats)} KK one-way streets found on the road graph;')
print(f'  {already} edges already right, {len(drop)} against a one-way street dropped, {len(flip)} turned round, {reverted} changes undone (would cut off part of the network)')

for i in flip:
    e = edges[i]; e['from'], e['to'] = e['to'], e['from']; e['points'] = e['points'][::-1]
for i in kept - drop: edges[i]['lane'] = .35
keep = [i for i in range(len(edges)) if i not in drop]
for k in ('traffic', 'bikeTraffic'):
    if isinstance(mob.get(k), list) and len(mob[k]) == len(edges): mob[k] = [mob[k][i] for i in keep]
edges[:] = [edges[i] for i in keep]; names = [names[i] for i in keep]; nnames = [nnames[i] for i in keep]
mob['roads']['edges'] = edges

# ================= signalled junctions =================
signals = mob['signals']
def ends_near(es, p, r): return [i for i, e in enumerate(es) if math.dist(e['points'][-1], p) < r]
kk = [((f['properties'].get('krydsets_navn') or '').strip(), local(*f['geometry']['coordinates'][:2])) for f in load('trafiksignal_oversigt')]
covered_before = sum(1 for _, p in kk if any(edges[i]['signal'] >= 0 for i in ends_near(edges, p, 30)))
added, off = 0, []
for name, p in kk:
    near = ends_near(edges, p, 30)
    if any(edges[i]['signal'] >= 0 for i in near): continue
    road = [i for i in ends_near(edges, p, 27) if edges[i]['signal'] < 0]
    if not road:  # drawn off to the side: the nearest node within 45 m of it
        k = min(range(len(nodes)), key=lambda k: math.dist(nodes[k], p))
        if math.dist(nodes[k], p) > 45: off.append(name); continue
        p = tuple(nodes[k]); road = [i for i in ends_near(edges, p, 27) if edges[i]['signal'] < 0]
        if not road: off.append(name); continue
    s = len(signals); signals.append({'p': [round(p[0], 2), round(p[1], 2)], 'name': name})
    for i in road: edges[i]['signal'] = s
    for w in mob['walks']['edges']:
        if w['signal'] < 0 and math.dist(w['points'][-1], p) < 27: w['signal'] = s
    added += 1
covered_after = sum(1 for _, p in kk if any(edges[i]['signal'] >= 0 for i in ends_near(edges, p, 30)))
print(f'signals: {covered_before}/{len(kk)} KK signalled junctions had a mapped signal; {added} added; {covered_after}/{len(kk)} now; off the network: {off}')

mob['rulesSource'] = 'One-way streets, signalled junctions: Københavns Kommune (CC BY 4.0), wfs-kbhkort.kk.dk k101'
open(f'{OUT}/mobility.json', 'w', encoding='utf8').write(json.dumps(mob, separators=(',', ':'), ensure_ascii=False))
