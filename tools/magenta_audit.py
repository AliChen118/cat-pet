#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""动作素材品红（洋红）残留审计与清除。

判据（本轮重新定标，基于实测像素）：
    score = min(R,B) - G
    mag   = (score > 30) & (B - G > 25) & (alpha > 50)

定标依据（实测代表像素）：
  真品红渗漏   (237,60,163) score=103  B-G=103   -> 命中
                (236,50,148) score= 98  B-G= 98   -> 命中
  深粉腮红芯   (194,93,138) score= 45  B-G= 45   -> 旧判据 `B>=R*0.85` 误杀，新判据按 score 阈值区分
  柔和腮红     近似 (240,190,195) score ≈ 5       -> 不命中（实测全量扫描中面部区域从不命中）
  暖棕描边     (159,137,133) score < 0            -> 不命中
  薰衣草灰     (169,125,158) score= 33 B-G= 33    -> 灰调边缘，仅 2px，膨胀后顺手清掉
判定结果经 66 个素材全量扫描 + 逐区放大目视复核：命中区全部为
「身体部件／轮廓交界处露出的洋红背景缝隙」，均匀应以**透明**填补（相邻帧同位置即透明）。

用法：
    python tools/magenta_audit.py <目录...>                    # 只审计
    python tools/magenta_audit.py <目录...> --fix              # 审计并清除（原文件先备份）
    python tools/magenta_audit.py <目录...> --fix --inplace     # 不备份（谨慎）
