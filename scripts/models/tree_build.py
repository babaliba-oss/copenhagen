# Game-ready tree from a textured tree model (Blender as a Python module):
#   python3 tree_build.py <in.gltf|glb> <out.glb> leaves=MatA,MatB bark=MatC [drop=MatD,...] [keep=0.4] [grow=1.3]
#     [twigs=4] [bark_tris=2000] [bark_tex=512] [leaf_tex=1024] [seed=1] [hue=0] [sat=1] [val=1]
# Out: two meshes, "bark" (opaque, one base-colour JPEG) and "leaves" (alpha-cut cards, one RGBA PNG; several leaf
# materials are packed side by side into one atlas). Leaf cards are thinned (keep a share of them, each kept card
# grown about its centre so the crown stays closed), bark pieces of <= twigs faces are dropped, the rest decimated.
# The trunk base sits at the origin, +Y up, metres. No normal maps and no vertex colours (the game tints per tree).
import bpy, bmesh, sys, random, math, os, tempfile, colorsys
import numpy as np
from mathutils import Vector

src, out = sys.argv[1], sys.argv[2]
opt = dict(a.split('=', 1) for a in sys.argv[3:])
LEAVES = [s for s in opt.get('leaves', '').split(',') if s]
BARK = [s for s in opt.get('bark', '').split(',') if s]
DROP = [s for s in opt.get('drop', '').split(',') if s]
KEEP, GROW, TWIGS = float(opt.get('keep', .4)), float(opt.get('grow', 1.3)), int(opt.get('twigs', 0))
BARK_TRIS, BARK_TEX, LEAF_TEX = int(opt.get('bark_tris', 2000)), int(opt.get('bark_tex', 512)), int(opt.get('leaf_tex', 1024))
HUE, SAT, VAL = float(opt.get('hue', 0)), float(opt.get('sat', 1)), float(opt.get('val', 1))
rnd = random.Random(int(opt.get('seed', 1)))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
tmp = tempfile.mkdtemp()

def mat_name(o):
    return o.active_material.name if o.active_material else ''
def base_image(m):
    for n in m.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            l = n.inputs['Base Color'].links
            if l:
                nd = l[0].from_node
                while nd.type != 'TEX_IMAGE' and nd.inputs and any(i.links for i in nd.inputs):
                    nd = next(i.links[0].from_node for i in nd.inputs if i.links)
                if nd.type == 'TEX_IMAGE': return nd.image
    for n in m.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and 'diffuse' in (n.image.name if n.image else '').lower(): return n.image
    return None
def pil_image(img):
    # the texture file itself where it is on disk (Blender's float pixel copy of a 4k map needs gigabytes)
    from PIL import Image
    f = bpy.path.abspath(img.filepath) if img.filepath else ''
    if f and os.path.exists(f): return Image.open(f).convert('RGBA')
    w, h = img.size; a = np.empty(w * h * 4, dtype=np.float32); img.pixels.foreach_get(a)
    return Image.fromarray((np.clip(a.reshape(h, w, 4)[::-1], 0, 1) * 255 + .5).astype(np.uint8), 'RGBA')

# Bake every mesh's world transform into its data and drop everything else.
meshes = []
for o in list(bpy.data.objects):
    if o.type == 'MESH':
        o.data.transform(o.matrix_world); meshes.append(o)
for o in meshes:
    o.parent = None; o.matrix_world = o.matrix_world.Identity(4)
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
for o in list(meshes):
    if any(d in mat_name(o) for d in DROP):
        meshes.remove(o); bpy.data.objects.remove(o, do_unlink=True)
leaf_objs = [o for o in meshes if any(l == mat_name(o) or l in mat_name(o) for l in LEAVES)]
bark_objs = [o for o in meshes if o not in leaf_objs and (not BARK or any(b in mat_name(o) for b in BARK))]
for o in meshes:
    if o not in leaf_objs and o not in bark_objs: print('unused mesh', o.name, mat_name(o))

