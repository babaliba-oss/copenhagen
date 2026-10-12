#!/usr/bin/env python3
"""Railway tracks from the OpenStreetMap extract (railway=rail / light_rail / subway at ground level, no tunnels)
as local polylines: public/cities/<id>/rails.json. The rail yards west of the Central Station are
otherwise a bare grey field.   python3 scripts/rails.py /path/extract.osm.pbf copenhagen"""
import json, sys, osmium
from pyproj import Transformer
PBF, cid = sys.argv[1], sys.argv[2]
reg = next(c for c in json.load(open('public/cities/index.json'))['cities'] if c['id'] == cid)
fwd = Transformer.from_crs('EPSG:4326', reg['projection'], always_xy=True)
EXT = round(json.load(open(f'cities/{cid}/city.json'))['radiusMetres'] * 1.25) + 50
out = []
class H(osmium.SimpleHandler):
    def way(s, w):
        t = {x.k: x.v for x in w.tags}
        if t.get('railway') not in ('rail', 'light_rail', 'subway', 'narrow_gauge'): return
        if t.get('tunnel') in ('yes', 'building_passage') or t.get('layer', '0').startswith('-') or t.get('location') == 'underground': return
        try: pts = [fwd.transform(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError: return
        pts = [[round(x, 2), round(-y, 2)] for x, y in pts]
        if not any(abs(x) < EXT and abs(z) < EXT for x, z in pts): return
        out.append({'p': pts, 'bridge': t.get('bridge') == 'yes', 'service': t.get('service', ''), 'electrified': t.get('electrified', '') != 'no'})
H().apply_file(PBF, locations=True, idx='flex_mem')
json.dump({'tracks': out}, open(f'public/cities/{cid}/rails.json', 'w'), separators=(',', ':'))
print('tracks', len(out), sum(len(t['p']) for t in out), 'points')
