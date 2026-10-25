/* 摇尾巴真机采样：连 CDP 钩住 Animator.prototype.draw，校验三件事
 *   ① 姿态缩放系数（mods.scaleMul = poseCur）在 tailwag 全程恒为 1 —— 不再有「缩一圈再涨回来」
 *   ② 每段 tailwag 收在循环首帧（frameIndex 0），不出现半拍定格
 *   ③ 每段至少 2 轮（按 7 fps / 4 帧 = 0.571 s 一轮折算）
 * 用法：node tools/probe_tailwag.js [port] [采样秒数]
 * 前提：目标实例已带 --remote-debugging-port 启动，且与启动放在同一次命令里。
 */
const PORT = process.argv[2] || '9280';
const SEC = Number(process.argv[3] || 200);
const CYCLE = 4 / 7;

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
    if (window.__wagLog) return 'already';
    if (typeof Animator === 'undefined') return 'no Animator';
    window.__wagLog = [];
    const orig = Animator.prototype.draw;
    Animator.prototype.draw = function (ctx, o) {
      const L = window.__wagLog;
      const m = (o && o.mods) || {};
      if (L.length < 300000) L.push([this.current, this.frameIndex, Number(m.scaleMul || 0), Number(this.clock || 0)]);
      return orig.call(this, ctx, o);
    };
    return 'ok';
  })()`);
  if (installed !== 'ok' && installed !== 'already') { console.error('[FAIL] 钩子安装失败: ' + installed); process.exit(1); }
  console.log(`[ok] 钩子已安装，采样 ${SEC} s（不打扰，等它自己摇尾巴）...`);

  // 强制清醒 + 不衰减：默认配置下以趴睡为主，窗口内抽不到 tailwag
  await evalJS(`window.pet.saveConfig({
    behavior: { restiness: 0, animSpeed: 100, activityLevel: 'normal' },
    needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
    runtime: { stats: { energy: 95, happiness: 90, hunger: 80, cleanliness: 95 } },
  })`);

  await sleep(SEC * 1000);

  const log = await evalJS('window.__wagLog.slice()');
  const idleScales = log.filter((r) => r[0] === 'idle').map((r) => r[2]);
  const idleBase = idleScales.length
    ? idleScales.slice().sort((a, b) => a - b)[Math.floor(idleScales.length / 2)]
    : 1;

  const segs = [];
  const segEnd = [];
  let cur = null;
  for (let i = 0; i < log.length; i++) {
    const r = log[i];
    if (r[0] === 'tailwag') {
      if (!cur) { cur = []; segs.push(cur); }
      cur.push(r);
      segEnd[segs.length - 1] = i;
    } else cur = null;
  }
  console.log(`[info] 采样帧 ${log.length}，其中 tailwag ${log.filter((r) => r[0] === 'tailwag').length} 帧，共 ${segs.length} 段`);
  console.log(`[info] idle 姿态系数中位数 ${idleBase.toFixed(4)}（应为 1.0000：idle 无姿态校正）`);

  // 姿态占比（清醒状态下的状态分布，用于核对「idle 为主」）
  const share = {};
  for (const r of log) share[r[0]] = (share[r[0]] || 0) + 1;
  const distLine = Object.keys(share)
    .sort((a, b) => share[b] - share[a])
    .map((k) => `${k} ${(share[k] / log.length * 100).toFixed(1)}%`)
    .join(' / ');
  console.log(`[info] 姿态占比: ${distLine}`);

  let fail = 0;
  const ok = (c, m) => { console.log(`[${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fail++; };

  ok(Math.abs(idleBase - 1) < 1e-6, `idle 基线：姿态系数 ${idleBase.toFixed(4)} 恒为 1`);
  ok(segs.length > 0, `${SEC} s 内触发了 ${segs.length} 段摇尾巴`);

  if (segs.length) {
    // ① 姿态系数恒定（含进入后的头几帧——旧实现的平滑爬坡会在这里露馅）
    const bad = [];
    let maxDev = 0;
    for (const s of segs) {
      for (const r of s) {
        const dev = Math.abs(r[2] - 1);
        maxDev = Math.max(maxDev, dev);
        if (dev > 1e-6) bad.push(`${r[2]}`);
      }
    }
    ok(bad.length === 0,
      `体型稳定：全程姿态系数恒为 1（最大偏差 ${maxDev.toExponential(1)}）${bad.length ? '，异常值 ' + bad.slice(0, 5).join('/') : ''}`);

    // 分段归类：正常退出（后一个姿态是 idle）才要求「收在循环首帧 + ≥2 轮」；
    // 被危急需求打断（INTERRUPTIBLE）或采样恰好截止的段不计入。
    const normal = [];
    const excused = [];
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      const nxt = log[segEnd[k] + 1];
      const nextName = nxt ? nxt[0] : '(采样截止)';
      const cycles = (s[s.length - 1][3] - s[0][3]) / CYCLE;
      if (nextName === 'idle') normal.push({ s, cycles });
      else excused.push(`${nextName}:${cycles.toFixed(1)}轮`);
    }
    if (excused.length) console.log(`[info] 不计入的段（被打断/采样截止）: ${excused.join(' / ')}`);
    ok(normal.length > 0, `正常退出的段: ${normal.length} 段（其余 ${excused.length} 段被打断或采样截止）`);

    // ② 收在循环首帧
    const notSeam = normal.filter(({ s }) => s[s.length - 1][1] !== 0).length;
    ok(notSeam === 0, `收尾接缝：正常退出的段末帧都是 tailwag_1（例外 ${notSeam} 段）`);

    // ③ 至少 2 轮
    const cyc = normal.map(({ cycles }) => cycles);
    ok(cyc.length > 0 && Math.min(...cyc) >= 2,
      `循环轮数：${cyc.map((c) => c.toFixed(1)).join('/')} 轮（≥2）`);

    // ④ 帧序不跳（允许 rAF 快于帧率导致的同帧重复）
    const jumps = [];
    for (const s of segs) {
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1][1]; const b = s[i][1];
        if (b !== a && b !== (a + 1) % 4) { jumps.push(`${a + 1}→${b + 1}`); break; }
      }
    }
    ok(jumps.length === 0, `帧序：1→2→3→4→1 无跳帧${jumps.length ? '，异常 ' + jumps.slice(0, 5).join(',') : ''}`);
  }

  console.log('');
  if (fail) { console.error(`[FAIL] ${fail} 项未通过`); process.exit(1); }
  console.log('[PASS] 摇尾巴真机校验通过');
})().catch((e) => { console.error('[FAIL] ' + e.message); process.exit(1); });
