"""
Builds a drink for AR from scratch in Blender (image-to-3D tools fuse glass, ice
and garnish into one frosted lump). Separate parts, each with its own material:
a clear lathed glass, the liquid, translucent ice cubes, real lime wedges (an
eighth of an ellipsoidal lime: textured rind with pores, white pith, flesh with
segments on the cut faces) and mint (a sprig on a stem rising out of the drink,
leaves in crossed pairs, veined texture; plus muddled leaves inside). Every part
is checked to sit inside the glass (and loose leaves inside the liquid) before it
is kept. Dimensions in metres; origin = the glass's bottom centre, Z up. Runs
inside Blender (GUI through the Blender MCP, or headless); set DRINK_JSON (or
env DRINK) on an empty scene before exec:

  {"glass": {"height": 0.15, "r_bottom": 0.036, "r_top": 0.0395, "wall": 0.0025, "base": 0.008, "alpha": 0.12},
   "liquid": {"level": 0.128, "color": [0.84, 0.92, 0.62], "alpha": 0.16},
   "ice": {"count": 12, "size": 0.022, "alpha": 0.26},
   "lime": {"wedges": 2}, "mint": {"inside": 8, "sprig_height": 0.05}, "seed": 4}

Look at the menu photo for proportions and colours, then save the scene and export
with scripts/ar/prepare-dish-model.py --from-blend.
"""
import json
import math
import os
import random

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

D = json.loads(os.environ.get('DRINK') or DRINK_JSON)  # noqa: F821 (set by the caller in the GUI)
rng = random.Random(D.get('seed', 4))
nrng = np.random.default_rng(D.get('seed', 4))
G = D['glass']
H, RB, RT, WALL, BASE = G['height'], G['r_bottom'], G['r_top'], G['wall'], G['base']
LEVEL = D['liquid']['level']
collection = bpy.context.scene.collection


def outer_r(z):
    return RB + (RT - RB) * min(1.0, max(0.0, z / H))


def inner_r(z):
    return outer_r(z) - WALL


# --- helpers -----------------------------------------------------------------------
def material(name, colour, roughness=0.5, alpha=1.0, image=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    s = nodes['Principled BSDF']
    s.inputs['Base Color'].default_value = (*colour, 1)
    s.inputs['Roughness'].default_value = roughness
    s.inputs['Metallic'].default_value = 0.0
    s.inputs['Alpha'].default_value = alpha
    if image is not None:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        m.node_tree.links.new(tex.outputs['Color'], s.inputs['Base Color'])
    if alpha < 1:
        m.surface_render_method = 'BLENDED'
        m.use_backface_culling = False
    return m


def make_image(name, rgb, alpha=None, data=False):
    """(h x w x 3) -> packed image: linear colour converted to sRGB, or raw data
    (normal/roughness maps, data=True). Optional alpha (h x w)."""
    h, w = rgb.shape[:2]
    if data:
        values = np.clip(rgb, 0, 1)
    else:
        values = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, 1), 1 / 2.4) - 0.055)
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    if data:
        img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.dstack([values, np.ones((h, w)) if alpha is None else alpha]).astype(np.float32).ravel())
    img.pack()
    return img


