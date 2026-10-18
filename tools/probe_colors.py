#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""采样指定区域的像素颜色分布，用于重新定标品红判据。"""
import sys

import numpy as np
from PIL import Image

REGIONS = [
    ('app/assets/sprites/frames/tailwag_3.png', 325, 295, 380, 350),
    ('app/assets/sprites/frames/bath_4.png', 130, 290, 185, 325),
    ('app/assets/sprites/frames/bath_6.png', 340, 275, 375, 310),
    ('app/assets/sprites/meow.png', 60, 290, 100, 320),
]

for p, x0, y0, x1, y1 in REGIONS:
    a = np.asarray(Image.open(p).convert('RGBA')).astype(np.int16)
    sub = a[y0:y1, x0:x1]
    m = sub[..., 3] > 0
    px = sub[m][:, :4]
    uniq, cnt = np.unique(px, axis=0, return_counts=True)
    order = np.argsort(-cnt)[:14]
    print('== %s  区域(%d,%d)-(%d,%d)  有效像素=%d' % (p.split('/')[-1], x0, y0, x1, y1, int(m.sum())))
    print('   %-22s %6s %8s %8s' % ('RGBA', '次数', 'min-G', 'B/R'))
    for i in order:
        c = uniq[i]
        r, g, b = int(c[0]), int(c[1]), int(c[2])
        print('   %-22s %6d %8d %8.2f' % (str(tuple(int(v) for v in c)), int(cnt[i]),
                                          min(r, b) - g, (b / r if r else 0)))
    # 高饱和洋红：G 明显低于 min(R,B)，且不偏红（B 不太小）
    mn = np.minimum(sub[..., 0], sub[..., 2])
    cand = (mn - sub[..., 1] > 45) & (sub[..., 3] > 100)
    print('   候选(min-G>45 & alpha>100): %d px' % int(cand.sum()))
    print()
