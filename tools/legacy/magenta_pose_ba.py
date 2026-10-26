#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""逐姿态输出「修复前（上） / 修复后（下）」整帧对照，透明区用洋红底衬出。

用法: python tools/legacy/magenta_pose_ba.py <before目录> <after目录> <姿态名> <输出png>
"""
import os
import sys

import numpy as np
from PIL import Image

BEFORE, AFTER, POSE, OUT = sys.argv[1:5]
S = 0.75


def key(n):
    tail = n.rsplit('.', 1)[0].split('_')[-1]
    return int(tail) if tail.isdigit() else 0


def load_row(src):
    if not os.path.isdir(src):
        return None, []
    fs = sorted([n for n in os.listdir(src) if n.startswith(POSE + '_') and n.endswith('.png')], key=key)
    if not fs:
        single = POSE + '.png'
        if os.path.exists(os.path.join(src, single)):
            fs = [single]
    tiles = []
    for n in fs:
        a = np.asarray(Image.open(os.path.join(src, n)).convert('RGBA')).astype(np.float32)
        al = a[..., 3:4] / 255.0
        comp = (a[..., :3] * al + np.array([255, 0, 255], np.float32) * (1 - al)).astype(np.uint8)
        im = Image.fromarray(comp, 'RGB')
        im = im.resize((max(1, int(im.width * S)), max(1, int(im.height * S))), Image.LANCZOS)
        tiles.append(im)
    return tiles, fs


def strip(tiles, label_h=0):
    if not tiles:
        return None
    cw = max(t.width for t in tiles) + 6
    h = max(t.height for t in tiles)
    row = Image.new('RGB', (cw * len(tiles), h + 6), (25, 25, 25))
    for i, im in enumerate(tiles):
        row.paste(im, (i * cw + 3, 3))
    return row


tb, fb = load_row(BEFORE)
ta, fa = load_row(AFTER)
rb, ra = strip(tb), strip(ta)
if rb is None or ra is None:
    print('空: before=%s after=%s' % (bool(rb), bool(ra)))
    sys.exit(0)
W = max(rb.width, ra.width)
canvas = Image.new('RGB', (W, rb.height + ra.height + 26), (18, 18, 18))
canvas.paste(rb, (0, 0))
canvas.paste(ra, (0, rb.height + 26))
canvas.save(OUT)
print('%s  上=修复前 下=修复后  帧: %s  尺寸=%s -> %s' % (POSE, ', '.join(fa), canvas.size, OUT))
