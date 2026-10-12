#!/usr/bin/env python3
"""Build worldhood's raw Overpass cache (data/raw/cities/<id>/*.json) from a local .osm.pbf extract, for when
the public Overpass servers are down. Emulates the six queries in scripts/city-build.mjs over the square
that contains its search circle, and turns the coastline into sea polygons (Overpass has no sea areas either;
city-build reads them as natural=water relations).

  pip install osmium shapely
  python3 scripts/pbf-to-overpass.py /path/Copenhagen.osm.pbf copenhagen
"""
import json, math, os, re, sys
import osmium
from shapely.geometry import LineString, Point, box
from shapely.ops import polygonize, unary_union

PBF, CID = sys.argv[1], sys.argv[2]
cfg = json.load(open(f'cities/{CID}/city.json'))
lon0, lat0 = cfg['origin']; R = cfg['radiusMetres']; EXT = round(R * 1.25); reach = EXT * 1.45
dlat = reach / 111320; dlon = reach / (111320 * math.cos(math.radians(lat0)))
S, N, W, E = lat0 - dlat, lat0 + dlat, lon0 - dlon, lon0 + dlon
inb = lambda lon, lat: W <= lon <= E and S <= lat <= N
RAW = f'data/raw/cities/{CID}'; os.makedirs(RAW, exist_ok=True)

AREA_WAY = [('building', None), ('natural', r'^water$'), ('waterway', r'^riverbank$'), ('leisure', r'^(park|garden|playground|pitch)$'),
            ('landuse', r'^(grass|forest|recreation_ground|meadow|cemetery|village_green)$'), ('natural', r'^(wood|scrub|grassland)$'), ('area:highway', None)]
def is_area_way(t):
    if t.get('highway') == 'pedestrian' and t.get('area') == 'yes': return True
    return any(k in t and (rx is None or re.search(rx, t[k])) for k, rx in AREA_WAY)
def is_area_rel(t):
    return (t.get('building') and t.get('type') == 'multipolygon') or t.get('natural') == 'water' or t.get('leisure') == 'park'
PLACE = [('tourism', r'^(attraction|museum|viewpoint|gallery)$'), ('place', r'^square$'), ('amenity', r'^(townhall|theatre|concert_hall|library|place_of_worship)$'),
         ('railway', r'^station$'), ('historic', r'^(monument|memorial|castle|building|church)$')]
is_place = lambda t: 'name' in t and any(k in t and re.search(rx, t[k]) for k, rx in PLACE)
is_route = lambda t: t.get('type') == 'route' and re.search(r'^(tram|bus|trolleybus|light_rail)$', t.get('route', ''))
is_stop = lambda t: t.get('railway') == 'tram_stop' or t.get('public_transport') == 'stop_position' or t.get('highway') == 'bus_stop'
tags = lambda o: {t.k: t.v for t in o.tags}

# ---- pass 1: relations, remember which ways and nodes they need ----
class Rels(osmium.SimpleHandler):
    def __init__(s): super().__init__(); s.rarea = []; s.rplace = []; s.rroute = []; s.need_w = set(); s.need_n = set()
    def relation(s, r):
        t = tags(r); mem = [(m.type, m.ref, m.role) for m in r.members]
        if is_area_rel(t): s.rarea.append((r.id, t, mem))
        elif is_route(t): s.rroute.append((r.id, t, mem))
        elif is_place(t): s.rplace.append((r.id, t, mem))
        else: return
        for ty, ref, _ in mem:
            (s.need_w if ty == 'w' else s.need_n).add(ref) if ty in 'wn' else None
rels = Rels(); rels.apply_file(PBF); print('relations', len(rels.rarea), len(rels.rroute), len(rels.rplace))

