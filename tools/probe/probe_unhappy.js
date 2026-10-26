/* 伤心真机采样：连 CDP 钩住 Animator.prototype.draw，校验
 *   ① 伤心段内姿态缩放系数（mods.scaleMul = poseCur）恒为 1 —— 不再有 0.84 的运行时补偿
 *   ② 切回 idle 的那一帧与伤心末帧系数相同（无尺寸跳变）
 *   ③ 全时段（含姿态切换的淡化期）系数没有任何帧间变化
 *   ④ 伤心段确实出现过（帧序/时长合理）
 *
 * 用法：node tools/probe/probe_unhappy.js [port] [采样秒数]
 * 前提：目标实例已带 --remote-debugging-port 启动，且与启动放在同一次命令里；
 *       实例的 config.json 里 runtime.stats.happiness 已被压到危急档（P4 才有 50% 概率转 unhappy）。
 */
const PORT = process.argv[2] || '9292';
const SECONDS = Number(process.argv[3] || 100);

const getJSON = (p) => fetch(`http://127.0.0.1:${PORT}${p}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await getJSON('/json/list'); if (targets && targets.length) break; } catch { /* retry */ }
    await sleep(500);
  }
  if (!targets || !targets.length) { console.error('[FAIL] CDP 无 target'); process.exit(1); }
  const pages = targets.filter((t) => t.type === 'page');
  const page = pages.find((t) => /index\.html/i.test(t.url)) || pages[0];
  console.log(`[ok] target: ${page.title}  ${page.url.split('/').pop()}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || {}).description);
    return r.result.value;
  };

  await send('Runtime.enable', {});

  // 页面 target 出现时脚本可能还没执行完，轮询等 Animator 就绪（最多 20 s）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await evalJS('typeof Animator !== "undefined"');
    if (ready) break;
    await sleep(500);
  }
  if (!ready) { console.error('[FAIL] Animator 迟迟未就绪'); process.exit(1); }

  const installed = await evalJS(`(() => {
    if (window.__sadLog) return 'already';
    if (typeof Animator === 'undefined') return 'no Animator';
    window.__sadLog = [];
    const orig = Animator.prototype.draw;
    Animator.prototype.draw = function (ctx, o) {
      const L = window.__sadLog;
      const m = (o && o.mods) || {};
      if (L.length < 300000) L.push([this.current, this.frameIndex, Number(m.scaleMul || 0), Number(this.clock || 0)]);
      return orig.call(this, ctx, o);
    };
    return 'ok';
  })()`);
  if (installed !== 'ok' && installed !== 'already') { console.error('[FAIL] 钩子安装失败: ' + installed); process.exit(1); }

  // 只看不干预：属性由启动时的 config 决定（happiness 已在危急档）。
  // 这里只确保不用别的姿态打断采样：关掉语音气泡、100% 体型与动效。
  await evalJS(`window.pet.saveConfig({
    pet: { size: 0.88 },
    appear: { reduceMotion: false },
    behavior: { needVoice: false, restiness: 70, animSpeed: 100, activityLevel: 'normal' },
  })`);

  console.log(`[info] 采样 ${SECONDS} s ...`);
  await sleep(SECONDS * 1000);

  const log = await evalJS('window.__sadLog.slice()');

  let fail = 0;
  const ok = (c, m) => { console.log(`[${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fail++; };

  const segs = [];
  const segEnd = [];
  let cur = null;
  for (let i = 0; i < log.length; i++) {
    if (log[i][0] === 'unhappy') {
      if (!cur) { cur = []; segs.push(cur); }
      cur.push(log[i]);
      segEnd[segs.length - 1] = i;
    } else cur = null;
  }
  const poses = {};
  for (const r of log) poses[r[0]] = (poses[r[0]] || 0) + 1;

  console.log(`[info] 采样帧 ${log.length}，姿态分布 ${JSON.stringify(poses)}`);
  console.log(`[info] 伤心段 ${segs.length} 段`);
  ok(segs.length >= 1, `伤心动作确实被触发：${segs.length} 段`);

  if (segs.length) {
    let maxDev = 0;
    for (const s of segs) for (const r of s) maxDev = Math.max(maxDev, Math.abs(r[2] - 1));
    ok(maxDev < 1e-6, `伤心体型稳定：全程姿态系数恒为 1（最大偏差 ${maxDev.toExponential(1)}）`);

    const handoffs = [];
    for (let k = 0; k < segs.length; k++) {
      const nxt = log[segEnd[k] + 1];
      if (!nxt || nxt[0] !== 'idle') continue;
      handoffs.push(Math.abs(nxt[2] - segs[k][segs[k].length - 1][2]));
    }
    ok(handoffs.length > 0 && Math.max(...handoffs) < 1e-6,
      `切回 idle 无尺寸跳变：${handoffs.length} 次衔接最大差 ${handoffs.length ? Math.max(...handoffs).toExponential(1) : '-'}`);

    const badSeq = [];
    for (const s of segs) {
      const seen = [...new Set(s.map((r) => r[1]))];
      if (seen.length < 2) badSeq.push(seen.join(''));
    }
    ok(badSeq.length === 0, `伤心帧序：每段都推进了 2 帧${badSeq.length ? '，异常 ' + badSeq.join(',') : ''}`);

    const dur = segs.map((s) => (s[s.length - 1][3] - s[0][3]).toFixed(2));
    console.log(`[info] 每段动画时长 ${dur.join(' / ')} s（unhappyTimer 2.6–4.2 s）`);
  }

  // 全时段扫描：任何姿态切换都不该带来系数跳变（fail 只应来自 bath，本采样不触发交互）
  let maxStep = 0;
  let stepAt = '';
  for (let i = 1; i < log.length; i++) {
    const d = Math.abs(log[i][2] - log[i - 1][2]);
    if (d > maxStep) { maxStep = d; stepAt = log[i - 1][0] + '→' + log[i][0]; }
  }
  ok(maxStep < 1e-6,
    `全时段系数无帧间变化（最大 ${maxStep.toExponential(1)}${stepAt ? ' @' + stepAt : ''}）`);

  console.log('');
  if (fail) { console.error(`[FAIL] ${fail} 项未通过`); process.exit(1); }
  console.log('[PASS] 伤心真机校验通过');
})().catch((e) => { console.error('[FAIL] ' + e.message); process.exit(1); });
