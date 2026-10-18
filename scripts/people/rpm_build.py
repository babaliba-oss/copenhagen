# Daniel's "cool-man" (a Ready Player Me avatar on a Mixamo skeleton, cool-man.zip: source/dhana.gltf) as a rigged walker,
# and the 1760 costumes dressed on the same skeleton, with the Quaternius clips (anims.glb.gz) retargeted onto it.
#   python3 scripts/people/rpm_build.py scripts/people <dhana.gltf> <anims.glb (gunzipped)> <out dir> [costume parts.pkl ...]
# Writes <out>/R_CoolMan.glb, <out>/anims_r.glb (+ <out>/R_<costume>.glb). Then gzip -9 -n each into public/models/people.
#  - Skeleton: the avatar's own joints, renamed without "mixamorig:", bind pose = the avatar's file pose (an A-pose).
#  - Clips: world-space rotation deltas from the Quaternius bind, applied to the avatar's bind turned into the same T-pose
#    (limb directions aligned to the Quaternius rest first), Hips height scaled by the leg ratio, in place.
import sys, os, json, struct, base64, numpy as np
sys.path.insert(0, sys.argv[1]); import ppl_glb as G
_argv = sys.argv; sys.argv = [_argv[0], _argv[1], '/tmp/', '/tmp/']; import ppl_build as PB; sys.argv = _argv
from PIL import Image
import io
RPM, ANIMS, OUT = sys.argv[2], sys.argv[3], sys.argv[4].rstrip('/') + '/'
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- the avatar
def load_gltf(path):
    if path.endswith('.glb'): j, b = G.load(path); return j, [b]
    j = json.load(open(path)); bufs = []
    for bf in j['buffers']:
        u = bf['uri']; bufs.append(base64.b64decode(u.split(',', 1)[1]) if u.startswith('data:') else open(os.path.join(os.path.dirname(path), u), 'rb').read())
    return j, bufs
