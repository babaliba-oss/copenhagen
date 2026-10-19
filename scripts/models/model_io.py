# Shared model reader for the scripts/models and scripts/people converters: any glb/gltf/fbx/obj/blend through Blender
# (pip install bpy), triangles in world space with their UVs and materials, per-triangle colours from the base-colour
# textures (or flat colours given by material name), Blender Z-up -> glTF Y-up, turns, weld, loose-part filters.
# configure(src, args) first: args are the key=value options of the calling script (tex, matex, colors, paint, only,
# skip, predecimate, yaw/roll/pitch, thin, minpart).
import os, glob, math
import numpy as np
import bpy
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
SRC, A, COLORS, MATEX = None, {}, {}, {}
IMG = ('.png', '.jpg', '.jpeg', '.tga', '.tif', '.tiff', '.bmp', '.webp')
def configure(src, args):
    global SRC, A, COLORS, MATEX
    SRC, A = src, dict(args)
    COLORS = dict(kv.split(':', 1) for kv in A['colors'].split(';')) if 'colors' in A else {}
    MATEX = dict(kv.split(':', 1) for kv in A['matex'].split(';')) if 'matex' in A else {}
def model_root(path):
    d = os.path.dirname(os.path.abspath(path))
    while d != '/' and not os.path.isdir(os.path.join(d, 'textures')) and os.path.basename(d) != 'source': d = os.path.dirname(d)
    return os.path.dirname(d) if os.path.basename(d) == 'source' else d

def relink_images(path):  # textures a download keeps beside source/, or paths from the author's machine
    pool = {}
    for p in glob.glob(os.path.join(model_root(path), '**', '*'), recursive=True):
        if p.lower().endswith(IMG): pool.setdefault(os.path.basename(p).lower(), p)
    for im in bpy.data.images:
        if im.source != 'FILE' or im.packed_file: continue
        fp = bpy.path.abspath(im.filepath)
        if os.path.exists(fp): continue
        name = os.path.basename(fp.replace('\\', '/')).lower()
        hit = pool.get(name) or next((v for k, v in pool.items() if os.path.splitext(k)[0] == os.path.splitext(name)[0]), None)
        if hit: im.filepath = hit; im.reload()

def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    e = os.path.splitext(path)[1].lower()
    if e in ('.glb', '.gltf'): bpy.ops.import_scene.gltf(filepath=path)
    elif e == '.fbx': bpy.ops.import_scene.fbx(filepath=path, use_image_search=True)
    elif e == '.obj': bpy.ops.wm.obj_import(filepath=path)
    elif e == '.blend':
        with bpy.data.libraries.load(path, link=False) as (src, dst): dst.objects = src.objects
        for o in dst.objects:
            if o is not None and o.type in ('MESH', 'ARMATURE', 'EMPTY', 'CURVE'): bpy.context.scene.collection.objects.link(o)
    else: raise SystemExit(f'unknown format {e}')
    relink_images(path)

def find_image(name):
    for p in glob.glob(os.path.join(model_root(SRC), '**', '*'), recursive=True):
        if os.path.basename(p).lower() == name.lower() or os.path.abspath(p) == os.path.abspath(name): return p
    raise SystemExit(f'texture {name} not found under {model_root(SRC)}')
def image_pixels(im):
    if max(im.size) > 1024: im.scale(min(im.size[0], 1024), min(im.size[1], 1024))
    w, h = im.size; px = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[:, :, :3]
