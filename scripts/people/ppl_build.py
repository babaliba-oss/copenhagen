# Build game-ready Quaternius people (numpy only, no Blender needed):
#   <OUT>/<char>.glb   one skinned mesh, COLOR_0 = baked material colour, one white material,
#                      joints at true bind pose (Root at origin), plain float buffers
#   <OUT>/anims.glb    male rig + the 9 clips of anims_h.glb (original keys, pruned constant channels re-added)
#   <OUT>/anims_w.glb  female rig + the same 9 clips retargeted (W rig has other bone rolls/proportions)
#   <OUT>/props/*.glb  hand-held weapon meshes (not merged into the characters), local to bone Middle1.R
# usage: python3 scripts/people/ppl_build.py scripts/people <Quaternius assets dir> <out dir>   (numpy; then gzip -9 -n each .glb into public/models/people/<name>.glb.gz)
import sys, os, json, struct, numpy as np
sys.path.insert(0, sys.argv[1]); import ppl_glb as G
ASSETS, OUT = sys.argv[2].rstrip('/') + '/', sys.argv[3].rstrip('/') + '/'
CHARS = ['M_Casual_2', 'M_Casual_Hoodie', 'M_Farmer', 'M_King', 'M_Punk', 'M_Suit', 'M_Worker',
         'W_Casual', 'W_Formal', 'W_Medieval', 'W_Suit', 'W_Worker']
PROPS = {'Pistol', 'Sword'}          # hand-held weapons -> separate prop files
ROOT = 'Root'
os.makedirs(OUT + 'props', exist_ok=True)

# ---------------------------------------------------------------- math
def quat_to_mat(q):
    return G.quat_to_mat(np.asarray(q, dtype=np.float64))
def mat_to_quat(R):
    m = R; t = np.trace(m)
    if t > 0:
        s = np.sqrt(t + 1.0) * 2; w = 0.25 * s; x = (m[2, 1] - m[1, 2]) / s; y = (m[0, 2] - m[2, 0]) / s; z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; w = (m[2, 1] - m[1, 2]) / s; x = 0.25 * s; y = (m[0, 1] + m[1, 0]) / s; z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; w = (m[0, 2] - m[2, 0]) / s; x = (m[0, 1] + m[1, 0]) / s; y = 0.25 * s; z = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; w = (m[1, 0] - m[0, 1]) / s; x = (m[0, 2] + m[2, 0]) / s; y = (m[1, 2] + m[2, 1]) / s; z = 0.25 * s
    q = np.array([x, y, z, w]); q /= np.linalg.norm(q)
    return q if q[3] >= 0 else -q
def polar(M3):
    U, S, Vt = np.linalg.svd(M3); R = U @ Vt
    if np.linalg.det(R) < 0: U[:, -1] *= -1; R = U @ Vt
    return R, S
def trs(t, q):
    M = np.eye(4); M[:3, :3] = quat_to_mat(q); M[:3, 3] = t; return M
def rot_between(u, v):
    """batched minimal rotation taking direction u to direction v: (F,3),(F,3)->(F,3,3)"""
    u = u / np.linalg.norm(u, axis=-1, keepdims=True); v = v / np.linalg.norm(v, axis=-1, keepdims=True)
    a = np.cross(u, v); c = np.sum(u * v, -1)
    K = np.zeros(a.shape[:-1] + (3, 3))
    K[..., 0, 1], K[..., 0, 2], K[..., 1, 0] = -a[..., 2], a[..., 1], a[..., 2]
    K[..., 1, 2], K[..., 2, 0], K[..., 2, 1] = -a[..., 0], -a[..., 1], a[..., 0]
    return np.eye(3) + K + (K @ K) / (1.0 + c)[..., None, None]
def slerp(q0, q1, u):
    d = np.sum(q0 * q1, -1); q1 = np.where(d[:, None] < 0, -q1, q1); d = np.abs(d)
    th = np.arccos(np.clip(d, -1, 1)); sn = np.sin(th); small = sn < 1e-6
    w0 = np.where(small, 1 - u, np.sin((1 - u) * th) / np.where(small, 1, sn))
    w1 = np.where(small, u, np.sin(u * th) / np.where(small, 1, sn))
    q = w0[:, None] * q0 + w1[:, None] * q1
    return q / np.linalg.norm(q, axis=1, keepdims=True)

