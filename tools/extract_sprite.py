"""extract_sprite.py — 纯色背景自动抠图工具

用途：将 ImageGen 生成的纯色背景图转换为透明背景 PNG。
自动采样图像四角推定背景色（无需硬编码洋红阈值），
按颜色距离生成背景掩码，仅移除与图像边界连通的外部背景，
避免误删角色内部相近色像素；同时按特征签名剔除右下角平台水印。

用法：
    python extract_sprite.py <输入.png> <输出.png> [--thresh 80] [--erode 1] [--blur 1.3]
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def detect_bg_color(arr, patch=24):
    """采样四角小块的中位色作为背景色。"""
    h, w, _ = arr.shape
    corners = [
        arr[:patch, :patch], arr[:patch, w - patch:],
        arr[h - patch:, :patch], arr[h - patch:, w - patch:],
    ]
    px = np.concatenate([c.reshape(-1, 3) for c in corners], axis=0)
    return np.median(px, axis=0)


def extract_alpha(rgb, thresh=80.0):
    arr = np.asarray(rgb).astype(np.float32)
    bg = detect_bg_color(arr)
    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    bg_mask = dist < thresh

    frac = float(bg_mask.mean())
    if frac < 0.05:
        raise RuntimeError(f"背景占比过低({frac:.3%})，背景色估计可能失败: {bg}")

    lbl, n = ndimage.label(bg_mask)
    if n == 0:
        raise RuntimeError("未检测到背景连通域")
    border_labels = set(np.unique(np.concatenate([
        lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]
    ]))) - {0}
    background = np.isin(lbl, list(border_labels))

    # 剔除右下角平台水印：半透明白字叠加在纯色背景上，特征是
    # 与背景色方向接近但亮度被显著抬高。用「比背景更亮且接近背景色相」判定。
    # 候选区内的像素还需满足「与主体不连通」才剔除——角色（如尾巴）进入
    # 右下角时，其与背景交界的反光像素同样满足亮度特征，必须保留。
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    bgc = bg.astype(np.float32)
    lighter = (dist < thresh * 2.2) & (
        (r - bgc[0]) + (g - bgc[1]) + (b - bgc[2]) > 45
    )
    h, w = background.shape
    corner = np.zeros_like(background)
    corner[int(h * 0.86):, int(w * 0.76):] = True
    wm_cand = lighter & corner
    if wm_cand.any():
        # 只把「主体角色」（非背景中最大的连通域）视为需保护的内容：
        # 水印文字同样是非背景前景，若整体保护会原样残留。
        content = ~background
        lbl_c, n_c = ndimage.label(content)
        if n_c:
            sizes = ndimage.sum(content, lbl_c, range(1, n_c + 1))
            main = lbl_c == (int(np.argmax(sizes)) + 1)
            content_d = ndimage.binary_dilation(main, iterations=3)
            wm_cand = wm_cand & ~content_d
        wm = ndimage.binary_dilation(wm_cand, iterations=2)
        background = background | wm

    return np.where(background, 0, 255).astype(np.uint8)


def remove_pockets(background, rgb, dist, thresh, min_area):
    """剔除封闭在轮廓内的背景口袋（如尾巴与身体之间的缝隙）。

    仅当口袋面积 >= min_area 且其颜色确属背景（dist 已由 bg_mask 保证）时
    转为透明；小面积彩色斑块（内耳、腮红等主体色）面积远小于阈值，不受影响。
    """
    if min_area <= 0:
        return background
    pockets = (~background) & (dist < thresh)
    lbl, n = ndimage.label(pockets)
    if n == 0:
        return background
    sizes = ndimage.sum(pockets, lbl, range(1, n + 1))
    big = np.isin(lbl, [i + 1 for i, s in enumerate(sizes) if s >= min_area])
    return background | big


def despill(rgb, alpha, k=25.0):
    """去除品红背景对轮廓描边的染色（magenta spill）。

    品红污染特征：G 显著低于 R/B（G < min(R,B) - 12）。将其 R/B 收敛到
    G + k，把品红描边压成中性深色（与原始帧的深棕描边一致）。
    腮红/内耳等粉色 G 高于 min(R,B) - 12，不受影响。
    """
    arr = np.asarray(rgb).astype(np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    spill = g < np.minimum(r, b) - 12.0
    # 只处理靠近轮廓的区域（alpha 边缘带），避免大范围改色
    edge = np.asarray(alpha) > 0
    edge = edge & ~ndimage.binary_erosion(edge, iterations=6)
    m = spill & edge
    if not m.any():
        return rgb
    cap = g + k
    arr[:, :, 0] = np.where(m, np.minimum(r, cap), r)
    arr[:, :, 2] = np.where(m, np.minimum(b, cap), b)
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), mode="RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--thresh", type=float, default=80.0)
    ap.add_argument("--erode", type=int, default=1)
    ap.add_argument("--blur", type=float, default=1.3)
    ap.add_argument("--pockets", type=int, default=0,
                    help="剔除封闭背景口袋的最小面积(px)，0=关闭")
    ap.add_argument("--despill", type=float, default=0.0,
                    help="品红去污染收敛量 k，0=关闭")
    args = ap.parse_args()

    im = Image.open(args.src).convert("RGB")
    arr = np.asarray(im).astype(np.float32)
    bg = detect_bg_color(arr)
    dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))
    bg_mask = dist < args.thresh
    frac = float(bg_mask.mean())
    if frac < 0.05:
        raise RuntimeError(f"背景占比过低({frac:.3%})，背景色估计可能失败: {bg}")
    lbl, n = ndimage.label(bg_mask)
    if n == 0:
        raise RuntimeError("未检测到背景连通域")
    border_labels = set(np.unique(np.concatenate([
        lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]
    ]))) - {0}
    background = np.isin(lbl, list(border_labels))

    # 剔除右下角平台水印：半透明白字叠加在纯色背景上，特征是
    # 与背景色方向接近但亮度被显著抬高。用「比背景更亮且接近背景色相」判定。
    # 候选区内的像素还需满足「与主体不连通」才剔除——角色（如尾巴）进入
    # 右下角时，其与背景交界的反光像素同样满足亮度特征，必须保留。
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    bgc = bg.astype(np.float32)
    lighter = (dist < args.thresh * 2.2) & (
        (r - bgc[0]) + (g - bgc[1]) + (b - bgc[2]) > 45
    )
    h, w = background.shape
    corner = np.zeros_like(background)
    corner[int(h * 0.86):, int(w * 0.76):] = True
    wm_cand = lighter & corner
    if wm_cand.any():
        content = ~background
        lbl_c, n_c = ndimage.label(content)
        if n_c:
            sizes = ndimage.sum(content, lbl_c, range(1, n_c + 1))
            main_c = lbl_c == (int(np.argmax(sizes)) + 1)
            content_d = ndimage.binary_dilation(main_c, iterations=3)
            wm_cand = wm_cand & ~content_d
        wm = ndimage.binary_dilation(wm_cand, iterations=2)
        background = background | wm

    background = remove_pockets(background, arr, dist, args.thresh, args.pockets)

    # 清理孤立噪点：保留最大内容连通域 + 面积 >= 最大域 1% 的组件
    content = ~background
    lbl_k, n_k = ndimage.label(content)
    if n_k > 1:
        sizes_k = ndimage.sum(content, lbl_k, range(1, n_k + 1))
        keep = {i + 1 for i, s in enumerate(sizes_k) if s >= max(sizes_k) * 0.01}
        drop = ~np.isin(lbl_k, list(keep))
        background = background | drop

    a = Image.fromarray(np.where(background, 0, 255).astype(np.uint8), mode="L")
    if args.erode > 0:
        a = a.filter(ImageFilter.MinFilter(1 + 2 * args.erode))
    if args.blur > 0:
        a = a.filter(ImageFilter.GaussianBlur(args.blur))

    if args.despill > 0:
        im = despill(im, a, k=args.despill)

    out = im.convert("RGBA")
    out.putalpha(a)

    os.makedirs(os.path.dirname(args.dst) or ".", exist_ok=True)
    out.save(args.dst)
    print(f"[ok] {args.dst} | bg={bg.astype(int).tolist()} "
          f"| alpha_range={a.getextrema()} bbox={out.getbbox()}")


if __name__ == "__main__":
    main()
