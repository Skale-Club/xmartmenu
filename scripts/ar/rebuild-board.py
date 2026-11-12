"""
Replaces a scanned serving board that has ragged sides with a clean modelled
board of the same outline, keeping the scan's wood texture (baked onto the new
board) and the food on top. Runs inside Blender on the open .blend (GUI through
the Blender MCP, or `blender -b dish.blend --python rebuild-board.py`).

Parameters come from the environment variable BOARD (JSON), in metres:
  {"object": "model_tex_u1_v1_0", "top": 0.0115, "x": [-0.176, 0.161], "y": [-0.134, 0.132],
   "corner": 0.035, "hole": [-0.131, 0.0, 0.010], "bevel": 0.002}
  top     board top height (the scan's flat wood surface; the bottom is z = 0)
  x, y    the board's clean extent; corner = corner radius; hole = [x, y, radius] or null
  patches [[x, y, radius, dx, dy], ...]: top areas covered with wood cloned from
          (x + dx, y + dy), e.g. where the scan had a hole that the new board drops
  plain_zones [[x_min, x_max, y_min, y_max], ...]: edge stretches cloned straight
          inwards only (use where the edge shows patchwork)
  lifts   [[x, y, radius], ...]: top areas whose soft dark shading is lifted to the
          surrounding wood's brightness, grain kept (e.g. the shadow round a hole)

Steps: copy the scan as the bake source; delete the scan's faces lying entirely
at or below the board top (+ 2.5 mm), which leaves the food; draw the board as a
2D curve with the hole, extrude and bevel it, convert to mesh and UV-unwrap it;
bake the scan's diffuse colour onto it (Cycles, selected to active); fill pixels
the bake missed with the board's average wood colour; drop the bake source.
Afterwards export with scripts/ar/prepare-dish-model.py --from-blend.
"""
import json
import math
import os

import bmesh
import bpy
import numpy as np

P = json.loads(os.environ.get('BOARD') or BOARD_JSON)  # noqa: F821 (BOARD_JSON is set by the caller in the GUI)
scan = bpy.data.objects[P['object']]
top, (x0, x1), (y0, y1), corner, bevel = P['top'], P['x'], P['y'], P['corner'], P.get('bevel', 0.002)

# 1. Bake source: an untouched copy of the scan.
source = scan.copy()
source.data = scan.data.copy()
source.name = 'board-bake-source'
bpy.context.scene.collection.objects.link(source)

# 2. Keep only the food in the scan object.
bm = bmesh.new()
bm.from_mesh(scan.data)
matrix = scan.matrix_world
limit = top + 0.0025
board_faces = [f for f in bm.faces if all((matrix @ v.co).z <= limit for v in f.verts)]
bmesh.ops.delete(bm, geom=board_faces, context='FACES')
loose = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=loose, context='VERTS')
bm.to_mesh(scan.data)
bm.free()
scan.name = 'food'

# 3. The new board: rounded rectangle with a hole, extruded and bevelled.
def rounded_rect(steps=12):
    points = []
    for cx, cy, start in ((x1 - corner, y1 - corner, 0), (x0 + corner, y1 - corner, 90),
                          (x0 + corner, y0 + corner, 180), (x1 - corner, y0 + corner, 270)):
        for i in range(steps + 1):
            a = math.radians(start + 90 * i / steps)
            points.append((cx + corner * math.cos(a), cy + corner * math.sin(a)))
    return points

curve = bpy.data.curves.new('board', 'CURVE')
curve.dimensions = '2D'
curve.fill_mode = 'BOTH'
curve.extrude = top / 2 - bevel
curve.bevel_depth = bevel
curve.bevel_resolution = 3
loops = [rounded_rect()]
if P.get('hole'):
    hx, hy, hr = P['hole']
    loops.append([(hx + hr * math.cos(2 * math.pi * i / 40), hy + hr * math.sin(2 * math.pi * i / 40)) for i in range(40)])