# ---- pass 2: ways and nodes with locations ----
class Ways(osmium.SimpleHandler):
    def __init__(s):
        super().__init__(); s.geom = {}; s.areas = []; s.high = []; s.hnodes = {}; s.coast = []; s.points = []; s.places = []; s.stops = []; s.nodes = {}
    def node(s, n):
        if not n.location.valid(): return
        lon, lat = n.location.lon, n.location.lat
        if n.id in rels.need_n: s.nodes[n.id] = (lon, lat)
        if not inb(lon, lat) or not len(n.tags): return
        t = tags(n); base = {'type': 'node', 'id': n.id, 'lat': lat, 'lon': lon, 'tags': t}
        if t.get('natural') == 'tree' or t.get('highway') == 'traffic_signals': s.points.append(base)
        if is_place(t): s.places.append(base)
        if is_stop(t): s.stops.append(base)
    def way(s, w):
        try: pts = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError: return
        if not pts: return
        t = tags(w); here = any(inb(*p) for p in pts)
        g = [{'lat': la, 'lon': lo} for lo, la in pts]
        if w.id in rels.need_w: s.geom[w.id] = g
        if not here: return
        if 'highway' in t:
            s.high.append({'type': 'way', 'id': w.id, 'nodes': [n.ref for n in w.nodes], 'tags': t})
            for n, (lo, la) in zip(w.nodes, pts): s.hnodes[n.ref] = {'type': 'node', 'id': n.ref, 'lat': la, 'lon': lo}
        if is_area_way(t): s.areas.append({'type': 'way', 'id': w.id, 'tags': t, 'geometry': g})
        if t.get('natural') == 'coastline': s.coast.append(LineString(pts))
        if is_place(t):
            s.places.append({'type': 'way', 'id': w.id, 'tags': t, 'center': {'lat': sum(p[1] for p in pts) / len(pts), 'lon': sum(p[0] for p in pts) / len(pts)}})
ways = Ways(); ways.apply_file(PBF, locations=True, idx='flex_mem')

def rel_members(mem, clip=False):
    out = []
    for ty, ref, role in mem:
        if ty == 'w' and ref in ways.geom: out.append({'type': 'way', 'ref': ref, 'role': role, 'geometry': ways.geom[ref]})
        elif ty == 'n' and ref in ways.nodes: out.append({'type': 'node', 'ref': ref, 'role': role, 'lon': ways.nodes[ref][0], 'lat': ways.nodes[ref][1]})
    return out
def touches(members):
    return any(inb(g['lon'], g['lat']) for m in members for g in (m.get('geometry') or [m]) if 'lat' in g)

areas = list(ways.areas)
for rid, t, mem in rels.rarea:
    m = rel_members(mem)
    if m and touches(m): areas.append({'type': 'relation', 'id': rid, 'tags': t, 'members': m})
# sea from the coastline: land lies to the left of a coastline way
WORLD = box(W, S, E, N)
if ways.coast:
    faces = list(polygonize(unary_union(ways.coast + [WORLD.exterior])))
    sea_pts, land_pts = [], []
    for ln in ways.coast:
        c = list(ln.coords)
        for i in range(0, len(c) - 1, 2):
            (ax, ay), (bx, by) = c[i], c[i + 1]; L = math.hypot(bx - ax, by - ay) or 1
            mx, my = (ax + bx) / 2, (ay + by) / 2; nx, ny = -(by - ay) / L * 2e-5, (bx - ax) / L * 2e-5
            if inb(mx, my): land_pts.append(Point(mx + nx, my + ny)); sea_pts.append(Point(mx - nx, my - ny))
    sea = [f for f in faces if sum(f.contains(p) for p in sea_pts) > sum(f.contains(p) for p in land_pts)]
    for i, f in enumerate(sea):
        mem = [{'type': 'way', 'ref': -1, 'role': 'outer', 'geometry': [{'lat': y, 'lon': x} for x, y in f.exterior.coords]}]
        mem += [{'type': 'way', 'ref': -1, 'role': 'inner', 'geometry': [{'lat': y, 'lon': x} for x, y in r.coords]} for r in f.interiors]
        areas.append({'type': 'relation', 'id': -(1000 + i), 'tags': {'natural': 'water', 'water': 'sea', 'type': 'multipolygon'}, 'members': mem})
    print('sea faces', len(sea), 'of', len(faces))

places = list(ways.places)
for rid, t, mem in rels.rplace:
    m = rel_members(mem); pts = [(g['lon'], g['lat']) for x in m for g in (x.get('geometry') or [x]) if 'lat' in g]
    if pts:
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        if inb(*c): places.append({'type': 'relation', 'id': rid, 'tags': t, 'center': {'lat': c[1], 'lon': c[0]}})
transit = []
for rid, t, mem in rels.rroute:
    m = rel_members(mem)
    if m and touches(m): transit.append({'type': 'relation', 'id': rid, 'tags': t, 'members': m})

def dump(name, els):
    json.dump({'elements': els}, open(f'{RAW}/{name}.json', 'w')); print(name, len(els))
dump('areas', areas)
dump('highways', ways.high + list(ways.hnodes.values()))
dump('nodes', ways.points)
dump('places', places)
dump('transit', transit)
dump('stops', ways.stops)
