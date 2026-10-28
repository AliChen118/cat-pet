/**
 * renderer.js — 渲染进程主逻辑
 * 职责：状态机装配、物理、自主行为决策、用户交互、粒子与绘制循环。
 * 配置：消费分组结构（engine/config-schema.js），文案来自 engine/i18n.js；
 *       所有设置项通过主进程 config-changed 广播实时生效。
 */
'use strict';

(() => {
  /* ================= 基础常量 ================= */

  const W = 640;
  const H = 640;
  const GROUND = 588;              // 猫的落地点（窗口内 y）
  const SPRITE_HALF_W = 253;       // 素材最宽帧半宽（实测 walk_3 左缘，sprite 像素）
  const GRAVITY = 1900;            // px/s^2
  const WALK_SPEED = 95;           // px/s
  const RUN_SPEED = 235;           // px/s

  /* ---- 体型缩放边界（与 config-schema 中 size 字段范围一致） ---- */
  const BASE_SCALE = 0.62;         // 设计基准体型（阴影/命中区半径按此实测，仅作比例参考）
  const SIZE_100 = 0.88;           // 显示 100% 的基准体型（配置里的 size 值 = 100%，也是上限）
  const SIZE_MIN_PCT = 20;         // 体型下限 20%
  const SIZE_MAX_PCT = 100;        // 体型上限 100%
  const SIZE_STEP_PCT = 5;         // 滚轮/滑杆每格 5%（与 schema 的 step 对齐，避免回写时跳变）
  const MIN_SCALE = SIZE_100 * SIZE_MIN_PCT / 100;   // 0.176 → 显示 20%
  const MAX_SCALE = SIZE_100 * SIZE_MAX_PCT / 100;   // 0.88  → 显示 100%
  const SCALE_STEP = SIZE_100 * SIZE_STEP_PCT / 100; // 0.044 → 每格 5%

  /* ---- 状态面板避让（面板贴猫身左/右侧，猫与气泡不得压到面板上） ---- */
  const PANEL_INSET = 8;           // 面板窗口内左右留白（与 status-panel.html 一致）
  const PANEL_GAP = 12;            // 面板内容边缘与猫身边缘的间距

  /* ---- 阴影圆盘（与宠物同比缩放） ---- */
  const SHADOW_RX = 92;            // 设计基准体型下的阴影半长轴
  const SHADOW_RY = 17;            // 设计基准体型下的阴影半短轴
  const SHADOW_LIFT = 280;         // 起跳多高时阴影淡至最小
  const SHADOW_ALPHA = 0.15;       // 落地时的阴影不透明度

  /**
   * 阴影的姿态体积修正：各姿态身体占地在 269–465 px 之间浮动（±27%），
   * 固定半径的阴影会在 run/walk 这种铺平的姿态下明显偏小（猫像浮在影子上），
   * 在 sleep 蜷起来时又偏大。
   *
   * 系数 = sqrt(该姿态腐蚀核心面积均值 / idle)，由 tools/sprites/sprite_bounds.py
   * 生成（跑一次即输出，改素材后必须重新生成）。范围 0.95–1.18，无需夹取。
   */
  const POSE_SHADOW_K = {
    idle: 1.000, walk: 0.946, run: 0.961, jump: 1.041, stretch: 0.961,
    drag: 1.010, sleep: 0.965, eat: 0.967, play: 1.032, pet: 0.998,
    meow: 1.011, tailwag: 1.066, unhappy: 1.000, bath: 1.036, lick: 1.029,
  };

  /* ---- 气泡定位（紧贴猫头顶，尺寸固定、不随体型缩放） ---- */
  const SPRITE_GROUND_Y = 470;     // 素材基线，与 engine/animator.js 保持一致
  const BUBBLE_GAP = 2;            // 尖角末端与猫头顶的间距（贴近宠物）
  const BUBBLE_TAIL = 6;           // 尖角伸出高度（与 index.html 中 ::after 的 bottom 一致）
  /* 气泡最长存活（秒）。正常收尾靠 showBubble / aiShow 各自的定时器，
     这里是兜底：AI 单句最多停留 8s（ai-talk 的 holdFor 上限），超过 20s 仍挂着
     必定是某条路径只取消了定时器、没摘 .show —— 那种气泡会一直停到下次说话。 */
  const BUBBLE_MAX_LIFE = 20;
  const HEAD_SMOOTH = 0.0004;      // 头顶高度的指数平滑系数（抑制帧序列带来的抖动）

  /* ---- 活跃度 → 决策间隔与行为概率 ----
   * idle 是「主状态」：三档里 idle 的权重都排第一（low 0.55 / normal 0.42 / high 0.30），
   * 走跑只作点缀——low 几乎不动、normal 偶发、high 才有明显跑动。
   * 每档权重和恒为 1.00，与 needs-profile 的档位乘子相乘后再归一到 1；
   * 末尾 meow 吃掉余量，保证加权随机永远不会掉进空档。
   */
  const ACTIVITY = {
    low:    { think: [4.5, 9.0], idle: 0.55, walk: 0.22, run: 0.05, jump: 0.05, stretch: 0.06, meow: 0.03, tailwag: 0.04 },
    normal: { think: [2.2, 5.5], idle: 0.42, walk: 0.24, run: 0.11, jump: 0.08, stretch: 0.07, meow: 0.03, tailwag: 0.05 },
    high:   { think: [1.2, 3.2], idle: 0.30, walk: 0.26, run: 0.16, jump: 0.11, stretch: 0.07, meow: 0.03, tailwag: 0.07 },
  };

  /* ---- 属性驱动的限流与中断参数（详见 docs/03-behavior.md §九） ---- */
  const AUTO_BUBBLE_CD = 5;      // 自主气泡全局冷却（秒）
  const SETTLE_GUARD = 1.2;      // 交互结算台词保护窗口（秒）
  const NEED_WARN_CD = 90;       // 同一属性的「常规提醒」冷却（秒）
  const NEED_CRIT_CD = 45;       // 危急档提醒冷却（比常规更勤，饥饿/疲惫不该被憋住）
  const NEED_REACT_CD = 20;      // 跨档即时反应的冷却（秒/属性）
  const URGENT_CD = 8;           // 同一需求的紧急中断冷却（秒）
  const LAND_DIP = 13;           // 落地「下蹲位移」幅度系数（squash 0.45 × 13 ≈ 6px，不改尺寸）
  const GOOD_BUBBLE_CD = 200;    // 正向（good 档）气泡冷却（秒）
  const GOOD_BUBBLE_PROB = 0.06; // 正向气泡触发概率

  /** 可被危急需求打断的状态（sleep 与全部交互/物理动作都不可打断） */
  const INTERRUPTIBLE = { idle: true, walk: true, meow: true, tailwag: true, unhappy: true, lick: true };

  /* ---- 姿态资源：单图为 [path]，多帧为帧序列 + 帧率 ---- */
  const SPRITE_FILES = {
    idle: [
      'assets/sprites/frames/idle_1.png',
      'assets/sprites/frames/idle_2.png',
      'assets/sprites/frames/idle_3.png',
      'assets/sprites/frames/idle_4.png',
    ],
    walk: [
      'assets/sprites/frames/walk_1.png',
      'assets/sprites/frames/walk_2.png',
      'assets/sprites/frames/walk_3.png',
      'assets/sprites/frames/walk_4.png',
    ],
    run: [
      'assets/sprites/frames/run_1.png',
      'assets/sprites/frames/run_2.png',
      'assets/sprites/frames/run_3.png',
      'assets/sprites/frames/run_4.png',
    ],
    jump: [
      'assets/sprites/frames/jump_1.png',
      'assets/sprites/frames/jump_2.png',
      'assets/sprites/frames/jump_3.png',
    ],
    stretch: [
      'assets/sprites/frames/stretch_1.png',
      'assets/sprites/frames/stretch_2.png',
      'assets/sprites/frames/stretch_3.png',
    ],
    drag: ['assets/sprites/drag.png'],
    sleep: [
      'assets/sprites/frames/sleep_1.png',
      'assets/sprites/frames/sleep_2.png',
      'assets/sprites/frames/sleep_3.png',
    ],
    // eat_1/2/3 三帧几乎完全重合（相邻帧 IoU 0.99 / 0.98，bbox 同为 313 宽），
    // 真正有区别的只有 eat_4。保留 4 帧等于「停 3 帧再换 1 帧」的顿挫，
    // 这里只播两个有效关键帧并放慢到 4 fps，得到均匀的 2 Hz 咀嚼节奏。
    eat: [
      'assets/sprites/frames/eat_1.png',
      'assets/sprites/frames/eat_4.png',
    ],
    play: [
      'assets/sprites/frames/play_1.png',
      'assets/sprites/frames/play_2.png',
      'assets/sprites/frames/play_3.png',
      'assets/sprites/frames/play_4.png',
    ],
    pet: [
      'assets/sprites/frames/pet_1.png',
      'assets/sprites/frames/pet_2.png',
      'assets/sprites/frames/pet_3.png',
    ],
    meow: [
      'assets/sprites/frames/meow_1.png',
      'assets/sprites/frames/meow_2.png',
      'assets/sprites/frames/meow_3.png',
    ],
    tailwag: [
      'assets/sprites/frames/tailwag_1.png',
      'assets/sprites/frames/tailwag_2.png',
      'assets/sprites/frames/tailwag_3.png',
      'assets/sprites/frames/tailwag_4.png',
    ],
    unhappy: [
      'assets/sprites/frames/unhappy_1.png',
      'assets/sprites/frames/unhappy_2.png',
    ],
    bath: [
      'assets/sprites/frames/bath_1.png',
      'assets/sprites/frames/bath_2.png',
      'assets/sprites/frames/bath_3.png',
      'assets/sprites/frames/bath_4.png',
      'assets/sprites/frames/bath_5.png',
      'assets/sprites/frames/bath_6.png',
    ],
    lick: [
      'assets/sprites/frames/lick_1.png',
      'assets/sprites/frames/lick_2.png',
      'assets/sprites/frames/lick_3.png',
      'assets/sprites/frames/lick_4.png',
    ],
  };

  /* ---- 各姿态帧率：呼吸/睡/伸懒腰慢，玩耍/喵叫轻快，走跑最快 ---- */
  const SPRITE_FPS = {
    walk: 11, run: 13, tailwag: 7, unhappy: 2,
    idle: 5, eat: 4, play: 8, pet: 6, jump: 5, stretch: 5, sleep: 4, meow: 7,
    bath: 6, lick: 5,
  };

  /* ---- 舔爪子节奏：5 fps 基础帧 + 主帧（lick_2 舔舐）额外停留 150 ms ----
   * 舔毛是慢节奏动作，比 eat（6 fps）更慢；主帧停留接近基础帧的 1.75 倍，
   * 让「舔」那一下有真正的停留感。单轮 ≈ 0.95 s。 */
  const LICK_FPS = 5;
  const LICK_HOLD = 0.15;
  const LICK_FRAME_COUNT = 4;
  const LICK_CYCLE = LICK_FRAME_COUNT / LICK_FPS + LICK_HOLD;   // 单轮 ≈ 0.95 s
  const LICK_ROUNDS_EAT = 2;        // 进食结束固定播 2 轮（≈ 1.90 s）
  const LICK_CD = 90;               // 空闲触发的硬冷却（秒）
  const LICK_PROB = 0.05;           // 每个决策点的命中概率
  const LICK_HOLD_MAP = { 1: 1 / LICK_FPS + LICK_HOLD };   // 帧索引 1 = lick_2
  /* 收尾提前量：状态切换发生在 animator.update 之前，而帧推进恰好也在同一时刻
   * 环回到 lick_1（抬爪）。若不提前结束，淡出期最后一帧会闪回「抬爪」，看着像残影。
   * 取半帧（1/5 ÷ 2 = 0.1 s）——末轮 lick_4 少显示 100 ms 无感，但收爪姿态收得住。 */
  const LICK_END_TRIM = 0.1;

  /* ---- 走/跑：最少 2 个完整循环 + 只在循环首帧收尾 ----
   * 走 4 帧 @11fps = 0.364 s/轮 → 2 轮 0.727 s；跑 4 帧 @13fps = 0.308 s/轮 → 2 轮 0.615 s。
   * 轮数由 animator.laps 在「环回首帧」时累加，走的是动画时间（动效速度倍率不影响判定）。 */
  const WALK_CYCLE = 4 / SPRITE_FPS.walk;
  const RUN_CYCLE = 4 / SPRITE_FPS.run;
  const WALK_MIN_LOOPS = 2;
  const RUN_MIN_LOOPS = 2;
  const WALK_MIN_TIME = WALK_CYCLE * WALK_MIN_LOOPS;    // 0.727 s
  const RUN_MIN_TIME = RUN_CYCLE * RUN_MIN_LOOPS;       // 0.615 s
  /* 自由漫游的最小目标距离 = 正常步速 × 最少时长。
   * 低于它就把步速按「距离 / 时长」反算放慢，保证到达时正好走满 2 轮，且不会走过头。 */
  const WALK_MIN_DIST = Math.ceil(WALK_SPEED * WALK_MIN_TIME);   // 70 px
  const RUN_MIN_DIST = Math.ceil(RUN_SPEED * RUN_MIN_TIME);      // 145 px
  /* 比这更近视为「已经在目标点」（喂食碗/光标落在脚边）：不播走动，直接进后续动作 */
  const WALK_SKIP_DIST = 24;
  const RUN_SKIP_DIST = 40;
  const RUN_SLOW_FLOOR = 0.65;   // 跑速放慢下限，仍要像「跑」而不是「挪」

  /* ================= 运行时状态 ================= */

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const bubbleEl = document.getElementById('bubble');
  const menuEl = document.getElementById('menu');

  const animator = new Animator();
  const particles = new Particles();

  const pet = {
    x: W / 2,
    y: 0,                 // 距地面高度，负值表示在空中
    vx: 0,
    vy: 0,
    facing: 1,
    scale: BASE_SCALE,
    onGround: true,
    stats: { hunger: 80, energy: 80, happiness: 80 },
    targetX: null,
    afterWalk: null,
    walkSpeed: WALK_SPEED,
    runSpeed: RUN_SPEED,
    walkSkip: false,
    eatTimer: 0,
    playTimer: 0,
    meowTimer: 0,
    sleepTimer: 0,
    stretchTimer: 0,
    bathTimer: 0,
    foamTimer: 0,
    lickEnd: 0,        // 舔爪结束时刻（animator.clock 域，非线性墙钟）
    lickRounds: 0,
    lastLickAt: -Infinity,
    tailwagEnd: 0,     // 摇尾巴结束时刻（同上，挂在动画时钟上）
    pendingAfterStretch: null,
  };

  let time = 0;
  let animTime = 0;           // 动画时间轴（受动作速度设置缩放，仅驱动动画与位移）
  let squash = 0;             // 落地「下蹲位移」量（位移缓冲，不改尺寸），随时间衰减
  let food = null;            // { x } 地面上的食碗

  /**
   * 姿态级显示缩放表：素材逐姿态生成，猫的体格存在比例漂移，
   * 切姿态时会看到猫「突然变大/变小」。这里按 idle 基准逐姿态校正，
   * 锚点仍为素材 (256,470)（脚底贴地、躯干居中），不影响站位与阴影。
   *
   * ⚠ 这张表现在是空的：全部 15 个姿态的比例都已**烘焙进素材**，
   *   运行时系数恒为 1，进出任何姿态都没有尺寸过渡。
   *   烘焙工具：tools/sprites/fix_pose_frames.py（一次性统一尺度/对位/落地）
   *   口径明细见 docs/02-animation.md「姿态尺寸一致性」。
   *
   * 新增姿态时优先改素材，不要往这里加系数——离散查表 + 帧级平滑会在切姿态时
   * 留下一段约 0.4s 的尺寸过渡，而且必须靠 mods.prevScaleMul 才能让离场画面不跟着缩。
   * 表本身保留，仅作应急兜底。
   */
  const POSE_SCALE = {};
  function poseScale() { return POSE_SCALE[fsm.name] || 1; }

  /* ---- 显示缩放的帧级平滑 ----
   * 姿态校正表（上面那张）是「按姿态名查表」的离散值，若表里有非 1 项，切姿态的那
   * 一帧会整块生效，而帧序列只做图像交叉淡化、不插值缩放，于是出现「一瞬间体型突变」。
   * 体型（设置/滚轮）同理：直接赋值也是瞬跳。
   * 这里把「姿态校正 poseCur」「体型 sizeCur」各做一次指数平滑（≈0.12s 时间常数），
   * 所有绘制与几何（精灵、阴影、食碗、气泡头顶、特效锚点）统一读平滑值，
   * 逻辑量（bounds 边界、命中判定、面板定位）仍用目标值 pet.scale，互不干扰。
   * 当前表为空，poseCur 恒为 1；这套机制保留下来是为了将来应急加系数时不至于又踩坑。
   */
  const SCALE_SMOOTH = 0.0004;    // 与 HEAD_SMOOTH 同量级：每帧约收敛 12%，0.35s 内到位
  let sizeCur = BASE_SCALE;       // 平滑后的体型
  let poseCur = 1;                // 平滑后的姿态校正（当前姿态）
  let posePrev = 1;               // 上一个姿态的校正值：供仍在淡出的离场画面使用
  let poseTargetPrev = null;      // 上一次查表得到的姿态目标值，用于识别「切姿态」这一刻
  let shadowKCur = 1;             // 平滑后的阴影姿态体积修正
  let scaleReady = false;         // 首帧前直接对齐，避免启动时从基准值滑入

  function updateScaleSmoothing(dt) {
    const poseTarget = poseScale();
    const shadowTarget = POSE_SHADOW_K[fsm.name] || 1;
    // 首帧 / 无 dt：直接对齐目标，杜绝启动首帧的「滑入」动画
    if (!scaleReady || !(dt > 0)) {
      sizeCur = pet.scale;
      poseCur = poseTarget;
      posePrev = poseTarget;
      poseTargetPrev = poseTarget;
      shadowKCur = shadowTarget;
      scaleReady = true;
      return;
    }
    // 切姿态的那一刻把「旧姿态的尺寸」定格给离场画面：
    // 否则 poseCur 一路平滑到新值，仍在淡出的旧姿态会跟着缩
    //（表现为「整只猫先缩一下再换成新姿态」）。动画器的交叉淡化只有 0.18s，
    //  远短于尺寸平滑的 0.41s，所以离场期间用固定值即可。
    if (poseTargetPrev !== null && poseTarget !== poseTargetPrev) posePrev = poseCur;
    poseTargetPrev = poseTarget;
    sizeCur = Core.damp(sizeCur, pet.scale, SCALE_SMOOTH, dt);
    poseCur = Core.damp(poseCur, poseTarget, SCALE_SMOOTH, dt);
    shadowKCur = Core.damp(shadowKCur, shadowTarget, SCALE_SMOOTH, dt);
    // 足够接近时吸附，避免长期停在小数差上
    if (Math.abs(sizeCur - pet.scale) < 1e-4) sizeCur = pet.scale;
    if (Math.abs(poseCur - poseTarget) < 1e-4) poseCur = poseTarget;
    if (Math.abs(shadowKCur - shadowTarget) < 1e-4) shadowKCur = shadowTarget;
  }

  /* ---- 特效定位：一律按「猫当前的实际显示几何」换算（engine/fx.js） ----
   * 旧实现把爱心写死在 GROUND-250、Zzz 写死在 GROUND-150..215，都是按 100% 体型
   * 手调的绝对像素；体型调到 30% 时猫只有约 100px 高，特效于是飘在猫头顶一百多像素外。
   * 现在起点由头顶点位推出，速度/尺寸跟着体型缩放（保留看得见的下限）。
   */
  function fxScale() { return Fx.scaleFactor(sizeCur); }        // 力度系数 0.5–1.15
  function fxSizeMul() { return Fx.sizeMul(sizeCur); }          // 尺寸系数 ≥0.55

  /** 猫在窗口内的可见几何（含姿态校正与跳跃位移） */
  function catGeom() {
    return Fx.geom({
      contentTop: animator.contentTop(),
      spriteGroundY: SPRITE_GROUND_Y,
      ground: GROUND,
      y: pet.y,
      scale: sizeCur,
      poseScale: poseCur,
    });
  }

  /**
   * eat 素材里烤死的食碗中心相对锚点 (256,470) 偏右 79 素材 px（逐帧实测）。
   * 进食开始时把「猫」或「碗」微调到同一位置，保证猫低头吃的正是地上那只碗。
   */
  const EAT_BOWL_DX = 79;
  function alignBowlOnEat() {
    if (!food) return;
    const want = pet.x + pet.facing * EAT_BOWL_DX * pet.scale;  // 烤碗中心的屏幕位置
    const dx = food.x - want;
    if (Math.abs(dx) <= 80) {
      // 正常流程的小偏差（走路到位误差）：挪猫对齐碗，肉眼无感
      pet.x += dx;
    } else if (Math.abs(dx) > 80) {
      // 异步竞态导致的脱位（如进食中被残余状态打断）：挪碗对齐猫，避免猫对着空气吃
      food.x = want;
    }
    clampX();
  }
  let lastInteraction = time;
  let lastStatsSave = 0;
  let statsPushT = 0;         // 状态面板推送节流计时
  let lastAutoBubble = -99;   // 自主气泡冷却，避免频繁打扰
  let lastNotify = -1e9;      // 系统通知冷却（分钟级，由 notifyInterval 控制）
  let walkToCursor = null;    // 呼喊后是否走向光标
  let bubbleSize = { w: 0, h: 0 };  // 气泡未缩放时的盒尺寸（文本变化时重测）
  let bubblePop = 1;          // 气泡弹出动画进度 0→1
  let bubbleHeadY = null;     // 平滑后的猫头顶（窗口坐标），用于挂载气泡
  let bubbleShownAt = -1e9;   // 本句气泡的出现时刻（秒），供看门狗兜底
  const mouse = { x: W / 2, y: GROUND };
  let gesture = { active: false, dragging: false, sx: 0, sy: 0 };
  let mousePassOver = null;   // 动态鼠标穿透：上一次「鼠标是否在可交互区域」状态
  let panelSide = 'left';     // 状态面板当前贴靠侧（主进程定位后推送，用于活动边界与气泡避让）
  let screenEdge = null;      // 窗口与屏幕交集边界 { lo, hi }（窗口坐标，主进程推送；null = 无约束）

  /* ---- 属性驱动（needs-profile）：档位快照与各级冷却 ---- */
  let tierSnapshot = { hunger: null, energy: null, happiness: null, cleanliness: null };
  const needCd = { hunger: -1e9, energy: -1e9, happiness: -1e9, cleanliness: -1e9 };   // 每属性提醒冷却
  const urgentCd = { hunger: -1e9, energy: -1e9, happiness: -1e9, cleanliness: -1e9 }; // 每属性紧急中断冷却
  let lastSettleBubble = -1e9;  // 交互结算台词的展示时间（避免被状态气泡立刻覆盖）
  let goodBubbleAt = -1e9;      // 上一次「正向（good）气泡」时间
  let pendingNeed = null;       // { statKey, key } 被结算台词挡下的跨档反应，稍后补发
  let lastSensitivity = null;   // 上一次生效的灵敏度档（变化时重建档位快照）

  const api = window.pet || null;
  const Schema = window.ConfigSchema || null;
  const I18N = window.I18N || { t: (l, k) => k, pick: (l, k) => k };
  // 属性分档/权重表（单一来源）；无该模块时退化为「全部正常」，不影响既有行为
  const NP = window.NeedsProfile || {
    KEYS: ['hunger', 'energy', 'happiness', 'cleanliness'],
    RANK: { critical: 0, low: 1, normal: 2, good: 3 },
    PRIORITY: ['energy', 'hunger', 'cleanliness', 'happiness'],
    NEUTRAL_TIERS: { hunger: 'normal', energy: 'normal', happiness: 'normal', cleanliness: 'normal' },
    resolve: () => 'normal',
    combineWeights: (base) => Object.assign({}, base),
    sleepBias: () => 0,
  };

  /* ---- 配置（分组结构；无桥接环境用默认值兜底） ---- */
  let config = Schema
    ? Schema.defaults()
    : { appear: { language: 'zh-CN' }, pet: {}, sound: {}, interact: {}, behavior: {}, data: {}, runtime: { stats: pet.stats } };

  const clamp = Core.clamp;
  const pick = Core.pick;

  /* ================= 文案与气泡 ================= */

  function lang() { return config.appear.language || 'zh-CN'; }
  function say(key, params) { return I18N.t(lang(), 'say.' + key, params); }
  function bubble(key) {
    const owner = config.pet.ownerName || I18N.t(lang(), 'ownerFallback');
    const full = 'bubbles.' + key;
    let s = I18N.pick(lang(), full, { owner });
    // 词条缺失时 I18N.t 会把 key 原样返回——宁可不出这句台词，
    // 也不能把「bubbles.need.xxx」这种裸键名当猫话冒出去（用户看到的「乱码」）
    if (s === full) return '';
    return s.replace(/\{name\}/g, config.pet.petName);
  }

  /**
   * 语音播放参数（单一来源）：主音量 × 叫声音量（voiceVolume，0–100），
   * 每次播放时实时读取 config，设置页「应用」后立即生效
   */
  function voiceOpts() {
    const vv = Number(config.sound && config.sound.voiceVolume);
    const trim = Number.isFinite(vv) ? Math.max(0, Math.min(100, vv)) / 100 : 1;
    return {
      enabled: config.sound.voice !== false,
      muted: !!config.sound.muted,
      volume: Math.round(config.sound.volume * trim),
    };
  }

  /**
   * 显示气泡（唯一出口）
   * @param {string} text
   * @param {string} [voiceKey] 语音情境 key；缺省则不发声（渐进接入）
   */
  /**
   * 气泡文本净化：模型偶尔会把 \uXXXX 转义序列、\n 字面量或控制字符
   * 当成正文输出，原样渲染就是一串「乱码编码」。这里统一解码/剔除。
   */
  function sanitizeBubbleText(s) {
    let t = String(s == null ? '' : s);
    if (t.indexOf('\\') >= 0) {
      // 完整合法的 \uXXXX 才解码，避免误伤正文里的反斜杠
      t = t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => {
        try { return String.fromCharCode(parseInt(h, 16)); } catch (_) { return _; }
      });
      t = t.replace(/\\n/g, '\n').replace(/\\t/g, ' ');
    }
    // 剔除控制字符（保留换行与制表以上可打印内容）
    t = t.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
    return t.trim();
  }

  /* AI 自言自语的运行时状态。声明在气泡相关函数之前：showBubble / hideBubble
     都要读写它（取消那句的定时器），放在后面会踩 TDZ。 */
  const ai = {
    busy: false,      // 正在讲一段：期间挂起自主气泡
    nextAt: 0,        // 下次可以自己开口的时间点（秒）
    showT: null,      // 当前句的隐藏定时器
    tickT: 0,         // 调度检查节流（每 5s 一次）
    text: '',         // 屏上这句话的原文：打断时据此判断「该不该顺手收掉气泡」
  };

  function showBubble(text, voiceKey) {
    text = sanitizeBubbleText(text);
    if (!text) return;                 // 空文案（含词条缺失守卫）不出气泡框
    if (!config.sound || !config.sound.bubbles) return;
    // 语音与气泡同源；任何异常静默，绝不影响气泡
    if (voiceKey && window.Voice) {
      try {
        window.Voice.play(voiceKey, voiceOpts());
      } catch (e) { /* 静默降级 */ }
    }
    const isNew = bubbleEl.textContent !== text;
    bubbleEl.textContent = text;
    bubbleEl.classList.remove('verse');   // 普通气泡不继承上一句诗的排版
    bubbleEl.classList.add('show');
    if (isNew) {
      bubblePop = 0;          // 新文案重新播放弹出动画
      bubbleHeadY = null;     // 重新挂载时直接吸附头顶，不做平滑追赶
    }
    measureBubble();
    bubbleShownAt = time;
    clearTimeout(showBubble._t);
    // 顺手撤掉 AI 那句的定时器：两条定时器抢同一个元素，
    // 留着它会在「普通气泡把 AI 台词顶掉」之后把新气泡提前收掉
    clearTimeout(ai.showT);
    ai.showT = null;
    ai.text = '';
    showBubble._t = setTimeout(
      () => bubbleEl.classList.remove('show'),
      Math.max(1200, config.sound.bubbleDuration || 2200)
    );
  }

  /**
   * 收气泡的唯一出口。
   * 「只 clearTimeout 不摘 .show」是本文件出现过的最阴的一类 bug：
   * 定时器没了、class 还在，气泡就会一直挂在屏幕上，直到下一次有人说话。
   */
  function hideBubble() {
    clearTimeout(showBubble._t);
    clearTimeout(ai.showT);
    ai.showT = null;
    ai.text = '';
    bubbleEl.classList.remove('show');
    bubbleEl.classList.remove('verse');
  }

  /** 测量气泡未缩放时的盒尺寸（transform 不影响布局尺寸，可安全用于缩放换算） */
  function measureBubble() {
    const w = bubbleEl.offsetWidth || 0;
    const h = bubbleEl.offsetHeight || 0;
    if (w > 0 && h > 0) bubbleSize = { w, h };
  }

  /**
   * 把气泡挂到猫头顶正上方。气泡尺寸固定、不随宠物体型缩放，
   * 保证任何体型下文字都清晰可读；位置仍每帧跟随头顶，
   * 尖角始终指向猫头（窗口边缘夹紧时经 --tail-x 横向偏移）。
   * 坐标推导（transform-origin: 50% 100%，transform: translateX(-50%) scale(k)）：
   *   元素盒底边中心落在 (left, top + h)，尖角末端再向下伸出 6k，
   *   因此 top = 头顶 - 间距 - 6k - h 时，尖角正好悬在头顶上方。
   */
  function updateBubbleLayout(mods, dt) {
    if (!bubbleEl || !bubbleEl.textContent) return;

    const bw = bubbleSize.w || 140;   // 兜底：尚未测到尺寸时按单行估算
    const bh = bubbleSize.h || 32;

    // 仅保留弹出动画（0.86 → 1），与宠物体型解耦
    const k = 0.86 + 0.14 * Core.Ease.outQuad(clamp(bubblePop, 0, 1));

    // 猫头顶（窗口坐标）= 落地点 - 素材内容高 × 缩放（含姿态级校正）+ 程序化起伏
    const contentTop = animator.contentTop();
    const target = GROUND + pet.y + ((mods && mods.bob) || 0)
      - (SPRITE_GROUND_Y - contentTop) * sizeCur * poseCur;
    if (bubbleHeadY == null) bubbleHeadY = target;
    else bubbleHeadY = Core.damp(bubbleHeadY, target, HEAD_SMOOTH, dt || 0.0167);

    const top = Math.max(4, bubbleHeadY - BUBBLE_GAP - BUBBLE_TAIL * k - bh);
    const halfW = (bw * k) / 2;
    // 气泡横向夹紧：窗口内 + 不压到状态面板上
    let cxMin = halfW + 4;
    let cxMax = W - halfW - 4;
    if (config.appear && config.appear.statusPanel) {
      const half = SPRITE_HALF_W * pet.scale;
      if (panelSide === 'left') {
        cxMin = Math.max(cxMin, W / 2 - half - PANEL_GAP + halfW + 4);
      } else if (panelSide === 'right') {
        cxMax = Math.min(cxMax, W / 2 + half + PANEL_GAP - halfW - 4);
      }
    }
    const cx = clamp(pet.x, cxMin, cxMax);

    bubbleEl.style.left = `${cx.toFixed(1)}px`;
    bubbleEl.style.top = `${top.toFixed(1)}px`;
    bubbleEl.style.transform = `translateX(-50%) scale(${k.toFixed(3)})`;

    // 尖角横向跟随猫头（气泡被窗口夹紧时仍能指向头顶）
    const tailX = clamp((pet.x - cx) / k + bw / 2, 16, Math.max(16, bw - 16));
    if (typeof bubbleEl.style.setProperty === 'function') {
      bubbleEl.style.setProperty('--tail-x', `${tailX.toFixed(1)}px`);
    }
  }

  /**
   * 自主行为气泡：带 5 秒冷却，避免猫频繁打扰用户。
   * 注意冷却判定必须在更新时间戳之前——旧实现先写 lastAutoBubble 再调用
   * showBubble，导致时间差恒为 0、自主气泡被自己的冷却永远拦截。
   *
   * @param {string} text  气泡文本
   * @param {boolean} force 跨档即时反应：绕过 5s 冷却与结算保护（仍受每属性限流）
   * @param {string} [voiceKey] 语音情境 key
   * @returns {boolean} 是否真的显示了
   */
  function autoBubble(text, force, voiceKey) {
    // AI 正在讲一段：自主台词让路（危急提醒 force 例外，直接压过去）
    if (!force && ai.busy) return false;
    if (!force && time - lastAutoBubble < AUTO_BUBBLE_CD) return false;
    // 交互刚结算的台词优先：1.2s 内不覆盖，避免「谢谢主人」被状态气泡顶掉
    if (!force && time - lastSettleBubble < SETTLE_GUARD) return false;
    lastAutoBubble = time;
    showBubble(text, voiceKey);
    return true;
  }

  /**
   * 属性气泡：在 autoBubble 之上再叠一层「每属性 90s 冷却」，
   * 保证同一个需求不会连续唠叨。冷却只在真正显示后才推进。
   */
  function needBubble(statKey, bubbleKey, cd, force) {
    const cdv = cd == null ? NEED_WARN_CD : cd;
    if (time - needCd[statKey] < cdv) return false;
    if (!autoBubble(bubble(bubbleKey), force, bubbleKey)) return false;
    needCd[statKey] = time;
    return true;
  }

  /* ================= AI 自言自语 =================
   *
   * 分工：主进程负责生成与节奏（按 hold 逐句推 ai-say），这里只负责
   * 显示、让路（交互/睡觉）与自主调度（什么时候轮到自己开口）。
   * 没有对话、没有输入——猫只单向说话。
   */

  /* AI 状态对象见上方（与 showBubble 放一起，避免 TDZ）。 */

  /** AI 句子专用显示：不走 autoBubble 冷却，按主进程给的 hold 定时隐藏 */
  function aiShow(text, voiceKey, verse, hold) {
    text = sanitizeBubbleText(text);
    if (!config.sound || !config.sound.bubbles || !text) return;
    if (voiceKey && window.Voice) {
      try { window.Voice.play(voiceKey, voiceOpts()); } catch (e) { /* 静默降级 */ }
    }
    if (bubbleEl.textContent !== text) {
      bubblePop = 0;
      bubbleHeadY = null;
    }
    bubbleEl.textContent = text;
    ai.text = text;                     // 记下屏上这句，打断时据此判断归属
    bubbleEl.classList.toggle('verse', !!verse);
    bubbleEl.classList.add('show');
    measureBubble();
    bubbleShownAt = time;
    clearTimeout(ai.showT);
    ai.showT = setTimeout(hideBubble, Math.max(1200, hold || config.sound.bubbleDuration || 2200));
  }

  /** 打断进行中的一段（交互优先；也让主进程停掉后续句子的推送） */
  function interruptAi() {
    if (!ai.busy) return;
    ai.busy = false;
    // 关键：不能只 clearTimeout。定时器一撤，那句的 .show 就没人摘了，
    // 气泡会一直挂在屏幕上，直到下一次有别的台词把它顶掉——
    // 这正是「拖拽时气泡长时间不消失」的根因。屏上还是这句就直接收掉；
    // 已被别的话覆盖（如危急提醒）则只撤掉它的定时器，不动别人的气泡。
    if (ai.text && bubbleEl.textContent === ai.text) hideBubble();
    else { clearTimeout(ai.showT); ai.showT = null; ai.text = ''; }
    if (api && api.aiAbort) {
      try { api.aiAbort().catch(() => {}); } catch (_) { /* 忽略 */ }
    }
  }

  /** 自主间隔（秒）：深夜 23:00–07:00 拉长一倍 */
  function aiDelay() {
    if (!window.AiTalk || !config.ai) return 0;
    const sec = window.AiTalk.delayFor(config.ai.autoTalk || 'normal');
    const h = new Date().getHours();
    return (h >= 23 || h < 7) ? sec * 2 : sec;
  }

  function scheduleNextTalk() {
    if (!config.ai || !config.ai.enabled || (config.ai.autoTalk || 'normal') === 'off') {
      ai.nextAt = 0;
      return;
    }
    const sec = aiDelay();
    ai.nextAt = sec ? time + sec : 0;
  }

  /** 每 5s 判一次：够久没互动、没在讲、没睡觉，才自己开口 */
  function maybeAutoTalk() {
    if (!config.ai || !config.ai.enabled) return;
    if ((config.ai.autoTalk || 'normal') === 'off') return;
    if (ai.busy) return;
    if (!ai.nextAt) { scheduleNextTalk(); return; }
    if (time < ai.nextAt) return;
    if (time - lastInteraction < 180) { ai.nextAt = time + 30; return; }      // 静置不足 3 分钟
    if (fsm.name === 'sleep' || fsm.name === 'drag') { ai.nextAt = time + 60; return; }
    if (bubbleEl.classList.contains('show')) { ai.nextAt = time + 20; return; }  // 有别的台词在播
    scheduleNextTalk();
    if (api && api.aiTell) {
      try { api.aiTell('', { auto: true }).catch(() => {}); } catch (_) { /* 忽略 */ }
    }
  }

  function onAiSay(p) {
    if (!p || !p.text) return;
    ai.busy = true;
    aiShow(p.text, p.voiceKey, p.verse, p.hold);
  }

  function onAiBusy(p) {
    ai.busy = !!(p && p.busy);
    if (!ai.busy) scheduleNextTalk();
  }

  function onAiDone() { /* 讲完一段无副作用（1.9.9 起移除「陪伴增加心情」奖励） */ }

  /** 当前档位（带迟滞：升档需越过 T+4，避免阈值抖动反复刷气泡） */
  function needTiers() {    const sens = sensitivity();
    const out = {};
    for (let i = 0; i < NP.KEYS.length; i++) {
      const k = NP.KEYS[i];
      const v = Number.isFinite(pet.stats[k]) ? pet.stats[k] : 80;
      out[k] = NP.resolve(k, v, tierSnapshot[k], sens);
    }
    return out;
  }

  /** 「状态驱动」是否生效（关闭后完全回到 v1.6.0 的固定阈值逻辑） */
  function needVoiceOn() {
    return !(config.behavior && config.behavior.needVoice === false);
  }

  /** 清洁类气泡（洗澡入口恒开放，直接用常规句式） */
  function cleanBubbleKey(tier) {
    return 'need.cleanliness.' + tier;
  }

  /** 系统通知（受通知开关与最短间隔双重限制） */
  function maybeNotify(kind) {
    if (!config.sound.notifications || !api) return;
    const interval = (config.sound.notifyInterval || 30) * 60;
    if (time - lastNotify < interval) return;
    lastNotify = time;
    const name = config.pet.petName;
    api.notify({
      title: name,
      body: I18N.t(lang(), 'notify.' + kind, { name }),
    });
  }

  /* ================= 配置应用 ================= */

  /**
   * 应用配置。
   * @param {boolean} adoptStats 是否采纳配置里的 runtime.stats。
   *   渲染进程才是属性的活真源（逐帧衰减 + 交互结算都发生在这里），主进程的快照
   *   只随 stats-live（≤1s）与自动保存（saveInterval，默认 60s）更新；且主进程的
   *   重置 / 导入 / 迁移都显式保留 runtime（见 reset-config、import-config），
   *   所以**启动之后属性只由渲染进程改写**，任何运行期广播都不该采纳主进程快照。
   *   否则会出现：洗澡后打开状态面板查看 → 面板触发的广播用落后一个保存周期的旧快照
   *   覆盖 pet.stats → 清洁度回落到洗澡前（喂食 / 逗玩 / 抚摸的收益同样被抹掉）。
   */
  function applyConfig(adoptStats) {
    // 属性与体型
    if (adoptStats) {
      pet.stats = config.runtime.stats;
      flushStats();     // 外部权威替换后立刻回推，主进程/面板同一口径
    } else {
      config.runtime.stats = pet.stats;
    }
    if (Number.isFinite(config.pet.size)) {
      pet.scale = clamp(config.pet.size, MIN_SCALE, MAX_SCALE);
    }

    // 外观
    canvas.style.opacity = String((config.appear.opacity || 100) / 100);
    document.documentElement.style.setProperty('--ui-scale', String((config.appear.uiScale || 100) / 100));
    let th = config.appear.theme;
    if (th === 'auto') {
      th = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.body.classList.toggle('dark', th === 'dark');

    mousePassOver = null;   // 重新判定动态鼠标穿透（点击穿透开关可能已变化）
    // AI 开关/频率变化：关闭时立刻停讲；开启但没有排期时补一个
    if (!config.ai || !config.ai.enabled) {
      interruptAi();
      ai.nextAt = 0;
    } else if (!ai.nextAt) {
      scheduleNextTalk();
    }
    clampX();
    refreshMenuLabels();
    // 眨眼：待机常态只在睁眼帧（idle_1 / idle_4）间轮播，闭眼帧（idle_3）按随机间隔插播；
    // 频率 = behavior.blinkRate（次/分钟），0 = 不眨眼；改动经 config-changed 实时生效
    const blinkRate = Number(config.behavior && config.behavior.blinkRate);
    animator.blinkCfg = {
      active: [0, 3],
      blinkFrame: 2,
      meanGap: blinkRate > 0 ? 60 / blinkRate : 0,
    };
    // 字号缩放（uiScale）会改变气泡盒尺寸，需要重新测量以便缩放换算准确
    measureBubble();
  }

  /* ================= 工具 ================= */

  /**
   * 随机漫游目标。minDist > 0 时只考虑空间足够的一侧，
   * 保证「过去的路程」够走满最少循环数；两侧都不够则去更宽敞的那一头。
   */
  function pickTarget(minDist) {
    const [lo, hi] = bounds();
    if (!(minDist > 0)) return Core.rand(lo, hi);
    const roomL = pet.x - lo;
    const roomR = hi - pet.x;
    const canL = roomL > minDist;
    const canR = roomR > minDist;
    if (canL && canR) {
      return Math.random() < 0.5 ? Core.rand(lo, pet.x - minDist) : Core.rand(pet.x + minDist, hi);
    }
    if (canL) return Core.rand(lo, pet.x - minDist);
    if (canR) return Core.rand(pet.x + minDist, hi);
    return roomL >= roomR ? lo : hi;
  }

  /** 冲刺速度：距离短就按「距离 / 最少时长」收着跑，下限 65%（仍要像「跑」而不是「挪」） */
  function runSpeedFor(span) {
    return clamp(span / RUN_MIN_TIME, RUN_SPEED * RUN_SLOW_FLOOR, RUN_SPEED);
  }

  /**
   * 活动边界：留白 = 猫身半宽 × 当前体型 + 6px 余量（半宽取素材实测最大值 253px），
   * 保证任何体型下猫身（含跨步姿态）都完整留在窗口内、不被边缘裁切。
   * 状态面板显示时，贴靠侧边界再收缩，猫不会走到面板后面。
   * 屏幕边界约束（interact.keepOnScreen）：窗口可能被拖到屏幕边缘甚至部分出屏，
   * 主进程把「窗口 ∩ 屏幕」的可见区间换算成窗口坐标推送过来（screenEdge），
   * 这里再取交集，猫身永远不出现在屏幕不可见的区域。
   */
  function bounds() {
    const half = SPRITE_HALF_W * pet.scale;
    let lo = half + 6;
    let hi = W - half - 6;
    if (config.appear && config.appear.statusPanel) {
      if (panelSide === 'left') {
        lo = Math.max(lo, W / 2 - half - PANEL_GAP + 4 + half);   // 面板内容右缘 + 4px
      } else if (panelSide === 'right') {
        hi = Math.min(hi, W / 2 + half + PANEL_GAP - 4 - half);   // 面板内容左缘 - 4px
      }
    }
    if (screenEdge) {
      // 屏幕可见区换算成猫心坐标：[edge.lo + half, edge.hi - half]
      lo = Math.max(lo, screenEdge.lo + half);
      hi = Math.min(hi, screenEdge.hi - half);
    }
    // 极端情况（窗口几乎完全出屏）下 lo 可能大于 hi：保留 hi 不翻转，猫贴在最后可见处
    if (lo > hi) lo = hi;
    return [lo, hi];
  }

  function clampX() {
    const [lo, hi] = bounds();
    if (pet.x < lo) { pet.x = lo; if (pet.vx < 0) pet.vx = 0; }
    if (pet.x > hi) { pet.x = hi; if (pet.vx > 0) pet.vx = 0; }
  }

  function activity() { return ACTIVITY[config.behavior.activityLevel] || ACTIVITY.normal; }

  /** 动作速度倍率（设置项为整数百分比，85 = 0.85×，稍微放缓为默认值；范围 20%–100%） */
  function animSpeed() {
    return clamp((config.behavior.animSpeed || 100) / 100, 0.2, 1.0);
  }

  /* ---- 体型调整 ---- */

  /** 体型百分比：以 SIZE_100 为 100%，范围 20%–100% */
  function sizePercent() {
    return Math.round((pet.scale / SIZE_100) * 100);
  }

  /** 按增量调整体型，越界时给出提示且不产生位移突变 */
  function resizeBy(delta) {
    const next = Core.clamp(pet.scale + delta, MIN_SCALE, MAX_SCALE);
    if (Math.abs(next - pet.scale) < 1e-6) {
      showBubble(next >= MAX_SCALE ? say('maxSize') : say('minSize'), next >= MAX_SCALE ? 'maxSize' : 'minSize');
      return;
    }
    pet.scale = next;
    // 边界随体型变化，立刻夹回合法范围，避免大猫瞬移到窗外
    clampX();
    persistSize();
    showBubble(say('sizePct', { n: sizePercent() }), 'sizePct');
    if (pet.scale === MIN_SCALE || pet.scale === MAX_SCALE) {
      showBubble(pet.scale === MAX_SCALE ? say('atMax') : say('atMin'), pet.scale === MAX_SCALE ? 'atMax' : 'atMin');
    }
  }

  /* ---- 属性衰减 ---- */
  // 下降速度由设置页「状态与成长」各属性独立的「每 30 分钟下降点数」决定，
  // 换算成匀速点/秒（面板数值平滑变化）。点数为 0 视为该属性不随时间下降。
  // 基准下清洁的「活动弄脏」倍率：奔跑/玩耍 ×2.2，趴睡 ×0.25
  const CLEAN_RUN_MULT = 2.2;
  const CLEAN_SLEEP_MULT = 0.25;
  // 趴睡时饱食下降倍率（约为活动时的 1/3）
  const HUNGER_SLEEP_MULT = 1 / 3;
  // 趴睡时心情的极缓慢回升（点/秒）
  const MOOD_SLEEP_GAIN = 0.05;
  // 趴睡时体力恢复（点/秒）
  const ENERGY_SLEEP_GAIN = 9;

  const DECAY_KEY_OF = {
    hunger: 'decayHunger',
    energy: 'decayEnergy',
    happiness: 'decayHappiness',
    cleanliness: 'decayCleanliness',
    affinity: 'decayAffinity',
  };

  /** 某属性当前设置的下降速度（点/秒）；0 = 不随时间下降（该项养成暂停） */
  function decayPerSec(stat) {
    const cfg = config.needs || {};
    const pts = Number(cfg[DECAY_KEY_OF[stat]]);
    if (!Number.isFinite(pts) || pts <= 0) return 0;
    return pts / (30 * 60);   // 每 30 分钟下降 pts 点
  }

  function decayStats(dt) {
    const sleeping = fsm.name === 'sleep';

    // 饱食：趴睡时下降约为活动时的 1/3
    pet.stats.hunger = clamp(
      pet.stats.hunger - decayPerSec('hunger') * (sleeping ? HUNGER_SLEEP_MULT : 1) * dt, 0, 100);

    // 体力：趴睡时正常恢复（不受下降速度影响）
    if (sleeping) {
      pet.stats.energy = clamp(pet.stats.energy + ENERGY_SLEEP_GAIN * dt, 0, 100);
    } else {
      pet.stats.energy = clamp(pet.stats.energy - decayPerSec('energy') * dt, 0, 100);
    }

    // 心情：趴睡时极缓慢回升，活动时正常下降
    if (sleeping) {
      pet.stats.happiness = clamp(pet.stats.happiness + MOOD_SLEEP_GAIN * dt, 0, 100);
    } else {
      pet.stats.happiness = clamp(pet.stats.happiness - decayPerSec('happiness') * dt, 0, 100);
    }

    // 清洁：随时间缓降；奔跑 / 玩耍时加倍弄脏，趴睡时更慢
    let dirty = decayPerSec('cleanliness');
    if (sleeping) dirty *= CLEAN_SLEEP_MULT;
    else if (fsm.name === 'run' || fsm.name === 'play') dirty *= CLEAN_RUN_MULT;
    pet.stats.cleanliness = clamp((pet.stats.cleanliness ?? 80) - dirty * dt, 0, 100);

    // 好感：极缓下降（趴睡时保持不变），靠互动回升
    if (!sleeping) {
      pet.stats.affinity = clamp((pet.stats.affinity ?? 10) - decayPerSec('affinity') * dt, 0, 100);
    }

    if (!config.data.autoSave) return;
    const interval = Math.max(2, config.data.saveInterval || 5);
    if (time - lastStatsSave > interval) {
      lastStatsSave = time;
      if (api) api.saveConfig({ runtime: { stats: pet.stats } });
    }
  }

  /** 体型变更即时落盘（用户主动操作，无需防抖） */
  function persistSize() {
    if (api) api.saveConfig({ pet: { size: pet.scale } });
  }

  /* ================= 状态机 ================= */

  const states = {
    idle: {
      enter() {
        animator.play('idle', 0.22);
        const [a, b] = activity().think;
        pet.thinkIn = Core.rand(a, b);
      },
      update(_c, dt) {
        pet.thinkIn -= dt;
        if (pet.thinkIn > 0) return null;
        const next = decide();
        // 继续待机时必须重置计时器，否则同状态切换被忽略会导致猫不再决策
        if (next === 'idle') {
          const [a, b] = activity().think;
          pet.thinkIn = Core.rand(a, b);
          return null;
        }
        return next;
      },
    },

    walk: {
      enter() {
        animator.play('walk', 0.16);
        if (pet.targetX == null) pet.targetX = pickTarget(WALK_MIN_DIST);
        // 步速 = 距离 / 最少时长，上限仍是正常步速：
        // 路程够就正常走，路程短（碗/光标在脚边）就放慢，到达时正好满 2 轮，绝不走过头。
        const span = Math.abs(pet.targetX - pet.x);
        pet.walkSkip = span < WALK_SKIP_DIST;   // 贴脸距离：没有可看的步态，直接进后续动作
        pet.walkSpeed = Math.min(WALK_SPEED, span / WALK_MIN_TIME);
      },
      update(_c, dt) {
        if (pet.walkSkip) {
          const next = pet.afterWalk || 'idle';
          pet.targetX = null;
          pet.afterWalk = null;
          pet.walkSkip = false;
          return next;
        }
        const d = pet.targetX - pet.x;
        if (Math.abs(d) < 8) {
          // 到位了还得满足：满 2 个完整循环，且停在循环首帧（不在跨步中间收势）
          if (animator.lapsDone() < WALK_MIN_LOOPS || !animator.atCycleStart()) return null;
          const next = pet.afterWalk || 'idle';
          pet.targetX = null;
          pet.afterWalk = null;
          return next;
        }
        pet.facing = d > 0 ? 1 : -1;
        // 单帧位移不超过剩余距离：精确落点，避免在目标两侧反复抖
        const step = Math.min(Math.abs(d), pet.walkSpeed * animSpeed() * dt);
        pet.x += Math.sign(d) * step;
        clampX();
        return null;
      },
      exit() {
        // 走向食碗途中被打断（afterWalk 还是 'eat' 说明没吃到）：清掉食碗防残留
        if (food && pet.afterWalk === 'eat') food = null;
        pet.targetX = null;
        pet.afterWalk = null;
        pet.walkSkip = false;
      },
    },

    run: {
      enter() {
        animator.play('run', 0.16);
        pet.runTimer = Core.rand(1.6, 3.0);
        pet.targetX = pickTarget(RUN_MIN_DIST);
        pet.runSpeed = runSpeedFor(Math.abs(pet.targetX - pet.x));
        pet.vx = 0;
      },
      update(_c, dt) {
        pet.runTimer -= dt;
        const d = pet.targetX - pet.x;
        if (Math.abs(d) < 10) {
          // 到位但不满 2 轮（屏幕窄、目标被边界夹住）→ 换个远目标接着冲，不走走停停
          if (animator.lapsDone() < RUN_MIN_LOOPS && pet.runTimer > 0) {
            pet.targetX = pickTarget(RUN_MIN_DIST);
            pet.runSpeed = runSpeedFor(Math.abs(pet.targetX - pet.x));
            return null;
          }
          if (animator.lapsDone() < RUN_MIN_LOOPS || !animator.atCycleStart()) return null;
          return 'idle';
        }
        if (pet.runTimer <= 0 && animator.lapsDone() >= RUN_MIN_LOOPS && animator.atCycleStart()) return 'idle';
        pet.facing = d > 0 ? 1 : -1;
        const step = Math.min(Math.abs(d), pet.runSpeed * animSpeed() * dt);
        pet.x += Math.sign(d) * step;
        clampX();
        return null;
      },
      exit() { pet.targetX = null; },
    },

    jump: {
      enter() {
        // 单次播放：3 帧周期 ≈ 0.6s，与腾空时长（2×585/1900 ≈ 0.62s）吻合
        animator.play('jump', 0.1, { once: true });
        pet.vy = -585;
        pet.vx = pet.facing * Core.rand(90, 200);
        pet.onGround = false;
      },
      update() {
        return pet.onGround ? 'idle' : null;
      },
    },

    fall: {
      enter() {
        // 下落：直接从腾空帧开始并定格，落地挤压由 squash 模块处理
        animator.play('jump', 0.08, { once: true, startAt: 1 });
        pet.onGround = false;
      },
      update() {
        return pet.onGround ? 'idle' : null;
      },
    },

    stretch: {
      enter() {
        // 单次播放：0.6s 完成下压→最深→回弹，之后定格在放松姿态直到状态结束
        animator.play('stretch', 0.24, { once: true });
        pet.stretchTimer = 1.7;
      },
      update(_c, dt) {
        pet.stretchTimer -= dt;
        if (pet.stretchTimer > 0) return null;
        // 睡眠唤醒过渡：stretch 结束后进入被交互打断时暂存的目标状态
        const next = pet.pendingAfterStretch || 'idle';
        pet.pendingAfterStretch = null;
        return next;
      },
    },

    sleep: {
      enter() {
        animator.play('sleep', 0.3);
        // 趴睡为主的节奏：单次时长拉长（原 18–34s）
        pet.sleepTimer = Core.rand(30, 70);
        pet.zzzTimer = 0;
        // 入睡时的睡意呼噜（更轻更长，冷却 45s，不会整段睡眠反复响）
        if (config.sound) {
          try {
            window.Voice && window.Voice.play('purrSleep', voiceOpts());
          } catch (e) { /* 静默降级 */ }
        }
      },
      update(_c, dt) {
        pet.sleepTimer -= dt;
        pet.stats.energy = clamp(pet.stats.energy + 9 * dt, 0, 100);
        pet.zzzTimer -= dt;
        if (pet.zzzTimer <= 0) {
          pet.zzzTimer = 1.15;
          const g = catGeom();               // 从头顶右上方飘出（趴睡时头在上方）
          emitP({
            kind: 'zzz',
            x: pet.x + g.halfW * Core.rand(0.45, 0.95),
            y: g.top + g.h * Core.rand(-0.02, 0.1),
            vx: Core.rand(12, 30) * fxScale(),
            vy: -30 * fxScale(),
            gravity: -8 * fxScale(),
            size: 9 * (0.7 + 0.3 * fxScale()),
            life: 2.4,
            spin: Core.rand(-0.5, 0.5),
          });
        }
        return pet.sleepTimer <= 0 ? 'stretch' : null;
      },
    },

    eat: {
      enter() {
        animator.play('eat', 0.2);
        pet.eatTimer = 4.2;
        pet.crumbTimer = 0;
        alignBowlOnEat();
      },
      update(_c, dt) {
        pet.eatTimer -= dt;
        pet.crumbTimer -= dt;
        if (pet.crumbTimer <= 0) {
          pet.crumbTimer = 0.26;
          burstP('crumb', pet.x + pet.facing * 44, GROUND - 26, 2, {
            spread: 45, up: 70, size: 5, life: 0.7, gravity: 240,
          });
        }
        if (pet.eatTimer <= 0) {
          pet.stats.hunger = clamp(pet.stats.hunger + 42, 0, 100);
          pet.stats.happiness = clamp(pet.stats.happiness + 6, 0, 100);
          food = null;
          flushStats();
          lastSettleBubble = time;
          showBubble(bubble('eat'), 'eat');
          pet.lickRounds = LICK_ROUNDS_EAT;   // 吃完必定舔爪子
          pet.lastLickAt = time;
          return 'lick';
        }
        return null;
      },
      exit() {
        // 喂食被打断（拖拽 / 抚摸 / 逗玩等）时也要清掉地上的食碗，避免残留
        food = null;
      },
    },

    play: {
      enter() {
        animator.play('play', 0.2);
        pet.playTimer = 3.2;
        pet.sparkTimer = 0;
        // 弹跳小球：从猫身前上方抛出。
        // 旧实现的三个坑：① life 2.6s 到点硬删（还在弹就消失）② vx 恒为负值，
        // 朝左时球直接飞出窗口左侧 ③ 弹不动时把 life 砍到 0.35s 且 fade:false，无淡出直接消失。
        const g = catGeom();
        const dir = pet.facing || 1;
        const s = 20 * fxSizeMul();
        particles.clearKind('ball');   // 上一只球先收走，避免叠球
        emitP({
          kind: 'ball',
          x: clamp(pet.x + dir * g.halfW * 0.9, 24, W - 24),
          y: g.top + g.h * 0.45,
          vx: dir * Core.rand(55, 110) * fxScale(),
          vy: -110 * fxScale(),
          gravity: 900 * fxScale(),
          size: s,
          life: 5.2,
          fade: false,
          fadeTail: 0.7,       // 最后 0.7s 淡出，不用「啪」地消失
          fixedSize: true,     // 实心球，生命末期不缩水
          bounce: 0.55,
          drag: 2.2,           // 落地滚动阻尼，最终停在地面
          restLife: 1.1,       // 停稳后停留 1.1s 再淡出（不在球场上躺太久）
          groundY: GROUND - s * 0.6,   // 球心 = 半径高度 → 正好贴地，不穿模
          minX: 16,
          maxX: W - 16,
        });
      },
      update(_c, dt) {
        pet.playTimer -= dt;
        pet.sparkTimer -= dt;
        if (pet.sparkTimer <= 0) {
          pet.sparkTimer = 0.45;
          burstP('star', pet.x + Core.rand(-60, 60), GROUND - Core.rand(70, 190), 2, {
            spread: 60, up: 75, size: 7, life: 0.85, gravity: 30,
          });
        }
        if (pet.playTimer <= 0) {
          pet.stats.happiness = clamp(pet.stats.happiness + 26, 0, 100);
          pet.stats.energy = clamp(pet.stats.energy - 14, 0, 100);
          flushStats();
          lastSettleBubble = time;
          showBubble(bubble('play'), 'play');
          return 'idle';
        }
        return null;
      },
    },

    pet: {
      enter() {
        animator.play('pet', 0.14);
        pet.petTimer = 1.6;
        pet.heartTimer = 0;
        // 呼噜铺底（独立音轨，不与 pet 喵叫抢通道；冷却 9s，连摸不叠加）
        if (config.sound) {
          try {
            window.Voice && window.Voice.play('purr', voiceOpts());
          } catch (e) { /* 静默降级 */ }
        }
      },
      update(_c, dt) {
        pet.petTimer -= dt;
        pet.stats.happiness = clamp(pet.stats.happiness + 7 * dt, 0, 100);
        pet.heartTimer -= dt;
        if (pet.heartTimer <= 0) {
          pet.heartTimer = 0.32;
          const g = catGeom();               // 贴着猫头冒：起点落在头部范围内
          emitP({
            kind: 'heart',
            x: pet.x + Core.rand(-0.45, 0.45) * g.halfW,
            y: g.top + g.h * Core.rand(0.02, 0.18),
            vx: Core.rand(-16, 16) * fxScale(),
            vy: Core.rand(-58, -34) * fxScale(),
            gravity: -12 * fxScale(),
            size: Core.rand(9, 14) * fxSizeMul(),
            life: 1.5,
            spin: Core.rand(-0.5, 0.5),
          });
        }
        if (pet.petTimer <= 0) {
          lastSettleBubble = time;
          showBubble(bubble('pet'), 'pet');
          return 'idle';
        }
        return null;
      },
    },

    /* 交互动作：洗澡（清洁大幅回升，泡泡粒子；约 4.5s 单次） */
    bath: {
      enter() {
        animator.play('bath', 0.2);
        pet.bathTimer = 4.5;
        pet.foamTimer = 0;
      },
      update(_c, dt) {
        pet.bathTimer -= dt;
        pet.foamTimer -= dt;
        if (pet.foamTimer <= 0) {
          pet.foamTimer = 0.35;
          // 泡泡上浮 + 水花（受「显示粒子特效」总开关控制）
          if (config.appear.showParticles) {
            emitP({
              kind: 'foam',
              x: pet.x + Core.rand(-55, 55),
              y: GROUND - Core.rand(40, 170),
              vx: Core.rand(-18, 18),
              vy: Core.rand(-55, -25),
              gravity: -14,
              size: Core.rand(6, 12),
              life: 1.6,
              spin: Core.rand(-0.8, 0.8),
            });
          }
        }
        if (pet.bathTimer <= 0) {
          pet.stats.cleanliness = clamp((pet.stats.cleanliness ?? 80) + 55, 0, 100);
          pet.stats.happiness = clamp(pet.stats.happiness + 10, 0, 100);
          pet.stats.energy = clamp(pet.stats.energy - 6, 0, 100);
          gainRewards(6, 2);   // 内部已 flushStats()
          lastSettleBubble = time;
          showBubble(bubble('bath'), 'bath');
          return 'idle';
        }
        return null;
      },
      exit() {
        // 打断时不结算效果、不留残留（与 eat 同策略）
        pet.foamTimer = 0;
      },
    },

    meow: {
      enter() {
        animator.play('meow', 0.14);
        pet.meowTimer = 1.6;
      },
      update(_c, dt) {
        pet.meowTimer -= dt;
        if (pet.meowTimer <= 0) {
          if (walkToCursor != null) {
            const tx = walkToCursor;
            walkToCursor = null;
            pet.targetX = tx;
            pet.afterWalk = 'idle';
            return 'walk';
          }
          return 'idle';
        }
        return null;
      },
    },

    /* 非交互动作：摇尾巴（自主放松，帧序列循环） */
    tailwag: {
      enter() {
        animator.play('tailwag', 0.18);
        // 计时挂「动画时钟」而非墙钟：动作速度 < 100% 时墙钟会把轮次提前掐断
        pet.tailwagEnd = animator.clock + Core.rand(2.2, 3.6);
      },
      update() {
        // 双条件退出：时间到 + 停在循环首帧。硬切序列若在任意帧中断，
        // 会看到尾巴甩到一半突然定格再淡出；落在接缝上则与 idle 首帧衔接自然。
        if (animator.clock < pet.tailwagEnd) return null;
        return animator.atCycleStart() ? 'idle' : null;
      },
    },

    /* 非交互动作：不高兴（心情不佳时的情绪表现，慢速蔫动） */
    unhappy: {
      enter() {
        animator.play('unhappy', 0.22);
        pet.unhappyTimer = Core.rand(2.6, 4.2);
      },
      update(_c, dt) {
        pet.unhappyTimer -= dt;
        return pet.unhappyTimer <= 0 ? 'idle' : null;
      },
    },

    /* 非交互动作：舔爪子（吃完 / 空闲随机触发，主帧停留略长） */
    lick: {
      enter() {
        animator.play('lick', 0.12, { hold: LICK_HOLD_MAP });
        const rounds = pet.lickRounds > 0 ? pet.lickRounds : 1;
        pet.lickRounds = 0;
        // 结束时刻必须挂在「动画时钟」上：帧推进走的是 dt × animSpeed()，
        // 用墙钟累加会在 animSpeed < 1（默认 85%）时提前掐断——
        // 2 轮实际要 1.9/0.85 ≈ 2.24 s，而墙钟 1.9 s 就收摊，收爪帧(lick_4)永远播不到。
        pet.lickEnd = animator.clock + rounds * LICK_CYCLE - LICK_END_TRIM;
      },
      update() {
        return animator.clock >= pet.lickEnd ? 'idle' : null;
      },
    },

    drag: {
      enter() {
        animator.play('drag', 0.12);
      },
      update() {
        return null;
      },
    },
  };

  const fsm = new StateMachine(states, 'idle').setContext({
    pickTarget,
    get pendingWalkTo() { return walkToCursor; },
  });

  /* ================= 自主决策 ================= */

  /**
   * 趴睡倾向：设置项 behavior.restiness（0–100，默认 70）为主，
   * 活跃度低时自动上浮、高时下调（quiet 更爱睡 / lively 更爱动），
   * 再叠加四项属性的档位修正（困了 +25、心情好 −5、饿极 −15 等）。
   */
  function restiness() {
    const base = Number.isFinite(config.behavior.restiness) ? config.behavior.restiness : 70;
    const adj = config.behavior.activityLevel === 'low' ? 15
      : config.behavior.activityLevel === 'high' ? -20 : 0;
    const bias = needVoiceOn() ? NP.sleepBias(needTiers()) : 0;
    return clamp(base + adj + bias, 0, 100) / 100;
  }

  /** 舔爪概率修正：毛不干净（非 good 档）时更爱舔，概率翻倍 */
  function cleanFactor() {
    if (!needVoiceOn()) return 1;
    return needTiers().cleanliness === 'good' ? 1 : 2;
  }

  /**
   * P1–P4：危急需求对应的强制行为（含气泡与系统通知）。
   * decide() 与 maybeUrgent() 共用，保证「决策 tick」与「实时中断」口径一致。
   * @returns {string|null} 目标状态名；无危急需求时返回 null
   */
  function urgentDecision() {
    const t = needTiers();
    const voice = needVoiceOn();

    // P1 体力危急 → 强制入睡
    if (t.energy === 'critical') {
      if (voice) needBubble('energy', 'need.energy.critical', NEED_CRIT_CD);
      maybeNotify('energyLow');
      return 'sleep';
    }
    // P2 饱食危急 → 强制讨食
    if (t.hunger === 'critical') {
      if (voice) needBubble('hunger', 'need.hunger.critical', NEED_CRIT_CD);
      maybeNotify('hungerLow');
      return 'meow';
    }
    // P3 清洁危急 → 蔫下来 / 喵叫（「状态驱动」关闭时清洁完全退出）
    if (voice && t.cleanliness === 'critical') {
      needBubble('cleanliness', cleanBubbleKey('critical'), NEED_CRIT_CD);
      maybeNotify('cleanLow');
      return Math.random() < 0.5 ? 'unhappy' : 'meow';
    }
    // P4 心情危急 → 闹小情绪 / 求安慰
    if (t.happiness === 'critical') {
      const sulk = Math.random() < 0.5;
      if (voice) needBubble('happiness', sulk ? 'sulk' : 'need.happiness.critical', NEED_CRIT_CD);
      maybeNotify('happyLow');
      return sulk ? 'unhappy' : 'meow';
    }
    return null;
  }

  /**
   * 紧急中断：危急需求不必等下一次决策 tick，在可打断状态下立即执行。
   * sleep 不在可打断集合内——睡着时不会被「饿」「累」打断，
   * 否则「趴睡为主」的节奏会被彻底破坏；醒来后由 checkNeedTransitions 补发提醒。
   */
  function maybeUrgent() {
    // 注意：不因 needVoice 关闭而跳过——体力/饱食的「危急保护」是独立于文案的硬保护
    if (gesture.active || gesture.dragging) return;
    if (!INTERRUPTIBLE[fsm.name]) return;
    const t = needTiers();
    for (let i = 0; i < NP.PRIORITY.length; i++) {
      const k = NP.PRIORITY[i];
      if (t[k] !== 'critical') continue;
      // 刚响应过同一需求：交给常规决策，避免在「不高兴 / 喵叫」之间反复打断
      if (time - urgentCd[k] < URGENT_CD) return;
      urgentCd[k] = time;
      const next = urgentDecision();
      if (next && next !== fsm.name) fsm.transition(next);
      return;
    }
  }

  /**
   * 帧级跨档检测：属性缓慢变化（或交互结算跳变）穿过阈值的那一刻立即反应。
   * 恶化 → 出该档警示台词；回升到正常/良好 → 出恢复台词。两者共用 20s/属性 冷却。
   */
  function checkNeedTransitions() {
    const voice = needVoiceOn();
    const sens = sensitivity();
    for (let i = 0; i < NP.KEYS.length; i++) {
      const k = NP.KEYS[i];
      const v = Number.isFinite(pet.stats[k]) ? pet.stats[k] : 80;
      const next = NP.resolve(k, v, tierSnapshot[k], sens);
      const prev = tierSnapshot[k];
      tierSnapshot[k] = next;
      if (prev == null || prev === next || !voice) continue;

      let key = null;
      if (NP.RANK[next] < NP.RANK[prev]) {
        // 恶化：只有 low / critical 档配了警示台词。good → normal 属健康区间，
        // i18n 没有 need.*.normal 词条，照拼只会把裸 key 当台词冒出去（乱码观感）。
        if (next === 'low' || next === 'critical') {
          key = k === 'cleanliness' ? cleanBubbleKey(next) : 'need.' + k + '.' + next;
        }
      } else if (NP.RANK[next] >= NP.RANK.normal) {
        // 恢复到正常或良好：给一句正向反馈（喂食 / 洗澡 / 玩耍后最直观）
        key = 'recover.' + k;
      }
      if (!key) continue;
      // 交互刚结算：先把台词让给结算气泡，1.2s 后再补发（不丢反应）
      if (time - lastSettleBubble < SETTLE_GUARD) pendingNeed = { statKey: k, key };
      else needBubble(k, key, NEED_REACT_CD, true);
    }
  }

  function decide() {
    const b = config.behavior;
    const t = needTiers();
    const voice = needVoiceOn();

    // ---- P1–P4：危急需求的强制行为（与 maybeUrgent 同一口径） ----
    const urgent = urgentDecision();
    if (urgent) return urgent;

    // ---- P5 心情偏低：40% 概率闹小情绪 ----
    if (t.happiness === 'low' && Math.random() < 0.4) {
      if (voice) needBubble('happiness', 'sulk', NEED_WARN_CD);
      return 'unhappy';
    }

    // ---- P6 其余属性的偏低档：概率性提醒，不强制改变行为 ----
    if (voice) {
      const lowish = ['energy', 'hunger', 'cleanliness'].filter((k) => t[k] === 'low');
      if (lowish.length && Math.random() < 0.5) {
        const k = pick(lowish);
        needBubble(k, k === 'cleanliness' ? cleanBubbleKey('low') : 'need.' + k + '.low', NEED_WARN_CD);
      }
    }

    // ---- P7 长时间无人互动 ----
    if (time - lastInteraction > (b.callInterval || 75)) {
      autoBubble(bubble('lonely'), false, 'lonely');
      maybeNotify('alone');
      lastInteraction = time;
      return 'meow';
    }

    // ---- P8 全部良好：极低概率给一句正向台词（长冷却 + 低概率，避免吵闹） ----
    if (voice && NP.KEYS.every((k) => t[k] === 'good')
      && time - goodBubbleAt > GOOD_BUBBLE_CD && Math.random() < GOOD_BUBBLE_PROB) {
      goodBubbleAt = time;
      const gk = pick(NP.KEYS);
      needBubble(gk, 'need.' + gk + '.good', 0);
    }

    // ---- P9 以趴睡为主、偶尔起身活动 ----
    if (Math.random() < restiness()) return 'sleep';

    // ---- P9.5 空闲舔爪：独立冷却 + 低概率，与权重表解耦（不挤占其他动作） ----
    // 脏污档概率翻倍：毛不干净时更爱舔；实际间隔约 90–130 s
    if (time - pet.lastLickAt > LICK_CD && Math.random() < LICK_PROB * cleanFactor()) {
      pet.lastLickAt = time;
      pet.lickRounds = Math.random() < 0.5 ? 1 : 2;
      return 'lick';
    }

    // ---- P10 加权随机表（受四项档位的乘子修正） ----
    const a = activity();
    const w = NP.combineWeights(
      { walk: a.walk, idle: a.idle, run: a.run, jump: a.jump, stretch: a.stretch, tailwag: a.tailwag, meow: a.meow },
      voice ? t : NP.NEUTRAL_TIERS
    );

    const r = Math.random();
    let acc = w.walk;
    if (r < acc) return 'walk';
    acc += w.idle;
    if (r < acc) return 'idle';
    acc += w.run;
    if (r < acc) return 'run';
    acc += w.jump;
    if (r < acc) return 'jump';
    acc += w.stretch;
    if (r < acc) return 'stretch';
    acc += w.tailwag;
    if (r < acc) return 'tailwag';
    return 'meow';
  }

  /* ================= 交互动作 ================= */

  const XP_PER_LEVEL = 100;

  /**
   * 睡眠唤醒过渡：睡觉中收到任何交互时，先伸懒腰醒来再进入目标动作。
   * 目标状态暂存到 pendingAfterStretch，由 stretch.update 结束时取出。
   */
  function wakeIfSleeping(next) {
    if (fsm.name !== 'sleep' || next === 'sleep') return next;
    pet.pendingAfterStretch = next;
    showBubble(bubble('wake'), 'wake');
    return 'stretch';
  }

  /** 交互结算后立刻把属性补推给主进程（不等 1s 心跳），保证落盘/广播口径即时一致 */
  function flushStats() {
    statsPushT = 0;
  }

  /** 互动奖励：累计经验（内部保留）+ 好感度；年龄版不再做升级气泡 */
  function gainRewards(xp, affinity) {
    pet.stats.xp = (pet.stats.xp || 0) + xp;
    pet.stats.affinity = clamp((pet.stats.affinity || 0) + affinity, 0, 100);
    flushStats();
  }

  function doPet() {
    lastInteraction = time;
    pet.stats.happiness = clamp(pet.stats.happiness + 8, 0, 100);
    gainRewards(3, 3);
    const g = catGeom();                     // 爱心从猫头位置爆出，不再用绝对高度
    burstP('heart', pet.x, g.top + g.h * 0.10, 3, {
      spread: 70 * fxScale(),
      up: 90 * fxScale(),
      size: 12 * fxSizeMul(),
      life: 1.4,
      gravity: -20 * fxScale(),
    });
    fsm.transition(wakeIfSleeping('pet'));
  }

  function doPlay() {
    lastInteraction = time;
    gainRewards(5, 3);
    showBubble(say('ball'), 'ball');
    fsm.transition(wakeIfSleeping('play'));
  }

  function doBath() {
    lastInteraction = time;
    showBubble(say('bathStart'), 'bathStart');
    // 洗澡就地开始（猫坐在原地的小浴盆里，不需要走动）
    fsm.transition(wakeIfSleeping('bath'));
  }

  function doFeed() {
    lastInteraction = time;
    gainRewards(4, 2);
    // 正在吃：不重走一遍「放碗→走过去」，只续时；否则 transition('walk')
    // 会先触发 eat.exit() 把刚放下的碗清掉，猫走到位后对着空气吃
    if (fsm.name === 'eat' && food) {
      pet.eatTimer = Math.max(pet.eatTimer, 4.2);
      showBubble(say('smell'), 'smell');
      return;
    }
    food = { x: clamp(pet.x + Core.rand(-150, 150), bounds()[0] + 20, bounds()[1] - 20) };
    // 行走目标 = 碗位置 - 烤碗偏移：猫停稳时素材里的碗正好压在 food.x 上，无需二次挪动
    const dir = food.x >= pet.x ? 1 : -1;
    pet.targetX = clamp(food.x - dir * EAT_BOWL_DX * pet.scale, bounds()[0] + 6, bounds()[1] - 6);
    pet.afterWalk = 'eat';
    showBubble(say('smell'), 'smell');
    fsm.transition(wakeIfSleeping('walk'));
  }

  function doCall() {
    lastInteraction = time;
    pet.stats.happiness = clamp(pet.stats.happiness + 8, 0, 100);
    gainRewards(2, 1);
    walkToCursor = clamp(mouse.x, bounds()[0], bounds()[1]);
    showBubble(say('callReply'), 'callReply');
    fsm.transition(wakeIfSleeping('meow'));
  }

  function handleAction(action) {
    interruptAi();   // 任何交互优先于自言自语：立刻停下正在讲的一段
    switch (action) {
      case 'pet': doPet(); break;
      case 'play': doPlay(); break;
      case 'feed': doFeed(); break;
      case 'call': doCall(); break;
      case 'bath':
        doBath();
        break;
      case 'settingsSaved':
        // 设置窗口保存成功后的宠物反馈气泡（不改变动作，只冒一句台词）
        showBubble(I18N.pick(lang(), 'say.settingsSaved'), 'settingsSaved');
        break;
      default: break;
    }
  }

  /* ================= 输入处理 ================= */

  function localPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  /**
   * 动态鼠标穿透：窗口（640×640）远大于猫身，若整窗接收鼠标会遮挡桌面点击。
   * 仅在「鼠标位于猫身 / 菜单展开 / 拖拽中」时接收事件，其余时刻让事件穿透到下层窗口。
   * 依赖主进程 setIgnoreMouseEvents(true, { forward: true })——穿透状态下仍能收到 mousemove，
   * 因此可以随时重新判定并把事件接管回来。
   */
  function updateMousePass() {
    if (!api || !api.setMouseIgnore || config.interact.clickThrough) return;
    const over = gesture.active || menuOpen() || hitCat(mouse);
    if (over === mousePassOver) return;
    mousePassOver = over;
    api.setMouseIgnore(!over);
  }

  function hitCat(p) {
    // 命中区随体型等比缩放，大猫更好点中、小猫不遮挡桌面
    const k = pet.scale / BASE_SCALE;
    const cx = pet.x;
    const cy = GROUND + pet.y - 150 * k;
    const dx = (p.x - cx) / (108 * k);
    const dy = (p.y - cy) / (128 * k);
    return dx * dx + dy * dy <= 1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const p = localPos(e);
    if (!hitCat(p)) {
      // 兜底：若上一次 pointerup 被系统吞掉（alt-tab / 异常窗口切换），
      // gesture 会卡在 active，导致整个窗口区域持续拦截点击，
      // 之后任何位置松开鼠标都会误触发抚摸并打断喂食/洗澡/逗玩。
      gesture.active = false;
      gesture.dragging = false;
      return;
    }
    interruptAi();   // 摸它 / 拖它时，正在讲的一段立刻让路
    gesture = { active: true, dragging: false, sx: e.screenX, sy: e.screenY };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 忽略 */ }
  });

  window.addEventListener('pointermove', (e) => {
    mouse.x = localPos(e).x;
    mouse.y = localPos(e).y;
    if (!gesture.active) return;
    const dx = e.screenX - gesture.sx;
    const dy = e.screenY - gesture.sy;
    if (!gesture.dragging && Math.hypot(dx, dy) > 4) {
      gesture.dragging = true;
      fsm.transition('drag');
    }
    if (gesture.dragging) {
      if (api) api.moveWindow(dx, dy);
      gesture.sx = e.screenX;
      gesture.sy = e.screenY;
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (!gesture.active) return;
    const wasDrag = gesture.dragging;
    // 先清状态再触发动作：动作回调里可能再进交互，避免重入/卡死
    gesture.active = false;
    gesture.dragging = false;
    if (wasDrag) {
      // 放下：从空中落回地面
      pet.y = -160;
      pet.vy = 0;
      pet.vx = 0;
      fsm.transition('fall');
    } else if (hitCat(localPos(e))) {
      // 只有「按在猫身上、且松开时仍在猫身上」才算一次抚摸；
      // 按下后滑出猫身再松开不结算，点击猫以外区域更不会打断当前动作
      doPet();
    }
  });

  /* pointerup 被系统吞掉时的兜底：失焦 / 取消都立即复位手势，
     否则窗口会一直处于「接管点击」状态，点哪都打断当前动作 */
  window.addEventListener('pointercancel', () => {
    gesture.active = false;
    gesture.dragging = false;
  });

  /* ---- 滚轮缩放：仅设置开启且悬停在猫身上时生效，避免误触 ---- */
  canvas.addEventListener('wheel', (e) => {
    if (!config.interact.wheelZoom) return;
    const p = localPos(e);
    if (!hitCat(p)) return;
    e.preventDefault();
    resizeBy(e.deltaY < 0 ? SCALE_STEP : -SCALE_STEP);
  }, { passive: false });

  /* ================= 右键菜单 ================= */

  const MENU_I18N = {
    pet: 'tray.pet', feed: 'tray.feed', play: 'tray.play', call: 'tray.call',
    bath: 'tray.bath',
    status: 'tray.status', settings: 'tray.settings', quit: 'tray.quit',
  };

  function refreshMenuLabels() {
    const items = menuEl.querySelectorAll('.item');
    items.forEach((el) => {
      const key = MENU_I18N[el.dataset.act];
      if (key) el.textContent = I18N.t(lang(), key);
    });
  }

  function openMenu(clientX, clientY) {
    refreshMenuLabels();
    menuEl.style.display = 'block';
    const mw = menuEl.offsetWidth;
    const mh = menuEl.offsetHeight;
    menuEl.style.left = `${Math.max(4, Math.min(clientX, W - mw - 8))}px`;
    menuEl.style.top = `${Math.max(4, Math.min(clientY, H - mh - 8))}px`;
  }

  function closeMenu() {
    menuEl.style.display = 'none';
  }

  function menuOpen() {
    return menuEl.style.display === 'block';
  }

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  });

  /**
   * 菜单自动关闭：覆盖全部边界场景
   *  1) 窗口内点击菜单外部（含猫身、空白处）；
   *  2) 点击本窗口之外的桌面/其他程序 —— 渲染进程收不到 pointerdown，
   *     依靠窗口失焦（blur）关闭；
   *  3)  Esc 键、滚轮滚动；
   *  4)  菜单自身被点击（无论点中条目还是空白/分隔线）。
   */
  document.addEventListener('pointerdown', (e) => {
    if (menuOpen() && !menuEl.contains(e.target)) closeMenu();
  }, true);

  window.addEventListener('blur', () => {
    // 点击窗口以外（桌面/其他程序）时：关菜单，并复位可能卡住的手势，
    // 保证「点击其他区域」绝不会打断宠物正在进行的动作
    gesture.active = false;
    gesture.dragging = false;
    closeMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen()) {
      closeMenu();
      e.preventDefault();
    }
  });

  window.addEventListener('wheel', () => { if (menuOpen()) closeMenu(); }, { passive: true });

  menuEl.addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    closeMenu();               // 无论点中何处都先关闭
    if (!item) return;
    switch (item.dataset.act) {
      case 'pet': doPet(); break;
      case 'feed': doFeed(); break;
      case 'play': doPlay(); break;
      case 'call': doCall(); break;
      case 'bath': handleAction('bath'); break;
      case 'status':
        if (api) api.saveConfig({ appear: { statusPanel: !config.appear.statusPanel } });
        break;
      case 'settings':
        if (api) api.openSettings();
        break;
      case 'quit':
        if (api) api.quit();
        break;
      default: break;
    }
  });

  /* ================= 物理 ================= */

  function updatePhysics(dt) {
    if (!pet.onGround) {
      pet.vy += GRAVITY * dt;
      pet.y += pet.vy * dt;
      pet.x += pet.vx * dt;
      clampX();
      if (pet.y >= 0) {
        pet.y = 0;
        pet.vy = 0;
        pet.vx = 0;
        pet.onGround = true;
        squash = 0.45;
        burstP('crumb', pet.x, GROUND, 4, {
          spread: 70, up: 55, size: 5, life: 0.5, gravity: 300,
        });
      }
    }
    squash = Math.max(0, squash - dt * 1.9);
  }

  /* ================= 绘制 ================= */

  /** 粒子发射统一入口：受「显示粒子特效」开关控制 */
  function emitP(args) {
    if (!config.appear.showParticles) return;
    particles.emit(args);
  }
  function burstP(kind, x, y, n, opts) {
    if (!config.appear.showParticles) return;
    particles.burst(kind, x, y, n, opts);
  }

  function computeMods() {
    const m = { bob: 0, squashY: 1, squashX: 1, tilt: 0, scaleMul: poseCur, prevScaleMul: posePrev };
    if (config.appear.reduceMotion) {
      // 减少动态效果：跳过程序化微动与落地位移缓冲（姿态级尺寸校正保留——它是尺寸不是动效）
      return m;
    }
    // 动画时间轴：程序化微动频率随动作速度缩放（time 保持真实时间轴，用于冷却等）
    const at = animTime;
    switch (fsm.name) {
      case 'idle': {
        // 帧序列已含呼吸起伏，程序化微动仅作极轻微补充
        // 尺寸恒定：呼吸起伏只用位移（bob）表达，不做 squash 非等比缩放
        const tiers = needVoiceOn() ? needTiers() : null;
        // 心情好：呼吸幅度略放大、节奏稍快（正反馈，肉眼可感但不夸张）
        const moodGood = tiers && tiers.happiness === 'good';
        const f = moodGood ? 2.3 : 1.9;
        m.bob = Core.wave(at, f, moodGood ? 1.15 : 0.8);
        // 脏到极危：每 3.6s 来一次 0.6s 的高频轻抖，表现「痒 / 不舒服」
        // 幅度压到 ±1px——帧序列本身已含起伏，幅度大了会出现「双重动画」
        if (tiers && tiers.cleanliness === 'critical' && (at % 3.6) < 0.6) {
          m.bob += Math.sin(at * 37) * 1.0;
        }
        break;
      }
      case 'walk':
        // 帧序列已包含腿部动作，程序化微动仅作补充，幅度收敛避免“双重动画”
        m.bob = -Math.abs(Math.sin(at * 9)) * 2.4;
        m.tilt = Math.sin(at * 9) * 0.02;
        break;
      case 'run':
        m.bob = -Math.abs(Math.sin(at * 13)) * 3.2;
        m.tilt = Math.sin(at * 13) * 0.04;
        break;
      case 'sleep':
        // 帧序列已含呼吸起伏；尺寸恒定，不再叠加 squash 拉伸
        break;
      case 'drag':
        m.tilt = Math.sin(at * 6) * 0.13;
        break;
      case 'eat':
        // 帧序列已含低头/咀嚼动作，仅保留轻微起伏
        m.bob = Math.abs(Math.sin(at * 7)) * 1.0;
        break;
      case 'play':
        m.bob = -Math.abs(Math.sin(at * 11)) * 1.5;
        break;
      case 'meow':
        m.bob = -Math.abs(Math.sin(at * 6)) * 1.0;
        break;
      case 'bath':
        // 帧序列已含抖身/泡泡动作，仅保留轻微起伏模拟水面（位移，不改尺寸）
        m.bob = Core.wave(at, 1.6, 1.0);
        break;
      case 'tailwag':
        // 帧序列已含尾巴摆动，微动仅保留轻微呼吸
        m.bob = Core.wave(at, 2.4, 1.0);
        break;
      case 'lick':
        // 帧序列已含抬爪/舔舐，只留极轻微呼吸（位移，不改尺寸）
        m.bob = Core.wave(at, 2.0, 0.8);
        break;
      case 'unhappy':
        // 慢速下沉起伏，蔫蔫的感觉（位移，不改尺寸——伤心动作也不得变大变小）
        m.bob = Core.wave(at, 1.1, 1.8);
        break;
      case 'jump':
      case 'fall':
        m.tilt = clamp(pet.vy / 1600, -0.12, 0.12);
        break;
      default:
        break;
    }
    // 尺寸恒定：落地缓冲改为「下蹲位移」（整体下压再弹回），不再做非等比缩放
    m.bob += squash * LAND_DIP;
    return m;
  }

  /**
   * 地面阴影圆盘。半径随宠物体型等比缩放（k = 当前体型 / 设计基准体型），
   * 并按离地高度同步淡出/收缩，保证与猫脚接触面始终匹配。
   */
  function drawShadow() {
    if (!config.appear.showShadow) return;
    const k = sizeCur / BASE_SCALE;                        // 体型缩放系数（平滑值，无跳变）
    const ks = shadowKCur;                                 // 姿态体积修正（平滑值）
    const lift = clamp(1 - (-pet.y) / SHADOW_LIFT, 0.22, 1); // 离地越高越小越淡
    ctx.save();
    ctx.globalAlpha = SHADOW_ALPHA * lift;
    ctx.fillStyle = '#33302c';
    ctx.beginPath();
    ctx.ellipse(
      pet.x,
      GROUND + 7 * k,
      SHADOW_RX * k * ks * lift,
      SHADOW_RY * k * ks * lift,
      0, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.restore();
  }

  function drawBowl(x, y, k) {
    k = k == null ? 1 : k;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    // 食物
    ctx.fillStyle = '#c9a06a';
    ctx.beginPath();
    ctx.arc(0, -3, 19, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    // 碗身
    ctx.fillStyle = '#a1887f';
    ctx.beginPath();
    ctx.moveTo(-31, 0);
    ctx.quadraticCurveTo(0, 30, 31, 0);
    ctx.closePath();
    ctx.fill();
    // 碗沿
    ctx.fillStyle = '#8d6e63';
    ctx.beginPath();
    ctx.ellipse(0, 1, 32, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function render(dt) {
    ctx.clearRect(0, 0, W, H);
    drawShadow();
    // 进食中隐藏程序碗：eat 素材自带食碗（已通过对齐逻辑落到 food.x 上），
    // 两只碗同屏会呈现「猫和猫粮错位」
    if (food && fsm.name !== 'eat') drawBowl(food.x, GROUND, sizeCur / BASE_SCALE);
    const mods = computeMods();
    animator.draw(ctx, {
      x: pet.x,
      y: GROUND + pet.y,
      scale: sizeCur,
      facing: pet.facing,
      mods,
    });
    particles.draw(ctx);
    updateBubbleLayout(mods, dt);
  }

  /* ================= 主循环 ================= */

  let last = performance.now();

  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    time += dt;
    const asp = animSpeed();
    animTime += dt * asp;
    bubblePop = Math.min(1, bubblePop + dt / 0.16);

    updatePhysics(dt);
    fsm.update(dt);
    // 姿态/体型变化在帧级做指数平滑，杜绝切姿态那一帧的体型突变（须在 fsm 之后、绘制之前）
    updateScaleSmoothing(dt);
    animator.update(dt * asp);
    particles.update(dt);
    decayStats(dt);

    // 属性驱动：① 跨档即时反应 ② 危急需求实时中断（不等待决策 tick）
    checkNeedTransitions();
    maybeUrgent();
    // 被交互结算台词挡下的跨档反应，等保护窗口结束再补发
    if (pendingNeed && time - lastSettleBubble >= SETTLE_GUARD) {
      const p = pendingNeed;
      pendingNeed = null;
      needBubble(p.statKey, p.key, NEED_REACT_CD, true);
    }

    // 气泡看门狗：定时器万一被取消而 .show 没摘，这里 20s 内一定收掉
    if (bubbleEl.classList.contains('show') && time - bubbleShownAt > BUBBLE_MAX_LIFE) hideBubble();

    // 状态面板实时数据（0.25s 节流；面板关闭时不推送）
    // AI 自主调度：每 5s 判一次是否到点、是否够安静
    ai.tickT -= dt;
    if (ai.tickT <= 0) {
      ai.tickT = 5;
      maybeAutoTalk();
    }

    statsPushT -= dt;
    if (statsPushT <= 0) {
      // 面板打开时 0.25s 一次（面板要跟手）；关闭时 1s 一次——不能因为面板关着就不推：
      // 主进程的 config.runtime.stats 靠这条通道保持新鲜，否则落盘/退出/迁移拿到的都是
      // 落后一个 saveInterval 的旧值。交互结算会先把 statsPushT 置 0 立即补推一次。
      statsPushT = config.appear.statusPanel ? 0.25 : 1;
      if (api && api.pushStats) {
        api.pushStats({
          stats: pet.stats,
          tiers: needVoiceOn() ? needTiers() : NP.NEUTRAL_TIERS,
          bubble: bubbleEl.classList.contains('show') ? bubbleEl.textContent : '',
        });
      }
    }

    render(dt);
    updateMousePass();

    requestAnimationFrame(frame);
  }

  /* ================= 配置变更（主进程广播） ================= */

  function onConfigChanged(payload) {
    if (!payload || !payload.config) return;
    // 自回声过滤：渲染进程每 saveInterval 秒把 runtime.stats 节流落盘，主进程合并后
    // 原样广播回来。若照常 applyConfig，会用「发出时刻的快照」覆盖 pet.stats——
    // IPC 往返期间刚结算的喂食/逗玩收益会被整体回滚（表现为交互后状态面板不动）。
    // 纯 runtime.stats 回声不含任何视觉项，直接忽略；真实外部变更（重置/导入）
    // 不会单独改 runtime.stats，不受影响。
    const changed = Array.isArray(payload.changed) ? payload.changed : [];
    // statsReset：属性来自外部权威数据（迁移 / 导入等整体替换），需要采纳；
    // 生产路径启动后不会出现，测试沙箱用它注入初始属性。
    const statsReset = payload.statsReset === true;
    if (!statsReset && changed.length > 0 && changed.every((p) => p === 'runtime.stats')) return;
    const prevSens = lastSensitivity;
    config = payload.config;
    // 运行期配置类广播一律不采纳主进程属性快照：属性只由渲染进程改写（详见 applyConfig 注释）。
    applyConfig(statsReset);
    // 灵敏度变化会整体平移阈值：重建档位快照，但**不**触发跨档反应
    if (sensitivity() !== prevSens) resetTierSnapshot();
  }

  /** 当前灵敏度档（宽松 / 标准 / 严格） */
  function sensitivity() {
    return (config.behavior && config.behavior.needSensitivity) || 'standard';
  }

  /**
   * 静默重建档位快照：用于灵敏度切换、启动初始化与实机调试，
   * 只同步当前档位、不产生任何气泡或行为。
   */
  function resetTierSnapshot() {
    lastSensitivity = sensitivity();
    for (let i = 0; i < NP.KEYS.length; i++) {
      const k = NP.KEYS[i];
      const v = Number.isFinite(pet.stats[k]) ? pet.stats[k] : 80;
      tierSnapshot[k] = NP.resolve(k, v, null, lastSensitivity);
    }
    pendingNeed = null;
  }

  /* ================= 启动 ================= */

  async function boot() {
    if (api) {
      try {
        config = await api.getConfig();
      } catch (_) { /* 忽略，使用默认值 */ }
    }
    applyConfig(true);     // 启动：以配置里的属性为初始值
    resetTierSnapshot();   // 初始化档位快照（静默，不产生气泡）
    lastInteraction = time;
    // 起始状态：鼠标未悬停猫身时窗口不拦截桌面点击
    if (api && api.setMouseIgnore && !config.interact.clickThrough) api.setMouseIgnore(true);

    await animator.loadAll(SPRITE_FILES, SPRITE_FPS);
    // 兜底：FSM 构造时（素材尚未加载）idle.enter 中的 play 会被 has() 拦截，
    // 导致 current 仍为 null、猫不显示。这里补一次初始姿态。
    animator.play('idle', 0.45);
    if (api) {
      api.onAction(handleAction);
      if (api.onConfigChanged) api.onConfigChanged(onConfigChanged);
      if (api.onPanelSide) api.onPanelSide((s) => { panelSide = s || null; });
      if (api.onScreenEdge) api.onScreenEdge((e) => {
        screenEdge = e && Number.isFinite(e.lo) && Number.isFinite(e.hi) ? e : null;
        clampX();
      });
      if (api.onAiSay) api.onAiSay(onAiSay);
      if (api.onAiBusy) api.onAiBusy(onAiBusy);
      if (api.onAiDone) api.onAiDone(onAiDone);
      scheduleNextTalk();   // 启动后 6–15min（按设置）才可能自己开口
    }

    showBubble(bubble('welcome'), 'welcome');
    requestAnimationFrame(frame);
  }

  boot().catch((err) => console.error('[boot] 启动失败:', err));
})();