for loop in loops:
    spline = curve.splines.new('POLY')
    spline.points.add(len(loop) - 1)
    for point, (x, y) in zip(spline.points, loop):
        point.co = (x, y, 0, 1)
    spline.use_cyclic_u = True
board = bpy.data.objects.new('board', curve)
board.location.z = top / 2
bpy.context.scene.collection.objects.link(board)
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = board
board.select_set(True)
bpy.ops.object.convert(target='MESH')
board = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')
board.data.shade_smooth()

# 4. Bake the scan's wood colour onto the board. Photogrammetry scans often come
#    unlit (glTF KHR_materials_unlit -> an Emission shader): then bake the
#    emission and give the board the same unlit setup, so board and food match.
image = bpy.data.images.new('board_basecolor', 2048, 2048, alpha=False)
scan_material = source.material_slots[0].material if source.material_slots else None
unlit = bool(scan_material and scan_material.use_nodes
             and not any(n.type == 'BSDF_PRINCIPLED' for n in scan_material.node_tree.nodes)
             and any(n.type == 'EMISSION' for n in scan_material.node_tree.nodes))
bake_material = bpy.data.materials.new('board-bake')
bake_material.use_nodes = True
texture = bake_material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
bake_material.node_tree.nodes.active = texture  # the bake target; not linked (no circular dependency)
board.data.materials.append(bake_material)

scene = bpy.context.scene
engine = scene.render.engine
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.004
scene.render.bake.max_ray_distance = 0.012
scene.render.bake.margin = 8
bpy.ops.object.select_all(action='DESELECT')
source.select_set(True)
board.select_set(True)
bpy.context.view_layer.objects.active = board
if unlit:
    bpy.ops.object.bake(type='EMIT')
else:
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'})
scene.render.engine = engine

# 5. Pixels the bake missed (black) take the average wood colour, with a little grain.
pixels = np.empty(2048 * 2048 * 4, dtype=np.float32)
image.pixels.foreach_get(pixels)
rgba = pixels.reshape(-1, 4)
hit = rgba[:, :3].sum(axis=1) > 0.03
average = rgba[hit, :3].mean(axis=0)
noise = (np.random.default_rng(3).random((int((~hit).sum()), 1)) - 0.5) * 0.06
rgba[~hit, :3] = np.clip(average + noise, 0, 1)
image.pixels.foreach_set(rgba.ravel())


