# -*- coding: utf-8 -*-
"""把一个姿态的帧序列逐帧缩放到基准姿态的尺度，把比例校正烘焙进素材。

为什么要在素材层做：运行时 POSE_SCALE 是「按姿态名查表」的离散系数，切姿态的那
一帧整块生效，配合帧级平滑（SCALE_SMOOTH）就会看到一次「短暂缩一圈再涨回来」。
比例烘焙进素材后运行时系数恒为 1，体型从头到尾不动。

判据（三种口径）：
  eye   （默认）眼距——两眼中点的水平距。眼睛是刚性特征，不受尾巴/姿态干扰，
        公认最能代表「同一只猫画多大」。缺点：闭眼/侧脸帧测不到。
  torso 躯干带腐蚀核心面积——通用于任何姿态，但尾巴若横进带内会污染读数，
        且体宽超过测量带（132 px）时会**饱和**，读数直接失去意义。
        仅在 eye 全帧不可用时兜底，且必须确认没有饱和。
  height 底边锚定的整体高度（y_max − y_min + 1），线性量。站在地面上的角色，
        可视高度最接近人眼判断「这只猫有多大」；耷拉耳/绕身尾巴只改宽度不改高度，
        因此不受污染，也不会饱和。前提：各帧底边一致（本项目统一 468）。

锚点：素材基线 (256, 470)（对应 animator 的 SPRITE_CENTER / SPRITE_GROUND）保持
不动，脚底不上浮、躯干不左右偏。

用法：
  python tools/sprites/normalize_pose_size.py tailwag --ref idle --metric eye --uniform
  python tools/sprites/normalize_pose_size.py unhappy --ref idle --metric height --uniform
  python tools/sprites/normalize_pose_size.py pet --ref idle --metric area --uniform [--dry]
"""
import argparse
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
from _root import find_root  # noqa: E402

ROOT = find_root()
FRAMES = os.path.join(ROOT, 'app', 'assets', 'sprites', 'frames')
BACKUP = os.path.join(ROOT, '_backup', 'pose-orig')

ANCHOR_X, ANCHOR_Y = 256.0, 470.0     # 与 animator 的 SPRITE_CENTER / SPRITE_GROUND 对应
SIZE = 512
BAND = (190, 322)                     # 躯干带：避开两侧摆动的尾巴
TORSO_Y = (380, 462)                  # 躯干纵向窗口：避开头部与地面阴影


def _rgba(path):
    return np.array(Image.open(path).convert('RGBA')).astype(float)


def eye_gap(path):
    """两眼中点水平距；闭眼/侧脸返回 None。

    眼睛 = 深色（luma<125）且够大（area≥200, 宽高≥12）的两个团块；
    先用闭运算补掉高光空洞，再开运算去掉睫毛/描边碎点。
    """
    a = _rgba(path)
    alpha = a[:, :, 3] > 200
    luma = 0.299 * a[:, :, 0] + 0.587 * a[:, :, 1] + 0.114 * a[:, :, 2]
    dark = (luma < 125) & alpha
    dark = ndi.binary_opening(
        ndi.binary_closing(dark, np.ones((7, 7), bool)), np.ones((5, 5), bool))
    lab, _ = ndi.label(dark)
    cands = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sl is None:
            continue
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        area = int((lab[sl] == i).sum())
        if area < 200 or w < 12 or h < 12:
            continue
        cy, cx = ndi.center_of_mass(lab[sl] == i)
        cands.append((area, cy + sl[0].start, cx + sl[1].start))
    if len(cands) < 2:
        return None
    best = None
    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            A, B = cands[i], cands[j]
            if abs(A[1] - B[1]) > 25:            # 两眼大致同高
                continue
            if not (0.6 < A[0] / B[0] < 1.7):    # 两眼面积相当
                continue
            d = abs(A[2] - B[2])
            if best is None or d > best:
                best = d
    return best


def torso_area(path, thr=100, e=8):
    a = np.array(Image.open(path).convert('RGBA'))[:, :, 3]
    m = np.zeros_like(a, bool)
    m[TORSO_Y[0]:TORSO_Y[1], BAND[0]:BAND[1]] = a[TORSO_Y[0]:TORSO_Y[1], BAND[0]:BAND[1]] > thr
    return int(ndi.binary_erosion(m, np.ones((e, e), bool)).sum())


def silhouette_area(path, thr=100):
    """整幅 alpha 面积。判据是「整体体量」，对尾巴敏感——只用于无高举大尾巴/无肢体
    大位移的姿态（如 pet），且必须配合 --uniform 使用，避免逐帧缩放导致帧间抖动。"""
    return int((np.array(Image.open(path).convert('RGBA'))[:, :, 3] > thr).sum())


