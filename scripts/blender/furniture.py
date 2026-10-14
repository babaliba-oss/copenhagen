"""Copenhagen street furniture, modelled in Blender: the tall street lamp with its arm over the road, the
graphite lantern mast, the short park lamp with stacked shades, the Copenhagen bench (cast-iron ends, wooden
slats) and the street bin. Original shapes, low poly (thousands stand in the city). Same local frame and size
as the procedural versions in src/mapped-furniture.js: base at the origin, lamp arms over the road towards the
game's +Z (Blender -Y). Plain coloured materials, baked to vertex colours in the game.

Run headless:  bpyenv/bin/python scripts/blender/furniture.py public/models/furniture"""
import sys, os, math
import bpy, bmesh
from mathutils import Vector

OUT = sys.argv[-1] if not sys.argv[-1].endswith('.py') else 'furniture'

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
    def cone(self, r0, r1, h, z, hexc, seg=8, x=0, y=0, cap=True):
        bpy.ops.mesh.primitive_cone_add(radius1=r0, radius2=r1, depth=h, vertices=seg, location=(x, y, z + h / 2), end_fill_type='NGON' if cap else 'NOTHING')
        return self.add(bpy.context.active_object, hexc)
    def rod(self, a, b, r, hexc, seg=6):
        a, b = Vector(a), Vector(b); d = b - a
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=seg, location=(a + b) / 2, end_fill_type='NOTHING')
        ob = bpy.context.active_object; ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
        return self.add(ob, hexc)
    def sweep(self, pts, r, hexc, seg=6):
        for a, b in zip(pts, pts[1:]): self.rod(a, b, r, hexc, seg)
    def box(self, size, loc, hexc, rot=(0, 0, 0), bevel=0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); ob = bpy.context.active_object; ob.scale = size
        bpy.ops.object.transform_apply(scale=True)
        if bevel: m = ob.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = 1
        return self.add(ob, hexc, smooth=False)
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

STEEL, GRAPHITE, WHITE, LIGHT = '#7d8689', '#3b3f42', '#e9e6dc', '#fff3d6'

def lamp(m):
    """8.4 m street lamp: tapered pole, a curved arm reaching 1.5 m over the road, a slim LED head."""
    m.cone(.1, .06, 7.9, 0, STEEL, 8)
    m.cone(.13, .11, .5, 0, '#5d6567', 8)                                  # base collar
    arc = [(0, -1.5 * (1 - math.cos(a)) / 1.0 * 0 - 1.5 * math.sin(a) * 0, 0) for a in ()]
    pts = [(0, 0, 7.85)] + [(0, -1.25 * (1 - math.cos(t * math.pi / 2)), 7.85 + .45 * math.sin(t * math.pi / 2)) for t in (.33, .66, 1.0)]
    m.sweep(pts, .045, STEEL); m.rod(pts[-1], (0, -1.55, 8.3), .04, STEEL)
    m.box((.26, .62, .09), (0, -1.55, 8.27), '#3a4245', bevel=.02)        # head
    m.box((.2, .5, .02), (0, -1.55, 8.215), '#f2efe0')                    # lens

def mast_lamp(m):
    """5.4 m conical graphite mast with a top lantern (glass ring under a conical hat)."""
    m.cone(.075, .04, 5.4, 0, GRAPHITE, 8)
    m.cone(.05, .05, .12, 5.36, '#2c3033', 8)
    m.cone(.2, .2, .05, 5.42, LIGHT, 12)                                   # glowing ring
    m.cone(.24, .12, .3, 5.47, '#2c3033', 12)                              # hat
    m.cone(.03, .0, .1, 5.77, '#2c3033', 6)

def park_lamp(m):
    """Short park lamp: slim post and three stacked white shades over a warm bulb."""
    m.cone(.06, .045, 2.8, 0, GRAPHITE, 8)
    m.cone(.16, .16, .03, 2.84, LIGHT, 12)
    for z, r0, r1, h in [(2.86, .24, .1, .1), (2.97, .29, .12, .1), (3.08, .14, .05, .1)]:
        m.cone(r0, r1, h, z, WHITE, 14)
    m.rod((0, 0, 2.8), (0, 0, 3.16), .015, GRAPHITE, 4)

def bench(m):
    """Copenhagen bench, 1.8 x 0.6 x 0.85: cast-iron ends with curved arms, wooden seat and back slats.
    Seat faces the game's +Z (Blender -Y), back rest at the game's -Z."""
    W, IRON, WOOD = 1.8, '#2f3b33', '#8a6a48'
    for x in (-W / 2 + .12, W / 2 - .12):
        m.sweep([(x, .25, 0), (x, .2, .44), (x, .18, .8)], .03, IRON, 5)               # back leg and back post
        m.sweep([(x, -.22, 0), (x, -.2, .44)], .03, IRON, 5)                          # front leg
        m.sweep([(x, .2, .44), (x, -.24, .44)], .025, IRON, 5)                        # seat rail
        m.sweep([(x, .14, .62), (x, -.1, .64), (x, -.24, .6), (x, -.22, .44)], .022, IRON, 5)  # arm
    for i, y in enumerate((-.18, -.06, .06, .16)): m.box((W, .1, .035), (0, y, .46 + i * .005), WOOD, bevel=.008)
    for i, z in enumerate((.56, .68, .79)): m.box((W, .035, .09), (0, .2 - i * .012, z), WOOD, rot=(.12, 0, 0), bevel=.008)

