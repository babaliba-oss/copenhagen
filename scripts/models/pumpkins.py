"""Halloween pumpkins for seasons.js, from the three CC BY uploads Daniel picked:
  A  "Halloween pumpkin" by monsieurmo: a grin and eyes painted on to glow (its emissive texture)
  B  "Halloween pumpkin" by Nick Kotik: carved through, hollow, a curly stem
  C  "Halloween Pumpkin" by Charlie Tinley: carved through, hollow, a darker variety
Each becomes two levels of detail of two parts: `body`, lit, its colours sampled from the texture into vertex colours;
and `glow`, drawn unlit: the painted face of A, and the inside walls of B and C, seen through the carving as if a candle
burned in them. Level 0 (some 1,500-1,900 triangles, for the pumpkins near the player) is simplified by meshoptimizer
(scripts/models/simplify.mjs, colour and glow as attributes), so the two parts share their seam exactly. Level 1 (about
200, for the rest, a dozen pixels across) is a sphere shrink-wrapped onto the model by rays from its middle: its colours
and the glowing patch of the face averaged from 3,000 rays, the carved openings closed over and glowing.
Face to +Z, base on y = 0, scaled to a set width.
   npm i --no-save meshoptimizer@0.22.0
   python3 scripts/models/pumpkins.py public/models/props/pumpkins.glb A=<dir> B=<dir> C=<dir>   (each dir: scene.gltf, textures/)
"""
import sys, os, json, math, struct, subprocess
import numpy as np, trimesh
from PIL import Image

out = sys.argv[1]
SRC = dict(a.split('=', 1) for a in sys.argv[2:])
SPEC = {'A': dict(glow='emissive', width=.46, tris=1700),
        'B': dict(glow='inner', width=.46, tris=1900),
        'C': dict(glow='inner', width=.42, tris=1500)}
CANDLE = np.array([1.0, .8, .3])  # sRGB, the light inside B and C
lin = lambda c: np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)
HERE = os.path.dirname(os.path.abspath(__file__))


def texture(img, uv, size=1024):
    a = np.asarray(img.convert('RGB').resize((size, size), Image.LANCZOS), np.float32) / 255
    uv = np.where((uv < 0) | (uv > 1), uv % 1, uv)
    x = np.clip(uv[:, 0] * (size - 1), 0, size - 1).round().astype(int)
    y = np.clip((1 - uv[:, 1]) * (size - 1), 0, size - 1).round().astype(int)  # trimesh keeps uv with v up
    return a[y, x]


def load(d):
    s = trimesh.load(os.path.join(d, 'scene.gltf'), force='scene')
    V, F, C, E, n = [], [], [], [], 0
    for node in s.graph.nodes_geometry:
        T, g = s.graph[node]
        m = s.geometry[g]
        if len(m.faces) < 100: continue  # B's little emissive card
        m = m.copy(); m.apply_transform(T)
        mat, uv = m.visual.material, getattr(m.visual, 'uv', None)
        tex = lambda k: getattr(mat, k, None) if uv is not None else None
        base = texture(tex('baseColorTexture'), uv) if tex('baseColorTexture') is not None else np.ones((len(m.vertices), 3))
        f = getattr(mat, 'baseColorFactor', None)
        if f is not None: base = base * (np.asarray(f[:3], float) / 255)
        emis = texture(tex('emissiveTexture'), uv) if tex('emissiveTexture') is not None else np.zeros((len(m.vertices), 3))
        V.append(np.asarray(m.vertices, float)); F.append(np.asarray(m.faces) + n); C.append(base); E.append(emis); n += len(m.vertices)
    return np.concatenate(V), np.concatenate(F), np.concatenate(C), np.concatenate(E)


def weld(V, F, *attrs):
    """One vertex per position (texture seams split them); attributes averaged."""
    key = np.round(V / (np.ptp(V, axis=0).max() * 1e-5)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1); cnt = np.bincount(inv).astype(float)
    outs = []
    for a in attrs:
        acc = np.zeros((len(first),) + a.shape[1:]); np.add.at(acc, inv, a); outs.append(acc / cnt.reshape((-1,) + (1,) * (a.ndim - 1)))
    F = inv[F]; F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    return V[first], F, outs


def face_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); a = np.linalg.norm(n, axis=1)
    return n / (a[:, None] + 1e-20), a / 2


def simplify(V, F, attrs, weights, targets):
    job = dict(positions=V.astype(np.float32).ravel().tolist(), attributes=attrs.astype(np.float32).ravel().tolist(), stride=attrs.shape[1],
               weights=list(weights), indices=F.astype(np.int64).ravel().tolist(), targets=list(targets), error=1)
    r = subprocess.run(['node', os.path.join(HERE, 'simplify.mjs')], input=json.dumps(job), capture_output=True, text=True, check=True)
    sys.stderr.write(r.stderr)
    return [np.asarray(l, np.int64).reshape(-1, 3) for l in json.loads(r.stdout)['lods']]


def fib_sphere(n):
    i = np.arange(n) + .5; phi = np.arccos(1 - 2 * i / n); th = np.pi * (1 + 5 ** .5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)


