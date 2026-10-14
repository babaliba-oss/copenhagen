"""1760 coach and horse, modelled in Blender: a lacquered travelling coach (curved body, gilt mouldings,
glazed doors, roof rail, lanterns, spoked wheels, the coachman on his box) and a horse body built with a skin
modifier over a skeleton (legs stay procedural so they can swing). Original shapes. Plain coloured materials;
the horse's `coat` material is recoloured per horse in the game. Game frame as src/copenhagen/carriage.js:
horses ahead at the game's -Z (Blender +Y), ground at 0.

Run headless:  bpyenv/bin/python scripts/blender/carriage.py public/models/carriage"""
import sys, os, math
import bpy, bmesh
from mathutils import Vector

OUT = sys.argv[-1] if not sys.argv[-1].endswith('.py') else 'carriage'

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
    def add(self, ob, key, smooth=True):
        ob.data.materials.append(self.mat(key))
        for p in ob.data.polygons: p.use_smooth = smooth
        return ob
    def box(self, size, loc, key, rot=(0, 0, 0), bevel=0, seg=1):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); ob = bpy.context.active_object; ob.scale = size
        bpy.ops.object.transform_apply(scale=True)
        if bevel: m = ob.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = seg
        return self.add(ob, key, smooth=seg > 1)
    def rod(self, a, b, r, key, seg=6):
        a, b = Vector(a), Vector(b); d = b - a
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=seg, location=(a + b) / 2)
        ob = bpy.context.active_object; ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return self.add(ob, key)
    def wheel(self, r, x, y, spokes=10):
        bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=.035, major_segments=24, minor_segments=4, location=(x, y, r), rotation=(0, math.pi / 2, 0))
        self.add(bpy.context.active_object, '#1d1a17')
        self.rod((x - .08, y, r), (x + .08, y, r), .075, '#b08a3c', 10)
        for i in range(spokes):
            a = i * math.pi * 2 / spokes; self.rod((x, y, r), (x, y + math.cos(a) * (r - .02), r + math.sin(a) * (r - .02)), .016, '#3a2a1c', 4)
    def skin(self, verts, edges, radii, key, subdiv=1):
        me = bpy.data.meshes.new('skin'); me.from_pydata(verts, edges, []); ob = bpy.data.objects.new('skin', me); bpy.context.collection.objects.link(ob)
        ob.modifiers.new('skin', 'SKIN')
        for v, (rx, ry) in zip(me.skin_vertices[0].data, radii): v.radius = (rx, ry)
        me.skin_vertices[0].data[0].use_root = True
        if subdiv: m = ob.modifiers.new('s', 'SUBSURF'); m.levels = subdiv
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

