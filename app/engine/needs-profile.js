/**
 * needs-profile.js — 属性驱动的分档 / 行为权重 / 优先级（单一来源）
 *
 * 双模块：主进程 require，渲染进程 <script> 挂到 window.NeedsProfile。
 * 本文件只放「数值与映射表 + 纯函数」，不含任何文案（文案在 engine/i18n.js）
 * 与任何设置项定义（设置在 engine/config-schema.js）。
 *
 * 分档：critical（危）< low（偏低）< normal（正常）< good（良好）
 * 阈值 T1 = critical 上界、T2 = low 上界、T3 = good 下界。
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NeedsProfile = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /** 参与驱动的四项属性（好感度不参与，它只影响互动回报） */
  var KEYS = ['hunger', 'energy', 'happiness', 'cleanliness'];

  /** 档位严重度排序：数值越小越严重（用于「恶化 / 恢复」判定） */
  var RANK = { critical: 0, low: 1, normal: 2, good: 3 };

  /** 阈值表（标准档）。good 档不随灵敏度平移，避免「良好」区间被压缩 */
  var NEED_TIERS = {
    hunger: { critical: 15, low: 35, good: 70 },
    energy: { critical: 15, low: 35, good: 70 },
    happiness: { critical: 20, low: 45, good: 70 },
    cleanliness: { critical: 15, low: 40, good: 70 },
  };

  /** 灵敏度 → T1/T2 整体平移量（点） */
  var SENSITIVITY = { relaxed: -8, standard: 0, strict: 8 };

  /**
   * 迟滞：升档必须越过「原档上界 + HYSTERESIS」才算离开原档，
   * 防止属性在阈值上下抖动时反复刷气泡。降档不设迟滞，越界即降。
   */
  var HYSTERESIS = 4;

  /** 参与加权随机表的行为（与 renderer.js 的 ACTIVITY 键一一对应） */
  var ACTIONS = ['walk', 'idle', 'run', 'jump', 'stretch', 'tailwag', 'meow'];

  /** 全部正常：乘子恒为 1，用于关闭「状态驱动」时的兜底 */
  var NEUTRAL_TIERS = { hunger: 'normal', energy: 'normal', happiness: 'normal', cleanliness: 'normal' };

  /**
   * 档位 → 行为权重乘子（未列出的档位 = 全 1）。
   * 语义：困了/饿了→少跑少跳、多趴多喵；心情好/干净→跑跳摇尾明显增多；
   *       脏了→不再摇尾巴（掩饰不适），以 idle / 不高兴为主。
   */
  var WEIGHT_MODS = {
    energy: {
      critical: { walk: 0.3, idle: 1.0, run: 0, jump: 0, stretch: 0.6, tailwag: 0.3, meow: 0.6 },
      low: { walk: 0.8, idle: 1.4, run: 0.4, jump: 0.3, stretch: 1.5, tailwag: 0.8, meow: 1.0 },
      good: { walk: 1.0, idle: 0.8, run: 1.25, jump: 1.2, stretch: 0.8, tailwag: 1.1, meow: 1.0 },
    },
    hunger: {
      critical: { walk: 0.5, idle: 1.1, run: 0.3, jump: 0.2, stretch: 0.8, tailwag: 0.6, meow: 2.5 },
      low: { walk: 1.0, idle: 1.0, run: 0.8, jump: 0.7, stretch: 1.0, tailwag: 1.0, meow: 1.6 },
      good: { walk: 1.0, idle: 0.95, run: 1.05, jump: 1.05, stretch: 1.0, tailwag: 1.05, meow: 0.9 },
    },
    happiness: {
      critical: { walk: 0.7, idle: 1.3, run: 0.4, jump: 0.3, stretch: 1.2, tailwag: 0, meow: 1.5 },
      low: { walk: 0.9, idle: 1.15, run: 0.7, jump: 0.6, stretch: 1.1, tailwag: 0.2, meow: 1.3 },
      good: { walk: 1.0, idle: 0.9, run: 1.2, jump: 1.15, stretch: 0.9, tailwag: 1.5, meow: 0.8 },
    },
    cleanliness: {
      critical: { walk: 0.8, idle: 1.3, run: 0.6, jump: 0.5, stretch: 1.1, tailwag: 0, meow: 1.2 },
      low: { walk: 0.95, idle: 1.1, run: 0.85, jump: 0.8, stretch: 1.0, tailwag: 0.5, meow: 1.1 },
      good: { walk: 1.0, idle: 1.0, run: 1.05, jump: 1.05, stretch: 1.0, tailwag: 1.15, meow: 1.0 },
    },
  };

  /** 档位 → 趴睡倾向修正（百分点，叠加到 behavior.restiness） */
  var SLEEP_MODS = {
    energy: { critical: 0, low: 25, good: -10 },
    hunger: { critical: -15, low: 0, good: 0 },
    happiness: { critical: 10, low: 0, good: -5 },
    cleanliness: { critical: 8, low: 0, good: 0 },
  };

  /** 危急需求的处理优先级（体力最先：不睡会持续恶化） */
  var PRIORITY = ['energy', 'hunger', 'cleanliness', 'happiness'];

  var WEIGHT_FLOOR = 0.05;   // 合成乘子下限（防止极端情况下某行为被彻底抹平）
  var WEIGHT_CEIL = 3.5;

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** 阈值（含灵敏度平移）；T1 下限 5，保证 critical 区间永远非空 */
  function thresholds(key, sensitivity) {
    var spec = NEED_TIERS[key] || NEED_TIERS.hunger;
    var shift = SENSITIVITY[sensitivity];
    if (typeof shift !== 'number') shift = 0;
    var crit = Math.max(5, spec.critical + shift);
    var low = Math.max(crit + 1, spec.low + shift);
    return { critical: crit, low: low, good: spec.good };
  }

  /** 瞬时档位（无迟滞） */
  function tierOf(key, value, sensitivity) {
    var th = thresholds(key, sensitivity);
    var v = clamp(Number.isFinite(value) ? value : 80, 0, 100);
    if (v < th.critical) return 'critical';
    if (v < th.low) return 'low';
    if (v >= th.good) return 'good';
    return 'normal';
  }

  /**
   * 带迟滞的档位判定。
   * @param {string} key         属性名
   * @param {number} value       当前值 0–100
   * @param {string} prevTier    上一次档位（null = 首次，直接采纳）
   * @param {string} sensitivity relaxed | standard | strict
   */
  function resolve(key, value, prevTier, sensitivity) {
    var v = clamp(Number.isFinite(value) ? value : 80, 0, 100);
    var raw = tierOf(key, v, sensitivity);
    if (!prevTier || prevTier === raw || RANK[prevTier] == null) return raw;
    // 仅在「升档」时要求越过滞回线；降档越界即生效
    if (RANK[raw] > RANK[prevTier]) {
      var th = thresholds(key, sensitivity);
      var edge = prevTier === 'critical' ? th.critical
        : prevTier === 'low' ? th.low
          : th.good;
      if (v < edge + HYSTERESIS) return prevTier;
    }
    return raw;
  }

  /**
   * 四项档位 → 行为权重乘子合成。
   * 规则：逐行动乘 → 任一因子为 0 则**硬否决**该行为（语义：「不再摇尾巴」
   * 必须是 0 而不是 0.05%）→ 其余乘子夹到 [0.05, 3.5] → 与基础权重相乘 →
   * 归一化到总和 1。
   * @returns {Object} 与 ACTIONS 同键的概率表（总和恒为 1）
   */
  function combineWeights(base, tiers) {
    var out = {};
    var sum = 0;
    ACTIONS.forEach(function (a) {
      var m = 1;
      var vetoed = false;
      KEYS.forEach(function (k) {
        var row = WEIGHT_MODS[k];
        var mod = row && tiers && row[tiers[k]];
        if (!mod || typeof mod[a] !== 'number') return;
        if (mod[a] === 0) { vetoed = true; return; }
        m *= mod[a];
      });
      if (!vetoed) m = clamp(m, WEIGHT_FLOOR, WEIGHT_CEIL);
      var b = base && typeof base[a] === 'number' ? base[a] : 0;
      var w = vetoed ? 0 : m * b;
      out[a] = w;
      sum += w;
    });
    if (!(sum > 0)) {
      // 兜底：全部为 0 时退回「只发呆」，避免出现 NaN 概率
      ACTIONS.forEach(function (a) { out[a] = a === 'idle' ? 1 : 0; });
      return out;
    }
    ACTIONS.forEach(function (a) { out[a] = out[a] / sum; });
    return out;
  }

  /** 四项档位 → 趴睡倾向修正合计（百分点） */
  function sleepBias(tiers) {
    var s = 0;
    KEYS.forEach(function (k) {
      var row = SLEEP_MODS[k];
      if (!row || !tiers) return;
      var v = row[tiers[k]];
      if (typeof v === 'number') s += v;
    });
    return s;
  }

  /** 按优先级挑出第一个处于 critical 的需求；无则返回 null */
  function firstCritical(tiers) {
    for (var i = 0; i < PRIORITY.length; i++) {
      if (tiers && tiers[PRIORITY[i]] === 'critical') return PRIORITY[i];
    }
    return null;
  }

  return {
    KEYS: KEYS,
    RANK: RANK,
    NEED_TIERS: NEED_TIERS,
    SENSITIVITY: SENSITIVITY,
    HYSTERESIS: HYSTERESIS,
    WEIGHT_MODS: WEIGHT_MODS,
    SLEEP_MODS: SLEEP_MODS,
    PRIORITY: PRIORITY,
    ACTIONS: ACTIONS,
    NEUTRAL_TIERS: NEUTRAL_TIERS,
    thresholds: thresholds,
    tierOf: tierOf,
    resolve: resolve,
    combineWeights: combineWeights,
    sleepBias: sleepBias,
    firstCritical: firstCritical,
  };
});
