/**
 * main.js — Electron 主进程
 *
 * 职责：
 *   - 透明无边框置顶窗口（宠物）+ 独立设置窗口
 *   - 系统托盘（i18n）、开机自启、全局快捷键
 *   - 配置：bootstrap.json 定位数据目录 → config.json 分组结构
 *           schema 校验/夹紧/迁移 → 原子写 + 自动备份 + 写队列
 *   - IPC：配置读写、导入导出、数据目录迁移、系统通知
 */
'use strict';

const {
  app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen,
  nativeImage, dialog, Notification, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');

const ConfigSchema = require('./engine/config-schema.js');
const I18N = require('./engine/i18n.js');
const AiTalk = require('./engine/ai-talk.js');
const AiFallback = require('./engine/ai-fallback.js');
const AiSecret = require('./engine/ai-secret.js');
const AiClient = require('./engine/ai-client.js');

// 桌面宠物仅需 2D Canvas 渲染，禁用 GPU 硬件加速：
// 1) 避免无显卡/远程桌面/虚拟化环境下 GPU 进程崩溃导致无法启动；
// 2) 降低常驻资源占用，更加省电。
app.disableHardwareAcceleration();

// 兼容性开关：在无 GPU、容器化或无法启用 Chromium 沙箱的环境中保证可启动。
// 本程序只加载本地素材、无远程内容，安全性不受实质影响。
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('no-sandbox');

const WIN_W = 640;
const WIN_H = 640;
const PET_ANCHOR_X = WIN_W / 2;   // 猫的水平锚点（与 renderer.js 的 W/2 一致）
const PET_GROUND = 588;           // 猫的落地点（与 renderer.js 的 GROUND 一致）
const SPRITE_HALF_W = 253;        // 素材最宽帧半宽（实测 walk_3 左缘，sprite 像素，与 renderer.js 一致）
const SETTINGS_W = 620;
const SETTINGS_H = 580;
const PANEL_W = 212;
const PANEL_H = 496;
const PANEL_INSET = 8;            // 面板窗口内左右留白（与 status-panel.html 一致）
const PANEL_GAP = 12;             // 面板内容边缘与猫身边缘的间距（与 renderer.js 一致）

/* ================= 数据目录（bootstrap 引导） ================= */

const FALLBACK_DIR = () => app.getPath('userData');

function bootstrapPath() {
  return path.join(FALLBACK_DIR(), 'bootstrap.json');
}

function dirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

function resolveDataDir() {
  let dir = '';
  try {
    const b = JSON.parse(fs.readFileSync(bootstrapPath(), 'utf-8'));
    if (b && typeof b.dataDir === 'string' && b.dataDir) dir = b.dataDir;
  } catch (_) { /* 无引导文件，使用默认目录 */ }

  if (dir && dirWritable(dir)) return { dir, migrated: false, reason: '' };
  if (dir) return { dir: FALLBACK_DIR(), migrated: false, reason: 'bootstrapped-dir-unavailable' };
  return { dir: FALLBACK_DIR(), migrated: false, reason: '' };
}

/* ================= 配置：读取 / 校验 / 写盘 ================= */

let DATA_DIR = '';
let config = null;
let configIssues = [];

function configPath() { return path.join(DATA_DIR, 'config.json'); }
function backupDir() { return path.join(DATA_DIR, 'backup'); }

function lang() { return (config && config.appear && config.appear.language) || 'zh-CN'; }
function tr(key, params) { return I18N.t(lang(), key, params); }

function loadConfig() {
  const raw = fs.readFileSync(configPath(), 'utf-8');
  return JSON.parse(raw);
}

function initConfig() {
  DATA_DIR = resolveDataDir().dir;

  let raw = null;
  let corrupted = false;
  try {
    raw = loadConfig();
  } catch (e) {
    if (fs.existsSync(configPath())) {
      // 语法损坏：另存一份，绝不静默丢弃用户数据
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try { fs.copyFileSync(configPath(), path.join(DATA_DIR, `config.corrupt-${stamp}.json`)); } catch (_) {}
      corrupted = true;
    }
    raw = null;
  }

  const res = ConfigSchema.load(raw);
  config = res.config;
  configIssues = res.issues;
  // 数据目录的真实值以 bootstrap 为准，回写进配置供设置窗口展示
  config.data.dataDir = DATA_DIR;

  const wasLegacy = !raw || raw.configVersion == null;
  if (wasLegacy || configIssues.length) {
    // v1 迁移 / 字段被修正：立即以新结构落盘一次
    persistConfig(true);
    console.warn('[config] 配置已迁移或修正. legacy =', wasLegacy, 'issues =', configIssues.join(', ') || '(无)');
  }
}

let writeChain = Promise.resolve();
let writeTimer = null;

/** 加入写队列（串行化），300ms 防抖后真正落盘 */
function persistConfig(immediate) {
  if (immediate) {
    writeChain = writeChain.then(doWrite).catch((e) => console.error('[config] 写盘失败:', e));
    return;
  }
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeChain = writeChain.then(doWrite).catch((e) => console.error('[config] 写盘失败:', e));
  }, 300);
}

