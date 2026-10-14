"""Harbour and canal boats for Copenhagen, modelled in Blender: the Nyhavn wooden ketch, a sailing yacht, a
motor launch, a canal tour boat, the yellow harbour bus and (1760) a three-masted ship. Original shapes. Each
is exported with plain coloured materials; the game bakes the colours into vertex colours and instances them
(src/coloured-models.js, src/copenhagen/boats.js). Same frame as the procedural boats: bow at the game's -Z
(Blender +Y), keel 0.3 m below the origin.

Run headless:  bpyenv/bin/python scripts/blender/boats.py public/models/boats"""
import sys, os, math
import bpy, bmesh
from mathutils import Vector

OUT = sys.argv[-1] if not sys.argv[-1].endswith('.py') else 'boats'

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c)

class Model:
    def __init__(self):
        bpy.ops.wm.read_factory_settings(use_empty=True); self.mats = {}
    def mat(self, hexc):
        if hexc not in self.mats:
            m = bpy.data.materials.new('c' + hexc.lstrip('#')); m.diffuse_color = (*srgb(hexc), 1)
            m.use_nodes = True; p = m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value = (*srgb(hexc), 1)
            self.mats[hexc] = m
        return self.mats[hexc]
    def obj(self, name, bm, colours, smooth=True, subdiv=0):
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
        for c in colours: ob.data.materials.append(self.mat(c))
        for p in me.polygons: p.use_smooth = smooth
        if subdiv: m = ob.modifiers.new('s', 'SUBSURF'); m.levels = subdiv
        return ob
    def box(self, size, loc, hexc, bevel=.0, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        ob = bpy.context.active_object; ob.scale = size; bpy.ops.object.transform_apply(scale=True)
        if bevel: m = ob.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = 1
        ob.data.materials.append(self.mat(hexc)); return ob
    def rod(self, a, b, r, hexc, seg=6):
        a, b = Vector(a), Vector(b); d = b - a
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=seg, location=(a + b) / 2)
        ob = bpy.context.active_object; ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        ob.data.materials.append(self.mat(hexc)); return ob
    def hull(self, L, beam, depth, colour, deck, sheer=.4, band=None, band_h=.3, transom=.75, bow_rise=.5, n=14, k=22, flat=.0):
        """Lofted hull, stern at -L/2 to bow at +L/2 (Blender Y). U/V sections, sheer line rising to the bow,
        a raked stem, a transom stern. Deck faces take `deck`, faces above the strake line `band`."""
        bm = bmesh.new(); rings = []
        for j in range(k + 1):
            t = j / k; y = -L / 2 + L * t
            fb = math.sin(min(1, (1 - t) / .38) * math.pi / 2) if t > .62 else 1      # bow taper
            fs = transom + (1 - transom) * math.sin(min(1, t / .25) * math.pi / 2)      # stern
            b = max(.03, beam / 2 * fb * fs)
            top = -.3 + depth + sheer * (max(0, t - .55) / .45) ** 2 * bow_rise / .5 + sheer * .25 * (max(0, .2 - t) / .2) ** 2
            keel = -.3 + (depth * .35) * (max(0, t - .78) / .22) ** 1.5 + depth * .12 * (max(0, .12 - t) / .12)
            ring = []
            for i in range(n + 1):
                a = math.pi * i / n; ca, sa = math.cos(a), math.sin(a)
                x = b * math.copysign(abs(ca) ** .55, ca) * (1 - flat) + b * ca * flat
                z = top - (top - keel) * (sa ** 1.6)
                ring.append(bm.verts.new((x, y, z)))
            rings.append(ring)
        strake = max(1, round(n * band_h / depth * .7)) if band else 0   # sections strips under the gunwale
        for r0, r1 in zip(rings, rings[1:]):
            for i in range(n):
                f = bm.faces.new((r0[i], r1[i], r1[i + 1], r0[i + 1]))
                if band and (i < strake or i >= n - strake): f.material_index = 2
            bm.faces.new((r0[n], r1[n], r1[0], r0[0])).material_index = 1          # deck strip
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        cols = [colour, deck] + ([band] if band else [])
        return self.obj('hull', bm, cols)
    def export(self, path):
        bpy.ops.object.select_all(action='SELECT')
        for ob in bpy.context.selected_objects:
            bpy.context.view_layer.objects.active = ob
            for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=True,
                                  export_materials='EXPORT', export_texcoords=False)
        print('wrote', path, tris, 'tris')

