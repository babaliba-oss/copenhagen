"""The 1760 coachman: Daniel's 18th-century costume (mans-1-costume-from-a-historical-engraving.zip: coat, waistcoat,
breeches, stockings, buckled shoes, cravat and cuffs) with the head of his "cool-man" (cool-man.zip, a Ready Player Me
avatar) under a tricorne, hair powdered grey, seated for the coach box.
  FBX2glTF -b -i "source/man 1.fbx" -o costume1_conv     (npm package fbx2gltf)
  python3 scripts/models/coachman.py costume1_conv.glb <costume textures dir> <cool-man dhana.gltf> coachman_full.glb
  (each part is decimated to its own budget, about 9k triangles in all)
Output: vertex colours (linear), facing -Z, 1.74 m standing, origin at his soles' height straight under his hips (the
thighs rest ~0.31 m above it: on a box seat 0.30 m above the footboard).
"""
import sys, json, struct, numpy as np, trimesh
from PIL import Image
costume, texdir, rpm, out = sys.argv[1:5]
TEX = {'Drawers_karl': 'Karlik_Breeches_KARL_BaseColor.jpg', 'Vest_karl': 'Karlik_Vest_KARL_BaseColor.jpg', 'Karl_decor_vest': 'Karlik_Vest_KARL_BaseColor.jpg',
       'coat1': 'Karlik_Coat_KARL_BaseColor-min.jpg', 'decor_1': 'Karlik_Coat_KARL_BaseColor-min.jpg', 'Kravat_and_cuffs_and_hairband': 'Karlik_Fular_cuffs_hairband_KARL_BaseColor.jpg',
       'Farn_shoe_R001': 'Karlik_Farn_shoes_BaseColor-min.jpg', 'Farn_shoe_L001': 'Karlik_Farn_shoes_BaseColor-min.jpg', 'Man_hose_19th_century001': 'Karlik_Hose_KARL_BaseColor-min.jpg'}
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
imgs = {}
def sample(path, uv, size=1024):
    if path not in imgs: imgs[path] = np.asarray(Image.open(path).convert('RGB').resize((size, size), Image.LANCZOS), np.float32) / 255
    a = imgs[path]; h, w = a.shape[:2]
    x = np.clip((uv[:, 0] % 1) * (w - 1), 0, w - 1).astype(int); y = np.clip((uv[:, 1] % 1) * (h - 1), 0, h - 1).astype(int)  # glTF UV: v down
    return lin(a[y, x])
V, F, C = [], [], []
def add(v, f, c, budget=None):
    v = np.asarray(v, np.float64); f = np.asarray(f); c = np.asarray(c, np.float64)
    if budget and len(f) > budget:  # each part decimated to its own budget (the shoes alone had 150k triangles)
        import fast_simplification
        from scipy.spatial import cKDTree
        w = trimesh.Trimesh(v, f, process=False); w.merge_vertices(merge_tex=True, merge_norm=True)
        v2, f2 = fast_simplification.simplify(w.vertices.astype(np.float32), w.faces.astype(np.int64), target_reduction=1 - budget / len(w.faces))
        c = c[cKDTree(v).query(v2)[1]]; v, f = np.asarray(v2, np.float64), np.asarray(f2)
    F.append(f + sum(len(x) for x in V)); V.append(v); C.append(c)
BUDGET = {'coat1': 2000, 'Vest_karl': 600, 'Drawers_karl': 600, 'Kravat_and_cuffs_and_hairband': 600, 'Man_hose_19th_century001': 400, 'Farn_shoe_R001': 800, 'Farn_shoe_L001': 800, 'decor_1': 200, 'Karl_decor_vest': 100}
sc = trimesh.load(costume, force='scene')
for node in sc.graph.nodes_geometry:
    T, gn = sc.graph[node]; g = sc.geometry[gn].copy(); g.apply_transform(T)
    name = next((k for k in TEX if node.startswith(k) or gn.startswith(k)), None)
    col = sample(f'{texdir}/{TEX[name]}', g.visual.uv) if name and getattr(g.visual, 'uv', None) is not None else np.full((len(g.vertices), 3), .3)
    add(g.vertices, g.faces, col, BUDGET.get(name, 600))
