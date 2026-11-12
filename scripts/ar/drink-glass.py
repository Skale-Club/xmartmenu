"""
Puts a generated drink inside a real glass: image-to-3D tools (Rodin) return the
glass, ice, garnish and liquid as one opaque, frosted-looking shell. This draws a
clear highball glass (lathed: thick base, tapered wall, rounded lip) and fits the
generated model inside it as the contents, opaque, with the garnish standing above
the rim. Runs inside Blender on the open .blend (GUI through the Blender MCP), set
GLASS_JSON (or env GLASS) before exec:

  {"object": "model", "height": 0.15, "r_bottom": 0.036, "r_top": 0.0395,
   "wall": 0.0025, "base": 0.008, "rim": 0.145, "alpha": 0.14}

  height        glass height (m); r_bottom / r_top outer radius at the foot / lip
  wall, base    wall and base thickness; rim = the model's own rim height (where
                its garnish starts), which is placed just below the glass's lip
  alpha         glass opacity (glTF alpha blend; AR Quick Look and the WebXR viewer
                show transparency and highlights, not refraction)

Then export with scripts/ar/prepare-dish-model.py --from-blend.
"""
import json
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

G = json.loads(os.environ.get('GLASS') or GLASS_JSON)  # noqa: F821 (set by the caller in the GUI)
model = bpy.data.objects[G['object']]
H, rb, rt, wall, base = G['height'], G['r_bottom'], G['r_top'], G['wall'], G['base']


def outer_r(z):
    return rb + (rt - rb) * min(1.0, max(0.0, z / H))


# 1. The glass: one closed lathed profile (outside up, round lip, inside down, base).
lip = wall / 2
profile = [(0.0, 0.0), (rb - 0.002, 0.0)]
profile += [(rb - 0.002 + 0.002 * math.sin(a), 0.002 - 0.002 * math.cos(a)) for a in (math.radians(30), math.radians(60))]
profile += [(outer_r(z), z) for z in np.linspace(0.002, H - lip, 10)]
profile += [(outer_r(H) - lip + lip * math.cos(a), H - lip + lip * math.sin(a)) for a in np.radians([30, 60, 90, 120, 150])]
profile += [(outer_r(z) - wall, z) for z in np.linspace(H - lip, base + 0.003, 10)]
profile += [(outer_r(base) - wall - 0.003 * (1 - math.cos(a)), base + 0.003 - 0.003 * math.sin(a)) for a in np.radians([30, 60, 90])]
profile += [(0.0, base)]
mesh = bpy.data.meshes.new('glass')
bm = bmesh.new()
verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.radians(360), steps=96)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(mesh)
bm.free()
mesh.shade_smooth()
glass = bpy.data.objects.get('glass')
if glass:
    bpy.data.objects.remove(glass, do_unlink=True)
glass = bpy.data.objects.new('glass', mesh)
bpy.context.scene.collection.objects.link(glass)

material = bpy.data.materials.get('glass') or bpy.data.materials.new('glass')
material.use_nodes = True
shader = material.node_tree.nodes['Principled BSDF']
shader.inputs['Base Color'].default_value = (0.92, 0.96, 0.95, 1)
shader.inputs['Metallic'].default_value = 0.0
shader.inputs['Roughness'].default_value = 0.04
shader.inputs['Alpha'].default_value = G.get('alpha', 0.14)
material.surface_render_method = 'BLENDED'
material.use_backface_culling = False
mesh.materials.append(material)

# 2. The contents: the generated model, opaque again, squeezed inside the wall and
#    lifted onto the base, its rim just under the glass's lip.
for slot in model.material_slots:
    m = slot.material
    if m and m.use_nodes and 'Principled BSDF' in m.node_tree.nodes:
        m.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = 1.0
        m.surface_render_method = 'DITHERED'
co = np.empty(len(model.data.vertices) * 3, dtype=np.float64)
model.data.vertices.foreach_get('co', co)
co = co.reshape(-1, 3) @ np.array(model.matrix_world)[:3, :3].T + np.array(model.matrix_world)[:3, 3]
cx, cy, z0 = (co[:, 0].min() + co[:, 0].max()) / 2, (co[:, 1].min() + co[:, 1].max()) / 2, co[:, 2].min()
rim = G['rim']
radius = np.hypot(co[:, 0] - cx, co[:, 1] - cy)
below = (co[:, 2] - z0) < rim
z_scale = (H - lip - 0.003 - base) / rim
# Widest the contents may be at each height: the inside of the wall, minus 0.6 mm.
new_z = base + (co[:, 2] - z0) * z_scale
inner = np.array([outer_r(z) - wall - 0.0006 for z in np.clip(new_z, base, H)])
xy_scale = float(np.min(inner[below] / np.maximum(radius[below], 1e-6))) if below.any() else 1.0
co[:, 0] = (co[:, 0] - cx) * xy_scale
co[:, 1] = (co[:, 1] - cy) * xy_scale
co[:, 2] = new_z
model.matrix_world = Matrix.Identity(4)  # the world transform is baked into the vertices above
model.data.vertices.foreach_set('co', co.ravel().astype(np.float32))
model.data.update()
model.name = 'contents'

# 3. Ice and liquid read as frosted white plastic when opaque: the pale, grey parts
#    of the texture become translucent and slightly tinted (G['tint']), the coloured
#    garnish (mint, lime) stays opaque. Alpha goes in the texture (exported as PNG).
#    Re-grading the food rewrites this texture: run this script again afterwards.
tint = np.array(G.get('tint', [0.80, 0.92, 0.70]), dtype=np.float32)
for slot in model.material_slots:
    m = slot.material
    if not (m and m.use_nodes and 'Principled BSDF' in m.node_tree.nodes):
        continue
    shader = m.node_tree.nodes['Principled BSDF']
    node = next((l.from_node for l in shader.inputs['Base Color'].links if l.from_node.type == 'TEX_IMAGE'), None)
    if node is None:
        continue
    image = node.image
    w_, h_ = image.size
    px = np.empty(w_ * h_ * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3]
    luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    saturation = rgb.max(axis=1) - rgb.min(axis=1)
    icy = np.clip((luma - 0.45) / 0.35, 0, 1) * (1 - np.clip(saturation * 5, 0, 1))
    px[:, :3] = rgb * (1 - 0.35 * icy[:, None]) + tint * (0.35 * icy[:, None])
    px[:, 3] = 1 - G.get('ice_clear', 0.6) * icy
    image.alpha_mode = 'STRAIGHT'
    image.pixels.foreach_set(px.ravel())
    image.pack()
    for link in list(shader.inputs['Alpha'].links):
        m.node_tree.links.remove(link)
    m.node_tree.links.new(node.outputs['Alpha'], shader.inputs['Alpha'])
    m.surface_render_method = 'BLENDED'
    m.use_backface_culling = False

print('GLASS ' + json.dumps({'xy_scale': round(xy_scale, 3), 'z_scale': round(z_scale, 3),
                             'top_cm': round(float(new_z.max()) * 100, 1)}))
