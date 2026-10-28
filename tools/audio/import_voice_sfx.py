#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
import_voice_sfx.py — 把线上抓到的 CC0 / CC-BY 猫叫源加工成可直接打包的 OGG 情境素材

与 import_meows.py 的区别：
  · 输入是 assets-src/audio-raw/{oga,freesound}/ 下新抓的素材（来源见 _sources.json）
  · 支持"按事件切片"（自动找第 n 声，不用手填秒数）
  · 新增 purr（呼噜）通路：不做静音裁剪、做循环接缝、走低频专用 EQ
  · 输出清单 _voice_manifest.json（含来源/许可/时长），供 CREDITS 与交付清单生成

处理链（普通喵）：
  解码 → 单声道 44.1k → 切片 → 裁静音(10ms 前导) → 90Hz 高通 → 变速(定音高/时长)
  → 音色层 4 段 EQ → 温和峰值压缩 → 柔性起落 → 响度归一 + tanh 软限幅 → OGG

处理链（呼噜）：
  解码 → 单声道 44.1k → 切片 → 28Hz 高通 → 呼噜专用 EQ（削超低频轰鸣 + 抬 260Hz 体感）
  → 循环接缝交叉淡化 → 柔性起落 → 响度归一（低调）→ OGG

只产出交付精选集（用户勾选的 16 条，2026-10-17）：
  pet_3 eat_1 play_2 bath_1 bath_2 wake_1 wake_2 call_2 hungry_2 tired_1
  lonely_2 idle_1 idle_2 purr_1 purr_2（15 条；pet_2 于 12:57 按用户要求移除）
  （sad/dirty/urgent/sys 等未勾选素材已移除，引擎 SPEC 同步裁剪）

