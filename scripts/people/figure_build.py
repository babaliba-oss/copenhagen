# Daniel's static figures (a scan or a sculpt in one pose, no skeleton of its own) as rigged walkers on a Quaternius rig,
# so they walk with that rig's clips unchanged (anims.glb.gz for M_*, anims_w.glb.gz for W_*; skinned-people.js):
#  1. the figure: its triangles and texture colours per triangle (scripts/models/model_io.py), simplified to `tris`, the
#     colours clustered to k flat colours carried in the vertex colours (the Quaternius look: one colour per region);
#  2. proportions: the figure is stretched piece by piece onto the template's heights (ground, hip joints, shoulder line,
#     crown) and, arms out, onto its arm span, so the template's joints sit where the figure bends;
#  3. pose: the template's arms are lowered to the figure's (arm= degrees below horizontal) and its skin weights copied to
#     each figure vertex from the nearest template vertices that face the same way;
#  4. bind: the figure is turned back into the template's T-pose by inverse skinning and written with the template's
#     skeleton, skin and node names.
#   python3 scripts/people/figure_build.py <template.glb (gunzipped M_/W_)> <figure> <out.glb> [name=W_Name] [tris=6000]
#     [k=14] [arm=deg] [hips=f] [shoulders=f] [crop=x0:x1] [yaw/roll/pitch=deg] [tex= matex= colors= only= skip= (model_io)]
#   hips / shoulders: the figure's hip-joint and shoulder heights as fractions of its height, where a dress or arms at the
#   sides hide them (else found from the gap between the legs and the arms held out).
# Then gzip -9 -n into public/models/people/<name>.glb.gz and add the name to main.js's people for its era.
import sys, os, json, struct, math
import numpy as np
from scipy.cluster.vq import kmeans2
from scipy.spatial import cKDTree
import fast_simplification
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'models'))
import ppl_glb as G
import model_io as io

TPL, SRC, OUT = sys.argv[1:4]
A = dict(a.split('=', 1) for a in sys.argv[4:]); io.configure(SRC, A)
f = lambda k, d=None: float(A[k]) if k in A else d
NAME = A.get('name', os.path.splitext(os.path.basename(OUT))[0])
TRIS, K = int(f('tris', 6000)), int(f('k', 14))
lin = lambda c: np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)

# ---------------------------------------------------------------- the template rig
j, binc = G.load(TPL)
skin = j['skins'][0]; JN = skin['joints']; names = [j['nodes'][i]['name'] for i in JN]; JI = {n: k for k, n in enumerate(names)}
IBM = G.acc(j, binc, skin['inverseBindMatrices']).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
B = np.linalg.inv(IBM)  # bind world per joint
prim = j['meshes'][0]['primitives'][0]; at = prim['attributes']
TV = G.acc(j, binc, at['POSITION']).astype(np.float64); TN = G.acc(j, binc, at['NORMAL']).astype(np.float64)
TJ = G.acc(j, binc, at['JOINTS_0']).astype(int); TW = G.acc(j, binc, at['WEIGHTS_0']).astype(np.float64)
par = {}
for i in JN:
    for c in j['nodes'][i].get('children', []):
        if c in JN: par[JI[j['nodes'][c]['name']]] = JI[j['nodes'][i]['name']]
P = lambda n: B[JI[n]][:3, 3]
top_t = TV[:, 1].max(); hip_t = (P('UpperLeg.L')[1] + P('UpperLeg.R')[1]) / 2; sh_t = (P('UpperArm.L')[1] + P('UpperArm.R')[1]) / 2
shx_t = P('UpperArm.L')[0]; tip_t = np.abs(TV[:, 0]).max()

# ---------------------------------------------------------------- the figure
io.load(SRC)
Pt, UV, MI, mats = io.gather()
if 'crop' in A:  # one figure of a group standing side by side: crop=x0:x1 (the file's x, metres or its own units)
    x0, x1 = map(float, A['crop'].split(':')); cx = Pt.mean(1)[:, 0]; m = (cx >= x0) & (cx <= x1); Pt, UV, MI = Pt[m], UV[m], MI[m]
C = io.face_colours(Pt, UV, MI, mats)
Pt = io.rot(io.to_gltf(Pt))
lo, hi = Pt.reshape(-1, 3).min(0), Pt.reshape(-1, 3).max(0)
Pt = Pt - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
size = np.linalg.norm(hi - lo)
V, F = io.weld(Pt, size * 1e-4)
area = .5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1); ok = area > 0; F, C, area = F[ok], C[ok], area[ok]
rng = np.random.default_rng(1)
cent, _ = kmeans2(C[rng.choice(len(C), min(60000, len(C)), p=area / area.sum())].astype(np.float64), K, seed=1, minit='++')
lab = np.argmin(((C[:, None, :] - cent[None]) ** 2).sum(-1), 1)
cen0 = V[F].mean(1)
used = np.unique(F); remap = np.zeros(len(V), int); remap[used] = np.arange(len(used))
V2, F2 = V[used].astype(np.float32), remap[F].astype(np.int32)
for k in range(5):
    if len(F2) <= TRIS * 1.1: break
    V2, F2 = fast_simplification.simplify(np.ascontiguousarray(V2, np.float32), np.ascontiguousarray(F2, np.int32), target_reduction=1 - TRIS / len(F2), agg=7 + 3 * k)
