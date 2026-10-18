"""The 1760 coach body from Daniel's download (19th-century-carriage.zip: a black closed carriage with a crown on the door,
FBX + textures). Convert the FBX first:  FBX2glTF -b -i source/<id>.fbx.fbx -o c19   (npm package fbx2gltf), then

  python3 scripts/models/brougham.py c19.glb textures/Carriage_ALB.tga.png public/models/carriage/brougham.glb public/models/carriage/brougham.jpg

Turns it to face -Z, scales it 1.25x (wheels 1.4 m and 0.98 m, roof 2 m: matching the 2.5 m horses), puts the rear axle
at z=+1.1 like the old coach, and writes POSITION/NORMAL/TEXCOORD_0 with the wheels and the box seat in the mesh extras
(src/copenhagen/gait.js turns the wheels in the vertex shader; the coachman sits on the box).
"""
import sys, json, struct, numpy as np, trimesh
from PIL import Image
src, alb, out, jpg = sys.argv[1:5]
s = trimesh.load(src, force='scene'); T, gn = s.graph[s.graph.nodes_geometry[0]]
m = s.geometry[gn].copy(); m.apply_transform(T)
S, ZC, ZOFF = 1.25, -0.203, 0.34
def game(p): return np.stack([-(p[:, 2] - ZC) * S, (p[:, 1] + 0.01) * S, p[:, 0] * S + ZOFF], 1)
P = game(np.asarray(m.vertices)); N = np.asarray(m.vertex_normals); N = np.stack([-N[:, 2], N[:, 1], N[:, 0]], 1)
UV = np.asarray(m.visual.uv, np.float32).copy()
F = np.asarray(m.faces, np.uint32)
# Wheels are their own connected parts (rim, spokes, hub, caps), centred on an axle: mark them per vertex (_WHEEL = index,
# -1 for the body) so the springs and steps beside a wheel never turn with it.
WHEELS_MODEL = [(0.61, 0.545, 0.34, 0.56), (0.61, 0.545, -0.73, 0.56), (-0.88, 0.385, 0.31, 0.39), (-0.88, 0.385, -0.76, 0.39)]
wheel_of = np.full(len(m.vertices), -1.0, np.float32)
comps = trimesh.graph.connected_components(m.face_adjacency, nodes=np.arange(len(m.faces)), min_len=1)
for comp in comps:
    vi = np.unique(m.faces[comp]); v = np.asarray(m.vertices)[vi]; lo, hi = v.min(0), v.max(0); c = (lo + hi) / 2
    for k, (wx, wy, wz, wr) in enumerate(WHEELS_MODEL):
        if abs(c[0] - wx) < 0.05 and abs(c[1] - wy) < 0.05 and abs(c[2] - wz) < 0.12 and (hi[1] - lo[1]) / 2 < wr + 0.05 and hi[2] - lo[2] < 0.2:
            wheel_of[vi] = k; break
print('wheel vertices', [(k, int((wheel_of == k).sum())) for k in range(4)])
hub = lambda x, y, z, r: {'x': float(-(z - ZC) * S), 'y': float((y + 0.01) * S), 'z': float(x * S + ZOFF), 'r': float(r * S)}
wheels = [hub(0.61, 0.545, 0.34, 0.56), hub(0.61, 0.545, -0.73, 0.56), hub(-0.88, 0.385, 0.31, 0.39), hub(-0.88, 0.385, -0.76, 0.39)]
extras = {'wheels': wheels, 'box': [0.0, float((1.06 + 0.01) * S), float(-0.55 * S + ZOFF)], 'footboard': [0.0, float((0.82 + 0.01) * S), float(-0.87 * S + ZOFF)],
          'poleEnd': float(-1.92 * S + ZOFF), 'source': '19th-century-carriage (Sketchfab download, see docs/COPENHAGEN.md)'}
print(json.dumps(extras))
Image.open(alb).convert('RGB').resize((1024, 1024), Image.LANCZOS).save(jpg, quality=86)
attrs = {'POSITION': P.astype(np.float32), 'NORMAL': (N / (np.linalg.norm(N, axis=1, keepdims=True) + 1e-9)).astype(np.float32), 'TEXCOORD_0': UV, '_WHEEL': np.repeat(wheel_of[:, None], 1, 1)}
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
for k, a in attrs.items(): prim['attributes'][k] = add(np.ascontiguousarray(a), 34962, 5126, len(a), {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}[a.shape[1]], minmax=(k == 'POSITION'))
prim['indices'] = add(F.reshape(-1), 34963, 5125, F.size, 'SCALAR')
gltf = {'asset': {'version': '2.0', 'generator': 'brougham.py'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'brougham', 'extras': extras}],
        'meshes': [{'name': 'brougham', 'primitives': [prim], 'extras': extras}], 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(blob) % 4: blob += b'\0'
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))); f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
print('wrote', out, len(P), 'vertices', len(F), 'faces')