def furled(m, a, b, r, hexc):  # a sail lashed to its boom: a fat tapered roll
    m.rod(a, b, r, hexc, 8)

def sail(m):
    m.hull(8, 2.5, 1.2, '#f4f4f0', '#c9b48a', sheer=.25, band='#1f3b5b', band_h=.14, transom=.7)
    m.box((1.4, 2.4, .5), (0, -.6, 1.05), '#ecebe5', .08); m.box((1.3, 1.0, .18), (0, -.2, 1.32), '#2b3a44', .03)  # cabin, windows
    for sd in (-1, 1): m.box((.04, 3.6, .04), (sd * 1.08, -.4, 1.3), '#c9ccce')                              # guard rails
    deck = .95; top = (0, .6, 12)
    m.rod((0, .6, deck), top, .065, '#c9ccce', 8); m.rod((0, .5, 2.1), (0, -3, 2.1), .05, '#c9ccce')
    furled(m, (0, .45, 2.25), (0, -2.9, 2.25), .17, '#1f3b5b')
    for p in [(0, 3.9, deck), (1.1, .2, deck), (-1.1, .2, deck), (0, -3.9, deck + .2)]: m.rod(top, p, .012, '#8a8f93', 4)
    m.box((.5, .3, .5), (0, -3.6, 1.0), '#9aa0a3')  # outboard bracket

def motor(m):
    m.hull(6.5, 2.3, 1.05, '#e9e6dc', '#c9b48a', sheer=.3, band='#7b1f22', band_h=.12, transom=.85)
    m.box((1.6, 2.2, .85), (0, -.4, 1.1), '#f2f0ea', .1); m.box((1.62, 1.6, .32), (0, -.2, 1.35), '#2b3a44', .03)
    m.box((1.5, .08, .4), (0, .72, 1.62), '#9fb2bb', .01, rot=(-.5, 0, 0)); m.box((1.3, 1.8, .05), (0, -.5, 1.55), '#d9d6cc', .02)
    for sd in (-1, 1): m.box((.04, 2.8, .04), (sd * 1.04, -.6, 1.12), '#c9ccce')

def wooden(m):
    d = 1.62
    m.hull(13, 3.7, 1.95, '#24201c', '#a08058', sheer=.5, band='#7c2a22', band_h=.36, transom=.65, k=28)
    m.box((1.7, 2.4, 1.0), (0, -4.2, d + .5), '#6b4d32', .05); m.box((1.95, 2.65, .12), (0, -4.2, d + 1.05), '#3b2a1c', .03)
    for i in range(3): m.box((.04, .5, .32), (.86, -4.9 + i * .7, d + .62), '#d9c9a0')  # deckhouse windows
    for i in range(3): m.box((.04, .5, .32), (-.86, -4.9 + i * .7, d + .62), '#d9c9a0')
    m.box((.9, 1.1, .5), (0, 3.6, d + .25), '#6b4d32', .03)
    main, miz, bow = (0, 2, 15.5), (0, -3.4, 11.5), (0, 9.6, 2.4)
    m.rod((0, 2, d), main, .16, '#6b5238', 10); m.rod((0, -3.4, d), miz, .13, '#6b5238', 10); m.rod((0, 6.2, 1.95), bow, .11, '#6b5238', 8)
    m.rod((0, 2, 2.9), (0, -3, 2.9), .085, '#6b5238'); m.rod((0, -3.4, 2.9), (0, -6.6, 2.9), .075, '#6b5238')
    m.rod((0, 2, 13.8), (0, -1.6, 13.0), .06, '#6b5238')                                             # gaff
    furled(m, (0, 1.8, 3.15), (0, -2.8, 3.15), .23, '#e3d8c2'); furled(m, (0, -3.6, 3.12), (0, -6.4, 3.12), .2, '#e3d8c2')
    furled(m, (0, 6.4, 2.3), (0, 9.2, 2.45), .12, '#e3d8c2')
    for a, b in [(main, bow), (main, miz), (miz, (0, -6.4, d))]: m.rod(a, b, .022, '#2a2622', 4)
    for sd in (-1, 1):
        for p, q in [(main, (sd * 1.8, 2.4, d)), (main, (sd * 1.8, 1.0, d)), (miz, (sd * 1.6, -3.6, d))]: m.rod(p, q, .02, '#2a2622', 4)
        m.box((.06, 8, .06), (sd * 1.7, -.8, d + .45), '#5b4630')                                       # bulwark rail
        for y in range(-4, 4, 2): m.rod((sd * 1.7, y, d), (sd * 1.7, y, d + .45), .03, '#5b4630', 4)
    for z in (d + .05, d + .3): m.box((.05, .05, .05), (0, 9.6, z), '#2a2622')
    m.box((.3, .6, .3), (0, -6.3, d + .2), '#6b4d32')  # tiller box

