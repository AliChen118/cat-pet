/**
 * status-panel.js — 状态面板渲染逻辑（独立置顶小窗）
 * 数据来源：主进程经 stats-changed 推送（宠物渲染进程节流上报）；
 * 配置（名字 / 语言 / 主题 / 生日 / 年龄精度）经 config-changed 广播同步。
 */
'use strict';

(() => {
  const api = window.pet || null;
  const I18N = window.I18N || null;
  const $ = (id) => document.getElementById(id);

  const STAT_KEYS = ['happiness', 'hunger', 'energy', 'cleanliness', 'affinity'];
  /** 档位徽章的显示顺序与图标（与面板属性行一致） */
  const TIER_KEYS = [
    ['happiness', '😊'], ['hunger', '🍚'], ['energy', '⚡'], ['cleanliness', '🫧'],
  ];
  let config = null;

  function lang() { return config && config.appear ? config.appear.language : 'zh-CN'; }
  function t(key, params) { return I18N ? I18N.t(lang(), key, params) : key; }

  /** 从「YYYY-MM-DD」出生日期与显示精度计算年龄文本 */
  function ageText() {
    const b = config && config.pet && config.pet.birthday;
    if (!b) return t('panel.ageUnset');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
    if (!m) return t('panel.ageUnset');
    const birth = new Date(+m[1], +m[2] - 1, +m[3]);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (birth.getTime() === today.getTime()) return t('panel.ageNewborn');

    // 周岁：先按年推进，再补剩余月/天
    let years = today.getFullYear() - birth.getFullYear();
    let anchor = new Date(birth.getFullYear() + years, birth.getMonth(), birth.getDate());
    if (anchor > today) { years--; anchor = new Date(birth.getFullYear() + years, birth.getMonth(), birth.getDate()); }
    // 剩余天数（按真实日历，跨月精确）
    const days = Math.floor((today - anchor) / 86400000);
    // 剩余月数：从锚点逐月推进
    let months = 0;
    let probe = new Date(anchor);
    while (true) {
      const nxt = new Date(probe.getFullYear(), probe.getMonth() + 1, probe.getDate());
      if (nxt > today) break;
      probe = nxt;
      months++;
    }

    const prec = config.appear && config.appear.agePrecision ? config.appear.agePrecision : 'day';
    if (prec === 'month') {
      const totalMonths = years * 12 + months;
      if (totalMonths < 1) return t('panel.ageUnderMonth');
      const y = Math.floor(totalMonths / 12);
      const mo = totalMonths % 12;
      return y > 0
        ? t('panel.ageMonthY', { y, m: mo })
        : t('panel.ageMonthM', { m: mo });
    }
    // 精确到天
    if (years > 0) return t('panel.ageDayY', { y: years, d: days });
    if (days >= 1) return t('panel.ageDayD', { d: days });
    return t('panel.ageNewborn');
  }

  /** 名字 / 语言 / 主题等静态部分 */
  function applyStatic() {
    if (!config) return;
    $('p-name').textContent = config.pet.petName || '—';
    $('p-age').textContent = ageText();
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    let th = config.appear.theme;
    if (th === 'auto') {
      th = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.body.classList.toggle('dark', th === 'dark');
  }

  /**
   * 档位徽章：只渲染非「正常」档的属性，全正常时整行隐藏。
   * 文案与档位判定均由渲染进程侧的 needs-profile 决定，这里只负责呈现。
   */
  function renderTags(tiers) {
    const el = $('p-tags');
    if (!el) return;
    const parts = [];
    TIER_KEYS.forEach(([k, ico]) => {
      const tier = tiers && tiers[k];
      if (!tier || tier === 'normal') return;
      parts.push(`<span class="tag t-${tier}">${ico} ${t('panel.tier.' + k + '.' + tier)}</span>`);
    });
    el.innerHTML = parts.join('');
  }

  /** 数值条与台词 */
  function render(state) {
    const s = (state && state.stats) || {};
    STAT_KEYS.forEach((k) => {
      const v = Math.round(s[k] || 0);
      const fill = $('f-' + k);
      if (fill) fill.style.width = Math.min(100, Math.max(0, v)) + '%';
      const val = $('v-' + k);
      if (val) val.textContent = String(v);
    });
    renderTags(state && state.tiers);
    $('p-speech').textContent = (state && state.bubble) || '';
    // 年龄随日期变化（跨天场景），随每次数据推送顺带刷新
    if (config) $('p-age').textContent = ageText();
  }

  if (api) {
    api.getConfig().then((c) => { config = c; applyStatic(); }).catch(() => {});
    if (api.onConfigChanged) {
      api.onConfigChanged((p) => {
        if (p && p.config) { config = p.config; applyStatic(); }
      });
    }
    if (api.onStats) api.onStats(render);
    document.querySelector('.acts').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn && api.doAction) api.doAction(btn.dataset.act);
    });
  }
})();