def hex_lin(h):
    c = np.array([int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)
def base_image(mat):  # (pixels HxWx3 sRGB float, None) or (None, linear rgb)
    for k, hx in COLORS.items():
        if mat and k in mat.name: return None, hex_lin(hx)
    if mat and mat.name in MATEX: return image_pixels(bpy.data.images.load(find_image(MATEX[mat.name]), check_existing=True)), None
    if 'tex' in A: return image_pixels(bpy.data.images.load(find_image(A['tex']), check_existing=True)), None
    if 'paint' in A: return None, hex_lin(A['paint'])
    if not mat or not mat.use_nodes:
        c = mat.diffuse_color[:3] if mat else (.5, .5, .5); return None, np.array(c)
    nodes = mat.node_tree.nodes
    bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf: return None, np.array(mat.diffuse_color[:3])
    sock = bsdf.inputs['Base Color']
    seen, stack = set(), [sock]
    while stack:  # walk back through mix/multiply nodes to the first image
        s = stack.pop()
        for l in s.links:
            n = l.from_node
            if n.name in seen: continue
            seen.add(n.name)
            if n.type == 'TEX_IMAGE' and n.image and (n.image.has_data or n.image.packed_file or os.path.exists(bpy.path.abspath(n.image.filepath))):
                im = n.image
                try:
                    if max(im.size) > 1024: im.scale(min(im.size[0], 1024), min(im.size[1], 1024))
                    w, h = im.size
                    px = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(px)
                    return px.reshape(h, w, 4)[:, :, :3], None
                except Exception as ex: print('image unreadable', im.name, ex)
            stack.extend(n.inputs)
    return None, np.array(sock.default_value[:3])

def gather():
    only = set(A['only'].split(',')) if 'only' in A else None
    skip = set(A['skip'].split(',')) if 'skip' in A else set()
    if 'predecimate' in A:  # Blender's collapse first, for meshes the quadric pass below cannot reduce (many touching slats)
        for o in bpy.context.scene.objects:
            if o.type == 'MESH': d = o.modifiers.new('dec', 'DECIMATE'); d.ratio = float(A['predecimate']); d.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    P, UV, MI, mats = [], [], [], []
    for o in bpy.context.scene.objects:
        if o.type not in ('MESH', 'CURVE') or not o.visible_get(): continue
        if only and o.name not in only: continue
        if any(s in o.name for s in skip): continue
        oe = o.evaluated_get(dg); me = oe.to_mesh()
        if me is None: continue
        me.calc_loop_triangles(); n = len(me.loop_triangles)
        if not n: oe.to_mesh_clear(); continue
        co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        M = np.array(o.matrix_world); co = co @ M[:3, :3].T + M[:3, 3]
        vi = np.empty(n * 3, np.int32); me.loop_triangles.foreach_get('vertices', vi)
        li = np.empty(n * 3, np.int32); me.loop_triangles.foreach_get('loops', li)
        mi = np.empty(n, np.int32); me.loop_triangles.foreach_get('material_index', mi)
        if me.uv_layers.active:
            uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)[li].reshape(-1, 3, 2)
        else: uv = np.zeros((n, 3, 2), np.float32)
        slots = [s.material for s in o.material_slots] or [None]
        base = len(mats); mats.extend(slots)
        P.append(co[vi].reshape(-1, 3, 3)); UV.append(uv); MI.append(np.clip(mi, 0, len(slots) - 1) + base)
        oe.to_mesh_clear()
    if not P: raise SystemExit('no meshes')
    return np.concatenate(P), np.concatenate(UV), np.concatenate(MI), mats

def face_colours(P, UV, MI, mats):  # sRGB 0..1 per triangle
    out = np.zeros((len(P), 3), np.float32)
    for m in np.unique(MI):
        sel = np.where(MI == m)[0]; px, flat = base_image(mats[m])
        if px is None:
            c = np.clip(flat, 0, 1); out[sel] = np.where(c <= .0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - .055); continue
        h, w, _ = px.shape; uv = UV[sel]; cen = uv.mean(1, keepdims=True)
        pts = np.concatenate([cen, cen + (uv - cen) * .6], 1)  # centre + three points 60% of the way to the corners
        u = np.mod(pts[..., 0], 1); v = np.mod(pts[..., 1], 1)
        x = np.clip((u * (w - 1)).round().astype(int), 0, w - 1); y = np.clip((v * (h - 1)).round().astype(int), 0, h - 1)
        out[sel] = px[y, x].mean(1)
    return np.clip(out, 0, 1)

def to_gltf(P):  # Blender Z-up -> glTF Y-up
    return np.stack([P[..., 0], P[..., 2], -P[..., 1]], -1)

def rot(P):
    for key, axis in (('roll', 2), ('pitch', 0), ('yaw', 1)):
        if key not in A: continue
        a = math.radians(float(A[key])); c, s = math.cos(a), math.sin(a)
        R = {1: [[c, 0, s], [0, 1, 0], [-s, 0, c]], 0: [[1, 0, 0], [0, c, -s], [0, s, c]], 2: [[c, -s, 0], [s, c, 0], [0, 0, 1]]}[axis]
        P = P @ np.array(R).T
    return P

def weld(P, tol):
    q = np.round(P.reshape(-1, 3) / tol).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True); inv = inv.reshape(-1)
    V = np.zeros((inv.max() + 1, 3)); V[inv] = P.reshape(-1, 3)
    return V, inv.reshape(-1, 3)

def drop_parts(V, F, size):
    n = len(V); e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]]])
    g = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    nc, lab = connected_components(g, directed=False); fl = lab[F[:, 0]]
    area = .5 * np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1)
    A_ = np.bincount(fl, area, nc)
    lo = np.full((nc, 3), np.inf); hi = np.full((nc, 3), -np.inf)
    np.minimum.at(lo, lab, V); np.maximum.at(hi, lab, V)
    L = np.linalg.norm(hi - lo, axis=1)
    keep = np.ones(nc, bool)
    if 'thin' in A: keep &= A_ / (np.pi * np.maximum(L, 1e-6)) >= float(A['thin'])  # ~diameter of a rod that long
    if 'minpart' in A: keep &= L >= float(A['minpart']) * size
    k = keep[fl]; print(f'parts {nc}, dropped {int((~keep).sum())} ({int((~k).sum())} tris)')
    return k

