"""City buses, modelled in Blender: a 12 m city bus and a 15 m three-axle trunk bus with rounded body
corners, a deep wrap-around windscreen, a continuous glass band with black pillars, wheel arches cut into the
body, black skirt and bumpers, and battery pods on the roof. Original shapes. Doors, wheels, lamps, mirrors and
the destination screen stay procedural (src/bus-renderer.js) so they keep opening and lighting up. Materials
are named after the bus materials (paint, white, glass, black, roof). Front at the game's -Z (Blender +Y).

Run headless:  bpyenv/bin/python scripts/blender/bus.py public/models/buses"""
import sys, os, math
import bpy

OUT = sys.argv[-1] if not sys.argv[-1].endswith('.py') else 'buses'
KINDS = {'city': dict(length=12, axles=[-3.85, 2.55], doors=[-4.8, .05, 3.95]),
         'trunk': dict(length=15, axles=[-4.85, 3.05, 4.65], doors=[-6.3, .05, 5.3])}

def build(kind, k):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {}
    for n in ('paint', 'white', 'glass', 'black', 'roof'):
        m = bpy.data.materials.new(n); mats[n] = m
    L, W = k['length'], 2.52
    def box(size, loc, mat, bevel=0, seg=3, name='b'):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc); ob = bpy.context.active_object; ob.name = name; ob.scale = size
        bpy.ops.object.transform_apply(scale=True)
        if bevel: m = ob.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = seg; m.limit_method = 'ANGLE'
        ob.data.materials.append(mats[mat])
        for p in ob.data.polygons: p.use_smooth = bool(bevel)
        return ob
    Y = lambda z: -z   # game z -> Blender y
    lower = box((W, L, 1.12), (0, 0, .9), 'paint', .16, 3, 'paint_lower')
    box((W - .05, L - .14, 1.32), (0, 0, 2.1), 'glass', .14, 3, 'glass_band')
    box((W, L - .06, .3), (0, 0, 2.88), 'paint', .14, 3, 'paint_roof')
    box((W + .01, L - .02, .12), (0, 0, 1.5), 'paint', .05, 2, 'paint_belt')
    box((W - .02, L - .1, .14), (0, 0, .4), 'black', .05, 2, 'black_skirt')
    # windscreen: a deep glass panel wrapping the front corners, black surround below
    box((W - .2, .06, 1.25), (0, L / 2 - .01, 2.05), 'glass', .05, 2, 'glass_front')
    box((W - .3, .05, .55), (0, L / 2 - .005, .95), 'black', .03, 2, 'black_grille')
    box((W - .2, .06, .9), (0, -L / 2 + .01, 2.2), 'glass', .05, 2, 'glass_rear')
    # window pillars along both sides, white flank accent
    for sd in (-1, 1):
        y = -L / 2 + .5
        while y < L / 2 - .2:
            box((.05, .07, 1.25), (sd * (W / 2 - .005), y, 2.11), 'black', 0, 1, 'pillar'); y += 1.25
        box((.02, L * .7, .18), (sd * (W / 2 + .003), Y(1.05), .72), 'white', 0, 1, 'flank')
    # door openings on the kerb side (+X): dark recesses the procedural leaves slide over
    for z in k['doors']: box((.05, 1.17, 2.3), (W / 2 - .01, Y(z), 1.6), 'black', 0, 1, 'door')
    # roof pods (batteries / HVAC)
    box((2.0, 5.4, .26), (0, Y(.65), 3.12), 'roof', .08, 2, 'roof_pod'); box((1.3, 1.6, .22), (0, Y(-3.5), 3.1), 'roof', .07, 2, 'roof_pod2')
    # wheel arches: cut the lower body and skirt
    cutters = []
    for z in k['axles']:
        bpy.ops.mesh.primitive_cylinder_add(radius=.66, depth=W + .4, location=(0, Y(z), .58), rotation=(0, math.pi / 2, 0), vertices=24)
        cutters.append(bpy.context.active_object)
    for ob in list(bpy.data.objects):
        if ob.name.startswith(('paint_lower', 'black_skirt', 'flank')):
            for c in cutters:
                m = ob.modifiers.new('arch', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'
    bpy.ops.object.select_all(action='SELECT')
    for ob in [o for o in bpy.context.selected_objects if o not in cutters]:
        bpy.context.view_layer.objects.active = ob
        for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    for c in cutters: bpy.data.objects.remove(c)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(OUT, kind + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=True, export_materials='EXPORT', export_texcoords=False)
    print('wrote', path, tris, 'tris')

os.makedirs(OUT, exist_ok=True)
for kind, k in KINDS.items(): build(kind, k)
