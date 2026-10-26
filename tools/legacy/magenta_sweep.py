#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""全量扫描「洋红分数」score = min(R,B) - G 的分布，用于确定安全阈值。

需同时满足 B - G > 40（排除偏红的粉／棕）与 alpha > 60（忽略极淡边缘）。
"""
import glob
import os
import sys

import numpy as np
from PIL import Image

THRESHOLDS = [30, 40, 45, 50, 55, 60, 70, 80, 100]


def score_of(a):
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    mn = np.minimum(r, b)
    sc = mn - g
    return sc, (b - g), al


def main():
    files = []
    for d in sys.argv[1:]:
        for root, dirs, names in os.walk(d):
            if os.path.basename(root).startswith('_'):
                continue
            for n in names:
                if n.lower().endswith('.png') and not n.startswith('_'):
                    files.append(os.path.join(root, n))
    files = sorted(set(files))
    print('扫描 %d 个文件，阈值扫描（需同时 B-G>40 且 alpha>60）\n' % len(files))
    hdr = '%-44s' % '文件' + ''.join('%6d' % t for t in THRESHOLDS)
    print(hdr)
    print('-' * len(hdr))
    totals = {t: 0 for t in THRESHOLDS}
    rows = []
    for p in files:
        a = np.asarray(Image.open(p).convert('RGBA')).astype(np.int16)
        sc, bg, al = score_of(a)
        base = (bg > 40) & (al > 60)
        counts = {t: int((base & (sc > t)).sum()) for t in THRESHOLDS}
        for t in THRESHOLDS:
            totals[t] += counts[t]
        if counts[THRESHOLDS[0]]:
            rows.append((p, counts))
    for p, counts in sorted(rows, key=lambda x: -x[1][55]):
        print('%-44s' % os.path.basename(p) + ''.join('%6d' % counts[t] for t in THRESHOLDS))
    print('-' * len(hdr))
    print('%-44s' % '总计' + ''.join('%6d' % totals[t] for t in THRESHOLDS))

    # 逐阈值列出受影响文件
    for t in [50, 55, 60, 70]:
        fs = [(os.path.basename(p), c[t]) for p, c in rows if c[t] > 0]
        print('\n阈值 %d 受影响文件 (%d): %s' % (t, len(fs), fs if fs else '无'))


if __name__ == '__main__':
    main()