def cast_far(O, D, tris):
    """Distance to the farthest surface along each ray from O (nan where a ray leaves through a hole), and its triangle."""
    v0 = tris[:, 0]; e1 = tris[:, 1] - v0; e2 = tris[:, 2] - v0; s = O - v0; q = np.cross(s, e1)
    T, I = np.full(len(D), np.nan), np.full(len(D), -1)
    for k, d in enumerate(D):
        p = np.cross(d, e2); det = (e1 * p).sum(1); ok = np.abs(det) > 1e-14; inv = 1 / np.where(ok, det, 1)
        u = (s * p).sum(1) * inv; v = (q @ d) * inv; t = (e2 * q).sum(1) * inv
        hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-9)
        if hit.any(): j = np.flatnonzero(hit)[np.argmax(t[hit])]; T[k] = t[j]; I[k] = j
    return T, I


def shrinkwrap(V, F, C, g, glowc, centre, holes_glow, seg=14, rings=8):
    """Level 1: a UV sphere pulled onto the model; per-vertex colour and glow averaged from dense rays around it."""
    dirs = [[0, 1, 0]] + [[math.cos(2 * math.pi * k / seg) * math.sin(math.pi * r / rings), math.cos(math.pi * r / rings),
                           math.sin(2 * math.pi * k / seg) * math.sin(math.pi * r / rings)] for r in range(1, rings) for k in range(seg)] + [[0, -1, 0]]
    U = np.array(dirs); faces = [[0, 1 + (k + 1) % seg, 1 + k] for k in range(seg)]
    for r in range(rings - 2):
        a, b = 1 + r * seg, 1 + (r + 1) * seg
        for k in range(seg): k1 = (k + 1) % seg; faces += [[a + k, a + k1, b + k], [a + k1, b + k1, b + k]]
    a, bot = 1 + (rings - 2) * seg, len(U) - 1; faces += [[bot, a + k, a + (k + 1) % seg] for k in range(seg)]
    S = np.array(faces); tris = V[F]
    T0, _ = cast_far(centre, U, tris)
    D = fib_sphere(3000); T, I = cast_far(centre, D, tris)
    hitc = np.where(I[:, None] >= 0, C[F[I]].mean(1), 0); hitg = np.where(I >= 0, g[F[np.maximum(I, 0)]].mean(1), 1. if holes_glow else 0.)
    hitgc = np.where(I[:, None] >= 0, glowc[F[np.maximum(I, 0)]].mean(1), CANDLE)
    sigma = .55 * math.pi / rings; W = np.exp(-(np.arccos(np.clip(U @ D.T, -1, 1)) / sigma) ** 2)
    Wh = W * (I >= 0)[None, :]
    r = np.where(np.isnan(T0), (Wh * np.nan_to_num(T)[None, :]).sum(1) / np.maximum(Wh.sum(1), 1e-12), T0)
    col = (Wh @ hitc) / np.maximum(Wh.sum(1, keepdims=True), 1e-12); gl = (W @ hitg) / W.sum(1)
    Wg = W * hitg[None, :]; gcol = (Wg @ hitgc) / np.maximum(Wg.sum(1, keepdims=True), 1e-12)
    P = centre + U * r[:, None]
    n = np.cross(P[S[:, 1]] - P[S[:, 0]], P[S[:, 2]] - P[S[:, 0]]); out = ((P[S].mean(1) - centre) * n).sum(1) < 0
    S[out] = S[out][:, ::-1]  # every face outward
    return P, S, col, gl, gcol


def finish(V, F, C, crease=48):
    """Indexed vertices with normals smoothed within `crease` degrees (split where the surface folds) and colours."""
    fn, area = face_normals(V, F); cosc = math.cos(math.radians(crease))
    corners = F.ravel(); cface = np.repeat(np.arange(len(F)), 3); order = np.argsort(corners, kind='stable')
    sc = corners[order]; starts = np.searchsorted(sc, np.arange(len(V))); ends = np.searchsorted(sc, np.arange(len(V)), side='right')
    cn = np.zeros((len(corners), 3))
    for v in range(len(V)):
        sl = order[starts[v]:ends[v]]
        if not len(sl): continue
        N = fn[cface[sl]]; acc = ((N @ N.T) > cosc) * area[cface[sl]][None, :] @ N
        cn[sl] = acc / (np.linalg.norm(acc, axis=1, keepdims=True) + 1e-20)
    key = np.concatenate([corners[:, None].astype(float), np.round(cn * 512)], axis=1)
    uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    vi = corners[first]
    return V[vi], cn[first], C[vi], inv.reshape(-1, 3)


