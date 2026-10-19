# 1760 walkers: Daniel's 18th-century costumes dressed on the cool-man's skeleton (see rpm_build.py), so they walk with the
# same retargeted clips (anims_r.glb). The avatar keeps its head, hands and skin weights; its modern clothes are replaced by
# the costume, whose skin weights come from the avatar's nearest body/clothes vertex with the arms first lowered to the
# costume's pose (then brought back to the avatar's bind pose by inverse skinning). Hair powdered, a tricorne on top.
#   python3 scripts/people/costume_build.py scripts/people <dhana.gltf> <costume.glb> <costume textures dir> <name> <out dir> [coat=#hex]
#   [vest= drawers= hose= shoes= cravat=#hex] [detail=2] [hat=top] [hair=keep]  (R_HCA: the red coat in black with dark trousers, a top hat, his own hair)
#   <costume> may also be a USD scene (scene.usdc) or a glTF scene (scene.gltf, with parts=<node prefixes> to keep): R_Mysli is
#   Moskvin's CC BY "Textiles: Man's costume #4": parts=Farn_shoe,Man_hose,blouse,coat,trousers
import sys, os, json, numpy as np, trimesh
sys.path.insert(0, sys.argv[1]); import ppl_glb as G
_argv = sys.argv; sys.argv = [_argv[0], _argv[1], '/tmp/', '/tmp/']; import ppl_build as PB; sys.argv = _argv
from PIL import Image
from scipy.spatial import cKDTree
import fast_simplification
RPM, COSTUME, TEXDIR, NAME, OUT = sys.argv[2:7]
opts = dict(a.split('=', 1) for a in sys.argv[7:] if '=' in a)
OUT = OUT.rstrip('/') + '/'

# the avatar skeleton, prims and helpers come from rpm_build (it also writes anims_r.glb and R_CoolMan.glb)
sys.argv = [_argv[0], _argv[1], RPM, OUT + 'anims_m.glb', OUT]
import importlib.util
spec = importlib.util.spec_from_file_location('rpm', os.path.join(_argv[1], 'rpm_build.py')); R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
names, Bw, parent, order, ROOTS = R.names, R.Bw, R.parent, R.order, R.ROOTS
JI = {n: k for k, n in enumerate(names)}
IBM = np.array([np.linalg.inv(Bw[n]) for n in names])

lin = R.lin
TEX = {'Drawers_karl': 'Karlik_Breeches_KARL_BaseColor.jpg', 'Vest_karl': 'Karlik_Vest_KARL_BaseColor.jpg', 'Karl_decor_vest': 'Karlik_Vest_KARL_BaseColor.jpg',
       'coat1': 'Karlik_Coat_KARL_BaseColor-min.jpg', 'decor_1': 'Karlik_Coat_KARL_BaseColor-min.jpg', 'Kravat_and_cuffs_and_hairband': 'Karlik_Fular_cuffs_hairband_KARL_BaseColor.jpg',
       'Farn_shoe_R001': 'Karlik_Farn_shoes_BaseColor-min.jpg', 'Farn_shoe_L001': 'Karlik_Farn_shoes_BaseColor-min.jpg', 'Man_hose_19th_century001': 'Karlik_Hose_KARL_BaseColor-min.jpg'}
BUDGET = {'coat1': 3800, 'Vest_karl': 700, 'Drawers_karl': 700, 'Kravat_and_cuffs_and_hairband': 700, 'Man_hose_19th_century001': 450, 'Farn_shoe_R001': 500, 'Farn_shoe_L001': 500, 'decor_1': 160, 'Karl_decor_vest': 80}
imgs = {}
def sample(path, uv):
    if path not in imgs: imgs[path] = np.asarray(Image.open(path).convert('RGB').resize((1024, 1024), Image.LANCZOS), np.float32) / 255
    a = imgs[path]; x = np.clip((uv[:, 0] % 1) * 1023, 0, 1023).astype(int); y = np.clip((uv[:, 1] % 1) * 1023, 0, 1023).astype(int); return lin(a[y, x])
