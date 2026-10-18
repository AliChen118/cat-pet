#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""修复前后对照：以「修复前」的命中包围盒为准，裁同一区域，左右并排。

透明区用洋红底衬出，便于判断填补是否合理（应为透明缝隙）。
用法: python tools/magenta_beforeafter.py <before目录> <after目录> <输出png> [单列|双col]"
"""
import os
import sys

import numpy as np
from PIL import Image

BEFORE, AFTER, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ZOOM = 8
PAD = 16


def mask_of(a):
    r = a[..., 0].astype(np.int16); g = a[..., 1].astype(np.int16); b = a[..., 2].astype(np.int16)
    return ((np.minimum(r, b) - g) > 30) & ((b - g) > 25) & (a[..., 3] > 50)


names = sorted([n for n in os.listdir(BEFORE) if n.lower().endswith('.png')])
if len(sys.argv) > 4 and sys.argv[4].strip():
    want = set(x.strip() for x in sys.argv[4].split(','))
    names = [n for n in names if n in want]
pairs = []
for n in names:
    pb, pa = os.path.join(BEFORE, n), os.path.join(AFTER, n)
    if not os.path.exists(pa):
        continue
    ab = np.asarray(Image.open(pb).convert('RGBA'))
    m = mask_of(ab.astype(np.int16))
    if not m.any():
        continue
    ys, xs = np.where(m)
    x0 = max(0, int(xs.min()) - PAD); x1 = min(ab.shape[1], int(xs.max()) + PAD + 1)
    y0 = max(0, int(ys.min()) - PAD); y1 = min(ab.shape[0], int(ys.max()) + PAD + 1)
    tiles = []
    for p in (pb, pa):
        a = np.asarray(Image.open(p).convert('RGBA')).copy()[y0:y1, x0:x1]
        al = a[..., 3:4].astype(np.float32) / 255.0
        comp = (a[..., :3].astype(np.float32) * al + np.array([255, 0, 255], np.float32) * (1 - al)).astype(np.uint8)
        tiles.append(Image.fromarray(comp, 'RGB').resize(((x1 - x0) * ZOOM, (y1 - y0) * ZOOM), Image.NEAREST))
    sep = Image.new('RGB', (6, tiles[0].height), (40, 40, 40))
    row = Image.new('RGB', (tiles[0].width * 2 + 6, tiles[0].height), (40, 40, 40))
    row.paste(tiles[0], (0, 0)); row.paste(sep, (tiles[0].width, 0)); row.paste(tiles[1], (tiles[0].width + 6, 0))
    pairs.append((n, int(m.sum()), row))

cols = 1 if len(pairs) <= 5 else 2
cw = max(p[2].width for p in pairs) + 10
ch = max(p[2].height for p in pairs) + 10
rows = (len(pairs) + cols - 1) // cols
canvas = Image.new('RGB', (cw * cols, ch * rows), (235, 236, 240))
for i, (n, c, im) in enumerate(pairs):
    r, c2 = divmod(i, cols)
    canvas.paste(im, (c2 * cw + 5, r * ch + 5))
canvas.save(OUT)
print('输出 %s  对数=%d  网格=%dx%d' % (OUT, len(pairs), cols, rows))
for n, c, im in pairs:
    print('  %-22s 修复前命中 %5d px' % (n, c))
