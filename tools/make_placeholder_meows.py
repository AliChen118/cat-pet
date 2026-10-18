#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""make_placeholder_meows.py — 阶段 1 占位喵叫生成器

程序化合成 29 条占位音（44100Hz / 16bit / 单声道 WAV），供语音链路跑通用。
阶段 2 换成真实素材时：把同名 .ogg 放进 assets/audio/meow/ 即可（播放器 .ogg 优先），
本脚本产物可直接删除。

用法：python tools/make_placeholder_meows.py
"""
import math
import os
import random
import struct
import wave

SR = 44100
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'assets', 'audio', 'meow')

# context: (f0, f1, dur, harmonics, vib_hz, vib_depth, amp, noise)
# f0→f1 为基频滑动（上扬/下降决定情绪色彩），harmonics 多则更"尖"
SPEC = {
    'pet':    (680, 520, 0.55, 4, 5.5, 0.020, 0.50, 0.010),
    'eat':    (720, 560, 0.45, 4, 6.0, 0.018, 0.48, 0.012),
    'play':   (820, 640, 0.40, 5, 6.5, 0.022, 0.50, 0.010),
    'bath':   (640, 500, 0.50, 4, 5.0, 0.018, 0.46, 0.014),
    'wake':   (600, 780, 0.55, 4, 4.5, 0.025, 0.46, 0.010),   # 上扬：伸懒腰
    'call':   (780, 700, 0.50, 5, 6.0, 0.020, 0.52, 0.010),
    'hungry': (700, 480, 0.60, 4, 5.0, 0.028, 0.52, 0.012),   # 长下滑：哀怨
    'tired':  (560, 430, 0.60, 3, 4.5, 0.026, 0.44, 0.014),
    'sad':    (520, 380, 0.70, 3, 4.0, 0.030, 0.42, 0.014),
    'dirty':  (660, 500, 0.50, 4, 5.5, 0.022, 0.44, 0.014),
    'lonely': (600, 470, 0.55, 4, 5.0, 0.026, 0.44, 0.012),
    'idle':   (750, 600, 0.40, 4, 6.0, 0.018, 0.42, 0.010),
    'sys':    (1100, 1250, 0.16, 2, 0.0, 0.000, 0.28, 0.004),  # 轻量系统音：短、轻、亮
    'urgent': (950, 700, 0.26, 6, 8.0, 0.030, 0.62, 0.014),    # 急促：短高尖
}

# 每条 context 的变体数（与 engine/voice.js 的 files 数组一致）
VARIANTS = {
    'pet': 3, 'eat': 2, 'play': 2, 'bath': 2, 'wake': 2, 'call': 2,
    'hungry': 2, 'tired': 2, 'sad': 2, 'dirty': 2, 'lonely': 2, 'idle': 2,
    'sys': 2, 'urgent': 2,
}


def synth(f0, f1, dur, harmonics, vib_hz, vib_depth, amp, noise, seed):
    """基频滑动 + 谐波叠加 + 颤音 + 气声，生成归一化 float 样本"""
    rnd = random.Random(seed)
    n = int(dur * SR)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        k = t / dur                                  # 0→1 进度
        f = f0 + (f1 - f0) * (k * k * (3 - 2 * k))   # smoothstep 滑音
        if vib_hz:
            f *= 1.0 + vib_depth * math.sin(2 * math.pi * vib_hz * t)
        phase += 2 * math.pi * f / SR
        s = 0.0
        for h in range(1, harmonics + 1):
            s += math.sin(phase * h) / (h ** 1.5)
        s /= 1.6
        # 包络：20ms 起音，尾部指数衰减
        atk = min(1.0, t / 0.02)
        rel = 1.0 if k < 0.55 else math.exp(-(k - 0.55) / 0.18)
        env = atk * rel
        s = s * env + (rnd.uniform(-1, 1) * noise * env)
        out.append(s)
    peak = max(1e-9, max(abs(x) for x in out))
    return [x / peak * amp for x in out]


def write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b''.join(struct.pack('<h', int(max(-1.0, min(1.0, s)) * 32767)) for s in samples)
        w.writeframes(frames)


def main():
    total = 0
    for ctx, (f0, f1, dur, harm, vh, vd, amp, noise) in SPEC.items():
        sub = os.path.join(ROOT, 'urgent') if ctx == 'urgent' else ROOT
        for v in range(1, VARIANTS[ctx] + 1):
            # 变体微调：基频 ±3%、时长 ±6%，避免听感完全重复
            jf = 1.0 + (v - 1) * 0.03
            jd = 1.0 + (v - 1) * 0.06 if v > 1 else 1.0
            samples = synth(f0 * jf, f1 * jf, dur * jd, harm, vh, vd, amp, noise,
                            seed=hash((ctx, v)) & 0xFFFF)
            name = f'{ctx}_{v}.wav'
            write_wav(os.path.join(sub, name), samples)
            total += 1
            print(f'[ok] {os.path.relpath(os.path.join(sub, name), ROOT)}  '
                  f'{len(samples) / SR:.2f}s')
    print(f'\n共生成 {total} 条占位音 -> {os.path.normpath(ROOT)}')


if __name__ == '__main__':
    main()
