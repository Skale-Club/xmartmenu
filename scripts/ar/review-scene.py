"""
Builds one Blender scene with several prepared dishes side by side, each with its
name, so the owner can review a whole batch in the Blender window (required before
publishing, see docs/product/augmented-reality.md). Nothing in the dishes' own
.blend files changes: their objects are appended into this scene.

  blender -b --factory-startup --python scripts/ar/review-scene.py -- \
      --blend-dir "<AR_MODELS_DIR>/<tenant>/blend" --out review.blend dish-a dish-b ...
"""
import argparse
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--blend-dir', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--columns', type=int, default=4)
parser.add_argument('--spacing', type=float, default=0.42)
parser.add_argument('dishes', nargs='+')
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rows = math.ceil(len(args.dishes) / args.columns)
for index, dish in enumerate(args.dishes):
    path = os.path.join(args.blend_dir, f'{dish}.blend')
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [name for name in src.objects]
    collection = bpy.data.collections.new(dish)
    scene.collection.children.link(collection)
    col, row = index % args.columns, index // args.columns
    offset = ((col - (args.columns - 1) / 2) * args.spacing, ((rows - 1) / 2 - row) * args.spacing, 0)
    for obj in dst.objects:
        if obj is None or obj.type not in ('MESH', 'EMPTY'):
            continue
        collection.objects.link(obj)
        obj.location = (obj.location[0] + offset[0], obj.location[1] + offset[1], obj.location[2])
    label = bpy.data.curves.new(f'{dish}-label', 'FONT')
    label.body = dish.replace('-', ' ').title()
    label.size = 0.028
    label.align_x = 'CENTER'
    text = bpy.data.objects.new(f'{dish}-label', label)
    text.location = (offset[0], offset[1] - args.spacing * 0.45, 0)
    collection.objects.link(text)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=args.out, compress=True)
print('REVIEW', args.out, len(args.dishes))
