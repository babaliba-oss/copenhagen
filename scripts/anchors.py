#!/usr/bin/env python3
"""Top points of named landmark parts (the spire axis and height the hand-built details sit on):
public/cities/<id>/anchors.json  {name: [x, topY_above_base, z, height]}.  python3 scripts/anchors.py copenhagen"""
import gzip, json, re, sys
import numpy as np
cid = sys.argv[1]; OUT = f'public/cities/{cid}'
WANT = {'vorFrelsers': r'^Vor Frelsers Kirke$', 'borsen': r'^Børsen$', 'christiansborg': r'^Christiansborg', 'raadhus': r'Rådhus$', 'rundetaarn': r'^Rundetårn$', 'marmorkirken': r'^Marmorkirken$|Frederiks Kirke'}
d = json.load(open(f'{OUT}/buildings3d-index.json')); out = {}
for t in d['tiles']:
    arr = None
    for p in t['parts']:
        for k, rx in WANT.items():
            if re.search(rx, p.get('name') or '') and (k not in out or p['height'] > out[k][3]):
                if arr is None: arr = np.frombuffer(gzip.decompress(open(f'{OUT}/{t["file"]}', 'rb').read()), dtype=np.float32).reshape(-1, 5)
                a = arr[p['start']:p['start'] + p['count']]; i = a[:, 1].argmax()
                out[k] = [round(float(a[i, 0]), 2), round(float(a[i, 1]), 2), round(float(a[i, 2]), 2), p['height']]
json.dump(out, open(f'{OUT}/anchors.json', 'w')); print(out)
import os, shutil
if os.path.exists(f'data/raw/cities/{cid}/era-public.json'): shutil.copy(f'data/raw/cities/{cid}/era-public.json', f'{OUT}/era.json')
