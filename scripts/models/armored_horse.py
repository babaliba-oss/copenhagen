"""Armored horse (Daniel's download, armored-horse.zip: Sketchfab, static COLLADA + PBR textures) -> the 1760 coach horse.

  python3 scripts/horse/armored_horse.py <unzipped dir with source/model.zip contents> public/models/carriage/armored-horse.glb

Bakes the albedo (x a softened AO) into vertex colours (the game's models are vertex-coloured), turns it to face -Z, scales
it to 2.5 m nose to tail with the hooves on y=0, and writes a `_LEG` vertex attribute for the gait the game animates in the
vertex shader (src/copenhagen/carriage.js): x = leg 0..3 (front left, front right, hind left, hind right; -1 none),
y = weight of the swing about the shoulder/hip, z = weight of the knee/hock bend, w = 1 on the coat (tinted per horse).
The pivots go in the mesh's extras. Simplify afterwards: gltf-transform simplify (see the README note in docs).
"""
import sys, json, struct, numpy as np, trimesh
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
scene = trimesh.load(f'{src}/model/model.dae', force='scene')
MAT = {'meshId0': '02', 'meshId1': '02', 'meshId2': '07', 'meshId3': '07', 'meshId4': '07', 'meshId5': '07', 'meshId6': '07', 'meshId7': '08', 'meshId8': '09'}
tex = {}
def img(k, kind):
    key = (k, kind)
    if key not in tex:
        tex[key] = np.asarray(Image.open(f'{src}/model/textures/{k} - Default_{kind}.jpg').convert('RGB'), dtype=np.float32) / 255.0
    return tex[key]
def sample(a, uv):
    h, w = a.shape[:2]
    u = np.clip(uv[:, 0] % 1.0, 0, 1) * (w - 1); v = (1 - np.clip(uv[:, 1] % 1.0, 0, 1)) * (h - 1)
    x0 = np.floor(u).astype(int); y0 = np.floor(v).astype(int); x1 = np.minimum(x0 + 1, w - 1); y1 = np.minimum(y0 + 1, h - 1)
    fx = (u - x0)[:, None]; fy = (v - y0)[:, None]
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x1] * fx * (1 - fy) + a[y1, x0] * (1 - fx) * fy + a[y1, x1] * fx * fy)
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

P, N, C, F, COAT = [], [], [], [], []
off = 0
for name in sorted(scene.geometry, key=lambda n: int(n[6:])):
    g = scene.geometry[name]; k = MAT[name]
    uv = g.visual.uv
    alb = sample(img(k, 'albedo'), uv); ao = sample(img(k, 'AO'), uv)[:, :1]
    col = lin(np.clip(alb * (0.45 + 0.55 * ao), 0, 1))
    P.append(np.asarray(g.vertices, np.float64)); N.append(np.asarray(g.vertex_normals, np.float64)); C.append(col)
    F.append(np.asarray(g.faces) + off); COAT.append(np.full(len(g.vertices), 1.0 if name == 'meshId0' else 0.0)); off += len(g.vertices)
P = np.vstack(P); N = np.vstack(N); C = np.vstack(C); F = np.vstack(F); COAT = np.concatenate(COAT)
body = COAT > 0  # only the horse's own body (meshId0) bends: tack and armour ride on it

# Legs, in the model's frame (head +z, y up, hooves at y=-0.881): centre lines from the hoof up to where the leg joins the body.
legs = [(-1, 1), (1, 1), (-1, -1), (1, -1)]  # (x side, front +1 / hind -1) in model coords; after the turn x flips, so model -x is the horse's left
def centre(side, front, y):
    sel = body & (np.abs(P[:, 1] - y) < 0.02) & (np.sign(P[:, 0]) == side) & ((P[:, 2] > -0.45) if front > 0 else (P[:, 2] < -0.45))
    q = P[sel]
    return q[:, [0, 2]].mean(0) if len(q) > 5 else None
ys = np.arange(-0.86, -0.18, 0.02)
lines = []
for side, front in legs:
    pts = [(y, *centre(side, front, y)) for y in ys if centre(side, front, y) is not None]
    a = np.array(pts)
    fx = np.polyfit(a[:, 0], a[:, 1], 1); fz = np.polyfit(a[:, 0], a[:, 2], 2)
    lines.append((fx, fz))