def components(bm):
    parent = list(range(len(bm.verts)))
    def f(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for fa in bm.faces:
        vs = [v.index for v in fa.verts]
        for v in vs[1:]:
            ra, rb = f(vs[0]), f(v)
            if ra != rb: parent[ra] = rb
    comp = {}
    for fa in bm.faces: comp.setdefault(f(fa.verts[0].index), []).append(fa)
    return list(comp.values())

# Leaves: keep a share of the cards, grow each kept card about its centre; one atlas for all leaf materials.
leaf_imgs = []
for k, o in enumerate(leaf_objs):
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    cards = components(bm); n0 = len(bm.faces)
    rnd.shuffle(cards); kill = cards[int(round(len(cards) * KEEP)):]
    bmesh.ops.delete(bm, geom=list({fa for c in kill for fa in c}), context='FACES')
    for c in components(bm):
        vs = list({v for fa in c for v in fa.verts}); ctr = sum((v.co for v in vs), Vector()) / len(vs)
        for v in vs: v.co = ctr + (v.co - ctr) * GROW
    uv = bm.loops.layers.uv.active
    lo = min((l[uv].uv.x for fa in bm.faces for l in fa.loops), default=0); hi = max((l[uv].uv.x for fa in bm.faces for l in fa.loops), default=1)
    lov = min((l[uv].uv.y for fa in bm.faces for l in fa.loops), default=0); hiv = max((l[uv].uv.y for fa in bm.faces for l in fa.loops), default=1)
    if lo < -.01 or hi > 1.01 or lov < -.01 or hiv > 1.01: print('WARNING leaf UVs outside 0-1:', o.name, lo, hi, lov, hiv)
    # atlas: material k takes column k of len(leaf_objs)
    N = len(leaf_objs)
    for fa in bm.faces:
        for l in fa.loops: l[uv].uv.x = (min(max(l[uv].uv.x, 0), 1) + k) / N
    print('leaves', o.name, mat_name(o), 'faces', n0, '->', len(bm.faces))
    bm.to_mesh(o.data); bm.free()
    leaf_imgs.append(base_image(o.active_material))

# Bark: drop tiny twig pieces, decimate the rest.
for o in bark_objs:
    bm = bmesh.new(); bm.from_mesh(o.data)
    n0 = len(bm.faces)
    if TWIGS:
        small = [fa for c in components(bm) if len(c) <= TWIGS for fa in c]
        bmesh.ops.delete(bm, geom=small, context='FACES')
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(o.data); bm.free(); print('bark', o.name, mat_name(o), 'faces', n0, '->', len(o.data.polygons), 'before decimate')
bark_total = sum(len(o.data.polygons) for o in bark_objs)
bark_img = base_image(bark_objs[0].active_material) if bark_objs else None
for o in bark_objs:
    if bark_total > BARK_TRIS:
        m = o.modifiers.new('d', 'DECIMATE'); m.ratio = BARK_TRIS / bark_total; m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        bpy.ops.object.modifier_apply(modifier='d'); o.select_set(False)

def join(objs, name):
    if not objs: return None
    for o in bpy.data.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = name; o.data.name = name
    while len(o.data.materials) > 1: o.data.materials.pop()
    for p in o.data.polygons: p.material_index = 0
    for a in list(o.data.color_attributes): o.data.color_attributes.remove(a)
    while len(o.data.uv_layers) > 1: o.data.uv_layers.remove(o.data.uv_layers[-1])
    return o
bark = join(bark_objs, 'bark'); leaves = join(leaf_objs, 'leaves')

# Trunk base to the origin: the lowest bark point sets y = 0; x, z from the bark in the lowest metre.
co = np.array([v.co[:] for v in bark.data.vertices])  # Blender Z up
zmin = co[:, 2].min(); low = co[co[:, 2] < zmin + max(.5, (co[:, 2].max() - zmin) * .04)]
shift = Vector((-low[:, 0].mean(), -low[:, 1].mean(), -zmin))
for o in (bark, leaves):
    if o: o.data.transform(__import__('mathutils').Matrix.Translation(shift))

# Textures: bark as a JPEG, leaves as one RGBA PNG atlas; optional hue/saturation/value shift on the leaves.
from PIL import Image
to_pil = pil_image
def material(name, path, alpha):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(path)
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 1.0; b.inputs['Metallic'].default_value = 0.0
    if alpha:
        nt.links.new(t.outputs['Alpha'], b.inputs['Alpha'])
        try: m.blend_method = 'CLIP'; m.alpha_threshold = .45
        except Exception: pass
        m.use_backface_culling = False
    return m
if bark:
    im = to_pil(bark_img).convert('RGB').resize((BARK_TEX, BARK_TEX), Image.LANCZOS)
    p = os.path.join(tmp, 'bark.jpg'); im.save(p, quality=86)
    bark.data.materials[0] = material('bark', p, False)
if leaves:
    N = len(leaf_imgs); W = LEAF_TEX
    atlas = Image.new('RGBA', (W * N, W), (0, 0, 0, 0))
    for k, img in enumerate(leaf_imgs): atlas.paste(to_pil(img).resize((W, W), Image.LANCZOS), (k * W, 0))
    if HUE or SAT != 1 or VAL != 1:
        a = np.asarray(atlas).astype(np.float32) / 255
        hsv = np.array(Image.fromarray((a[..., :3] * 255).astype(np.uint8)).convert('HSV')).astype(np.float32) / 255
        hsv[..., 0] = (hsv[..., 0] + HUE) % 1; hsv[..., 1] = np.clip(hsv[..., 1] * SAT, 0, 1); hsv[..., 2] = np.clip(hsv[..., 2] * VAL, 0, 1)
        rgb = np.asarray(Image.fromarray((hsv * 255).astype(np.uint8), 'HSV').convert('RGB')).astype(np.float32) / 255
        atlas = Image.fromarray((np.dstack([rgb, a[..., 3:]]) * 255 + .5).astype(np.uint8), 'RGBA')
    # Bleed the leaf colour into the transparent texels so mipmaps do not darken the card edges.
    a = np.asarray(atlas).astype(np.float32); al = a[..., 3:] / 255
    from PIL import ImageFilter
    col = Image.fromarray(a[..., :3].astype(np.uint8)); mask = Image.fromarray((al[..., 0] > .3).astype(np.uint8) * 255)
    fill = col
    for r in (3, 7, 15, 31):
        blur = np.asarray(Image.composite(fill, Image.new('RGB', col.size), mask).filter(ImageFilter.BoxBlur(r))).astype(np.float32)
        m = np.asarray(mask.filter(ImageFilter.BoxBlur(r))).astype(np.float32)[..., None] / 255
        est = blur / np.maximum(m, 1e-3)
        f = np.asarray(fill).astype(np.float32); need = (np.asarray(mask)[..., None] == 0)
        fill = Image.fromarray(np.where(need & (m > .02), est, f).clip(0, 255).astype(np.uint8))
        mask = Image.fromarray(np.maximum(np.asarray(mask), ((m[..., 0] > .02) * 255).astype(np.uint8)))
    atlas = Image.fromarray(np.dstack([np.asarray(fill), a[..., 3:].astype(np.uint8)]), 'RGBA')
    if N > 1: atlas = atlas.resize((W * N // 2 if N > 1 else W, W // 2 if N > 1 else W), Image.LANCZOS)
    p = os.path.join(tmp, 'leaves.png'); atlas.save(p, optimize=True)
    leaves.data.materials[0] = material('leaves', p, True)

for o in bpy.data.objects: o.select_set(o in (bark, leaves))
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in (bark, leaves) if o}
dims = [max(v.co[i] for o in (bark, leaves) if o for v in o.data.vertices) - min(v.co[i] for o in (bark, leaves) if o for v in o.data.vertices) for i in range(3)]
print('triangles', tris, 'total', sum(tris.values()), 'size (x, y, height)', [round(d, 2) for d in dims])
kw = dict(filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_texcoords=True,
          export_normals=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO', export_animations=False)
try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='NONE')
except TypeError: bpy.ops.export_scene.gltf(**kw)
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
