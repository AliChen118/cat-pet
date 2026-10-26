#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把同一姿态全部帧在「命中区域」裁剪并排，判断该区域在其它帧中的真实内容，
从而确定正确填补方式（透明 or 皮毛）。

用法: python tools/legacy/magenta_siblings.py <姿态> <bbox x0 y0 x1 y1> [score] [B-G]
"""
import os
import sys

import numpy as np
from PIL import Image

POSE = sys.argv[1]
x0, y0, x1, y1 = [int(v) for v in sys.argv[2:6]]
SC_T = int(sys.argv[6]) if len(sys.argv) > 6 else 55
BG_T = int(sys.argv[7]) if len(sys.argv) > 7 else 40
ZOOM = 4
FR = 'app/assets/sprites/frames'


def mask_of(a):
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    return (np.minimum(r, b) - g > SC_T) & ((b - g) > BG_T) & (al > 60)


frames = sorted([n for n in os.listdir(FR) if n.startswith(POSE + '_') and n.endswith('.png')],
                key=lambda n: int(n.split('_')[1].split('.')[0]))
if not frames:
    frames = [POSE + '.png']

tiles = []
for n in frames:
    p = os.path.join(FR, n)
    a = np.asarray(Image.open(p).convert('RGBA')).astype(np.int16)
    sub = np.asarray(Image.open(p).convert('RGBA')).copy()[y0:y1, x0:x1]
    m = mask_of(a)[y0:y1, x0:x1]
    rgba = sub.copy()
    rgba[m] = [0, 255, 0, 255]
    # 用洋红底衬出透明区（透明 = 洋红可见），便于判断是否应为透明
    al = rgba[..., 3:4].astype(np.float32) / 255.0
    comp = (rgba[..., :3].astype(np.float32) * al + np.array([255, 0, 255]) * (1 - al)).astype(np.uint8)
    im = Image.fromarray(comp, 'RGB').resize(((x1 - x0) * ZOOM, (y1 - y0) * ZOOM), Image.NEAREST)
    tiles.append((n, int(m.sum()), im))

w = max(t[2].width for t in tiles) + 8
canvas = Image.new('RGB', (w * len(tiles), max(t[2].height for t in tiles) + 8), (30, 30, 30))
for i, (n, c, im) in enumerate(tiles):
    canvas.paste(im, (i * w + 4, 4))
out = 'assets-src/previews/_mg/%s_siblings.png' % POSE
os.makedirs('assets-src/previews/_mg', exist_ok=True)
canvas.save(out)
print('输出 %s  (帧序: %s)' % (out, ', '.join('%s:%d' % (t[0], t[1]) for t in tiles)))
print('说明: 透明区在图中显示为洋红底色；高亮绿=当前帧命中的洋红像素')