HIP = {1: 0.02, -1: 0.06}      # model y of the shoulder (front) / hip (hind) swing pivot
KNEE = {1: -0.44, -1: -0.37}   # model y of the knee (front) / hock (hind)
leg = np.full(len(P), -1.0); wh = np.zeros(len(P)); wk = np.zeros(len(P))
smooth = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - e0) / (e1 - e0), 0, 1))
best = np.full(len(P), 9.0)
for i, ((side, front), (fx, fz)) in enumerate(zip(legs, lines)):
    y = P[:, 1]; yc = np.minimum(y, -0.2)  # above -0.2 the centre line is held where the leg meets the body
    cx = np.polyval(fx, yc); cz = np.polyval(fz, yc)
    d = np.hypot(P[:, 0] - cx, P[:, 2] - cz)
    r0, r1 = (0.085, 0.15) if front > 0 else (0.10, 0.17)
    w = smooth(HIP[front], HIP[front] - 0.24, y) * (1 - smooth(r0, r1, d))
    kw = smooth(KNEE[front] + 0.03, KNEE[front] - 0.07, y) * (1 - smooth(0.07, 0.11, d))
    take = body & (w > 0.001) & (d < best)
    leg[take] = i; wh[take] = w[take]; wk[take] = kw[take]; best[take] = d[take]
print('leg vertices', [(i, int((leg == i).sum())) for i in range(4)])

# To the game's frame: face -Z (turn 180 deg about y), 2.5 m long, hooves on the ground.
S = 1.25
def to_game(p): return np.stack([-p[:, 0] * S, (p[:, 1] + 0.881) * S, -p[:, 2] * S], 1)
Pg = to_game(P); Ng = np.stack([-N[:, 0], N[:, 1], -N[:, 2]], 1); Ng /= np.linalg.norm(Ng, axis=1, keepdims=True) + 1e-9
# leg index after the turn: model -x side becomes +x. Game order: 0 front left (x<0), 1 front right, 2 hind left, 3 hind right.
remap = {0: 1, 1: 0, 2: 3, 3: 2}
legg = np.array([remap.get(int(l), -1) if l >= 0 else -1 for l in leg], np.float32)
def pivot(front):
    fx, fz = lines[0 if front > 0 else 2]
    hz = np.polyval(fz, -0.2); kz = np.polyval(fz, KNEE[front])
    return {'hip': [float((HIP[front] + 0.881) * S), float(-hz * S)], 'knee': [float((KNEE[front] + 0.881) * S), float(-kz * S)]}
extras = {'front': pivot(1), 'hind': pivot(-1), 'source': 'armored-horse (Sketchfab download, see docs/COPENHAGEN.md)'}
print(json.dumps(extras))

# Minimal GLB writer: one mesh, one primitive, indexed.
attrs = {'POSITION': Pg.astype(np.float32), 'NORMAL': Ng.astype(np.float32), 'COLOR_0': np.clip(C, 0, 1).astype(np.float32),
         '_LEG': np.stack([legg, wh, wk, COAT], 1).astype(np.float32)}
idx = F.astype(np.uint32).reshape(-1)
blob = b''; views = []; accs = []
def add(arr, target, comp, count, typ, minmax=False):
    global blob
    while len(blob) % 4: blob += b'\0'
    off = len(blob); data = arr.tobytes(); blob += data
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), **({'target': target} if target else {})})
    a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': count, 'type': typ}
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
prim = {'attributes': {}, 'mode': 4}
for k, a in attrs.items():
    prim['attributes'][k] = add(a, 34962, 5126, len(a), {3: 'VEC3', 4: 'VEC4'}[a.shape[1]], minmax=(k == 'POSITION'))
prim['indices'] = add(idx, 34963, 5125, len(idx), 'SCALAR')
gltf = {'asset': {'version': '2.0', 'generator': 'armored_horse.py'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'armored-horse', 'extras': extras}], 'meshes': [{'name': 'armored-horse', 'primitives': [prim], 'extras': extras}],
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(blob) % 4: blob += b'\0'
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
print('wrote', out, len(P), 'vertices', len(F), 'faces')