function doWrite() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 自动备份：覆盖前保留快照，滚动删除
  if (config.data.autoBackup && fs.existsSync(configPath())) {
    try {
      fs.mkdirSync(backupDir(), { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(configPath(), path.join(backupDir(), `config-${stamp}.json`));
      const keep = Math.max(1, config.data.backupKeep | 0);
      const olds = fs.readdirSync(backupDir())
        .filter((f) => f.startsWith('config-') && f.endsWith('.json'))
        .sort();
      while (olds.length > keep) fs.unlinkSync(path.join(backupDir(), olds.shift()));
    } catch (e) {
      console.warn('[config] 备份失败（忽略）:', e.message);
    }
  }

  // 原子写：tmp → rename，避免写盘中断导致 JSON 截断
  const tmp = configPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fs.renameSync(tmp, configPath());
}

/* ================= 窗口 ================= */

let win = null;
let tray = null;
let settingsWin = null;
let panelWin = null;
let appQuitting = false;

function createWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  const restore = !!config.startup.rememberPosition && Number.isFinite(config.runtime.x);
  const clampToWork = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x = restore
    ? clampToWork(config.runtime.x, work.x, Math.max(work.x, work.x + work.width - WIN_W))
    : Math.round(work.width - WIN_W - 120);
  const y = restore
    ? clampToWork(config.runtime.y, work.y, Math.max(work.y, work.y + work.height - WIN_H))
    : Math.round(work.height - WIN_H - 40);

  // 开机自启 + 静默启动：不弹出宠物窗口，只驻留托盘
  const startHidden = process.argv.includes('--autostart') && config.startup.startHidden;

  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    x, y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });

  let saveTimer = null;
  const persistPos = () => {
    if (!config.startup.rememberPosition) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const [wx, wy] = win.getPosition();
      config.runtime.x = wx;
      config.runtime.y = wy;
      persistConfig(true);
    }, 400);
  };
  win.on('move', persistPos);
  win.on('move', () => { enforceSize(win, WIN_W, WIN_H); });   // 跨 DPI 拖动防尺寸漂移
  win.on('move', syncPanelPos);
  win.on('resize', () => { enforceSize(win, WIN_W, WIN_H); });
  win.on('close', () => {
    if (!config.startup.rememberPosition) return;
    const [wx, wy] = win.getPosition();
    config.runtime.x = wx;
    config.runtime.y = wy;
    persistConfig(true);
  });

  applyClickThrough(config.interact.clickThrough);
}

/* ================= 状态面板（独立置顶小窗，位于宠物左侧） ================= */

/**
 * 尺寸不变量守卫：透明无边框窗口在跨 DPI 显示器拖动时，Electron 的边界
 * DIP 取整会让窗口尺寸漂移（宽/高 ±1px 累积 → 用户可见的"面板变宽"）。
 * 每次窗口移动/尺寸变化时强制恢复设计尺寸，切断累积。
 */
function enforceSize(bw, w, h) {
  if (!bw || bw.isDestroyed()) return false;
  const b = bw.getBounds();
  if (b.width !== w || b.height !== h) {
    bw.setSize(w, h, false);
    return true;
  }
  return false;
}

function panelVisible() { return !!(config && config.appear && config.appear.statusPanel); }

function createPanel() {
  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.loadFile(path.join(__dirname, 'status-panel.html'));
  panelWin.once('ready-to-show', () => {
    panelShownAt = Date.now();
    panelWin.show();
    syncPanelPos();
    panelWin.focus();   // 先抢焦点，之后点击其他区域时才会触发 blur 自动关闭
  });
  // 点击桌面 / 其他程序时自动关闭状态面板（固定行为）
  panelWin.on('blur', () => {
    if (appQuitting) return;
    if (config && config.appear && panelVisible()) {
      applyPatch({ appear: { statusPanel: false } });
    }
  });
  panelWin.on('close', (e) => {
    // 退出流程之外的关闭一律转为隐藏，避免 window-all-closed 误退出
    if (!appQuitting) { e.preventDefault(); panelWin.hide(); }
  });
  panelWin.on('closed', () => { panelWin = null; });
  panelWin.on('resize', () => { enforceSize(panelWin, PANEL_W, PANEL_H); });
}

/**
 * 面板贴在「猫身左缘」旁（而不是宠物窗口左缘）——窗口远大于猫，
 * 若按窗口边缘对齐，小体型时面板会离猫很远。位置随体型实时重算。
 * 左侧空间不足（贴屏幕左缘 / 猫太大）时翻到猫身右侧。
 */
function syncPanelPos() {
  if (!panelWin || panelWin.isDestroyed() || !win || win.isDestroyed()) return;
  enforceSize(panelWin, PANEL_W, PANEL_H);   // 跨 DPI 拖动防尺寸漂移

  const scale = (config.pet && Number.isFinite(config.pet.size)) ? config.pet.size : 0.88;
  const halfW = SPRITE_HALF_W * scale;          // 猫身半宽（窗口坐标）
  const catLeft = PET_ANCHOR_X - halfW;         // 猫身左缘
  const catRight = PET_ANCHOR_X + halfW;
  const [wx, wy] = win.getPosition();
  const work = screen.getPrimaryDisplay().workArea;

  // 面板窗口左缘 = 目标锚点 - 内容内边距（面板内容边缘对齐猫身边缘 - 间距）
  let px = wx + catLeft - PANEL_GAP - (PANEL_W - PANEL_INSET);
  let side = 'left';
  if (px < work.x) {
    px = wx + catRight + PANEL_GAP - PANEL_INSET;                  // 翻到猫身右侧
    side = 'right';
  }
  px = Math.max(work.x, Math.min(px, work.x + work.width - PANEL_W));

  // 纵向：面板中心对齐猫身中心
  const py = Math.round(wy + PET_GROUND - 200 * scale - PANEL_H / 2);
  const pyClamped = Math.max(work.y, Math.min(py, work.y + work.height - PANEL_H - 4));

  panelWin.setPosition(Math.round(px), pyClamped);
  // 通知渲染进程面板贴靠侧（活动边界 / 气泡避让用）
  if (win && !win.isDestroyed()) win.webContents.send('panel-side', side);
}

