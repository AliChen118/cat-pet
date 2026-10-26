/* 抚摸真机采样：连 CDP 钩住 Animator.prototype.draw，校验
 *   ① 抚摸段内姿态缩放系数（mods.scaleMul = poseCur）恒为 1 —— 不再有 1.08 的运行时补偿
 *   ② 抚摸结束切回 idle 的那一帧与抚摸末帧系数相同（无尺寸跳变）
 *   ③ 抚摸段内帧序 1→2→3 正常推进（不卡帧）
 * 用法：node tools/probe/probe_pet.js [port] [抚摸次数]
 * 前提：目标实例已带 --remote-debugging-port 启动，且与启动放在同一次命令里。
 */
const PORT = process.argv[2] || '9290';
const ROUNDS = Number(process.argv[3] || 4);

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

  const installed = await evalJS(`(() => {
    if (window.__petLog) return 'already';
    if (typeof Animator === 'undefined') return 'no Animator';
    window.__petLog = [];
    const orig = Animator.prototype.draw;
    Animator.prototype.draw = function (ctx, o) {
      const L = window.__petLog;
      const m = (o && o.mods) || {};
      if (L.length < 300000) L.push([this.current, this.frameIndex, Number(m.scaleMul || 0), Number(this.clock || 0)]);
      return orig.call(this, ctx, o);
    };
    return 'ok';
  })()`);
  if (installed !== 'ok' && installed !== 'already') { console.error('[FAIL] 钩子安装失败: ' + installed); process.exit(1); }

  // 清醒、不衰减、100% 体型与动效，避免别的姿态插进采样窗口
  await evalJS(`window.pet.saveConfig({
    pet: { size: 0.88 },
    appear: { reduceMotion: false },
    behavior: { restiness: 0, animSpeed: 100, activityLevel: 'normal' },
    needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
    runtime: { stats: { energy: 95, happiness: 90, hunger: 80, cleanliness: 95 } },
  })`);
  await sleep(800);

  for (let i = 0; i < ROUNDS; i++) {
    await evalJS('window.pet.doAction("pet")');
    await sleep(3200);              // 抚摸 1.6 s + 回 idle 的过渡
  }
  await sleep(600);

  const log = await evalJS('window.__petLog.slice()');

  const segs = [];
  const segEnd = [];
  let cur = null;
  for (let i = 0; i < log.length; i++) {
    if (log[i][0] === 'pet') {
      if (!cur) { cur = []; segs.push(cur); }
      cur.push(log[i]);
      segEnd[segs.length - 1] = i;
    } else cur = null;
  }

  let fail = 0;
  const ok = (c, m) => { console.log(`[${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fail++; };

  console.log(`[info] 采样帧 ${log.length}，抚摸段 ${segs.length} 段（计划 ${ROUNDS} 次）`);
  ok(segs.length >= Math.min(ROUNDS, 2), `抚摸动作确实被触发：${segs.length} 段`);

  if (segs.length) {
    // ① 段内系数恒定
    let bad = 0;
    let maxDev = 0;
    const offenders = [];
    for (const s of segs) {
      for (const r of s) {
        const dev = Math.abs(r[2] - 1);
        if (dev > maxDev) maxDev = dev;
        if (dev > 1e-6) { bad++; if (offenders.length < 5) offenders.push(r[2]); }
      }
    }
    ok(bad === 0,
      `抚摸体型稳定：全程姿态系数恒为 1（最大偏差 ${maxDev.toExponential(1)}）${offenders.length ? '，异常 ' + offenders.join('/') : ''}`);

    // ② 切回 idle 无跳变：抚摸末帧系数 = 紧随其后的 idle 首帧系数
    const handoffs = [];
    for (let k = 0; k < segs.length; k++) {
      const nxt = log[segEnd[k] + 1];
      if (!nxt || nxt[0] !== 'idle') continue;
      handoffs.push(Math.abs(nxt[2] - segs[k][segs[k].length - 1][2]));
    }
    ok(handoffs.length > 0 && Math.max(...handoffs) < 1e-6,
      `切回 idle 无尺寸跳变：${handoffs.length} 次衔接最大差 ${handoffs.length ? Math.max(...handoffs).toExponential(1) : '-'}`);

    // ③ 帧序 1→2→3 正常推进
    const badSeq = [];
    for (const s of segs) {
      const seen = [...new Set(s.map((r) => r[1]))];
      if (seen.length < 2) badSeq.push(seen.join(''));
    }
    ok(badSeq.length === 0, `抚摸帧序：每段都推进了多帧${badSeq.length ? '，异常 ' + badSeq.join(',') : ''}`);

    const dur = segs.map((s) => (s[s.length - 1][3] - s[0][3]).toFixed(2));
    console.log(`[info] 每段动画时长 ${dur.join(' / ')} s（petTimer 1.6 s）`);
  }

  console.log('');
  if (fail) { console.error(`[FAIL] ${fail} 项未通过`); process.exit(1); }
  console.log('[PASS] 抚摸真机校验通过');
})().catch((e) => { console.error('[FAIL] ' + e.message); process.exit(1); });