def acc(j, bufs, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
    return G.acc({'accessors': [dict(a, bufferView=0)], 'bufferViews': [dict(bv, buffer=0)]}, bufs[bv.get('buffer', 0)], 0)
def image(j, bufs, tex_index):
    im = j['images'][j['textures'][tex_index]['source']]
    if 'bufferView' in im:
        bv = j['bufferViews'][im['bufferView']]; data = bufs[bv.get('buffer', 0)][bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']]
    else:
        u = im['uri']; data = base64.b64decode(u.split(',', 1)[1]) if u.startswith('data:') else open(os.path.join(os.path.dirname(RPM), u), 'rb').read()
    return Image.open(io.BytesIO(data)).convert('RGB')
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

j, bufs = load_gltf(RPM)
skin = j['skins'][0]; JN = skin['joints']; raw_names = [j['nodes'][i]['name'] for i in JN]
clean = lambda n: n.replace('mixamorig:', '')
names = [clean(n) for n in raw_names]
IBM = acc(j, bufs, skin['inverseBindMatrices']).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
Bw = {n: np.linalg.inv(IBM[k]) for k, n in enumerate(names)}      # bind world (mesh space == world: Armature is identity)
idx = {i: clean(j['nodes'][i]['name']) for i in JN}
parent = {}; children = {n: [] for n in names}
for i in JN:
    for c in j['nodes'][i].get('children', []):
        if c in idx: parent[idx[c]] = idx[i]; children[idx[i]].append(idx[c])
ROOTS = [n for n in names if n not in parent]; assert ROOTS[0] == 'Hips', ROOTS  # Hips, then the rig's control bones (unweighted)
order = []
for r in ROOTS:
    st = [r]
    while st:
        n = st.pop(); order.append(n); st.extend(reversed(children[n]))
T, Q = {}, {}
for n in order:
    L = Bw[n] if n in ROOTS else np.linalg.inv(Bw[parent[n]]) @ Bw[n]
    R, S = PB.polar(L[:3, :3]); assert np.abs(S - 1).max() < 1e-3, (n, S)
    T[n] = L[:3, 3].copy(); Q[n] = PB.mat_to_quat(R)
Rb = {n: Bw[n][:3, :3] for n in names}; Pb = {n: Bw[n][:3, 3] for n in names}

class TargetRig:  # what PB.add_armature / write_clips need
    pass
tr = TargetRig(); tr.order = order; tr.children = children; tr.T = T; tr.Q = Q; tr.names = names


# ---------------------------------------------------------------- the Quaternius rig and clips (anims.glb)
ja, ba = G.load(ANIMS)
class SrcRig:
    def __init__(self, j, b):
        nodes = j['nodes']; self.names = [nd['name'] for nd in nodes if nd['name'] != 'CharacterArmature']
        id2n = {i: nd['name'] for i, nd in enumerate(nodes)}; self.parent = {}; self.children = {n: [] for n in self.names}
        for i, nd in enumerate(nodes):
            for c in nd.get('children', []):
                if id2n[i] != 'CharacterArmature': self.parent[id2n[c]] = id2n[i]; self.children[id2n[i]].append(id2n[c])
        self.order = []; st = ['Root']
        while st:
            n = st.pop(); self.order.append(n); st.extend(reversed(self.children[n]))
        self.T, self.Q, self.pose = {}, {}, {}
        for i, nd in enumerate(nodes):
            n = id2n[i]
            if n == 'CharacterArmature': continue
            self.T[n] = np.array(nd.get('translation', [0, 0, 0]), float); self.Q[n] = np.array(nd.get('rotation', [0, 0, 0, 1]), float)
            self.pose[n] = (self.T[n], self.Q[n])
        self.B = {}
        for n in self.order:
            Lm = PB.trs(self.T[n], self.Q[n]); self.B[n] = Lm if n == 'Root' else self.B[self.parent[n]] @ Lm
src = SrcRig(ja, ba); clips = PB.read_clips(ja, ba)
RbS = {n: src.B[n][:3, :3] for n in src.names}; PbS = {n: src.B[n][:3, 3] for n in src.names}

SIDE = {'L': 'Left', 'R': 'Right'}
MAP = {'Hips': 'Hips', 'Abdomen': 'Spine', 'Torso': 'Spine1', 'Chest': 'Spine2', 'Neck': 'Neck', 'Head': 'Head'}
for s, S in SIDE.items():
    MAP.update({f'Shoulder.{s}': f'{S}Shoulder', f'UpperArm.{s}': f'{S}Arm', f'LowerArm.{s}': f'{S}ForeArm', f'Wrist.{s}': f'{S}Hand',
                f'UpperLeg.{s}': f'{S}UpLeg', f'LowerLeg.{s}': f'{S}Leg', f'Foot.{s}': f'{S}Foot'})
    for f in ('Index', 'Middle', 'Ring', 'Pinky'):
        for k in (1, 2, 3): MAP[f'{f}{k}.{s}'] = f'{S}Hand{f}{k}'
    for k in (1, 2, 3): MAP[f'Thumb{k}.{s}'] = f'{S}HandThumb{k}'
MAP = {a: b for a, b in MAP.items() if a in src.names and b in names}
INV = {b: a for a, b in MAP.items()}
# the same side: Quaternius .L and Mixamo Left must both be the character's left
assert np.sign(PbS['UpperArm.L'][0]) == np.sign(Pb['LeftArm'][0]), (PbS['UpperArm.L'], Pb['LeftArm'])
# directions that define each limb bone (bone -> child used to aim it), in both rigs
AIM = {}
for s, S in SIDE.items():
    AIM.update({f'{S}Shoulder': f'{S}Arm', f'{S}Arm': f'{S}ForeArm', f'{S}ForeArm': f'{S}Hand', f'{S}Hand': f'{S}HandMiddle1',
                f'{S}UpLeg': f'{S}Leg', f'{S}Leg': f'{S}Foot'})
    for f in ('Index', 'Middle', 'Ring', 'Pinky'):
        AIM[f'{S}Hand{f}1'] = f'{S}Hand{f}2'; AIM[f'{S}Hand{f}2'] = f'{S}Hand{f}3'
    AIM[f'{S}HandThumb1'] = f'{S}HandThumb2'; AIM[f'{S}HandThumb2'] = f'{S}HandThumb3'
# the spine and neck keep the avatar's own upright rest (aiming them at the stylised Quaternius spine tipped the head back)
AIM = {a: c for a, c in AIM.items() if a in INV and c in INV and c in names}
# the avatar's bind turned into the Quaternius T-pose: each aimed bone points where its Quaternius twin points at rest
A, P = {}, {}
for n in order:
    if n in ROOTS: A[n] = Rb[n]; P[n] = Pb[n]; continue
    p = parent[n]; Rinh = A[p] @ (Rb[p].T @ Rb[n]); P[n] = P[p] + A[p] @ (Rb[p].T @ (Pb[n] - Pb[p]))
    if n in AIM:
        c = AIM[n]; d_local = Rb[n].T @ (Pb[c] - Pb[n]); d_inh = Rinh @ d_local
        d_src = PbS[INV[c]] - PbS[INV[n]]
        A[n] = PB.rot_between(d_inh[None], d_src[None])[0] @ Rinh
    else: A[n] = Rinh
leg = lambda pos, up, lo, ft: np.linalg.norm(pos[lo] - pos[up]) + np.linalg.norm(pos[ft] - pos[lo])
k_leg = leg(Pb, 'LeftUpLeg', 'LeftLeg', 'LeftFoot') / leg(PbS, 'UpperLeg.L', 'LowerLeg.L', 'Foot.L')
print('leg ratio %.3f' % k_leg)

def retarget(name, ch):
    ts = np.unique(np.round(np.concatenate([t for t, v in ch.values()]).astype(np.float64), 5))
    TS, RS = PB.sample(ch, src, ts); RwS, PwS = PB.fk(src, TS, RS)
    Rw = {}
    for n in order:
        if n in INV: s = INV[n]; Rw[n] = RwS[s] @ RbS[s].T @ A[n]
        elif n in ROOTS: Rw[n] = np.tile(A[n], (len(ts), 1, 1))
        else: p = parent[n]; Rw[n] = Rw[p] @ (A[p].T @ A[n])
    out = {}
    for n in order:
        if n not in INV: continue
        Rl = Rw[n] if n == 'Hips' else np.transpose(Rw[parent[n]], (0, 2, 1)) @ Rw[n]
        Qs = np.array([PB.mat_to_quat(r) for r in Rl])
        for f in range(1, len(Qs)):
            if np.dot(Qs[f], Qs[f - 1]) < 0: Qs[f] = -Qs[f]
        out[(n, 'rotation')] = PB.reduce_keys(ts, Qs, 1e-5)
    hip = Pb['Hips'] + (PwS['Hips'] - PbS['Hips']) * k_leg   # in place: Root never moves in the source clips
    out[('Hips', 'translation')] = PB.reduce_keys(ts, hip, 1e-5)
    return (name, out)

rclips = [retarget(n, PB.complete_clip(ch, src)[0]) for n, ch in clips]
def armature(g):
    arm = len(g.j['nodes']); g.j['nodes'].append({'name': 'CharacterArmature', 'children': []}); ni = {}
    for n in order:
        ni[n] = len(g.j['nodes']); nd = {'name': n}
        nd['translation'] = [float(x) for x in T[n]]; nd['rotation'] = [float(x) for x in Q[n]]; g.j['nodes'].append(nd)
    for n in order:
        if children[n]: g.j['nodes'][ni[n]]['children'] = [ni[c] for c in children[n]]
    g.j['nodes'][arm]['children'].extend(ni[r] for r in ROOTS); return arm, ni
g = PB.GLB(); g.j['asset']['copyright'] = 'Clips: CC0 1.0 Quaternius, retargeted'; arm, ni = armature(g); PB.write_clips(g, ni, rclips)
g.j['scenes'] = [{'name': 'Scene', 'nodes': [arm]}]; g.write(OUT + 'anims_r.glb'); print('anims_r.glb', [n for n, _ in rclips])

# ---------------------------------------------------------------- characters on this skeleton
def write_char(cname, P_, N_, C_, J_, W_, I_, copyright):
    g = PB.GLB(); g.j['asset']['copyright'] = copyright; arm, ni = armature(g)
    ibm = np.array([np.linalg.inv(Bw[n]) for n in names]).astype(np.float32)
    g.j['skins'] = [{'name': 'CharacterArmature', 'inverseBindMatrices': g.acc(ibm.transpose(0, 2, 1).reshape(-1, 16), 'MAT4'), 'joints': [ni[n] for n in names], 'skeleton': ni['Hips']}]
    g.j['meshes'] = [{'name': cname, 'primitives': [PB.mesh_prim(g, P_, N_, C_, J_, W_, I_)]}]
    mi = len(g.j['nodes']); g.j['nodes'].append({'name': cname, 'mesh': 0, 'skin': 0})
    g.j['materials'] = [PB.MATERIAL]; g.j['scenes'] = [{'name': 'Scene', 'nodes': [arm, mi]}]; g.write(OUT + cname + '.glb')
    print('%-14s verts %6d tris %6d  height %.2f' % (cname, len(P_), len(I_) // 3, P_[:, 1].max() - P_[:, 1].min()))

def avatar_prims(keep=lambda mat: True):
    out = []
    for nd in j['nodes']:
        if 'mesh' not in nd: continue
        for p in j['meshes'][nd['mesh']]['primitives']:
            mat = j['materials'][p['material']]; mname = mat.get('name', '')
            if not keep(mname): continue
            at = p['attributes']; pos = acc(j, bufs, at['POSITION']).astype(np.float64); nrm = acc(j, bufs, at['NORMAL']).astype(np.float64)
            tex = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            if tex is not None and 'TEXCOORD_0' in at:
                img = np.asarray(image(j, bufs, tex['index']).resize((512, 512)), np.float32) / 255; uv = acc(j, bufs, at['TEXCOORD_0'])
                x = np.clip((uv[:, 0] % 1) * 511, 0, 511).astype(int); y = np.clip((uv[:, 1] % 1) * 511, 0, 511).astype(int); col = lin(img[y, x])
            else: col = np.tile(np.array(mat.get('pbrMetallicRoughness', {}).get('baseColorFactor', [.8, .8, .8, 1])[:3]), (len(pos), 1))
            Jr = acc(j, bufs, at['JOINTS_0']).astype(np.int64); Wt = acc(j, bufs, at['WEIGHTS_0']).astype(np.float64)
            out.append(dict(mat=mname, q=pos, n=nrm, c=col, idx=acc(j, bufs, p['indices'])[:, 0].astype(np.int64), J=Jr, W=Wt))
    return out
# fewer triangles: each part decimated to a budget, skin weights and colours from the nearest original vertex
BUDGETS = {'Skin': 1800, 'Hair': 1100, 'Outfit_Top': 2200, 'Outfit_Footwear': 700, 'Outfit_Bottom': 900, 'Glasses': 260, 'Body': 600, 'Teeth': 60, 'Eye': 120}
def decimate_skinned(pr, budget):
    import trimesh, fast_simplification
    from scipy.spatial import cKDTree
    f = pr['idx'].reshape(-1, 3)
    if len(f) <= budget: return pr
    w = trimesh.Trimesh(pr['q'], f, process=False); w.merge_vertices(merge_tex=True, merge_norm=True)
    v2, f2 = fast_simplification.simplify(w.vertices.astype(np.float32), w.faces.astype(np.int64), target_reduction=1 - budget / len(w.faces))
    near = cKDTree(pr['q']).query(v2)[1]; v2 = np.asarray(v2, np.float64)
    n2 = np.asarray(trimesh.Trimesh(v2, f2, process=False).vertex_normals)
    return dict(pr, q=v2, n=n2, c=pr['c'][near], idx=np.asarray(f2).reshape(-1), J=pr['J'][near], W=pr['W'][near])
def slim(prims):
    out = []
    for pr in prims:
        b = next((v for k, v in BUDGETS.items() if k in pr['mat']), None); out.append(decimate_skinned(pr, b) if b else pr)
    return out
prims = slim(avatar_prims())
for pr in prims: print('  avatar part', pr['mat'], len(pr['q']), len(pr['idx']) // 3)
Pm, Nm, Cm, Jm, Wm, Im = PB.merge([dict(p, J=p['J'].astype(np.uint8) if p['J'].max() < 256 else p['J']) for p in prims], [np.eye(4)] * len(prims))
write_char('R_CoolMan', Pm, Nm, Cm, Jm, Wm, Im, 'Character: cool-man (Daniel)')
np.save(OUT + 'rpm_bind.npy', {'names': names, 'Bw': Bw, 'parent': parent, 'order': order}, allow_pickle=True)
