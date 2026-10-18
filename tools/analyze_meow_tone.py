#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""analyze_meow_tone.py — 喵叫素材「音色」客观测量

输出每条素材的：时长 / 响度 / 谱重心 / 高频占比 / 刺耳带(3–5k)占比 /
Zwicker 尖锐度(acum) / 温暖带(200–500Hz)占比 / 估算基频。

用途：
  1) 改素材前后做客观对比（尖锐度↓、重心↓、温暖带↑ 是「柔和化」的可验证指标）；
  2) 找出个别仍偏尖的条目，只针对它加参数。

用法：python tools/analyze_meow_tone.py [--dir 目录] [--csv 输出.csv]
"""
import argparse
import glob
import os
import sys

import numpy as np
import soundfile as sf

SR_TARGET = 44100

# Bark 域边界（Zwicker）：z = 13*atan(0.00076 f) + 3.5*atan((f/7500)^2)
def bark(f):
    return 13.0 * np.arctan(0.00076 * f) + 3.5 * np.arctan((f / 7500.0) ** 2)


def zwicker_sharpness(freqs, power):
    """Zwicker 尖锐度（acum）。>16 Bark(约 3.3kHz) 起权重快速上升，正是「刺耳」的量化。"""
    # 按 0.5 Bark 分组
    z = bark(freqs)
    edges = np.arange(0, z.max() + 0.5, 0.5)
    idx = np.digitize(z, edges) - 1
    n = len(edges) - 1
    excit = np.zeros(n)
    for i in range(len(freqs)):
        if 0 <= idx[i] < n:
            excit[idx[i]] += power[i]
    if excit.sum() <= 0:
        return 0.0
    zc = edges[:-1] + 0.25
    g = np.where(zc <= 16.0, 1.0, 0.066 * np.exp(0.171 * zc))
    num = np.sum(excit * g * zc)
    den = np.sum(excit) + 1e-12
    return float(0.11 * num / den)


def est_f0(m, sr):
    """自相关估基频（60–1200Hz），取中位稳健值"""
    n = min(len(m), int(0.12 * sr))
    if n < 256:
        return 0.0
    # 取能量最大的一段
    hop = int(0.01 * sr)
    best, seg = -1, m[:n]
    for i in range(0, max(1, len(m) - n), hop):
        r = float(np.sum(m[i:i + n] ** 2))
        if r > best:
            best, seg = r, m[i:i + n]
    seg = seg - np.mean(seg)
    if not np.any(seg):
        return 0.0
    ac = np.correlate(seg, seg, mode='full')[n - 1:]
    ac /= (ac[0] + 1e-12)
    lo, hi = int(sr / 1200), int(sr / 60)
    hi = min(hi, len(ac) - 1)
    if lo >= hi:
        return 0.0
    k = lo + int(np.argmax(ac[lo:hi]))
    return float(sr / k) if k > 0 else 0.0


def measure(path):
    m, sr = sf.read(path, always_2d=True)
    m = m.mean(axis=1).astype(np.float64)
    if sr != SR_TARGET:
        # 线性插值即可（只为测量，不做重采样品质要求）
        n = int(round(len(m) * SR_TARGET / sr))
        m = np.interp(np.linspace(0, len(m) - 1, n), np.arange(len(m)), m)
        sr = SR_TARGET
    dur = len(m) / sr
    rms = 20 * np.log10(np.sqrt(np.mean(m ** 2)) + 1e-12)
    peak = 20 * np.log10(np.max(np.abs(m)) + 1e-12)

    w = np.hanning(len(m)) if len(m) > 8 else np.ones(len(m))
    P = np.abs(np.fft.rfft(m * w)) ** 2
    f = np.fft.rfftfreq(len(m), 1 / sr)
    tot = P.sum() + 1e-12
    cen = float((P * f).sum() / tot)
    band = lambda lo, hi: float(P[(f >= lo) & (f < hi)].sum() / tot)

    return {
        'base': os.path.basename(path),
        'dur': dur,
        'rms': rms,
        'peak': peak,
        'centroid': cen,
        'hf4': band(4000, 20000),      # >4k 高频能量占比
        'hf6': band(6000, 20000),
        'harsh': band(3000, 5000),     # 刺耳主区
        'warm': band(200, 500),        # 温暖/胸腔感
        'sharp': zwicker_sharpness(f, P),
        'f0': est_f0(m, sr),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'app', 'assets', 'audio', 'meow'))
    ap.add_argument('--csv', default='')
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.dir, '*.ogg')) +
                   glob.glob(os.path.join(args.dir, 'urgent', '*.ogg')))
    if not files:
        raise SystemExit('no ogg in %s' % args.dir)

    rows = [measure(p) for p in files]
    hdr = ('%-20s %6s %7s %7s %8s %7s %7s %7s %7s %7s %6s'
           % ('base', 'dur', 'rms', 'peak', 'centroid', '>4k%', '>6k%', '3-5k%', 'warm%', 'sharp', 'f0'))
    print(hdr)
    print('-' * len(hdr))
    for r in rows:
        print('%-20s %5.2fs %6.1fd %6.1fd %7.0fHz %6.1f%% %6.1f%% %6.1f%% %6.1f%% %6.2f  %5.0f'
              % (r['base'], r['dur'], r['rms'], r['peak'], r['centroid'],
                 r['hf4'] * 100, r['hf6'] * 100, r['harsh'] * 100,
                 r['warm'] * 100, r['sharp'], r['f0']))
    avg = {k: np.mean([r[k] for r in rows]) for k in
           ('dur', 'centroid', 'hf4', 'hf6', 'harsh', 'warm', 'sharp', 'f0')}
    print('-' * len(hdr))
    print('平均: centroid=%.0fHz  >4k=%.1f%%  3-5k=%.1f%%  warm=%.1f%%  sharp=%.2facum  f0=%.0fHz'
          % (avg['centroid'], avg['hf4'] * 100, avg['harsh'] * 100,
             avg['warm'] * 100, avg['sharp'], avg['f0']))

    if args.csv:
        with open(args.csv, 'w', encoding='utf-8-sig') as fh:
            fh.write('base,dur,rms,peak,centroid,hf4,hf6,harsh,warm,sharp,f0\n')
            for r in rows:
                fh.write('%s,%.3f,%.2f,%.2f,%.0f,%.4f,%.4f,%.4f,%.4f,%.3f,%.0f\n'
                         % (r['base'], r['dur'], r['rms'], r['peak'], r['centroid'],
                            r['hf4'], r['hf6'], r['harsh'], r['warm'], r['sharp'], r['f0']))
        print('csv -> %s' % args.csv)


if __name__ == '__main__':
    sys.exit(main())
