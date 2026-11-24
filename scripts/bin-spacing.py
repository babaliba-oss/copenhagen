#!/usr/bin/env python3
"""One bin where Mapillary saw one: its detections of the same bin from different drives land metres apart (GPS and the
depth estimate), so mapillary-features.mjs's 1.5 m merge left rows of two and three bins a few metres apart along the
kerb. Copenhagen's street bins stand tens of metres apart. This keeps one Mapillary bin of every group within SPACING
of each other on the same side of the street (no carriageway between them, city.pack roads): the one seen most
recently, else the first. Register bins (Frederiksberg's frb-skrald) are kept, and a Mapillary bin within SPACING of
one goes. Rerunnable: a second run changes nothing.

  python3 scripts/bin-spacing.py copenhagen
"""
import gzip, json, sys
import numpy as np
import shapely
from scipy.spatial import cKDTree

CID = sys.argv[1] if len(sys.argv) > 1 else 'copenhagen'; ROOT = f'public/cities/{CID}/'; SPACING = 8.0
city = json.loads(gzip.decompress(open(ROOT + 'city.pack', 'rb').read()))
roads = [shapely.make_valid(shapely.Polygon(r['rings'][0])) for r in city['roads'] if r['rings'] and len(r['rings'][0]) > 2 and r.get('kind') != 'traffic_island']
rtree = shapely.STRtree(roads); roads = np.array(roads)
furn = json.load(open(ROOT + 'furniture.json', encoding='utf8'))
bins = [i for i, it in enumerate(furn['items']) if it['k'] == 'bin']
P = np.array([[furn['items'][i]['x'], furn['items'][i]['z']] for i in bins])
def across(a, b):
    seg = shapely.LineString([a, b]); j = rtree.query(seg, predicate='intersects')
    return bool(len(j)) and any(shapely.length(shapely.intersection(seg, roads[j])) > .5)
rank = lambda i: (furn['items'][i].get('src') != 'mapillary', furn['items'][i].get('seen', ''))  # register first, then newest
order = sorted(range(len(bins)), key=lambda k: rank(bins[k]), reverse=True)
tree = cKDTree(P); kept, gone = [], set()
for k in order:
    if k in gone: continue
    kept.append(k)
    for j in tree.query_ball_point(P[k], SPACING):
        if j != k and j not in gone and furn['items'][bins[j]].get('src') == 'mapillary' and not across(P[k], P[j]): gone.add(j)
drop = {bins[j] for j in gone}
furn['items'] = [it for i, it in enumerate(furn['items']) if i not in drop]
open(ROOT + 'furniture.json', 'w', encoding='utf8').write(json.dumps(furn, separators=(',', ':'), ensure_ascii=False))
print(f'{CID}: {len(bins)} bins, {len(drop)} Mapillary bins within {SPACING:.0f} m of another on the same side dropped')
