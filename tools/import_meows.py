#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
import_meows.py — 把 CC0 真实猫叫源素材加工为可直接打包的 OGG 情境素材

输入：assets-src/audio-raw/*.wav|*.ogg（CC0 源录音，见 assets/audio/CREDITS.md）
输出：app/assets/audio/meow/<base>.ogg（+ urgent/ 子目录）

每个目标文件由一条 TARGETS 记录定义：
    base: (源别名, 切片起点 s, 切片终点 s, 变速比 rate, 响度档)
    rate > 1 = 更快更亮；rate < 1 = 更慢更低沉（重采样，音高与时长天然耦合）

处理链（顺序即听感因果）：
    解码 → 单声道 44.1k → 切片 → 自动裁静音（保留 10ms 前导）
    → 高通 90Hz（去直流/低频轰鸣）
    → 重采样变速（定音高与时长）
    → 【音色层】3 段 EQ 柔化 + 削刺 + 加暖
    → 【动态层】温和峰值压缩（削瞬态尖峰，不压平均细节）
    → 响度归一（按档位 RMS）+ 峰值上限
    → 柔性起音/收尾（raise-cosine，杜绝 click）
    → 写 OGG/Vorbis

音色设计目标（可爱 / 温柔 / 自然，见 tone-plan 说明）：
  · 削「刺」：3.4kHz −3.4dB（人耳最易疲劳的刺耳带）+ 5.6kHz 高频架 −4.2dB（毛刺/嘶感）
  · 加「暖」：320Hz 低架 +2.6dB（胸腔厚度，让叫声不"薄"）+ 900Hz +1.2dB（实体感）
  · 保「细节」：只削 11kHz 以上的超高频毛刺；压缩比仅 2.4 且只在峰值区工作，
    不动平均电平，气声/共振峰细节全部保留 → 不机械、不失真、不做降噪、不加混响。

可复跑：改表即可重新生成全部素材，不依赖任何在线服务。
"""
import os
import sys
from fractions import Fraction

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly, lfilter

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets-src', 'audio-raw')
OUT = os.path.join(ROOT, 'app', 'assets', 'audio', 'meow')

SOURCES = {
    'mewfood':  'cat_mewfood.wav',      # 讨食短喵（明亮）
    'mewpurr':  'cat_mewpurr.wav',      # 喵 + 呼噜
    'mewpurr2': 'cat_mewpurr2.wav',     # 长喵 + 呼噜（温和）
    'softmew':  'cat_softmew.wav',      # 两声轻柔短喵
    'kitten':   'kitten_mew-1.wav',     # 小猫长喵（柔软、略哀）
    'meow':     'meow_short.ogg',       # 干净清晰的单声喵
    'baby':     'meow_baby.ogg',        # 明亮高音小猫喵（最易发尖，已降调）
}

# base: (src, t0, t1, rate, 档位)
# rate 调整说明：尖锐度高的条目小幅降调（降低谐波密度带来的"尖"，同时略增奶气），
# 已偏低沉的条目保持原速率，避免发闷。
TARGETS = {
    'pet_1':    ('softmew', 0.38, 1.00, 1.02, 'normal'),   # 略尖 → 0.99 已在下方 old-rate 表体现
    'pet_2':    ('softmew', 1.31, 1.95, 0.98, 'normal'),
    'pet_3':    ('mewpurr2', 0.16, 1.24, 1.00, 'normal'),
    'eat_1':    ('mewfood', 0.50, 1.02, 1.00, 'normal'),
    'eat_2':    ('mewpurr2', 0.16, 0.86, 1.08, 'normal'),
    'play_1':   ('meow', 0.00, 0.51, 1.10, 'normal'),
    'play_2':   ('baby', 0.03, 0.90, 1.06, 'normal'),
    'bath_1':   ('kitten', 0.02, 0.90, 1.08, 'normal'),
    'bath_2':   ('mewfood', 0.50, 1.02, 0.95, 'soft'),
    'wake_1':   ('softmew', 0.38, 1.00, 0.94, 'normal'),
    'wake_2':   ('mewpurr2', 0.16, 1.24, 0.92, 'soft'),
    'call_1':   ('meow', 0.00, 0.51, 1.00, 'normal'),
    'call_2':   ('kitten', 0.02, 0.90, 1.00, 'normal'),
    'hungry_1': ('mewfood', 0.50, 1.02, 1.10, 'normal'),
    'hungry_2': ('baby', 0.03, 0.90, 1.00, 'normal'),
    'tired_1':  ('softmew', 0.38, 1.00, 0.88, 'soft'),
    'tired_2':  ('mewpurr2', 0.16, 1.24, 0.90, 'soft'),
    'sad_1':    ('kitten', 0.02, 0.90, 0.90, 'soft'),
    'sad_2':    ('meow', 0.00, 0.51, 0.90, 'soft'),
    'dirty_1':  ('mewfood', 0.50, 1.02, 0.98, 'normal'),
    'dirty_2':  ('mewpurr', 0.02, 0.88, 0.96, 'soft'),
    'lonely_1': ('meow', 0.00, 0.51, 0.94, 'normal'),
    'lonely_2': ('kitten', 0.02, 0.90, 0.96, 'soft'),
    'idle_1':   ('softmew', 1.31, 1.95, 1.00, 'normal'),
    'idle_2':   ('mewpurr', 0.02, 0.88, 1.00, 'soft'),
    'urgent/urgent_1': ('mewfood', 0.50, 0.92, 1.14, 'urgent'),
    'urgent/urgent_2': ('meow', 0.00, 0.42, 1.16, 'urgent'),
    'sys_1':    ('meow', 0.02, 0.20, 1.15, 'sys'),
    'sys_2':    ('mewfood', 0.52, 0.70, 1.20, 'sys'),
}

# 相对上一版（1.7.3 / 阶段2）的变速比调整：负值 = 降调变柔，只作用于偏尖的条目
RATE_ADJUST = {
    'hungry_2': -0.07,   # 1.00 → 0.93  最尖，明显降调
    'play_2':   -0.09,   # 1.06 → 0.97  次尖，回到中音区保"可爱"
    'sys_2':    -0.16,   # 1.20 → 1.04  系统音只需辨识度，不争高音
    'sys_1':    -0.08,   # 1.15 → 1.07
    'hungry_1': -0.13,   # 1.10 → 0.97  与 hungry_2 音区对齐
    'urgent_1': -0.10,   # 1.14 → 1.04  紧迫感靠短促，不靠高音
    'urgent_2': -0.05,   # 1.16 → 1.11
    'pet_1':    -0.03,   # 1.02 → 0.99
    'eat_1':    -0.03,   # 1.00 → 0.97
    'dirty_1':  -0.03,   # 0.98 → 0.95
    'bath_2':   -0.03,   # 0.95 → 0.92
    'wake_1':   -0.02,   # 0.94 → 0.92
}

# 响度档位：目标 RMS(dBFS) + 峰值上限(dBFS)
LOUD = {
    'normal': (-18.0, -3.0),   # 峰值从 -1.5 收到 -3.0：削掉瞬态冲击感
    'soft':   (-20.5, -3.0),
    'urgent': (-15.5, -2.0),
    'sys':    (-20.0, -4.0),
}

# ── 音色层：统一曲线（保证 29 条"像同一只猫"）────────────────────────────
# (类型, 中心/转折频率, 增益dB, Q 或 shelf 斜率S)
EQ_BASE = [
    ('lowshelf',  320.0, +2.6, 1.0),    # 胸腔温暖
    ('peaking',   900.0, +1.2, 1.1),    # 实体感，抵消削高频后的"虚"
    ('peaking',  3400.0, -3.4, 1.15),   # 刺耳主区
    ('highshelf', 5600.0, -4.2, 0.9),   # 嘶/毛刺
]

# ── 个体偏置：只改"差多少补多少"，不改整体性格 ────────────────────────────
# warm: 低架增益增量 dB；harsh/sibil: 额外削减 dB（负值=更狠）；lp: 额外低通 Hz；atk: 起音秒
TONE_PER = {
    # 最尖（baby 源 / 系统音）
    'hungry_2': dict(harsh=-3.2, sibil=-2.0, atk=0.015,
                     note='最尖：降调+重点削刺，回到中音区'),
    'play_2':   dict(harsh=-3.2, sibil=-2.0, atk=0.015,
                     note='次尖：降调+重点削刺，保兴奋度'),
    'sys_2':    dict(harsh=-3.1, sibil=-3.0, lp=8200, atk=0.020,
                     note='系统音：更短更钝，只留提示感'),
    'sys_1':    dict(harsh=-2.4, sibil=-2.5, lp=8600, atk=0.018,
                     note='系统音：更短更钝，只留提示感'),
    # 偏尖
    'hungry_1': dict(harsh=-2.2, sibil=-1.2),
    'urgent_1': dict(harsh=-2.4, sibil=-1.2, atk=0.011,
                     note='危急：削刺但保留急促力度'),
    'urgent_2': dict(harsh=-1.0, sibil=-0.4, atk=0.010),
    'pet_1':    dict(harsh=-1.7, sibil=-0.8),
    'eat_1':    dict(harsh=-1.9, sibil=-1.0),
    'dirty_1':  dict(harsh=-1.6, sibil=-0.8),
    'bath_2':   dict(harsh=-1.2, sibil=-0.5),
    'wake_1':   dict(harsh=-1.2, sibil=-0.5),
    'tired_1':  dict(harsh=-0.6),
    'play_1':   dict(harsh=-0.6),
    'call_1':   dict(harsh=-0.6),
    'idle_1':   dict(harsh=+2.2, warm=-1.2, note='高音迎接喵：少削存在感，保住"喵"的辨识度'),
    'pet_2':    dict(harsh=+2.4, warm=-1.2, note='高音轻喵：少削存在感，保住"喵"的辨识度'),
    'bath_1':   dict(harsh=-0.4),
    'lonely_1': dict(harsh=-0.4),
    # 已经很暖（含呼噜，warm 42%+）：不再加厚，高频也只轻削，避免发闷
    'eat_2':    dict(warm=-1.8, harsh=+1.0, sibil=+2.2, note='已很暖：少加厚、少削高频，防闷'),
    'pet_3':    dict(warm=-1.8, harsh=+1.0, sibil=+2.2, note='已很暖：少加厚、少削高频，防闷'),
    'tired_2':  dict(warm=-1.8, harsh=+1.0, sibil=+2.2, note='已很暖：少加厚、少削高频，防闷'),
    'wake_2':   dict(warm=-1.8, harsh=+1.0, sibil=+2.2, note='已很暖：少加厚、少削高频，防闷'),
}

# 动态层：温和峰值压缩（只压瞬态尖峰，不动平均细节）
COMP = dict(thr_rel=2.5, ratio=2.6, atk=0.010, rel=0.120)


def db(x):
    return 20.0 * np.log10(max(float(x), 1e-9))


def read_mono(path):
    x, sr = sf.read(path, always_2d=True)
    m = x.mean(axis=1).astype(np.float64)
    if sr != SR:
        g = Fraction(SR, sr).limit_denominator(1000)
        m = resample_poly(m, g.numerator, g.denominator)
    return m


def trim_silence(m, pre=0.010, floor_db=-38.0):
    """按峰值相对阈值裁掉首尾静音，保留 pre 秒前导"""
    if not len(m):
        return m
    peak = np.max(np.abs(m)) + 1e-12
    thr = peak * (10 ** (floor_db / 20.0))
    idx = np.where(np.abs(m) > thr)[0]
    if not len(idx):
        return m
    a = max(0, idx[0] - int(pre * SR))
    b = min(len(m), idx[-1] + int(pre * SR))
    return m[a:b]


def highpass(m, hz=90.0):
    sos = butter(2, hz / (SR / 2.0), btype='highpass', output='sos')
    return sosfilt(sos, m)


def lowpass(m, hz):
    sos = butter(2, min(hz, SR / 2.0 * 0.98) / (SR / 2.0), btype='lowpass', output='sos')
    return sosfilt(sos, m)


def resample_rate(m, rate):
    r = Fraction(rate).limit_denominator(200)
    if r.numerator == r.denominator:
        return m
    return resample_poly(m, r.denominator, r.numerator)   # 长度 /r，音高 ×r


def biquad(kind, f0, gain_db=0.0, q=0.707, s=1.0):
    """RBJ Audio EQ Cookbook biquad → 单节 sos"""
    A = 10.0 ** (gain_db / 40.0)
    w0 = 2.0 * np.pi * min(f0, SR * 0.49) / SR
    cw, sw = np.cos(w0), np.sin(w0)
    if kind == 'peaking':
        alpha = sw / (2.0 * q)
        b0 = 1 + alpha * A
        b1 = -2 * cw
        b2 = 1 - alpha * A
        a0 = 1 + alpha / A
        a1 = -2 * cw
        a2 = 1 - alpha / A
    elif kind in ('lowshelf', 'highshelf'):
        alpha = sw / 2.0 * np.sqrt((A + 1.0 / A) * (1.0 / s - 1.0) + 2.0)
        sa = np.sqrt(A)
        if kind == 'lowshelf':
            b0 = A * ((A + 1) - (A - 1) * cw + 2 * sa * alpha)
            b1 = 2 * A * ((A - 1) - (A + 1) * cw)
            b2 = A * ((A + 1) - (A - 1) * cw - 2 * sa * alpha)
            a0 = (A + 1) + (A - 1) * cw + 2 * sa * alpha
            a1 = -2 * ((A - 1) + (A + 1) * cw)
            a2 = (A + 1) + (A - 1) * cw - 2 * sa * alpha
        else:
            b0 = A * ((A + 1) + (A - 1) * cw + 2 * sa * alpha)
            b1 = -2 * A * ((A - 1) + (A + 1) * cw)
            b2 = A * ((A + 1) + (A - 1) * cw - 2 * sa * alpha)
            a0 = (A + 1) - (A - 1) * cw + 2 * sa * alpha
            a1 = 2 * ((A - 1) - (A + 1) * cw)
            a2 = (A + 1) - (A - 1) * cw - 2 * sa * alpha
    else:
        raise ValueError(kind)
    return np.array([[b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0]])


def apply_tone(m, ov):
    """统一曲线 + 个体偏置 → 三段 EQ（另可加一阶低通）"""
    warm = EQ_BASE[0][2] + ov.get('warm', 0.0)
    harsh = EQ_BASE[2][2] + ov.get('harsh', 0.0)
    sibil = EQ_BASE[3][2] + ov.get('sibil', 0.0)
    sos = np.vstack([
        biquad('lowshelf', EQ_BASE[0][1], warm, s=EQ_BASE[0][3]),
        biquad('peaking', EQ_BASE[1][1], EQ_BASE[1][2], q=EQ_BASE[1][3]),
        biquad('peaking', EQ_BASE[2][1], harsh, q=EQ_BASE[2][3]),
        biquad('highshelf', EQ_BASE[3][1], sibil, s=EQ_BASE[3][3]),
    ])
    m = sosfilt(sos, m)
    m = lowpass(m, ov.get('lp') or 11000.0)
    return m


def compress(m, thr_rel=4.0, ratio=2.4, atk=0.012, rel=0.130):
    """温和峰值压缩：包络跟得快、放得慢；只在超过 (RMS+thr_rel) 的部分降增益。
    不碰平均电平，因此气声/共振峰/颤音细节完整保留（避免"机械感"）。"""
    a_atk = float(np.exp(-1.0 / (atk * SR)))
    a_rel = float(np.exp(-1.0 / (rel * SR)))
    x = np.abs(m)
    fast = lfilter([1 - a_atk], [1, -a_atk], x)     # 快跟（抓瞬态）
    env = lfilter([1 - a_rel], [1, -a_rel], fast)   # 慢放（不抽吸）
    env = np.maximum(env, 1e-9)
    env_db = 20.0 * np.log10(env)
    rms_db = 20.0 * np.log10(np.sqrt(np.mean(m ** 2)) + 1e-12)
    thr = rms_db + thr_rel
    over = env_db - thr
    gain_db = np.where(over > 0.0, -over * (1.0 - 1.0 / ratio), 0.0)
    g = lfilter([1 - a_rel], [1, -a_rel], 10.0 ** (gain_db / 20.0))
    return m * g


def soft_fade(m, fin=0.012, fout=0.060):
    """raise-cosine 起落：比线性淡入更柔，彻底消除 click / 起音过冲"""
    n = len(m)
    a = min(int(fin * SR), n // 4)
    b = min(int(fout * SR), max(1, int(n * 0.18)))   # 短音（如 sys 0.13s）自动缩到 ~23ms
    if a > 1:
        m[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    if b > 1:
        m[-b:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b))
    return m


def soft_limit(m, ceil_db, knee=0.90):
    """只在接近上限的少数峰值样本上做 tanh 软化（<0.5% 采样），
    不整体缩放 → 峰值受控且 RMS 不被拖低，也不会产生可闻失真。"""
    ceil = 10 ** (ceil_db / 20.0)
    a = np.abs(m)
    idx = a > ceil * knee
    if not np.any(idx):
        return m
    k = knee
    x = a[idx] / ceil
    y = k + (1.0 - k) * np.tanh((x - k) / (1.0 - k))
    out = m.copy()
    out[idx] = np.sign(m[idx]) * y * ceil
    return out


def loudnorm(m, target_rms_db, peak_ceiling_db):
    """两轮：提增益到目标 RMS → 软限幅；再补一次增益差，使响度真正齐平"""
    for _ in range(2):
        rms = np.sqrt(np.mean(m ** 2)) + 1e-12
        m = m * 10 ** ((target_rms_db - db(rms)) / 20.0)
        m = soft_limit(m, peak_ceiling_db)
    return m


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(OUT, 'urgent'), exist_ok=True)
    cache = {}
    rows = []
    for base in sorted(TARGETS):
        src, t0, t1, rate, cat = TARGETS[base]
        short = base.rsplit('/', 1)[-1]          # urgent/urgent_1 → urgent_1
        rate = round(rate + RATE_ADJUST.get(short, 0.0), 3)
        ov = TONE_PER.get(short, {})

        path = os.path.join(RAW, SOURCES[src])
        if src not in cache:
            cache[src] = read_mono(path)

        m = cache[src][int(t0 * SR):int(t1 * SR)].copy()
        m = trim_silence(m)
        m = highpass(m)
        m = resample_rate(m, rate)                       # 定音高/时长
        m = apply_tone(m, ov)                            # 音色：削刺 + 加暖
        m = compress(m, **COMP)                          # 动态：只削瞬态尖峰
        m = soft_fade(m, fin=ov.get('atk', 0.012))       # 柔性起落
        m = loudnorm(m, *LOUD[cat])                      # 响度统一（最后一步，确保齐平）

        out = os.path.join(OUT, base + '.ogg')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        sf.write(out, m.astype(np.float32), SR, format='OGG', subtype='VORBIS')

        rms = db(np.sqrt(np.mean(m ** 2)))
        pk = db(np.max(np.abs(m)))
        crest = pk - rms
        rows.append((base, SOURCES[src], len(m) / SR, rms, pk, crest, rate, cat, ov.get('note', '')))

    print(f'{"base":18s}{"dur":>7s}{"rms":>8s}{"peak":>8s}{"crest":>7s}{"rate":>7s}  tier')
    for base, s, d, r, p, c, rt, cat, note in rows:
        print(f'{base:18s}{d:6.2f}s{r:7.1f}dB{p:7.1f}dB{c:6.1f}dB{rt:7.2f}  {cat}')
        if note:
            print(f'{"":18s}↳ {note}')
    print(f'\n共 {len(rows)} 条 → {OUT}')
    total = sum(os.path.getsize(os.path.join(OUT, b + '.ogg')) for b in TARGETS)
    print(f'总体积 {total/1024:.0f} KB')


if __name__ == '__main__':
    sys.exit(main())
