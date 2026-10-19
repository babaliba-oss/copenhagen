# Frederik V at Amalienborg -> public/models/statues/frederik-v.glb, from "Equestrian Statue in Copenhagen" by alexabhisak
# (CC BY 4.0, sketchfab.com/3d-models/6575a75ae76f42e5909f93e8fa718445: the untextured upload; its textured twin is under
# Sketchfab's Standard licence and must not be used). No texture to sample, so the colours go by zone, as on the square:
# the horse and rider in green bronze, a pale stone plinth, a black iron railing round a grey stone base.
#   python3 scripts/models/frederik_v.py <scene.gltf> public/models/statues/frederik-v.glb [height=10.5] [tris=12000]
# Same output as flatten_model.py: one mesh per colour (position + normal), metres, +Y up, the rider facing +Z.
import sys, os, math
import numpy as np, trimesh, fast_simplification

SRC, OUT = sys.argv[1], sys.argv[2]
A = dict(a.split('=', 1) for a in sys.argv[3:])
HEIGHT, TRIS = float(A.get('height', 10.5)), int(A.get('tris', 12000))
m = trimesh.load(SRC, force='scene').to_geometry()
V, F = np.asarray(m.vertices, np.float64), np.asarray(m.faces, np.int64)
lo, hi = V.min(0), V.max(0)
V = (V - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]) * (HEIGHT / (hi[1] - lo[1]))
hx, hz = (hi[0] - lo[0]) / 2 * HEIGHT / (hi[1] - lo[1]), (hi[2] - lo[2]) / 2 * HEIGHT / (hi[1] - lo[1])
# Weld the upload's chunks into one surface (unwelded, the cuts tear the plinth apart), sort the triangles into zones
# by where their centres sit, then simplify each zone to its share: most of the budget goes to the horse and rider.
# Zones in fractions of the height and of the half widths, read off the model's cross-sections: the railing stands at
# the rim up to 0.18 of the height, the plinth's top slab ends at 0.53, where the horse stands.
w = trimesh.Trimesh(V, F, process=False); w.merge_vertices(digits_vertex=5); w.remove_unreferenced_vertices()
V, F = np.asarray(w.vertices, np.float64), np.asarray(w.faces, np.int64)
c = V[F].mean(1); y, ax, az = c[:, 1] / HEIGHT, np.abs(c[:, 0]) / hx, np.abs(c[:, 2]) / hz
ZONES = [('bronze', '#5c8576', .55), ('plinth', '#d9d5c9', .19), ('railing', '#24282a', .23), ('base', '#b4b0a5', .03)]
zone = np.full(len(F), 1)
zone[y > .53] = 0
zone[(y > .015) & (y < .185) & ((ax > .7) | (az > .8))] = 2
zone[y <= .015] = 3
lin = lambda h: np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]) ** 2.2
scene = trimesh.Scene()
for k, (name, hexc, share) in enumerate(ZONES):
    Fz = F[zone == k]
    if not len(Fz): continue
    used = np.unique(Fz); remap = np.zeros(len(V), np.int64); remap[used] = np.arange(len(used))
    Vz, Fz = V[used].astype(np.float32), remap[Fz].astype(np.int32)
    target = max(150, int(TRIS * share))
    for p in range(5):
        if len(Fz) <= target * 1.1: break
        Vz, Fz = fast_simplification.simplify(np.ascontiguousarray(Vz), np.ascontiguousarray(Fz), target_reduction=1 - target / len(Fz), agg=7 + 3 * p)
    t = Vz[Fz]; Fz = Fz[np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1) > 1e-10]
    g = trimesh.Trimesh(Vz, Fz, process=False); g.remove_unreferenced_vertices()
    g = trimesh.graph.smooth_shade(g, angle=math.radians(35))
    n = np.array(g.vertex_normals, dtype=np.float64); bad = ~np.isfinite(n).all(1) | (np.linalg.norm(n, axis=1) < 1e-6); n[bad] = [0, 1, 0]; g.vertex_normals = n
    g.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(name=name, baseColorFactor=[*(lin(hexc) * 255).round().astype(int), 255], metallicFactor=0, roughnessFactor=.8))
    scene.add_geometry(g, geom_name=name)
    print(name, len(g.faces), 'tris')
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
scene.export(OUT, include_normals=True)
b = scene.bounds
print(f'{OUT}: {sum(len(g.faces) for g in scene.geometry.values())} tris, {os.path.getsize(OUT) // 1024} KB, min {np.round(b[0], 2)} max {np.round(b[1], 2)}')