def normal_from_height(height, strength):
    """Tangent-space normal map (0..1 RGB) from a height field."""
    dy, dx = np.gradient(height)
    n = np.dstack([-dx * strength, -dy * strength, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def add_maps(m, normal=None, normal_strength=1.0, roughness=None, alpha_from_base=False):
    """Hooks a normal map, a roughness map and/or the base texture's alpha into a material."""
    nodes, links = m.node_tree.nodes, m.node_tree.links
    s = nodes['Principled BSDF']
    if normal is not None:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = normal
        nmap = nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = normal_strength
        links.new(tex.outputs['Color'], nmap.inputs['Color'])
        links.new(nmap.outputs['Normal'], s.inputs['Normal'])
    if roughness is not None:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = roughness
        links.new(tex.outputs['Color'], s.inputs['Roughness'])
    if alpha_from_base:
        base = next(l.from_node for l in s.inputs['Base Color'].links)
        links.new(base.outputs['Alpha'], s.inputs['Alpha'])
        m.surface_render_method = 'BLENDED'
        m.use_backface_culling = False


def noise(h, w, cells_y, cells_x):
    grid = nrng.random((cells_y + 1, cells_x + 1))
    ys, xs = np.linspace(0, cells_y, h), np.linspace(0, cells_x, w)
    rows = np.array([np.interp(xs, np.arange(cells_x + 1), row) for row in grid])
    return np.array([np.interp(ys, np.arange(cells_y + 1), col) for col in rows.T]).T


def lathe(name, profile, steps=96):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0.0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.radians(360), steps=steps)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()
    return mesh


def add(name, mesh, mats):
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    for m in (mats if isinstance(mats, list) else [mats]):
        mesh.materials.append(m)
    return obj


def join(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = name
    objects[0].data.name = name
    return objects[0]


def fits(obj, z_max, margin=0.0008, z_min=None):
    """True when every vertex is inside the glass's inner wall, above the base and below z_max."""
    m = obj.matrix_world
    for v in obj.data.vertices:
        p = m @ v.co
        if p.z < (BASE + 0.0005 if z_min is None else z_min) or p.z > z_max:
            return False
        if math.hypot(p.x, p.y) > inner_r(p.z) - margin:
            return False
    return True


# --- glass: thick base, tapered wall, rounded lip -------------------------------------
lip = WALL / 2
p = [(0.0, 0.0), (RB - 0.002, 0.0)]
p += [(RB - 0.002 + 0.002 * math.sin(a), 0.002 - 0.002 * math.cos(a)) for a in np.radians([30, 60])]
p += [(outer_r(z), z) for z in np.linspace(0.002, H - lip, 10)]
p += [(outer_r(H) - lip + lip * math.cos(a), H - lip + lip * math.sin(a)) for a in np.radians([30, 60, 90, 120, 150])]
p += [(inner_r(z), z) for z in np.linspace(H - lip, BASE + 0.003, 10)]
p += [(inner_r(BASE) - 0.003 * (1 - math.cos(a)), BASE + 0.003 - 0.003 * math.sin(a)) for a in np.radians([30, 60, 90])]
p += [(0.0, BASE)]
glass = add('glass', lathe('glass', p), [])
# Cylindrical UVs: u round the glass, v up it.
uv_layer = glass.data.uv_layers.new(name='UVMap')
for poly in glass.data.polygons:
    us = []
    for li in poly.loop_indices:
        co = glass.data.vertices[glass.data.loops[li].vertex_index].co
        us.append(math.atan2(co.y, co.x) / math.tau % 1.0)
    if max(us) - min(us) > 0.5:  # face across the seam
        us = [u + 1 if u < 0.5 else u for u in us]
    for li, u in zip(poly.loop_indices, us):
        co = glass.data.vertices[glass.data.loops[li].vertex_index].co
        uv_layer.data[li].uv = (u, co.z / H)

# Condensation where the cold drink is: a light fog with droplets (clear, glossy,
# domed) and a few running drips; clear glass above the drink.
CW, CH = 2048, 1024
height_map = np.zeros((CH, CW))
fog = np.zeros((CH, CW))
cold_top = int(CH * (LEVEL + 0.004) / H)
fog[:cold_top] = 1.0
fog[cold_top - 12:cold_top] *= np.linspace(1, 0, 12)[:, None]
for _ in range(G.get('droplets', 2600)):
    r_px = nrng.uniform(2.5, 11) if nrng.random() < 0.85 else nrng.uniform(11, 18)
    cx_, cy_ = nrng.uniform(0, CW), nrng.uniform(0, cold_top - 4)
    stretch = 1.0 if nrng.random() < 0.93 else nrng.uniform(2.5, 6)  # a few drips running down
    x0_, x1_ = int(max(0, cx_ - r_px)), int(min(CW, cx_ + r_px + 1))
    y0_, y1_ = int(max(0, cy_ - r_px * stretch)), int(min(CH, cy_ + r_px + 1))
    if x1_ <= x0_ or y1_ <= y0_:
        continue
    yy_, xx_ = np.mgrid[y0_:y1_, x0_:x1_]
    dist = np.hypot((xx_ - cx_) / r_px, np.where(yy_ < cy_, (yy_ - cy_) / (r_px * stretch), (yy_ - cy_) / r_px))
    dome = np.sqrt(np.clip(1 - dist ** 2, 0, 1))
    height_map[y0_:y1_, x0_:x1_] = np.maximum(height_map[y0_:y1_, x0_:x1_], dome * r_px * 0.5)
    fog[y0_:y1_, x0_:x1_] *= np.clip(dist * 1.3, 0, 1)  # droplets clear the fog round them
glass_rgb = np.dstack([np.full((CH, CW), 0.93), np.full((CH, CW), 0.97), np.full((CH, CW), 0.96)])
glass_alpha = G.get('alpha', 0.12) + G.get('fog', 0.06) * fog + 0.06 * (height_map > 0)  # light fog: the drink shows
glass_rough = 0.03 + 0.15 * fog
glass_mat = material('glass', (1, 1, 1), roughness=0.03, alpha=0.5,
                     image=make_image('glass_color', glass_rgb, alpha=np.clip(glass_alpha, 0, 1)))
add_maps(glass_mat, normal=make_image('glass_normal', normal_from_height(height_map, 0.35), data=True), normal_strength=1.0,
         roughness=make_image('glass_rough', np.dstack([glass_rough] * 3), data=True), alpha_from_base=True)
glass.data.materials.append(glass_mat)

# --- liquid -----------------------------------------------------------------------------
L = D['liquid']
gap = 0.0004
p = [(0.0, BASE + gap), (inner_r(BASE) - 0.003, BASE + gap)]
p += [(inner_r(z) - gap, z) for z in np.linspace(BASE + 0.003, LEVEL, 8)]
p += [(0.0, LEVEL)]
add('liquid', lathe('liquid', p, steps=64), material('liquid', tuple(L['color']), roughness=0.02, alpha=L.get('alpha', 0.10)))

# Soda bubbles: tiny spheres in the drink, more of them near the glass and the ice.
bubble_mat = material('bubbles', (0.95, 0.98, 0.95), roughness=0.0, alpha=0.45)
bubbles = []
for i in range(L.get('bubbles', 140)):
    zb = BASE + 0.004 + (LEVEL - BASE - 0.006) * nrng.random()
    a = nrng.uniform(0, math.tau)
    rr = (inner_r(zb) - 0.0015) * (0.82 + 0.18 * nrng.random() if nrng.random() < 0.7 else nrng.random())
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=nrng.uniform(0.0004, 0.0012))
    mesh = bpy.data.meshes.new(f'bubble{i}')
    bm.to_mesh(mesh)
    bm.free()
    b = add(f'bubble{i}', mesh, bubble_mat)
    b.location = (math.cos(a) * rr, math.sin(a) * rr, zb)
    bubbles.append(b)
join('bubbles', bubbles)

# --- ice: bevelled cubes, each checked to fit inside the glass ----------------------------
I = D['ice']
ice_mat = material('ice', (0.92, 0.97, 0.99), roughness=0.04, alpha=I.get('alpha', 0.22))
cubes, size, z, i = [], I['size'], BASE + I['size'] * 0.6, 0
layer = 0
while i < I['count'] and z < LEVEL + size * 0.3:
    base_angle = rng.uniform(0, math.tau) + layer * 0.9
    layer += 1
    for k in range(3):  # three cubes per layer, 120 degrees apart, out towards the glass
        if i >= I['count']:
            break
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=size * rng.uniform(0.85, 1.0))
        bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=size * 0.14, segments=3, affect='EDGES')
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
        for vert in bm.verts:  # melted, irregular cube: no perfect faces or edges
            vert.co *= 1 + nrng.uniform(-0.05, 0.05)
            vert.co += Vector(nrng.normal(0, size * 0.012, 3))
        mesh = bpy.data.meshes.new(f'ice{i}')
        bm.to_mesh(mesh)
        bm.free()
        mesh.shade_smooth()
        cube = add(f'ice{i}', mesh, ice_mat)
        for attempt in range(40):
            angle = base_angle + math.tau / 3 * k + rng.uniform(-0.35, 0.35)
            rr = (inner_r(z) - size * 0.75) * rng.uniform(0.75, 1.0) * (1 - attempt / 60)
            cube.matrix_world = Matrix.Translation((math.cos(angle) * rr, math.sin(angle) * rr, z)) @ Euler(
                (rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(0, math.pi))).to_matrix().to_4x4()
            bpy.context.view_layer.update()
            if fits(cube, H - 0.006):
                break
        cubes.append(cube)
        i += 1
    z += size * 0.95