function applyPanelVisible() {
  if (panelVisible()) {
    if (!panelWin || panelWin.isDestroyed()) createPanel();
    else {
      syncPanelPos();            // 先定位再显示，避免旧位置闪烁；重开时自然贴近宠物
      panelShownAt = Date.now();
      panelWin.show();
      panelWin.focus();
    }
  } else if (panelWin && !panelWin.isDestroyed()) {
    panelWin.hide();
  }
}

/**
 * 面板失焦关闭的轮询兜底：透明无边框窗口在部分环境下 blur 事件不可靠
 * （例如从未真正持有焦点），每 400ms 检查一次焦点窗口——
 * 既不是面板、也不是宠物窗（且没有其他自有窗口在前台）时关闭面板。
 * 面板不可见或功能关闭时定时器空转，无窗口查询开销。
 */
let panelShownAt = 0;
setInterval(() => {
  if (appQuitting || !panelVisible()) return;
  if (!panelWin || panelWin.isDestroyed() || !panelWin.isVisible()) return;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused === panelWin || focused === win) return;
  // 面板刚打开的第一秒内不判定（show/focus 时序抖动）
  if (Date.now() - (panelShownAt || 0) < 1000) return;
  // 有其他自有窗口（设置窗）持焦点时不关，避免打开设置就把面板关掉
  if (focused && focused === settingsWin) return;
  applyPatch({ appear: { statusPanel: false } });
}, 400);

function applyClickThrough(enabled) {
  if (!win) return;
  // 统一从「忽略 + 转发」起步：
  //   点击穿透开 → 之后始终保持忽略（渲染进程不会接管）；
  //   点击穿透关 → 由渲染进程按「鼠标是否悬停猫身」动态接管，
  //                 避免 640×640 的大窗口遮挡桌面点击。
  win.setIgnoreMouseEvents(true, { forward: true });
}

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  });
}

/* ================= AI 自言自语 =================
 *
 * 猫只单向说话：主进程负责「生成 → 切句 → 按节奏推送」，渲染进程只负责显示与让路。
 * 这里不保存对话上下文——唯一的记忆是 ai-recent.json（去重窗口）。
 *
 * 生成优先级：模型（有 Key 或本地 Ollama）→ 失败且尚未开口 → 静默降级离线语料。
 * 已经在讲的中途断流不补离线内容（避免风格突变），直接说完现有句子收尾。
 */

const AI_RECENT_FILE = 'ai-recent.json';
const AI_USAGE_FILE = 'ai-usage.json';

let aiBusy = false;
let aiToken = 0;                 // 每次开讲自增；旧循环检测到变化即退出
let aiRecent = [];
let aiUsage = { date: '', count: 0 };
let aiCtrl = null;               // 当前模型请求的 AbortController
let aiLastError = null;          // 最近一次模型失败（诊断用，设置页可查）
let aiSleepers = [];             // 可被 aiAbort 立刻唤醒的等待

function readJsonFile(file, def) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'));
  } catch (_) {
    return def;
  }
}

function writeJsonFile(file, obj) {
  try {
    const p = path.join(DATA_DIR, file);
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, p);
    return true;
  } catch (e) {
    console.warn('[ai] 写盘失败', file, e.message);
    return false;
  }
}

function localDateKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 每日用量（跨天自动归零） */
function aiUsageTick() {
  const k = localDateKey();
  if (!aiUsage || aiUsage.date !== k) aiUsage = { date: k, count: 0 };
  return aiUsage;
}

function aiLoad() {
  aiRecent = AiTalk.pruneRecent(readJsonFile(AI_RECENT_FILE, []), Date.now());
  const u = readJsonFile(AI_USAGE_FILE, null);
  aiUsage = (u && u.date === localDateKey() && Number.isFinite(u.count))
    ? { date: u.date, count: Math.max(0, Math.round(u.count)) }
    : { date: localDateKey(), count: 0 };
}