# ---------------------------------------------------------------- GLB writer
class GLB:
    CT = {np.float32: 5126, np.uint8: 5121, np.uint16: 5123, np.uint32: 5125}
    def __init__(self):
        self.bin = bytearray(); self.cache = {}
        self.j = {'asset': {'version': '2.0', 'generator': 'ppl_build.py (numpy)', 'copyright': 'CC0 1.0 - Quaternius'},
                  'scene': 0, 'scenes': [], 'nodes': [], 'buffers': [], 'bufferViews': [], 'accessors': []}
    def acc(self, arr, typ, target=None, minmax=False, dedup=False):
        arr = np.ascontiguousarray(arr); key = (arr.tobytes(), typ, str(arr.dtype))
        if dedup and key in self.cache: return self.cache[key]
        self.bin += b'\0' * ((-len(self.bin)) % 4)
        bv = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': arr.nbytes}
        if target: bv['target'] = target
        self.bin += arr.tobytes(); self.j['bufferViews'].append(bv)
        a = {'bufferView': len(self.j['bufferViews']) - 1, 'componentType': self.CT[arr.dtype.type], 'count': int(arr.shape[0]), 'type': typ}
        if minmax:
            a2 = arr.reshape(arr.shape[0], -1); a['min'] = [float(x) for x in a2.min(0)]; a['max'] = [float(x) for x in a2.max(0)]
        self.j['accessors'].append(a); i = len(self.j['accessors']) - 1
        if dedup: self.cache[key] = i
        return i
    def write(self, path):
        self.bin += b'\0' * ((-len(self.bin)) % 4)
        self.j['buffers'] = [{'byteLength': len(self.bin)}]
        for k in [k for k, v in self.j.items() if v == []]: del self.j[k]
        js = json.dumps(self.j, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack('<II', len(self.bin), 0x004E4942)); f.write(bytes(self.bin))

# ---------------------------------------------------------------- rig
class Rig:
    """Joint hierarchy + true bind pose recovered from the IBMs (which have the quantization volume folded in).
    Bind world matrices are taken relative to the Root joint, so Root sits at the origin with identity rotation."""
    def __init__(self, j, b):
        sk = j['skins'][0]; jt = sk['joints']; self.names = [j['nodes'][i]['name'] for i in jt]
        self.ibm_src = G.acc(j, b, sk['inverseBindMatrices']).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
        r = self.names.index(ROOT); self.ir = self.ibm_src[r]
        Bsrc = {n: self.ir @ np.linalg.inv(self.ibm_src[k]) for k, n in enumerate(self.names)}
        idx = {i: n for n, i in zip(self.names, jt)}
        self.parent = {}; self.children = {n: [] for n in self.names}
        for i in jt:
            for c in j['nodes'][i].get('children', []):
                if c in idx: self.parent[idx[c]] = idx[i]; self.children[idx[i]].append(idx[c])
        assert ROOT not in self.parent and all(n in self.parent for n in self.names if n != ROOT)
        self.order = []; st = [ROOT]
        while st:
            n = st.pop(); self.order.append(n); st.extend(reversed(self.children[n]))
        self.T, self.Q, maxs = {}, {}, 0
        for n in self.order:
            L = Bsrc[n] if n == ROOT else np.linalg.inv(Bsrc[self.parent[n]]) @ Bsrc[n]
            R, S = polar(L[:3, :3]); maxs = max(maxs, np.abs(S - 1).max())
            self.T[n] = L[:3, 3].copy(); self.Q[n] = mat_to_quat(R)
        assert maxs < 1e-4, maxs
        assert np.abs(self.T[ROOT]).max() < 1e-6 and abs(self.Q[ROOT][3] - 1) < 1e-9
        self.T[ROOT] = np.zeros(3); self.Q[ROOT] = np.array([0, 0, 0, 1.0])
        self.B = {}
        for n in self.order:
            Lm = trs(self.T[n], self.Q[n]); self.B[n] = Lm if n == ROOT else self.B[self.parent[n]] @ Lm
        self.Bsrc = Bsrc
        self.pose = {}   # node TRS stored in the source file (a posed frame; used for channels the clips omit)
        for n, i in zip(self.names, jt):
            nd = j['nodes'][i]; self.pose[n] = (np.array(nd.get('translation', [0, 0, 0]), float), np.array(nd.get('rotation', [0, 0, 0, 1]), float))
    def same_as(self, o):
        return self.names == o.names and self.parent == o.parent and max(np.abs(self.Bsrc[n] - o.Bsrc[n]).max() for n in self.names) < 1e-5