def bbox_height(path, thr=100):
    """底边锚定的整体高度（y_max - y_min + 1），线性量。

    站在地面上的角色，「可视高度」最接近人眼判断「这只猫有多大」。对耷拉耳、绕身
    尾巴不敏感——它们改的是宽度，不改高度；也因此不会出现躯干带那样的饱和。
    前提是各帧底边一致（本项目统一 468），跨帧可比。
    """
    a = np.array(Image.open(path).convert('RGBA'))[:, :, 3]
    rows = np.where((a > thr).any(axis=1))[0]
    return int(rows[-1] - rows[0] + 1) if len(rows) else 0


def measure(path, metric):
    if metric == 'eye':
        return eye_gap(path)
    if metric == 'torso':
        return torso_area(path)
    if metric == 'height':
        return bbox_height(path)
    return silhouette_area(path)


def pose_frames(pose):
    return sorted(f for f in os.listdir(FRAMES)
                  if f.startswith(pose + '_') and f.endswith('.png'))


def scale_about_anchor(im, k):
    w = max(1, int(round(SIZE * k)))
    small = im.resize((w, w), Image.LANCZOS)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(small, (int(round(ANCHOR_X * (1 - k))), int(round(ANCHOR_Y * (1 - k)))))
    return out


def ref_target(ref, metric):
    """基准 = 单帧（idle_1）或整组均值（idle）。组均值可抹掉基准自身的帧间波动。"""
    if os.path.exists(os.path.join(FRAMES, ref + '.png')):
        p = os.path.join(FRAMES, ref + '.png')
        v = measure(p, metric)
        return (v, f'{ref}') if v else (None, ref)
    frames = pose_frames(ref)
    vals = [measure(os.path.join(FRAMES, f), metric) for f in frames]
    vals = [v for v in vals if v]
    if not vals:
        return None, ref
    return sum(vals) / len(vals), f'{ref} 组均值（{len(vals)} 帧）'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pose')
    ap.add_argument('--ref', default='idle_1')
    ap.add_argument('--metric', choices=['eye', 'torso', 'area', 'height'], default='eye')
    ap.add_argument('--uniform', action='store_true',
                    help='组内统一系数（取均值），避免逐帧缩放引入帧间尺寸抖动')
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    target, ref_label = ref_target(args.ref, args.metric)
    if not target:
        raise SystemExit(f'基准 {args.ref} 在 {args.metric} 口径下测不到')

    frames = pose_frames(args.pose)
    if not frames:
        raise SystemExit(f'找不到 {args.pose}_*.png')

    print(f'基准 {ref_label}: {args.metric} = {target:.1f}')

    # eye / height 是线性量（比值即系数）；torso / area 是面积量，需开方才能得到线性系数
    def linear(v):
        return target / v if args.metric in ('eye', 'height') else (target / v) ** 0.5

    plan = []
    for f in frames:
        p = os.path.join(FRAMES, f)
        v = measure(p, args.metric)
        if not v:
            raise SystemExit(f'{f} 在 {args.metric} 口径下测不到，换口径或改用 --metric torso')
        plan.append((f, v, linear(v)))
        print(f'  {f:<14} {args.metric}={v:9.1f}  系数={plan[-1][2]:.4f}')

    ks = [k for _, _, k in plan]
    print(f'  组内系数跨度 {min(ks):.4f}~{max(ks):.4f}（{(max(ks)/min(ks)-1)*100:.1f}%）')

    if args.uniform:
        ku = sum(ks) / len(ks)
        plan = [(f, v, ku) for f, v, _ in plan]
        print(f'  组内统一系数 {ku:.4f}（消除帧间尺寸抖动，允许单帧与基准有 ±{(max(ks)/min(ks)-1)*50:.1f}% 的差）')

    if args.dry:
        print('\n[dry] 未写入')
        return

    os.makedirs(BACKUP, exist_ok=True)
    for f, _, k in plan:
        p = os.path.join(FRAMES, f)
        shutil.copy2(p, os.path.join(BACKUP, f))
        scale_about_anchor(Image.open(p).convert('RGBA'), k).save(p)

    print('\n归一后复测：')
    vals = []
    for f, _, _ in plan:
        p = os.path.join(FRAMES, f)
        v = measure(p, args.metric)
        vals.append(v)
        print(f'  {f:<14} {args.metric}={v:9.1f}  与基准差 {(v / target - 1) * 100:+.1f}%')
    print(f'  组内跨度 {min(vals):.1f}~{max(vals):.1f}（{(max(vals)/min(vals)-1)*100:.1f}%）')
    print(f'  组均值与基准差 {(sum(vals)/len(vals)/target - 1)*100:+.1f}%')
    print(f'原始帧已备份到 {BACKUP}')


if __name__ == '__main__':
    main()