/** 离线选段：优先没讲过的；全讲过了就从头再来 */
function aiPickOffline(cat) {
  const list = (AiFallback.CONTENT[cat] || []).slice();
  if (!list.length) return null;
  const now = Date.now();
  const fresh = list.filter((e) => !AiTalk.isDup(aiRecent, AiTalk.keyOf(cat, e.lines), now));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 可打断的等待：aiAbort 会立刻唤醒，避免交互要等一整句播完 */
function aiSleep(ms) {
  return new Promise((resolve) => {
    const fn = () => {
      clearTimeout(timer);
      aiSleepers = aiSleepers.filter((s) => s !== fn);
      resolve('aborted');
    };
    const timer = setTimeout(() => {
      aiSleepers = aiSleepers.filter((s) => s !== fn);
      resolve('timeout');
    }, Math.max(0, ms));
    aiSleepers.push(fn);
  });
}

function aiWakeAll() {
  const list = aiSleepers;
  aiSleepers = [];
  list.forEach((f) => { try { f(); } catch (_) {} });
}

/** 取消正在讲的一段（交互打断 / 换话题 / 关闭开关时调用） */
function aiAbort() {
  aiToken++;
  aiWakeAll();
  if (aiCtrl) { try { aiCtrl.abort(); } catch (_) {} aiCtrl = null; }
  if (aiBusy) {
    aiBusy = false;
    sendToRenderer('ai-busy', { busy: false });
  }
}

/** 主进程侧网络：优先 Electron net.fetch（走系统代理），失败回退全局 fetch */
function aiFetch(url, init) {
  let netFetch = null;
  try {
    // eslint-disable-next-line global-require
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') netFetch = net.fetch.bind(net);
  } catch (_) { /* 非 Electron 环境（单测）走 fetch */ }
  if (!netFetch) return fetch(url, init);
  return netFetch(url, init).catch((e) => {
    // Chromium 网络服务重启 / 代理栈异常时 net.fetch 会直接 reject，用 Node 原生 fetch 再试一次
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) throw e;
    return fetch(url, init);
  });
}

/** 是否具备走模型的条件（本地服务允许空密钥） */
function aiReady() {
  if (!config || !config.ai || !config.ai.enabled) return { ok: false, reason: 'disabled' };
  if (!String(config.ai.baseUrl || '').trim()) return { ok: false, reason: 'bad-url' };
  if (!String(config.ai.model || '').trim()) return { ok: false, reason: 'no-model' };
  const key = AiSecret.getKey(DATA_DIR);
  if (!key && !AiClient.isLocalUrl(config.ai.baseUrl)) return { ok: false, reason: 'no-key' };
  return { ok: true, key: key || '' };
}

/** 当前状态 → 一句口头情境（喂给模型，让内容贴合此刻） */
function aiMoodText(lg) {
  const s = (config.runtime && config.runtime.stats) || {};
  const en = lg === 'en-US' || lg === 'en';
  const out = [];
  if (s.hunger < 30) out.push(en ? 'quite hungry' : '肚子有点饿');
  else if (s.energy < 30) out.push(en ? 'too sleepy to keep eyes open' : '困得眼睛快睁不开');
  else if (s.happiness < 30) out.push(en ? 'a bit bored and lonely' : '有点闷，想让人陪');
  else if (s.cleanliness < 30) out.push(en ? 'feeling dusty' : '身上有点脏，想舔毛');
  else out.push(en ? 'lazy and comfortable' : '懒洋洋的，挺舒服');

  const h = new Date().getHours();
  if (h >= 23 || h < 6) out.push(en ? 'it is the middle of the night' : '已经是深夜了');
  else if (h >= 6 && h < 9) out.push(en ? 'the day has just started' : '天才刚亮');
  else if (h >= 18) out.push(en ? 'it is evening' : '天已经黑了');
  return out.join(en ? ', ' : '，');
}

/**
 * 走模型生成一段，边收边切句推给 speaker。
 * @returns {Promise<{ok:boolean, code?:string, detail?:string, spoke:number}>} spoke>0 表示已经开过口
 */