# 5b. Clean the top: the scan's surface darkens towards its ragged edge, and a
#     removed handle hole leaves a dark disc. Both are covered by wood cloned from
#     a clean part of the top, with a soft edge. Needs the top's UV <-> world map,
#     which is affine (the top is one flat island). This is the version the owner
#     approved on 2026-11-12 (lifting the edge shadow instead changed the colour).
def clean_top(image, edge=0.012, shift=0.035, patches=()):
    top_loops = [(board.data.vertices[board.data.loops[i].vertex_index].co, board.data.uv_layers.active.data[i].uv)
                 for p in board.data.polygons if p.normal.z > 0.9 for i in p.loop_indices]
    world = np.array([[co.x, co.y, 1.0] for co, _ in top_loops])
    uvs = np.array([[uv.x, uv.y] for _, uv in top_loops])
    to_uv, *_ = np.linalg.lstsq(world, uvs, rcond=None)              # [x y 1] @ to_uv = [u v]
    to_world = np.linalg.inv(np.vstack([to_uv.T, [0, 0, 1]]))          # [u v 1] -> [x y 1]
    size = image.size[0]
    px = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    vv, uu = np.mgrid[0:size, 0:size]
    uvh = np.stack([(uu + 0.5) / size, (vv + 0.5) / size, np.ones_like(uu, dtype=float)], axis=-1)
    xy = uvh @ to_world.T
    x, y = xy[..., 0], xy[..., 1]
    cx, cy, hx, hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    qx, qy = np.abs(x - cx) - (hx - corner), np.abs(y - cy) - (hy - corner)
    sdf = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - corner  # < 0 inside
    # Scans are usually rounder at the corners than the new board, so their dark edge
    # reaches further in there: measure the edge band against a rounder outline too.
    round_corner = corner + 0.03
    rx, ry = np.abs(x - cx) - (hx - round_corner), np.abs(y - cy) - (hy - round_corner)
    sdf_round = np.hypot(np.maximum(rx, 0), np.maximum(ry, 0)) + np.minimum(np.maximum(rx, ry), 0) - round_corner
    weight = np.clip((np.maximum(sdf, sdf_round) + edge + 0.006) / 0.006, 0, 1)  # 1 within `edge` of the outline
    toward = np.stack([cx - x, cy - y], axis=-1)
    toward /= np.maximum(np.linalg.norm(toward, axis=-1, keepdims=True), 1e-6)
    # Clone from clean wood: `shift` inwards, else slid along the edge, else further in.
    # Never from a hole, a lifted area or under the food (the bake there shows the
    # hole's shadow or the food), which would print a dark copy near the edge.
    avoid = ([tuple(P['hole'])] if P.get('hole') else []) + [tuple(l) for l in lifts]
    food_xy = np.array([(scan.matrix_world @ v.co).to_2d()[:] for v in scan.data.vertices
                        if (scan.matrix_world @ v.co).z > top + 0.002])
    cell = 0.004
    fx0, fy0 = food_xy.min(axis=0) - cell
    nfx, nfy = (np.ptp(food_xy, axis=0) / cell).astype(int) + 4
    under = np.zeros((nfy, nfx), bool)
    under[((food_xy[:, 1] - fy0) / cell).astype(int), ((food_xy[:, 0] - fx0) / cell).astype(int)] = True
    grown = under.copy()
    for dy in (-2, -1, 0, 1, 2):
        for dx in (-2, -1, 0, 1, 2):
            grown |= np.roll(np.roll(under, dy, 0), dx, 1)

    def bad_at(qx, qy):
        bad = np.zeros_like(qx, dtype=bool)
        for ax, ay, ar in avoid:
            bad |= np.hypot(qx - ax, qy - ay) < ar + 0.008
        gx, gy = ((qx - fx0) / cell).astype(int), ((qy - fy0) / cell).astype(int)
        inside = (gx >= 0) & (gx < nfx) & (gy >= 0) & (gy < nfy)
        bad[inside] |= grown[gy[inside], gx[inside]]
        return bad

    tangent = np.stack([-toward[..., 1], toward[..., 0]], axis=-1)
    sx, sy = x + toward[..., 0] * shift, y + toward[..., 1] * shift
    bad = bad_at(sx, sy) & (weight > 0)
    for inward, along in ((1, 0.04), (1, -0.04), (1, 0.08), (1, -0.08), (2, 0.04), (2, -0.04), (3, 0)):
        if not bad.any():
            break
        qx = x + toward[..., 0] * shift * inward + tangent[..., 0] * along
        qy = y + toward[..., 1] * shift * inward + tangent[..., 1] * along
        fixed = bad & ~bad_at(qx, qy) & (np.abs(qx - cx) < hx - edge) & (np.abs(qy - cy) < hy - edge)
        sx, sy = np.where(fixed, qx, sx), np.where(fixed, qy, sy)
        bad &= ~fixed
    # Plain zones [x_min, x_max, y_min, y_max]: there the edge always clones from the
    # plain inward source, never slid (crumbs near an edge made the slides patchy).
    # An optional 5th value widens the cleaned band there (e.g. to cover crumbs the
    # scan has right at the band's inner border).
    for zone_spec in P.get('plain_zones', []):
        zx0, zx1, zy0, zy1 = zone_spec[:4]
        zone = (x >= zx0) & (x <= zx1) & (y >= zy0) & (y <= zy1)
        sx = np.where(zone, x + toward[..., 0] * shift, sx)
        sy = np.where(zone, y + toward[..., 1] * shift, sy)
        if len(zone_spec) > 4:
            wide = np.clip((np.maximum(sdf, sdf_round) + zone_spec[4] + 0.006) / 0.006, 0, 1)
            fade = np.clip(np.minimum(x - zx0, zx1 - x) / 0.012, 0, 1)  # no step at the zone's ends
            weight = np.where(zone, np.maximum(weight, wide * fade), weight)
    for px_, py_, pr, dx, dy in patches:                                # [x, y, radius, from dx, from dy]
        d = np.hypot(x - px_, y - py_)
        w = np.clip((pr - d) / 0.008, 0, 1)  # 8 mm feather: no visible patch outline
        sx = np.where(w > weight, x + dx, sx)
        sy = np.where(w > weight, y + dy, sy)
        weight = np.maximum(weight, w)
    src = np.stack([sx, sy, np.ones_like(sx)], axis=-1) @ to_uv
    su = np.clip((src[..., 0] * size).astype(int), 0, size - 1)
    sv = np.clip((src[..., 1] * size).astype(int), 0, size - 1)
    cloned = px[sv, su]
    px[..., :3] = px[..., :3] * (1 - weight[..., None]) + cloned[..., :3] * weight[..., None]
    # Touch-ups [x, y, radius, dx, dy]: like patches, but cloned from the already
    # cleaned top, e.g. a crumb left at the edge band's border, covered with the edge
    # wood next to it along the grain.
    for tx, ty, tr, dx, dy in P.get('touchups', []):
        w = np.clip((tr - np.hypot(x - tx, y - ty)) / 0.008, 0, 1)
        src = np.stack([x + dx, y + dy, np.ones_like(x)], axis=-1) @ to_uv
        su = np.clip((src[..., 0] * size).astype(int), 0, size - 1)
        sv = np.clip((src[..., 1] * size).astype(int), 0, size - 1)
        px[..., :3] = px[..., :3] * (1 - w[..., None]) + px[sv, su, :3] * w[..., None]
    image.pixels.foreach_set(px.ravel())


