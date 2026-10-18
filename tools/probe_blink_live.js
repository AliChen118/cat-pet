/* 实机眨眼观测：CDP 注入 Animator.prototype.update 钩子，统计 idle 帧与眨眼次数 */
const TARGET = 'http://127.0.0.1:9222';
const SECONDS = Number(process.argv[2] || 90);
const fs = require('fs');

async function main() {
  const list = await (await fetch(TARGET + '/json')).json();
  const page = list.filter((t) => t.type === 'page')[0];
  if (!page) { console.log('NO PAGE', JSON.stringify(list.map(x => x.type + ':' + x.url))); return; }
  console.log('target:', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  // 1) 装钩子
  const installed = await evalJs(`(() => {
    if (window.__blinkHooked) return 'already';
    window.__blinkHooked = true;
    window.__blinkLog = [];
    const proto = Animator.prototype;
    const orig = proto.update;
    proto.update = function (dt) {
      orig.call(this, dt);
      try {
        if (this.blinkCfg) {
          window.__blinkLog.push([this.clock, this.frameIndex, this.current, this.blinkCfg.meanGap]);
        }
      } catch (e) {}
    };
    return 'ok';
  })()`);
  console.log('hook:', installed);

  // 2) 等 SECONDS 秒
  await new Promise((r) => setTimeout(r, SECONDS * 1000));

  // 3) 取数据
  const raw = await evalJs(`(() => {
    const log = window.__blinkLog || [];
    let inBlink = false; const at = [];
    const frames = {};
    let idleSamples = 0;
    for (const [clock, fi, cur, gap] of log) {
      if (cur === 'idle') { idleSamples++; frames[fi] = (frames[fi] || 0) + 1; }
      if (cur === 'idle' && fi === 2 && !inBlink) { inBlink = true; at.push(clock); }
      if (fi !== 2) inBlink = false;
    }
    return JSON.stringify({ total: log.length, idleSamples, frames, blinks: at, meanGap: log.length ? log[log.length - 1][3] : null });
  })()`);
  const d = JSON.parse(raw);
  const gaps = d.blinks.slice(1).map((t, i) => +(t - d.blinks[i]).toFixed(2));
  console.log('采样帧数:', d.total, ' idle 帧:', d.idleSamples);
  console.log('idle 帧分布:', JSON.stringify(d.frames), '（0/3=睁眼, 2=闭眼, 1=困倦）');
  console.log('meanGap:', d.meanGap, '秒（8 次/分 → 7.5）');
  console.log('眨眼次数:', d.blinks.length, ' 预期约', (SECONDS / 7.5).toFixed(1));
  console.log('间隔(秒):', gaps.join(', '));
  if (gaps.length) {
    const uniq = new Set(gaps.map((g) => Math.round(g * 10)));
    console.log('间隔极差:', (Math.max(...gaps) - Math.min(...gaps)).toFixed(2), 's  不同值:', uniq.size, '/', gaps.length);
  }
  fs.writeFileSync('E:/AI Work/桌面宠物/_backup/blink_live.json', raw, 'utf8');
  ws.close();
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1); });