用法：python tools/audio/import_voice_sfx.py [--dry]
"""
import argparse
import json
import os
import sys
from fractions import Fraction

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly, lfilter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))                   # 同目录兄弟模块
from import_meows import (SR, biquad, compress, db, highpass, lowpass, loudnorm,
                          read_mono, resample_rate, soft_fade, soft_limit, trim_silence)  # noqa: E402
from _root import find_root  # noqa: E402

ROOT = find_root()
RAW = os.path.join(ROOT, 'assets-src', 'audio-raw')
OUT = os.path.join(ROOT, 'app', 'assets', 'audio', 'meow')
MANIFEST = os.path.join(ROOT, 'archive', 'audio-history', '_voice_manifest.json')

# 源别名 → 原始文件（相对 assets-src/audio-raw）
SOURCES = {
    'purrS':    'oga/cat_purrsleepy_loop.wav',        # 睡意呼噜（连续）
    'purrA':    'oga/cat_purractive_loop.wav',        # 活跃呼噜（连续）
    'purrF':    'freesound/528949_fthgurdy.ogg',      # 短呼噜（中频更足，小喇叭可闻）
    'softmew':  'oga/cat_softmew.wav',                # 两声轻柔短喵
    'mewpurr':  'oga/cat_mewpurr.wav',                # 带呼噜尾巴的温和喵
    'mew1':     'freesound/534269_patchytherat.ogg',  # 中音单声喵（两声）
    'mew2':     'freesound/110011_tuberatanka.ogg',   # 清亮单声喵
    'mew3':     'freesound/813113_qubodup.ogg',       # 柔和中音喵（谐波最干净）
    'mew4':     'freesound/813119_qubodup.ogg',       # 短促响亮喵（应答感）
    'mew5':     'freesound/479272_steffcaffrey.ogg',  # 高音轻喵
    'pickup':   'oga/catpickup.mp3',                  # 被抱起的一声轻喵
    'trill':    'freesound/668825_MBPL.ogg',          # 颤音/呼噜式招呼
    'play1':    'oga/Cat_1.wav',                      # 明亮玩闹喵
    'kitten':   'oga/kitten_mew-1.wav',               # 小猫长喵
    'cry':      'freesound/370160_Tony01726.ogg',     # 哭叫（三声，低落）
    'annoyed':  'oga/Cat_4.wav',                      # 低沉不满长鸣
    'highmew':  'freesound/508686_megrez7274.ogg',    # 高频短 chirp
}

# ── 目标表 ────────────────────────────────────────────────────────────────
# src 源别名 / ev 第几声（自动切片，None 表示用 t 显式窗口）/ t=(t0,t1) / rate 变速 / tier 响度档
# tone: 个体音色偏置（harsh/sibil/warm/lp/atk）；note: 中文说明（进交付清单）
CUTS = {
    # —— 抚摸（呼噜是主角，喵是应答）——
    'pet_3':  dict(src='mew5',    ev=0, rate=0.97, tier='normal',
                   tone=dict(harsh=+1.4, warm=-0.6), note='高音轻喵：撒娇'),
    # —— 进食（eat_1 保留）——
    'eat_1':  dict(src='mew1',    ev=0, rate=1.02, tier='normal', note='短促讨食喵'),
    # —— 逗玩（兴奋档，play_2 保留）——
    'play_2': dict(src='play1',   ev=0, rate=0.96, tier='normal',
                   tone=dict(harsh=-3.0, sibil=-1.6), note='明亮玩闹喵（重点削刺）'),
    # —— 洗澡 ——
    'bath_1': dict(src='kitten',  ev=0, rate=1.00, tier='normal', note='小猫不满长喵'),
    'bath_2': dict(src='mew2',    ev=0, rate=0.95, tier='soft',   note='委屈的短喵'),
    # —— 唤醒 ——
    'wake_1': dict(src='mew3',    ev=0, rate=0.96, tier='normal', note='被叫醒的柔软应答'),
    'wake_2': dict(src='mewpurr', ev=0, rate=0.90, tier='soft',   note='睡意未消的低喵'),
    # —— 呼喊（call_2 保留）——
    'call_2': dict(src='mew2',    ev=0, rate=0.98, tier='normal', note='中音应答'),
    # —— 饥饿 ——
    'hungry_2': dict(src='kitten', ev=0, rate=0.98, tier='normal', note='小猫式讨食'),
    # —— 疲惫（tired_1 保留）——
    'tired_1': dict(src='mew5',   ev=0, rate=0.90, tier='soft', note='体力低：有气无力的轻喵'),
    # —— 孤独（lonely_2 保留）——
    'lonely_2': dict(src='kitten', ev=0, rate=0.94, tier='soft', note='小猫找伴的绵长喵'),
    # —— 迎接 / 空闲 ——
    'idle_1': dict(src='mew5',     ev=0, rate=1.00, tier='normal', note='迎接：上扬轻喵'),
    'idle_2': dict(src='mewpurr',  ev=0, rate=1.00, tier='soft',   note='空闲时的自语'),
    # —— 呼噜（新增音效类型，loop 播放，不参与一次性叫声仲裁）——
    'purr_1': dict(src='purrA',   t=(0.60, 3.50), loop=True, rate=1.00, tier='purr',
                   tone=dict(purr=True, sub=2.2, warm=-1.4), note='活跃呼噜：被抚摸时铺底'),
    'purr_2': dict(src='purrS',   t=(0.40, 3.30), loop=True, rate=1.00, tier='purr',
                   tone=dict(purr=True, sub=3.0, warm=-1.8), note='睡意呼噜：入睡时铺底'),
}

LOUD = {
    'normal': (-18.0, -3.0),
    'soft':   (-20.5, -3.0),
    'purr':   (-21.0, -6.0),     # 呼噜是背景层，需明显低于喵
}

# 统一音色曲线（与已有 29 条一致，保证"同一只猫"）
EQ_BASE = [
    ('lowshelf',  320.0, +2.6, 1.0),
    ('peaking',   900.0, +1.2, 1.1),
    ('peaking',  3400.0, -3.4, 1.15),
    ('highshelf', 5600.0, -4.2, 0.9),
]

# 呼噜专用：超低频太占主导（实测 92% 能量在 80Hz 以下，小喇叭完全听不见），
# 因此削 70Hz 以下的轰鸣、抬 260Hz 的"体感频段"，并把高频嘶声压掉。
EQ_PURR = [
    ('lowshelf',   70.0, -4.5, 1.0),
    ('peaking',   260.0, +4.5, 0.9),
    ('peaking',   520.0, +1.5, 1.2),
    ('highshelf', 5000.0, -2.5, 0.9),
]

COMP = dict(thr_rel=2.5, ratio=2.6, atk=0.010, rel=0.120)


# ── 事件切片 ──────────────────────────────────────────────────────────────
def detect_events(m, sr, thr_db=-28.0, gap=0.10, min_dur=0.08):
    hop = int(0.005 * sr)
    n = len(m) // hop
    if n < 3:
        return [(0.0, len(m) / sr)]
    f = np.array([np.sqrt(np.mean(m[i * hop:(i + 1) * hop] ** 2) + 1e-12) for i in range(n)])
    env = 20 * np.log10(f + 1e-12)
    env -= env.max()
    on = env > thr_db
    segs, cur = [], None
    for i, v in enumerate(on):
        if v and cur is None:
            cur = i
        elif not v and cur is not None:
            if (i - cur) * 0.005 >= min_dur:
                segs.append((cur * 0.005, i * 0.005))
            cur = None
    if cur is not None and (n - cur) * 0.005 >= min_dur:
        segs.append((cur * 0.005, n * 0.005))
    merged = []
    for a, b in segs:
        if merged and a - merged[-1][1] < gap:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged


def window_for(spec, m, sr):
    if spec.get('t'):
        a, b = float(spec['t'][0]), float(spec['t'][1])
    else:
        ev = detect_events(m, sr)
        i = int(spec.get('ev') or 0)
        if i >= len(ev):
            raise RuntimeError('事件不足：需要 #%d，实际 %d' % (i, len(ev)))
        a, b = ev[i]
        a, b = max(0.0, a - 0.010), min(len(m) / sr, b + 0.012)
    if spec.get('maxLen'):                      # 系统提示音等需要强制截短
        b = min(b, a + float(spec['maxLen']))
    return a, b


def eq_chain(m, ov):
    base = EQ_PURR if ov.get('purr') else EQ_BASE
    if ov.get('purr'):
        warm, harsh, sibil = base[0][2], base[2][2], base[3][2]
        extra = base[1]
        sos = np.vstack([
            biquad('lowshelf', base[0][1], warm + ov.get('warm', 0.0), s=base[0][3]),
            biquad('peaking', extra[1], extra[2] + ov.get('sub', 0.0), q=extra[3]),
            biquad('peaking', base[2][1], harsh + ov.get('harsh', 0.0), q=base[2][3]),
            biquad('highshelf', base[3][1], sibil + ov.get('sibil', 0.0), s=base[3][3]),
        ])
    else:
        sos = np.vstack([
            biquad('lowshelf', base[0][1], base[0][2] + ov.get('warm', 0.0), s=base[0][3]),
            biquad('peaking', base[1][1], base[1][2], q=base[1][3]),
            biquad('peaking', base[2][1], base[2][2] + ov.get('harsh', 0.0), q=base[2][3]),
            biquad('highshelf', base[3][1], base[3][2] + ov.get('sibil', 0.0), s=base[3][3]),
        ])
    m = sosfilt(sos, m)
    return lowpass(m, ov.get('lp') or 11000.0)


def loop_xfade(m, xf=0.16):
    """把 tail 交叉淡入 head，使首尾样本连续 → loop 无接缝"""
    x = int(xf * SR)
    n = len(m)
    if n <= 3 * x:
        return m
    L = n - x
    out = m[:L].copy()
    fi = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, x))
    fo = 1.0 - fi
    out[:x] = m[:x] * fi + m[L:L + x] * fo
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    with open(os.path.join(RAW, '_sources.json'), encoding='utf-8') as f:
        src_meta = {m['file']: m for m in json.load(f)}

    os.makedirs(OUT, exist_ok=True)
    cache = {}
    rows = []

    for base in sorted(CUTS):
        spec = CUTS[base]
        alias = spec['src']
        rel = SOURCES[alias]
        ov = dict(spec.get('tone') or {})
        path = os.path.join(RAW, rel)
        if alias not in cache:
            cache[alias] = read_mono(path)
        full = cache[alias]

        t0, t1 = window_for(spec, full, SR)
        m = full[int(t0 * SR):int(t1 * SR)].copy()
        rate = float(spec.get('rate', 1.0))

        if spec.get('loop'):
            m = highpass(m, 28.0)
            m = resample_rate(m, rate)
            m = eq_chain(m, ov)
            m = loop_xfade(m, 0.16)
            m = soft_fade(m, fin=0.10, fout=0.10)
            m = loudnorm(m, *LOUD[spec['tier']])
            m = soft_limit(m, LOUD[spec['tier']][1])
        else:
            m = trim_silence(m, pre=0.010)
            m = highpass(m, 90.0)
            m = resample_rate(m, rate)
            m = eq_chain(m, ov)
            m = compress(m, **COMP)
            m = soft_fade(m, fin=ov.get('atk', 0.012))
            m = loudnorm(m, *LOUD[spec['tier']])

        out = os.path.join(OUT, base + '.ogg')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        if not args.dry:
            sf.write(out, m.astype(np.float32), SR, format='OGG', subtype='VORBIS')

        meta = src_meta.get(rel, {})
        rows.append({
            'base': base,
            'ctx': base.split('/')[0].replace('_1', '').replace('_2', '') if '/' in base else base.rsplit('_', 1)[0],
            'file': os.path.relpath(out, os.path.join(ROOT, 'app')).replace('\\', '/'),
            'src': rel,
            'srcName': meta.get('name') or os.path.basename(rel),
            'origin': meta.get('origin', 'OpenGameArt' if rel.startswith('oga/') else 'Freesound'),
            'author': meta.get('author', ''),
            'license': meta.get('license', ''),
            'page': meta.get('page', ''),
            'url': meta.get('url', ''),
            't': [round(t0, 3), round(t1, 3)],
            'rate': rate,
            'tier': spec['tier'],
            'loop': bool(spec.get('loop')),
            'note': spec.get('note', ''),
            'dur': round(len(m) / SR, 3),
            'rms': round(db(np.sqrt(np.mean(m ** 2))), 2),
            'peak': round(db(np.max(np.abs(m))), 2),
            'kb': round(os.path.getsize(out) / 1024, 1) if not args.dry and os.path.exists(out) else 0,
        })

    if not args.dry:
        with open(MANIFEST, 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, indent=2)

    print('%-18s %6s %7s %7s %6s %-7s %s' % ('base', 'dur', 'rms', 'peak', 'rate', 'tier', 'src'))
    for r in rows:
        print('%-18s %5.2fs %6.1fd %6.1fd %6.2f %-7s %s'
              % (r['base'], r['dur'], r['rms'], r['peak'], r['rate'], r['tier'], r['srcName'][:44]))
    tot = sum(r['kb'] for r in rows)
    print('\n共 %d 条，%.0f KB → %s' % (len(rows), tot, OUT))
    print('清单 → %s' % MANIFEST)
    return 0


if __name__ == '__main__':
    sys.exit(main())