def add_armature(g, rig):
    """append CharacterArmature + joint nodes (bind-pose TRS); returns (armature index, {joint name: node index})"""
    arm = len(g.j['nodes']); g.j['nodes'].append({'name': 'CharacterArmature', 'children': []})
    ni = {}
    for n in rig.order:
        ni[n] = len(g.j['nodes']); nd = {'name': n}
        if np.abs(rig.T[n]).max() > 0: nd['translation'] = [float(x) for x in rig.T[n]]
        if np.abs(rig.Q[n][:3]).max() > 0: nd['rotation'] = [float(x) for x in rig.Q[n]]
        g.j['nodes'].append(nd)
    for n in rig.order:
        if rig.children[n]: g.j['nodes'][ni[n]]['children'] = [ni[c] for c in rig.children[n]]
    g.j['nodes'][arm]['children'].append(ni[ROOT])
    return arm, ni

# ---------------------------------------------------------------- characters
def load_prims(j, b, rig, node_filter):
    out = []
    for nidx, nd in enumerate(j['nodes']):
        if 'mesh' not in nd or not node_filter(nd): continue
        for p in j['meshes'][nd['mesh']]['primitives']:
            assert p.get('mode', 4) == 4
            at = p['attributes']; q = G.acc(j, b, at['POSITION']); nrm = G.acc(j, b, at['NORMAL'])
            col = np.array(j['materials'][p['material']]['pbrMetallicRoughness'].get('baseColorFactor', [1, 1, 1, 1])[:3], float)
            vc = np.broadcast_to(col, (len(q), 3)).copy()
            if 'COLOR_0' in at: vc *= G.acc(j, b, at['COLOR_0'])[:, :3]
            out.append(dict(node=nd, nidx=nidx, q=q, n=nrm, c=vc, idx=G.acc(j, b, p['indices'])[:, 0].astype(np.int64),
                            J=G.acc(j, b, at['JOINTS_0']) if 'JOINTS_0' in at else None,
                            W=G.acc(j, b, at['WEIGHTS_0']) if 'WEIGHTS_0' in at else None, mat=j['materials'][p['material']]['name']))
    return out

def xform(M, p, n):
    P = p @ M[:3, :3].T + M[:3, 3]; N = n @ np.linalg.inv(M[:3, :3])   # normals: inverse-transpose
    return P, N / np.linalg.norm(N, axis=1, keepdims=True)

def merge(prims, mats):
    P, N, C, J, W, I, off = [], [], [], [], [], [], 0
    for pr, M in zip(prims, mats):
        p, n = xform(M, pr['q'], pr['n']); P.append(p); N.append(n); C.append(pr['c']); I.append(pr['idx'] + off); off += len(p)
        if pr['J'] is not None: J.append(pr['J']); W.append(pr['W'])
    P = np.concatenate(P).astype(np.float32); N = np.concatenate(N).astype(np.float32); C = np.concatenate(C).astype(np.float32)
    I = np.concatenate(I)
    if J:
        J = np.concatenate(J).astype(np.uint8); W = np.concatenate(W).astype(np.float64)
        W[W < 1e-6] = 0; W /= W.sum(1, keepdims=True); J[W == 0] = 0; W = W.astype(np.float32)
    else: J = W = None
    # weld exact duplicates (identical position/normal/colour/skin) - does not change shading
    cols = [P.view(np.uint32), N.view(np.uint32), C.view(np.uint32)] + ([W.view(np.uint32), J.astype(np.uint32)] if J is not None else [])
    key = np.ascontiguousarray(np.concatenate(cols, 1)); kv = key.view(np.dtype((np.void, key.dtype.itemsize * key.shape[1])))[:, 0]
    _, first, inv = np.unique(kv, return_index=True, return_inverse=True)
    order = np.argsort(first); remap = np.empty_like(order); remap[order] = np.arange(len(order))
    keep = first[order]; I = remap[inv.ravel()][I].reshape(-1, 3)
    I = I[(I[:, 0] != I[:, 1]) & (I[:, 1] != I[:, 2]) & (I[:, 0] != I[:, 2])].ravel()
    sel = lambda a: None if a is None else a[keep]
    return sel(P), sel(N), sel(C), sel(J), sel(W), I

def mesh_prim(g, P, N, C, J, W, I):
    it = np.uint16 if len(P) < 65536 else np.uint32
    at = {'POSITION': g.acc(P, 'VEC3', 34962, minmax=True), 'NORMAL': g.acc(N, 'VEC3', 34962), 'COLOR_0': g.acc(C, 'VEC3', 34962)}
    if J is not None: at['JOINTS_0'] = g.acc(J, 'VEC4', 34962); at['WEIGHTS_0'] = g.acc(W, 'VEC4', 34962)
    return {'attributes': at, 'indices': g.acc(I.astype(it), 'SCALAR', 34963), 'material': 0, 'mode': 4}

