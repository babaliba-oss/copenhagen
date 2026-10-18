"""The nisse (Daniel's scan, art/nisse.zip: a photographed felt nisse figurine, 252k triangles + 8k texture) -> the game's
hidden nisser and Nissefar:  python3 scripts/models/nisse.py source/model.glb source/tex_u0_v0_diffuse.jpg public/models/nisse.glb
Cuts off the round stand, bakes the texture into vertex colours, stands it on y=0 facing -Z, 1 m tall (the game scales it),
then simplify with gltf-transform (weld; simplify --ratio 0.02 --error 0.004) and gzip.
"""
import sys, json, struct, numpy as np, trimesh
from PIL import Image
src, texf, out = sys.argv[1:4]
s = trimesh.load(src, force='scene'); T, gn = s.graph[s.graph.nodes_geometry[0]]
m = s.geometry[gn].copy(); m.apply_transform(T)
v = np.asarray(m.vertices); y0 = v[:, 1].min(); H = v[:, 1].max() - y0
keep = (v[m.faces][:, :, 1].min(1) > y0 + 0.058 * H)  # the stand: everything below the boots
m.update_faces(keep); m.remove_unreferenced_vertices()
v = np.asarray(m.vertices); uv = np.asarray(m.visual.uv)
img = np.asarray(Image.open(texf).convert('RGB').resize((2048, 2048), Image.LANCZOS), np.float32) / 255
h, w = img.shape[:2]; px = np.clip((uv[:, 0] % 1) * (w - 1), 0, w - 1).astype(int); py = np.clip((1 - uv[:, 1] % 1) * (h - 1), 0, h - 1).astype(int)
col = img[py, px]; col = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
base = v[:, 1].min(); top = v[:, 1].max(); S = 1 / (top - base)
foot = v[v[:, 1] < base + 0.05 * (top - base)]; cx, cz = foot[:, 0].mean(), foot[:, 2].mean()
P = np.stack([-(v[:, 0] - cx) * S, (v[:, 1] - base) * S, -(v[:, 2] - cz) * S], 1).astype(np.float32)  # turned to face -Z
m2 = trimesh.Trimesh(P, m.faces, process=False); N = np.asarray(m2.vertex_normals, np.float32)
F = np.asarray(m.faces, np.uint32).reshape(-1)
attrs = {'POSITION': P, 'NORMAL': N, 'COLOR_0': col.astype(np.float32)}
blob = b''; views = []; accs = []
def add(arr, target, comp, count, typ, minmax=False):
    global blob
    while len(blob) % 4: blob += b'\0'
    off = len(blob); data = arr.tobytes(); blob += data
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), **({'target': target} if target else {})})
    a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': count, 'type': typ}
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
prim = {'attributes': {k: add(a, 34962, 5126, len(a), 'VEC3', k == 'POSITION') for k, a in attrs.items()}, 'mode': 4}
prim['indices'] = add(F, 34963, 5125, F.size, 'SCALAR')
gltf = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'nisse'}], 'meshes': [{'name': 'nisse', 'primitives': [prim], 'extras': {'source': 'nisse scan (Daniel, art/nisse.zip)'}}],
        'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(blob) % 4: blob += b'\0'
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))); f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
print('wrote', out, len(P), 'vertices', len(F) // 3, 'faces')