async function aiModelSpeak(cat, speaker, my, key) {
  const lg = lang();
  const verse = !!AiTalk.CATS[cat].verse;
  const cap = AiTalk.CATS[cat].maxSent;
  const charCap = AiTalk.CATS[cat].maxChars * 2;
  const splitter = AiTalk.createSentenceStream({ verse });
  let sent = 0;
  let chars = 0;
  let stop = false;
  let timedOut = false;
  let firstTimer = null;

  const emit = (lines) => {
    for (const line of lines) {
      if (sent >= cap) return;
      sent += 1;
      speaker.push(line);
    }
    if (sent > 0 && firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
  };

  aiCtrl = new AbortController();

  /* 首句超时：模型排长队时不让气泡空等——8s 内没憋出第一句就降级离线 */
  const FIRST_LINE_MS = 8000;
  firstTimer = setTimeout(() => {
    if (sent > 0) return;
    timedOut = true;
    stop = true;
    if (aiCtrl) { try { aiCtrl.abort(); } catch (_) {} }
  }, FIRST_LINE_MS);

  let r;
  try {
    r = await AiClient.streamChat({
      fetchImpl: aiFetch,
      baseUrl: config.ai.baseUrl,
      apiKey: key,
      model: config.ai.model,
      messages: AiClient.buildMessages(cat, {
        name: config.pet.petName,
        owner: config.pet.ownerName,
        hour: new Date().getHours(),
        mood: aiMoodText(lg),
        titles: AiTalk.recentTitles(aiRecent, cat, 4),
        lang: lg,
      }),
      maxTokens: AiClient.tokensFor(cat),
      temperature: 0.9,
      signal: aiCtrl.signal,
      isStopped: () => stop || my !== aiToken,
      onText: (d) => {
        chars += d.length;
        emit(splitter.push(d));
        if (sent >= cap || chars > charCap) { stop = true; return false; }   // 够一段了就断开，不再烧 token
        return true;
      },
    });
  } finally {
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
    aiCtrl = null;
  }

  if (sent < cap) emit(splitter.flush());

  if (!sent && timedOut) {
    aiLastError = { code: 'timeout', detail: 'first line timeout', ts: Date.now() };
    return { ok: false, code: 'timeout', detail: 'first line timeout', spoke: 0 };
  }

  aiLastError = r.ok ? null : { code: r.code, detail: r.detail || '', ts: Date.now() };
  return { ok: !!r.ok, code: r.code, detail: r.detail, spoke: sent };
}

/**
 * 讲一段。
 * @param {string} category joke|story|poem|riddle|fact|idle（空＝随机）
 * @param {{manual?:boolean, entry?:object}} [opts]
 * @returns {Promise<{ok:boolean, cat?:string, lines?:number, source?:string, fallback?:string, reason?:string}>}
 */
async function aiTell(category, opts) {
  if (!config || !config.ai || !config.ai.enabled) return { ok: false, reason: 'disabled' };

  const o = opts || {};
  const lastCat = aiRecent[0] && aiRecent[0].cat;
  const cat = AiTalk.CATS[category] ? category : AiTalk.pickCategory(Math.random, lastCat);

  aiUsageTick();
  // 每日上限已下线（1.9.9 起不限制次数）；ai-usage.json 仍记录当天用量供诊断

  // 新的一段直接接管：旧循环会在下一个检查点退出
  aiToken++;
  const my = aiToken;
  aiBusy = true;
  sendToRenderer('ai-busy', { busy: true, cat });

  aiUsage.count += 1;
  writeJsonFile(AI_USAGE_FILE, aiUsage);

  const pace = config.ai.bubblePace || 'normal';
  const verse = !!AiTalk.CATS[cat].verse;

  /* 句子队列：生成端 push，播放端按 hold 节奏消费（两边并行，首句零等待） */
  const q = [];
  let qEnd = false;
  let qWaiter = null;
  const wake = () => { if (qWaiter) { const w = qWaiter; qWaiter = null; w(); } };
  const speaker = {
    push(line) {
      if (qEnd || my !== aiToken) return;
      const clean = AiTalk.sanitize(line);
      if (!clean) return;             // 净化后为空（纯转义/控制符）不进队列
      q.push(clean);
      wake();
    },
    end() { qEnd = true; wake(); },
  };

  const spoken = [];
  const player = (async () => {
    while (true) {
      if (my !== aiToken) return 'aborted';
      if (!q.length) {
        if (qEnd) return 'done';
        await new Promise((r) => { qWaiter = r; });
        continue;
      }
      const line = q.shift();
      spoken.push(line);
      const hold = AiTalk.holdFor(line, pace);
      sendToRenderer('ai-say', {
        text: verse ? line.split('|').join('\n') : line,
        verse,
        hold,
        cat,
        voiceKey: spoken.length === 1 ? AiTalk.CATS[cat].voice : null,
        last: qEnd && q.length === 0,
      });
      const gap = (q.length || !qEnd) ? 350 : 0;
      const w = await aiSleep(hold + gap);
      if (w === 'aborted' || my !== aiToken) return 'aborted';
    }
  })();

  let source = 'offline';
  let fallback = null;
  let entry = o.entry || null;

  const ready = aiReady();
  if (ready.ok) {
    const g = await aiModelSpeak(cat, speaker, my, ready.key);
    if (my !== aiToken) {
      aiWakeAll();
      await player.catch(() => {});
      return { ok: false, reason: 'aborted' };
    }
    if (g.spoke > 0) {
      source = 'model';                       // 已开口：即使断流也把现有句子讲完
      if (!g.ok) fallback = g.code || 'http';
    } else {
      fallback = g.code || 'empty';           // 一句没说出口 → 静默降级离线
      console.warn('[ai] 模型失败，改用内置内容：', g.code, g.detail || '');
    }
  } else if (ready.reason !== 'no-key') {
    fallback = ready.reason;                   // 无 Key 属正常离线模式，不当成错误
  }

  if (source === 'offline') {
    entry = entry || aiPickOffline(cat);
    if (entry) AiTalk.clipLines(entry.lines, cat).forEach((l) => speaker.push(l));
    else fallback = fallback || 'empty';
  }

  speaker.end();
  const st = await player;
  if (st === 'aborted' || my !== aiToken) return { ok: false, reason: 'aborted' };

  aiBusy = false;
  sendToRenderer('ai-busy', { busy: false });
  if (!spoken.length) {
    sendToRenderer('ai-done', { cat, source, fallback, empty: true });
    return { ok: false, cat, source, fallback, reason: fallback || 'empty' };
  }

  /* 去重记录：离线用原始语料指纹，模型用实际说出的句子（同段不会再讲第二次） */
  const keyOfText = source === 'offline' && entry
    ? AiTalk.keyOf(cat, entry.lines)
    : AiTalk.keyOf(cat, spoken);
  aiRecent = AiTalk.pushRecent(aiRecent, { key: keyOfText, cat, title: spoken[0] }, Date.now());
  writeJsonFile(AI_RECENT_FILE, aiRecent);

  sendToRenderer('ai-done', { cat, source, fallback });
  return { ok: true, cat, lines: spoken.length, source, fallback };
}

/**
 * 连接测试：发一次极短的非流式请求，验证地址 / 模型 / 密钥。
 * 与正式播报共用同一套错误分类，返回 code 供设置页翻译成人话。
 */
async function aiTest() {
  if (!config || !config.ai || !config.ai.enabled) return { ok: false, reason: 'disabled' };
  const ready = aiReady();
  if (!ready.ok) return { ok: false, reason: ready.reason };

  const lg = lang();
  const r = await AiClient.chatOnce({
    fetchImpl: aiFetch,
    baseUrl: config.ai.baseUrl,
    apiKey: ready.key,
    model: config.ai.model,
    messages: [
      { role: 'system', content: lg === 'en-US' ? 'You are a cat. You only meow.' : '你是一只猫，只会喵喵叫。' },
      { role: 'user', content: lg === 'en-US' ? 'Meow once, under 10 characters.' : '喵一声，不超过 10 个字。' },
    ],
    maxTokens: 16,
    temperature: 0.6,
    timeoutMs: 20000,
  });

  aiLastError = r.ok ? null : { code: r.code, detail: r.detail || '', ts: Date.now() };
  if (!r.ok) {
    console.warn('[ai] 连接测试失败：', r.code, r.detail || '');
    return { ok: false, reason: r.code, detail: r.detail || '', ms: r.ms };
  }
  return { ok: true, ms: r.ms, model: config.ai.model, sample: String(r.text || '').slice(0, 40) };
}

/* ================= 托盘 ================= */

function buildTrayMenu() {
  const L = (k) => tr('tray.' + k);
  return Menu.buildFromTemplate([
    { label: L('pet'), click: () => sendToRenderer('action', 'pet') },
    { label: L('feed'), click: () => sendToRenderer('action', 'feed') },
    { label: L('play'), click: () => sendToRenderer('action', 'play') },
    { label: L('call'), click: () => sendToRenderer('action', 'call') },
    { label: L('bath'), click: () => sendToRenderer('action', 'bath') },
    { type: 'separator' },
    {
      label: L('muted'),
      type: 'checkbox',
      checked: !!config.sound.muted,
      click: (item) => applyPatch({ sound: { muted: item.checked } }),
    },
    { type: 'separator' },
    { label: L('settings'), click: () => openSettings() },
    { label: L('quit'), click: () => app.quit() },
  ]);
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray_32.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  refreshTray();
  tray.on('double-click', () => {
    if (config.interact.trayDoubleClickCall) sendToRenderer('action', 'call');
  });
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  tray.setToolTip(tr('settings.title', { name: config.pet.petName }));
  tray.setContextMenu(buildTrayMenu());
}

function sendToRenderer(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ================= 开机自启 ================= */

function syncLoginItem() {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!config.startup.autoStart,
      openAsHidden: !!config.startup.startHidden,
      path: process.execPath,
      args: ['--autostart'],
    });
  } catch (e) {
    console.error('[autostart] 设置失败:', e);
  }
}