def tour(m):
    m.hull(17, 4.6, 1.2, '#1f3f63', '#d9d6cc', sheer=.12, transom=.9, flat=.3, k=26)
    m.box((4.2, 13.5, .12), (0, -.6, 1.95), '#e9e7e0', .05)                             # flat roof
    for sd in (-1, 1):
        m.box((.06, 13.5, .55), (sd * 2.08, -.6, 1.55), '#c9d6dd')                       # glazing band
        for y in range(-7, 7, 2): m.box((.07, .07, .7), (sd * 2.1, y + .4, 1.5), '#2b4a6e')
    m.box((4.3, 14, .06), (0, -.6, 1.25), '#2b4a6e')
    for r in range(5):
        for sd in (-1, 1): m.box((1.6, .45, .35), (sd * .95, -5.5 + r * 2.4, 1.1), '#8b2f2a')  # benches
    m.box((1.4, 1.4, .9), (0, -7.2, 1.4), '#e9e7e0', .05)

def havnebus(m):
    m.hull(22, 5.2, 1.35, '#e2b33c', '#5f6a70', sheer=.15, transom=.9, flat=.25, k=26)
    m.box((4.4, 15, 1.9), (0, -1.2, 2.1), '#f2f0ea', .12); m.box((4.46, 14.4, .9), (0, -1.2, 2.35), '#25313a', .04)
    m.box((4.5, 15.2, .22), (0, -1.2, 1.32), '#1f4f8a', .03); m.box((4.6, 15.6, .14), (0, -1.2, 3.1), '#e9e7e0', .05)
    m.box((1.8, 2.2, 1.0), (0, -4.8, 3.6), '#f2f0ea', .08); m.box((1.82, .1, .5), (0, -3.7, 3.7), '#25313a')

def ship(m):
    m.hull(30, 7.2, 3.7, '#3b2a1c', '#a8875c', sheer=.9, band='#c19a45', band_h=.5, transom=.7, k=30)
    m.box((6.8, 4, 2.2), (0, -12.5, 4.3), '#4a3020', .1)
    for i in range(6): m.box((.05, .45, .45), (3.42, -14 + i * .6, 4.4), '#e6d39a'); m.box((.05, .45, .45), (-3.42, -14 + i * .6, 4.4), '#e6d39a')
    for y, h, yard in [(9, 22, 9), (0, 26, 10), (-8, 18, 7.5)]:
        m.rod((0, y, 2.5), (0, y, h + 2), .3, '#5b4630', 10)
        for k, (zz, w) in enumerate([(h * .45, yard), (h * .68, yard * .8), (h * .88, yard * .6)]):
            m.rod((-w / 2, y, zz + 2), (w / 2, y, zz + 2), .12, '#5b4630', 6)
            m.box((w * .95, .15, h * .19), (0, y - .3, zz + 2 - h * .1), '#efe7d3', .02)            # set sails
    m.rod((0, 14, 4), (0, 21, 6.5), .2, '#5b4630', 8); m.box((.6, 1.6, 1.4), (0, 15, 4.3), '#c8202a')
    for sd in (-1, 1):
        for i in range(8): m.box((.05, .5, .4), (sd * 3.35, -8 + i * 2.2, 2.3), '#1c1712')               # gun ports

os.makedirs(OUT, exist_ok=True)
only = os.environ.get('ONLY')
for name, fn in [('sail', sail), ('motor', motor), ('wooden', wooden), ('tour', tour), ('havnebus', havnebus), ('ship', ship)]:
    if only and name not in only.split(','): continue
    m = Model(); fn(m); m.export(os.path.join(OUT, name + '.glb'))