def decimate(v, f, c, budget):
    if len(f) <= budget: return v, f, c
    w = trimesh.Trimesh(v, f, process=False); w.merge_vertices(merge_tex=True, merge_norm=True)
    v2, f2 = w.vertices.astype(np.float32), w.faces.astype(np.int64)
    for k in range(4):  # thin, disconnected cloth stops short of the target: more passes, more aggressive
        if len(f2) <= budget * 1.15: break
        v2, f2 = fast_simplification.simplify(v2, f2, target_reduction=1 - budget / len(f2), agg=7 + 3 * k)
    return np.asarray(v2, np.float64), np.asarray(f2), c[cKDTree(v).query(v2)[1]]
parts = []
def usd_parts(path):  # Sketchfab USDZ (unzipped scene.usdc + 0/<material>_baseColor.jpg), centimetres, Y up
    from pxr import Usd, UsdGeom, UsdShade
    st = Usd.Stage.Open(path); unit = UsdGeom.GetStageMetersPerUnit(st); out = []
    for prim in st.Traverse():
        if not prim.IsA(UsdGeom.Mesh): continue
        m = UsdGeom.Mesh(prim); pts = np.array(m.GetPointsAttr().Get(), np.float64)
        M = np.array(UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())).T
        P = (np.c_[pts, np.ones(len(pts))] @ M.T)[:, :3] * unit
        counts = np.array(m.GetFaceVertexCountsAttr().Get()); idx = np.array(m.GetFaceVertexIndicesAttr().Get())
        st_pv = next((q for q in UsdGeom.PrimvarsAPI(prim).GetPrimvars() if q.GetPrimvarName().startswith('st')), None); uv = np.array(st_pv.Get(), np.float64) if st_pv else None
        interp = st_pv.GetInterpolation() if st_pv else None; uvi = st_pv.GetIndices() if st_pv and st_pv.IsIndexed() else None
        # triangulate fans; per-corner uv (faceVarying) or per-vertex
        tris, corner = [], []
        o = 0
        for c in counts:
            for k in range(1, c - 1): tris.append((idx[o], idx[o + k], idx[o + k + 1])); corner.append((o, o + k, o + k + 1))
            o += c
        tris = np.array(tris); corner = np.array(corner)
        mat = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]; mname = mat.GetPath().name if mat else ''
        tex = os.path.join(os.path.dirname(path), '0', mname + '_baseColor.jpg')
        if uv is not None and os.path.exists(tex):
            if interp == 'faceVarying':
                cuv = uv[np.array(uvi)[corner] if uvi is not None else corner]          # (F,3,2)
                V = P[tris].reshape(-1, 3); F = np.arange(len(V)).reshape(-1, 3); UVs = cuv.reshape(-1, 2)
            else:
                V = P; F = tris; UVs = uv[np.array(uvi)] if uvi is not None else uv
            UVs = UVs.copy(); UVs[:, 1] = 1 - UVs[:, 1]   # USD st: v up
            col = sample(tex, UVs)
        else:
            V, F, col = P, tris, np.full((len(P), 3), .35)
        out.append((prim.GetName(), V, F, col))
    return out
def gltf_parts(path):  # a glTF costume (Moskvin's "Textiles: Man's costume #4", the Mysli coat): its own nodes only (parts=
    # node-name prefixes; the scene also holds a table, rulers and cloth swatches), each coloured from <TEXDIR>/<material>_baseColor.jpeg
    keep = [k for k in opts.get('parts', '').split(',') if k]
    sc = trimesh.load(path, force='scene'); out = []
    for node in sc.graph.nodes_geometry:
        T, gn = sc.graph[node]
        if keep and not any(node.startswith(k) or gn.startswith(k) for k in keep): continue
        g = sc.geometry[gn].copy(); g.apply_transform(T)
        mname = getattr(getattr(g.visual, 'material', None), 'name', '') or ''
        tex = next((t for t in (os.path.join(TEXDIR, mname + e) for e in ('_baseColor.jpeg', '_baseColor.jpg', '_baseColor.png')) if os.path.exists(t)), None)
        uv = getattr(g.visual, 'uv', None)
        col = sample(tex, uv) if tex and uv is not None else np.full((len(g.vertices), 3), .35)
        out.append((node, np.asarray(g.vertices, np.float64), np.asarray(g.faces), col))
    return out
