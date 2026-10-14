"""Shared e-scooter, modelled in Blender: rounded deck with grip tape, raked stem with the operator colour,
T-bar with grips, fenders, 10-inch wheels and a kickstand. Original shape. The `paint` material marks the
operator-coloured parts (the game tints them per operator). Game frame as scooterGeometry() in
src/parked-micromobility.js: front at the game's -Z (Blender +Y), ground at 0.

Run headless:  bpyenv/bin/python scripts/blender/scooter.py public/models/bikes/scooter.glb"""
import sys, math
import bpy
from mathutils import Vector
OUT = sys.argv[-1] if sys.argv[-1].endswith('.glb') else 'scooter.glb'

def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c)
bpy.ops.wm.read_factory_settings(use_empty=True); mats = {}
def mat(name, hexc):
    if name not in mats:
        m = bpy.data.materials.new(name); m.use_nodes = True
        m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*srgb(hexc), 1); mats[name] = m
    return mats[name]
def add(ob, name, hexc):
    ob.data.materials.append(mat(name, hexc))
    for p in ob.data.polygons: p.use_smooth = True
    return ob
def box(size, loc, name, hexc, bevel=0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot); ob = bpy.context.active_object; ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel: m = ob.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = 1
    return add(ob, name, hexc)
def rod(a, b, r, name, hexc, seg=6):
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=seg, location=(a + b) / 2)
    ob = bpy.context.active_object; ob.rotation_mode = 'QUATERNION'; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return add(ob, name, hexc)
DARK = '#24282a'
box((.17, .58, .05), (0, .02, .165), 'dark', DARK, bevel=.02)
box((.15, .5, .01), (0, .02, .195), 'grip', '#3a3f42')
rod((0, .34, .2), (0, .45, 1.14), .022, 'paint', '#ffffff', 8)                 # stem (operator colour)
rod((0, .42, .1), (0, .36, .2), .026, 'dark', DARK)                             # fork crown
box((.06, .08, .14), (0, .38, .9), 'paint', '#ffffff', bevel=.015)                # light/display housing
rod((-.25, .455, 1.15), (.25, .455, 1.15), .014, 'dark', DARK)                  # bar
for x in (-.22, .22): rod((x - .04, .455, 1.15), (x + .04, .455, 1.15), .02, 'grip', '#111314')
box((.08, .1, .035), (0, .43, 1.13), 'dark', DARK, bevel=.01)
for y in (.42, -.3):
    bpy.ops.mesh.primitive_torus_add(major_radius=.1, minor_radius=.028, major_segments=12, minor_segments=4, location=(0, y, .125), rotation=(0, math.pi / 2, 0))
    add(bpy.context.active_object, 'tyre', '#1c1f20')
    rod((-.025, y, .125), (.025, y, .125), .07, 'hub', '#6c7375', 8)
box((.08, .24, .02), (0, -.3, .265), 'paint', '#ffffff', bevel=.01, rot=(-.15, 0, 0))   # rear fender
box((.07, .16, .02), (0, .44, .27), 'dark', DARK, bevel=.01, rot=(.2, 0, 0))            # front fender
rod((.06, -.05, .15), (.13, .02, .02), .01, 'dark', DARK, 5)                      # kickstand
bpy.ops.object.select_all(action='SELECT')
for ob in bpy.context.selected_objects:
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_normals=True, export_materials='EXPORT', export_texcoords=False)
print('wrote', OUT, tris, 'tris')
