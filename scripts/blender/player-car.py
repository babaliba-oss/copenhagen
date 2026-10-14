"""Player car body (crossover proportions: 4.17 x 1.77 x 1.60 m, wheelbase 2.56 m) modelled in Blender, exported
as public/models/player-car.glb. Original shape, not manufacturer CAD. Wheels stay procedural in
src/vehicle-models.js; the body's materials are named after the game's vehicle materials (paint, glass, black,
rubber, chrome, head, tail, plate) and are swapped for them at load time.

Run headless:  python3.11 -m venv bpyenv && bpyenv/bin/pip install bpy==4.2.0
               bpyenv/bin/python scripts/blender/player-car.py public/models/player-car.glb
Blender axes: X right, Y forward (the game's -Z), Z up. The exporter turns this into glTF Y-up."""
import sys, math
import bpy, bmesh

OUT = sys.argv[-1] if sys.argv[-1].endswith('.glb') else 'player-car.glb'
L, W, H, BELT, R, WB = 4.172 / 2, 1.765 / 2, 1.595, 1.02, .335, 2.56

bpy.ops.wm.read_factory_settings(use_empty=True)
mats = {}
def mat(name, rgb):
    m = bpy.data.materials.new(name); m.diffuse_color = (*rgb, 1); mats[name] = m; return m
for n, c in [('paint', (.9, .9, .9)), ('glass', (.05, .08, .1)), ('black', (.05, .06, .07)), ('rubber', (.07, .07, .08)),
             ('chrome', (.85, .87, .88)), ('head', (.95, .97, .95)), ('tail', (.7, .05, .07)), ('plate', (.94, .95, .9))]:
    mat(n, c)

def section(y, w, z0, z1, n=20, sq=3.2, top_in=0.0):
    """Superellipse-ish cross-section: half-width w at the middle, pulled in by top_in at the top (tumblehome)."""
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        cx, cz = math.cos(a), math.sin(a)
        x = math.copysign(abs(cx) ** (2 / sq), cx)
        z = math.copysign(abs(cz) ** (2 / sq), cz)
        zz = z0 + (z + 1) / 2 * (z1 - z0)
        t = (z + 1) / 2
        pts.append((x * (w - top_in * t * t), y, zz))
    return pts

def loft(name, sections, material, subdiv=2, cap=True):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in s] for s in sections]
    n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    if cap:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mats[material])
    if subdiv:
        m = ob.modifiers.new('sub', 'SUBSURF'); m.levels = subdiv; m.render_levels = subdiv
    for p in me.polygons: p.use_smooth = True
    return ob

