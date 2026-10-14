"""Traffic and parked car bodies, one GLB per type, modelled in Blender from the same dimension table as the
procedural fallback in src/vehicle-models.js (length, width, height, wheelbase, beltline, roof front and rear,
tailgate glass, wheel radius, plus the cladding / rails / van / taxi flags). Original shapes, not manufacturer
CAD. Lower detail than player-car.py: these are instanced for the whole street. Wheels stay procedural; the
materials are named after the game's vehicle materials and swapped for them at load time.

Run headless:  bpyenv/bin/python scripts/blender/vehicles.py public/models/vehicles
Blender axes: X right, Y forward (the game's -Z), Z up. The exporter turns this into glTF Y-up."""
import sys, os, math, json
import bpy, bmesh

OUT = sys.argv[-1] if not sys.argv[-1].endswith('.py') else 'vehicles'
SPECS = {
 'crossover': dict(l=4.172, w=1.765, h=1.595, wb=2.56, rf=-.46, rr=1.18, rg=1.76, belt=1.02, r=.335, clad=True, blackRoof=True),
 'hatchback': dict(l=3.82, w=1.70, h=1.46, wb=2.43, rf=-.43, rr=.90, rg=1.55, belt=.90, r=.30),
 'sedan': dict(l=4.60, w=1.81, h=1.44, wb=2.70, rf=-.48, rr=.68, rg=1.43, belt=.92, r=.32),
 'estate': dict(l=4.60, w=1.81, h=1.49, wb=2.70, rf=-.46, rr=1.60, rg=2.05, belt=.96, r=.32, rails=True),
 'suv': dict(l=4.43, w=1.85, h=1.76, wb=2.65, rf=-.55, rr=1.30, rg=1.94, belt=1.09, r=.36, clad=True, rails=True),
 'van': dict(l=4.47, w=1.84, h=1.91, wb=2.78, rf=-.80, rr=1.91, rg=2.04, belt=1.07, r=.33, van=True),
 'taxi': dict(l=4.60, w=1.81, h=1.49, wb=2.70, rf=-.46, rr=1.60, rg=2.05, belt=.96, r=.32, rails=True, taxi=True),
}
COLOURS = [('paint', (.9, .9, .9)), ('glass', (.05, .08, .1)), ('black', (.05, .06, .07)), ('rubber', (.07, .07, .08)),
           ('chrome', (.85, .87, .88)), ('head', (.95, .97, .95)), ('tail', (.7, .05, .07)), ('plate', (.94, .95, .9))]

def section(y, w, z0, z1, n=14, sq=3.2, top_in=0.0):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        cx, cz = math.cos(a), math.sin(a)
        x = math.copysign(abs(cx) ** (2 / sq), cx); z = math.copysign(abs(cz) ** (2 / sq), cz)
        t = (z + 1) / 2
        pts.append((x * (w - top_in * t * t), y, z0 + t * (z1 - z0)))
    return pts

