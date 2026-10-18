"""normalize_sequence.py — 动画序列归一化（躯干对齐版）

AI 逐帧生成时身体本身会画歪，直接按 bbox/质心对齐都会产生横向抖动。
本方案：对 alpha 做形态学腐蚀剥离细腿，得到「躯干核心」掩码；
以序列首帧的躯干核心为模板，用 IoU 模板匹配求其余帧的最优水平位移，
把身体严格对齐；垂直方向仍按内容底边对齐地面基线。

缩放：全序列统一比例（由最大帧决定），杜绝大小跳动。

用法：
    python normalize_sequence.py --outdir <目录> --prefix walk_ <抠图后的帧...>
"""
import argparse
import glob
import os

import numpy as np
from PIL import Image
from scipy import ndimage


def body_core(alpha, erode=10, thresh=100):
    """腐蚀掉细腿，保留躯干核心"""
    return ndimage.binary_erosion(alpha > thresh, iterations=erode)


def best_shift(ref, mask, max_shift=160):
    """在 [-max_shift, max_shift] 内寻找使 IoU 最大的水平位移"""
    ref_area = int(ref.sum())
    best_dx, best_iou = 0, -1.0
    for dx in range(-max_shift, max_shift + 1):
        shifted = np.roll(mask, dx, axis=1)
        if dx > 0:
            shifted[:, :dx] = False
        elif dx < 0:
            shifted[:, dx:] = False
        inter = int((ref & shifted).sum())
        union = ref_area + int(mask.sum()) - inter
        iou = inter / union if union else 0.0
        if iou > best_iou:
            best_iou, best_dx = iou, dx
    return best_dx, best_iou


def measure(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im.getchannel("A"))
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    return {
        "img": im, "alpha": a,
        "x0": x0, "y0": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1,
        "core": body_core(a),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--canvas", type=int, default=512)
    ap.add_argument("--ground", type=int, default=470)
    ap.add_argument("--height", type=int, default=400)
    ap.add_argument("--pad", type=int, default=6)
    ap.add_argument("--erode", type=int, default=10)
    args = ap.parse_args()

    paths = []
    for p in args.inputs:
        paths.extend(glob.glob(p) if any(c in p for c in "*?[") else [p])
    paths = sorted(set(paths))
    items = [(p, measure(p)) for p in paths]
    items = [(p, m) for p, m in items if m]
    if not items:
        raise SystemExit("没有有效输入")

    maxh = max(m["h"] for _, m in items)
    maxw = max(m["w"] for _, m in items)
    scale = min(args.height / maxh, (args.canvas - 2 * args.pad) / maxw)

    ref_core = items[0][1]["core"]
    os.makedirs(args.outdir, exist_ok=True)

    print(f"[seq] scale={scale:.4f}  maxbbox={maxw}x{maxh}  frames={len(items)}")
    for i, (p, m) in enumerate(items, start=1):
        dx, iou = best_shift(ref_core, m["core"])
        crop = m["img"].crop((m["x0"], m["y0"], m["x0"] + m["w"], m["y0"] + m["h"]))
        nw, nh = max(1, round(m["w"] * scale)), max(1, round(m["h"] * scale))
        crop = crop.resize((nw, nh), Image.LANCZOS)

        # 水平：躯干核心对齐到画布中心；垂直：内容底边对齐地面
        core = ndimage.binary_erosion(
            np.asarray(crop.getchannel("A")) > 100, iterations=max(1, round(args.erode * scale))
        )
        ys, xs = np.where(core)
        core_cx = xs.mean() if len(xs) else nw / 2
        left = round(args.canvas / 2 - core_cx) - round(dx * scale)
        top = args.ground - nh

        out = Image.new("RGBA", (args.canvas, args.canvas), (0, 0, 0, 0))
        out.paste(crop, (left, top), crop)
        dst = os.path.join(args.outdir, f"{args.prefix}{i}.png")
        out.save(dst)
        print(f"  {os.path.basename(dst)}: {nw}x{nh} pos=({left},{top})  躯干位移={dx:+d}px  IoU={iou:.3f}")


if __name__ == "__main__":
    main()
