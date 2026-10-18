/**
 * ai-client.js — OpenAI 兼容协议客户端（提示词 / SSE 解析 / 错误分类 / 请求）
 *
 * 纯逻辑 + 注入式 fetch：不 require electron，可直接在 Node 里跑单测。
 * 主进程传入 net.fetch 走系统代理；测试传入 mock。
 *
 * 设计要点：
 *   - 只做「一次请求 → 文本增量」，不做重试与降级（降级策略在主进程）
 *   - 错误统一归类成 code（设置页据此显示人话）
 *   - 超时分两段：首字节 20s（连接/排队），整体 60s（生成上限）
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AiClient = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var FIRST_MS = 12000;    // 首字节超时（连接/排队）
  var TOTAL_MS = 60000;    // 整体超时

  /** 每类内容的生成指令 + token 预算 */
  var STYLE = {
    joke: {
      zh: '讲一个猫咪视角的冷笑话，2 到 3 句，最后一句要有反转或者自嘲，别解释笑点。',
      en: 'Tell a dry cat-perspective joke in 2-3 short sentences with a twist at the end. Do not explain the joke.',
      tokens: 160,
    },
    story: {
      zh: '讲一个很短的小故事，5 到 8 句，第三人称，主角是猫或小动物，要有画面感，结尾轻轻落下，不要说教。',
      en: 'Tell a very short story in 5-8 sentences, third person, starring a cat or small animal. Vivid but quiet ending, no moral.',
      tokens: 520,
    },
    poem: {
      zh: '写一首短诗，3 到 5 行，每行不超过 18 个字，行与行之间用竖线 | 分隔（一行一个竖线），具象、干净，不必押韵。',
      en: 'Write a short poem, 3-5 lines, each under 18 characters, separated by a pipe |. Concrete and clean, rhyme optional.',
      tokens: 160,
    },
    riddle: {
      zh: '出一个关于猫或日常小物的谜语。第一句提问，不超过 30 个字；第二句立刻公布答案，格式是「谜底：xx」。不要让人回答。',
      en: 'Make a riddle about a cat or an everyday object. First sentence asks (under 30 chars), second reveals the answer as "Answer: xx". Never ask the user to reply.',
      tokens: 150,
    },
    fact: {
      zh: '讲一个真实的猫咪冷知识，3 句以内：先讲事实，最后一句用猫的口吻吐槽。必须真实，不确定宁可换一个。',
      en: 'Give one true cat fact in at most 3 sentences: the fact first, then one snarky line in the cat voice. Only real facts.',
      tokens: 200,
    },
    idle: {
      zh: '像猫一样随口说两三句话，可以抱怨肚子饿、天气、窗外的小鸟、或者你不在家。有点懒散和小傲娇。',
      en: 'Say two or three idle lines like a cat: complain about hunger, weather, birds outside, or being left alone. Lazy and a bit smug.',
      tokens: 150,
    },
  };

  /** 全局硬约束（中英各一份） */
  var RULES = {
    zh: [
      '你是{owner}养的猫，名字叫{name}，住在{owner}的电脑桌面上。你只以猫的身份说话。',
      '输出规则（必须遵守）：',
      '1. 只输出要说的话本身；不要解释、不要旁白、不要寒暄、不要向用户提问、不要等回应。',
      '2. 用中文口语短句，每句不超过 30 个字，句末用句号、问号或感叹号。',
      '3. 不要使用 Markdown、列表、括号说明、颜文字或 emoji。',
      '4. 绝不提到自己是 AI、模型、程序，也不要提"生成""提示词""字数"。',
      '5. 内容具体、有画面感，别讲大道理。',
    ].join('\n'),
    en: [
      'You are {name}, a cat owned by {owner}, living on the corner of {owner}\'s desktop. You only ever speak as a cat.',
      'Output rules (mandatory):',
      '1. Output only the words you say. No explanation, no narration, no greeting, never ask the user a question, never wait for a reply.',
      '2. Use short spoken sentences under 30 characters each, ending with . ? or !',
      '3. No Markdown, no lists, no bracketed stage directions, no emoji.',
      '4. Never mention being an AI, a model or a program; never mention "generating" or "prompt".',
      '5. Be concrete and vivid; no moralising.',
    ].join('\n'),
  };

  function zh(l) { return l === 'en-US' || l === 'en' ? false : true; }

  function fill(s, ctx) {
    return String(s)
      .replace(/\{name\}/g, (ctx && ctx.name) || '猫')
      .replace(/\{owner\}/g, (ctx && ctx.owner) || '铲屎官');
  }

  /**
   * 构造 messages。
   * @param {string} cat joke|story|poem|riddle|fact|idle
   * @param {{name?:string, owner?:string, hour?:number, mood?:string, titles?:string[], lang?:string}} ctx
   */
  function buildMessages(cat, ctx) {
    var c = ctx || {};
    var isZh = zh(c.lang);
    var st = STYLE[cat] || STYLE.idle;
    var sys = fill(RULES[isZh ? 'zh' : 'en'], c);
    var parts = [isZh ? st.zh : st.en];

    var titles = (c.titles || []).filter(Boolean).slice(0, 5);
    if (titles.length) {
      parts.push(isZh
        ? '最近已经讲过这些，务必换完全不同的内容（不要重复题材、梗和句式）：' + titles.join('／')
        : 'Recently said (avoid these topics, jokes and phrasings entirely): ' + titles.join(' / '));
    }

    var hour = Number(c.hour);
    var mood = c.mood;
    var tail = [];
    if (Number.isFinite(hour)) tail.push(isZh ? '现在是 ' + hour + ' 点' : 'It is around ' + hour + ':00');
    if (mood) tail.push(mood);
    if (tail.length) parts.push((isZh ? '情境：' : 'Context: ') + tail.join(isZh ? '，' : ', ') + (isZh ? '。' : '.'));

    return [
      { role: 'system', content: sys },
      { role: 'user', content: parts.join('\n') },
    ];
  }

  /** max_tokens 预算 */
  function tokensFor(cat) {
    return (STYLE[cat] || STYLE.idle).tokens;
  }

  /** 接口地址：容忍 /v1、/v1/ 或已写全 /chat/completions */
  function endpointOf(baseUrl) {
    var b = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!b) return '';
    if (/\/chat\/completions$/.test(b)) return b;
    return b + '/chat/completions';
  }

  /** 本地服务（Ollama 等）不要求密钥 */
  function isLocalUrl(baseUrl) {
    return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(String(baseUrl || '').trim());
  }

  function pickDetail(text) {
    var s = String(text || '');
    try {
      var j = JSON.parse(s);
      if (j && j.error) return String(j.error.message || j.error).slice(0, 160);
      if (j && j.message) return String(j.message).slice(0, 160);
    } catch (_) { /* 非 JSON */ }
    return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  /** HTTP 状态 → 错误码 */
  function classify(status, bodyText) {
    var detail = pickDetail(bodyText);
    var st = Number(status) || 0;
    var code;
    if (st === 401 || st === 403) code = 'unauthorized';
    else if (st === 402) code = 'quota';
    else if (st === 429) code = 'rate-limit';
    else if (st === 404) code = 'not-found';
    else if (st === 400 || st === 422) code = 'bad-request';
    else if (st >= 500) code = 'server';
    else code = 'http';
    return { code: code, detail: detail, status: st };
  }

  /** 网络异常 → 错误码 */
  function netError(err) {
    if (!err) return { code: 'network', detail: '' };
    var msg = String(err.message || err);
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR') return { code: 'aborted', detail: msg };
    if (err.code === 'ETIMEDOUT' || /timed?\s?out|timeout/i.test(msg)) return { code: 'timeout', detail: msg };
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|net::ERR/i.test(msg)) {
      return { code: 'network', detail: msg };
    }
    return { code: 'network', detail: msg };
  }

  /** 增量 SSE 解析：喂 chunk，出事件 {json} / {done:true} */
  function createSseParser() {
    var buf = '';
    return {
      push: function (chunk) {
        buf += String(chunk == null ? '' : chunk);
        var out = [];
        var idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (!line || line.charAt(0) === ':') continue;   // 空行 / 心跳注释
          if (line.indexOf('data:') !== 0) continue;       // event: / id: 等忽略
          var data = line.slice(5).replace(/^\s+/, '');
          if (data === '[DONE]') { out.push({ done: true }); continue; }
          if (!data) continue;
          try { out.push({ json: JSON.parse(data) }); } catch (_) { /* 半包丢弃 */ }
        }
        return out;
      },
    };
  }

  /** 从一帧 JSON 取正文增量（兼容流式与非流式两种形状） */
  function deltaOf(json) {
    if (!json) return '';
    var ch = json.choices && json.choices[0];
    if (!ch) return '';
    if (ch.delta && typeof ch.delta.content === 'string') return ch.delta.content;
    if (ch.message && typeof ch.message.content === 'string') return ch.message.content;
    if (typeof ch.text === 'string') return ch.text;
    return '';
  }

  function withTimeout(promise, ms) {
    var t;
    var guard = new Promise(function (_, reject) {
      t = setTimeout(function () {
        var e = new Error('timeout');
        e.code = 'ETIMEDOUT';
        reject(e);
      }, ms);
    });
    return Promise.race([promise, guard]).then(
      function (v) { clearTimeout(t); return v; },
      function (e) { clearTimeout(t); throw e; }
    );
  }

  /** 读响应体：支持 web ReadableStream / async iterator / 字符串；onText 返回 false 提前结束 */
  async function readBody(body, onText, ms, isStopped) {
    if (!body) return;
    if (typeof body === 'string') { onText(body); return; }
    var decoder = (typeof TextDecoder === 'function') ? new TextDecoder('utf-8') : null;

    if (typeof body.getReader === 'function') {
      var reader = body.getReader();
      try {
        while (true) {
          if (isStopped && isStopped()) { try { await reader.cancel(); } catch (_) {} return; }
          var step = await withTimeout(reader.read(), ms);
          if (step.done) return;
          var txt = decoder ? decoder.decode(step.value, { stream: true }) : String(step.value);
          if (txt && onText(txt) === false) { try { await reader.cancel(); } catch (_) {} return; }
        }
      } finally {
        try { reader.releaseLock(); } catch (_) {}
      }
    }

    if (typeof body[Symbol.asyncIterator] === 'function') {
      for await (var chunk of body) {
        if (isStopped && isStopped()) return;
        var s = decoder ? decoder.decode(chunk, { stream: true }) : String(chunk);
        if (s && onText(s) === false) return;
      }
    }
  }

  function payloadOf(o, stream) {
    var p = {
      model: o.model,
      messages: o.messages,
      stream: !!stream,
      temperature: Number.isFinite(o.temperature) ? o.temperature : 0.9,
    };
    if (o.maxTokens) p.max_tokens = o.maxTokens;
    if (o.stop) p.stop = o.stop;
    return p;
  }

  /**
   * 非流式单次请求（连接测试用）。
   * @returns {Promise<{ok:boolean, code?:string, detail?:string, text?:string, ms?:number}>}
   */
  async function chatOnce(o) {
    var t0 = Date.now();
    var url = endpointOf(o.baseUrl);
    if (!url) return { ok: false, code: 'bad-url', detail: 'baseUrl empty' };
    if (!o.model) return { ok: false, code: 'no-model', detail: 'model empty' };

    var headers = { 'Content-Type': 'application/json' };
    if (o.apiKey) headers.Authorization = 'Bearer ' + o.apiKey;

    var res;
    try {
      res = await withTimeout(o.fetchImpl(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payloadOf(o, false)),
      }), o.timeoutMs || FIRST_MS);
    } catch (e) {
      var ne = netError(e);
      return { ok: false, code: ne.code, detail: ne.detail, ms: Date.now() - t0 };
    }

    var bodyText = '';
    try { bodyText = await withTimeout(res.text(), 10000); } catch (_) {}

    if (!res.ok) {
      var k = classify(res.status, bodyText);
      return { ok: false, code: k.code, detail: k.detail, status: k.status, ms: Date.now() - t0 };
    }

    var text = '';
    try {
      var j = JSON.parse(bodyText);
      text = deltaOf(j);
    } catch (_) {
      return { ok: false, code: 'bad-response', detail: pickDetail(bodyText), ms: Date.now() - t0 };
    }
    if (!text) return { ok: false, code: 'bad-response', detail: 'empty content', ms: Date.now() - t0 };
    return { ok: true, text: text, ms: Date.now() - t0 };
  }

  /**
   * 流式生成：边收边回调 onText(delta)。
   * @param {object} o {fetchImpl, baseUrl, apiKey, model, messages, maxTokens, temperature,
   *                    onText(fn), firstMs?, totalMs?, isStopped?()}
   * @returns {Promise<{ok:boolean, code?:string, detail?:string, chars?:number, aborted?:boolean}>}
   */
  async function streamChat(o) {
    var url = endpointOf(o.baseUrl);
    if (!url) return { ok: false, code: 'bad-url', detail: 'baseUrl empty' };
    if (!o.model) return { ok: false, code: 'no-model', detail: 'model empty' };

    var headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (o.apiKey) headers.Authorization = 'Bearer ' + o.apiKey;

    var ctrl = null;
    try { ctrl = new AbortController(); } catch (_) {}
    if (ctrl && o.signal && typeof o.signal.addEventListener === 'function') {
      if (o.signal.aborted) ctrl.abort();
      else o.signal.addEventListener('abort', function () { try { ctrl.abort(); } catch (_) {} });
    }
    var stopped = false;
    var res;

    try {
      res = await withTimeout(o.fetchImpl(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payloadOf(o, true)),
        signal: ctrl ? ctrl.signal : undefined,
      }), o.firstMs || FIRST_MS);
    } catch (e) {
      var ne = netError(e);
      return { ok: false, code: ne.code, detail: ne.detail };
    }

    if (!res.ok) {
      var bodyText = '';
      try { bodyText = await withTimeout(res.text(), 8000); } catch (_) {}
      var k = classify(res.status, bodyText);
      return { ok: false, code: k.code, detail: k.detail, status: k.status };
    }

    var parser = createSseParser();
    var chars = 0;
    var done = false;
    var streamErr = null;

    function onText(chunk) {
      if (done) return false;
      var evs = parser.push(chunk);
      for (var i = 0; i < evs.length; i++) {
        if (evs[i].done) { done = true; break; }
        var j = evs[i].json;
        if (j && j.error) { streamErr = String(j.error.message || j.error).slice(0, 160); return false; }
        var d = deltaOf(j);
        if (d) {
          chars += d.length;
          if (o.onText) {
            var r = o.onText(d);
            if (r === false) return false;
          }
        }
      }
      return true;
    }

    try {
      await readBody(res.body, onText, o.totalMs || TOTAL_MS, o.isStopped);
    } catch (e) {
      var re = netError(e);
      if (o.isStopped && o.isStopped()) return { ok: false, code: 'aborted', aborted: true, chars: chars };
      return { ok: false, code: re.code, detail: re.detail, chars: chars };
    }

    if (stopped || (o.isStopped && o.isStopped())) return { ok: false, code: 'aborted', aborted: true, chars: chars };
    if (streamErr) return { ok: false, code: 'server', detail: streamErr, chars: chars };
    if (!chars) return { ok: false, code: 'bad-response', detail: 'empty content' };
    return { ok: true, chars: chars };
  }

  return {
    FIRST_MS: FIRST_MS,
    TOTAL_MS: TOTAL_MS,
    STYLE: STYLE,
    RULES: RULES,
    buildMessages: buildMessages,
    tokensFor: tokensFor,
    endpointOf: endpointOf,
    isLocalUrl: isLocalUrl,
    classify: classify,
    netError: netError,
    pickDetail: pickDetail,
    createSseParser: createSseParser,
    deltaOf: deltaOf,
    chatOnce: chatOnce,
    streamChat: streamChat,
  };
});