/* ================= 全局快捷键 ================= */

function applyHotkey() {
  globalShortcut.unregisterAll();
  const hk = config.interact.hotkeyCall;
  if (hk === 'none') return;
  try {
    const ok = globalShortcut.register(hk, () => sendToRenderer('action', 'call'));
    if (!ok) console.warn('[hotkey] 注册失败（可能被占用）:', hk);
  } catch (e) {
    console.warn('[hotkey] 注册异常:', hk, e.message);
  }
}

/* ================= 系统通知 ================= */

function sendNotification(title, body) {
  if (!config.sound.notifications) return;
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title, body, silent: !!config.sound.muted });
    n.show();
  } catch (e) {
    console.warn('[notify] 发送失败:', e.message);
  }
}

/* ================= 配置变更：合并 + 副作用 + 广播 ================= */

function applyPatch(patch, opts) {
  const before = config;
  const merged = ConfigSchema.mergePatch(config, patch || {});
  const changed = ConfigSchema.changedPaths(before, merged);
  config = merged;
  persistConfig(!!(opts && opts.immediate));

  // —— 副作用 ——
  if (changed.some((p) => p === 'startup.autoStart' || p === 'startup.startHidden')) syncLoginItem();
  if (changed.indexOf('interact.clickThrough') >= 0) applyClickThrough(config.interact.clickThrough);
  if (changed.indexOf('interact.hotkeyCall') >= 0) applyHotkey();
  if (changed.some((p) => p.indexOf('appear.language') === 0 || p.indexOf('pet.petName') === 0)) refreshTray();
  if (changed.indexOf('appear.statusPanel') >= 0) applyPanelVisible();
  if (changed.indexOf('pet.size') >= 0) syncPanelPos();   // 面板贴猫身，体型变化需重新贴合
  if (changed.indexOf('data.autoBackup') >= 0 || changed.indexOf('data.backupKeep') >= 0) persistConfig(true);

  broadcast('config-changed', { config, changed });
  return { config, changed };
}

/* ================= 设置窗口 ================= */

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: SETTINGS_W,
    height: SETTINGS_H,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    title: tr('settings.title', { name: config.pet.petName }),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  // 关闭拦截（含标题栏 × 与 Escape 之外的系统关闭路径）：
  // 退出流程放行；其余转交渲染进程判断是否有未保存改动
  settingsWin.on('close', (e) => {
    if (appQuitting || settingsWin.__forceClose) return;
    e.preventDefault();
    if (!settingsWin.isDestroyed()) settingsWin.webContents.send('settings-close-request');
  });
  settingsWin.on('closed', () => { settingsWin = null; });
}

