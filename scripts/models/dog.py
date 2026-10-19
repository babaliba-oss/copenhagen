"""The walkers' dog: a flat-coloured dog model cut into a body and four legs, so the game can swing the legs at the trot.
   python3 scripts/models/flatten_model.py <dog scene.gltf> /tmp/dog_flat.glb tris=1800 k=6 length=0.8 yaw=180
   python3 scripts/models/dog.py /tmp/dog_flat.glb public/models/animals/dog.glb
Source: "dog" by neighbor (sketchfab.com/3d-models/e395f26615ca445ab32f01ded17ff3bf), CC BY 4.0: a yellow Labrador.
Out: meshes body, leg_fl, leg_fr, leg_bl, leg_br (POSITION, NORMAL, COLOR_0 linear float, grey: the game tints the coat),
nose to -Z, feet on y = 0, metres; the scene's extras carry each leg's pivot (shoulder or hip), the collar point for the
lead and the coat's luminance.
"""
import sys, json, struct
import numpy as np, trimesh

src, out = sys.argv[1], sys.argv[2]
s = trimesh.load(src, force='scene')
P, N, C, F, off = [], [], [], [], 0
for node in s.graph.nodes_geometry:
    T, gname = s.graph[node]
    g = s.geometry[gname].copy(); g.apply_transform(T)
    col = np.array(g.visual.material.baseColorFactor[:3], float) / 255  # already linear (flatten_model writes linear factors)
    P.append(np.asarray(g.vertices)); N.append(np.asarray(g.vertex_normals)); C.append(np.tile(col, (len(g.vertices), 1))); F.append(np.asarray(g.faces) + off); off += len(g.vertices)
P, N, C, F = np.concatenate(P), np.concatenate(N), np.concatenate(C), np.concatenate(F)
# Grey coat: the game tints each dog (black, brown, cream, white...), so the colours become their luminance, and the
# coat's main luminance goes in the extras ('base') for the tint to divide by.
C = np.repeat((C @ [.2126, .7152, .0722])[:, None], 3, 1)
tri_lum = C[F[:, 0], 0]; area = .5 * np.linalg.norm(np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]), axis=1)
lums, inv = np.unique(tri_lum.round(5), return_inverse=True); base = float(lums[np.bincount(inv, weights=area).argmax()])
H = P[:, 1].max()
cut = .45 * H  # the belly: below it, legs
cen = P[F].mean(1)
legs = {'leg_fl': (-1, -1), 'leg_fr': (1, -1), 'leg_bl': (-1, 1), 'leg_br': (1, 1)}  # (x side, z end): -x is the dog's left, -z its front
part = np.full(len(F), 'body', dtype=object)
low = cen[:, 1] < cut
for name, (sx, sz) in legs.items():
    part[low & (np.sign(cen[:, 0]) == sx) & (np.sign(cen[:, 2]) == sz)] = name
pivots = {}
for name in legs:
    v = np.unique(F[part == name]); top = P[v][P[v][:, 1] > cut - .05 * H]
    pivots[name] = [round(float(top[:, 0].mean()), 4), round(float(min(H * .62, cut + .06 * H)), 4), round(float(top[:, 2].mean()), 4)]
z0 = P[:, 2].min(); L = P[:, 2].max() - z0; zc = z0 + .2 * L  # the neck: a fifth of the length back from the nose
ring = P[np.abs(P[:, 2] - zc) < .03 * L]
collar = [0.0, round(float(ring[:, 1].max() - .25 * (ring[:, 1].max() - ring[:, 1].min())), 4), round(float(zc), 4)]
print('base luminance', round(base, 4), 'height', round(float(H), 3), 'length', round(float(P[:, 2].max() - P[:, 2].min()), 3), 'pivots', pivots, 'collar', collar)

blob = b''; views = []; accs = []
def add(arr, target, comp, count, typ, minmax=False):
    global blob
    while len(blob) % 4: blob += b'\0'
    data = arr.tobytes(); views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target}); blob += data
    a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': count, 'type': typ}
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
meshes, nodes = [], []
for name in ['body', *legs]:
    f = F[part == name]; used = np.unique(f); remap = np.zeros(len(P), np.int64); remap[used] = np.arange(len(used))
    attrs = {'POSITION': P[used].astype(np.float32), 'NORMAL': N[used].astype(np.float32), 'COLOR_0': C[used].astype(np.float32)}
    prim = {'attributes': {k: add(a, 34962, 5126, len(a), 'VEC3', k == 'POSITION') for k, a in attrs.items()}, 'mode': 4}
    idx = remap[f].astype(np.uint16 if len(used) < 65536 else np.uint32).reshape(-1)
    prim['indices'] = add(idx, 34963, 5123 if idx.dtype == np.uint16 else 5125, idx.size, 'SCALAR')
    meshes.append({'name': name, 'primitives': [prim]}); nodes.append({'name': name, 'mesh': len(meshes) - 1})
    print(name, len(f), 'triangles')
gltf = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes))), 'extras': {'pivots': pivots, 'collar': collar, 'base': round(base, 5),
        'source': '"dog" by neighbor, CC BY 4.0, sketchfab.com/3d-models/e395f26615ca445ab32f01ded17ff3bf (simplified, recoloured, cut)'}}],
        'nodes': nodes, 'meshes': meshes, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
js = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode()
while len(js) % 4: js += b' '
while len(blob) % 4: blob += b'\0'
with open(out, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))); f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942)); f.write(blob)
print('wrote', out, len(blob) // 1024, 'KB')
