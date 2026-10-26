#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""pose_iou.py — 量每个姿态「相邻帧 alpha 掩膜 IoU」，校验 NO_FRAME_BLEND 是否漏项。

为什么需要：animator.js 的帧间插值是「当前帧实心 + 下一帧按 k 叠上去」，
两帧轮廓差异大时非重叠部分会同时可见（双爪/双头/两条尾巴/两只球/两个食盆）。
判据是**最小相邻帧 IoU < 0.90 就硬切**，这份清单必须与素材同步——素材一改就得重跑。

输出三块：
  1. 逐姿态最小/平均相邻帧 IoU；
  2. 按阈值给出「应硬切」集合；
  3. 读 app/engine/animator.js 里的 NO_FRAME_BLEND，列出漏项/多项，最后给退出码。

用法：
    python tools/check/pose_iou.py            # 默认阈值 0.90
    python tools/check/pose_iou.py --th 0.88
    python tools/check/pose_iou.py --quiet    # 只输出结论
"""
import argparse
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
from _root import find_root  # noqa: E402

ROOT = find_root()
SPRITES = os.path.join(ROOT, 'app', 'assets', 'sprites')
ANIMATOR = os.path.join(ROOT, 'app', 'engine', 'animator.js')
ALPHA_THR = 40          # 只算"看得见"的部分，避免极淡边缘把 IoU 抬高


def mask(path):
    return np.array(Image.open(path).convert('RGBA').getchannel('A')) > ALPHA_THR


def poses():
    d = os.path.join(SPRITES, 'frames')
    names = {}
    for f in sorted(os.listdir(d)):
        if f.endswith('.png'):
            names.setdefault(f.rsplit('_', 1)[0], []).append(os.path.join(d, f))
    for single in sorted(os.listdir(SPRITES)):
        if single.endswith('.png'):
            names.setdefault(single[:-4], []).append(os.path.join(SPRITES, single))
    for k in names:
        names[k].sort(key=lambda p: int(re.search(r'_(\d+)\.png$', p).group(1))
                      if re.search(r'_(\d+)\.png$', p) else 0)
    return names


def declared():
    """读 animator.js 的 NO_FRAME_BLEND 成员。"""
    src = open(ANIMATOR, encoding='utf-8').read()
    m = re.search(r'NO_FRAME_BLEND\s*=\s*new Set\(\[([\s\S]*?)\]', src)
    return set(re.findall(r"'([a-zA-Z]+)'", m.group(1))) if m else set()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--th', type=float, default=0.90)
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    rows = []
    for pose, paths in poses().items():
        if len(paths) < 2:
            continue
        ms = [mask(p) for p in paths]
        ious = []
        for i in range(len(ms) - 1):
            a, b = ms[i], ms[i + 1]
            inter = np.logical_and(a, b).sum()
            union = np.logical_or(a, b).sum()
            ious.append(inter / union if union else 1.0)
        rows.append((pose, min(ious), sum(ious) / len(ious), len(paths)))

    rows.sort(key=lambda r: r[1])
    if not args.quiet:
        print('%-9s %8s %8s %5s  %s' % ('pose', 'minIoU', 'avgIoU', 'n', '判定'))
        for pose, mn, avg, n in rows:
            print('%-9s %8.3f %8.3f %5d  %s' % (
                pose, mn, avg, n, '硬切' if mn < args.th else '插值'))

    should = {r[0] for r in rows if r[1] < args.th}
    have = declared()
    missing = sorted(should - have)
    extra = sorted(have - should)

    print('\n阈值 %.2f → 应硬切 %d 个: %s' % (args.th, len(should), ' '.join(sorted(should))))
    print('animator.js 已声明 %d 个: %s' % (len(have), ' '.join(sorted(have))))
    if missing:
        print('[FAIL] 漏项（IoU 已低于阈值但仍在做插值，会出残影）: %s' % ' '.join(missing))
    if extra:
        print('[WARN] 多项（IoU 高于阈值却硬切，观感偏生硬，不致命）: %s' % ' '.join(extra))
    if not missing and not extra:
        print('[ok] NO_FRAME_BLEND 与素材实测完全一致')
    return 1 if missing else 0


if __name__ == '__main__':
    sys.exit(main())
