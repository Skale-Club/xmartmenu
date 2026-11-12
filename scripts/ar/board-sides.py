"""
Gives a rebuilt board's sides and underside one even wood-grain texture, coloured
from its top, instead of the patchy bake the scan's ragged sides leave there.
Runs inside Blender on the open .blend, after scripts/ar/rebuild-board.py (which
calls it at the end); the board object must be named 'board'.

Faces whose normal is not mostly up (sides, the lower bevel, the underside) get
a second material: a copy of the board's own material (lit or unlit alike) with a
generated grain image. Their UVs run along the edge (u) and across the thickness
(v), so the grain follows the board's length like real edge grain.
"""
import math

import bpy
import numpy as np

board = bpy.data.objects['board']
mesh = board.data
top_material = mesh.materials[0]
top_image = next(n.image for n in top_material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)

uv_layer = mesh.uv_layers.active.data
width, height = top_image.size
pixels = np.empty(width * height * 4, dtype=np.float32)
top_image.pixels.foreach_get(pixels)
pixels = pixels.reshape(height, width, 4)

# Wood colour of the top: sample the baked image at the top faces' UVs.
samples = []
for polygon in mesh.polygons:
    if polygon.normal.z > 0.9:
        for index in polygon.loop_indices:
            u, v = uv_layer[index].uv
            samples.append(pixels[min(height - 1, int(v * height)), min(width - 1, int(u * width)), :3])
samples = np.array(samples)
base = np.median(samples, axis=0)
spread = np.clip(samples.std(axis=0), 0.01, 0.08)

# Grain image: fine lines along u (the board's length), slow variation, a little noise.
size = 1024
rng = np.random.default_rng(11)
v = np.linspace(0, 1, size)[:, None]
u = np.linspace(0, 1, size)[None, :]
wobble = 0.015 * np.sin(u * math.tau * 3 + rng.random() * 6) + 0.01 * np.sin(u * math.tau * 11)
grain = (0.55 * np.sin((v + wobble) * math.tau * 9) + 0.30 * np.sin((v + wobble * 1.7) * math.tau * 23)
         + 0.15 * np.sin((v + wobble * 0.5) * math.tau * 51))
grain = grain + 0.25 * (rng.random((size, size)) - 0.5)
tone = 1 + (grain / 1.6) * (spread.mean() / max(base.mean(), 1e-3)) * 1.5
tone = tone * (1 - 0.06)  # sides sit a little darker than the top
rgb = np.clip(base[None, None, :] * tone[..., None], 0, 1)
image = bpy.data.images.get('board_side') or bpy.data.images.new('board_side', size, size, alpha=False)
image.scale(size, size)
image.pixels.foreach_set(np.dstack([rgb, np.ones((size, size))]).astype(np.float32).ravel())
image.pack()

side_material = bpy.data.materials.get('board-side') or top_material.copy()
side_material.name = 'board-side'
for node in side_material.node_tree.nodes:
    if node.type == 'TEX_IMAGE':
        node.image = image
if 'board-side' not in [m.name for m in mesh.materials if m]:
    mesh.materials.append(side_material)
side_index = [m.name for m in mesh.materials].index('board-side')

# UVs for the side faces: u along the edge (angle around the centre), v across the thickness.
xs = [vert.co.x for vert in mesh.vertices]
ys = [vert.co.y for vert in mesh.vertices]
zs = [vert.co.z for vert in mesh.vertices]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
span_x, span_y, thickness = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
perimeter = 2 * (span_x + span_y)
for polygon in mesh.polygons:
    if polygon.normal.z > 0.9:
        continue
    polygon.material_index = side_index
    underside = polygon.normal.z < -0.9
    angles = []
    for index in polygon.loop_indices:
        co = mesh.vertices[mesh.loops[index].vertex_index].co
        angles.append(math.atan2(co.y - cy, co.x - cx))
    if max(angles) - min(angles) > math.pi:  # a face across the -pi/pi seam
        angles = [a + math.tau if a < 0 else a for a in angles]
    for index, angle in zip(polygon.loop_indices, angles):
        co = mesh.vertices[mesh.loops[index].vertex_index].co
        if underside:
            uv_layer[index].uv = ((co.x - cx) / span_x * 3, (co.y - cy) / span_y * 3)
        else:
            uv_layer[index].uv = (angle / math.tau * perimeter / 0.12, (co.z - min(zs)) / thickness * 0.35)
mesh.update()
print('BOARD-SIDES', [round(float(c), 3) for c in base])
