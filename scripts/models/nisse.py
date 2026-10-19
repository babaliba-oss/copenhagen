"""The nisse for the hidden nisser and Nissefar: "Gnome (Female) (Pig Tails)" by David Wigforss (CC BY-NC 4.0,
sketchfab.com/3d-models/ba5c774d246b42d9bd916bf0e9f0552e: free for a free game; a commercial one would need another,
e.g. the CC BY "Domesticated Garden Gnome" by schmoldt.art). Blender as a Python module:
   python3 scripts/models/nisse.py <scene.gltf> public/models/nisse.glb && gzip -9 -n -f public/models/nisse.glb
One textured mesh (position, normal, uv and its base-colour texture at 512 px, no normal map), 1 m tall, standing on
y = 0 and facing -Z (the game scales it), as gait.js's loadOneMesh reads it.
"""
import bpy, sys, math
from mathutils import Matrix, Vector

src, out = sys.argv[1], sys.argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:
    o.data.transform(o.matrix_world)
for o in meshes:
    o.parent = None; o.matrix_world = Matrix.Identity(4)
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.data.objects: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
o = bpy.context.view_layer.objects.active; o.name = o.data.name = 'nisse'
# Blender is Z up: the figure faces glTF +Z (Blender -Y); turn it half round so it faces glTF -Z, feet centred on the origin.
o.data.transform(Matrix.Rotation(math.pi, 4, 'Z'))
zs = [v.co.z for v in o.data.vertices]; z0, z1 = min(zs), max(zs)
feet = [v.co for v in o.data.vertices if v.co.z < z0 + .08 * (z1 - z0)]
cx, cy = sum(c.x for c in feet) / len(feet), sum(c.y for c in feet) / len(feet)
s = 1 / (z1 - z0)
o.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-cx, -cy, -z0))))
for a in list(o.data.color_attributes): o.data.color_attributes.remove(a)
while len(o.data.uv_layers) > 1: o.data.uv_layers.remove(o.data.uv_layers[-1])
# the base colour only, at 512 px
for m in o.data.materials:
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type == 'NORMAL_MAP' or (n.type == 'TEX_IMAGE' and n.image and 'normal' in n.image.name.lower()): nt.nodes.remove(n)
    for n in nt.nodes:
        if n.type == 'TEX_IMAGE' and n.image and max(n.image.size) > 512: n.image.scale(512, 512)
    b = nt.nodes.get('Principled BSDF')
    if b: b.inputs['Metallic'].default_value = 0; b.inputs['Roughness'].default_value = .75
print('triangles', sum(len(p.vertices) - 2 for p in o.data.polygons), 'height', round(max(v.co.z for v in o.data.vertices), 3))
kw = dict(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True, export_texcoords=True, export_normals=True,
          export_tangents=False, export_materials='EXPORT', export_image_format='JPEG', export_animations=False)
try: bpy.ops.export_scene.gltf(**kw, export_vertex_color='NONE')
except TypeError: bpy.ops.export_scene.gltf(**kw)