V2 = V2.astype(np.float64)
tri = V2[F2]; keep = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) > 1e-12; F2 = F2[keep]
_, nn = cKDTree(cen0).query(V2[F2].mean(1)); lab2 = lab[nn]
# a speck of another colour inside a region is noise from the simplification: majority of the face's neighbours
for _ in range(2):
    adj = {}
    for fi, (a, b, c) in enumerate(F2):
        for e in ((a, b), (b, c), (c, a)): adj.setdefault(tuple(sorted(e)), []).append(fi)
    nb = [[] for _ in range(len(F2))]
    for fs in adj.values():
        for x in fs:
            nb[x].extend(y for y in fs if y != x)
    new = lab2.copy()
    for fi, ns in enumerate(nb):
        if len(ns) >= 2:
            vals, cnt = np.unique(lab2[ns], return_counts=True)
            if lab2[fi] not in vals and cnt.max() >= 2: new[fi] = vals[cnt.argmax()]
    lab2 = new

# ---------------------------------------------------------------- proportions: the figure's joints onto the template's
top_f = V2[:, 1].max()
TY, TX = V2[F2][:, :, 1], V2[F2][:, :, 0]
def leg_gap(y):  # open space between the legs at height y: no triangle there crosses the middle (x = 0), but some are near
    at = (TY.min(1) <= y) & (TY.max(1) >= y)
    near = at & (np.abs(TX).min(1) < top_f * .12)
    return near.sum() > 6 and not np.any(at & (TX.min(1) <= 0) & (TX.max(1) >= 0))
hip_f = f('hips') * top_f if 'hips' in A else None
if hip_f is None:
    ys = [y for y in np.linspace(top_f * .30, top_f * .62, 65) if leg_gap(y)]
    hip_f = (max(ys) + top_f * .025) if ys else top_f * hip_t / top_t  # the crotch, a little under the hip joints
arm = f('arm', 0.0)
if 'shoulders' in A: sh_f = f('shoulders') * top_f
elif arm < 20:
    out = V2[np.abs(V2[:, 0]) > np.abs(V2[:, 0]).max() * .55]; sh_f = np.median(out[:, 1]) + top_f * .01 if len(out) > 20 else top_f * sh_t / top_t
else: sh_f = top_f * sh_t / top_t
def ymap(y):
    return np.interp(y, [0, hip_f, sh_f, top_f], [0, hip_t, sh_t, top_t], left=None, right=None) + np.where(y > top_f, (y - top_f) * top_t / top_f, 0)
s_body = top_t / top_f
X = V2[:, 0].copy()
if arm < 20:  # arms out: the arm span onto the template's
    tip_f = np.abs(X).max(); shx_f = shx_t / s_body
    ax = np.abs(X); X = np.sign(X) * np.where(ax <= shx_f, ax * shx_t / shx_f, shx_t + (ax - shx_f) * (tip_t - shx_t) / max(tip_f - shx_f, 1e-6))
else: X = X * s_body
V3 = np.stack([X, ymap(V2[:, 1]), V2[:, 2] * s_body], 1)
print(f'{NAME}: {len(F2)} tris; height {top_f:.2f} -> {top_t:.2f}, hips {hip_f / top_f:.2f}, shoulders {sh_f / top_f:.2f}')

# ---------------------------------------------------------------- pose the template like the figure, copy its weights
def chain_order():
    depth = lambda k: 0 if k not in par else 1 + depth(par[k])
    return sorted(range(len(names)), key=depth)
L = [B[k] if k not in par else np.linalg.inv(B[par[k]]) @ B[k] for k in range(len(names))]
def rz(a, p):
    c, s = math.cos(a), math.sin(a); R = np.eye(4); R[:2, :2] = [[c, -s], [s, c]]
    T = np.eye(4); T[:3, 3] = p; Ti = np.eye(4); Ti[:3, 3] = -np.asarray(p); return T @ R @ Ti
W = [None] * len(names); turn = {'UpperArm.L': -math.radians(arm), 'UpperArm.R': math.radians(arm)}
for k in chain_order():
    W[k] = L[k] if k not in par else W[par[k]] @ L[k]
    if names[k] in turn and turn[names[k]]: W[k] = rz(turn[names[k]], W[k][:3, 3]) @ W[k]
W = np.array(W); S = W @ IBM  # bind -> posed, per joint
def skin_pts(Vb, J, Wt):
    M = np.einsum('vk,vkij->vij', Wt, S[J]); return np.einsum('vij,vj->vi', M[:, :3, :3], Vb) + M[:, :3, 3], M
