"""1760 farmyard animals that roam the squares: pig, hen and goose. Original low-poly shapes (hundreds are
instanced). Same frame as the procedural ones in src/copenhagen/period-life.js: standing on the origin,
head towards +X. Plain coloured materials, baked to vertex colours in the game.

Run headless:  bpyenv/bin/python scripts/blender/animals.py public/models/animals"""
import sys, os, math
import bpy
from mathutils import Vector

OUT = sys.argv[-1] if not sys.argv[-1].endswith('.py') else 'animals'

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c)

class M:
    def __init__(self):
        bpy.ops.wm.read_factory_settings(use_empty=True); self.mats = {}
    def mat(self, hexc):
        if hexc not in self.mats:
            m = bpy.data.materials.new('c' + hexc.lstrip('#')); m.use_nodes = True
            m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*srgb(hexc), 1); self.mats[hexc] = m
        return self.mats[hexc]
    def add(self, ob, hexc, smooth=True):
        ob.data.materials.append(self.mat(hexc))
        for p in ob.data.polygons: p.use_smooth = smooth
        return ob
    def blob(self, r, loc, scale, hexc, seg=10, rings=7, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings, location=loc, rotation=rot)
        ob = bpy.context.active_object; ob.scale = scale; return self.add(ob, hexc)
    def rod(self, a, b, r0, r1, hexc, seg=6):
        a, b = Vector(a), Vector(b); d = b - a
        bpy.ops.mesh.primitive_cone_add(radius1=r0, radius2=r1, depth=d.length, vertices=seg, location=(a + b) / 2, end_fill_type='NGON')
        ob = bpy.context.active_object; ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return self.add(ob, hexc)
    def export(self, path):
        bpy.ops.object.select_all(action='SELECT')
        for ob in bpy.context.selected_objects:
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=True,
                                  export_materials='EXPORT', export_texcoords=False)
        print('wrote', path, tris, 'tris')

def pig(m):
    PINK, SNOUT, DARK = '#e3ab9b', '#cf8a7a', '#2a1c18'
    m.blob(.5, (0, 0, .5), (1.05, .62, .62), PINK, 12, 8)                 # body, 1.05 m long
    m.blob(.24, (.55, 0, .6), (1, .95, .95), PINK, 10, 7)                 # head
    m.rod((.74, 0, .57), (.92, 0, .55), .095, .085, SNOUT, 8)              # snout
    for s in (-1, 1):
        m.rod((.5, .13 * s, .78), (.47, .2 * s, .9), .07, .01, PINK, 4)    # ears
        m.blob(.025, (.73, .1 * s, .66), (1, 1, 1), DARK, 6, 4)            # eyes
        for x in (-.3, .3):
            m.rod((x, .17 * s, .32), (x, .17 * s, 0), .07, .06, PINK, 6)   # legs
            m.rod((x, .17 * s, .05), (x, .17 * s, 0), .065, .065, DARK, 6) # trotters
    bpy.ops.mesh.primitive_torus_add(major_radius=.05, minor_radius=.015, major_segments=8, minor_segments=4, location=(-.55, 0, .62), rotation=(math.pi / 2, 0, 0))
    m.add(bpy.context.active_object, PINK)                                 # curly tail

def hen(m):
    BROWN, DARKB, RED, BEAK = '#8b5a30', '#5e3a1e', '#c8202a', '#e0a030'
    m.blob(.16, (0, 0, .24), (1.2, .85, .9), BROWN, 10, 7)                # body
    m.blob(.1, (-.17, 0, .33), (.6, .35, 1.2), DARKB, 8, 5, rot=(0, -.6, 0))  # tail fan
    m.blob(.075, (.17, 0, .4), (1, 1, 1), BROWN, 8, 6)                    # head
    m.rod((.23, 0, .4), (.29, 0, .39), .022, .002, BEAK, 5)               # beak
    m.blob(.03, (.17, 0, .48), (1.4, .4, 1), RED, 6, 4)                   # comb
    m.blob(.02, (.23, 0, .35), (.7, .5, 1.2), RED, 5, 4)                  # wattle
    for s in (-1, 1): m.rod((0, .05 * s, .13), (.02, .05 * s, 0), .012, .01, BEAK, 4)

def goose(m):
    WHITE, GREYW, BEAK = '#efece4', '#d6d2c6', '#e8862a'
    m.blob(.2, (0, 0, .3), (1.35, .8, .8), WHITE, 10, 7)                  # body
    m.blob(.1, (-.25, 0, .35), (.9, .55, .5), GREYW, 8, 5)                # tail
    m.rod((.2, 0, .38), (.3, 0, .62), .055, .04, WHITE, 6)                # neck
    m.blob(.065, (.32, 0, .66), (1.25, .85, .85), WHITE, 8, 6)            # head
    m.rod((.38, 0, .65), (.47, 0, .63), .025, .012, BEAK, 5)              # beak
    for s in (-1, 1): m.rod((.02, .07 * s, .16), (.04, .07 * s, 0), .015, .013, BEAK, 4)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in [('pig', pig), ('hen', hen), ('goose', goose)]:
        m = M(); fn(m); m.export(os.path.join(OUT, name + '.glb'))