join('ice', cubes)

# --- lime wedges ----------------------------------------------------------------------------
LA, LR, SECTOR = 0.028, 0.022, math.radians(60)  # half length, radius, wedge angle (an eighth-ish)

# Rind texture (u along the lime, v round it): green with pores and a lighter blush.
h_, w_ = 256, 512
rind_rgb = np.array([0.10, 0.30, 0.03]) * (0.8 + 0.4 * noise(h_, w_, 6, 12))[..., None]
pores = nrng.random((h_, w_))
rind_rgb[pores > 0.985] *= 0.55
rind_rgb[pores < 0.012] *= 1.35
rind_img = make_image('lime_rind', np.clip(rind_rgb, 0, 1))
# Flesh texture of the cut face (u along the lime, v from the axis to the rind):
# white core, juicy flesh with radial vesicles and membranes, white pith, green rind.
h_, w_ = 256, 256
v = np.linspace(0, 1, h_)[:, None] * np.ones((1, w_))
u = np.ones((h_, 1)) * np.linspace(0, 1, w_)[None, :]
streaks = 0.75 + 0.25 * noise(h_, w_, 40, 6) + 0.12 * np.sin(u * math.tau * 9 + noise(h_, w_, 4, 4) * 3)
flesh_rgb = np.array([0.62, 0.74, 0.20]) * streaks[..., None]
flesh_rgb[np.abs(np.sin(u * math.pi * 7 + v * 0.8)) < 0.06] = [0.80, 0.84, 0.60]  # segment membranes
flesh_rgb[v < 0.08] = [0.85, 0.87, 0.70]                                           # core
pith = (v > 0.86) & (v < 0.93)
flesh_rgb[pith] = [0.86, 0.88, 0.72]
flesh_rgb[v >= 0.93] = [0.12, 0.32, 0.04]
flesh_img = make_image('lime_flesh', np.clip(flesh_rgb, 0, 1))
rind_mat = material('lime-rind', (1, 1, 1), roughness=0.35, image=rind_img)
flesh_mat = material('lime-flesh', (1, 1, 1), roughness=0.12, image=flesh_img)  # wet, juicy
rind_height = 0.6 * noise(256, 512, 30, 60) - 1.0 * (pores > 0.975) - 0.5 * (pores < 0.02)
add_maps(rind_mat, normal=make_image('lime_rind_normal', normal_from_height(rind_height, 1.2), data=True), normal_strength=0.8)
flesh_height = streaks * 2 - 1.5 * (np.abs(np.sin(u * math.pi * 7 + v * 0.8)) < 0.06)
add_maps(flesh_mat, normal=make_image('lime_flesh_normal', normal_from_height(flesh_height, 2.0), data=True), normal_strength=0.8)


