# The city's height field (public/cities/<city>/terrain.pack, src/terrain.js) for the Python data steps: ground_at(x, z)
# on numpy arrays, bilinear as the game's groundAt. And which model triangles the game collapses at load: main.js
# buildRoof folds flat triangles (under 0.8 m of rise) lying near the street (centroid 1.5 m under to 1.3 m over the
# ground) away, the plinths and paved decks the city model folds into a block. They are not drawn, so nothing solid
# should be built on them.
import gzip, json, os
import numpy as np

def load_ground(root):
    path = root + 'terrain.pack'
    if not os.path.exists(path): return lambda x, z: np.zeros_like(np.asarray(x, np.float64))
    raw = open(path, 'rb').read()
    if raw[:2] == b'\x1f\x8b': raw = gzip.decompress(raw)
    assert raw[:4] == b'TERR', 'not a terrain file'
    n = int.from_bytes(raw[4:8], 'little'); h = json.loads(raw[8:8 + n]); start = (8 + n + 3) // 4 * 4; size = h['size']
    layer = next(i for i, l in enumerate(h['layers']) if l['name'] == 'ground')
    q = np.frombuffer(raw, np.uint16, size * size, start + layer * size * size * 2).reshape(size, size).astype(np.uint32)
    q = np.cumsum(q, axis=1) & 65535  # each row: its first value, then differences mod 65536
    g = (h['layers'][layer]['min'] + q * h['scale'] - h.get('base', 0)).astype(np.float64)
    ext, cell, last = h['extent'], h['cell'], size - 1
    def ground_at(x, z):
        u = np.clip((np.asarray(x, np.float64) + ext) / cell, 0, last); v = np.clip((np.asarray(z, np.float64) + ext) / cell, 0, last)
        i = np.minimum(np.floor(u).astype(int), last - 1); j = np.minimum(np.floor(v).astype(int), last - 1); a = u - i; b = v - j
        return (g[j, i] * (1 - a) + g[j, i + 1] * a) * (1 - b) + (g[j + 1, i] * (1 - a) + g[j + 1, i + 1] * a) * b
    return ground_at

def lift_parts(a, parts, ground_at):
    """a: a tile's (n, 5) vertex array. Parts without surveyed heights (abs) stand on their lowest ground, as
    terrain.js liftBuildings does before the collapse: their heights are raised in place (a writable copy)."""
    a = np.array(a, np.float64)
    for p in parts:
        if p.get('abs'): continue
        s, e = p['start'], p['start'] + p['count']
        if e > s: a[s:e, 1] += ground_at(a[s:e, 0], a[s:e, 2]).min()
    return a

def collapsed(tri, ground_at):
    """tri: (n, 3, 3) model triangles (x, y, z). True where main.js collapses the triangle away."""
    y = tri[:, :, 1]
    g = ground_at(tri[:, :, 0].mean(axis=1), tri[:, :, 2].mean(axis=1)); m = y.mean(axis=1)
    return (y.max(axis=1) - y.min(axis=1) <= .8) & (m <= g + 1.3) & (m >= g - 1.5)
