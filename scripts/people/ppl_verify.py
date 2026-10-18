# Verify people outputs: structure/stats per GLB, trimesh load, and skinned-animation checks
# usage: python3 scripts/people/ppl_verify.py scripts/people <Quaternius assets dir> <out dir>   (numpy, trimesh)
import sys, os, glob, json, numpy as np
sys.path.insert(0, sys.argv[1]); import ppl_glb as G
ASSETS, OUT = sys.argv[2].rstrip('/') + '/', sys.argv[3].rstrip('/') + '/'
import trimesh

def node_maps(j):
    par = {c: i for i, nd in enumerate(j['nodes']) for c in nd.get('children', [])}
    return par, {nd.get('name'): i for i, nd in enumerate(j['nodes'])}

def check_buffers(j, b):
    for bv in j['bufferViews']:
        assert bv['byteOffset'] % 4 == 0 and bv['byteOffset'] + bv['byteLength'] <= len(b)
    for a in j['accessors']:
        bv = j['bufferViews'][a['bufferView']]; sz = np.dtype(G.CT[a['componentType']]).itemsize * G.NC[a['type']]
        assert a.get('byteOffset', 0) + sz * a['count'] <= bv['byteLength']

def char_stats(path):
    j, b = G.load(path); check_buffers(j, b)
    assert len(j['meshes']) == 1 and len(j['meshes'][0]['primitives']) == 1 and len(j['materials']) == 1
    assert 'animations' not in j and 'extensionsUsed' not in j and len(j['skins']) == 1
    pr = j['meshes'][0]['primitives'][0]; at = pr['attributes']
    P = G.acc(j, b, at['POSITION']); N = G.acc(j, b, at['NORMAL']); C = G.acc(j, b, at['COLOR_0'])
    Jt = G.acc(j, b, at['JOINTS_0']); W = G.acc(j, b, at['WEIGHTS_0']); I = G.acc(j, b, pr['indices'])[:, 0]
    sk = j['skins'][0]; nj = len(sk['joints'])
    assert j['accessors'][at['POSITION']]['componentType'] == 5126 and I.max() < len(P) and Jt.max() < nj
    assert np.abs(W.sum(1) - 1).max() < 1e-5 and ((W > 0).sum(1) <= 4).all() and np.abs(np.linalg.norm(N, axis=1) - 1).max() < 1e-3
    assert np.abs(np.array(j['accessors'][at['POSITION']]['min']) - P.min(0)).max() == 0
    # transforms: armature + mesh node carry none
    for nd in j['nodes']:
        if nd.get('name') == 'CharacterArmature' or 'mesh' in nd: assert not any(k in nd for k in ('translation', 'rotation', 'scale', 'matrix'))
        assert 'scale' not in nd and 'matrix' not in nd
    # rest-pose skinning == bind mesh (node TRS consistent with IBMs)
    Wm, _ = G.world_mats(j); ibm = G.acc(j, b, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    S = np.array([Wm[sk['joints'][k]] @ ibm[k] for k in range(nj)]); err = np.abs(S - np.eye(4)).max()
    mat = j['materials'][0]['pbrMetallicRoughness']['baseColorFactor']
    tm = trimesh.load(path, force='mesh', process=False)
    return dict(tris=len(I) // 3, verts=len(P), attrs=sorted(at), joints=nj, lo=P.min(0), hi=P.max(0), size=os.path.getsize(path),
                cols=len(np.unique(C.round(4), axis=0)), restErr=err, mat=mat, tm=(len(tm.faces), len(tm.vertices)), nodes=len(j['nodes']),
                colrange=(C.min(), C.max()), ctypes={k: (j['accessors'][v]['componentType'], j['accessors'][v]['type']) for k, v in at.items()})

# ---------------- skinning evaluation (glTF semantics: clip tracks override node TRS by node name)
def clip_pose(j, b, anim_name, t):
    for a in j['animations']:
        if a['name'] != anim_name: continue
        out = {}
        for c in a['channels']:
            s = a['samplers'][c['sampler']]; ti = G.acc(j, b, s['input'])[:, 0]; v = G.acc(j, b, s['output'])
            if len(ti) == 1: val = v[0]
            else:
                i = int(np.clip(np.searchsorted(ti, t, side='right') - 1, 0, len(ti) - 2)); u = float(np.clip((t - ti[i]) / (ti[i + 1] - ti[i]), 0, 1))
                if c['target']['path'] == 'rotation':
                    q0, q1 = v[i].astype(float), v[i + 1].astype(float)
                    if np.dot(q0, q1) < 0: q1 = -q1
                    th = np.arccos(np.clip(np.dot(q0, q1), -1, 1))
                    val = q0 * (1 - u) + q1 * u if th < 1e-6 else (np.sin((1 - u) * th) * q0 + np.sin(u * th) * q1) / np.sin(th)
                    val /= np.linalg.norm(val)
                else: val = v[i] * (1 - u) + v[i + 1] * u
            out[(j['nodes'][c['target']['node']]['name'], c['target']['path'])] = np.asarray(val, float)
        return out
    raise KeyError(anim_name)

def skinned(jc, bc, pose, positions=None, dequant=True):
    """world-space skinned vertices of all skinned primitives of a file, with the given {(node,path): value} overrides"""
    nodes = [dict(nd) for nd in jc['nodes']]
    for i, nd in enumerate(nodes):
        for path in ('translation', 'rotation'):
            if (nd.get('name'), path) in pose: nd[path] = list(pose[(nd.get('name'), path)])
    jj = dict(jc); jj['nodes'] = nodes; Wm, _ = G.world_mats(jj)
    sk = jc['skins'][0]; ibm = G.acc(jc, bc, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    S = np.array([Wm[sk['joints'][k]] @ ibm[k] for k in range(len(sk['joints']))])
    V, F, off = [], [], 0
    for nd in jc['nodes']:
        if 'mesh' not in nd or 'skin' not in nd: continue
        for p in jc['meshes'][nd['mesh']]['primitives']:
            at = p['attributes']; q = G.acc(jc, bc, at['POSITION']); Jt = G.acc(jc, bc, at['JOINTS_0']); Wt = G.acc(jc, bc, at['WEIGHTS_0'])
            qh = np.c_[q, np.ones(len(q))]; v = np.zeros((len(q), 3))
            for k in range(4): v += Wt[:, k:k + 1] * np.einsum('nij,nj->ni', S[Jt[:, k]], qh)[:, :3]
            V.append(v); F.append(G.acc(jc, bc, p['indices'])[:, 0].reshape(-1, 3) + off); off += len(q)
    return np.concatenate(V), np.concatenate(F)

def edge_stretch(Vr, Vp, F):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); lr = np.linalg.norm(Vr[e[:, 0]] - Vr[e[:, 1]], axis=1)
    m = lr > 0.005; r = np.linalg.norm(Vp[e[m, 0]] - Vp[e[m, 1]], axis=1) / lr[m]; return np.percentile(np.abs(np.log(r)), 99.9), np.abs(np.log(r)).max()

if __name__ == '__main__':
    chars = sorted(os.path.basename(p)[:-4] for p in glob.glob(OUT + '[MW]_*.glb'))
    print('%-16s %6s %6s %5s %-44s %3s %-28s %-24s %7s %s' % ('file', 'tris', 'verts', 'jnts', 'attributes', 'col', 'bbox min', 'bbox max', 'KB', 'restErr/trimesh'))
    res = {}
    for c in chars:
        s = char_stats(OUT + c + '.glb'); res[c] = s
        print('%-16s %6d %6d %5d %-44s %3d %-28s %-24s %7.1f %.1e %s nodes=%d col[%.3f..%.3f] mat=%s' % (c, s['tris'], s['verts'], s['joints'], ','.join(s['attrs']), s['cols'],
              np.round(s['lo'], 4).tolist(), np.round(s['hi'], 4).tolist(), s['size'] / 1024, s['restErr'], s['tm'], s['nodes'], *s['colrange'], s['mat']))
    print('component types', res[chars[0]]['ctypes'])
    for af in ('anims.glb', 'anims_w.glb'):
        j, b = G.load(OUT + af); check_buffers(j, b)
        names = [a['name'] for a in j['animations']]; durs = []
        for a in j['animations']:
            durs.append(max(j['accessors'][s['input']]['max'][0] for s in a['samplers']))
            tg = {(c['target']['node'], c['target']['path']) for c in a['channels']}; assert len(tg) == len(a['channels'])
        print('%s: meshes=%d skins=%d nodes=%d clips=%d %s channels/clip=%s size=%.1f KB' % (af, len(j.get('meshes', [])), len(j.get('skins', [])), len(j['nodes']), len(names),
              ['%s %.2fs' % (n, d) for n, d in zip(names, durs)], sorted({len(a['channels']) for a in j['animations']}), os.path.getsize(OUT + af) / 1024))
    # rest pose identity between character files and anims files
    def rest(path):
        j, _ = G.load(path); return {nd['name']: (nd.get('translation'), nd.get('rotation')) for nd in j['nodes'] if 'mesh' not in nd}
    for af, pre in (('anims.glb', 'M_'), ('anims_w.glb', 'W_')):
        ra = rest(OUT + af); same = all(rest(OUT + c + '.glb') == ra for c in chars if c.startswith(pre))
        print('rest pose of %s identical to all %s* files: %s' % (af, pre, same))
    # ---- animated checks
    ja, ba = G.load(ASSETS + 'anims_h.glb'); jm, bm = G.load(OUT + 'anims.glb'); jw, bw = G.load(OUT + 'anims_w.glb')
    tests = [('Idle', 0.5), ('Walk', 0.4), ('Run', 0.3), ('Punch_Right', 0.4), ('Wave', 0.8), ('Death', 1.0), ('HitRecieve', 0.2), ('Interact', 0.6), ('Idle_Neutral', 1.0)]
    print('\nM: output (char + anims.glb) vs original (source char + anims_h.glb clip, Root shifted to origin): max vertex error [m]')
    from scipy.spatial import cKDTree
    for c in [c for c in chars if c.startswith('M_')]:
        js, bs = G.load(ASSETS + c + '.glb'); jo, bo = G.load(OUT + c + '.glb')
        # fixed vertex correspondence from the rest pose: source rest = IBM_root @ quantized position (same prim order as skinned())
        sk = js['skins'][0]; names = [js['nodes'][i]['name'] for i in sk['joints']]
        ir = G.acc(js, bs, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)[names.index('Root')]
        Rs = np.concatenate([G.acc(js, bs, p['attributes']['POSITION']) @ ir[:3, :3].T + ir[:3, 3] for nd in js['nodes'] if 'mesh' in nd and 'skin' in nd for p in js['meshes'][nd['mesh']]['primitives']])
        Po = G.acc(jo, bo, jo['meshes'][0]['primitives'][0]['attributes']['POSITION'])
        d0, nn = cKDTree(Rs).query(Po); assert d0.max() < 1e-5, d0.max()
        cands = cKDTree(Rs).query_ball_point(Po, 1e-5)   # coincident rest vertices can carry different weights
        flat = np.concatenate(cands); owner = np.repeat(np.arange(len(Po)), [len(c) for c in cands])
        rootT = np.array(js['nodes'][[nd.get('name') for nd in js['nodes']].index('Root')].get('translation', [0, 0, 0]))
        errs = []
        for clip, t in tests:
            Vs, _ = skinned(js, bs, clip_pose(ja, ba, clip, t)); Vo, _ = skinned(jo, bo, clip_pose(jm, bm, clip, t))
            dd = np.linalg.norm(Vo[owner] - (Vs[flat] - rootT), axis=1); best = np.full(len(Po), np.inf); np.minimum.at(best, owner, dd)
            errs.append(best.max())
        print('  %-16s %s' % (c, ' '.join('%s=%.1e' % (cl[:5], e) for (cl, _), e in zip(tests, errs))))
    print('\nPosed checks (lowest vertex y = foot contact; 99.9th pct / max |log edge stretch| vs rest)')
    for c in chars:
        jo, bo = G.load(OUT + c + '.glb'); Vr, F = skinned(jo, bo, {})
        aj, ab = (jm, bm) if c.startswith('M_') else (jw, bw)
        row = []
        for clip, t in tests[:5]:
            Vp, _ = skinned(jo, bo, clip_pose(aj, ab, clip, t)); p, mx = edge_stretch(Vr, Vp, F); row.append('%s y%+.3f s%.2f/%.2f' % (clip[:4], Vp[:, 1].min(), p, mx))
        print('  %-16s %s' % (c, ' | '.join(row)))
        if c == 'W_Casual':   # what happens without retargeting (male clips straight onto the female rig)
            row = []
            for clip, t in tests[:5]:
                Vp, _ = skinned(jo, bo, clip_pose(jm, bm, clip, t)); p, mx = edge_stretch(Vr, Vp, F); row.append('%s y%+.3f s%.2f/%.2f' % (clip[:4], Vp[:, 1].min(), p, mx))
            print('  %-16s %s   <- W rig driven by anims.glb (no retarget), for comparison' % ('W_Casual naive', ' | '.join(row)))