def lime_wedge(name):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    nx, nphi = 18, 8
    xs = np.linspace(-LA, LA, nx)
    radius = lambda x: LR * math.sqrt(max(0.0, 1 - (x / LA) ** 2)) ** 0.9
    surf = [[bm.verts.new((x, radius(x) * math.cos(f), radius(x) * math.sin(f))) for f in np.linspace(0, SECTOR, nphi)]
            for x in xs]
    axis = [bm.verts.new((x, 0, 0)) for x in xs]
    faces = []
    for a in range(nx - 1):  # rind
        for b in range(nphi - 1):
            f = bm.faces.new((surf[a][b], surf[a + 1][b], surf[a + 1][b + 1], surf[a][b + 1]))
            f.material_index = 0
            for loop in f.loops:
                co = loop.vert.co
                loop[uv].uv = ((co.x + LA) / (2 * LA), math.atan2(co.z, co.y) / SECTOR)
    for edge_index in (0, nphi - 1):  # the two cut faces, from the axis to the rind
        for a in range(nx - 1):
            quad = (axis[a], axis[a + 1], surf[a + 1][edge_index], surf[a][edge_index])
            f = bm.faces.new(quad if edge_index else quad[::-1])
            f.material_index = 1
            for loop in f.loops:
                co = loop.vert.co
                r_here = radius(co.x)
                loop[uv].uv = ((co.x + LA) / (2 * LA), math.hypot(co.y, co.z) / r_here if r_here > 1e-6 else 0)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()
    return add(name, mesh, [rind_mat, flesh_mat])


