# -*- coding: utf-8 -*-
"""fix_pose_frames.py — 一次性统一全部姿态帧的「尺度 / 横向对位 / 落地基线」。

解决的问题（详见 .workbuddy/artifacts/pose-audit-1.1.9.md）：

  A 姿态之间尺寸不齐    play/jump 眼距只有 idle 的 84%、lick 93%、meow 97%、bath 106%
  B 同一姿态内帧间波动  play 眼距跨度 5.2%、bath 10.8%、tailwag 1.0%
  D 锚点/边界异常       meow_2 整帧上浮 7 px、lick_3 穿地 1 px、unhappy 底边 468
  E 硬切横向抖动        run 躯干质心极差 31 px、walk 26 px
  F 运行时缩放过渡      bath 靠 POSE_SCALE=0.87 兜底（本次烘焙进素材后可清空）
  D-4 横向顶满          walk_3/walk_4 左界 253 = SPRITE_HALF_W，余量 0 px

做法（对每一帧独立执行，三步固定顺序）：

  1. 绕锚点 (256, 470) 等比缩放 k —— 只有 RULES 里 k≠1 的姿态才动；
  2. 平移 dx 使「腐蚀核心质心 x」= 256 —— 与项目其余姿态的对位口径完全一致
     （normalize_sequence.py 的躯干模板匹配对「帧间体型差异大」的序列会失配，
     直接钉质心更稳，且全库其余 12 个姿态的质心本来就落在 255.5~256.5）；
  3. 平移 dy 使「内容底边」= GROUND_LINE（469，全库当前共识值）。

  缩放与平移都做画布溢出检查，任何一帧被裁切都会报 FAIL 并中止。

可重入保护：本脚本只允许跑一次。原始帧备份到 `_backup/pose-fix-orig/`；
若该目录已存在则拒绝执行（避免二次变换累积），需要重跑时先 --restore。

用法：
    python tools/sprites/fix_pose_frames.py --dry     # 只看计划
    python tools/sprites/fix_pose_frames.py           # 执行
    python tools/sprites/fix_pose_frames.py --restore # 从备份还原
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
SPRITES = os.path.join(ROOT, 'app', 'assets', 'sprites')
FRAMES = os.path.join(SPRITES, 'frames')
BACKUP = os.path.join(ROOT, '_backup', 'pose-fix-orig')

ANCHOR_X, ANCHOR_Y = 256.0, 470.0   # 与 animator 的 SPRITE_CENTER / SPRITE_GROUND 对应
SIZE = 512
GROUND_LINE = 469                   # 修复后全库统一的内容底边
CORE_ERODE = 10                     # 与 normalize_sequence.py 的躯干核心口径一致
ALPHA_THR = 8

# 姿态 -> (缩放系数, 依据)。系数来源见文件头注释与 README 的「姿态尺寸一致性」。
RULES = {
    'idle':    (1.000, '基准姿态，只做质心/底边归位'),
    'meow':    (1.030, '眼距 93.4 → 96.2（+2.9%）'),
    'walk':    (0.930, '侧视站立：面积 108%→93.4%，并换取横向对位余量'),
    'run':     (0.900, '侧视奔跑：面积 119%→96.4%，并换取横向对位余量'),
    'drag':    (0.930, '与 walk 同尺度（同为侧视站立）'),
    # jump / play 是「头小身大」的素材：头只有 idle 的 84–87%（眼距与耳距同口径），
    # 但身高已齐平、面积已 101%/91%。等比拉到头对齐会让整体面积飙到 142%/129%。
    # 取立方根均衡系数 k=(1/(eye·area))^(1/3)：头修到 89%/92%、整体 112%/109%，
    # 两边各偏 8–12%，比单向偏 16% 好得多。彻底解决需重画这两组素材。
    'jump':    (1.056, '立方根均衡：头 84%→89%，整体 101%→112%'),
    'play':    (1.093, '立方根均衡：头 84%→92%，整体 91%→109%'),
    'stretch': (1.000, '侧视伸展，面积 96.6% 已合格'),
    'sleep':   (1.000, '蜷缩姿态，面积 92.6% 已合格'),
    'eat':     (1.000, '侧视低头，面积 95.3% 已合格'),
    'pet':     (1.000, '已按面积口径烘焙（面积 100.1%），闭眼帧眼距不可靠'),
    'tailwag': (0.995, '眼距 96.7 → 96.2 微调，顺带统一 1.0% 帧间跨度'),
    'unhappy': (1.000, '已按底边锁高口径烘焙（高度 99.7%）'),
    'bath':    (0.943, '眼距中位数 102.0 → 96.2，替代运行时 POSE_SCALE=0.87'),
    'lick':    (1.072, '眼距 89.7 → 96.2（+6.7%）'),
}


def rgba(path):
    return Image.open(path).convert('RGBA')


def alpha_mask(im):
    return np.array(im.getchannel('A')) > ALPHA_THR


def core_cx(im):
    """腐蚀核心质心 x；与 normalize_sequence.py 的躯干核心口径一致。"""
    a = np.array(im.getchannel('A'))
    core = ndi.binary_erosion(a > 100, iterations=CORE_ERODE)
    xs = np.nonzero(core)[1]
    return float(xs.mean()) if len(xs) else float('nan')


def bounds(im):
    """返回 (left, right, top, bottom) 的内容边界（含端点）。"""
    m = alpha_mask(im)
    ys, xs = np.nonzero(m)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())


def scaled(im, k):
    """绕 (256, 470) 等比缩放，画布保持 512×512。"""
    if abs(k - 1.0) < 1e-6:
        return im.copy()
    w = max(1, int(round(SIZE * k)))
    small = im.resize((w, w), Image.LANCZOS)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(small, (int(round(ANCHOR_X * (1 - k))), int(round(ANCHOR_Y * (1 - k)))))
    return out


def shifted(im, dx, dy):
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(im, (int(dx), int(dy)))
    return out


def frames_of(pose):
    if pose == 'drag':
        p = os.path.join(SPRITES, 'drag.png')
        return [(p, 'drag.png')] if os.path.exists(p) else []
    out = []
    for f in sorted(os.listdir(FRAMES)):
        if f.startswith(pose + '_') and f.endswith('.png'):
            out.append((os.path.join(FRAMES, f), f))
    return out


def plan_all():
    plan = []
    for pose, (k, why) in RULES.items():
        items = frames_of(pose)
        if not items:
            print('[WARN] %s 找不到帧，跳过' % pose)
            continue
        for path, name in items:
            im = rgba(path)
            s = scaled(im, k)
            b = bounds(s)
            if b is None:
                print('[FAIL] %s 缩放后为空' % name)
                raise SystemExit(1)
            left, right, top, bot = b
            cx = core_cx(s)
            dx = int(round(ANCHOR_X - cx))
            dy = int(round(GROUND_LINE - bot))
            plan.append(dict(pose=pose, path=path, name=name, k=k, why=why,
                             im=s, dx=dx, dy=dy, left=left, right=right, top=top, bot=bot))
    return plan


def verify_plan(plan):
    """画布溢出检查：平移后内容必须完整落在 [0,511]。"""
    bad = False
    for p in plan:
        nl, nr = p['left'] + p['dx'], p['right'] + p['dx']
        nt, nb = p['top'] + p['dy'], p['bot'] + p['dy']
        p['nl'], p['nr'], p['nt'], p['nb'] = nl, nr, nt, nb
        if nl < 0 or nr > SIZE - 1 or nt < 0 or nb > SIZE - 1:
            print('[FAIL] %-14s 平移后溢出画布: x[%d,%d] y[%d,%d]' % (p['name'], nl, nr, nt, nb))
            bad = True
        elif min(nl, SIZE - 1 - nr) < 2:
            print('[WARN] %-14s 横向余量仅 %d px' % (p['name'], min(nl, SIZE - 1 - nr)))
    if bad:
        raise SystemExit('存在溢出帧，已中止（未写入任何文件）')
    return plan


def stats(plan):
    """按姿态汇总：眼距、质心极差、底边。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'nps', os.path.join(ROOT, 'tools', 'sprites', 'normalize_pose_size.py'))
    nps = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(nps)

    tmp = os.path.join(os.environ.get('TEMP', '/tmp'), '_posefix_tmp.png')
    agg = {}
    for p in plan:
        p['im'].save(tmp)
        v = nps.eye_gap(tmp)
        agg.setdefault(p['pose'], []).append(v)
    if os.path.exists(tmp):
        os.remove(tmp)
    return agg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true', help='只打印计划，不写文件')
    ap.add_argument('--restore', action='store_true', help='从 _backup/pose-fix-orig 还原')
    args = ap.parse_args()

    if args.restore:
        if not os.path.isdir(BACKUP):
            raise SystemExit('没有备份目录 %s，无需还原' % BACKUP)
        n = 0
        for f in os.listdir(BACKUP):
            dst = os.path.join(SPRITES, f) if f == 'drag.png' else os.path.join(FRAMES, f)
            shutil.copy2(os.path.join(BACKUP, f), dst)
            n += 1
        shutil.rmtree(BACKUP)
        print('[restore] %d 个文件已还原，备份目录已删除' % n)
        return

    if os.path.isdir(BACKUP):
        raise SystemExit(
            '检测到 %s 已存在 —— 本脚本只能跑一次（二次变换会累积）。\n'
            '要重跑请先：python tools/sprites/fix_pose_frames.py --restore' % BACKUP)

    plan = verify_plan(plan_all())

    print('%-9s %-14s %6s %5s %5s  %-22s %s' % (
        'pose', 'file', 'k', 'dx', 'dy', '平移后 x/y', '余量'))
    for p in plan:
        margin = min(p['nl'], SIZE - 1 - p['nr'])
        print('%-9s %-14s %6.3f %+5d %+5d  x[%3d,%3d] y[%3d,%3d] %3d px  %s' % (
            p['pose'], p['name'], p['k'], p['dx'], p['dy'],
            p['nl'], p['nr'], p['nt'], p['nb'], margin, p['why']))

    if args.dry:
        print('\n[dry] 未写入任何文件')
        return

    os.makedirs(BACKUP, exist_ok=True)
    for p in plan:
        shutil.copy2(p['path'], os.path.join(BACKUP, p['name']))
        shifted(p['im'], p['dx'], p['dy']).save(p['path'])
    print('\n[write] %d 帧已写入；原始帧备份在 %s' % (len(plan), BACKUP))

    # ---- 落盘后复测 ----
    print('\n复测（读回磁盘文件）:')
    print('%-9s %-14s %8s %8s %8s %10s' % ('pose', 'file', 'coreCx', 'bottom', 'height', 'area'))
    per = {}
    for pose in RULES:
        for path, name in frames_of(pose):
            im = rgba(path)
            b = bounds(im)
            cx = core_cx(im)
            m = alpha_mask(im)
            area = int(m.sum())
            per.setdefault(pose, []).append((cx, b[3], b[2], area))
            print('%-9s %-14s %8.1f %8d %8d %10d' % (
                pose, name, cx, b[3], b[3] - b[2] + 1, area))
        rows = per[pose]
        cxs = [r[0] for r in rows]
        bots = {r[1] for r in rows}
        print('%-9s %-14s 质心极差 %.1f px  底边 %s' % (
            '', '>> 汇总', max(cxs) - min(cxs), sorted(bots)))
        print()

    agg = stats([dict(pose=p, im=rgba(path), name=n)
                 for p in RULES for path, n in frames_of(p)])
    print('眼距复核（目标 96.18，仅列可测帧）:')
    for pose in RULES:
        vals = [v for v in agg.get(pose, []) if v]
        if vals:
            mean = sum(vals) / len(vals)
            print('  %-9s 均值 %6.2f (%+.1f%%)  跨度 %.1f%%  可测 %d/%d' % (
                pose, mean, (mean / 96.18 - 1) * 100,
                (max(vals) / min(vals) - 1) * 100 if len(vals) > 1 else 0.0,
                len(vals), len(agg[pose])))

    print('\n下一步：python tools/sprites/sprite_bounds.py  # 重算 CONTENT_TOP_FALLBACK + 横向余量')


if __name__ == '__main__':
    main()
