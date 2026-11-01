#!/usr/bin/env python3
"""Copenhagen's trees from the city's current tree register (Københavns Kommune, k101 trae_basis, CC BY 4.0, GeoJSON in
EPSG:4326 from wfs-kbhkort.kk.dk; updated 2026-09): street and avenue trees, park, churchyard and square trees.

  python3 scripts/kk-trees.py <wfs dir> copenhagen     (in place of kk-street.py's trees; then fill-greenery.py, kk-kerbs.py
                                                         and everything after it: docs/COPENHAGEN.md)

The trees kk-street.py took from the older street-tree export (city.pack trees with a height and no fill flag) are
replaced by the register's: each with its species (traeart, else the genus) and a height grown from its planting year as
kk-street.py did (a small-crowned genus up to 9 m, the rest up to 19 m); a tree with no year gets a height between 9 and
17 m from a hash of its id (most are old park trees), so the crowns keep their variety. Private trees the city lists
(privat træ) are left out (courtyards the city does not survey). OpenStreetMap's trees within 4 m of a register tree are
dropped (the same tree mapped twice). fill-greenery.py, rerun after this, plants its groves round them.
Rerunnable: the register's trees (src 'kk') are replaced.
"""
import gzip, json, math, re, sys, zlib
from pyproj import Transformer

SRC, CID = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'copenhagen')
path = f'public/cities/{CID}/city.pack'
city = json.loads(gzip.decompress(open(path, 'rb').read()))
EXT = city['extent']; to_local = Transformer.from_crs('EPSG:4326', city['projection'], always_xy=True)
old = [t for t in city['trees'] if t.get('src') == 'kk' or ('height' in t and not t.get('fill'))]
rest = [t for t in city['trees'] if not (t.get('src') == 'kk' or ('height' in t and not t.get('fill')))]

SMALL = re.compile(r'^(Sorbus|Prunus|Malus|Crataegus|Pyrus|Amelanchier)', re.I)
new, skipped = [], {'private': 0, 'outside': 0}
for f in json.load(open(f'{SRC}/trae_basis.json', encoding='utf8'))['features']:
    p = f['properties']; g = f.get('geometry')
    if not g: continue
    if p.get('kategori') == 'privat træ' or p.get('ny_dm_element') == 'Private træer': skipped['private'] += 1; continue
    c = g['coordinates'] if g['type'] == 'Point' else g['coordinates'][0]
    a, b = to_local.transform(c[0], c[1]); x, z = round(a, 2), round(-b, 2)
    if abs(x) >= EXT or abs(z) >= EXT: skipped['outside'] += 1; continue
    sp = (p.get('traeart') or p.get('slaegt') or '').strip(); small = bool(SMALL.search(sp))
    try: age = max(1, 2026 - int(p.get('planteaar')))
    except Exception: age = None
    if age is not None and age < 120: h = min(9 if small else 19, 3.5 + age * (.22 if small else .36))
    else: h = (6 if small else 9) + (zlib.crc32(str(p.get('id')).encode()) % 80) / 10 * (.4 if small else 1)
    new.append({'p': [x, z], 'species': sp, 'size': '30 - 50 cm' if (age or 30) > 20 else '10 - 20 cm', 'height': round(h, 1), 'src': 'kk'})

G = 8; grid = {}
for t in new: grid.setdefault((math.floor(t['p'][0] / G), math.floor(t['p'][1] / G)), []).append(t)
def near(x, z, r):
    gx, gz = math.floor(x / G), math.floor(z / G)
    return any(math.hypot(o['p'][0] - x, o['p'][1] - z) < r for i in (-1, 0, 1) for j in (-1, 0, 1) for o in grid.get((gx + i, gz + j), ()))
osm = [t for t in rest if not t.get('fill')]; kept = [t for t in osm if not near(*t['p'], 4)]
fills = [t for t in rest if t.get('fill')]
# moved: an old register tree with a new one within 2 m; removed: none within 4 m
moved = sum(1 for t in old if near(*t['p'], 2)); gone = sum(1 for t in old if not near(*t['p'], 4))
city['trees'] = new + kept + fills
open(path, 'wb').write(gzip.compress(json.dumps(city, separators=(',', ':'), ensure_ascii=False).encode(), 9))
print(f'register trees: {len(old)} old -> {len(new)} now ({moved} of the old within 2 m of a current one, {gone} with none within 4 m: felled or moved); '
      f'left out {skipped}; OpenStreetMap trees {len(osm)} -> {len(kept)}; fill trees {len(fills)} (fill-greenery.py next); total {len(city["trees"])}')
