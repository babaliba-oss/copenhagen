"""A model in plain colours (no textures) -> a GLB for loadColouredModel(s): one mesh per material colour, scaled to a
height, turned, standing on y = 0 and centred over its footprint. Light (trimesh only), for small low-poly models.
   python3 scripts/models/plain_model.py <in.gltf|glb> <out.glb> height=<m> [yaw=<deg about +Y>]
e.g. the goose ("Goose Low Poly" by Atlas, CC BY 4.0), whose body points 42 degrees off +Z: height=0.62 yaw=132 to face +X
like the other animals (public/models/animals/goose.glb).
"""
import sys, math
import numpy as np, trimesh

src, out = sys.argv[1], sys.argv[2]
A = dict(a.split('=', 1) for a in sys.argv[3:])
s = trimesh.load(src, force='scene')
parts = []
for node in s.graph.nodes_geometry:
    T, g = s.graph[node]; m = s.geometry[g].copy(); m.apply_transform(T)
    mat = getattr(m.visual, 'material', None)
    col = np.array(getattr(mat, 'baseColorFactor', None) if getattr(mat, 'baseColorFactor', None) is not None else [204, 204, 204, 255], float)
    if col.max() <= 1: col = col * 255
    parts.append((getattr(mat, 'name', g) or g, m, col))
V = np.concatenate([np.asarray(m.vertices) for _, m, _ in parts]); lo, hi = V.min(0), V.max(0)
k = float(A['height']) / (hi[1] - lo[1]); yaw = math.radians(float(A.get('yaw', 0)))
R = trimesh.transformations.rotation_matrix(yaw, [0, 1, 0])
M = R @ trimesh.transformations.scale_matrix(k) @ trimesh.transformations.translation_matrix([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
scene = trimesh.Scene()
for i, (name, m, col) in enumerate(parts):
    m.apply_transform(M)
    m = trimesh.graph.smooth_shade(m, angle=math.radians(30))
    m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(name=name, baseColorFactor=[int(c) for c in col[:3]] + [255], metallicFactor=0, roughnessFactor=.8))
    scene.add_geometry(m, geom_name=f'{name}_{i}')
scene.export(out, include_normals=True)
b = scene.bounds
print(out, sum(len(g.faces) for g in scene.geometry.values()), 'triangles, min', np.round(b[0], 3), 'max', np.round(b[1], 3))
