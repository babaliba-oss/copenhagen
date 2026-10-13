#!/usr/bin/env python3
"""Construction years from the City of Copenhagen SAVE register (CC BY 4.0) onto the building parts:
part.year, used by the estimated façades to pick a period style (src/facade-data.js).
  python3 scripts/save-years.py <kkdata>/save.json copenhagen"""
import json, sys
from pyproj import Transformer
from shapely.geometry import shape, Point
from shapely.strtree import STRtree
from shapely import transform as shp_transform
import numpy as np
SAVE, cid = sys.argv[1], sys.argv[2]
reg = next(c for c in json.load(open('public/cities/index.json'))['cities'] if c['id'] == cid)
t = Transformer.from_crs('EPSG:25832', reg['projection'], always_xy=True)
polys, years = [], []
for f in json.load(open(SAVE))['features']:
    y = f['properties'].get('opfoerelse_aar')
    if not y or not f['geometry']: continue
    g = shape(f['geometry'])
    g = shp_transform(g, lambda a: np.column_stack(t.transform(a[:, 0], a[:, 1])) * [1, -1])
    polys.append(g.buffer(0)); years.append(int(y))
tree = STRtree(polys)
P = f'public/cities/{cid}/buildings3d-index.json'; d = json.load(open(P)); n = 0
for tl in d['tiles']:
    for p in tl['parts']:
        c = Point((p['bbox'][0] + p['bbox'][2]) / 2, (p['bbox'][1] + p['bbox'][3]) / 2)
        hit = [i for i in tree.query(c) if polys[i].contains(c)]
        if not hit:
            near = tree.query(c.buffer(4)); hit = [i for i in near if polys[i].distance(c) < 4]
        if hit: p['year'] = years[hit[0]]; n += 1
json.dump(d, open(P, 'w')); print(n, 'parts dated')
