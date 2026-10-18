/**
 * settings.js — 设置窗口逻辑
 *
 * 表单完全由 ConfigSchema.GROUPS 驱动（分组 / 控件类型 / 范围 / 默认值 / 生效徽标），
 * 界面不硬编码任何设置项。文案来自 config-schema（条目标签）与 i18n（chrome）。
 *
 * 保存策略（显式应用模型）：
 *   - 编辑期间只更新工作副本并标脏，不写盘（语言/主题在页面内即时预览）；
 *   - 「应用」：收集全部脏值一次性落盘并生效，绿色「✓ 已应用」瞬态 + toast + 宠物气泡；
 *   - 「取消」：有改动先确认 → 回滚快照（清挂起定时器）→ 蓝色「✓ 已取消」瞬态后关窗；
 *     无改动时点「取消」＝直接关闭页面；
 *   - 特例：dataDir 在「浏览…」选定后立即写盘（migrateData 读主进程真源，需先落盘）；
 *   - 待重启项（sec === 'restart'）被改动时，底栏出现「迁移并重启」入口。
 */
'use strict';

(() => {
  const S = window.ConfigSchema;
  const api = window.pet || null;

  const $nav = document.getElementById('nav');
  const $pane = document.getElementById('pane');
  const $msgL = document.getElementById('msgL');
  const $msgWarn = document.getElementById('msgWarn');
  const $btnReset = document.getElementById('btnReset');
  const $btnCancel = document.getElementById('btnCancel');
  const $btnApply = document.getElementById('btnApply');
  const $overlay = document.getElementById('overlay');
  const $toast = document.getElementById('toast');

  const GROUP_OF = {};
  S.GROUPS.forEach((g) => g.items.forEach((it) => { GROUP_OF[it.k] = g.id; }));

  // 界面语言固定中文（设置页不提供语言切换项）
  const lang = 'zh-CN';
  let cur = 'pet';
  let meta = { dataDir: '', notificationsSupported: true, version: '' };
  let saved = null;   // 快照（与主进程一致的分组配置）
  let vals = null;    // 工作副本
  let flashTimer = null;
  const dirtyTimers = {};

  /* ---------------- 基础工具 ---------------- */

  function T(key, params) { return window.I18N.t(lang, 'settings.' + key, params); }
  function tr(key, params) { return window.I18N.t(lang, key, params); }
  function label(it) { return lang === 'zh-CN' ? it.zh : it.en; }
  function hint(it) { return lang === 'zh-CN' ? it.hzh : it.hen; }
  function note(it) { return lang === 'zh-CN' ? it.nzh : it.nen; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function subst(s) {
    return String(s)
      .replace(/\{name\}/g, vals.pet.petName)
      .replace(/\{owner\}/g, vals.pet.ownerName || tr('tray.pet'));
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function fmtVal(it, v) {
    if (it.fmt === 'ms') return (Number(v) / 1000).toFixed(1) + (lang === 'zh-CN' ? ' 秒' : ' s');
    if (it.fmt === 'sec') return v + (lang === 'zh-CN' ? ' 秒' : ' s');
    if (it.fmt === 'min') return v + (lang === 'zh-CN' ? ' 分钟' : ' min');
    if (it.fmt === 'secLong') {
      const m = Math.floor(Number(v) / 60), s = Number(v) % 60;
      return lang === 'zh-CN' ? (m ? `${m} 分 ${s} 秒` : `${s} 秒`) : (m ? `${m} min ${s} s` : `${s} s`);
    }
    if (it.fmt === 'pctRef') return Math.round((v / (it.ref || 1)) * 100) + '%';
    if (it.fmt === 'pct') return Math.round(v * (it.max <= 1 ? 100 : 1)) + '%';
    if (it.fmt === 'times') return lang === 'zh-CN' ? `${v} 次/分` : `${v}/min`;
    return String(v);
  }

  function isDisabled(it) {
    if (it.ro) return true;
    if (it.blockedBy && vals[GROUP_OF[it.blockedBy]][it.blockedBy]) return true;
    if (it.requires) {
      const rv = vals[GROUP_OF[it.requires]][it.requires];
      if (!rv) return true;
      // requiresIn：引用项必须取到指定值之一才启用（如 speechRate 仅 tts 生效）
      if (it.requiresIn && it.requiresIn.indexOf(rv) < 0) return true;
    }
    if (it.k === 'notifications' && meta && meta.notificationsSupported === false) return true;
    return false;
  }

  /* ---------------- 渲染 ---------------- */

  function badgeHtml(it) {
    if (!it.sec) return '';
    const cls = it.sec === 'restart' ? 'restart' : 'login';
    const txt = it.sec === 'restart' ? T('badgeRestart') : T('badgeLogin');
    return ' <span class="badge ' + cls + '">' + esc(txt) + '</span>';
  }

  function ctlHtml(it) {
    const dis = isDisabled(it) ? ' disabled' : '';
    const v = vals[GROUP_OF[it.k]][it.k];

    if (it.t === 'text') {
      const w = Math.max(110, Math.min(220, it.max * 17));
      return `<div class="ctl">
        <input type="text" data-k="${it.k}" value="${esc(v)}" style="width:${w}px"${dis} />
        <div class="err" data-for="${it.k}" hidden></div>
        ${it.hzh ? `<div class="hint">${esc(subst(hint(it)))}</div>` : ''}
      </div>`;
    }

    if (it.t === 'password') {
      // 密钥不回显：value 恒为空，placeholder 显示掩码提示；留空＝不修改
      const ph = meta && meta.aiKeyMask ? meta.aiKeyMask
        : (meta && meta.aiLocal
          ? (lang === 'zh-CN' ? '本地服务，可留空' : 'Local service, may be blank')
          : (lang === 'zh-CN' ? '未设置（留空不修改）' : 'Not set (leave blank to keep)'));
      return `<div class="ctl"><div class="inline">
        <input type="password" data-k="${it.k}" value="" placeholder="${esc(ph)}"
               autocomplete="off" spellcheck="false" style="width:200px"${dis} />
        <button class="btn" data-act="ai-clear-key"${dis}>${esc(lang === 'zh-CN' ? '清除' : 'Clear')}</button></div>
        ${it.hzh ? `<div class="hint">${esc(subst(hint(it)))}</div>` : ''}
      </div>`;
    }

    if (it.t === 'action') {
      return `<div class="ctl"><div class="inline">
        <button class="btn" data-act="${it.act}" data-k="${it.k}"${dis}>${esc(label(it))}</button>
        <span class="actres" data-res="${it.k}"></span></div>
        ${it.hzh ? `<div class="hint">${esc(subst(hint(it)))}</div>` : ''}
      </div>`;
    }

    if (it.t === 'switch') {
      return `<div class="ctl"><label class="inline">
        <input type="checkbox" data-k="${it.k}"${v ? ' checked' : ''}${dis} />
        <span class="note">${esc(subst(note(it)))}</span></label>
        ${it.hzh ? `<div class="hint">${esc(subst(hint(it)))}</div>` : ''}
      </div>`;
    }

    if (it.t === 'range') {
      // 步长/上下限一律取自 schema（体型为 0.176–0.88，step 0.044 = 5%），
      // 与渲染进程的滚轮步长保持同一网格，避免回写时数值跳变
      const step = it.step;
      const min = it.min;
      return `<div class="ctl"><div class="inline">
        <input type="range" data-k="${it.k}" min="${min}" max="${it.max}" step="${step}" value="${v}"${dis} />
        <span class="val" data-val="${it.k}">${esc(fmtVal(it, v))}</span></div>
        ${it.hzh ? `<div class="hint">${esc(subst(hint(it)))}</div>` : ''}
      </div>`;
    }

    if (it.t === 'select') {
      const optNames = { none: '无（关闭）' };
      // 枚举值的中文名（按设置项区分：同值在不同项里含义不同）
      const OPT_ZH = {
        needSensitivity: { relaxed: '宽松', standard: '标准', strict: '严格' },
        agePrecision: { day: '按天', month: '按月' },
        autoTalk: { off: '关闭', often: '经常（1–2 分钟）', normal: '平常（2–5 分钟）', rare: '偶尔（5–10 分钟）' },
        bubblePace: { fast: '轻快', normal: '标准', slow: '舒缓' },
        speech: { off: '静音', purr: '喵语节奏', tts: '朗读' },
        preset: { zhipu: '智谱 GLM-4-Flash', siliconflow: '硅基流动', modelscope: '魔搭 ModelScope',
          dashscope: '阿里云百炼', ark: '火山方舟', deepseek: 'DeepSeek',
          moonshot: 'Kimi（月之暗面）', ollama: 'Ollama（本地）', custom: '自定义' },
      };
      const zhMap = OPT_ZH[it.k];
      const opts = it.opts.map((o) => {
        const txt = optNames[o] != null ? optNames[o]
          : (zhMap && zhMap[o] != null ? zhMap[o]
            : (it.k === 'theme' ? themeName(o) : (it.k === 'activityLevel' ? actName(o) : String(o))));
        return `<option value="${esc(o)}"${String(o) === String(v) ? ' selected' : ''}>${esc(txt)}</option>`;
      }).join('');
      return `<div class="ctl"><select data-k="${it.k}" style="max-width:210px"${dis}>${opts}</select>
        ${it.hzh ? `<div class="hint">${esc(subst(hint(it)))}</div>` : ''}
      </div>`;
    }

    if (it.t === 'path') {
      return `<div class="ctl"><div class="inline">
        <input type="text" data-k="${it.k}" value="${esc(v || meta.dataDir)}" readonly style="flex:1;font-size:12px;min-width:200px" />
        <button class="btn" data-act="browse">${esc(T('browse'))}</button>
        <button class="btn" data-act="open">${esc(T('openFolder'))}</button></div>
        ${it.hzh ? `<div class="hint">${esc(subst(hint(it)))}</div>` : ''}
      </div>`;
    }

    if (it.t === 'date') {
      return `<div class="ctl"><div class="inline">
        <input type="date" data-k="${it.k}" value="${esc(v || '')}" min="1900-01-01" style="font-size:12px"${dis} />
        <button class="btn" data-act="clearDate" data-k="${it.k}"${v ? '' : ' disabled'}>${esc(lang === 'zh-CN' ? '清空' : 'Clear')}</button></div>
        ${it.hzh ? `<div class="hint">${esc(subst(hint(it)))}</div>` : ''}
      </div>`;
    }

    return '';
  }

  function themeName(v) {
    const map = { light: ['浅色', 'Light'], dark: ['深色', 'Dark'], auto: ['跟随系统', 'Follow system'] };
    return map[v] ? (lang === 'zh-CN' ? map[v][0] : map[v][1]) : v;
  }
  function actName(v) {
    const map = { low: ['安静', 'Quiet'], normal: ['标准', 'Normal'], high: ['活泼', 'Lively'] };
    return map[v] ? (lang === 'zh-CN' ? map[v][0] : map[v][1]) : v;
  }

  function dataExtrasHtml() {
    return `
      <div class="divider"></div>
      <p class="subhead">${esc(lang === 'zh-CN' ? '配置文件的导入与迁移' : 'Import and migration')}</p>
      <div class="ctl" style="gap:8px"><div class="inline">
        <button class="btn" data-act="export">${esc(T('exportCfg'))}</button>
        <button class="btn" data-act="import">${esc(T('importCfg'))}</button>
        <button class="btn" data-act="migrate" id="btnMigrate">${esc(T('migrate'))}</button>
      </div>
      <div class="hint">${esc(lang === 'zh-CN'
        ? '「导入配置…」会先校验格式，确认后才应用；「迁移并重启」仅在数据位置被改动后可用。'
        : 'Import validates the file before applying. Migrate is enabled only after the data folder changes.')}</div></div>`;
  }

  function renderNav() {
    const aboutLbl = lang === 'zh-CN' ? '关于' : 'About';
    $nav.innerHTML = S.GROUPS.map((g) =>
      `<button data-g="${g.id}"${g.id === cur ? ' class="on"' : ''}>${esc(label(g))}</button>`
    ).join('') + `<button data-g="about"${cur === 'about' ? ' class="on"' : ''}>${esc(aboutLbl)}</button>`;
  }

  function renderAboutPane() {
    const ver = (meta && meta.version) ? String(meta.version) : '';
    const rows = [];
    rows.push(`<div class="row"><div class="lbl">${lang === 'zh-CN' ? '版本号' : 'Version'}</div>` +
      `<div>${esc(ver || (lang === 'zh-CN' ? '未知' : 'Unknown'))}</div></div>`);
    const desc = lang === 'zh-CN'
      ? '一只常驻桌面的 Q 版小猫：会自己散步、打盹、撒娇，也可以喂食、抚摸、逗玩和洗澡，陪伴你的日常工作。'
      : 'A chibi desktop cat that wanders, naps and acts cute on its own — feed, pet, play with it or give it a bath while you work.';
    $pane.innerHTML = `<div class="ghead"><h3>${lang === 'zh-CN' ? '关于' : 'About'}</h3>` +
      `<p>${lang === 'zh-CN' ? '应用信息与版本。' : 'App info and version.'}</p></div>` +
      `<div class="row"><div class="lbl">${lang === 'zh-CN' ? '应用简介' : 'About this app'}</div>` +
      `<div>${esc(desc)}</div></div>` + rows.join('');
  }

  function renderPane() {
    if (cur === 'about') { renderAboutPane(); return; }
    const g = S.GROUPS.filter((x) => x.id === cur)[0];
    let html = `<div class="ghead"><h3>${esc(label(g))}</h3><p>${esc(tr('settings.groupIntro.' + g.id))}</p></div>`;

    g.items.forEach((it) => {
      html += `<div class="row">
        <div class="lbl">${esc(label(it))}${badgeHtml(it)}</div>
        ${ctlHtml(it)}</div>`;
    });

    if (g.id === 'data') html += dataExtrasHtml();

    $pane.innerHTML = html;
    updateEnabled();
  }

  function renderFooter() {
    const n = dirtyKeys().length;
    $btnApply.disabled = n === 0;
    $btnCancel.disabled = false;   // 「取消」始终可点：有改动=确认后回滚关窗；无改动=直接关窗

    // 未保存改动数 + 需重启警告，并列显示在右下角
    const bits = [];
    if (n > 0) bits.push(`<span class="msg dirty">● ${esc(T('dirty', { n }))}</span>`);
    const restart = dirtyKeys().filter((k) => S.ITEMS[k].sec === 'restart');
    if (restart.length) bits.push(`<span class="msg warn">${esc(T('needRestart', { n: restart.length }))}</span>`);
    $msgWarn.innerHTML = bits.join('');

    const m = document.getElementById('btnMigrate');
    if (m) m.disabled = restart.indexOf('dataDir') < 0;
  }

  function renderChrome() {
    $btnReset.textContent = T('reset');
    $btnCancel.textContent = T('cancel');
    $btnApply.textContent = T('apply');
    document.title = T('title', { name: vals.pet.petName });
  }

  function applyThemePreview() {
    let th = vals.appear.theme;
    if (th === 'auto') {
      th = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.body.setAttribute('data-theme', th);
  }

  function render() { renderNav(); renderPane(); renderFooter(); renderChrome(); applyThemePreview(); }

  /* ---------------- 脏值与写盘 ---------------- */

  function dirtyKeys() {
    const out = [];
    S.GROUPS.forEach((g) => {
      g.items.forEach((it) => {
        if (JSON.stringify(vals[g.id][it.k]) !== JSON.stringify(saved[g.id][it.k])) out.push(it.k);
      });
    });
    return out;
  }

  /** 即时写单项目前仅用于 dataDir（迁移流程读主进程真源，必须先落盘） */
  function writeItem(k, immediate) {
    const g = GROUP_OF[k];
    const patch = { [g]: { [k]: vals[g][k] } };
    const send = () => {
      if (!api) return;
      api.saveConfig(patch).then((cfg) => {
        if (cfg && cfg.config) saved = clone(cfg.config);   // save-config 返回 {config, changed}
        renderFooter();
      }).catch((e) => console.error('[settings] 保存失败:', e));
    };
    clearTimeout(dirtyTimers[k]);
    if (immediate) send();
    else dirtyTimers[k] = setTimeout(send, 300);
    renderFooter();
  }

  function updateValLabel(it, v) {
    const el = $pane.querySelector(`[data-val="${it.k}"]`);
    if (el) el.textContent = fmtVal(it, v);
  }

  function updateEnabled() {
    S.GROUPS.forEach((g) => g.items.forEach((it) => {
      if (!it.blockedBy && !it.requires && it.k !== 'notifications') return;
      const el = $pane.querySelector(`[data-k="${it.k}"]`);
      if (el) el.disabled = isDisabled(it);
    }));
  }

  /* ---------------- 校验 ---------------- */

  function validateText(it, el) {
    const errEl = $pane.querySelector(`.err[data-for="${it.k}"]`);
    const raw = el.value;
    let clean = raw.replace(/[\u0000-\u001F\u007F]/g, '');
    if (clean.length > it.max) clean = clean.slice(0, it.max);
    if (clean !== raw) el.value = clean;

    let msg = '';
    if (it.k === 'petName' && !clean.trim()) {
      msg = T('nameEmpty', { d: it.d });
    }
    el.classList.toggle('bad', !!msg);
    if (errEl) { errEl.hidden = !msg; errEl.textContent = msg; }
    return { value: clean, ok: !msg };
  }

  /* ---------------- 事件 ---------------- */

  function onInput(e) {
    const el = e.target;
    const k = el.getAttribute('data-k');
    if (!k) return;
    const it = S.ITEMS[k];
    if (!it) return;
    const g = GROUP_OF[k];

    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'range') v = Number(el.value);
    else v = el.value;

    if (it.t === 'text') {
      const r = validateText(it, el);
      if (!r.ok) return;      // 非法值不写入
      v = r.value;
    }

    // 显式应用模型：编辑只改工作副本，落盘交给「应用」按钮
    vals[g][k] = v;

    if (it.t === 'range') updateValLabel(it, v);
    // 选预设服务商时自动填接口地址与模型名（custom 保留用户手填值）
    if (k === 'preset' && window.AiTalk) {
      const p = window.AiTalk.PRESETS[v];
      if (p) {
        vals.ai.baseUrl = p.baseUrl;
        vals.ai.model = p.model;
        const bu = $pane.querySelector('[data-k="baseUrl"]');
        const md = $pane.querySelector('[data-k="model"]');
        if (bu) bu.value = p.baseUrl;
        if (md) md.value = p.model;
      }
    }
    if (it.t === 'date') {
      const clr = $pane.querySelector(`button[data-act="clearDate"][data-k="${k}"]`);
      if (clr) clr.disabled = !v;
    }
    if (k === 'petName' || k === 'ownerName') refreshNameDeps();
    if (k === 'theme') applyThemePreview();      // 页面内即时预览，落盘仍待「应用」

    updateEnabled();
    renderFooter();
  }

  function refreshNameDeps() {
    document.title = T('title', { name: vals.pet.petName });
  }

  $nav.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-g]');
    if (!b) return;
    cur = b.getAttribute('data-g');
    renderNav();
    renderPane();
    $pane.scrollTop = 0;
  });

  $pane.addEventListener('input', onInput);
  $pane.addEventListener('change', onInput);

  /** AI 动作结果的人话转换 */
  function aiReason(r) {
    const code = (r && (r.reason || r.code)) || 'error';
    const zh = {
      disabled: 'AI 自言自语未启用',
      limit: '已达今日上限',
      busy: '正在说，稍等',
      'no-key': '未填写 API Key',
      'no-model': '未填写模型名称',
      'bad-url': '接口地址为空',
      'bad-response': '模型返回了看不懂的内容',
      empty: '没有可用的内容',
      aborted: '已打断',
      unauthorized: 'Key 无效或已过期',
      quota: '账户余额不足',
      'rate-limit': '请求太频繁，稍后再试',
      'not-found': '地址或模型名不存在',
      'bad-request': '请求参数不被接受（检查模型名）',
      server: '模型服务出错了',
      network: '连不上服务（检查网络或地址）',
      timeout: '请求超时',
      http: '服务返回错误',
    }[code];
    const en = {
      disabled: 'AI musings are off',
      limit: 'Daily limit reached',
      busy: 'Still speaking',
      'no-key': 'No API key',
      'no-model': 'Model name is empty',
      'bad-url': 'API base URL is empty',
      'bad-response': 'Unrecognised response from the model',
      empty: 'Nothing to say',
      aborted: 'Interrupted',
      unauthorized: 'Key rejected',
      quota: 'Out of credit',
      'rate-limit': 'Too many requests',
      'not-found': 'Endpoint or model not found',
      'bad-request': 'Request rejected (check the model name)',
      server: 'Model service error',
      network: 'Cannot reach the service',
      timeout: 'Timed out',
      http: 'Service error',
    }[code];
    return (lang === 'zh-CN' ? zh : en) || code;
  }

  $pane.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const a = b.getAttribute('data-act');

    if (a === 'ai-test' || a === 'ai-say') {
      const k = b.getAttribute('data-k');
      const res = $pane.querySelector(`[data-res="${k}"]`);
      const setRes = (txt, bad) => {
        if (!res) return;
        res.textContent = txt;
        res.className = 'actres' + (bad ? ' bad' : (txt ? ' ok' : ''));
      };
      if (!api || !api.aiTell) { setRes('—', true); return; }
      b.disabled = true;
      setRes(lang === 'zh-CN' ? '进行中…' : 'Working…');
      try {
        const r = a === 'ai-test' ? await api.aiTest() : await api.aiTell('', { manual: true });
        if (r && r.ok) {
          if (a === 'ai-test') {
            setRes(lang === 'zh-CN'
              ? `✓ 可用（${r.ms || 0}ms · ${r.model || 'ok'}）`
              : `✓ OK (${r.ms || 0}ms · ${r.model || 'ok'})`);
          } else if (r.source === 'offline') {
            setRes(lang === 'zh-CN'
              ? `✓ 讲了（内置内容${r.fallback ? '：' + aiReason({ reason: r.fallback }) : ''}）`
              : `✓ Spoke (offline${r.fallback ? ': ' + aiReason({ reason: r.fallback }) : ''})`);
          } else {
            setRes(lang === 'zh-CN' ? '✓ 讲了（模型生成）' : '✓ Spoke (model)');
          }
        } else {
          setRes('✕ ' + aiReason(r), true);
          if (res && r && r.reason && r.reason !== 'empty') res.title = String((r && (r.detail || r.diagnostic)) || '');
        }
      } catch (err) {
        setRes('✕ ' + (err.message || 'error'), true);
      }
      b.disabled = isDisabled(S.ITEMS[k]);
      return;
    }

    if (a === 'ai-clear-key') {
      if (!api || !api.aiClearKey) return;
      const r = await api.aiClearKey();
      meta.aiKeyMask = '';
      const inp = $pane.querySelector('[data-k="apiKey"]');
      if (inp) {
        inp.value = '';
        inp.placeholder = lang === 'zh-CN' ? '未设置（留空不修改）' : 'Not set (leave blank to keep)';
      }
      flash(r && r.ok !== false ? (lang === 'zh-CN' ? 'API Key 已清除' : 'API key cleared') : '');
      return;
    }

    if (a === 'clearDate') {
      const k = b.getAttribute('data-k');
      vals.pet[k] = '';
      const el = $pane.querySelector(`[data-k="${k}"]`);
      if (el) el.value = '';
      b.disabled = true;
      renderFooter();   // 只标脏，落盘待「应用」
      return;
    }

    if (a === 'browse') {
      const r = await api.chooseDataDir();
      if (r && r.ok) {
        vals.data.dataDir = r.dir;
        const el = $pane.querySelector('[data-k="dataDir"]');
        if (el) el.value = r.dir;
        writeItem('dataDir', true);
      } else if (r && r.reason) {
        flash(r.reason, true);
      }
    } else if (a === 'open') {
      api.openDataDir();
    } else if (a === 'export') {
      const r = await api.exportConfig();
      flash(r && r.ok ? T('saved') : (r && r.reason ? T('importBad', { reason: r.reason }) : ''), !!(r && !r.ok));
    } else if (a === 'import') {
      const r = await api.importConfig();
      if (r && r.ok) flash(T('importOk'));
      else if (r && r.reason) flash(T('importBad', { reason: r.reason }), true);
    } else if (a === 'migrate') {
      const r = await api.migrateData();
      if (r && r.ok) flash(T('restartSoon'));
      else if (r && r.reason && r.reason !== 'no-change') flash(T('dirBad', { reason: r.reason }), true);
    }
  });

  let applyFlashTimer = null;
  let cancelFlashTimer = null;

  $btnApply.addEventListener('click', () => {
    if (!api) return;
    const patch = {};
    let newKey = '';
    dirtyKeys().forEach((k) => {
      const it = S.ITEMS[k];
      // action 是按钮不是值；password 走独立加密文件，都不进 config 补丁
      if (it && it.t === 'action') return;
      if (it && it.t === 'password') { newKey = String(vals.ai[k] || '').trim(); return; }
      const g = GROUP_OF[k];
      patch[g] = patch[g] || {};
      patch[g][k] = vals[g][k];
    });

    // 密钥先落盘（失败则整次应用中止，避免"设置存了但 Key 丢了"的错觉）
    const keyStep = newKey ? api.aiSetKey(newKey) : Promise.resolve(null);
    keyStep.then((kr) => {
      if (kr && kr.ok === false) throw new Error(kr.reason || 'key');
      return api.saveConfig(patch);
    }).then((cfg) => {
      if (cfg && cfg.config) saved = clone(cfg.config);   // save-config 返回 {config, changed}
      // 密钥写入成功：清掉工作副本里的明文，并更新掩码提示
      if (newKey) {
        vals.ai.apiKey = '';
        saved.ai.apiKey = '';
        if (window.AiTalk) meta.aiKeyMask = window.AiTalk.maskKey(newKey);
        renderPane();
      }
      renderFooter();
      // 三重反馈：底栏文字 + 顶部 toast + 按钮瞬态（✓ 已应用 / 绿色 1.4s）
      flash(T('saved'));
      toast(T('appliedToast'));
      $btnApply.textContent = T('appliedBtn');
      $btnApply.classList.add('flash-ok');
      clearTimeout(applyFlashTimer);
      applyFlashTimer = setTimeout(() => {
        $btnApply.textContent = T('apply');
        $btnApply.classList.remove('flash-ok');
      }, 1400);
      // 宠物冒气泡反馈（经 pet-action 白名单转发到主窗口）
      if (api.doAction) api.doAction('settingsSaved');
    }).catch((err) => {
      toast(T('applyFailed', { reason: (err && err.message) || 'unknown' }), true);
    });
  });

  $btnCancel.addEventListener('click', () => {
    const n = api ? dirtyKeys().length : 0;
    if (n > 0) {
      // 破坏性操作：先确认再回滚；回滚后展示「✓ 已取消」瞬态，短暂停留再关窗
      askConfirm({
        body: T('discardBody', { n }),
        okLabel: T('discardOk'), cancelLabel: T('discardKeep'),
        onOk: () => discardChanges(() => setTimeout(closeNow, 650)),
      });
    } else {
      closeNow();   // 无改动：取消＝直接退出页面
    }
  });

  /** 回滚到快照并给出反馈；after 为可选的后续动作（如关窗） */
  function discardChanges(after) {
    // 关键：清掉挂起的防抖写穿定时器，否则已放弃的改动（如滑杆值）会在
    // 300ms 后按调度时捕获的旧值写回主进程，污染 saved 快照（取消等于白取消）
    Object.keys(dirtyTimers).forEach((k) => { clearTimeout(dirtyTimers[k]); delete dirtyTimers[k]; });
    const revert = clone(saved);
    api.saveConfig(groupPatchOf(revert)).then((cfg) => {
      if (cfg && cfg.config) saved = clone(cfg.config);   // save-config 返回 {config, changed}
      vals = clone(saved);
      render();
      flash(T('discarded'));
      toast(T('reverted'));
      // 「取消」按钮瞬态：文字变 ✓ 已取消 + 蓝色高亮 1.2s（与「应用」的绿色瞬态对称）
      $btnCancel.textContent = T('cancelledBtn');
      $btnCancel.classList.add('flash-cancel');
      clearTimeout(cancelFlashTimer);
      cancelFlashTimer = setTimeout(() => {
        $btnCancel.textContent = T('cancel');
        $btnCancel.classList.remove('flash-cancel');
      }, 1200);
      if (after) after();
    }).catch(() => { if (after) after(); });
  }

  /** 由工作副本生成全量分组补丁（跳过 runtime 与 dataDir 以外的只读项） */
  function groupPatchOf(src) {
    const patch = {};
    S.GROUPS.forEach((g) => {
      const o = {};
      g.items.forEach((it) => { o[it.k] = src[g.id][it.k]; });
      patch[g.id] = o;
    });
    return patch;
  }

  /* ---------------- 通用确认框（重置 / 放弃更改 / 关窗拦截共用） ---------------- */

  let overlayOnOk = null;
  function askConfirm(opts) {
    const o = opts || {};
    document.getElementById('ovText').textContent = o.body || '';
    const keepRow = document.getElementById('ovKeepRow');
    keepRow.hidden = !o.showKeep;
    if (o.showKeep) document.getElementById('ovKeepLbl').textContent = o.keepLabel || '';
    document.getElementById('ovOk').textContent = o.okLabel || T('apply');
    document.getElementById('ovCancel').textContent = o.cancelLabel || T('cancel');
    overlayOnOk = o.onOk || null;
    $overlay.hidden = false;
  }

  $btnReset.addEventListener('click', () => {
    askConfirm({
      body: T('resetConfirm'),
      showKeep: true, keepLabel: T('keepPetName'),
      onOk: (keep) => {
        if (!api) return;
        api.resetConfig({ keepPetName: keep }).then((cfg) => {
          if (cfg && cfg.config) { saved = clone(cfg.config); vals = clone(cfg.config); }   // 返回 {config, changed}
          render();
          flash(T('resetDone'));
          toast(T('resetDone'));
        });
      },
    });
  });
  document.getElementById('ovCancel').addEventListener('click', () => { $overlay.hidden = true; overlayOnOk = null; });
  document.getElementById('ovOk').addEventListener('click', () => {
    const keep = document.getElementById('ovKeepName').checked;
    $overlay.hidden = true;
    const fn = overlayOnOk;
    overlayOnOk = null;
    // 防御：回调抛错不能阻断后续动作（否则确认后窗口永远关不掉）
    if (fn) { try { fn(keep); } catch (err) { console.error('[settings] 确认回调失败:', err); } }
  });
  $overlay.addEventListener('click', (e) => { if (e.target === $overlay) { $overlay.hidden = true; overlayOnOk = null; } });

  /* ---------------- 关闭拦截：有未保存改动时先确认 ---------------- */

  function requestClose() {
    if (dirtyKeys().length > 0) {
      askConfirm({
        body: T('unsavedClose'),
        okLabel: T('discardOk'), cancelLabel: T('discardKeep'),
        onOk: () => discardChanges(closeNow),
      });
      return;
    }
    closeNow();
  }
  function closeNow() {
    // 关窗前清理：挂起的防抖写盘定时器、确认浮层、底栏/toast/按钮瞬态
    Object.keys(dirtyTimers).forEach((k) => { clearTimeout(dirtyTimers[k]); delete dirtyTimers[k]; });
    $overlay.hidden = true;
    overlayOnOk = null;
    clearTimeout(flashTimer);
    clearTimeout(toastTimer);
    clearTimeout(applyFlashTimer);
    clearTimeout(cancelFlashTimer);
    if (api && api.confirmCloseWindow) api.confirmCloseWindow();
    else window.close();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (!$overlay.hidden) { $overlay.hidden = true; overlayOnOk = null; return; }   // 浮层打开时 Esc 只关浮层
    requestClose();
  });
  if (api && api.onCloseRequest) api.onCloseRequest(requestClose);

  function flash(text, warn) {
    if (!text) { $msgL.textContent = ''; return; }
    $msgL.textContent = text;
    $msgL.className = warn ? 'msg warn' : 'msg';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { $msgL.textContent = ''; }, 2600);
  }

  let toastTimer = null;
  /** 顶部 toast：应用 / 取消等操作的醒目反馈（1.9s 自动淡出） */
  function toast(text, warn) {
    if (!text) return;
    $toast.textContent = text;
    $toast.className = warn ? 'toast warn show' : 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $toast.className = 'toast'; }, 1900);
  }

  /* ---------------- 外部配置变更（托盘 / 导入 / 重置） ---------------- */

  function sameGroups(a, b) {
    if (!a || !b) return false;
    return S.GROUPS.every((g) => g.items.every((it) =>
      JSON.stringify(a[g.id][it.k]) === JSON.stringify(b[g.id][it.k])));
  }

  if (api) {
    api.onConfigChanged(({ config: c }) => {
      if (sameGroups(c, vals)) return;   // 本窗口自己的写入回声，忽略
      // runtime.stats 等节流写盘也会广播，但分组值未变——不打扰正在编辑的表单
      if (sameGroups(c, saved)) return;
      // 真正的外部变更（导入 / 托盘 / 重置）：更新快照，但保留未保存的编辑
      const dirty = new Set(dirtyKeys());
      saved = clone(c);
      const next = clone(c);
      S.GROUPS.forEach((g) => g.items.forEach((it) => {
        if (dirty.has(it.k)) next[g.id][it.k] = vals[g.id][it.k];
      }));
      vals = next;
      render();
    });
  }

  /* ---------------- 启动 ---------------- */

  (async function boot() {
    if (!api) {
      // 无桥接环境（例如直接用浏览器打开调试）：使用默认值，界面仍可浏览
      saved = S.defaults();
    } else {
      const [cfg, m] = await Promise.all([api.getConfig(), api.getMeta().catch(() => null)]);
      saved = clone(cfg);
      meta = m || meta;
    }
    vals = clone(saved);
    render();
  })().catch((e) => console.error('[settings] 启动失败:', e));
})();