"""
import argparse
import os
import shutil

import numpy as np
from PIL import Image

SC_T = 30          # score 阈值
BG_T = 25          # B - G 阈值
ALPHA_T = 50
THRESHOLD = 12     # 超标阈值（像素数）
GROW = 2           # 修复时膨胀半径（吃掉抗锯齿过渡）
DESPILL_T = 18     # 边缘去污染阈值
RING = 2           # 去污染环宽度


def load_arr(path):
    return np.asarray(Image.open(path).convert('RGBA'))


def score_map(a):
    r = a[..., 0].astype(np.int16)
    g = a[..., 1].astype(np.int16)
    b = a[..., 2].astype(np.int16)
    return np.minimum(r, b) - g, (b - g)


def magenta_mask(a, sc_t=SC_T, bg_t=BG_T, alpha_t=ALPHA_T):
    sc, bg = score_map(a)
    return (sc > sc_t) & (bg > bg_t) & (a[..., 3] > alpha_t)


def bbox_of(mask):
    ys, xs = np.where(mask)
    if not len(ys):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def sample_colors(a, mask, k=3):
    ys, xs = np.where(mask)
    if not len(ys):
        return []
    px = a[ys, xs][:, :4].astype(np.int16)
    uniq, cnt = np.unique(px, axis=0, return_counts=True)
    order = np.argsort(-cnt)[:k]
    return [tuple(int(v) for v in uniq[i]) for i in order]


def dilate(mask, r):
    if r <= 0:
        return mask
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx == 0 and dy == 0:
                continue
            out |= np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
    return out


def collect(dirs):
    files = []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for root, _dirs, names in os.walk(d):
            if os.path.basename(root).startswith('_'):
                continue
            for n in names:
                if n.lower().endswith('.png') and not n.startswith('_'):
                    files.append(os.path.join(root, n))
    return sorted(set(files))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dirs', nargs='+')
    ap.add_argument('--fix', action='store_true')
    ap.add_argument('--inplace', action='store_true')
    ap.add_argument('--label', default='')
    ap.add_argument('--bakdir', default='')
    args = ap.parse_args()

    files = collect(args.dirs)
    if not files:
        print('!! 未找到 PNG：%s' % args.dirs)
        return 1

    print('=' * 92)
    print('品红审计%s  目录: %s' % ((' - ' + args.label) if args.label else '', args.dirs))
    print('判据: min(R,B)-G > %d 且 B-G > %d 且 alpha > %d ；超标阈值 > %d px'
          % (SC_T, BG_T, ALPHA_T, THRESHOLD))
    print('扫描文件: %d' % len(files))
    print('=' * 92)

    hits = []
    for p in files:
        a = load_arr(p)
        m = magenta_mask(a)
        n = int(m.sum())
        if n:
            hits.append((p, n, bbox_of(m), sample_colors(a, m)))

    print('\n%-40s %8s  %-22s %s' % ('文件', '命中px', '包围盒(x0,y0,x1,y1)', '代表色'))
    print('-' * 92)
    for p, n, bb, cols in sorted(hits, key=lambda x: -x[1]):
        rel = p.replace('app/assets/sprites/', 'app::').replace('assets/sprites/', 'work::')
        print('%-40s %8d  %-22s %s%s' % (
            rel[-40:], n, ('%d,%d,%d,%d' % bb) if bb else '-',
            ' '.join(str(c) for c in cols), '  <== 超标' if n > THRESHOLD else ''))
    if not hits:
        print('（无命中）')
    print('\n命中文件: %d   超标文件: %d' % (len(hits), len(hits and [1 for _, n, _, _ in hits if n > THRESHOLD])))

    if not args.fix:
        return 0 if not hits else 1
    if not hits:
        print('无可修复项。')
        return 0

    # 备份：默认落在仓库 _backup/ 下，绝不放在应用素材目录内（会被打包进 asar）
    bak = args.bakdir or os.path.join('_backup', 'magenta-fix_%s_imgs' % args.label.replace('（', '').replace('）', '') or 'imgs')
    if not args.inplace:
        os.makedirs(bak, exist_ok=True)
        print('\n备份目录: %s' % bak)

    print('\n--- 清除（置透明 + 边缘去污染）---')
    fixed = []
    for p, _n, _bb, _c in hits:
        a = load_arr(p)
        core = magenta_mask(a)
        # 自适应膨胀：仅向「更宽松但仍带洋红倾向」的像素扩张，避免吃到毛皮
        punch = core.copy()
        for _ in range(4):
            ring = dilate(punch, 1) & ~punch
            ext = ring & magenta_mask(a, sc_t=20, bg_t=14, alpha_t=30)
            if not ext.any():
                break
            punch |= ext
        punch = dilate(punch, 1)          # 末次硬膨胀，吃掉抗锯齿过渡
        ring = dilate(punch, RING) & ~punch
        rgba = a.copy()
        if not args.inplace:
            shutil.copy2(p, os.path.join(bak, os.path.basename(p)))
        before = int((rgba[..., 3] > 0).sum())
        rgba[punch, 3] = 0
        # 边缘去污染：环内仍有洋红倾向的像素压掉洋红分量并降低不透明度
        sc, _bg = score_map(rgba)
        tainted = ring & (sc > DESPILL_T)
        if tainted.any():
            r = rgba[..., 0].astype(np.int16)
            g = rgba[..., 1].astype(np.int16)
            b = rgba[..., 2].astype(np.int16)
            mn = np.minimum(r, b)
            fac = np.clip((g + 20) / np.maximum(mn, 1), 0, 1)
            rgba[..., 0] = np.where(tainted, (r * fac).astype(np.uint8), rgba[..., 0])
            rgba[..., 2] = np.where(tainted, (b * fac).astype(np.uint8), rgba[..., 2])
            al = rgba[..., 3].astype(np.float32)
            rgba[..., 3] = np.where(tainted, al * 0.35, al).astype(np.uint8)
        after = int((rgba[..., 3] > 0).sum())
        Image.fromarray(rgba, 'RGBA').save(p)
        fixed.append(os.path.basename(p))
        print('  %-38s 核心 %5d px -> 实删 %5d px（去污染 %4d）；不透明像素 %d -> %d'
              % (os.path.basename(p), int(core.sum()), int(punch.sum()), int(tainted.sum()), before, after))

    print('\n--- 修复后复检 ---')
    bad = 0
    for p in files:
        a = load_arr(p)
        n = int(magenta_mask(a).sum())
        if n:
            bad += 1
            print('  !! 严格残留 %-38s %d px' % (os.path.basename(p), n))
    print('严格判据残留文件数: %d' % bad)
    print('修复文件数: %d  ->  %s' % (len(fixed), ', '.join(sorted(fixed))))
    return 0 if bad == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