wedges = []
for i in range(D['lime']['wedges']):
    wedge = lime_wedge(f'lime{i}')
    a0 = math.tau * i / D['lime']['wedges'] + rng.uniform(-0.3, 0.3)
    zc = BASE + 0.03 + (LEVEL - BASE - 0.06) * (i + 0.5) / D['lime']['wedges']
    placed = False
    for attempt in range(200):
        # Long axis near vertical, rind against the glass, a cut face showing through it.
        a = a0 + rng.uniform(-0.25, 0.25)
        tilt = math.radians(rng.uniform(55, 80))
        rr = inner_r(zc) - 0.0012 - LR * rng.uniform(0.75, 1.0)
        wedge.matrix_world = Matrix.Translation((math.cos(a) * rr, math.sin(a) * rr, zc)) @ Matrix.Rotation(
            a, 4, 'Z') @ Matrix.Rotation(-tilt, 4, 'Y') @ Matrix.Rotation(-SECTOR / 2, 4, 'X')
        bpy.context.view_layer.update()
        if fits(wedge, LEVEL - 0.003):
            placed = True
            break
        zc += rng.uniform(-0.004, 0.004)
        zc = min(max(zc, BASE + 0.03), LEVEL - 0.03)
    if not placed:
        print('LIME not placed', i)
    wedges.append(wedge)
join('lime', wedges)

# --- mint ------------------------------------------------------------------------------------
# Leaf texture (u across, v along): green, lighter midrib and lateral veins, darker edge.
h_, w_ = 256, 128
v = np.linspace(0, 1, h_)[:, None] * np.ones((1, w_))
u = np.ones((h_, 1)) * np.linspace(0, 1, w_)[None, :]
across = np.abs(u - 0.5) * 2
leaf_rgb = np.array([0.075, 0.30, 0.045]) * (0.85 + 0.3 * noise(h_, w_, 10, 6))[..., None]
leaf_rgb *= (1 - 0.25 * across ** 2)[..., None]                       # darker towards the edge
leaf_rgb[across < 0.035] = [0.20, 0.48, 0.12]                          # midrib
lateral = np.abs(((v - across * 0.55) * 8) % 1 - 0.5) < 0.05
leaf_rgb[lateral & (across > 0.04) & (across < 0.85)] *= 1.6           # lateral veins
leaf_img = make_image('mint_leaf', np.clip(leaf_rgb, 0, 1))
mint_mat = material('mint', (1, 1, 1), roughness=0.45, image=leaf_img)
# Mint's quilted look: veins sunk in, the blade puffed between them.
vein_depth = 1.0 * (across < 0.035) + 0.7 * (lateral & (across > 0.04) & (across < 0.85))
leaf_height = 0.6 * np.sin(((v - across * 0.55) * 8 % 1) * math.pi) - vein_depth + 0.3 * noise(256, 128, 20, 10)
add_maps(mint_mat, normal=make_image('mint_leaf_normal', normal_from_height(leaf_height, 3.0), data=True), normal_strength=1.0)
stem_mat = material('mint-stem', (0.10, 0.28, 0.05), roughness=0.5)


