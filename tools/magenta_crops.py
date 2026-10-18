#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""放大检视指定文件、指定区域，并高亮品红像素，用于人工判读。"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from magenta_audit import magenta_mask, bbox_of  # noqa: E402

PAD = 26
ZOOM = 8
OUT = 'assets-src/previews/_magenta_crops.png'

TARGETS = [
    'app/assets/sprites/frames/tailwag_3.png',
    'app/assets/sprites/frames/bath_4.png',
    'app/assets/sprites/frames/bath_6.png',
    'app/assets/sprites/meow.png',
]

tiles = []
for p in TARGETS:
    a = np.asarray(Image.open(p).convert('RGBA')).astype(np.int16)
    m = magenta_mask(a)
    if not m.any():
        m = magenta_mask(a, alpha_t=0)
    bb = bbox_of(m)
    x0 = max(0, bb[0] - PAD); y0 = max(0, bb[1] - PAD)
    x1 = min(a.shape[1], bb[2] + PAD + 1); y1 = min(a.shape[0], bb[3] + PAD + 1)
    sub = np.asarray(Image.open(p).convert('RGBA')).copy()[y0:y1, x0:x1].copy()
    sm = m[y0:y1, x0:x1]
    # 高亮品红像素为纯绿，便于在图上定位
    sub[sm] = [0, 255, 0, 255]
    # 铺白底便于观察透明区
    bg = np.full((sub.shape[0], sub.shape[1], 4), 255, dtype=np.uint8)
    al = sub[..., 3:4].astype(np.float32) / 255.0
    comp = (sub[..., :3].astype(np.float32) * al + 255 * (1 - al)).astype(np.uint8)
    im = Image.fromarray(comp, 'RGB').resize((comp.shape[1] * ZOOM, comp.shape[0] * ZOOM), Image.NEAREST)
    tiles.append((p, bb, int(m.sum()), im))

W = max(t[3].width for t in tiles)
total_h = sum(t[3].height + 26 for t in tiles)
canvas = Image.new('RGB', (W, total_h), (245, 245, 248))
y = 0
for p, bb, n, im in tiles:
    canvas.paste(im, (0, y))
    y += im.height + 26
canvas.save(OUT)
print('输出: %s  尺寸=%s' % (OUT, canvas.size))
for p, bb, n, im in tiles:
    print('  %-48s 品红=%d 包围盒=%s 放大区=%s' % (os.path.basename(p), n, bb, im.size))
