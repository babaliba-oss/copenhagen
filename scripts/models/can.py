"""The pant can: the regular soda can of "Cans!" by Tiago Oliveira (CC BY 4.0, sketchfab.com/3d-models/0db78b8bfcdb4c559b3bc8f63cbb5689)
turned into a clean low-poly lathe: its radius measured along its height (simplifying the 50k-triangle shell itself tore
holes in it), 20 sides, a lid and a base. 33 cl size (115 mm), standing on y = 0. Painted as a lemon-lime soda (Daniel:
"like a Faxe Kondi can, without the name"): green, with a white wave round it over a thin lemon line, bare aluminium at
the base, the shoulder and the lid. No lettering, no logo.
   python3 scripts/models/can.py <scene.gltf> public/models/props/can.glb [node=Object_4]
One mesh per colour for loadColouredModel.
"""
import sys, math
import numpy as np, trimesh

src, out = sys.argv[1], sys.argv[2]
A = dict(a.split('=', 1) for a in sys.argv[3:]); NODE = A.get('node', 'Object_4')
s = trimesh.load(src, force='scene')
V = None
for node in s.graph.nodes_geometry:
    T, g = s.graph[node]
    if node == NODE or g == NODE: m = s.geometry[g].copy(); m.apply_transform(T); V = np.asarray(m.vertices)
if V is None: sys.exit(f'no node {NODE}')
# the can's axis is its longest extent
ext = V.max(0) - V.min(0); ax = int(np.argmax(ext)); others = [i for i in range(3) if i != ax]
h = V[:, ax] - V[:, ax].min(); H = h.max(); c = V[:, others].mean(0); r = np.linalg.norm(V[:, others] - c, axis=1)
S = .115 / H  # metres: a 33 cl can is 115 mm tall
bins = np.linspace(0, H, 15); prof = []
for a, b in zip(bins[:-1], bins[1:]):
    sel = (h >= a) & (h <= b)
    if sel.any(): prof.append(((a + b) / 2 * S, float(np.percentile(r[sel], 97)) * S))
prof = [(0.0, prof[0][1] * .92)] + prof + [(H * S, prof[-1][1] * .96)]
# resampled to even rings, so the painted wave has rows to follow
ys = np.linspace(0, H * S, 23); prof = [(float(y), float(np.interp(y, [p[0] for p in prof], [p[1] for p in prof]))) for y in ys]
SEG = 20
def lathe(profile, close_bottom, close_top):
    Vs, Fs = [], []
    for y, rad in profile:
        for k in range(SEG):
            a = 2 * math.pi * k / SEG; Vs.append((rad * math.cos(a), y, rad * math.sin(a)))
    for i in range(len(profile) - 1):
        for k in range(SEG):
            p, q = i * SEG + k, i * SEG + (k + 1) % SEG
            Fs += [(p, q, p + SEG), (q, q + SEG, p + SEG)]
    if close_bottom:
        cb = len(Vs); Vs.append((0, profile[0][0], 0)); Fs += [(cb, (k + 1) % SEG, k) for k in range(SEG)]
    if close_top:
        ct = len(Vs); Vs.append((0, profile[-1][0], 0)); t = (len(profile) - 1) * SEG; Fs += [(ct, t + k, t + (k + 1) % SEG) for k in range(SEG)]
    m = trimesh.Trimesh(np.array(Vs), np.array(Fs), process=True)
    if m.volume < 0: m.invert()
    return m
body = lathe(prof, True, False)
lid_y = prof[-1][0]; lid = lathe([(lid_y - .004, prof[-1][1] * .98), (lid_y, prof[-1][1] * .9), (lid_y, prof[-1][1] * .86)], False, True)
# paint by each triangle's centre: height as a share of the can, angle round it
Ht = prof[-1][0]; cen = body.vertices[body.faces].mean(1); t = cen[:, 1] / Ht; ang = np.arctan2(cen[:, 2], cen[:, 0])
wave = .5 + .075 * np.sin(ang + .6)
paint = np.full(len(cen), 'green', dtype=object)
paint[np.abs(t - wave) < .06] = 'white'
paint[(t < wave - .06) & (t > wave - .085)] = 'lemon'
paint[(t < .045) | (t > .9)] = 'aluminium'
COLS = {'green': '#1f9a41', 'white': '#f2f4ee', 'lemon': '#d8e436', 'aluminium': '#cfd3d6', 'lid': '#a3a8ad'}
lin = lambda h: [round((int(h[i:i + 2], 16) / 255) ** 2.2 * 255) for i in (1, 3, 5)]
scene = trimesh.Scene()
parts = [(name, trimesh.Trimesh(body.vertices, body.faces[paint == name], process=False)) for name in ('green', 'white', 'lemon', 'aluminium')] + [('lid', lid)]
for name, m in parts:
    m.remove_unreferenced_vertices(); m = trimesh.graph.smooth_shade(m, angle=math.radians(40))
    m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(name=name, baseColorFactor=[*lin(COLS[name]), 255], metallicFactor=0, roughnessFactor=.4))
    scene.add_geometry(m, geom_name=name)
scene.export(out, include_normals=True)
print(out, sum(len(g.faces) for g in scene.geometry.values()), 'triangles,', {n: int((paint == n).sum()) for n in ('green', 'white', 'lemon', 'aluminium')})