def write_glb(path, meshes):
    buf, views, accs, gm, nodes, mats = bytearray(), [], [], [], [], []
    def add(arr, target, comp, typ, minmax=False):
        while len(buf) % 4: buf.append(0)
        b = arr.tobytes(); views.append({'buffer': 0, 'byteOffset': len(buf), 'byteLength': len(b), 'target': target}); buf.extend(b)
        a = {'bufferView': len(views) - 1, 'componentType': comp, 'count': len(arr), 'type': typ}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a); return len(accs) - 1
    for i, (name, p, n, c, f) in enumerate(meshes):
        attrs = {'POSITION': add(p.astype('<f4'), 34962, 5126, 'VEC3', True), 'NORMAL': add(n.astype('<f4'), 34962, 5126, 'VEC3'),
                 'COLOR_0': add(np.clip(c, 0, 1).astype('<f4'), 34962, 5126, 'VEC3')}
        small = len(p) < 65536
        idx = add(f.ravel().astype('<u2' if small else '<u4'), 34963, 5123 if small else 5125, 'SCALAR')
        mats.append({'name': name, 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': .7}})
        gm.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': idx, 'material': i}]}); nodes.append({'name': name, 'mesh': i})
    while len(buf) % 4: buf.append(0)
    js = json.dumps({'asset': {'version': '2.0', 'generator': 'scripts/models/pumpkins.py'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
                     'nodes': nodes, 'meshes': gm, 'materials': mats, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}]},
                    separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    open(path, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(buf)) + struct.pack('<II', len(js), 0x4E4F534A) + js
                           + struct.pack('<II', len(buf), 0x004E4942) + bytes(buf))


meshes = []
for key, spec in SPEC.items():
    if key not in SRC: continue
    V, F, C, E = load(SRC[key])
    lo, hi = V.min(0), V.max(0); h = hi[1] - lo[1]
    body = V[V[:, 1] < lo[1] + h * .8]; bc = (body.min(0) + body.max(0)) / 2  # the middle of the pumpkin, under its stem
    fn, area = face_normals(V, F); cen = V[F].mean(1); d = cen - bc; d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-20
    radial = (fn * d).sum(1)
    if spec['glow'] == 'emissive':
        g = E.max(1)  # per vertex, 0..1
        gf = g[F].mean(1) > .4
    else:
        inward = radial < -.3  # the inside walls face the middle
        g = np.zeros(len(V)); w = np.zeros(len(V))
        for k in range(3): np.add.at(g, F[:, k], inward * area); np.add.at(w, F[:, k], area)
        g = g / np.maximum(w, 1e-20); gf = inward
    # which way the face looks: the glowing part of A; the carved openings of B and C (walls across the shell)
    band = (cen[:, 1] > lo[1] + h * .12) & (cen[:, 1] < lo[1] + h * .75)
    pick = gf if spec['glow'] == 'emissive' else band & (np.abs(radial) < .3)
    fc = ((cen[pick] - bc) * area[pick, None]).sum(0); ang = math.atan2(fc[0], fc[2])
    R = trimesh.transformations.rotation_matrix(-ang, [0, 1, 0])[:3, :3]
    V = (V - [bc[0], lo[1], bc[2]]) @ R.T
    V *= spec['width'] / max(np.ptp(V[:, 0]), np.ptp(V[:, 2]))
    print(key, len(F), 'triangles,', int(gf.sum()), 'glowing; face turned', round(math.degrees(ang)), 'deg; size', np.ptp(V, 0).round(3).tolist())
    # glow colour: A's own emissive texture over its paint; a warm candle inside B and C, brightest low in the middle
    if spec['glow'] == 'emissive': glowc = np.clip(E * 1.05 + C * .25, 0, 1)
    else:
        candle = np.array([0, np.ptp(V[:, 1]) * .3, 0]); r = np.linalg.norm(V - candle, axis=1) / (spec['width'] / 2)
        glowc = CANDLE[None, :] * np.clip(1.2 - .55 * r, .6, 1)[:, None]
    Vw, Fw, (Cw, Gw, GCw) = weld(V, F, C, g, glowc)
    F0, = simplify(Vw, Fw, np.concatenate([Cw, Gw[:, None]], 1), [.7, .7, .7, 4], [spec['tris']])
    body = V[V[:, 1] < V[:, 1].max() * .8]; centre = np.array([0, (body[:, 1].min() + body[:, 1].max()) / 2, 0])
    P1, F1, C1, G1, GC1 = shrinkwrap(Vw, Fw, Cw, Gw, GCw, centre, spec['glow'] == 'inner')
    for li, (Vl, Fl, Cl, Gl, GCl, cut) in enumerate(((Vw, F0, Cw, Gw, GCw, .5), (P1, F1, C1, G1, GC1, .45))):
        tg = Gl[Fl].mean(1); glow = tg > (cut if li == 0 else max(.1, cut * tg.max()))  # level 1: the strongest part of the face
        for part, sel, col in (('body', ~glow, lin(Cl)), ('glow', glow, lin(GCl))):
            P, N, Cc, I = finish(Vl, Fl[sel], col, crease=48 if li == 0 else 70)
            meshes.append((f'{key}{li}_{part}', P, N, Cc, I))
            print(f'  {key}{li}_{part}: {len(I)} triangles, {len(P)} vertices')
write_glb(out, meshes)
print(out, os.path.getsize(out) // 1024, 'KB')
