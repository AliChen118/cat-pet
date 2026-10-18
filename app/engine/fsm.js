/**
 * fsm.js — 极简有限状态机
 * 每个状态提供 enter / update / exit 回调；update 返回下一个状态名即触发切换。
 */
'use strict';

class StateMachine {
  /**
   * @param {Object} states { name: { enter?(ctx), update?(ctx, dt) -> string|void, exit?(ctx) } }
   * @param {string} initial 初始状态名
   */
  constructor(states, initial) {
    this.states = states;
    this.current = initial;
    this.elapsed = 0;
    if (states[initial] && states[initial].enter) states[initial].enter(this.ctx || {});
  }

  setContext(ctx) {
    this.ctx = ctx;
    return this;
  }

  get name() {
    return this.current;
  }

  get time() {
    return this.elapsed;
  }

  /** 强制切换（可跨状态打断） */
  transition(next) {
    if (!this.states[next] || next === this.current) return;
    const prev = this.states[this.current];
    if (prev && prev.exit) prev.exit(this.ctx);
    this.current = next;
    this.elapsed = 0;
    const cur = this.states[next];
    if (cur && cur.enter) cur.enter(this.ctx);
  }

  update(dt) {
    const st = this.states[this.current];
    this.elapsed += dt;
    if (st && st.update) {
      const next = st.update(this.ctx, dt);
      if (next && this.states[next]) this.transition(next);
    }
  }
}
