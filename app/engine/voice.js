/**
 * voice.js — 喵叫语音引擎
 *
 * 分层：SPEC（情境→素材/冷却/优先级，单一来源）→ 调度（门禁/节流/变体/打断）→ 播放（Web Audio）
 *
 * 素材：assets/audio/meow/<ctx>_<n>.ogg（阶段 1 为占位 .wav；ogg 优先、wav 兜底，
 *       阶段 2 只需把同名 .ogg 放进目录即可替换，无需改代码）
 *
 * 铁律：任何异常（文件缺失、解码失败、未解锁、API 不存在）一律静默降级，
 *       绝不影响气泡显示与行为系统。
 */
(function () {
  'use strict';

  const ROOT = 'assets/audio/meow/';
  const EXTS = ['ogg', 'wav'];   // 真素材优先，占位音兜底
  const MIN_GAP = 1200;          // 全局最小间隔（ms），防刷屏

  /** ctx: files 基名（不带扩展名）/ cd 同情境冷却 / prio 优先级 / gain 额外增益
   *  素材为用户精选集（2026-10-17）：sad/dirty/urgent/sys 等未勾选情境已整体移除，
   *  对应气泡只显示文字、不再发声 */
  const SPEC = {
    pet:    { files: ['pet_3'],                    cd: 900,  prio: 2, gain: 1.0 },
    eat:    { files: ['eat_1'],                    cd: 1500, prio: 2, gain: 1.0 },
    play:   { files: ['play_2'],                   cd: 1200, prio: 2, gain: 1.0 },
    bath:   { files: ['bath_1', 'bath_2'],         cd: 3000, prio: 2, gain: 0.95 },
    wake:   { files: ['wake_1', 'wake_2'],         cd: 2000, prio: 2, gain: 1.0 },
    call:   { files: ['call_2'],                   cd: 1500, prio: 2, gain: 1.0 },
    hungry: { files: ['hungry_2'],                 cd: 6000, prio: 3, gain: 1.0 },
    tired:  { files: ['tired_1'],                  cd: 6000, prio: 3, gain: 0.9 },
    lonely: { files: ['lonely_2'],                 cd: 8000, prio: 1, gain: 0.9 },
    idle:   { files: ['idle_1', 'idle_2'],         cd: 10000, prio: 1, gain: 0.8 },
    /* 呼噜：layer=true 走独立音轨（循环 + 定时淡出），不参与一次性叫声的打断仲裁；
       抚摸时铺底（purr），入睡时更轻更长（purrSleep） */
    purr:      { files: ['purr_1'], cd: 9000,  prio: 1, gain: 0.55, layer: true, maxDur: 2.8 },
    purrSleep: { files: ['purr_2'], cd: 45000, prio: 1, gain: 0.40, layer: true, maxDur: 3.2 },
  };

  /** 气泡 key → 语音情境（需求类走 resolve 的特判） */
  const MAP = {
    pet: 'pet', play: 'play', eat: 'eat', bath: 'bath', wake: 'wake',
    callReply: 'call', ball: 'play', bathStart: 'bath', smell: 'pet',
    welcome: 'idle', lonely: 'lonely', bored: 'lonely', hungry: 'hungry',
    purr: 'purr', purrSleep: 'purrSleep',
  };
  const STAT_CTX = { hunger: 'hungry', energy: 'tired' };

  function resolve(key) {
    if (!key) return null;
    if (key.indexOf('need.') === 0) {
      const p = key.split('.');              // need.<stat>.<tier>
      if (p[2] === 'critical') return null;  // 危急档素材未入选 → 不发声
      if (p[2] === 'good') return null;      // 属性良好不出声，保持"只在有事时叫"
      return STAT_CTX[p[1]] || null;
    }
    return MAP[key] || null;
  }

  /* ---------------- 播放状态 ---------------- */

  let ac = null;
  let master = null;
  const cache = new Map();     // path -> Promise<AudioBuffer|null>
  const lastPlay = {};         // ctx -> 上次播放时间
  const lastPick = {};         // ctx -> 上次变体索引（不连续重复）
  let current = null;          // { ctx, prio, src, gain }
  const layers = {};           // ctx -> { src, gain }  循环铺底音（呼噜），与 current 解耦
  let lastAny = 0;

  const stats = { plays: 0, dropped: 0, errors: 0, lastCtx: null, lastKey: null };

  function now() { return performance.now(); }

  function ensureCtx() {
    if (ac) return ac;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 1;
      master.connect(ac.destination);
    } catch (e) { ac = null; }
    return ac;
  }

  /** autoplay 策略：首次用户手势解锁 AudioContext */
  function unlock() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
  }
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => {
    window.addEventListener(ev, unlock, { once: true, passive: true });
  });

  function loadBuffer(path) {
    if (cache.has(path)) return cache.get(path);
    const p = new Promise((res) => {
      try {
        const x = new XMLHttpRequest();
        x.open('GET', path, true);
        x.responseType = 'arraybuffer';
        x.onload = () => {
          if (!x.response || !x.response.byteLength) return res(null);
          const c = ensureCtx();
          if (!c) return res(null);
          c.decodeAudioData(x.response.slice(0), (ab) => res(ab), () => res(null));
        };
        x.onerror = () => res(null);
        x.send();
      } catch (e) { res(null); }
    });
    cache.set(path, p);
    return p;
  }

  function pick(ctx) {
    const files = SPEC[ctx].files;
    if (files.length === 1) return 0;
    let i = Math.floor(Math.random() * files.length);
    if (i === lastPick[ctx]) i = (i + 1) % files.length;
    lastPick[ctx] = i;
    return i;
  }

  function stopCurrent() {
    if (!current) return;
    try { current.src.stop(); } catch (e) { /* 已结束 */ }
    current = null;
  }

  function start(ab, ctx, o) {
    const c = ensureCtx();
    if (!c) return;
    const spec = SPEC[ctx];
    stopCurrent();
    const src = c.createBufferSource();
    src.buffer = ab;
    // 微变调：±6% 让同一素材不呆板
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = c.createGain();
    const vol = Math.max(0, Math.min(1, (Number(o.volume) || 0) / 100)) * spec.gain;
    const t0 = c.currentTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);   // 8ms 渐入防爆音
    src.connect(g);
    g.connect(master);
    src.onended = () => { if (current && current.src === src) current = null; };
    current = { ctx, prio: spec.prio, src, gain: g };
    try { src.start(); stats.plays++; } catch (e) { stats.errors++; }
  }

  /**
   * 循环铺底音（呼噜）：独立音轨，不抢 current，不参与打断仲裁。
   * 全部时间轴交给 AudioParam 自动化（无 setTimeout 依赖）：
   * 0 → 180ms 渐入 → 保持 → 结束前 450ms 渐出 → stop。
   */
  function startLayer(ab, ctx, o) {
    const c = ensureCtx();
    if (!c) return;
    const spec = SPEC[ctx];
    stopLayer(ctx);
    const src = c.createBufferSource();
    src.buffer = ab;
    src.loop = true;
    const g = c.createGain();
    const vol = Math.max(0, Math.min(1, (Number(o.volume) || 0) / 100)) * spec.gain;
    const t0 = c.currentTime;
    const dur = spec.maxDur || 2.8;
    const fi = 0.18;
    const fo = Math.min(0.45, dur * 0.3);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + fi);
    g.gain.setValueAtTime(vol, t0 + dur - fo);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(g);
    g.connect(master);
    src.onended = () => { if (layers[ctx] && layers[ctx].src === src) delete layers[ctx]; };
    layers[ctx] = { src, gain: g };
    try { src.start(t0); src.stop(t0 + dur + 0.02); stats.plays++; } catch (e) { stats.errors++; }
  }

  function stopLayer(ctx) {
    const l = layers[ctx];
    if (!l) return;
    try { l.src.stop(); } catch (e) { /* 已结束 */ }
    delete layers[ctx];
  }

  /**
   * 播放指定气泡 key 的叫声
   * @param {string} key  气泡 key（如 'pet' / 'need.hunger.critical' / 'purr'）
   * @param {{enabled?:boolean, muted?:boolean, volume?:number}} [opts] 由 renderer 传入设置
   * @returns {boolean} 是否实际进入播放流程
   */
  function play(key, opts) {
    const o = opts || {};
    if (o.enabled === false || o.muted) { stats.dropped++; return false; }
    const ctx = resolve(key);
    if (!ctx || !SPEC[ctx]) { stats.dropped++; return false; }

    const t = now();
    const spec = SPEC[ctx];

    /* 铺底音：只受自身冷却约束（不受全局 MIN_GAP / 一次性叫声影响） */
    if (spec.layer) {
      if (lastPlay[ctx] != null && t - lastPlay[ctx] < spec.cd) { stats.dropped++; return false; }
      const c0 = ensureCtx();
      if (!c0) { stats.errors++; return false; }
      unlock();
      lastPlay[ctx] = t;
      stats.lastCtx = ctx;
      stats.lastKey = key;
      const lb = spec.files[pick(ctx)];
      let lext = 0;
      const lnext = () => {
        if (lext >= EXTS.length) { stats.errors++; return; }
        loadBuffer(ROOT + lb + '.' + EXTS[lext++]).then((ab) => {
          if (!ab) return lnext();
          if (o.muted) return;
          startLayer(ab, ctx, o);
        }).catch(() => {});
      };
      lnext();
      return true;
    }

    if (t - lastAny < MIN_GAP) { stats.dropped++; return false; }                       // 全局节流
    if (lastPlay[ctx] != null && t - lastPlay[ctx] < spec.cd) { stats.dropped++; return false; }  // 同情境冷却
    if (current && current.prio >= spec.prio) { stats.dropped++; return false; }        // 打断仲裁

    const c = ensureCtx();
    if (!c) { stats.errors++; return false; }
    unlock();

    lastPlay[ctx] = t;
    lastAny = t;
    stats.lastCtx = ctx;
    stats.lastKey = key;

    const base = spec.files[pick(ctx)];
    let ext = 0;
    const tryNext = () => {
      if (ext >= EXTS.length) { stats.errors++; return; }   // 全部扩展名均失败：静默
      const path = ROOT + base + '.' + EXTS[ext++];
      loadBuffer(path).then((ab) => {
        if (!ab) return tryNext();
        if (o.muted) return;
        start(ab, ctx, o);
      }).catch(() => {});
    };
    tryNext();
    return true;
  }

  window.Voice = { play, unlock, resolve, stats, SPEC, MAP, stopLayer };
})();
