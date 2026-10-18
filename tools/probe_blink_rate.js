/* 实机验证「眨眼频率」端到端实时生效：
 * window.pet.saveConfig({behavior:{blinkRate:N}}) → 主进程落盘 → config-changed 广播
 * → renderer.applyConfig → animator.blinkCfg.meanGap。用 update 钩子读回 meanGap。 */
const TARGET = 'http://127.0.0.1:9222';

async function main() {
  const list = await (await fetch(TARGET + '/json')).json();
  const page = list.filter((t) => t.type === 'page')[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await ev(`(() => {
    if (window.__gapHooked) return;
    window.__gapHooked = true;
    window.__gap = null;
    const orig = Animator.prototype.update;
    Animator.prototype.update = function (dt) {
      orig.call(this, dt);
      if (this.blinkCfg) window.__gap = this.blinkCfg.meanGap;
    };
  })()`);

  const readGap = async () => Number(await ev('window.__gap'));
  const setRate = (n) => ev(`window.pet.saveConfig({ behavior: { blinkRate: ${n} } }).then(r => !!(r && r.config))`);

  console.log('初始 meanGap =', await readGap(), '（默认 8 次/分 → 7.5）');
  let bad = 0;
  for (const n of [30, 2, 0, 8]) {
    const saved = await setRate(n);
    await new Promise((r) => setTimeout(r, 800));
    const g = await readGap();
    const want = n > 0 ? 60 / n : 0;
    const pass = Math.abs(g - want) < 1e-6;
    if (!pass) bad++;
    console.log(`设为 ${n} 次/分 → meanGap ${g}（期望 ${want}）保存回执=${saved} ${pass ? 'OK' : 'MISMATCH'}`);
  }
  // 落盘核对
  const cfg = await ev(`window.pet.getConfig().then(c => JSON.stringify({ rate: c.behavior.blinkRate }))`);
  console.log('主进程配置回读:', cfg);
  console.log(bad === 0 ? '结论: 实时生效链路 OK（4/4）' : `结论: ${bad} 项不一致`);
  ws.close();
}
main().catch((e) => { console.log('ERR', e.message); process.exit(1); });
