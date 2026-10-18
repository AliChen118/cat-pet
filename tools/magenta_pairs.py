#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""逐个命中文件输出「原图 | 高亮」对照裁剪图，便于人工判读。

用法: python tools/magenta_pairs.py <文件...> <score阈值> <B-G阈值>
"""
import os
import sys

import numpy as np
from PIL import Image

SC_T = int(sys.argv[-2])
BG_T = int(sys.argv[-1])
files = sys.argv[1:-2]
OUTDIR = 'assets-src/previews/_mg'
os.makedirs(OUTDIR, exist_ok=True)
ZOOM = 4
PAD = 18


def mask_of(a):
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    return (np.minimum(r, b) - g > SC_T) & ((b - g) > BG_T) & (al > 60)


for p in files:
    raw = np.asarray(Image.open(p).convert('RGBA')).astype(np.int16)
    m = mask_of(raw)
    if not m.any():
        print('%-28s 无命中' % os.path.basename(p))
        continue
    ys, xs = np.where(m)
    x0 = max(0, int(xs.min()) - PAD); x1 = min(raw.shape[1], int(xs.max()) + PAD + 1)
    y0 = max(0, int(ys.min()) - PAD); y1 = min(raw.shape[0], int(ys.max()) + PAD + 1)
    rgba = np.asarray(Image.open(p).convert('RGBA')).copy()[y0:y1, x0:x1]
    sm = m[y0:y1, x0:x1]
    al = rgba[..., 3:4].astype(np.float32) / 255.0
    plain = (rgba[..., :3].astype(np.float32) * al + 244 * (1 - al)).astype(np.uint8)
    mark = rgba.copy(); mark[sm] = [0, 255, 0, 255]
    al2 = mark[..., 3:4].astype(np.float32) / 255.0
    marked = (mark[..., :3].astype(np.float32) * al2 + 244 * (1 - al2)).astype(np.uint8)
    both = np.concatenate([plain, np.full((plain.shape[0], 6, 3), 70, dtype=np.uint8), marked], axis=1)
    im = Image.fromarray(both, 'RGB').resize((both.shape[1] * ZOOM, both.shape[0] * ZOOM), Image.NEAREST)
    out = os.path.join(OUTDIR, os.path.basename(p).replace('.png', '_pair.png'))
    im.save(out)
    print('%-28s 命中=%6d 区域=(%d,%d,%d,%d) -> %s' % (os.path.basename(p), int(m.sum()), x0, y0, x1, y1, out))