def build(kind, s):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {}
    for n, c in COLOURS:
        m = bpy.data.materials.new(n); m.diffuse_color = (*c, 1); mats[n] = m
    def loft(name, sections, material, subdiv=1, cap=True):
        me = bpy.data.meshes.new(name); bm = bmesh.new()
        rings = [[bm.verts.new(p) for p in sec] for sec in sections]; n = len(sections[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
        if cap: bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob); ob.data.materials.append(mats[material])
        if subdiv: m = ob.modifiers.new('sub', 'SUBSURF'); m.levels = subdiv; m.render_levels = subdiv
        for p in me.polygons: p.use_smooth = True
        return ob
    def box(name, size, loc, material, bevel=.02, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        ob = bpy.context.active_object; ob.name = name; ob.scale = size; bpy.ops.object.transform_apply(scale=True)
        if bevel: m = ob.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = 1
        ob.data.materials.append(mats[material]); return ob

    L, W, H, BELT, R, WB = s['l'] / 2, s['w'] / 2, s['h'], s['belt'], s['r'], s['wb']
    rf, rr, rg = -s['rf'], -s['rr'], -s['rg']     # Blender Y = -(game Z)
    fg = L - .93; roofmat = 'black' if s.get('blackRoof') else 'paint'
    bottom = .30 + R * .15
    body = [(L, W * .72, bottom + .14, BELT - .22), (L - .10, W * .90, bottom + .05, BELT - .10), (L - .35, W * .99, bottom, BELT - .02),
            (L - .9, W, bottom, BELT + .01), (0, W, bottom, BELT + .035), (-L + .9, W, bottom, BELT + .03),
            (-L + .35, W * .98, bottom + .02, BELT + .01), (-L + .08, W * .9, bottom + .08, BELT - .04), (-L, W * .74, bottom + .14, BELT - .12)]
    loft('paint_body', [section(y, w, z0, z1, sq=8.0) for y, w, z0, z1 in body], 'paint')
    # glasshouse (a van's is glass only to the B-pillar, painted panel behind)
    gh = [(fg, W * .86, BELT - .03, BELT + .04, .0), (fg - .30, W * .84, BELT - .02, BELT + min(.30, (H - BELT) * .45), .06), (rf, W * .81, BELT - .02, H - .07, .14),
          (min(0, rf - .3), W * .81, BELT - .02, H - .06, .15), (rr, W * .80, BELT - .02, H - .07, .15),
          (max(rg + .12, rr - .05), W * .82, BELT - .02, BELT + .30 if rg - rr < -.3 else H - .2, .10), (rg, W * .84, BELT - .03, BELT + .05, .04)]
    if s.get('van'):
        split = -.25
        front = [g for g in gh if g[0] > split] + [(split, W * .81, BELT - .02, H - .06, .15)]
        rear = [(split, W * .815, BELT - .02, H - .06, .12)] + [g for g in gh if g[0] < split]
        loft('glass_house', [section(y, w, z0, z1, sq=12.0, top_in=ti) for y, w, z0, z1, ti in front], 'glass')
        loft('paint_cargo', [section(y, W * .86 if i else w + .01, BELT - .03, H - .05 if i < len(rear) - 1 else z1, sq=24.0, top_in=.04) for i, (y, w, z0, z1, ti) in enumerate(rear)], 'paint')
    else:
        loft('glass_house', [section(y, w, z0, z1, sq=12.0, top_in=ti) for y, w, z0, z1, ti in gh], 'glass')
    roof = [(rf - .06, W * .64, H - .085, H - .03), (0 if rr < 0 < rf else (rf + rr) / 2, W * .66, H - .08, H - .015), (rr + .10, W * .64, H - .085, H - .03)]
    loft('roof', [section(y, w, z0, z1, n=12, sq=5) for y, w, z0, z1 in roof], roofmat)
    for sd in (-1, 1):
        box('chrome_beltline', (.03, fg - rg - .1, .035), (sd * W * .985, (fg + rg) / 2, BELT + .01), 'chrome', .006)
        if s.get('clad'):
            for y in (WB / 2, -WB / 2):
                secs = []
                for k in range(9):
                    a = math.radians(12 + 156 * k / 8); r0, r1 = R + .035, R + .10; c, sn = math.cos(a), math.sin(a)
                    xo, xi = sd * (W + .03), sd * (W - .06)
                    secs.append([(xo, y + c * r0, R + sn * r0), (xo, y + c * r1, R + sn * r1), (xi, y + c * r1, R + sn * r1), (xi, y + c * r0, R + sn * r0)])
                loft('rubber_arch', secs, 'rubber', subdiv=0)
            box('rubber_sill', (.08, WB - .75, .15), (sd * (W - .02), 0, bottom + .08), 'rubber', .02)
        box('black_bpillar', (.03, .08, H - BELT - .12), (sd * W * .79, -.20, (H + BELT) / 2 - .04), 'black', .008, rot=(0, sd * .12, 0))
        box('mirror', (.18, .12, .11), (sd * (W + .06), fg - .05, BELT + .09), roofmat, .02)
        box('head_lamp', (.36, .09, .07), (sd * W * .62, L - .06, BELT - .12), 'head', .015, rot=(0, 0, sd * -.18))
        box('tail_lamp', (.30, .07, .10), (sd * W * .66, -L + .07, BELT - .10), 'tail', .015, rot=(0, 0, sd * .18))
        if s.get('van') or kind in ('estate', 'taxi'):
            box('tail_upright', (.07, .06, .24), (sd * W * .80, -L + .13, BELT - .02), 'tail', .01)
        if s.get('rails'):
            box('chrome_rail', (.035, rf - rr - .3, .04), (sd * W * .60, (rf + rr) / 2, H - .035), 'chrome', .008)
    box('black_grille', (W * 1.3, .07, .20), (0, L - .02, bottom + .32), 'black', .02)
    box('chrome_slat', (W * 1.18, .02, .015), (0, L + .01, bottom + .34), 'chrome', 0)
    box('bumper_f', (W * 1.80, .18, .16), (0, L - .10, bottom + .12), 'rubber' if s.get('clad') else 'black', .04)
    box('bumper_r', (W * 1.84, .17, .18), (0, -L + .10, bottom + .14), 'rubber' if s.get('clad') else 'black', .04)
    for y in (L + .005, -L - .005): box('plate', (.50, .02, .12), (0, y, bottom + .40), 'plate', 0)
    if s.get('taxi'):
        box('plate_sign', (.46, .18, .17), (0, -.15, H + .09), 'plate', .02)
        box('black_sign', (.30, .19, .06), (0, -.15, H + .10), 'black', 0)
    cutters = []
    for y in (WB / 2, -WB / 2):
        bpy.ops.mesh.primitive_cylinder_add(radius=R + .04, depth=W * 2 + .6, location=(0, y, R), rotation=(0, math.pi / 2, 0), vertices=24)
        cutters.append(bpy.context.active_object)
    for ob in list(bpy.data.objects):
        if ob.name.startswith('paint_body') or ob.name.startswith('rubber_sill') or ob.name.startswith('bumper'):
            for c in cutters:
                m = ob.modifiers.new('well', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'
    bpy.ops.object.select_all(action='SELECT')
    for ob in [o for o in bpy.context.selected_objects if o not in cutters]:
        bpy.context.view_layer.objects.active = ob
        for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    for c in cutters: bpy.data.objects.remove(c)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    bpy.ops.object.select_all(action='SELECT')
    path = os.path.join(OUT, kind + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=True,
                              export_materials='EXPORT', export_texcoords=False)
    print('wrote', path, tris, 'tris')

os.makedirs(OUT, exist_ok=True)
only = os.environ.get('ONLY')
for kind, s in SPECS.items():
    if only and kind not in only.split(','): continue
    build(kind, s)
