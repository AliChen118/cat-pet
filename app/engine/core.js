/**
 * core.js — 通用数学/缓动/工具函数
 */
'use strict';

const Core = (() => {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const Ease = {
    linear: (t) => t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inQuad: (t) => t * t,
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outBack: (t) => {
      const c = 1.70158;
      return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    },
    outElastic: (t) => {
      if (t === 0 || t === 1) return t;
      const p = 0.35;
      return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
    },
  };

  /** 正弦呼吸/摆动值，避免动作机械感 */
  const wave = (t, freq, amp, phase = 0) => Math.sin(t * freq + phase) * amp;

  /** 帧率无关的指数趋近插值 */
  const damp = (current, target, smoothing, dt) =>
    lerp(current, target, 1 - Math.pow(smoothing, dt));

  return { clamp, lerp, rand, randInt, pick, Ease, wave, damp };
})();
