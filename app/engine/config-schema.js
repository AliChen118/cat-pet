/**
 * config-schema.js — 配置字段定义表（单一来源）
 *
 * 同时服务于：
 *   - 主进程（require）：读取校验、越界夹紧、版本迁移、写盘
 *   - 设置窗口（<script>）：表单由本表驱动渲染，UI 不硬编码任何设置项
 *   - 宠物窗口（<script>）：消费分组后的配置
 *
 * 生效徽标：sec = 'restart'（重启后生效）| 'login'（下次登录生效）| undefined（即时）
 */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConfigSchema = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  var CONFIG_VERSION = 11;

  /* ---------------- 分组与字段定义 ---------------- */

  /** 生成 [lo..hi] 的连续整数数组（下拉框选项用） */
  function seq(lo, hi) {
    var a = [];
    for (var i = lo; i <= hi; i++) a.push(i);
    return a;
  }

  var GROUPS = [
    {
      id: 'pet', zh: '宠物', en: 'Pet',
      items: [
        { k: 'petName', t: 'text', d: '小银', max: 12,
          zh: '宠物名字', en: 'Pet name',
          hzh: '1–12 个字符；自动去除首尾空白，禁止控制字符与换行。',
          hen: '1–12 characters. Leading/trailing spaces are trimmed; control characters are blocked.' },
        { k: 'ownerName', t: 'text', d: '主人', max: 8, allowEmpty: true,
          zh: '主人称呼', en: 'Your title',
          hzh: '宠物在气泡里对你的称呼，如「主人」「铲屎官」；留空则使用通用称呼。',
          hen: 'How the pet addresses you in bubbles. Leave blank for a generic term.' },
        { k: 'size', t: 'range', d: 0.88, min: 0.176, max: 0.88, step: 0.044, fmt: 'pctRef', ref: 0.88,
          zh: '体型大小', en: 'Pet size',
          hzh: '20%–100%（100% 为基准体型，即默认显示大小）；与滚轮缩放共享同一状态，任一入口改动即时同步，超出范围会被夹回。',
          hen: '20%–100% of the reference size. Shared with scroll-wheel zoom — all entries stay in sync; out-of-range values are clamped.' },
        { k: 'birthday', t: 'date', d: '',
          zh: '宠物出生日期', en: 'Pet birthday',
          hzh: '设定后状态面板显示宠物年龄（可精确到天或月）；不允许设置未来的日期。',
          hen: 'When set, the status panel shows the pet’s age (by day or month). Future dates are not allowed.' }
      ]
    },
    {
      id: 'startup', zh: '启动与运行', en: 'Startup & running',
      items: [
        { k: 'autoStart', t: 'switch', d: false, sec: 'login',
          zh: '开机自启动', en: 'Launch at login',
          nzh: '登录 Windows 后自动运行宠物', nen: 'Start the pet after you sign in to Windows' },
        { k: 'startHidden', t: 'switch', d: true, sec: 'restart',
          zh: '静默启动', en: 'Start hidden',
          nzh: '开机自启时不弹窗口，静默驻留托盘', nen: 'Stay in the tray without showing the window at login' },
        { k: 'rememberPosition', t: 'switch', d: true,
          zh: '记住窗口位置', en: 'Remember position',
          nzh: '退出时保存位置，下次原样恢复', nen: 'Save the position on exit and restore it next time' }
      ]
    },
    {
      id: 'interact', zh: '交互', en: 'Interaction',
      items: [
        { k: 'clickThrough', t: 'switch', d: false,
          zh: '点击穿透', en: 'Click-through',
          nzh: '鼠标事件穿透到下层窗口', nen: 'Pass mouse events through to the window below',
          hzh: '开启后宠物不再响应点击；仍可从托盘菜单或全局快捷键恢复，不会把自己锁死。',
          hen: 'The pet stops responding to clicks, but the tray menu and hotkey still work.' },
        { k: 'wheelZoom', t: 'switch', d: true,
          zh: '滚轮缩放', en: 'Scroll-wheel zoom',
          nzh: '悬停宠物身上滚动滚轮调整体型', nen: 'Scroll over the pet to resize it' },
        { k: 'hotkeyCall', t: 'select', d: 'Ctrl+Shift+C',
          opts: ['Ctrl+Shift+C', 'Ctrl+Alt+C', 'Alt+Shift+C', 'none'],
          zh: '呼喊快捷键', en: 'Call hotkey',
          hzh: '全局生效，在任意程序下都能把宠物喊过来；被其他程序占用时自动保留原设置并提示。',
          hen: 'Works globally. If the key is taken by another app, the previous value is kept.' },
        { k: 'trayDoubleClickCall', t: 'switch', d: true,
          zh: '双击托盘呼喊', en: 'Tray double-click calls',
          nzh: '双击托盘图标触发呼喊', nen: 'Double-clicking the tray icon calls the pet' },
        { k: 'keepOnScreen', t: 'switch', d: true,
          zh: '限制活动区域', en: 'Keep on screen',
          nzh: '宠物不会走出屏幕边界', nen: 'Keep the pet inside the screen',
          hzh: '开启后拖动宠物时窗口不会被拖出屏幕外；显示器断开或切换时也会自动夹回。',
          hen: 'While on, the pet window cannot be dragged off-screen and is re-clamped when displays change.' }
      ]
    },
    {
      id: 'sound', zh: '声音与通知', en: 'Sound & notifications',
      items: [
        { k: 'muted', t: 'switch', d: false,
          zh: '静音', en: 'Mute',
          nzh: '关闭全部音效', nen: 'Turn off all sound effects' },
        { k: 'volume', t: 'range', d: 70, min: 0, max: 100, step: 5, fmt: 'pct',
          blockedBy: 'muted',
          zh: '音量', en: 'Volume' },
        { k: 'voice', t: 'switch', d: true,
          zh: '喵叫声', en: 'Meow sounds',
          nzh: '猫冒气泡时同步播放叫声（「静音」与「音量」对它同样生效）', nen: 'Play a meow with speech bubbles (follows mute and volume)' },
        { k: 'voiceVolume', t: 'range', d: 100, min: 0, max: 100, step: 5, fmt: 'pct',
          requires: 'voice',
          zh: '叫声音量', en: 'Meow volume',
          nzh: '只调喵叫声的响度（与「音量」相乘），拖动后点「应用」立即生效', nen: 'Loudness of meows only (multiplied by master volume). Click Apply to take effect immediately.' },
        { k: 'bubbles', t: 'switch', d: true,
          zh: '气泡提示', en: 'Speech bubbles',
          nzh: '显示宠物说话气泡', nen: 'Show the pet’s speech bubbles' },
        { k: 'bubbleDuration', t: 'range', d: 2200, min: 1200, max: 6000, step: 200, fmt: 'ms',
          blockedBy: 'bubbles',
          zh: '气泡停留时长', en: 'Bubble duration' },
        { k: 'notifications', t: 'switch', d: false,
          zh: '系统通知', en: 'System notifications',
          nzh: '属性过低或长时间无人互动时发送系统通知', nen: 'Notify when needs are low or you have been away',
          hzh: '与「宠物自己喵叫」是两条独立通道：后者始终只在气泡里进行，本项才会弹到系统通知中心。',
          hen: 'Separate from the pet’s own meowing: this one reaches the system notification centre.' },
        { k: 'notifyInterval', t: 'range', d: 30, min: 5, max: 120, step: 5, fmt: 'min',
          requires: 'notifications',
          zh: '通知最短间隔', en: 'Minimum notify interval' }
      ]
    },
    {
      id: 'appear', zh: '外观与主题', en: 'Appearance & theme',
      items: [
        { k: 'theme', t: 'select', d: 'light', opts: ['light', 'dark', 'auto'],
          zh: '主题', en: 'Theme' },
        { k: 'uiScale', t: 'range', d: 100, min: 80, max: 140, step: 10, fmt: 'pct',
          zh: '界面文字缩放', en: 'Text scale',
          hzh: '影响气泡与右键菜单的字号。', hen: 'Affects the font size of bubbles and the context menu.' },
        { k: 'opacity', t: 'range', d: 100, min: 40, max: 100, step: 5, fmt: 'pct',
          zh: '整体不透明度', en: 'Opacity' },
        { k: 'showShadow', t: 'switch', d: true,
          zh: '显示地面阴影', en: 'Ground shadow',
          nzh: '绘制宠物脚下的椭圆阴影', nen: 'Draw the soft ellipse under the pet' },
        { k: 'showParticles', t: 'switch', d: true,
          zh: '显示粒子特效', en: 'Particle effects',
          nzh: '爱心 / 打盹符号 / 星星 / 食物屑等粒子', nen: 'Hearts, Zzz, stars and food crumbs',
          hzh: '关闭后不再发射新粒子，已在场的粒子自然消散。',
          hen: 'When off, no new particles spawn; existing ones fade out naturally.' },
        { k: 'reduceMotion', t: 'switch', d: false,
          zh: '减少动态效果', en: 'Reduce motion',
          nzh: '关闭程序化微动与持续动画，降低处理器占用', nen: 'Stop procedural idle motion to lower CPU usage',
          hzh: '适合低性能设备，或对持续动态效果敏感的用户。',
          hen: 'Useful on low-end machines or if you are sensitive to constant motion.' },
        { k: 'statusPanel', t: 'switch', d: true,
          zh: '状态面板', en: 'Status panel',
          nzh: '在宠物旁展示年龄与属性面板', nen: 'Show the age & stats panel next to the pet' },
        { k: 'agePrecision', t: 'select', d: 'day', opts: ['day', 'month'],
          zh: '年龄显示精度', en: 'Age precision',
          hzh: '状态面板上年龄的显示粒度；未设置出生日期时不显示年龄。',
          hen: 'How precisely the age is shown on the status panel. Age is hidden when no birthday is set.' }
      ]
    },
    {
      id: 'behavior', zh: '行为与活动', en: 'Behaviour',
      items: [
        { k: 'activityLevel', t: 'select', d: 'normal', opts: ['low', 'normal', 'high'],
          zh: '活跃度', en: 'Activity level',
          hzh: '决定待机时的决策间隔与走 / 跑 / 跳的概率分布。',
          hen: 'Sets how often the pet makes a new decision and how likely it is to walk, run or jump.' },
        { k: 'animSpeed', t: 'range', d: 75, min: 20, max: 100, step: 5, fmt: 'pct',
          zh: '动作速度', en: 'Animation speed',
          hzh: '动画播放与走 / 跑移动的整体快慢；可调范围 20%–100%，数值越小动作越慢，改动立即生效。',
          hen: 'Overall speed of animation playback and walking / running; adjustable from 20% to 100%. Lower is slower; applies instantly.' },
        { k: 'callInterval', t: 'range', d: 75, min: 30, max: 300, step: 15, fmt: 'secLong',
          zh: '主动呼喊间隔', en: 'Call interval',
          hzh: '多久无人互动后主动喵叫求关注。', hen: 'How long without interaction before the pet asks for attention.' },
        { k: 'blinkRate', t: 'range', d: 8, min: 0, max: 30, step: 1, fmt: 'times',
          zh: '眨眼频率', en: 'Blink rate',
          hzh: '待机时平均每分钟眨眼几次；每次的实际间隔会随机波动，避免固定周期的机械感。0 = 不眨眼。',
          hen: 'Average blinks per minute while idle; the actual intervals vary randomly. 0 = never blink.' },
        { k: 'restiness', t: 'range', d: 70, min: 0, max: 100, step: 10, fmt: 'pct',
          zh: '趴睡倾向', en: 'Rest tendency',
          hzh: '无人互动时宠物趴着睡觉的概率（0% = 一直活动，100% = 几乎一直睡）；「活跃度」低时会自动更爱睡。',
          hen: 'Chance that the pet naps instead of wandering (0% = always active, 100% = always napping). Lower activity levels nap more.' },
        { k: 'needVoice', t: 'switch', d: true,
          zh: '状态驱动气泡与行为', en: 'Needs drive bubbles & behaviour',
          nzh: '心情/清洁/饱食/体力实时改变气泡与动作', nen: 'The four needs change bubbles and actions in real time',
          hzh: '关闭后四项属性不再影响台词与动作倾向（清洁完全退出），只保留体力 / 饱食的危急保护；用于对照排查。',
          hen: 'When off, needs no longer affect lines or action tendencies (cleanliness drops out entirely); only the critical protection for energy and hunger remains.' },
        { k: 'needSensitivity', t: 'select', d: 'standard', opts: ['relaxed', 'standard', 'strict'],
          requires: 'needVoice',
          zh: '提醒灵敏度', en: 'Alert sensitivity',
          hzh: '整体平移「危险 / 偏低」的触发阈值：宽松更晚提醒，严格更早提醒；不影响「良好」档。',
          hen: 'Shifts the “critical / low” thresholds as a whole: relaxed warns later, strict warns earlier. The “good” tier is unaffected.' }
      ]
    },
    {
      id: 'needs', zh: '状态与成长', en: 'Needs & growth',
      items: [
        { k: 'decayHunger', t: 'select', d: 20, opts: seq(0, 20),
          zh: '饱食下降点数', en: 'Hunger decay',
          hzh: '每 30 分钟下降的点数（换算成匀速下降，面板数值平滑变化）。趴睡时约按 1/3 速度。0 = 不下降。',
          hen: 'Points dropped every 30 minutes (applied as a smooth constant rate). About 1/3 speed while napping. 0 = no decay.' },
        { k: 'decayEnergy', t: 'select', d: 20, opts: seq(0, 20),
          zh: '体力下降点数', en: 'Energy decay',
          hzh: '每 30 分钟下降的点数；睡觉时体力恢复、不受此项影响。0 = 不下降。',
          hen: 'Points dropped every 30 minutes; energy recovers while asleep regardless of this. 0 = no decay.' },
        { k: 'decayHappiness', t: 'select', d: 5, opts: seq(0, 20),
          zh: '心情下降点数', en: 'Mood decay',
          hzh: '每 30 分钟下降的点数；趴睡时心情极缓慢回升。0 = 不下降。',
          hen: 'Points dropped every 30 minutes; mood slowly recovers while napping. 0 = no decay.' },
        { k: 'decayCleanliness', t: 'select', d: 20, opts: seq(0, 20),
          zh: '清洁下降点数', en: 'Cleanliness decay',
          hzh: '每 30 分钟下降的点数。趴睡时更慢；奔跑 / 玩耍时掉得更快。0 = 不下降。',
          hen: 'Points dropped every 30 minutes. Slower while napping; faster while running or playing. 0 = no decay.' },
        { k: 'decayAffinity', t: 'select', d: 3, opts: seq(0, 20),
          zh: '好感下降点数', en: 'Bond decay',
          hzh: '每 30 分钟下降的点数；好感主要靠互动回升，趴睡时不下降。0 = 不下降。',
          hen: 'Points dropped every 30 minutes. Bond mainly recovers through interaction and never drops while asleep. 0 = no decay.' }
      ]
    },
    {
      id: 'ai', zh: 'AI 自言自语', en: 'AI musings',
      items: [
        { k: 'enabled', t: 'switch', d: false,
          zh: '启用 AI 自言自语', en: 'Enable AI musings',
          nzh: '无人打扰时，猫自己开口讲笑话、讲故事、念诗、出谜语、科普猫咪常识',
          nen: 'When idle, the pet speaks up on its own: jokes, stories, poems, riddles and cat facts',
          hzh: '关闭时完全不说话；开启后需要填好 API Key 才能用模型生成（无 Key、断网或 Key 失效时自动改用内置离线语料，不打扰你）。',
          hen: 'Off means no AI speech at all. With a key it uses your model; without one (or when the service is unreachable) it quietly falls back to the built-in offline library.' },
        { k: 'preset', t: 'select', d: 'zhipu',
          opts: ['zhipu', 'siliconflow', 'modelscope', 'dashscope', 'ark', 'deepseek', 'moonshot', 'ollama', 'custom'],
          requires: 'enabled',
          zh: '模型服务', en: 'Provider',
          hzh: '默认智谱 GLM-4-Flash（永久免费、无需充值）。选预设会自动填好接口地址与模型名。其他有免费额度的：硅基流动（Qwen3-8B 永久免费）、魔搭（每天 2000 次）、百炼（每模型 100 万 token / 90 天）、火山方舟（每模型 50 万 token + 每日额度）；本地 Ollama 需先在自己电脑上运行服务。',
          hen: 'Defaults to Zhipu GLM-4-Flash (free, no top-up needed). Presets fill in the endpoint and model name. Other free options: SiliconFlow (Qwen3-8B free), ModelScope (2000 calls/day), Bailian (1M tokens per model / 90 days), Volcengine Ark (500K tokens per model plus daily quota). Local Ollama requires the service running on your machine.' },
        { k: 'baseUrl', t: 'text', d: 'https://open.bigmodel.cn/api/paas/v4', max: 120, requires: 'enabled',
          zh: '接口地址', en: 'API base URL',
          hzh: 'OpenAI 兼容地址，通常以 /v1 结尾（智谱为 /api/paas/v4）。', hen: 'OpenAI-compatible endpoint, usually ending with /v1 (Zhipu uses /api/paas/v4).' },
        { k: 'model', t: 'text', d: 'glm-4-flash', max: 48, requires: 'enabled',
          zh: '模型名称', en: 'Model',
          hzh: '例如 glm-4-flash、Qwen/Qwen3-8B、deepseek-chat、qwen2.5:7b。',
          hen: 'For example glm-4-flash, Qwen/Qwen3-8B, deepseek-chat, qwen2.5:7b.' },
        { k: 'apiKey', t: 'password', d: '', max: 200, requires: 'enabled',
          zh: 'API Key', en: 'API key',
          hzh: '单独加密保存在数据目录，不写入 config.json；输入框留空表示不修改，填入即覆盖。',
          hen: 'Encrypted in the data folder, never written to config.json. Leave blank to keep the current key; typing replaces it.' },
        { k: 'testConn', t: 'action', d: '', act: 'ai-test', requires: 'enabled',
          zh: '连接测试', en: 'Test connection',
          hzh: '发一次极短的请求，确认地址、模型与密钥是否可用。',
          hen: 'Sends one tiny request to verify the endpoint, model and key.' },
        { k: 'sayNow', t: 'action', d: '', act: 'ai-say',
          zh: '现在讲一段', en: 'Speak now',
          hzh: '立刻让猫讲一段（随机类型），用于试听节奏与音色。',
          hen: 'Have the pet speak right away (random type) to try the pacing.' },
        { k: 'autoTalk', t: 'select', d: 'normal', opts: ['off', 'rare', 'normal', 'often'],
          requires: 'enabled',
          zh: '自主频率', en: 'How often',
          hzh: '多久没人理它时自己讲一段：经常 1–2 分钟、平常 2–5 分钟、偶尔 5–10 分钟；深夜自动减半。',
          hen: 'How often it speaks up when left alone: often 1–2 min, normally 2–5 min, rarely 5–10 min. Halved late at night.' },
        { k: 'speech', t: 'select', d: 'purr', opts: ['off', 'purr', 'tts'],
          zh: '说话的声音', en: 'Voice',
          hzh: '「喵语节奏」每段首句配一声轻喵；「朗读」用系统语音念完整段；「静音」只显示气泡。',
          hen: 'Purr adds one soft meow per segment; Read-aloud uses the system voice; Silent shows bubbles only.' },
        { k: 'speechRate', t: 'range', d: 100, min: 80, max: 140, step: 10, fmt: 'pct',
          requires: 'speech', requiresIn: ['tts'],
          zh: '朗读语速', en: 'Reading speed',
          hzh: '仅「朗读」模式生效；系统没有中文语音时该项会自动禁用。',
          hen: 'Applies to read-aloud only; disabled automatically when no Chinese voice is installed.' },
        { k: 'bubblePace', t: 'select', d: 'normal', opts: ['fast', 'normal', 'slow'],
          zh: '句子节奏', en: 'Bubble pace',
          hzh: '每句话在气泡里停留多久：舒缓 ×1.35、标准 ×1、轻快 ×0.75。',
          hen: 'How long each sentence stays on screen: slow ×1.35, normal ×1, fast ×0.75.' }
      ]
    },
    {
      id: 'data', zh: '数据与存储', en: 'Data & storage',
      items: [
        { k: 'dataDir', t: 'path', d: '', sec: 'restart',
          zh: '数据存储位置', en: 'Data folder',
          hzh: '切换目录后需要重启应用；选择新目录时会先复制数据再切换，失败自动回滚、不删除原数据。',
          hen: 'Changing the folder requires a restart. Data is copied before switching; on failure it rolls back.' },
        { k: 'autoSave', t: 'switch', d: true,
          zh: '自动保存进度', en: 'Auto-save progress',
          nzh: '定期把位置与属性写盘', nen: 'Periodically save position and needs to disk' },
        { k: 'saveInterval', t: 'range', d: 5, min: 5, max: 120, step: 5, fmt: 'sec',
          requires: 'autoSave',
          zh: '保存间隔', en: 'Save interval' },
        { k: 'autoBackup', t: 'switch', d: true,
          zh: '自动备份', en: 'Auto backup',
          nzh: '每次写入前保留一份配置快照', nen: 'Keep a config snapshot before every write',
          hzh: '配置损坏时可从快照恢复，避免设置与属性全部丢失。',
          hen: 'Lets you recover from a corrupted config instead of losing all settings.' },
        { k: 'backupKeep', t: 'select', d: 3, opts: [1, 2, 3, 5, 10],
          requires: 'autoBackup',
          zh: '备份保留份数', en: 'Backups kept' }
      ]
    }
  ];

  var ITEMS = {};
  GROUPS.forEach(function (g) {
    g.items.forEach(function (it) { ITEMS[it.k] = it; });
  });

  /* ---------------- 默认值（分组结构） ---------------- */

  /** runtime.stats 字段规格：[键, 默认值]，除 xp 外均夹紧到 0–100 */
  var STATS_SPEC = [
    ['hunger', 80], ['energy', 80], ['happiness', 80],
    ['cleanliness', 80], ['affinity', 10], ['xp', 0],
  ];

  function defaults() {
    var c = {
      configVersion: CONFIG_VERSION,
      runtime: {
        x: null, y: null,
        stats: { hunger: 80, energy: 80, happiness: 80, cleanliness: 80, affinity: 10, xp: 0 },
      },
    };
    GROUPS.forEach(function (g) {
      var o = {};
      g.items.forEach(function (it) { o[it.k] = it.d; });
      c[g.id] = o;
    });
    // 界面语言固定中文（不在设置页提供切换项）
    c.appear.language = 'zh-CN';
    return c;
  }

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------------- 校验与夹紧 ---------------- */

  function clampNum(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /** 按字段定义把任意值转成合法值；返回 [值, 是否被修正] */
  function coerce(it, v) {
    if (it.t === 'switch') {
      if (typeof v === 'boolean') return [v, false];
      if (v === 'true' || v === 1) return [true, true];
      if (v === 'false' || v === 0 || v == null) return [!!it.d, true];
      return [!!v, true];
    }
    if (it.t === 'range') {
      var n = typeof v === 'number' ? v : parseFloat(v);
      if (!isFinite(n)) return [it.d, true];
      var stepped = it.step ? Math.round(n / it.step) * it.step : n;
      var c = clampNum(stepped, it.min, it.max);
      // 消除浮点误差（0.62*100 之类）
      c = Math.round(c * 1e6) / 1e6;
      return [c, Math.abs(c - v) > 1e-9];
    }
    if (it.t === 'select') {
      var match = null;
      for (var oi = 0; oi < it.opts.length; oi++) {
        if (String(it.opts[oi]) === String(v)) { match = it.opts[oi]; break; }
      }
      // 返回枚举中的规范值（例如字符串 "5" → 数字 5）
      return [match !== null ? match : it.d, match !== v];
    }
    if (it.t === 'password') {
      // 密钥永不进 config.json：无论文件里写了什么都归零，真实值存 ai-secret.bin
      return ['', v !== '' && v != null];
    }
    if (it.t === 'action') {
      return ['', false];
    }
    if (it.t === 'text') {
      var s = String(v == null ? '' : v)
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim();
      if (!it.allowEmpty && !s) return [it.d, true];
      if (s.length > it.max) return [s.slice(0, it.max), true];
      return [s, s !== v];
    }
    if (it.t === 'path') {
      return [v == null ? it.d : String(v), false];
    }
    if (it.t === 'date') {
      var s = String(v == null ? '' : v).trim();
      if (!s) return ['', s !== v];
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (!m) return [it.d, true];
      var y = +m[1], mo = +m[2], da = +m[3];
      var dt = new Date(y, mo - 1, da);
      var valid = dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === da;
      if (!valid) return [it.d, true];
      // 不允许未来日期（按本地时区当天 0 点比较）
      var today = new Date(); today.setHours(0, 0, 0, 0);
      if (dt > today) return [it.d, true];
      return [s, s !== v];
    }
    return [v, false];
  }

  function coerceStats(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var out = {};
    STATS_SPEC.forEach(function (s) {
      var n = typeof src[s[0]] === 'number' ? src[s[0]] : parseFloat(src[s[0]]);
      var hi = s[0] === 'xp' ? 9999999 : 100;
      var v = isFinite(n) ? clampNum(n, 0, hi) : s[1];
      out[s[0]] = Math.round(v * 100) / 100;
    });
    return out;
  }

  /**
   * 归一化：从默认值出发，逐字段按 schema 转换/夹紧；
   * 未知字段原样保留（向前兼容）。返回 { config, issues }。
   */
  function normalize(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var cfg = defaults();
    var issues = [];

    GROUPS.forEach(function (g) {
      var gs = src[g.id];
      if (!gs || typeof gs !== 'object') return;
      g.items.forEach(function (it) {
        if (!(it.k in gs)) return;
        var r = coerce(it, gs[it.k]);
        cfg[g.id][it.k] = r[0];
        if (r[1]) issues.push(g.id + '.' + it.k);
      });
      // 未知字段保留
      Object.keys(gs).forEach(function (k) {
        if (!(k in cfg[g.id])) cfg[g.id][k] = gs[k];
      });
    });

    if (src.runtime && typeof src.runtime === 'object') {
      if (Number.isFinite(src.runtime.x)) cfg.runtime.x = src.runtime.x;
      if (Number.isFinite(src.runtime.y)) cfg.runtime.y = src.runtime.y;
      if (src.runtime.stats) cfg.runtime.stats = coerceStats(src.runtime.stats);
    }
    // 兼容旧版扁平 stats/x/y（migrate 后可能残留）
    if (!src.runtime && src.stats) cfg.runtime.stats = coerceStats(src.stats);

    // 界面语言固定中文：无论存量配置里存了什么（含已废弃的 en-US），一律归一
    cfg.appear.language = 'zh-CN';
    cfg.configVersion = CONFIG_VERSION;
    return { config: cfg, issues: issues };
  }

  /** v1（扁平结构）→ v2（分组结构）；size 缺省为新基准体型 */
  function migrateLegacy(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var g = {
      pet: { petName: '小银', ownerName: '主人', size: 0.88 },
      startup: { autoStart: false, startHidden: true, rememberPosition: true },
      interact: { clickThrough: false, wheelZoom: true, hotkeyCall: 'Ctrl+Shift+C', trayDoubleClickCall: true },
      sound: { muted: false, volume: 70, bubbles: true, bubbleDuration: 2200, notifications: false, notifyInterval: 30 },
      appear: { theme: 'light', language: 'zh-CN', uiScale: 100, opacity: 100, showShadow: true, showParticles: true, reduceMotion: false },
      behavior: { activityLevel: 'normal', callInterval: 75 },
      data: { dataDir: '', autoSave: true, saveInterval: 5, autoBackup: true, backupKeep: 3 },
      runtime: { x: null, y: null, stats: { hunger: 80, energy: 80, happiness: 80, cleanliness: 80, affinity: 10, xp: 0 } },
    };
    if ('size' in s) g.pet.size = s.size;
    if ('autoStart' in s) g.startup.autoStart = !!s.autoStart;
    if ('muted' in s) g.sound.muted = !!s.muted;
    if ('clickThrough' in s) g.interact.clickThrough = !!s.clickThrough;
    if (s.stats) g.runtime.stats = coerceStats(s.stats);
    if (Number.isFinite(s.x)) g.runtime.x = s.x;
    if (Number.isFinite(s.y)) g.runtime.y = s.y;
    return g;
  }

  /**
   * v2 → v3：宠物窗口由 480×480 放大到 640×640（容纳最大体型与旁侧状态面板）。
   * 窗口原点按锚点差平移，保证「猫在屏幕上的位置」不因窗口变大而跳动：
   *   锚点 = (窗宽/2, 地面线) 旧 (240, 402) → 新 (320, 588)
   */
  function migrateV2toV3(raw) {
    var c = deepClone(raw && typeof raw === 'object' ? raw : {});
    if (c.runtime && typeof c.runtime === 'object') {
      if (Number.isFinite(c.runtime.x)) c.runtime.x = Math.round(c.runtime.x - 80);
      if (Number.isFinite(c.runtime.y)) c.runtime.y = Math.round(c.runtime.y - 186);
    }
    c.configVersion = CONFIG_VERSION;
    return c;
  }

  /**
   * v6 → v7：默认模型服务由 DeepSeek 换成智谱 GLM-4-Flash（免费，无需充值）。
   * 只跟随「从没启用过 + 仍是旧默认值」的配置，绝不覆盖用户自己的选择或已配好的 Key。
   */
  var OLD_AI_DEFAULT = { preset: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };

  function migrateV6toV7(raw) {
    var c = deepClone(raw && typeof raw === 'object' ? raw : {});
    var ai = c.ai;
    var untouched = ai && typeof ai === 'object'
      && ai.enabled !== true
      && ai.baseUrl === OLD_AI_DEFAULT.baseUrl
      && ai.model === OLD_AI_DEFAULT.model
      && (!ai.preset || ai.preset === OLD_AI_DEFAULT.preset);
    if (untouched) {
      ai.preset = 'zhipu';
      ai.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
      ai.model = 'glm-4-flash';
    }
    c.configVersion = CONFIG_VERSION;
    return c;
  }

  /**
   * v7 → v8：「状态与成长」由 5 条百分比滑杆重构为两个下拉框
   * （每 N 分钟下降 M 点，N 0–60 / M 0–20，默认 30 分钟 20 点）。
   * 旧倍率按 20 点基准换算：150% → 30 → 夹到 20；0% → 0（保留「不下降」意图）；
   * 100%（默认）不改动、直接落新默认值。旧键从配置中移除。
   */
  var OLD_DECAY_KEYS = ['hungerDecay', 'energyDecay', 'happinessDecay', 'cleanlinessDecay', 'affinityDecay'];

  function migrateV7toV8(raw) {
    var c = deepClone(raw && typeof raw === 'object' ? raw : {});
    var needs = c.needs && typeof c.needs === 'object' ? c.needs : null;
    if (needs) {
      var old = Number(needs.hungerDecay);
      if (Number.isFinite(old) && old !== 100) {
        needs.decayPoints = Math.min(20, Math.max(0, Math.round(20 * old / 100)));
      }
      OLD_DECAY_KEYS.forEach(function (k) { delete needs[k]; });
    }
    c.configVersion = CONFIG_VERSION;
    return c;
  }

  /**
   * v8 → v9：① 界面语言项下线（normalize 强制 zh-CN，无需迁移数据）；
   * ② 动作速度默认 85% → 75%——旧默认值 85 跟随新默认，用户自定值保留；
   * ③ AI 自主频率整体提前（often 3–8min → 1–2min 等，选项枚举不变，仅换算间隔）。
   */
  function migrateV8toV9(raw) {
    var c = deepClone(raw && typeof raw === 'object' ? raw : {});
    if (c.behavior && typeof c.behavior === 'object' && c.behavior.animSpeed === 85) {
      c.behavior.animSpeed = 75;
    }
    c.configVersion = CONFIG_VERSION;
    return c;
  }

  /**
   * v9 → v10：「状态与成长」由统一双下拉框（每 N 分钟下降 M 点）
   * 重构为 5 个独立下拉框（每种属性各自「每 30 分钟下降 X 点」，
   * 默认饱食/体力/清洁/好感 20 点、心情 5 点）。
   * 旧值换算：每 30 分钟点数 = round(M × 30 / N)（N≤0 → 0，保留「不下降」意图），
   * 夹到 0–20。旧默认值（30 分钟 / 20 点）按「未定制」处理，跟随新默认
   * （心情 5 点，其余 20 点）。旧键 decayMinutes / decayPoints 移除。
   */
  var DECAY_KEYS = ['decayHunger', 'decayEnergy', 'decayHappiness', 'decayCleanliness', 'decayAffinity'];
  var DECAY_DEFAULTS = { decayHunger: 20, decayEnergy: 20, decayHappiness: 5, decayCleanliness: 20, decayAffinity: 3 };

  function migrateV9toV10(raw) {
    var c = deepClone(raw && typeof raw === 'object' ? raw : {});
    var needs = c.needs && typeof c.needs === 'object' ? c.needs : null;
    if (needs) {
      // v7/v8 链式迁移的配置可能缺 decayMinutes（v8 默认 30），缺席按 30 处理
      var mins = Number.isFinite(Number(needs.decayMinutes)) ? Number(needs.decayMinutes) : 30;
      var pts = Number.isFinite(Number(needs.decayPoints)) ? Number(needs.decayPoints) : 20;
      var untouched = mins === 30 && pts === 20;   // 从没动过统一设置 → 跟随新默认
      var per30 = null;
      if (!untouched) {
        if (mins <= 0 || pts <= 0) {
          per30 = 0;                               // 原来就是不下降 → 全部 0
        } else {
          per30 = Math.min(20, Math.max(0, Math.round(pts * 30 / mins)));
        }
      }
      DECAY_KEYS.forEach(function (k) {
        if (!(k in needs)) needs[k] = untouched ? DECAY_DEFAULTS[k] : per30;
      });
      delete needs.decayMinutes;
      delete needs.decayPoints;
    }
    // 1.9.9 下线的固定行为项：从存量配置中一并清除（行为已固化为恒开 / 恒关）
    var RETIRED = [
      ['pet', 'showNameInBubble'], ['startup', 'singleInstance'],
      ['appear', 'closePanelOnBlur'], ['appear', 'showBubbles'],
      ['behavior', 'allowSleep'], ['behavior', 'allowRun'], ['behavior', 'allowBath'],
      ['ai', 'dailyLimit'], ['ai', 'affectPet'],
    ];
    RETIRED.forEach(function (r) {
      if (c[r[0]] && typeof c[r[0]] === 'object') delete c[r[0]][r[1]];
    });
    c.configVersion = CONFIG_VERSION;
    return c;
  }

  /**
   * v10 → v11：好感衰减默认值由 20 点 / 30 分钟下调为 3 点 / 30 分钟
   * （好感主要靠互动回升，20 点的默认掉速偏快）。
   * 只收敛历史默认值：20（v9→v10 的默认）与 5（早期迁移/试跑产出的默认）→ 3；
   * 用户自定的其他值（如 10、15）原样保留。
   */
  function migrateV10toV11(raw) {
    var c = deepClone(raw && typeof raw === 'object' ? raw : {});
    var needs = c.needs && typeof c.needs === 'object' ? c.needs : null;
    if (needs && 'decayAffinity' in needs) {
      var v = Number(needs.decayAffinity);
      if (v === 20 || v === 5) needs.decayAffinity = 3;
    }
    c.configVersion = CONFIG_VERSION;
    return c;
  }

  /** 读取入口：自动识别版本并迁移 */
  function load(raw) {
    if (raw && typeof raw === 'object') {
      if (raw.configVersion >= CONFIG_VERSION) return normalize(raw);
      if (raw.configVersion === 10) return normalize(migrateV10toV11(raw));
      if (raw.configVersion === 2) return normalize(migrateV10toV11(migrateV9toV10(migrateV8toV9(migrateV2toV3(raw)))));
      // v3 → v4 / v4 → v5 / v5 → v6：仅新增字段，normalize 从默认值出发自动补齐
      // （统一先过 migrateV8toV9：旧默认 animSpeed 85 跟随新默认 75）
      if (raw.configVersion >= 3 && raw.configVersion <= 5) return normalize(migrateV10toV11(migrateV9toV10(migrateV8toV9(raw))));
      // v6 → v7：ai 组默认服务 DeepSeek → 智谱；v7 → v8：「状态与成长」双下拉框；
      // v8 → v9：语言项下线 + 动作速度默认 75 + AI 频率整体提前；
      // v9 → v10：状态与成长改为每属性独立设置；v10 → v11：好感默认 20 → 3
      if (raw.configVersion === 6) return normalize(migrateV10toV11(migrateV9toV10(migrateV8toV9(migrateV7toV8(migrateV6toV7(raw))))));
      if (raw.configVersion === 7) return normalize(migrateV10toV11(migrateV9toV10(migrateV8toV9(migrateV7toV8(raw)))));
      if (raw.configVersion === 8) return normalize(migrateV10toV11(migrateV9toV10(migrateV8toV9(raw))));
      if (raw.configVersion === 9) return normalize(migrateV10toV11(migrateV9toV10(raw)));
    }
    return normalize(migrateLegacy(raw));
  }

  /* ---------------- 补丁合并 ---------------- */

  /** 深合并补丁（仅覆盖补丁中出现的键），返回全新对象 */
  function mergePatch(config, patch) {
    var out = deepClone(config);
    if (!patch || typeof patch !== 'object') return out;
    Object.keys(patch).forEach(function (k) {
      if (k === 'configVersion') return;
      if (k === 'runtime') {
        var rt = patch.runtime || {};
        if (Number.isFinite(rt.x)) out.runtime.x = rt.x;
        if (Number.isFinite(rt.y)) out.runtime.y = rt.y;
        if (rt.stats) out.runtime.stats = Object.assign({}, out.runtime.stats, coerceStats(rt.stats));
        return;
      }
      var v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
        Object.keys(v).forEach(function (kk) { out[k][kk] = v[kk]; });
      } else {
        out[k] = v;
      }
    });
    return normalize(out).config;
  }

  /** 比较两个配置，返回发生变化的 'group.key' 路径列表 */
  function changedPaths(a, b) {
    var out = [];
    GROUPS.forEach(function (g) {
      g.items.forEach(function (it) {
        if (JSON.stringify(a[g.id][it.k]) !== JSON.stringify(b[g.id][it.k])) {
          out.push(g.id + '.' + it.k);
        }
      });
    });
    ['x', 'y'].forEach(function (k) {
      if (a.runtime[k] !== b.runtime[k]) out.push('runtime.' + k);
    });
    if (JSON.stringify(a.runtime.stats) !== JSON.stringify(b.runtime.stats)) {
      out.push('runtime.stats');
    }
    return out;
  }

  return {
    CONFIG_VERSION: CONFIG_VERSION,
    GROUPS: GROUPS,
    ITEMS: ITEMS,
    defaults: defaults,
    deepClone: deepClone,
    coerce: coerce,
    normalize: normalize,
    migrateLegacy: migrateLegacy,
    load: load,
    mergePatch: mergePatch,
    changedPaths: changedPaths,
  };
});
