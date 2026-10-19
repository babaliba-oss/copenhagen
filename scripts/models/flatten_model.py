# Textured model (glb/gltf/fbx/obj/blend) -> flat-colour GLB for loadColouredModel(s) (src/coloured-models.js keeps only
# position + normal per mesh and one colour per material): the texture is sampled per triangle, clustered to k colours,
# the mesh simplified to a triangle budget and written as one mesh per colour. Metres, +Y up, forward -Z.
#   python3 scripts/models/flatten_model.py <in> <out.glb> [tris=12000] [k=12] [length=m | height=m | scale=f]
#     [yaw=deg] [roll=deg] [pitch=deg] [base=m] [thin=m] [minpart=f] [only=name,..] [skip=name,..] [smooth=deg]
#   yaw/roll/pitch: turns applied after import (glTF axes: yaw about +Y, roll about +Z, pitch about +X), so the front ends
#     up facing -Z and the top +Y. base: where y=0 sits, in metres above the lowest point (ships: the draft, so the hull
#     sinks that far); default 0 = standing on the ground.
#   thin: drop loose parts thinner than this many metres (ropes and rigging that a few thousand triangles cannot hold).
#   minpart: drop loose parts whose size is under this fraction of the model (specks). only/skip: object name filters.
# Needs: pip install bpy numpy scipy trimesh fast-simplification
import sys, os, math
import numpy as np
from scipy.cluster.vq import kmeans2
from scipy.spatial import cKDTree
import fast_simplification, trimesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_io as io
from model_io import load, gather, face_colours, to_gltf, rot, weld, drop_parts

SRC, OUT = sys.argv[1], sys.argv[2]
A = dict(a.split('=', 1) for a in sys.argv[3:]); io.configure(SRC, A)
f = lambda k, d=None: float(A[k]) if k in A else d
TRIS, K = int(f('tris', 12000)), int(f('k', 12))
load(SRC)
P, UV, MI, mats = gather()
print('source tris', len(P))
C = face_colours(P, UV, MI, mats)
P = rot(to_gltf(P))
lo, hi = P.reshape(-1, 3).min(0), P.reshape(-1, 3).max(0); ext = hi - lo
s = f('scale') or (f('length') / max(ext[0], ext[2]) if 'length' in A else f('height') / ext[1] if 'height' in A else 1.0)
P = (P - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]) * s
P[..., 1] -= f('base', 0.0)
size = np.linalg.norm(ext) * s
V, F = weld(P, size * 1e-4)
ok = drop_parts(V, F, size) if ('thin' in A or 'minpart' in A) else np.ones(len(F), bool)
F, C = F[ok], C[ok]
area = .5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1); good = area > 0
F, C = F[good], C[good]
# colours: k-means on an area-weighted sample (sRGB), every triangle to its nearest centre
rng = np.random.default_rng(1); w = area[good] / area[good].sum()
smp = C[rng.choice(len(C), min(60000, len(C)), p=w)]
cent, _ = kmeans2(smp.astype(np.float64), min(K, len(np.unique(smp.round(3), axis=0))), seed=1, minit='++')
lab = np.argmin(((C[:, None, :] - cent[None]) ** 2).sum(-1), 1)
# simplify, then each new triangle takes the colour of the nearest original one
cen0 = V[F].mean(1)
if len(F) > TRIS:
    used = np.unique(F); remap = np.zeros(len(V), int); remap[used] = np.arange(len(used))
    V2, F2 = V[used].astype(np.float32), remap[F].astype(np.int32)
    for k in range(5):  # many small separate parts (slats, planks) stall a single pass short of the budget
        if len(F2) <= TRIS * 1.1: break
        V2, F2 = fast_simplification.simplify(np.ascontiguousarray(V2, np.float32), np.ascontiguousarray(F2, np.int32), target_reduction=1 - TRIS / len(F2), agg=7 + 3 * k)
else: V2, F2 = V, F
_, nn = cKDTree(cen0).query(V2[F2].mean(1)); lab2 = lab[nn]
lin = lambda c: np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)
scene = trimesh.Scene(); ang = math.radians(f('smooth', 35))
tri = V2[F2]; ok2 = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) > 1e-10  # no slivers: they have no normal
F2, lab2 = F2[ok2], lab2[ok2]
for k in np.unique(lab2):
    m = trimesh.Trimesh(V2, F2[lab2 == k], process=False); m.remove_unreferenced_vertices()
    m = trimesh.graph.smooth_shade(m, angle=ang)
    n = np.array(m.vertex_normals, dtype=np.float64); bad = ~np.isfinite(n).all(1) | (np.linalg.norm(n, axis=1) < 1e-6)
    n[bad] = [0, 1, 0]; m.vertex_normals = n  # the loader reads position + normal only: every vertex needs one
    rgb = np.clip(lin(cent[k]), 0, 1)
    m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(baseColorFactor=[*(rgb * 255).round().astype(int), 255], metallicFactor=0, roughnessFactor=.8))
    scene.add_geometry(m, geom_name=f'c{k}')
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
scene.export(OUT, include_normals=True)
b = scene.bounds
print(f'{OUT}: {sum(len(g.faces) for g in scene.geometry.values())} tris, {len(scene.geometry)} colours, '
      f'{os.path.getsize(OUT) // 1024} KB, min {np.round(b[0], 2)} max {np.round(b[1], 2)}')