def box(name, size, loc, material, bevel=.02, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object; ob.name = name; ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        m = ob.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = 3
    ob.data.materials.append(mats[material])
    for p in ob.data.polygons: p.use_smooth = True
    return ob

# Lower body: nose (y=+L) to tail (y=-L). Each station: (y, half-width, bottom, belt height)
body = [(L, W * .70, .50, .80), (L - .10, W * .90, .40, .92), (L - .35, W * .99, .36, BELT - .02), (L - .9, W, .35, BELT + .01),
        (0, W, .35, BELT + .035), (-L + .9, W, .36, BELT + .03), (-L + .35, W * .98, .38, BELT + .01), (-L + .08, W * .9, .44, BELT - .04),
        (-L, W * .74, .50, BELT - .12)]
loft('paint_body', [section(y, w, z0, z1, sq=8.0) for y, w, z0, z1 in body], 'paint', subdiv=1)

# Glasshouse: windscreen rake at the front, steep tailgate glass at the back, tumblehome on the sides
fg, rf, rr, rg = L - .93, .46, -1.18, -1.76   # Blender Y = -(game Z)
gh = [(fg, W * .86, BELT - .03, BELT + .04, .00), (fg - .30, W * .84, BELT - .02, BELT + .30, .06), (rf, W * .81, BELT - .02, H - .07, .14),
      (0, W * .81, BELT - .02, H - .06, .15), (rr, W * .80, BELT - .02, H - .07, .15), (rg + .12, W * .82, BELT - .02, BELT + .30, .10),
      (rg, W * .84, BELT - .03, BELT + .05, .04)]
loft('glass_house', [section(y, w, z0, z1, sq=12.0, top_in=ti) for y, w, z0, z1, ti in gh], 'glass', subdiv=1)

# Black roof panel, pillars and window line
roof = [(rf - .06, W * .64, H - .085, H - .03), (0, W * .66, H - .08, H - .015), (rr + .10, W * .64, H - .085, H - .03)]
loft('black_roof', [section(y, w, z0, z1, sq=5) for y, w, z0, z1 in roof], 'black', subdiv=2)
for s in (-1, 1):
    box('black_bpillar', (.03, .09, (H - .12) - BELT), (s * (W * .80 - .05 * ((H-.1-BELT)/2) / (H-BELT)), -.20, (H - .1 + BELT) / 2), 'black', .01, rot=(0, s * .14, 0))
    box('chrome_beltline', (.03, rf - rg + .1, .04), (s * W * .985, (rf + rg) / 2 + .1, BELT + .01), 'chrome', .008)
    # wheel-arch cladding and sill
    for y in (WB / 2, -WB / 2):
        # flared arch: a rectangular profile swept over the top of the wheel (about 15 to 165 degrees)
        secs = []
        for k in range(17):
            a = math.radians(12 + 156 * k / 16); r0, r1 = R + .035, R + .11; c, sn = math.cos(a), math.sin(a)
            xo, xi = s * (W + .035), s * (W - .06)
            secs.append([(xo, y + c * r0, R + sn * r0), (xo, y + c * r1, R + sn * r1), (xi, y + c * r1, R + sn * r1), (xi, y + c * r0, R + sn * r0)])
        loft('rubber_arch', secs, 'rubber', subdiv=1)
    box('rubber_sill', (.08, WB - .75, .16), (s * (W - .02), 0, .44), 'rubber', .03)
    # mirrors
    box('black_mirror', (.20, .13, .12), (s * (W + .07), fg - .05, BELT + .10), 'black', .03)
    # lights: slim headlamps wrapping the corner, tail lamps
    box('head_lamp', (.38, .10, .07), (s * W * .62, L - .06, BELT - .10), 'head', .02, rot=(0, 0, s * -.18))
    box('tail_lamp', (.32, .07, .10), (s * W * .66, -L + .07, BELT - .08), 'tail', .02, rot=(0, 0, s * .18))
    box('tail_lower', (.08, .05, .16), (s * W * .84, -L + .10, .62), 'tail', .01)
# bumpers, grille, plates, light bar
box('black_grille', (W * 1.3, .07, .22), (0, L - .02, .70), 'black', .03)
for i in range(3):
    box('chrome_slat', (W * 1.18, .02, .015), (0, L + .01, .64 + i * .06), 'chrome', .004)
box('rubber_bumper_f', (W * 1.80, .20, .17), (0, L - .10, .45), 'rubber', .05)
box('rubber_bumper_r', (W * 1.84, .18, .20), (0, -L + .10, .47), 'rubber', .05)
box('chrome_skid', (W * 1.2, .06, .07), (0, -L + .05, .37), 'chrome', .01)
box('tail_bar', (W * 1.1, .03, .03), (0, -L + .03, BELT - .06), 'tail', .006)
box('black_spoiler', (W * 1.55, .22, .04), (0, rr + .02, H - .045), 'black', .015)
for y in (L + .005, -L - .005):
    box('plate', (.50, .02, .12), (0, y, .74), 'plate', .005)

# wheel wells: cut the body and sills with cylinders around each wheel
cutters = []
for y in (WB / 2, -WB / 2):
    bpy.ops.mesh.primitive_cylinder_add(radius=R + .045, depth=W * 2 + .6, location=(0, y, R), rotation=(0, math.pi / 2, 0), vertices=48)
    cutters.append(bpy.context.active_object)
for ob in list(bpy.data.objects):
    if ob.name.startswith('paint_body') or ob.name.startswith('rubber_sill'):
        for c in cutters:
            m = ob.modifiers.new('well', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'EXACT'
# boolean after subdivision: move the booleans to the end of each stack (they were appended last already)
# apply modifiers, join per material, export
bpy.ops.object.select_all(action='SELECT')
for ob in [o for o in bpy.context.selected_objects if o not in cutters]:
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
for c in cutters: bpy.data.objects.remove(c)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_normals=True,
                          export_materials='EXPORT', export_texcoords=False)
print('wrote', OUT)