/* ================= 导入 / 导出 / 数据目录迁移 ================= */

function stampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

async function exportConfig() {
  const r = await dialog.showSaveDialog(settingsWin, {
    title: tr('settings.exportCfg'),
    defaultPath: path.join(app.getPath('documents'), `cat-pet-config-${stampName()}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  try {
    fs.writeFileSync(r.filePath, JSON.stringify(config, null, 2));
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function importConfig() {
  const r = await dialog.showOpenDialog(settingsWin, {
    title: tr('settings.importCfg'),
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false };
  try {
    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf-8'));
    const res = ConfigSchema.load(raw);
    // 导入只覆盖设置项；运行时数据（位置 / 属性）保留本机当前值
    const next = Object.assign({}, res.config, { runtime: config.runtime });
    const changed = ConfigSchema.changedPaths(config, next);

    const confirm = await dialog.showMessageBox(settingsWin, {
      type: 'question',
      buttons: [tr('settings.apply'), tr('settings.cancel')],
      defaultId: 0,
      cancelId: 1,
      message: tr('settings.importCfg'),
      detail: tr('settings.dirty', { n: changed.length }),
    });
    if (confirm.response !== 0) return { ok: false };

    config = next;
    syncLoginItem();
    applyClickThrough(config.interact.clickThrough);
    applyHotkey();
    refreshTray();
    applyPanelVisible();
    persistConfig(true);
    broadcast('config-changed', { config, changed });
    return { ok: true, changed: changed.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function chooseDataDir() {
  const r = await dialog.showOpenDialog(settingsWin, {
    title: tr('settings.browse'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false };
  const dir = r.filePaths[0];
  if (!dirWritable(dir)) return { ok: false, reason: tr('settings.dirBad', { reason: 'read-only' }) };
  return { ok: true, dir };
}

function openDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  shell.openPath(DATA_DIR);
}

async function migrateData() {
  const target = config.data.dataDir;
  if (!target || path.resolve(target) === path.resolve(DATA_DIR)) {
    return { ok: false, reason: 'no-change' };
  }
  if (!dirWritable(target)) {
    return { ok: false, reason: tr('settings.dirBad', { reason: 'read-only' }) };
  }
  try {
    fs.mkdirSync(target, { recursive: true });
    // 先复制后切换；失败回滚，不删除源数据
    if (fs.existsSync(configPath())) fs.copyFileSync(configPath(), path.join(target, 'config.json'));
    if (fs.existsSync(backupDir())) {
      const dst = path.join(target, 'backup');
      fs.mkdirSync(dst, { recursive: true });
      fs.readdirSync(backupDir()).forEach((f) => {
        fs.copyFileSync(path.join(backupDir(), f), path.join(dst, f));
      });
    }
    fs.writeFileSync(bootstrapPath(), JSON.stringify({ dataDir: target }, null, 2));
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/* ================= IPC ================= */

function registerIpc() {
  ipcMain.handle('get-config', () => config);
  ipcMain.handle('get-meta', () => ({
    dataDir: DATA_DIR,
    version: app.getVersion(),
    issues: configIssues,
    notificationsSupported: Notification.isSupported(),
    aiHasKey: AiSecret.hasKey(DATA_DIR),
    aiKeyMask: AiTalk.maskKey(AiSecret.getKey(DATA_DIR)),
    aiEncryption: AiSecret.encryptionAvailable(),
    aiLocal: AiClient.isLocalUrl(config.ai && config.ai.baseUrl),
    aiUsage: { date: aiUsage.date, count: aiUsage.count },
    aiLastError,
  }));

  ipcMain.handle('save-config', (_e, patch) => applyPatch(patch));

  ipcMain.handle('reset-config', (_e, opts) => {
    const keepName = !!(opts && opts.keepPetName);
    const name = config.pet.petName;
    const before = config;
    config = ConfigSchema.defaults();
    if (keepName) config.pet.petName = name;
    config.runtime = before.runtime;
    const changed = ConfigSchema.changedPaths(before, config);
    syncLoginItem();
    applyClickThrough(config.interact.clickThrough);
    applyHotkey();
    refreshTray();
    applyPanelVisible();
    persistConfig(true);
    broadcast('config-changed', { config, changed });
    return { config, changed };
  });

  ipcMain.handle('open-settings', () => openSettings());

  /* ---- AI 自言自语 ---- */
  ipcMain.handle('ai-tell', (_e, category, opts) => aiTell(category, opts));
  ipcMain.handle('ai-abort', () => { aiAbort(); return true; });
  ipcMain.handle('ai-test', () => aiTest());
  ipcMain.handle('ai-set-key', (_e, key) => {
    const r = AiSecret.setKey(DATA_DIR, key);
    if (!r.ok) return r;
    return { ok: true, encrypted: r.encrypted, mask: AiTalk.maskKey(String(key)) };
  });
  ipcMain.handle('ai-clear-key', () => ({ ok: AiSecret.clearKey(DATA_DIR) }));
  ipcMain.handle('ai-has-key', () => ({
    ok: true,
    has: AiSecret.hasKey(DATA_DIR),
    mask: AiTalk.maskKey(AiSecret.getKey(DATA_DIR)),
  }));
  ipcMain.handle('ai-clear-recent', () => {
    aiRecent = [];
    writeJsonFile(AI_RECENT_FILE, aiRecent);
    return { ok: true };
  });
  ipcMain.handle('export-config', () => exportConfig());
  ipcMain.handle('import-config', () => importConfig());
  ipcMain.handle('choose-data-dir', () => chooseDataDir());
  ipcMain.handle('open-data-dir', () => openDataDir());
  ipcMain.handle('migrate-data', () => migrateData());
  ipcMain.handle('restart-app', () => { app.relaunch(); app.exit(0); });
  ipcMain.handle('quit', () => app.quit());

  ipcMain.handle('notify', (_e, payload) => {
    const p = payload || {};
    sendNotification(String(p.title || ''), String(p.body || ''));
    return true;
  });

  // 渲染进程拖拽窗口：主进程按增量位移，避免 CSS app-region 抢占交互；
  // keepOnScreen 开启时夹紧到工作区（至少保留 160×120 可见，防止拖出后找不回），
  // 并把「窗口 ∩ 屏幕」可见区间换算成窗口坐标推送渲染进程（猫身二次夹紧）。
  ipcMain.on('win-move', (_e, dx, dy) => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    let nx = Math.round(x + dx);
    let ny = Math.round(y + dy);
    if (config.interact.keepOnScreen !== false) {
      const work = screen.getDisplayMatching(win.getBounds()).workArea;
      nx = Math.max(work.x - (WIN_W - 160), Math.min(nx, work.x + work.width - 160));
      ny = Math.max(work.y - (WIN_H - 120), Math.min(ny, work.y + work.height - 120));
    }
    win.setPosition(nx, ny);
    pushScreenEdge();
  });

  // 「窗口 ∩ 主屏工作区」的可见像素区间（窗口坐标）→ 渲染进程做猫身夹紧
  function pushScreenEdge() {
    if (!win || win.isDestroyed()) return;
    if (config.interact.keepOnScreen === false) {
      win.webContents.send('screen-edge', null);
      return;
    }
    const [wx, wy] = win.getPosition();
    const work = screen.getDisplayMatching(win.getBounds()).workArea;
    const lo = Math.max(0, work.x - wx);
    const hi = Math.min(WIN_W, work.x + work.width - wx);
    if (hi <= lo) { win.webContents.send('screen-edge', null); return; }
    win.webContents.send('screen-edge', { lo, hi });
  }

  // 显示器拓扑变化（拔插 / 分辨率改变）：窗口与面板一并夹回屏幕内
  screen.on('display-metrics-changed', () => {
    if (!win || win.isDestroyed()) return;
    if (config.interact.keepOnScreen !== false) {
      const work = screen.getDisplayMatching(win.getBounds()).workArea;
      const [x, y] = win.getPosition();
      const nx = Math.max(work.x - (WIN_W - 160), Math.min(x, work.x + work.width - 160));
      const ny = Math.max(work.y - (WIN_H - 120), Math.min(y, work.y + work.height - 120));
      if (nx !== x || ny !== y) win.setPosition(nx, ny);
    }
    pushScreenEdge();
    syncPanelPos();
  });

  // 宠物 → 状态面板：属性 / 台词实时转发（渲染进程已节流）
  ipcMain.on('stats-live', (_e, p) => {
    // 属性实时镜像：渲染进程是属性的活真源（每 0.25s 推一次），这里同步进内存
    // config，保证任何 config-changed 广播携带的都是较新属性。否则设置项变更的
    // 广播会用主进程里落后一个保存周期（最长 saveInterval 秒）的旧快照回填宠物
    // 窗口，把刚结算的喂食 / 逗玩收益整体回滚（表现为交互后状态数值不动）。
    if (p && p.stats && typeof p.stats === 'object') {
      config.runtime.stats = Object.assign({}, config.runtime.stats, p.stats);
    }
    if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) {
      panelWin.webContents.send('stats-changed', p);
    }
  });

  // 状态面板互动按钮 → 转发给宠物渲染进程执行
  ipcMain.handle('pet-action', (_e, a) => {
    const acts = ['pet', 'feed', 'play', 'call', 'bath', 'settingsSaved'];
    if (acts.indexOf(a) >= 0) sendToRenderer('action', a);
    return true;
  });

  // 设置窗口关闭拦截：有未保存改动时由渲染进程弹确认框，确认后经此通道真正关闭
  ipcMain.on('settings-close-confirm', () => {
    if (!settingsWin || settingsWin.isDestroyed()) return;
    settingsWin.__forceClose = true;
    settingsWin.close();
  });

  // 动态鼠标穿透：鼠标不在猫身上时窗口不拦截桌面点击（forward 保证仍能收到 mousemove）
  ipcMain.on('mouse-pass', (_e, ignore) => {
    if (!win || win.isDestroyed()) return;
    if (config.interact.clickThrough) {
      win.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
}

/* ================= 生命周期 ================= */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
    }
  });

  app.whenReady().then(() => {
    initConfig();
    aiLoad();                 // 去重记录 + 当日用量
    if (!fs.existsSync(configPath())) persistConfig(true); // 首次启动即落盘，便于用户定位配置
    syncLoginItem();          // 以 --autostart 启动时确保登录项与配置一致
    createWindow();
    createPanel();            // 状态面板（由 appear.statusPanel 决定显隐）
    applyPanelVisible();
    buildTray();
    registerIpc();
    applyHotkey();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => {
    appQuitting = true;
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

}
