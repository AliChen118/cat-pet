/* 走/跑真机行为采样：连 CDP，钩住 Animator.prototype.draw 记录 (姿态, 帧号, 轮数)，
 * 采样一段时间后逐段校验「至少 2 个完整循环 / 帧序不跳 / 收在循环首帧」。
 * 用法：node tools/probe_locomotion.js [port] [采样秒数]
 */
const PORT = process.argv[2] || '9270';
const SEC = Number(process.argv[3] || 45);

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
    if (window.__poseLog) return 'already';
    if (typeof Animator === 'undefined') return 'no Animator';
    window.__poseLog = [];
    const orig = Animator.prototype.draw;
    Animator.prototype.draw = function (ctx, o) {
      const L = window.__poseLog;
      if (L.length < 400000) L.push([this.current, this.frameIndex, this.laps]);
      return orig.call(this, ctx, o);
    };
    return 'ok';
  })()`);
  if (installed !== 'ok' && installed !== 'already') { console.error('[FAIL] 钩子安装失败: ' + installed); process.exit(1); }
  console.log(`[ok] 钩子已安装，采样 ${SEC} s ...`);

  // 强制活跃：默认配置下它会趴睡，采样窗口内根本不会走/跑
  await evalJS(`window.pet.saveConfig({
    behavior: { restiness: 0, animSpeed: 100 },
    runtime: { stats: { energy: 92, happiness: 88, hunger: 78, cleanliness: 82 } },
  })`);
  await sleep(1200);

  // 定时逗它走向随机位置（鼠标移动 → 呼喊 → 走到光标），保证窗口内有多段走动
  const t0 = Date.now();
  let tick = 0;
  while (Date.now() - t0 < SEC * 1000) {
    const msLeft = SEC * 1000 - (Date.now() - t0);
    if (msLeft < 15000) break;
    const x = Math.random() < 0.5 ? 100 : 560;   // 固定远端：避免与猫贴身触发「跳过走动」
    try {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 300, button: 'none' });
      await evalJS(`window.pet.doAction('call')`);
    } catch (_) { /* 忽略：不影响采样 */ }
    tick++;
    await sleep(15000);   // 间隔要够长：太密会把自主的 run 反复打断
  }
  console.log(`[info] 期间逗弄 ${tick} 次`);

  const log = await evalJS('window.__poseLog.length');
  const data = await evalJS('JSON.stringify(window.__poseLog)').then(JSON.parse);
  console.log(`[ok] 记录 ${log} 次绘制`);

  const counts = {};
  data.forEach(([n]) => { counts[n] = (counts[n] || 0) + 1; });
  console.log('[info] 姿态分布:', Object.entries(counts).map(([k, v]) => `${k}:${v}`).join('  '));

  let fail = 0;
  const ok = (c, m) => { console.log(`[${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fail++; };

  for (const pose of ['walk', 'run']) {
    const eps = [];
    let cur = null;
    for (const [n, idx, laps] of data) {
      if (n === pose) { if (!cur) { cur = []; eps.push(cur); } cur.push([idx, laps]); }
      else cur = null;
    }
    if (!eps.length) { console.log(`[info] ${pose}: 采样窗口内未触发`); continue; }

    let full = 0;      // 走满 ≥2 轮的段
    let skipped = 0;   // 起步就被跳过（贴脸目标）或首帧即被交互打断
    let cut = 0;       // 中途被交互打断（用户点/喊/拖）
    const stuck = [];
    const badSeq = [];
    for (const e of eps) {
      const [lastIdx, lastLaps] = e[e.length - 1];
      if (lastLaps >= 2) {
        full++;
        if (lastIdx !== 0) cut++;          // 满 2 轮后又在半截被切
      } else if (e.length <= 2 && lastLaps === 0) skipped++;
      else cut++;
      if (lastLaps > 12) stuck.push(`${lastLaps}轮`);
      for (let k = 1; k < e.length; k++) {
        const a = e[k - 1][0]; const b = e[k][0];
        if (b !== a && b !== (a + 1) % 4) { badSeq.push(`${a + 1}→${b + 1}`); break; }
      }
    }
    console.log(`[info] ${pose}: ${eps.length} 段 = 满 2 轮 ${full} / 贴脸跳过 ${skipped} / 交互打断 ${cut}`);
    ok(full > 0, `${pose}: 至少有一段完整播满 ≥2 轮（真机确认）`);
    ok(badSeq.length === 0, `${pose}: 帧序无跳变${badSeq.length ? '，异常 ' + badSeq.slice(0, 3).join('/') : ''}`);
    ok(stuck.length === 0, `${pose}: 无卡死段（>12 轮）${stuck.length ? '，异常 ' + stuck.join('/') : ''}`);
  }

  ws.close();
  if (fail) { console.error(`[FAIL] ${fail} 项未通过`); process.exit(1); }
  console.log('\n[PASS] 走/跑循环采样通过');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