def leaf(name, length, width, cup=0.003, droop=-0.004):
    """Serrated, cupped mint leaf along +Y with a short petiole at the origin."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    rows = []
    for j in range(15):
        t = j / 14
        shape = max(0.0, math.sin(math.pi * t)) ** 0.6 * (1.05 - 0.35 * t)  # broad near the base, pointed tip
        teeth = 1 + 0.12 * max(0, math.sin(t * math.pi * 16))
        half = width / 2 * shape * teeth
        row = []
        for k in range(5):
            s = (k / 4) * 2 - 1
            row.append(bm.verts.new((s * half, 0.004 + t * length, cup * s * s + droop * t * t + 0.0015 * math.sin(t * 9) * s)))
        rows.append(row)
    for j in range(14):
        for k in range(4):
            f = bm.faces.new((rows[j][k], rows[j][k + 1], rows[j + 1][k + 1], rows[j + 1][k]))
            for loop, (jj, kk) in zip(f.loops, ((j, k), (j, k + 1), (j + 1, k + 1), (j + 1, k))):
                loop[uv].uv = (kk / 4, jj / 14)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()
    return add(name, mesh, mint_mat)


parts = []
M = D['mint']
# Muddled leaves, each checked to be fully inside the liquid.
for i in range(M['inside']):
    obj = leaf(f'mint-in{i}', rng.uniform(0.022, 0.028), rng.uniform(0.014, 0.018))
    for attempt in range(80):
        zc = BASE + 0.01 + (LEVEL - BASE - 0.02) * rng.random()
        a, rr = rng.uniform(0, math.tau), (inner_r(zc) - 0.016) * math.sqrt(rng.random())
        obj.matrix_world = Matrix.Translation((math.cos(a) * rr, math.sin(a) * rr, zc)) @ Euler(
            (rng.uniform(0, math.tau), rng.uniform(0, math.tau), rng.uniform(0, math.tau))).to_matrix().to_4x4()
        bpy.context.view_layer.update()
        if fits(obj, LEVEL - 0.002):
            break
    parts.append(obj)

# The garnish: ONE small mint sprig resting on the rim, as bars serve it: its stem
# starts inside against the glass, just under the rim, and the sprig leans out
# over the edge; two crossed pairs of leaves and a small tip cluster, lying almost
# flat. Leaves may hang inside or outside the glass but never cut through its wall.
side_angle = M.get('rim_angle', math.radians(150))
radial = Vector((math.cos(side_angle), math.sin(side_angle), 0))
up = Vector((0, 0, 1))
stem_base = radial * (inner_r(H) - 0.009) + up * (H - 0.001)  # on the ice, just inside the lip
stem_dir = (radial * 0.95 + up * 0.32).normalized()            # ~18 degrees: lying over the rim
stem_len = M.get('sprig_length', 0.030)
stem_top = stem_base + stem_dir * stem_len
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.0015, radius2=0.0010, depth=stem_len)
stem_mesh = bpy.data.meshes.new('stem')
bm.to_mesh(stem_mesh)
bm.free()
stem = add('mint-stem', stem_mesh, stem_mat)
stem.matrix_world = Matrix.Translation((stem_base + stem_top) / 2) @ stem_dir.to_track_quat('Z', 'Y').to_matrix().to_4x4()
parts.append(stem)
side = stem_dir.cross(up).normalized()


def clear_of_wall(obj):
    for vv in obj.data.vertices:
        q = obj.matrix_world @ vv.co
        if q.z < H + 0.002:
            r = math.hypot(q.x, q.y)
            if inner_r(q.z) - 0.001 < r < outer_r(q.z) + 0.001 or q.z < H - 0.03:
                return False
    return True


# (along the stem, leaf length, spread from the stem in degrees, lift in degrees)
leaf_plan = [(0.30, 0.032, 75, -4), (0.62, 0.028, 55, 2), (1.0, 0.020, 25, 12)]
for n, (t, length, spread, lift) in enumerate(leaf_plan):
    node = stem_base + stem_dir * stem_len * t
    for sgn in (-1, 1):
        obj = leaf(f'mint-top{n}-{"lr"[sgn > 0]}', length * rng.uniform(0.92, 1.06), length * 0.64,
                   droop=-0.006 if n < 2 else -0.003)  # the leaves sag over the rim
        for attempt in range(40):
            sp = math.radians(spread + rng.uniform(-6, 6))
            li = math.radians(lift + attempt * 1.5 + rng.uniform(-3, 3))
            # The pair alternates: one pair spreads sideways, the next up/down (crossed).
            across = side if n % 2 == 0 else side.cross(stem_dir).normalized()
            direction = (stem_dir * math.cos(sp) + across * sgn * math.sin(sp)).normalized()
            direction = (direction * math.cos(li) + up * math.sin(li)).normalized()
            normal = (up - direction * up.dot(direction)).normalized()
            x_axis = direction.cross(normal)
            basis = Matrix((x_axis, direction, normal)).transposed().to_4x4()
            obj.matrix_world = Matrix.Translation(node) @ basis
            bpy.context.view_layer.update()
            if clear_of_wall(obj):
                break
        parts.append(obj)
join('mint', parts)

for obj in bpy.data.objects:
    obj.select_set(False)
bpy.context.view_layer.update()
report = {o.name: len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH'}
report['lime_inside'] = fits(bpy.data.objects['lime'], LEVEL - 0.002)
print('DRINK ' + json.dumps(report))
