#!/usr/bin/env python3
"""Nyhavn's north quay (the sunny, painted side) described from Mapillary photos taken from the water on
2016-11-25, west to east: Nyhavn 17 ochre, then grey, white, ochre-orange, pale blue, a yellow gable house,
dusty pink, orange, blue, yellow, red, ochre... Each house of the city model on that quay gets the next colour.
Writes cities/copenhagen/facades.json (shipped with: node scripts/facades.mjs copenhagen)."""
import json, math
from pyproj import Transformer
r = next(c for c in json.load(open('public/cities/index.json'))['cities'] if c['id'] == 'copenhagen')
f = Transformer.from_crs('EPSG:4326', r['projection'], always_xy=True)
L = lambda lo, la: (lambda p: (p[0], -p[1]))(f.transform(lo, la))
d = json.load(open('public/cities/copenhagen/buildings3d-index.json'))
(x0, z0), (x1, z1) = L(12.5884, 55.6801), L(12.5935, 55.6797)
ux, uz = x1 - x0, z1 - z0; Ln = math.hypot(ux, uz); ux /= Ln; uz /= Ln; nx, nz = uz, -ux
north = []
for t in d['tiles']:
    for p in t['parts']:
        cx, cz = (p['bbox'][0] + p['bbox'][2]) / 2, (p['bbox'][1] + p['bbox'][3]) / 2
        s = (cx - x0) * ux + (cz - z0) * uz; o = (cx - x0) * nx + (cz - z0) * nz
        if 90 < s < Ln + 10 and 8 < o < 42 and p['height'] > 10: north.append((s, p))
north.sort(key=lambda q: q[0])
WALLS = ['#d9a63a', '#c9c6c4', '#ece9e2', '#d99a3c', '#8fa3bd', '#e3b64c', '#c98a7a', '#d07a3a', '#7f95b0', '#e1b24a', '#c46a63', '#d48a3d', '#e9e4d8', '#b55a3c']
PHOTOS = [{'id': i, 'captured': '2016-11-25'} for i in ['2278971705569682', '522833282429313', '800201804243397', '915994042467407', '145779257442479', '509005887143760', '269812254817512', '905119873619474']]
out = {'schemaVersion': 1, 'city': 'copenhagen', 'street': 'Nyhavn (north quay)', 'observedOn': '2026-10-12',
       'source': 'Described in our own words from street-level photos on Mapillary (mapillary.com), CC BY-SA 4.0; photo ids per building. No image content is stored here.',
       'note': 'Colours read from overcast late-afternoon photos, west to east; the sequence is matched to the city model houses in order along the quay, so a colour may sit one house off. Red tile roofs with dormers, white window frames, restaurants with awnings in the ground floors.',
       'buildings': {}}
for i, (s, p) in enumerate(north):
    h = p['height']; storeys = 4 if h < 19.5 else 5
    out['buildings'][p['id']] = {'name': f'Nyhavn north quay, house {i + 1} from the west', 'storeys': storeys, 'groundStorey': 3.1, 'material': 'render',
        'wall': WALLS[i % len(WALLS)], 'cornice': '#efece4', 'roof': '#9a4630',
        'windows': {'shape': 'rect', 'pitch': 2.1, 'width': .95, 'height': 1.5, 'frame': '#f2efe8', 'glass': '#2f3b42'},
        'ground': {'type': 'shops', 'pitch': 3.2, 'band': ['#2b2d2f', '#5a2a22', '#1f3a2c'][i % 3], 'awning': ['#7a2a20', '#e9e3d4', '#1f3a2c', '#c8202a'][i % 4], 'frame': '#2b2d2f'},
        'description': 'Narrow merchant house of four or five storeys in coloured render, small white-framed windows in regular rows, red tile roof with dormers; restaurant at street level under an awning.',
        'evidence': {'photos': PHOTOS, 'confidence': .55}}
json.dump(out, open('cities/copenhagen/facades.json', 'w'), indent=1, ensure_ascii=False)
print(len(out['buildings']), 'Nyhavn houses described')
