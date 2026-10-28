# -*- coding: utf-8 -*-
"""循环接缝审计：逐帧量 alpha 掩膜 IoU / 质心位移 / 面积差，重点看「末帧 → 首帧」这一刀。

用法：python tools/sprites/loop_seam_audit.py [姿态名 ...]
     默认审计全部多帧循环姿态（walk run idle eat play bath tailwag ... 中实际存在的）。

判读：接缝 IoU 只要与同组普通相邻帧同量级，就说明循环衔接不比正常步态更陡。
"""
import os
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
from _root import find_root  # noqa: E402

ROOT = find_root()
FRAMES = os.path.join(ROOT, 'app', 'assets', 'sprites', 'frames')

CYCLE_POSES = ['walk', 'run', 'idle', 'eat', 'play', 'bath', 'tailwag', 'sleep', 'meow', 'lick', 'pet', 'stretch']
FPS = {'walk': 11, 'run': 13, 'idle': 5, 'eat': 6, 'play': 8, 'bath': 6,
       'tailwag': 7, 'sleep': 4, 'meow': 7, 'lick': 5, 'pet': 6, 'stretch': 5}


def load(name):
    a = np.array(Image.open(os.path.join(FRAMES, name)).convert('RGBA'))[:, :, 3]
    m = a > 8
    ys, xs = np.nonzero(m)
    return m, (xs.mean(), ys.mean()), int(m.sum())


def audit(pose):
    fs = [f'{pose}_{i}.png' for i in range(1, 40)]
    fs = [f for f in fs if os.path.isfile(os.path.join(FRAMES, f))]
    if len(fs) < 2:
        return None
    data = [load(f) for f in fs]
    rows = []
    for i in range(len(fs)):
        j = (i + 1) % len(fs)
        mi, ci, ai = data[i]
        mj, cj, aj = data[j]
        rows.append({
            'pair': f'{fs[i][:-4]}->{fs[j][:-4]}',
            'seam': j == 0,
            'iou': (mi & mj).sum() / max(1, (mi | mj).sum()),
            'dx': abs(ci[0] - cj[0]),
            'dy': abs(ci[1] - cj[1]),
            'darea': aj - ai,
        })
    return {'pose': pose, 'n': len(fs), 'fps': FPS.get(pose), 'rows': rows}


def main():
    poses = sys.argv[1:] or CYCLE_POSES
    out = [a for a in (audit(p) for p in poses) if a]
    for a in out:
        cycle = (a['n'] / a['fps']) if a['fps'] else None
        head = f"=== {a['pose']}  {a['n']} 帧"
        if cycle:
            head += f" @ {a['fps']} fps  单轮 {cycle:.4f}s"
        print(head + ' ===')
        for r in a['rows']:
            mark = '  <-- 循环接缝' if r['seam'] else ''
            print(f"  {r['pair']:<26} IoU={r['iou']:.4f}  质心Δ=({r['dx']:.1f},{r['dy']:.1f})"
                  f"  面积Δ={r['darea']:>6}{mark}")
        seam = [r for r in a['rows'] if r['seam']]
        others = [r['iou'] for r in a['rows'] if not r['seam']]
        if seam and others:
            s = seam[0]['iou']
            verdict = 'OK' if s >= min(others) - 0.05 else '注意：接缝明显更陡'
            print(f"  接缝判定: IoU {s:.4f} vs 普通帧区间 [{min(others):.4f}, {max(others):.4f}] → {verdict}")
        print('')


if __name__ == '__main__':
    main()