def bin_(m):
    """Street bin: a dark green drum with a domed lid on a short post."""
    m.cone(.03, .03, .55, 0, '#5b615f', 6)
    m.cone(.2, .215, .68, .52, '#33463f', 12)
    m.cone(.23, .23, .05, 1.2, '#2a3833', 12)
    m.cone(.23, .1, .1, 1.25, '#2a3833', 12)
    m.box((.16, .02, .06), (0, -.205, 1.05), '#20302a')                     # throw-in slot lip

def traffic_light(m):
    """Signal post: tapered pole and a three-lens head with hoods, facing the game's +Z (Blender -Y); the
    lenses themselves are drawn by the game in front of the head (y 3.35 / 3.1 / 2.85)."""
    m.cone(.085, .065, 3.4, 0, '#566166', 8)
    m.box((.27, .23, .82), (0, -.05, 3.1), '#1d2629', bevel=.03)
    for z in (3.35, 3.1, 2.85):
        m.box((.22, .14, .03), (0, -.2, z + .11), '#1d2629', rot=(-.35, 0, 0))   # hood over each lens
    m.box((.36, .03, .95), (0, .07, 3.1), '#1d2629', bevel=.02)                    # backplate
    m.box((.06, .06, .16), (0, 0, 3.47), '#566166')

def crossing_light(m):
    """Pedestrian signal post: shorter pole and a two-lens head with hoods."""
    m.cone(.075, .06, 2.85, 0, '#566166', 8)
    m.box((.25, .2, .58), (0, -.05, 2.5), '#1d2629', bevel=.03)
    for z in (2.62, 2.38): m.box((.2, .12, .03), (0, -.18, z + .1), '#1d2629', rot=(-.35, 0, 0))
    m.box((.2, .14, .3), (0, .06, 1.1), '#e6c63a', bevel=.02)                      # push-button box

def wire_shade(m):
    """Copenhagen wire-hung street light: a shallow dark dome with a white diffuser, on a short hanger. Local
    height 0 is the bottom of the diffuser; the game lifts it to the wire."""
    m.rod((0, 0, .32), (0, 0, .56), .012, '#24282a', 4)
    m.cone(.07, .07, .08, .26, '#2c3033', 10)
    m.cone(.44, .1, .22, .05, '#2c3033', 16)                                       # dome
    m.cone(.43, .43, .02, .04, '#2c3033', 16)
    m.cone(.34, .34, .03, .0, '#fff3d6', 16)                                       # diffuser

def lantern(m):
    """1760 oil lantern on a wooden post: a tapered glazed box with a pyramid cap, hung on a bracket 0.42 m
    out towards the street (the game's +Z, Blender -Y; HEAD.lantern in mapped-furniture.js)."""
    Y = -.42
    m.cone(.08, .06, 2.6, 0, '#3b2e22', 6)
    m.box((.06, .5, .06), (0, Y / 2, 2.55), '#2a221a')                             # bracket
    m.rod((0, 0, 2.2), (0, Y * .8, 2.53), .02, '#2a221a', 4)                     # brace
    m.cone(.12, .17, .36, 2.44, '#f6dca0', 4, y=Y).rotation_euler.z = math.pi / 4  # glass
    m.cone(.2, .02, .2, 2.8, '#1d1a17', 4, y=Y).rotation_euler.z = math.pi / 4      # cap
    m.cone(.14, .14, .04, 2.42, '#1d1a17', 4, y=Y).rotation_euler.z = math.pi / 4

def bollard(m):
    """Cast bollard with a brass band and a rounded top (0.22 x 0.95 m)."""
    m.cone(.11, .095, .86, 0, '#2f3436', 10)
    m.cone(.112, .112, .06, .74, '#c9a64a', 10)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=.1, segments=10, ring_count=5, location=(0, 0, .86)); m.add(bpy.context.active_object, '#2f3436')

def shelter(m):
    """Bus shelter 3.6 x 1.5 x 2.5, open towards the road (the game's +Z, Blender -Y): slim steel frame, a thin
    roof that overhangs, glass back and end, an advert case at the other end and a bench."""
    W, D, H, STEEL, GLASS = 3.6, 1.5, 2.5, '#3e4a4f', '#a9c4cb'
    for x in (-W / 2 + .05, W / 2 - .05):
        for y in (D / 2 - .06, -D / 2 + .12): m.box((.07, .07, H), (x, y, H / 2), STEEL)
    m.box((W + .25, D + .3, .08), (0, 0, H + .04), '#4a565b', bevel=.03)
    m.box((W + .2, .04, .12), (0, -D / 2 - .14, H - .02), '#2c3438')                # fascia
    m.box((W - .1, .02, H - .35), (0, D / 2 - .06, H / 2 + .1), GLASS)
    m.box((.02, D * .6, H - .35), (-W / 2 + .05, D * .2, H / 2 + .1), GLASS)
    m.box((.1, D * .62, 1.75), (W / 2 - .05, D * .18, 1.15), '#d8d3c4', bevel=.02)   # advert case
    m.box((1.5, .38, .05), (-.3, D / 2 - .3, .47), '#5c4a3a', bevel=.01)
    for x in (-.95, .35): m.box((.05, .3, .45), (x, D / 2 - .3, .23), '#2d3133')

os.makedirs(OUT, exist_ok=True)
for name, fn in [('lamp', lamp), ('mast-lamp', mast_lamp), ('park-lamp', park_lamp), ('bench', bench), ('bin', bin_), ('traffic-light', traffic_light), ('crossing-light', crossing_light), ('wire-shade', wire_shade), ('lantern', lantern), ('bollard', bollard), ('shelter', shelter)]:
    m = M(); fn(m); m.export(os.path.join(OUT, name + '.glb'))