TVp, _ = skin_pts(TV, TJ, TW)
TNp = np.einsum('vk,vkij,vj->vi', TW, S[TJ][:, :, :3, :3], TN); TNp /= np.linalg.norm(TNp, axis=1, keepdims=True) + 1e-12
# figure normals (smooth) for the facing test
fn = np.cross(V3[F2[:, 1]] - V3[F2[:, 0]], V3[F2[:, 2]] - V3[F2[:, 0]]); VN = np.zeros_like(V3)
for c in range(3): np.add.at(VN, F2[:, c], fn)
VN /= np.linalg.norm(VN, axis=1, keepdims=True) + 1e-12
d, idx = cKDTree(TVp).query(V3, k=16)
face = np.einsum('vi,vki->vk', VN, TNp[idx]) > 0.0
d = np.where(face, d, d * 4 + .05)  # prefer template points facing the same way (the near side of an arm, not the far)
o = np.argsort(d, 1)[:, :4]; d4 = np.take_along_axis(d, o, 1); i4 = np.take_along_axis(idx, o, 1)
wv = 1 / (d4 + 1e-4) ** 2; wv /= wv.sum(1, keepdims=True)
acc = np.zeros((len(V3), len(names)))
for c in range(4): np.add.at(acc, (np.repeat(np.arange(len(V3))[:, None], 4, 1), TJ[i4[:, c]]), TW[i4[:, c]] * wv[:, c:c + 1])
J4 = np.argsort(-acc, 1)[:, :4]; W4 = np.take_along_axis(acc, J4, 1); W4[W4 < .02] = 0; W4 /= W4.sum(1, keepdims=True)
# inverse skinning: posed figure -> template bind
_, M = skin_pts(np.zeros_like(V3), J4, W4)
Vb = np.einsum('vij,vj->vi', np.linalg.inv(M[:, :3, :3]), V3 - M[:, :3, 3])

# ---------------------------------------------------------------- one vertex per (point, colour): flat colour regions
key = F2 * K + lab2[:, None]; uk, inv = np.unique(key.reshape(-1), return_inverse=True)
src = uk // K; col = uk % K
FV = inv.reshape(-1, 3).astype(np.uint32)
POS = Vb[src].astype(np.float32)
fnb = np.cross(Vb[F2[:, 1]] - Vb[F2[:, 0]], Vb[F2[:, 2]] - Vb[F2[:, 0]]); NB = np.zeros_like(Vb)
for c in range(3): np.add.at(NB, F2[:, c], fnb)
NB /= np.linalg.norm(NB, axis=1, keepdims=True) + 1e-12
NOR = NB[src].astype(np.float32); COL = lin(cent[col]).astype(np.float32)
JNT = J4[src].astype(np.uint8); WGT = W4[src].astype(np.float32)
print(f'  {len(POS)} vertices, {len(FV)} triangles, {K} colours; bind min {POS.min(0).round(2)} max {POS.max(0).round(2)}')

# ---------------------------------------------------------------- write: the template's nodes and skin, the new mesh
blobs = []; views = []; accs = []
def add(arr, typ, comp, target=None, minmax=False):
    raw = arr.tobytes(); off = sum(len(b) for b in blobs)
    blobs.append(raw + b'\0' * (-len(raw) % 4))
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(raw)}
    if target: v['target'] = target
    views.append(v); a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
    if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    accs.append(a); return len(accs) - 1
ibm_i = add(IBM.transpose(0, 2, 1).reshape(-1, 16).astype(np.float32), 'MAT4', 5126)
attrs = {'POSITION': add(POS, 'VEC3', 5126, 34962, True), 'NORMAL': add(NOR, 'VEC3', 5126, 34962), 'COLOR_0': add(COL, 'VEC3', 5126, 34962),
         'JOINTS_0': add(JNT, 'VEC4', 5121, 34962), 'WEIGHTS_0': add(WGT, 'VEC4', 5126, 34962)}
ind = add((FV.astype(np.uint16) if len(POS) < 65536 else FV).reshape(-1), 'SCALAR', 5123 if len(POS) < 65536 else 5125, 34963)
out = {'asset': {'version': '2.0', 'generator': 'scripts/people/figure_build.py'}, 'scene': 0, 'scenes': j['scenes'], 'nodes': json.loads(json.dumps(j['nodes'])),
       'skins': [dict(skin, inverseBindMatrices=ibm_i)], 'materials': j['materials'],
       'meshes': [{'name': NAME, 'primitives': [{'attributes': attrs, 'indices': ind, 'material': prim.get('material', 0), 'mode': 4}]}],
       'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': sum(len(b) for b in blobs)}]}
for nd in out['nodes']:
    if 'mesh' in nd: nd['name'] = NAME
jb = json.dumps(out, separators=(',', ':')).encode(); jb += b' ' * (-len(jb) % 4); bb = b''.join(blobs)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bb)) + struct.pack('<II', len(jb), 0x4E4F534A) + jb + struct.pack('<II', len(bb), 0x004E4942) + bb
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True); open(OUT, 'wb').write(glb)
print(f'  {OUT}: {len(glb) // 1024} KB')