if COSTUME.endswith(('.usdc', '.usda', '.usd', '.gltf')):
    raw = gltf_parts(COSTUME) if COSTUME.endswith('.gltf') else usd_parts(COSTUME)
    area = lambda v, f: float(np.linalg.norm(np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]), axis=1).sum() / 2)
    areas = [area(v, f) for _, v, f, _ in raw]; total = sum(areas)
    for (name, v, f, c), ar in zip(raw, areas):  # the triangle budget follows the surface (the trousers under the coat had most of the triangles)
        if 'decor' in name.lower(): continue  # embroidery and cords: thousands of tiny pieces that cannot be simplified
        v2, f2, c2 = decimate(v, f, c, max(160, int(7500 * ar / total)))
        print('  part %-40s %6d -> %6d tris (area %.2f m2)' % (name[:40], len(f), len(f2), ar)); parts.append((name, v2, f2, c2))
else:
  sc = trimesh.load(COSTUME, force='scene')
  for node in sc.graph.nodes_geometry:
    T, gn = sc.graph[node]; g = sc.geometry[gn].copy(); g.apply_transform(T)
    name = next((k for k in TEX if node.startswith(k) or gn.startswith(k)), None)
    col = sample(f'{TEXDIR}/{TEX[name]}', g.visual.uv) if name else np.full((len(g.vertices), 3), .3)
    RECOLOUR = {'coat1': 'coat', 'decor_1': 'coat', 'Vest_karl': 'vest', 'Karl_decor_vest': 'vest', 'Drawers_karl': 'drawers', 'Man_hose_19th_century001': 'hose', 'Farn_shoe_R001': 'shoes', 'Farn_shoe_L001': 'shoes', 'Kravat_and_cuffs_and_hairband': 'cravat'}
    if RECOLOUR.get(name) in opts:  # recolour a part (keeps the texture's light and shade): coat=#hex vest= drawers= hose= shoes=
        hx = opts[RECOLOUR[name]]; tint = lin(np.array([int(hx[i:i + 2], 16) for i in (1, 3, 5)]) / 255); lum = col.mean(1, keepdims=True); col = np.clip(lum / max(lum.mean(), 1e-3) * tint, 0, 1)
    v0, f0 = np.asarray(g.vertices, np.float64), np.asarray(g.faces)
    if name == 'Kravat_and_cuffs_and_hairband':  # keep the cravat; the thin lace cuffs and the hair ribbon only turn into spikes when simplified
        keepf = (v0[f0][:, :, 1].mean(1) > .98) & (v0[f0][:, :, 2].mean(1) > -.05); f0 = f0[keepf]
    v, f, c = decimate(v0, f0, col, int(BUDGET.get(name, 500) * float(opts.get('detail', 1))))  # detail=2: twice the triangles (one-off characters seen up close)
    parts.append((name or gn, v, f, c))
CV = np.vstack([p[1] for p in parts]); offs = np.cumsum([0] + [len(p[1]) for p in parts])
CF = np.vstack([p[2] + o for p, o in zip(parts, offs[:-1])]); CC = np.vstack([p[3] for p in parts])
# layers, outermost first: what lies under a coat must bend with the coat or it pokes through it when he walks
def layer(name):
    n = name.lower()
    if 'coat' in n or 'decor' in n: return 3
    if 'blouse' in n or 'vest' in n or 'trouser' in n or 'drawer' in n: return 2
    if 'hose' in n: return 1
    return 0
LAYER = np.concatenate([np.full(len(p[1]), layer(p[0])) for p in parts])

# fit the costume to the avatar: its collar (the top few centimetres) under the avatar's neck joint, centred on it
neck = Bw['Neck'][:3, 3]; ytop = CV[:, 1].max(); collar_y = ytop - .035 * (ytop - CV[:, 1].min()) / 1.6
ring = CV[CV[:, 1] > ytop - .06 * (ytop - CV[:, 1].min()) / 1.6]
if 'collar' in opts: collar_y = float(opts['collar'])
S = neck[1] / collar_y; cx, cz = ring[:, 0].mean(), (float(opts['neckz']) if 'neckz' in opts else ring[:, 2].mean())
print('collar %.3f, neck opening centre %.3f %.3f' % (collar_y, cx, cz))
CV = np.stack([(CV[:, 0] - cx) * S + neck[0], CV[:, 1] * S, (CV[:, 2] - cz) * S + neck[2]], 1)
print('costume scale %.3f, height %.2f' % (S, CV[:, 1].max() - CV[:, 1].min()))

