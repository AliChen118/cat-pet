# -*- coding: utf-8 -*-
"""按当前节奏（5 fps + lick_2 额外停留 150 ms）重生成舔爪子节奏预览图。

输出：design/preview-lick-paw.gif（512 画布，4 帧，单轮 0.95 s，无限循环）
同时输出一张横向条带 design/preview-lick-paw-strip.png 便于静态查看。
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
from _root import find_root  # noqa: E402

ROOT = find_root()
FRAMES = [os.path.join(ROOT, 'app', 'assets', 'sprites', 'frames', f'lick_{i}.png')
          for i in range(1, 5)]
OUT_GIF = os.path.join(ROOT, 'design', 'preview-lick-paw.gif')
OUT_STRIP = os.path.join(ROOT, 'design', 'preview-lick-paw-strip.png')

FPS = 5
BASE_MS = int(round(1000.0 / FPS))          # 200 ms
HOLD_MS = 150                                # lick_2 额外停留
DUR = [BASE_MS, BASE_MS + HOLD_MS, BASE_MS, BASE_MS]   # 200/350/200/200 = 950 ms
LABELS = ['lick_1  抬爪', 'lick_2  舔爪 (hold)', 'lick_3  擦脸', 'lick_4  收爪']

BG = (255, 255, 255)

FONT_CANDIDATES = [
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\msyhl.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
    r'C:\Windows\Fonts\simsun.ttc',
]


def load_font(px):
    """PIL 默认位图字体不含中文字形，会渲染成方框，这里显式加载系统字体。"""
    for p in FONT_CANDIDATES:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, px)
            except OSError:
                continue
    return ImageFont.load_default()


def flat(path):
    im = Image.open(path).convert('RGBA')
    bg = Image.new('RGBA', im.size, BG + (255,))
    return Image.alpha_composite(bg, im).convert('RGB')


def main():
    assert os.path.isdir(os.path.dirname(OUT_GIF))
    ims = [flat(p) for p in FRAMES]
    size = ims[0].size

    # ---- GIF：P 模式 + 自适应调色板，单轮 0.95 s 无限循环 ----
    pal = [im.convert('P', palette=Image.ADAPTIVE, colors=128) for im in ims]
    pal[0].save(OUT_GIF, save_all=True, append_images=pal[1:],
                duration=DUR, loop=0, disposal=2, optimize=True)

    # ---- 静态条带 ----
    pad, top, cap = 12, 34, 56
    W = len(ims) * size[0] + pad * (len(ims) + 1)
    H = top + size[1] + cap + pad
    strip = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(strip)
    f_tag = load_font(20)
    f_lab = load_font(18)
    f_ms = load_font(16)
    t = 0
    for i, im in enumerate(ims):
        x = pad + i * (size[0] + pad)
        strip.paste(im, (x, top))
        d.text((x + 6, 8), f'F{i + 1}', fill=(20, 20, 20), font=f_tag)
        d.text((x + 6, top + size[1] + 8), LABELS[i], fill=(20, 20, 20), font=f_lab)
        d.text((x + 6, top + size[1] + 32),
               f'{DUR[i]} ms    t={t} ms', fill=(90, 90, 90), font=f_ms)
        t += DUR[i]
    strip.save(OUT_STRIP)

    print(f'[ok] {OUT_GIF}  {os.path.getsize(OUT_GIF) / 1024:.1f} KB  '
          f'frames={len(ims)} dur={DUR} total={sum(DUR)} ms')
    print(f'[ok] {OUT_STRIP}  {os.path.getsize(OUT_STRIP) / 1024:.1f} KB  size={strip.size}')


if __name__ == '__main__':
    main()
