#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把某姿态全部帧整帧并排（洋红底衬出透明），用于判断姿态结构与透明区。

用法: python tools/frames_row.py <姿态> [splitY]   splitY>0 时只裁下半部分以下
"""
import os
import sys

import numpy as np
from PIL import Image

POSE = sys.argv[1]
CROP = sys.argv[2] if len(sys.argv) > 2 else ''
S = 0.62
FR = 'app/assets/sprites/frames'


def key(n):
    base = n.rsplit('.', 1)[0]
    tail = base.split('_')[-1]
    return int(tail) if tail.isdigit() else 0


frames = sorted([n for n in os.listdir(FR) if n.startswith(POSE + '_') and n.endswith('.png')], key=key)
if not frames:
    frames = [POSE + '.png']

tiles = []
for n in frames:
    p = os.path.join(FR, n)
    a = np.asarray(Image.open(p).convert('RGBA')).astype(np.float32)
    if CROP:
        y0, y1 = [int(v) for v in CROP.split(',')]
        a = a[y0:y1]
    al = a[..., 3:4] / 255.0
    comp = (a[..., :3] * al + np.array([255, 0, 255], dtype=np.float32) * (1 - al)).astype(np.uint8)
    im = Image.fromarray(comp, 'RGB')
    im = im.resize((max(1, int(im.width * S)), max(1, int(im.height * S))), Image.LANCZOS)
    tiles.append((n, im))

cw = max(t[1].width for t in tiles) + 6
canvas = Image.new('RGB', (cw * len(tiles), max(t[1].height for t in tiles) + 6), (25, 25, 25))
for i, (n, im) in enumerate(tiles):
    canvas.paste(im, (i * cw + 3, 3))
os.makedirs('assets-src/previews/_mg', exist_ok=True)
out = 'assets-src/previews/_mg/%s_row.png' % POSE
canvas.save(out)
print('%s  ->  %s   帧: %s' % (POSE, out, ', '.join(t[0] for t in tiles)))
