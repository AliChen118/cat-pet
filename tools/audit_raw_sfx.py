#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""audit_raw_sfx.py — 原始素材体检表（挑片前用）

列出 assets-src/audio-raw 下所有候选：时长 / 采样率 / 声道 / 响度 / crest / 谱重心 /
3–5k 刺耳带 / Zwicker 尖锐度 / 估算 f0 / 有声段数量。
有声段数量用于判断"一条文件里能切出几声"。
"""
import glob
import json
import os
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_meow_tone import measure  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets-src', 'audio-raw')


def events(m, sr, thr_db=-32.0, min_gap=0.18):
    """粗略数有声段：10ms 帧 RMS 超阈值即算有声，间隔 <min_gap 合并"""
    hop = max(1, int(0.01 * sr))
    n = len(m) // hop
    if n < 2:
        return 0, 0.0
    r = np.array([np.sqrt(np.mean(m[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(n)])
    db = 20 * np.log10(r + 1e-12)
    on = db > thr_db
    cnt, last = 0, -999
    for i, v in enumerate(on):
        if v and (i - last) * 0.01 > min_gap:
            cnt += 1
            last = i
        elif v:
            last = i
    return cnt, float(on.mean())


def main():
    with open(os.path.join(RAW, '_sources.json'), encoding='utf-8') as f:
        man = {m['file']: m for m in json.load(f)}

    files = []
    for ext in ('wav', 'ogg', 'mp3', 'flac'):
        files += glob.glob(os.path.join(RAW, '**', '*.' + ext), recursive=True)
    files.sort()

    hdr = ('%-32s %-7s %6s %6s %2s %7s %7s %8s %7s %6s %6s %5s'
           % ('file', 'tag', 'dur', 'sr', 'ch', 'rms', 'crest', 'centroid', '3-5k%', 'sharp', 'f0', 'seg'))
    print(hdr)
    print('-' * len(hdr))
    for p in files:
        rel = os.path.relpath(p, RAW).replace('\\', '/')
        tag = man.get(rel, {}).get('tag', '-')
        info = sf.info(p)
        r = measure(p)
        m, sr = sf.read(p, always_2d=True)
        mono = m.mean(axis=1)
        cnt, dens = events(mono, sr)
        print('%-32s %-7s %5.2fs %6d %2d %6.1fd %6.1fd %7.0fHz %6.1f%% %6.2f %5.0f %5d'
              % (rel[-32:], tag, info.duration, info.samplerate, info.channels,
                 r['rms'], r['peak'] - r['rms'], r['centroid'], r['harsh'] * 100,
                 r['sharp'], r['f0'], cnt))


if __name__ == '__main__':
    main()
