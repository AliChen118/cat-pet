#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""对命中文件逐个放大命中区域并高亮，拼成总览图，供人工判读。

用法: python tools/legacy/magenta_region_view.py <图目录> <输出png> [score阈值] [B-G阈值]
"""
import os
import sys

import numpy as np
from PIL import Image

SC_T = int(sys.argv[3]) if len(sys.argv) > 3 else 30
BG_T = int(sys.argv[4]) if len(sys.argv) > 4 else 40
PAD = 24
ZOOM = 5


def mask_of(a):
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    return (np.minimum(r, b) - g > SC_T) & ((b - g) > BG_T) & (al > 60)


def find(src):
    files = []
    for root, _d, names in os.walk(src):
        if os.path.basename(root).startswith('_'):
            continue
        for n in names:
            if n.lower().endswith('.png') and not n.startswith('_'):
                files.append(os.path.join(root, n))
    return sorted(set(files))


src, out = sys.argv[1], sys.argv[2]
tiles = []
for p in find(src):
    raw = np.asarray(Image.open(p).convert('RGBA')).astype(np.int16)
    m = mask_of(raw)
    if not m.any():
        continue
    ys, xs = np.where(m)
    x0 = max(0, int(xs.min()) - PAD); x1 = min(raw.shape[1], int(xs.max()) + PAD + 1)
    y0 = max(0, int(ys.min()) - PAD); y1 = min(raw.shape[0], int(ys.max()) + PAD + 1)
    rgba = np.asarray(Image.open(p).convert('RGBA')).copy()[y0:y1, x0:x1].copy()
    sm = m[y0:y1, x0:x1]
    al = rgba[..., 3:4].astype(np.float32) / 255.0
    plain = (rgba[..., :3].astype(np.float32) * al + 244 * (1 - al)).astype(np.uint8)
    mark = rgba.copy()
    mark[sm] = [0, 255, 0, 255]
    al2 = mark[..., 3:4].astype(np.float32) / 255.0
    marked = (mark[..., :3].astype(np.float32) * al2 + 244 * (1 - al2)).astype(np.uint8)
    both = np.concatenate([plain, np.full((plain.shape[0], 4, 3), 90, dtype=np.uint8), marked], axis=1)
    im = Image.fromarray(both, 'RGB').resize((both.shape[1] * ZOOM, both.shape[0] * ZOOM), Image.NEAREST)
    tiles.append((os.path.basename(p), int(m.sum()), (x0, y0, x1, y1), im))

if not tiles:
    print('无命中文件')
    sys.exit(0)

cols = 3
cw = max(t[3].width for t in tiles) + 8
ch = max(t[3].height for t in tiles) + 8
rows = (len(tiles) + cols - 1) // cols
canvas = Image.new('RGB', (cw * cols, ch * rows), (228, 230, 236))
for i, (name, n, bb, im) in enumerate(tiles):
    r, c = divmod(i, cols)
    canvas.paste(im, (c * cw + 4, r * ch + 4))
canvas.save(out)
print('输出: %s  图块数=%d  网格=%dx%d  单块上限=%dx%d' % (out, len(tiles), cols, rows, cw, ch))
for name, n, bb, im in tiles:
    print('  %-24s 命中=%6d  区域=%s' % (name, n, bb))
