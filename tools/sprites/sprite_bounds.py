#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
sprite_bounds.py — 测量精灵素材的内容边界，生成两张静态表：

  * animator.js 的 CONTENT_TOP_FALLBACK —— 气泡头顶定位（无实测时的回退）；
  * renderer.js 的 POSE_SHADOW_K       —— 阴影圆盘随姿态的体积修正。

用途
----
气泡 / 挂件需要知道「猫头顶在哪」，也就是素材中首个非透明像素的 y 坐标
（sprite 坐标系，512x512 画布，内容底边对齐 y=470）。
运行时 animator.js 会优先用画布实测；本脚本产出静态回退表，
用于实测不可用的场景（无头测试、受限渲染环境）。

姿态级取值：同一姿态的多帧取“最高帧”（y 最小），保证同一姿态下气泡不抖动。

用法：
    python tools/sprites/sprite_bounds.py
"""

import os
import sys
import glob

try:
    import numpy as np
    from PIL import Image
except ImportError:
    sys.exit('需要 Pillow 与 numpy：pip install Pillow numpy')

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
from _root import find_root  # noqa: E402

ROOT = find_root()
SPRITES = os.path.join(ROOT, 'app', 'assets', 'sprites')
ALPHA_THRESHOLD = 8          # 与 animator.js 中 measureContentTop 保持一致
ANCHOR_X = 256               # 躯干中心锚点（renderer.js 以此为 pet.x）
SPRITE_HALF_W = 253          # renderer.js / main.js 中的活动边界半宽


def core_area(path, thr=100, e=10):
    """腐蚀核心面积（剥离细腿与尾巴）——用作「身体体积」代理，推导阴影缩放。

    口径与 tools/sprites/fix_pose_frames.py 的 core_cx 一致（erode=10）。
    面积是二维量，开方后才是线性比例。
    """
    a = np.array(Image.open(path).convert('RGBA').getchannel('A'))
    m = a > thr
    er = m.copy()
    for _ in range(e):
        # 3x3 十字结构元，逐次腐蚀；比一次大方块核更贴近 scipy 的默认行为
        nxt = er.copy()
        nxt[1:, :] &= er[:-1, :]
        nxt[:-1, :] &= er[1:, :]
        nxt[:, 1:] &= er[:, :-1]
        nxt[:, :-1] &= er[:, 1:]
        er = nxt
    return int(er.sum())


def content_top(path):
    """返回首个非透明像素的 y 坐标；素材全透明时返回 -1。"""
    alpha = np.array(Image.open(path).convert('RGBA'))[:, :, 3]
    ys, _ = np.where(alpha > ALPHA_THRESHOLD)
    return int(ys.min()) if len(ys) else -1


def content_x_extent(path):
    """返回 (左半宽, 右半宽) = 相对 x=256 锚点的最大横向伸出量；全透明返回 (0, 0)。"""
    alpha = np.array(Image.open(path).convert('RGBA'))[:, :, 3]
    _, xs = np.where(alpha > ALPHA_THRESHOLD)
    if not len(xs):
        return 0, 0
    return ANCHOR_X - int(xs.min()), int(xs.max()) - ANCHOR_X


def check_half_width(poses):
    """
    穷尽校验：所有姿态、所有帧相对锚点的横向伸出量都必须 <= SPRITE_HALF_W。
    活动边界与状态面板避让都建立在这个常量上，一旦素材重新生成后超出，
    猫身就会压到面板上或走出窗口——因此这里做硬校验。
    """
    worst = (0, '', 0)      # (伸出量, 文件, 侧)
    files = []
    for pose in poses:
        paths = sorted(glob.glob(os.path.join(SPRITES, 'frames', pose + '_*.png')))
        single = os.path.join(SPRITES, pose + '.png')
        if os.path.exists(single):
            paths.append(single)
        files.extend(paths)

    print('\n---- 横向边界校验（锚点 x=%d，上限 %d） ----' % (ANCHOR_X, SPRITE_HALF_W))
    for path in files:
        left, right = content_x_extent(path)
        name = os.path.basename(path)
        over = max(left, right)
        if over > worst[0]:
            worst = (over, name, '左' if left >= right else '右')
        flag = '' if over <= SPRITE_HALF_W else '  <-- 超出上限!'
        print('%-18s 左=%-4d 右=%-4d%s' % (name, left, right, flag))

    print('\n最宽帧: %s %s侧=%d（上限 %d）' % (worst[1], worst[2], worst[0], SPRITE_HALF_W))
    if worst[0] > SPRITE_HALF_W:
        print('[FAIL] 素材半宽超出 SPRITE_HALF_W，请同步上调 renderer.js 与 main.js 的常量！')
        return 1
    print('[ok] 全部素材在 SPRITE_HALF_W=%d 之内（余量 %dpx）' % (
        SPRITE_HALF_W, SPRITE_HALF_W - worst[0]))
    return 0


def pose_paths(pose):
    """该姿态实际被渲染引用的素材路径（优先序列帧，其次单姿态图）。"""
    paths = sorted(glob.glob(os.path.join(SPRITES, 'frames', pose + '_*.png')))
    if not paths:
        single = os.path.join(SPRITES, pose + '.png')
        if os.path.exists(single):
            paths.append(single)
    return paths


def main():
    poses = ['idle', 'walk', 'run', 'jump', 'stretch', 'drag',
             'sleep', 'eat', 'play', 'pet', 'meow', 'tailwag', 'unhappy', 'bath', 'lick']
    table = {}

    for pose in poses:
        paths = pose_paths(pose)
        tops = [t for t in (content_top(p) for p in paths) if t >= 0]
        if not tops:
            continue
        table[pose] = min(tops)
        print('%-8s top=%-4d  (%s)' % (
            pose, table[pose],
            ', '.join('%s=%d' % (os.path.basename(p), content_top(p)) for p in paths)))

    print('\n---- 复制到 engine/animator.js ----')
    print('const CONTENT_TOP_FALLBACK = {')
    line = '  '
    for pose in poses:
        if pose not in table:
            continue
        piece = '%s: %d, ' % (pose, table[pose])
        if len(line) + len(piece) > 76:
            print(line.rstrip())
            line = '  '
        line += piece
    print(line.rstrip().rstrip(',') + ',')
    print('};')

    # ---- 阴影圆盘的姿态体积修正 ----
    # 身体体积用「腐蚀核心面积」代理（剥掉细腿与尾巴），面积开方得到线性比例。
    print('\n---- 复制到 renderer.js ----')
    cores = {}
    for pose in poses:
        paths = pose_paths(pose)
        vals = [core_area(p) for p in paths]
        if vals:
            cores[pose] = sum(vals) / len(vals)
            print('%-8s core=%-8.0f' % (pose, cores[pose]))
    base = cores.get('idle')
    if base:
        print('\nconst POSE_SHADOW_K = {')
        line = '  '
        for pose in poses:
            if pose not in cores:
                continue
            kk = (cores[pose] / base) ** 0.5
            piece = '%s: %.3f, ' % (pose, kk)
            if len(line) + len(piece) > 76:
                print(line.rstrip())
                line = '  '
            line += piece
        print(line.rstrip().rstrip(',') + ',')
        print('};')

    return check_half_width(poses)


if __name__ == '__main__':
    sys.exit(main())