def box_blur_2d(channels, radius):
    size = 2 * radius + 1
    for axis in (0, 1):
        pad = [(0, 0)] * channels.ndim
        pad[axis] = (radius + 1, radius)
        summed = np.cumsum(np.pad(channels, pad, mode='edge'), axis=axis, dtype=np.float64)
        n = summed.shape[axis]
        channels = ((np.take(summed, range(size, n), axis=axis) - np.take(summed, range(0, n - size), axis=axis)) / size).astype(np.float32)
    return channels


lifts = [tuple(p) for p in P.get('lifts', [])]
clean_top(image, patches=[tuple(p) for p in P.get('patches', [])])
image.pack()

if unlit:  # same unlit node setup as the scan, with the baked image
    material = scan_material.copy()
    material.name = 'board-wood'
    for node in material.node_tree.nodes:
        if node.type == 'TEX_IMAGE':
            node.image = image
else:
    material = bpy.data.materials.new('board-wood')
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = 0.7
    shader.inputs['Metallic'].default_value = 0.0
    node = material.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    material.node_tree.links.new(node.outputs['Color'], shader.inputs['Base Color'])
board.data.materials[0] = material
bpy.data.materials.remove(bake_material)

bpy.data.objects.remove(source, do_unlink=True)
for obj in bpy.data.objects:
    obj.select_set(False)

# 6. Even wood grain on the sides and underside (the bake there is patchy).
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals()
                       else r'C:\Users\Vanildo\Dev\xmartmenu\scripts\ar', 'board-sides.py')).read())
result = {'food_faces': len(scan.data.polygons), 'board_faces': len(board.data.polygons),
          'missed_pixels_pct': round(float((~hit).mean()) * 100, 1)}
print('BOARD ' + json.dumps(result))
