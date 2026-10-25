/* 打包版真机冒烟：连 CDP 读 canvas 尺寸 / 不透明像素 / lick 帧解码 / console 异常。
 * 用法：node tools/probe_packaged.js [port] [version]
 * 前提：目标实例已带 --remote-debugging-port 启动。
 */
const PORT = process.argv[2] || '9250';
const EXPECT_VER = process.argv[3] || '';

const getJSON = (p) => fetch(`http://127.0.0.1:${PORT}${p}`).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 等 CDP 就绪（最多 30 s）
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try { targets = await getJSON('/json/list'); if (targets && targets.length) break; } catch { /* retry */ }
    await sleep(500);
  }
  if (!targets || !targets.length) { console.error('[FAIL] CDP 无 target，应用可能未起来'); process.exit(1); }
  // 应用会开多个页面（宠物主窗 + 状态面板），必须挑带 canvas 的那个
  const pages = targets.filter((t) => t.type === 'page');
  const page = pages.find((t) => /index\.html/i.test(t.url))
    || pages.find((t) => !/status-panel|devtools/i.test(t.url))
    || pages[0];
  console.log(`[ok] CDP target: ${page.title || '(无标题)'}  ${page.url}`);
  console.log(`[info] 可用页面 ${pages.length} 个: ${pages.map((p) => p.url.split('/').pop()).join(', ')}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  const logs = [];

  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description
        || m.params.exceptionDetails?.text || 'unknown');
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      logs.push(`[${m.params.type}] ${txt}`);
    }
  };

  await send('Runtime.enable', {});
  await send('Page.enable', {});
  await sleep(2500);   // 让动画跑一会儿

  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  let fail = 0;
  const ok = (c, m) => { console.log(`[${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fail++; };

  const info = await evalJS(`(() => {
    const c = document.querySelector('canvas');
    if (!c) return { err: 'no canvas' };
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let op = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) op++;
    return { w: c.width, h: c.height, opaque: op, dpr: window.devicePixelRatio };
  })()`);

  ok(!info.err, `canvas 存在${info.err ? '（' + info.err + '）' : ''}`);
  ok(info.w === 640 && info.h === 640, `canvas 尺寸 ${info.w}×${info.h}（应 640×640）`);
  ok(info.opaque > 20000, `不透明像素 ${info.opaque}（> 20000 说明猫已绘制）`);

  // lick 帧能否解码（打包后路径大小写 / 缺失最容易在这里炸）
  const dec = await evalJS(`(async () => {
    const out = [];
    for (let i = 1; i <= 4; i++) {
      const im = new Image();
      im.src = 'assets/sprites/frames/lick_' + i + '.png';
      out.push(await new Promise((res) => {
        im.onload = () => res(im.naturalWidth + 'x' + im.naturalHeight);
        im.onerror = () => res('ERR');
      }));
    }
    return out;
  })()`);
  ok(dec.every((s) => s === '512x512'), `lick_1..4 解码: ${dec.join(', ')}`);

  // 说明：renderer.js 的帧表/常量都在模块作用域内（未挂到 window），运行期读不到，
  // 因此节奏常量由 tools/verify_asar.js 在包内容层面断言；这里只验运行期可见事实。
  const rt = await evalJS(`(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return {
      cssW: Math.round(r.width),
      cssH: Math.round(r.height),
      visible: document.visibilityState,
      imgs: performance.getEntriesByType('resource').filter(e => /lick_/.test(e.name)).length,
    };
  })()`);
  ok(rt.cssW > 0 && rt.cssH > 0, `窗口可见尺寸 ${rt.cssW}×${rt.cssH}`);
  ok(rt.visible === 'visible', `页面可见性 ${rt.visible}`);

  if (EXPECT_VER) console.log(`[info] 版本 ${EXPECT_VER}（常量由 verify_asar 断言，运行期不可读）`);

  ok(errors.length === 0, `console 无未捕获异常${errors.length ? ': ' + errors.join(' | ') : ''}`);
  const bad = logs.filter((l) => /error|Error|failed/i.test(l));
  ok(bad.length === 0, `console 无 error 级日志${bad.length ? ': ' + bad.slice(0, 3).join(' | ') : ''}`);

  console.log('');
  ws.close();
  if (fail) { console.error(`[FAIL] ${fail} 项未通过`); process.exit(1); }
  console.log('[PASS] 打包版冒烟通过');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