# the avatar posed with its arms down like the costume's (rotate each upper arm about the forward axis)
prims = R.slim(R.avatar_prims())
def skin_mats(pose_world):  # per-joint skinning matrices for a posed skeleton
    return np.array([pose_world[n] @ IBM[k] for k, n in enumerate(names)])
def lbs(v, J, W, M):
    out = np.zeros_like(v); vh = np.c_[v, np.ones(len(v))]
    for i in range(4): out += W[:, i:i + 1] * np.einsum('nij,nj->ni', M[J[:, i]], vh)[:, :3]
    return out
def rotz_about(M, ang, pivot):  # world rotation about the z (forward) axis through pivot, applied to a world matrix
    c, s = np.cos(ang), np.sin(ang); Rz = np.eye(4); Rz[:2, :2] = [[c, -s], [s, c]]
    Tp = np.eye(4); Tp[:3, 3] = pivot; Ti = np.eye(4); Ti[:3, 3] = -pivot; return Tp @ Rz @ Ti @ M
arm_dir = lambda side: Bw[side + 'Hand'][:3, 3] - Bw[side + 'Arm'][:3, 3]
pose = {n: Bw[n].copy() for n in names}
for side, sgn in (('Left', 1), ('Right', -1)):
    d = arm_dir(side); cur = np.arctan2(-d[1], abs(d[0]))      # angle below horizontal
    want = np.radians(float(opts.get('arm', 82)))              # the costume's sleeves hang almost straight down
    ang = -(want - cur) * sgn                                   # left arm (+x) turns clockwise seen from the front
    piv = Bw[side + 'Arm'][:3, 3]
    for n in names:  # the upper arm and everything below it
        m = n
        while m in parent and m != side + 'Arm': m = parent[m]
        if m == side + 'Arm': pose[n] = rotz_about(Bw[n], ang, piv)
Mpose = skin_mats(pose)
src_v, src_J, src_W = [], [], []
for pr in prims:
    if any(k in pr['mat'] for k in ('Outfit', 'Body', 'Skin')):
        src_v.append(lbs(pr['q'], pr['J'], pr['W'], Mpose)); src_J.append(pr['J']); src_W.append(pr['W'])
src_v = np.vstack(src_v); src_J = np.vstack(src_J); src_W = np.vstack(src_W)
kd = cKDTree(src_v); dist, near = kd.query(CV, k=4)
# blend the 4 nearest avatar vertices' weights (inverse distance), keep the 4 strongest joints
wsum = np.zeros((len(CV), len(names)))
inv = 1 / (dist + 1e-4); inv /= inv.sum(1, keepdims=True)
for k in range(4):
    for i in range(4): np.add.at(wsum, (np.arange(len(CV)), src_J[near[:, k], i]), inv[:, k] * src_W[near[:, k], i])
top = np.argsort(-wsum, 1)[:, :4]; CW = np.take_along_axis(wsum, top, 1); CW /= CW.sum(1, keepdims=True); CJ = top
# inner layers take the weights of the layer over them where it is close (and sink 6 mm under it)
cn0 = trimesh.Trimesh(CV, CF, process=False).vertex_normals
for lv in (2, 1):
    outer = np.where(LAYER > lv)[0]; inner = np.where(LAYER == lv)[0]
    if not len(outer) or not len(inner): continue
    d, k = cKDTree(CV[outer]).query(CV[inner]); close = d < .045
    src_i = outer[k[close]]; dst_i = inner[close]
    CJ[dst_i] = CJ[src_i]; CW[dst_i] = CW[src_i]; CV[dst_i] -= np.asarray(cn0)[dst_i] * .006
    print('layer %d: %d of %d vertices follow the layer over them' % (lv, close.sum(), len(inner)))
