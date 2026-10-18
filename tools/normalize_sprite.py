"""normalize_sprite.py — 姿态图归一化

将抠图后的 RGBA 图裁剪到内容边界，按目标高度等比缩放，
粘贴到统一画布中央，并使内容底边对齐到固定地面基线，
便于动画引擎以一致的锚点渲染与位移。

用法：
    python normalize_sprite.py <输入.png> <输出.png> [--canvas 512] [--ground 470] [--height 400]
"""
import argparse
import os

import numpy as np
from PIL import Image


def normalize(src, dst, canvas=512, ground=470, height=400, pad=6):
    im = Image.open(src).convert("RGBA")
    alpha = np.asarray(im.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise RuntimeError(f"{src} 无有效内容")
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()

    crop = im.crop((x0, y0, x1 + 1, y1 + 1))
    w, h = crop.size
    scale = min(height / h, (canvas - 2 * pad) / w)
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    crop = crop.resize((nw, nh), Image.LANCZOS)

    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    cx = (canvas - nw) // 2
    cy = ground - nh
    out.paste(crop, (cx, cy), crop)

    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    out.save(dst)
    print(f"[ok] {dst} | src_crop={w}x{h} -> {nw}x{nh} | anchor=({cx},{cy}) canvas={canvas}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--canvas", type=int, default=512)
    ap.add_argument("--ground", type=int, default=470)
    ap.add_argument("--height", type=int, default=400)
    args = ap.parse_args()
    normalize(args.src, args.dst, args.canvas, args.ground, args.height)


if __name__ == "__main__":
    main()
