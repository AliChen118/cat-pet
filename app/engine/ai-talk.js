/**
 * ai-talk.js — 自言自语纯逻辑层（无 IO、无 Electron 依赖）
 *
 * 同时服务于：
 *   - 主进程：切句 / 截断 / 去重 / 掩码
 *   - 渲染进程：类别表、句子停留节奏、自主间隔
 *   - 测试：直接 require 断言
 *
 * 设计约束：猫只单向说话，没有对话上下文——这里唯一的"记忆"是去重窗口。
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AiTalk = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * 六类内容。maxSent / maxChars 是硬上限（模型跑偏时截断），
   * voice 是首句配音用的语音情境（沿用 engine/voice.js 的 SPEC）。
   */
  var CATS = {
    joke:   { zh: '笑话',   en: 'Joke',        maxSent: 3, maxChars: 90,  voice: 'idle',  key: 'joke' },
    story:  { zh: '故事',   en: 'Story',       maxSent: 8, maxChars: 260, voice: 'tired', key: 'story' },
    poem:   { zh: '诗',     en: 'Poem',        maxSent: 5, maxChars: 90,  voice: 'tired', key: 'poem',  verse: true },
    riddle: { zh: '谜语',   en: 'Riddle',      maxSent: 3, maxChars: 80,  voice: 'idle',  key: 'riddle' },
    fact:   { zh: '冷知识', en: 'Cat fact',    maxSent: 3, maxChars: 100, voice: 'idle',  key: 'fact' },
    idle:   { zh: '随口说', en: 'Small talk',  maxSent: 3, maxChars: 70,  voice: 'idle',  key: 'idle' },
  };

  var CAT_KEYS = ['joke', 'story', 'poem', 'riddle', 'fact', 'idle'];

  /** 自主挑类别时的权重（越低越少），总和不要求 100 */
  var WEIGHTS = { joke: 22, story: 12, poem: 11, riddle: 11, fact: 22, idle: 22 };

  /** 句子停留节奏倍率（ai.bubblePace） */
  var PACE = { fast: 0.75, normal: 1, slow: 1.35 };

  /** 自主播报间隔区间（分钟）：ai.autoTalk */
  var AUTO_MIN = { rare: [5, 10], normal: [2, 5], often: [1, 2] };

  /** 预设服务商（settings 自动填、主进程兜底） */
  var PRESETS = {
    // 免费额度优先（详见 README「免费模型服务」）
    zhipu:       { baseUrl: 'https://open.bigmodel.cn/api/paas/v4',        model: 'glm-4-flash' },
    siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1',                model: 'Qwen/Qwen3-8B' },
    modelscope:  { baseUrl: 'https://api-inference.modelscope.cn/v1',       model: 'Qwen/Qwen3-8B' },
    dashscope:   { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-flash' },
    ark:         { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',     model: 'doubao-seed-1-6-flash-250715' },
    // 付费/自有
    deepseek:    { baseUrl: 'https://api.deepseek.com/v1',                  model: 'deepseek-chat' },
    moonshot:    { baseUrl: 'https://api.moonshot.cn/v1',                   model: 'moonshot-v1-8k' },
    ollama:      { baseUrl: 'http://127.0.0.1:11434/v1',                    model: 'qwen2.5:7b' },
    custom:      null,
  };

  var MAX_RECENT = 20;      // 去重记录保留条数
  var DEDUPE_DAYS = 3;      // 同内容 3 天内不重复
  var MAX_SENT_LEN = 36;    // 单句硬上限（气泡宽度约束）

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function trim(s) { return String(s == null ? '' : s).replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''); }

  /**
   * 切句：气泡与语音共用同一节奏。
   * @param {string} text
   * @param {{verse?:boolean, maxLen?:number}} [opts] verse=true 时按 | 与换行分行（诗句不合并）
   * @returns {string[]}
   */
  function splitSentences(text, opts) {
    opts = opts || {};
    var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ');
    s = trim(s);
    if (!s) return [];
    var max = opts.maxLen || MAX_SENT_LEN;

    /* 诗：一行一句，保留断行节奏，不做合并 */
    if (opts.verse) {
      return s.split(/\n|\|/).map(trim).filter(function (t) { return !!t; })
        .map(function (t) { return t.length > max ? t.slice(0, max) : t; });
    }

    /* 正文：先按行，再按句末标点切（连续标点如「……」一并收尾） */
    var segs = [];
    s.split(/\n+/).forEach(function (line) {
      line = trim(line);
      if (!line) return;
      var cur = '';
      for (var i = 0; i < line.length; i++) {
        cur += line[i];
        if (/[。！？!?…]/.test(line[i])) {
          while (i + 1 < line.length && /[。！？!?…]/.test(line[i + 1])) { cur += line[++i]; }
          segs.push(cur);
          cur = '';
        }
      }
      if (trim(cur)) segs.push(cur);
    });

    /* 超长硬切：优先在逗号处断开，避免切在词中间 */
    var chunks = [];
    segs.forEach(function (raw) {
      var t = trim(raw);
      while (t.length > max) {
        var cut = max;
        var comma = t.lastIndexOf('，', max);
        if (comma >= Math.floor(max * 0.6)) cut = comma + 1;
        chunks.push(trim(t.slice(0, cut)));
        t = trim(t.slice(cut));
      }
      if (t) chunks.push(t);
    });

    /* 过短片段合并：单独的「喵。」不占一次冒泡 */
    var out = [];
    for (var j = 0; j < chunks.length; j++) {
      var c = chunks[j];
      if (c.length < 8) {
        if (out.length && (out[out.length - 1] + c).length <= max) {
          out[out.length - 1] += c;
          continue;
        }
        if (j + 1 < chunks.length && (c + chunks[j + 1]).length <= max) {
          chunks[j + 1] = c + chunks[j + 1];
          continue;
        }
      }
      out.push(c);
    }
    return out.filter(function (t) { return !!t; });
  }

  /**
   * 流式切句器：喂增量文本，立刻吐出已经说完的句子（模型边生成边播报）。
   *
   * 与 splitSentences 的差别：
   *   - 增量处理，保留未说完的尾巴到下一次 push
   *   - 句末标点必须等到下一个字符到达才切（否则「真的吗？！」会被切坏）
   *   - 同一批内做过短片段合并；跨批不合并（已发出的气泡无法回收）
   *
   * @param {{verse?:boolean, maxLen?:number}} [opts]
   * @returns {{push:(chunk:string)=>string[], flush:()=>string[], rest:()=>string}}
   */
  function createSentenceStream(opts) {
    opts = opts || {};
    var max = opts.maxLen || MAX_SENT_LEN;
    var verse = !!opts.verse;
    var buf = '';
    var START = /[。！？!?…]/;

    function clip(t) { return t.length > max ? trim(t.slice(0, max)) : t; }

    function pushMerge(out, seg) {
      var s = trim(seg);
      if (!s) return;
      var last = out.length ? out[out.length - 1] : '';
      if (s.length < 8 && last && (last + s).length <= max) {
        out[out.length - 1] = last + s;
        return;
      }
      out.push(clip(s));
    }

    function drain(final) {
      var out = [];

      if (verse) {
        while (true) {
          var idx = buf.search(/[\n|]/);
          if (idx < 0) break;
          var line = trim(buf.slice(0, idx));
          buf = buf.slice(idx + 1);
          if (line) out.push(clip(line));
        }
        /* 模型不听话写了一整段、没有分隔符时：攒到两倍上限再硬切，避免提前切断诗句 */
        while (buf.length > max * 2) {
          out.push(trim(buf.slice(0, max)));
          buf = buf.slice(max);
        }
        if (final) {
          var t = trim(buf);
          buf = '';
          while (t.length > max) { out.push(trim(t.slice(0, max))); t = trim(t.slice(max)); }
          if (t) out.push(t);
        }
        return out;
      }

      while (true) {
        var cut = -1;
        for (var i = 0; i < buf.length; i++) {
          if (START.test(buf[i])) {
            var j = i;
            while (j + 1 < buf.length && START.test(buf[j + 1])) j++;
            if (j + 1 < buf.length) cut = j + 1;   // 后面还有字，才算这句真的说完
            break;
          }
          if (i + 1 >= max) {                       // 迟迟没有标点：超长兜底
            var comma = buf.lastIndexOf('，', max);
            cut = comma >= Math.floor(max * 0.6) ? comma + 1 : max;
            break;
          }
        }
        if (cut < 0) break;
        var seg = buf.slice(0, cut);
        buf = buf.slice(cut);
        pushMerge(out, seg);
      }

      if (final) {
        var rest = trim(buf);
        buf = '';
        while (rest.length > max) {
          var c2 = rest.lastIndexOf('，', max);
          var k = c2 >= Math.floor(max * 0.6) ? c2 + 1 : max;
          pushMerge(out, rest.slice(0, k));
          rest = trim(rest.slice(k));
        }
        if (rest) pushMerge(out, rest);
      }
      return out;
    }

    return {
      push: function (chunk) {
        buf += String(chunk == null ? '' : chunk).replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ');
        return drain(false);
      },
      flush: function () { return drain(true); },
      rest: function () { return buf; },
    };
  }

  /** 单句停留时长（毫秒）：字数自适应 1.5–6s，再乘节奏倍率 */
  function holdFor(text, pace) {
    var n = String(text == null ? '' : text).length;
    var base = clamp(Math.round(n * 118 + 780), 1500, 6000);
    var m = PACE[pace] || 1;
    return Math.round(clamp(base * m, 1200, 8000));
  }

  /** 自主播报间隔（秒）：返回 0 表示关闭 */
  function delayFor(level, rng) {
    var r = AUTO_MIN[level];
    if (!r) return 0;
    var f = typeof rng === 'function' ? rng : Math.random;
    return Math.round((r[0] + f() * (r[1] - r[0])) * 60);
  }

  /** 自主挑类别：按权重轮盘；命中上次同类时顺延一个（避免连着两段都是笑话） */
  function pickCategory(rng, last) {
    var f = typeof rng === 'function' ? rng : Math.random;
    var total = 0;
    CAT_KEYS.forEach(function (k) { total += WEIGHTS[k]; });
    var r = f() * total;
    for (var i = 0; i < CAT_KEYS.length; i++) {
      r -= WEIGHTS[CAT_KEYS[i]];
      if (r <= 0) {
        if (CAT_KEYS[i] === last) return CAT_KEYS[(i + 1) % CAT_KEYS.length];
        return CAT_KEYS[i];
      }
    }
    return CAT_KEYS[0];
  }

  /** 文本指纹（FNV-1a 32bit） */
  function hash(str) {
    var h = 0x811c9dc5;
    var s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h.toString(16);
  }

  function keyOf(cat, lines) {
    return String(cat) + ':' + hash((lines || []).join(''));
  }

  /** 清理记录：只留 DEDUPE_DAYS 内、最多 MAX_RECENT 条（新的在前） */
  function pruneRecent(list, now) {
    var t = Number(now) || Date.now();
    var cut = t - DEDUPE_DAYS * 86400000;
    return (Array.isArray(list) ? list : [])
      .filter(function (e) { return e && e.key && Number(e.ts) >= cut; })
      .sort(function (a, b) { return b.ts - a.ts; })
      .slice(0, MAX_RECENT);
  }

  function isDup(list, key, now) {
    var t = Number(now) || Date.now();
    var cut = t - DEDUPE_DAYS * 86400000;
    return (Array.isArray(list) ? list : []).some(function (e) {
      return e && e.key === key && Number(e.ts) >= cut;
    });
  }

  /** 追加一条记录并返回新数组（不修改入参） */
  function pushRecent(list, entry, now) {
    var out = Array.isArray(list) ? list.slice() : [];
    out.unshift({ key: entry.key, cat: entry.cat, title: String(entry.title || '').slice(0, 40), ts: Number(now) || Date.now() });
    return pruneRecent(out, Number(now) || Date.now());
  }

  /** 按类别上限截断句数与总字数（不切半句） */
  function clipLines(lines, cat) {
    var c = CATS[cat] || CATS.idle;
    var out = [];
    var total = 0;
    (lines || []).forEach(function (raw) {
      if (out.length >= c.maxSent) return;
      var t = trim(raw);
      if (!t) return;
      if (out.length && total + t.length > c.maxChars) return;
      out.push(t);
      total += t.length;
    });
    return out;
  }

  /** 最近同类标题（注入提示词，让模型换一个） */
  function recentTitles(list, cat, n) {
    return (Array.isArray(list) ? list : [])
      .filter(function (e) { return e && e.cat === cat && e.title; })
      .slice(0, n || 5)
      .map(function (e) { return e.title; });
  }

  /** 密钥掩码：sk-abcd…wxyz → sk-****wxyz；空值返回 '' */
  function maskKey(k) {
    var s = String(k == null ? '' : k);
    if (!s) return '';
    if (s.length <= 8) return '****';
    var head = /^sk-/.test(s) ? 'sk-' : s.slice(0, 2);
    return head + '****' + s.slice(-4);
  }

  /**
   * 净化模型输出（气泡显示与去重指纹共用）：
   * 模型偶尔把 \uXXXX 转义序列、\n 字面量或控制字符当正文输出，
   * 原样渲染就是一串「乱码编码」。只解码完整合法的序列，避免误伤正文反斜杠。
   */
  function sanitize(text) {
    var t = String(text == null ? '' : text);
    if (t.indexOf('\\') >= 0) {
      t = t.replace(/\\u([0-9a-fA-F]{4})/g, function (_, h) {
        try { return String.fromCharCode(parseInt(h, 16)); } catch (e) { return _; }
      });
      t = t.replace(/\\n/g, ' ').replace(/\\t/g, ' ');
    }
    return t.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  }

  return {
    CATS: CATS,
    CAT_KEYS: CAT_KEYS,
    WEIGHTS: WEIGHTS,
    PACE: PACE,
    AUTO_MIN: AUTO_MIN,
    PRESETS: PRESETS,
    MAX_RECENT: MAX_RECENT,
    DEDUPE_DAYS: DEDUPE_DAYS,
    MAX_SENT_LEN: MAX_SENT_LEN,
    splitSentences: splitSentences,
    createSentenceStream: createSentenceStream,
    holdFor: holdFor,
    delayFor: delayFor,
    pickCategory: pickCategory,
    hash: hash,
    keyOf: keyOf,
    pruneRecent: pruneRecent,
    isDup: isDup,
    pushRecent: pushRecent,
    clipLines: clipLines,
    recentTitles: recentTitles,
    maskKey: maskKey,
    sanitize: sanitize,
  };
});