# head, hair and eyes of the cool-man, scaled to the costume (a 1.58 m figure before the final 1.1x) and set into the collar
rs = trimesh.load(rpm, force='scene'); HS = 0.86
for node in rs.graph.nodes_geometry:
    T, gn = rs.graph[node]; g = rs.geometry[gn]
    mat = getattr(getattr(g.visual, 'material', None), 'name', '') or ''
    if not any(k in mat for k in ('Skin', 'Hair', 'Eye')) or 'Body' in mat: continue
    v = np.asarray(g.vertices, np.float64)
    if v[:, 1].min() < 1.4: continue  # only the head (the skin material also covers nothing else here, but be safe)
    img = getattr(g.visual.material, 'baseColorTexture', None)
    if img is not None and getattr(g.visual, 'uv', None) is not None:
        a = np.asarray(img.convert('RGB').resize((512, 512)), np.float32) / 255; uv = g.visual.uv
        x = np.clip((uv[:, 0] % 1) * 511, 0, 511).astype(int); y = np.clip((uv[:, 1] % 1) * 511, 0, 511).astype(int); col = lin(a[y, x])
    else: col = np.full((len(v), 3), .5)
    if 'Hair' in mat: col = np.clip(col * .25 + np.array([.62, .6, .56]), 0, 1)  # powdered
    v = (v - [0, 1.523, 0.0]) * HS + [-0.008, 1.262, -0.072]
    add(v, g.faces, col, 1400 if 'Skin' in mat else 700)
# hands: plain skin ellipsoids under the cuffs; tricorne: crown and a three-cornered brim turned up at the edges
def ell(c, r, colr, seg=8):
    m = trimesh.creation.icosphere(subdivisions=1); m.vertices = m.vertices * r + c; add(m.vertices, m.faces, np.tile(lin(np.array(colr) / 255), (len(m.vertices), 1)))
for sx in (1, -1): ell([.215 * sx, .6, .08], [.034, .045, .03], [217, 180, 154])
top = 1.262 + (1.857 - 1.523) * HS  # hair top
hat = []
crown = trimesh.creation.cylinder(radius=.088, height=.085, sections=14); crown.apply_translation([0, top - .035, -.07]); hat.append(crown)
for k in range(3):
    a = k * 2 * np.pi / 3 + np.pi  # one corner points forward (+z here, the face)
    edge = trimesh.creation.box(extents=[.26, .075, .018]); R = trimesh.transformations.rotation_matrix(a, [0, 1, 0])
    edge.apply_translation([0, .02, .1]); edge.apply_transform(trimesh.transformations.rotation_matrix(-.35, [1, 0, 0])); edge.apply_transform(R); edge.apply_translation([0, top - .075, -.07]); hat.append(edge)
brim = trimesh.creation.cylinder(radius=.16, height=.012, sections=3); brim.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2 + np.pi, [0, 1, 0])); brim.apply_translation([0, top - .075, -.07]); hat.append(brim)
for h in hat: add(h.vertices, h.faces, np.tile(lin(np.array([20, 18, 17]) / 255), (len(h.vertices), 1)))
P = np.vstack(V); Fa = np.vstack(F); Cc = np.vstack(C)
# seated: thighs forward about the hip (y 0.80), shins back down about the knee (y 0.42); the arms' lower half comes
# forward with the thighs, so the hands rest ahead on the lap as if holding the reins
smooth = lambda e0, e1, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - e0) / (e1 - e0), 0, 1))
def rotx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
H = np.array([0, .80, -.02]); K = np.array([0, .42, .0])
wh = smooth(.87, .73, P[:, 1]); wk = smooth(.47, .37, P[:, 1])
out_p = np.empty_like(P)
for i in range(len(P)):
    p = P[i]
    if wk[i] > 0: p = rotx(np.radians(76) * wk[i]) @ (p - K) + K
    if wh[i] > 0: p = rotx(np.radians(-86) * wh[i]) @ (p - H) + H
    out_p[i] = p
P = out_p
soles = P[:, 1].min(); thighs = P[(wh > .9) & (wk < .05) & (np.abs(P[:, 2] - .15) < .2), 1].min()
print('thigh underside above the soles', round((thighs - soles) * 1.1, 3))
P = (P - [0, soles, H[2]]) * 1.1  # origin: his soles' height, under his hips
P[:, 0] *= -1; P[:, 2] *= -1  # face -Z
m = trimesh.Trimesh(P, Fa, process=False); N = np.asarray(m.vertex_normals, np.float32)
print('vertices', len(P), 'faces', len(Fa), 'bounds', P.min(0).round(3), P.max(0).round(3))
attrs = {'POSITION': P.astype(np.float32), 'NORMAL': N, 'COLOR_0': np.clip(Cc, 0, 1).astype(np.float32)}
blob = b''; views = []; accs = []
def acc(arr, target, comp, count, typ, minmax=False):
    global blob
    while len(blob) % 4: blob += b'\0'
    off = len(blob); data = arr.tobytes(); blob += data
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target})
    a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': count, 'type': typ}
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
prim = {'attributes': {k: acc(a, 34962, 5126, len(a), 'VEC3', k == 'POSITION') for k, a in attrs.items()}, 'mode': 4}
prim['indices'] = acc(Fa.astype(np.uint32).reshape(-1), 34963, 5125, Fa.size, 'SCALAR')
gltf = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'coachman'}], 'meshes': [{'name': 'coachman', 'primitives': [prim], 'extras': {'source': '18th-century costume + cool-man head (Daniel)'}}],
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(blob) % 4: blob += b'\0'
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))); f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