print('weights: mean nearest distance %.3f m, max %.3f m' % (dist[:, 0].mean(), dist[:, 0].max()))
# back to the avatar's bind pose (inverse skinning with the posed skeleton)
Minv_v = np.zeros((len(CV), 4, 4))
for i in range(4): Minv_v += CW[:, i, None, None] * Mpose[CJ[:, i]]
CVb = np.einsum('nij,nj->ni', np.linalg.inv(Minv_v), np.c_[CV, np.ones(len(CV))])[:, :3]

# the avatar's head, eyes, teeth and hands (its own weights); hair powdered; no glasses in 1760
keep = []
for pr in prims:
    m = pr['mat']
    if 'Outfit' in m or 'Glasses' in m: continue
    c = pr['c'].copy()
    if 'Hair' in m and opts.get('hair') != 'keep': c = np.clip(c * .25 + np.array([.62, .6, .56]), 0, 1)  # powdered (hair=keep: his own)
    keep.append(dict(pr, c=c))
# tricorne, rigid on the head
head = Bw['Head'][:3, 3]; hair_top = max(p['q'][:, 1].max() for p in prims if 'Hair' in p['mat'])
hat = []
if opts.get('hat') == 'top':  # a tall black top hat (H.C. Andersen, 1830s-60s): slightly flared crown, narrow brim
    upright = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])  # trimesh builds cylinders along z
    hz = head[2] - .012
    for r, h, y in ((.1, .17, hair_top + .035), (.155, .012, hair_top - .046), (.102, .03, hair_top - .03)):  # crown, brim, band
        cy = trimesh.creation.cylinder(radius=r, height=h, sections=20); cy.apply_transform(upright); cy.apply_translation([0, y, hz])
        if h > .1: v = cy.vertices; v[:, [0, 2]] = (v[:, [0, 2]] - [0, hz]) * (1 + .09 * (v[:, 1:2] - (y - h / 2)) / h) + [0, hz]  # the crown flares a little upwards
        hat.append(cy)
for k in range(3 if opts.get('hat') != 'top' else 0):
    a = k * 2 * np.pi / 3
    e = trimesh.creation.box(extents=[.3, .085, .02]); e.apply_translation([0, .02, .115]); e.apply_transform(trimesh.transformations.rotation_matrix(-.35, [1, 0, 0]))
    e.apply_transform(trimesh.transformations.rotation_matrix(a, [0, 1, 0])); e.apply_translation([0, hair_top - .08, head[2] - .01]); hat.append(e)
if opts.get('hat') != 'top':
    brim = trimesh.creation.cylinder(radius=.18, height=.014, sections=3); brim.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0])); brim.apply_translation([0, hair_top - .08, head[2] - .01]); hat.append(brim)
hv = np.vstack([h.vertices for h in hat]); hf = np.vstack([h.faces + o for h, o in zip(hat, np.cumsum([0] + [len(h.vertices) for h in hat])[:-1])])
hn = trimesh.Trimesh(hv, hf, process=False).vertex_normals
keep.append(dict(mat='Hat', q=hv, n=np.asarray(hn), c=np.tile(lin(np.array([20, 18, 17]) / 255), (len(hv), 1)), idx=hf.reshape(-1),
                 J=np.tile([JI['Head'], 0, 0, 0], (len(hv), 1)), W=np.tile([1., 0, 0, 0], (len(hv), 1))))
cn = trimesh.Trimesh(CVb, CF, process=False).vertex_normals
keep.append(dict(mat='Costume', q=CVb, n=np.asarray(cn), c=CC, idx=CF.reshape(-1), J=CJ, W=CW))
def safe_normals(n):
    n = np.nan_to_num(np.asarray(n, np.float64)); bad = np.linalg.norm(n, axis=1) < 1e-8; n[bad] = [0, 1, 0]; return n
P_, N_, C_, J_, W_, I_ = PB.merge([dict(p, n=safe_normals(p['n']), J=np.asarray(p['J']).astype(np.uint8)) for p in keep], [np.eye(4)] * len(keep))
R.write_char(NAME, P_, N_, C_, J_, W_, I_, 'Costume: 18th-century costume from an engraving (Daniel); head: cool-man (Daniel)')