def coach(m):
    LAC, GILT, DARK, GLASS = '#1f3a2c', '#c19a45', '#16120e', '#0e1418'
    # body: lofted, wider at the waist and tucked in at the floor (the curved 'berline' belly)
    bm = bmesh.new(); rings = []
    for k, (z, w, d) in enumerate([(.78, .56, .82), (.95, .7, .98), (1.3, .73, 1.02), (1.85, .72, 1.0), (1.96, .7, .98)]):
        ring = []
        for i in range(16):
            a = 2 * math.pi * i / 16; ca, sa = math.cos(a), math.sin(a)
            ring.append(bm.verts.new((w * math.copysign(abs(ca) ** .35, ca), -.45 + d * math.copysign(abs(sa) ** .35, sa), z)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(16): bm.faces.new((r0[i], r0[(i + 1) % 16], r1[(i + 1) % 16], r1[i]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1]); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('body'); bm.to_mesh(me); bm.free(); ob = bpy.data.objects.new('body', me); bpy.context.collection.objects.link(ob); m.add(ob, LAC)
    m.box((1.52, 2.14, .07), (0, -.45, 2.0), DARK, bevel=.03, seg=2)                          # roof with overhang
    m.box((1.32, 1.92, .08), (0, -.45, 2.07), '#24201b', bevel=.03, seg=2)
    for x in (-.66, .66):
        for y in (-1.3, .4): m.rod((x, y, 2.04), (x, y, 2.2), .012, GILT, 4)
        m.rod((x, -1.3, 2.2), (x, .4, 2.2), .012, GILT, 4)                                    # roof rail
    for x in (-.735, .735):
        m.box((.02, .62, .5), (x, -.45, 1.5), GLASS)                                          # door glass
        m.box((.025, .72, .04), (x, -.45, 1.79), GILT); m.box((.025, .72, .04), (x, -.45, 1.21), GILT)
        m.box((.025, .04, .62), (x, -.79, 1.5), GILT); m.box((.025, .04, .62), (x, -.11, 1.5), GILT)
        m.box((.02, .5, .45), (x, -.45, 1.0), '#2a4a39')                                      # door panel
        m.box((.02, .32, .32), (x * 1.0, -1.15, 1.5), GLASS); m.box((.02, .32, .32), (x, .25, 1.5), GLASS)  # quarter lights
    m.box((1.44, .06, .45), (0, -1.45, 1.5), GLASS); m.box((1.44, .06, .45), (0, .55, 1.5), GLASS)        # back and front glass
    m.box((1.48, 2.06, .05), (0, -.45, 1.86), GILT); m.box((1.2, 1.7, .05), (0, -.45, .82), GILT)        # gilt mouldings
    # coachman's box and footboard (ahead, Blender +Y), perch, axle beds, pole
    m.box((1.0, .55, .5), (0, .95, 1.25), LAC, bevel=.03, seg=2); m.box((1.05, .6, .08), (0, .95, 1.52), DARK)
    m.box((1.0, .06, .35), (0, .7, 1.72), DARK); m.box((.9, .4, .05), (0, 1.3, .98), DARK, rot=(.35, 0, 0))
    m.box((.12, 2.5, .1), (0, -.1, .6), DARK); m.box((1.6, .08, .08), (0, -1.1, .62), DARK); m.box((1.4, .08, .08), (0, .95, .5), DARK)
    m.rod((0, 1.0, .95), (0, 4.2, .95), .035, DARK, 6)
    for x in (-.78, .78):
        m.rod((x, .25, 1.82), (x, .25, 2.0), .06, '#e9d7a0', 8); m.box((.16, .16, .05), (x, .25, 2.03), DARK)  # lanterns
    m.wheel(.62, .82, -1.1); m.wheel(.62, -.82, -1.1); m.wheel(.44, .72, .95); m.wheel(.44, -.72, .95)
    # coachman: coat, head, tricorne
    m.box((.42, .3, .55), (0, .98, 1.85), '#3a2c45', bevel=.05, seg=2)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=.13, segments=10, ring_count=8, location=(0, .98, 2.27)); m.add(bpy.context.active_object, '#d9b49a')
    bpy.ops.mesh.primitive_cone_add(radius1=.24, radius2=.1, depth=.14, vertices=3, location=(0, .98, 2.42)); m.add(bpy.context.active_object, '#141414')
    m.rod((.15, 1.1, 1.75), (.15, 1.5, 1.8), .03, '#3a2c45', 5); m.rod((-.15, 1.1, 1.75), (-.15, 1.5, 1.8), .03, '#3a2c45', 5)  # arms with reins

def horse(m):
    """Horse body over a skeleton (rump to muzzle), mane, tail, collar and harness pad; no legs."""
    V = [(0, -.9, 1.4), (0, -.62, 1.36), (0, -.2, 1.33), (0, .25, 1.33), (0, .6, 1.4), (0, .82, 1.68), (0, .98, 1.92), (0, 1.14, 2.02), (0, 1.38, 1.92), (0, 1.55, 1.82)]
    E = [(i, i + 1) for i in range(len(V) - 1)]
    R = [(.2, .24), (.3, .36), (.3, .33), (.29, .33), (.29, .34), (.17, .2), (.14, .15), (.11, .13), (.1, .11), (.08, .09)]
    m.skin(V, E, R, ('coat', '#5b3a24'))
    for x in (-.06, .06):
        bpy.ops.mesh.primitive_cone_add(radius1=.045, radius2=0, depth=.15, vertices=5, location=(x, 1.12, 2.18)); m.add(bpy.context.active_object, ('coat', '#5b3a24'))
    m.box((.05, .1, .55), (0, .86, 1.95), '#1e1712', rot=(-.62, 0, 0))                     # mane
    m.rod((0, -1.02, 1.5), (0, -1.12, .95), .05, '#1e1712', 6)                              # tail
    bpy.ops.mesh.primitive_torus_add(major_radius=.2, minor_radius=.04, major_segments=14, minor_segments=6, location=(0, .76, 1.66), rotation=(-.95, 0, 0))
    m.add(bpy.context.active_object, '#2b1d14')
    m.box((.58, .5, .06), (0, .05, 1.68), '#2b1d14', bevel=.02); m.box((.62, .08, .05), (0, .05, 1.3), '#2b1d14')
    bpy.ops.mesh.primitive_uv_sphere_add(radius=.03, segments=6, ring_count=4, location=(.1, 1.3, 2.0)); m.add(bpy.context.active_object, '#0b0908')   # eyes
    bpy.ops.mesh.primitive_uv_sphere_add(radius=.03, segments=6, ring_count=4, location=(-.1, 1.3, 2.0)); m.add(bpy.context.active_object, '#0b0908')

os.makedirs(OUT, exist_ok=True)
for name, fn in [('coach', coach), ('horse', horse)]:
    m = M(); fn(m); m.export(os.path.join(OUT, name + '.glb'))
