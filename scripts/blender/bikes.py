"""Copenhagen bicycles, modelled in Blender: the upright city bike that fills every rack (low poly: thousands
are drawn, with a front basket and mudguards) and the box of a Christiania-style cargo bike. Original shapes.
Plain coloured materials; the material named `frame` is recoloured per instance group in the game.
Game frame as the procedural bikes: front wheel at the game's -Z (Blender +Y), ground at 0.

Run headless:  bpyenv/bin/python scripts/blender/bikes.py public/models/bikes"""
import sys, os, math
import bpy, bmesh
from mathutils import Vector

OUT = sys.argv[-1] if not sys.argv[-1].endswith('.py') else 'bikes'

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c)

class M:
    def __init__(self):
        bpy.ops.wm.read_factory_settings(use_empty=True); self.mats = {}
    def mat(self, key):
        name, hexc = key if isinstance(key, tuple) else ('c' + key.lstrip('#'), key)
        if name not in self.mats:
            m = bpy.data.materials.new(name); m.use_nodes = True
            m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*srgb(hexc), 1); self.mats[name] = m
        return self.mats[name]
    def add(self, ob, key):
        ob.data.materials.append(self.mat(key)); return ob
    def rod(self, a, b, r, key, seg=4):
        a, b = Vector(a), Vector(b); d = b - a
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=seg, location=(a + b) / 2, end_fill_type='NOTHING')
        ob = bpy.context.active_object; ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return self.add(ob, key)
    def ring(self, y, z, r, minor, key, major_seg=12, minor_seg=3, arc=None):
        bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=minor, major_segments=major_seg, minor_segments=minor_seg,
                                         location=(0, y, z), rotation=(0, math.pi / 2, 0))
        ob = bpy.context.active_object
        if arc:  # keep only the upper part (mudguards)
            bm = bmesh.new(); bm.from_mesh(ob.data)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if (ob.matrix_world @ v.co).z < z + arc], context='VERTS'); bm.to_mesh(ob.data); bm.free()
        return self.add(ob, key)
    def box(self, size, loc, key, rot=(0, 0, 0), bevel=0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); ob = bpy.context.active_object; ob.scale = size
        bpy.ops.object.transform_apply(scale=True)
        if bevel: m = ob.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = 1
        return self.add(ob, key)
    def export(self, path):
        bpy.ops.object.select_all(action='SELECT')
        for ob in bpy.context.selected_objects:
            bpy.context.view_layer.objects.active = ob
            for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=True,
                                  export_materials='EXPORT', export_texcoords=False)
        print('wrote', path, tris, 'tris')

FRAME = ('frame', '#2d4f7a')
def rack_bike(m):
    """Upright city bike (step-through frame, swept bars, front basket, mudguards, chain guard). ~300 tris."""
    R = .33; back, front = (0, -.56, R), (0, .56, R)            # Blender Y = -game Z: front wheel at +Y
    for y in (-.56, .56):
        m.ring(y, R, R, .028, '#1a1a1a', 12, 3)
        m.ring(y, R, R + .045, .028, FRAME, 12, 3, arc=-.02)     # mudguard over the top
    bb, seat, head_lo, head_hi = (0, -.05, .34), (0, -.25, .86), (0, .42, .55), (0, .44, .93)
    for a, b in [(back, seat), (back, bb), (bb, head_lo), (bb, (0, -.21, .74)), (head_lo, head_hi), (head_lo, front)]:
        m.rod(a, b, .022, FRAME)
    m.rod((0, -.21, .74), seat, .018, '#3a3a3a')                 # seat post
    m.box((.16, .26, .06), (0, -.27, .9), '#222222', bevel=.02)  # saddle
    m.rod(head_hi, (0, .5, 1.04), .018, '#3a3a3a')
    m.rod((-.27, .38, 1.05), (0, .5, 1.04), .016, '#2a2a2a'); m.rod((.27, .38, 1.05), (0, .5, 1.04), .016, '#2a2a2a')  # swept bars
    m.box((.36, .28, .2), (0, .7, .86), '#5a4632')                # front basket
    m.box((.05, .5, .1), (.07, -.25, .36), FRAME)                 # chain guard
    m.box((.24, .4, .03), (0, -.38, .7), '#2a2a2a')               # rear carrier
    m.rod((0, -.38, .7), back, .012, '#3a3a3a', 4)

def ladcykel_box(m):
    """Christiania-style cargo trike front: a curved plywood box on two front wheels (game frame as
    player-ride-models.js ladcykelBox: box centred 1.08 m ahead of the rear, floor at 0.42)."""
    W, D, Y, B, H = .86, .78, 1.08, .42, .52
    ply, edge, dark = '#c89a62', '#a87a45', '#1f2522'
    bm = bmesh.new(); n = 10; rings = []
    for k in range(2):  # a box whose front curves forward like the real thing
        z = B + k * H; ring = []
        for i in range(n + 1):
            t = i / n; x = -W / 2 + W * t; bulge = .12 * math.sin(math.pi * t) * (.6 + .4 * k)
            ring.append(bm.verts.new((x, Y + D / 2 + bulge, z)))
        ring.append(bm.verts.new((W / 2, Y - D / 2, z))); ring.append(bm.verts.new((-W / 2, Y - D / 2, z)))
        rings.append(ring)
    N = len(rings[0])
    for i in range(N): bm.faces.new((rings[0][i], rings[0][(i + 1) % N], rings[1][(i + 1) % N], rings[1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('box'); bm.to_mesh(me); bm.free(); ob = bpy.data.objects.new('box', me); bpy.context.collection.objects.link(ob)
    m.add(ob, ply); mod = ob.modifiers.new('s', 'SOLIDIFY'); mod.thickness = .02
    rim = [(-W / 2, Y - D / 2), (W / 2, Y - D / 2)] + [(-W / 2 + W * i / n, Y + D / 2 + .12 * math.sin(math.pi * i / n) * 1.0) for i in range(n, -1, -1)]
    pts = [(W / 2, Y - D / 2)] + [(-W / 2 + W * i / n, Y + D / 2 + .12 * math.sin(math.pi * i / n)) for i in range(n, -1, -1)] + [(-W / 2, Y - D / 2), (W / 2, Y - D / 2)]
    for a, b in zip(pts, pts[1:]): m.rod((a[0], a[1], B + H), (b[0], b[1], B + H), .018, edge, 4)
    m.box((W - .06, .22, .04), (0, Y - D / 2 + .14, B + .3), '#8a6236')     # bench
    m.box((.05, .7, .05), (0, .62, .36), dark); m.box((1.0, .04, .04), (0, Y, .36), dark)  # frame tube, axle
    for x in (-.5, .5):
        m.ring(Y, .24, .24, .03, '#1c211f', 16, 4); bpy.context.active_object.location.x = x
        m.rod((x - .03, Y, .24), (x + .03, Y, .24), .035, '#a9b2ad', 8)

os.makedirs(OUT, exist_ok=True)
for name, fn in [('rack-bike', rack_bike), ('ladcykel-box', ladcykel_box)]:
    m = M(); fn(m); m.export(os.path.join(OUT, name + '.glb'))