MATERIAL = {'name': 'Character', 'pbrMetallicRoughness': {'baseColorFactor': [1.0, 1.0, 1.0, 1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.5}, 'doubleSided': True}

def build_char(name, canon):
    j, b = G.load(ASSETS + name + '.glb'); rig = Rig(j, b); assert rig.same_as(canon), name
    prims = load_prims(j, b, rig, lambda nd: nd['name'] not in PROPS)
    assert all(p['J'] is not None for p in prims), 'unskinned non-prop mesh in ' + name
    # quantized positions -> Root-relative bind space with this file's own IBM (dequantization folded in)
    P, N, C, J, W, I = merge(prims, [rig.ir] * len(prims))
    g = GLB(); arm, ni = add_armature(g, canon)
    ibm = np.array([np.linalg.inv(canon.B[n]) for n in canon.names]).astype(np.float32)
    g.j['skins'] = [{'name': 'CharacterArmature', 'inverseBindMatrices': g.acc(ibm.transpose(0, 2, 1).reshape(-1, 16), 'MAT4'),
                     'joints': [ni[n] for n in canon.names], 'skeleton': ni[ROOT]}]
    g.j['meshes'] = [{'name': name, 'primitives': [mesh_prim(g, P, N, C, J, W, I)]}]
    mi = len(g.j['nodes']); g.j['nodes'].append({'name': name, 'mesh': 0, 'skin': 0})   # skinned mesh node at scene root (glTF best practice)
    g.j['materials'] = [MATERIAL]; g.j['scenes'] = [{'name': 'Scene', 'nodes': [arm, mi]}]
    g.write(OUT + name + '.glb')
    # props: express in the local frame of the bone they are attached to
    for pn in sorted({p['node']['name'] for p in load_prims(j, b, rig, lambda nd: nd['name'] in PROPS)}):
        pp = load_prims(j, b, rig, lambda nd, pn=pn: nd['name'] == pn); nd = pp[0]['node']
        if pp[0]['J'] is not None:   # skinned rigidly to one bone
            used = {rig.names[k] for p in pp for k in np.unique(p['J'][p['W'] > 0])}; assert len(used) == 1, used
            bone = used.pop(); M = np.linalg.inv(canon.B[bone]) @ rig.ir
        else:                        # plain child node of a bone
            par = [k for k, x in enumerate(j['nodes']) if pp[0]['nidx'] in x.get('children', [])][0]
            bone = j['nodes'][par]['name']; M = G.node_local(nd)
        for p in pp: p['J'] = p['W'] = None
        Pp, Np, Cp, _, _, Ip = merge(pp, [M] * len(pp))
        gp = GLB(); gp.j['meshes'] = [{'name': pn, 'primitives': [mesh_prim(gp, Pp, Np, Cp, None, None, Ip)]}]
        gp.j['nodes'] = [{'name': pn, 'mesh': 0, 'extras': {'attachToBone': bone}}]; gp.j['materials'] = [MATERIAL]
        gp.j['scenes'] = [{'name': 'Scene', 'nodes': [0]}]; gp.write(OUT + 'props/%s_%s.glb' % (name, pn))
        print('  prop %s -> props/%s_%s.glb (attach to %s, %d tris)' % (pn, name, pn, bone, len(Ip) // 3))
    print('%-16s verts %6d tris %6d' % (name, len(P), len(I) // 3))

# ---------------------------------------------------------------- animations
def read_clips(j, b):
    clips = []
    for a in j['animations']:
        ch = {}
        for c in a['channels']:
            s = a['samplers'][c['sampler']]; assert s.get('interpolation', 'LINEAR') == 'LINEAR'
            ch[(j['nodes'][c['target']['node']]['name'], c['target']['path'])] = (G.acc(j, b, s['input'])[:, 0].astype(np.float32), G.acc(j, b, s['output']).astype(np.float32))
        clips.append((a['name'], ch))
    return clips

def write_clips(g, ni, clips):
    g.j['animations'] = []
    for name, ch in clips:
        samplers, channels = [], []
        for (node, path), (t, v) in ch.items():
            samplers.append({'input': g.acc(np.asarray(t, np.float32), 'SCALAR', minmax=True, dedup=True),
                             'output': g.acc(np.asarray(v, np.float32), 'VEC3' if path == 'translation' else 'VEC4', dedup=True), 'interpolation': 'LINEAR'})
            channels.append({'sampler': len(samplers) - 1, 'target': {'node': ni[node], 'path': path}})
        g.j['animations'].append({'name': name, 'channels': channels, 'samplers': samplers})

def complete_clip(ch, rig):
    """add constant 2-key channels for every joint/path the clip omits (except Root), using the source node TRS,
    so each clip fully defines the pose independently of the character's rest pose"""
    t0 = min(t[0] for t, v in ch.values()); t1 = max(t[-1] for t, v in ch.values()); out = dict(ch); added = 0
    for n in rig.names:
        if n == ROOT: continue
        for path, k in (('translation', 0), ('rotation', 1)):
            if (n, path) not in out:
                out[(n, path)] = (np.array([t0, t1], np.float32), np.tile(rig.pose[n][k], (2, 1)).astype(np.float32)); added += 1
    return out, added

def sample(ch, rig, ts):
    """local TRS of every joint at times ts (Root forced to identity: everything Root-relative)"""
    T, R = {}, {}
    for n in rig.names:
        for path, store, k in (('translation', T, 0), ('rotation', R, 1)):
            if n == ROOT: store[n] = np.tile([0, 0, 0] if k == 0 else [0, 0, 0, 1.0], (len(ts), 1)); continue
            if (n, path) not in ch: store[n] = np.tile(rig.pose[n][k], (len(ts), 1)); continue
            t, v = ch[(n, path)]; t = t.astype(np.float64); v = v.astype(np.float64)
            if len(t) == 1: store[n] = np.tile(v[0], (len(ts), 1)); continue
            i = np.clip(np.searchsorted(t, ts, side='right') - 1, 0, len(t) - 2); u = np.clip((ts - t[i]) / (t[i + 1] - t[i]), 0, 1)
            store[n] = v[i] * (1 - u[:, None]) + v[i + 1] * u[:, None] if k == 0 else slerp(v[i], v[i + 1], u)
    return T, R

def fk(rig, T, R):
    Rw, Pw = {}, {}
    for n in rig.order:
        Rl = np.array([quat_to_mat(q) for q in R[n]])
        if n == ROOT: Rw[n] = Rl; Pw[n] = T[n].copy()
        else: p = rig.parent[n]; Rw[n] = Rw[p] @ Rl; Pw[n] = Pw[p] + np.einsum('fij,fj->fi', Rw[p], T[n])
    return Rw, Pw

def reduce_keys(t, v, eps):
    keep = [0]; n = len(t)
    for i in range(1, n - 1):
        p = keep[-1]; ok = True
        for k in range(p + 1, i + 1):
            u = (t[k] - t[p]) / (t[i + 1] - t[p]); est = v[p] * (1 - u) + v[i + 1] * u
            if np.abs(est - v[k]).max() > eps: ok = False; break
        if not ok: keep.append(i)
    keep.append(n - 1); return t[keep], v[keep]

def retarget(clips, M, W, stats):
    """M-rig clips -> W rig. Rotations: world-space delta from bind (handles the different bone rolls).
    Translations: W bone offsets + transferred deltas (root/IK targets scaled by leg-length ratio).
    Legs: analytic 2-bone IK so the shin always ends at the (transferred) foot bone."""
    leg = lambda r, s: np.linalg.norm(r.T['LowerLeg.' + s]) + np.linalg.norm(r.B['Foot.' + s][:3, 3] - r.B['LowerLeg.' + s][:3, 3])
    k = leg(W, 'L') / leg(M, 'L'); stats['leg_ratio'] = k
    RbM = {n: M.B[n][:3, :3] for n in M.names}; RbW = {n: W.B[n][:3, :3] for n in W.names}
    out = []
    for name, ch in clips:
        ts = np.unique(np.round(np.concatenate([t for t, v in ch.values()]).astype(np.float64), 5))
        TM, RM = sample(ch, M, ts); RwM, PwM = fk(M, TM, RM)
        RwW, PwW, tW = {}, {}, {}
        for n in W.order:
            if n == ROOT: RwW[n] = np.tile(np.eye(3), (len(ts), 1, 1)); PwW[n] = np.zeros((len(ts), 3)); continue
            p = W.parent[n]; s = k if p == ROOT else 1.0
            RwW[n] = RwM[n] @ RbM[n].T @ RbW[n]
            tW[n] = W.T[n] + s * (TM[n] - M.T[n]) @ (RbW[p].T @ RbM[p]).T
            PwW[n] = PwW[p] + np.einsum('fij,fj->fi', RwW[p], tW[n])
        ik_corr, clamp = 0.0, 0.0
        for sd in 'LR':
            up, lo, ft = 'UpperLeg.' + sd, 'LowerLeg.' + sd, 'Foot.' + sd
            H = PwW[up]; tl = W.T[lo]; fl = RbW[lo].T @ (W.B[ft][:3, 3] - W.B[lo][:3, 3])
            a, bb = np.linalg.norm(tl), np.linalg.norm(fl); F = PwW[ft].copy()
            Kfk = H + np.einsum('fij,j->fi', RwW[up], tl)
            dv = F - H; d = np.linalg.norm(dv, axis=1)
            dc = np.clip(d, abs(a - bb) + 1e-4, a + bb - 1e-4); clamp = max(clamp, np.abs(dc - d).max())
            u = dv / d[:, None]; F = H + u * dc[:, None]
            h = Kfk - H; nv = h - np.sum(h * u, 1)[:, None] * u; ln = np.linalg.norm(nv, axis=1)
            pole = PwW['PT.' + sd] - H; pv = pole - np.sum(pole * u, 1)[:, None] * u   # fallback if the FK leg is straight
            nv = np.where((ln < 1e-6)[:, None], pv, nv); nv /= np.linalg.norm(nv, axis=1, keepdims=True)
            ca = np.clip((a * a + dc * dc - bb * bb) / (2 * a * dc), -1, 1); K = H + a * (ca[:, None] * u + np.sqrt(1 - ca ** 2)[:, None] * nv)
            ik_corr = max(ik_corr, np.linalg.norm(K - Kfk, axis=1).max())
            RwW[up] = rot_between(np.einsum('fij,j->fi', RwW[up], tl), K - H) @ RwW[up]
            RwW[lo] = rot_between(np.einsum('fij,j->fi', RwW[lo], fl), F - K) @ RwW[lo]
            PwW[lo] = K; PwW[ft] = F
        stats.setdefault('ik', []).append((name, ik_corr, clamp))
        nch = {}
        for n in W.names:
            if n == ROOT: continue
            p = W.parent[n]
            Rl = np.transpose(RwW[p], (0, 2, 1)) @ RwW[n]; Tl = np.einsum('fji,fj->fi', RwW[p], PwW[n] - PwW[p])
            Q = np.array([mat_to_quat(r) for r in Rl])
            for f in range(1, len(Q)):
                if np.dot(Q[f], Q[f - 1]) < 0: Q[f] = -Q[f]
            nch[(n, 'translation')] = reduce_keys(ts, Tl, 1e-5); nch[(n, 'rotation')] = reduce_keys(ts, Q, 1e-5)
        out.append((name, nch))
    return out

def build_anims(Mrig, Wrig):
    ja, ba = G.load(ASSETS + 'anims_h.glb'); ra = Rig(ja, ba); assert ra.same_as(Mrig)
    clips = read_clips(ja, ba)
    full = []
    for name, ch in clips:
        c2, added = complete_clip(ch, ra); full.append((name, c2))
        print('  clip %-13s %5.3fs  channels %d (+%d constant)' % (name, max(t[-1] for t, v in ch.values()), len(ch), added))
    g = GLB(); arm, ni = add_armature(g, Mrig); write_clips(g, ni, full)
    g.j['scenes'] = [{'name': 'Scene', 'nodes': [arm]}]; g.write(OUT + 'anims.glb')
    stats = {}; wclips = retarget(full, ra, Wrig, stats)
    g = GLB(); arm, ni = add_armature(g, Wrig); write_clips(g, ni, wclips)
    g.j['scenes'] = [{'name': 'Scene', 'nodes': [arm]}]; g.write(OUT + 'anims_w.glb')
    print('  W retarget: leg ratio %.4f' % stats['leg_ratio'])
    for name, corr, cl in stats['ik']: print('    %-13s IK knee shift max %.4f m, reach clamp max %.4f m' % (name, corr, cl))

if __name__ == '__main__':
    canon = {}
    for g_, ref in (('M', 'M_Casual_2'), ('W', 'W_Casual')):
        j, b = G.load(ASSETS + ref + '.glb'); canon[g_] = Rig(j, b)
    for c in CHARS: build_char(c, canon[c[0]])
    build_anims(canon['M'], canon['W'])
