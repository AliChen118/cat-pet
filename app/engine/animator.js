/**
 * animator.js — 精灵动画器（支持帧序列与帧间插值）
 *
 * 职责：
 *   1. 素材加载：每个姿态可以是单图或一组帧序列；
 *   2. 状态过渡：姿态切换时交叉淡化（fade）；
 *   3. 帧间插值：在每帧时段的后 35% 与下一帧交叉淡入，
 *      使有限帧数也具备顺滑观感（等效于补充中间帧）；
 *   4. 程序化形变：呼吸、下沉、挤压、倾斜。
 *
 * 所有帧统一为 512x512 画布，内容底边对齐 y=470、躯干中心对齐 x=256，
 * 以 (anchorX, anchorY) 作为「猫的落地点」渲染即可保证各帧不错位。
 */
'use strict';

const SPRITE_SIZE = 512;
const SPRITE_GROUND = 470;
const SPRITE_CENTER = 256;
const FRAME_BLEND = 0.35; // 帧间插值窗口占单帧时长的比例

/**
 * 不做帧间插值的姿态：这些序列是「手绘关键帧」，相邻帧姿态差异大。
 *
 * 判据：相邻帧 alpha 掩膜最小 IoU < 0.90。插值实现是「当前帧实心 + 下一帧按 k
 * 叠上去」，差异大的姿态会让两个轮廓同时可见——双爪 / 双头 / 两条尾巴 /
 * 两只球（play）/ 两个食盆（eat），因此这类姿态直接硬切。
 *
 * 实测最小相邻帧 IoU（素材归一化后复测，跑 tools/check/pose_iou.py 可复现）：
 *   run 0.59　jump 0.68　walk 0.69　stretch 0.75　tailwag 0.77　bath 0.79
 *   unhappy 0.80　play 0.82　eat 0.84　lick 0.86　　← 全部硬切
 *   sleep 0.94　pet 0.94　idle 0.98　meow 0.99　　　← 保留插值（差异小，淡化更顺）
 *
 * 新增姿态时先跑一次 pose_iou.py：<0.90 就加进这个集合，否则会出现残影。
 */
const NO_FRAME_BLEND = new Set([
  'run', 'jump', 'walk', 'stretch', 'tailwag',
  'bath', 'unhappy', 'play', 'eat', 'lick',
]);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 内容顶部静态回退表（sprite 像素坐标，数值越小越高）。
 * 由 tools/sprites/sprite_bounds.py 生成；运行时会优先用画布实测值，
 * 仅在实测不可用（如无头环境 / 跨域素材）时回退到这里。
 * 取姿态内最高帧（顶值最小）作为姿态级常量，保证同姿态下气泡不抖动。
 */
const CONTENT_TOP_FALLBACK = {
  idle: 130, walk: 99, run: 110, jump: 112, stretch: 130, drag: 99,
  sleep: 130, eat: 130, play: 99, pet: 91, meow: 128, tailwag: 101,
  unhappy: 131, bath: 93, lick: 104,
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`素材加载失败: ${src}`));
    img.src = src;
  });
}

/**
 * 实测素材内容顶部（sprite 像素）。用于把气泡/挂件精确定位到猫头顶。
 * 无头或受限环境下返回 -1，由调用方回退到静态表。
 */
function measureContentTop(img) {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return -1;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext && c.getContext('2d');
    if (!g || !g.getImageData) return -1;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (d[row + x * 4 + 3] > 8) return y;
      }
    }
  } catch (_) { /* 忽略：回退到静态表 */ }
  return -1;
}

class Animator {
  constructor() {
    this.sprites = {};      // name -> [img, ...]
    this.fps = {};          // name -> 帧率
    this.tops = {};         // name -> [内容顶部像素, ...]（-1 表示实测不可用）
    this.current = null;
    this.prev = null;
    this.prevFrame = 0;
    this.blend = 1;
    this.fadeDur = 0.18;
    this.frameIndex = 0;
    this.frameTime = 0;
    this.once = false;
    this.holdMap = null;    // 逐帧停留覆盖：{ 帧索引: 时长秒 }，null = 全部用 1/fps
    this.laps = 0;          // 本次 play 内已完成的完整循环数（走/跑的最少轮数门禁靠它）

    /* ---- 待机眨眼控制（仅 idle 姿态生效） ----
     * blinkCfg 由渲染进程按设置写入；null = 保持旧的整序列循环。
     *   active     常态循环的帧索引（跳过困倦/闭眼帧）
     *   blinkFrame 闭眼帧索引（眨眼时插播）
     *   meanGap    平均眨眼间隔（秒）；<=0 表示不眨眼
     * 每次眨眼后按 ±45% 均匀随机排下一次，避免固定周期的机械感。 */
    this.blinkCfg = null;
    this.clock = 0;          // 动画累计时钟（秒）
    this.blinkAt = Infinity; // 下次眨眼时刻（clock 域）
    this.blinkHold = 0;      // 闭眼剩余时长
    this.blinkReturn = 0;    // 眨眼结束后恢复到的帧
    this.nextIdx = null;     // 帧间插值的「下一帧」索引（null = idx+1，供 idle 专用）
    this.gapSeen = null;     // 上一次生效的 meanGap（用于检测频率变更并立即重排）
  }

  /**
   * @param {Object<string, string[]>} map 姿态名 -> 帧路径数组
   * @param {Object<string, number>} fpsMap 姿态名 -> 帧率
   */
  async loadAll(map, fpsMap) {
    const entries = await Promise.all(
      Object.entries(map).map(async ([name, frames]) => [
        name,
        await Promise.all(frames.map(loadImage)),
      ])
    );
    entries.forEach(([name, frames]) => {
      this.sprites[name] = frames;
      this.tops[name] = frames.map(measureContentTop);
    });
    this.fps = Object.assign({}, fpsMap || {});
    return Object.keys(this.sprites);
  }

  /**
   * 当前正在绘制姿态的内容顶部（sprite 像素坐标）。
   * 过渡期取上一姿态与当前姿态中更高者，避免气泡在切换瞬间穿模。
   */
  contentTop() {
    const pick = (name, idx) => {
      const arr = this.tops[name];
      const v = arr ? arr[idx % arr.length] : -1;
      if (v >= 0) return v;
      const fb = CONTENT_TOP_FALLBACK[name];
      return fb == null ? 70 : fb;
    };
    let top = SPRITE_SIZE;
    if (this.prev && this.blend < 1) top = Math.min(top, pick(this.prev, this.prevFrame));
    if (this.current) top = Math.min(top, pick(this.current, this.frameIndex));
    return top === SPRITE_SIZE ? 70 : top;
  }

  has(name) {
    const seq = this.sprites[name];
    return !!seq && seq.length > 0;
  }

  /**
   * 某姿态某帧的实际停留时长（秒）。
   * 有 holdMap 覆盖时用覆盖值，否则 1/fps；帧间插值窗口必须按这个值算，
   * 否则被拉长的帧会让插值进度越过 1，出现「下一帧满不透明闪一下再消失」。
   */
  frameDur(name, idx) {
    const fps = this.fps[name] || 0;
    if (!(fps > 0)) return 0;
    if (this.holdMap && this.holdMap[idx] != null) return this.holdMap[idx];
    return 1 / fps;
  }

  frameCount(name) {
    const seq = this.sprites[name];
    return seq ? seq.length : 0;
  }

  /**
   * 切换姿态；fade 为状态交叉淡化时长（秒）。
   * opts.once: true 时顺序播放到最后一帧后定格（跳跃/伸懒腰等单次动作）；
   * opts.startAt: 起始帧索引（下落状态直接从腾空帧开始）；
   * opts.hold: { 帧索引: 秒 } 逐帧覆盖停留时长（如舔爪主帧加长），其余帧仍用 1/fps。
   */
  play(name, fade = 0.18, opts = {}) {
    if (!this.has(name) || this.current === name) return;
    if (name !== 'idle' || !this.blinkCfg) this.blinkHold = 0;   // 切走时终止未完的眨眼
    this.prev = this.current;
    this.prevFrame = this.frameIndex;
    this.current = name;
    this.blend = 0;
    this.fadeDur = Math.max(0.001, fade);
    this.once = !!opts.once;
    this.holdMap = opts.hold || null;
    this.frameIndex = opts.startAt ? opts.startAt | 0 : 0;
    this.frameTime = 0;
    this.laps = 0;
  }

  /** 本次 play 内已播完的完整循环数 */
  lapsDone() {
    return this.laps;
  }

  /** 是否停在循环首帧（走/跑只允许在这里切换状态，收势才自然） */
  atCycleStart() {
    return this.frameIndex === 0;
  }

  /** 某姿态单轮时长（秒，动画时间）；无该姿态或帧率异常时返回 0 */
  cycleSec(name) {
    const seq = this.sprites[name];
    const fps = this.fps[name] || 0;
    if (!seq || !seq.length || !(fps > 0)) return 0;
    return seq.length / fps;
  }

  update(dt) {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.fadeDur);
      if (this.blend >= 1) this.prev = null;
    }
    this.clock += dt;
    const seq = this.sprites[this.current];
    if (seq && seq.length > 1) {
      const fps = this.fps[this.current] || 10;
      const dur = 1 / fps;
      const bc = (this.current === 'idle' && this.blinkCfg) ? this.blinkCfg : null;

      if (bc) {
        /* ---- 随机眨眼循环：常态只在睁眼帧间轮播，到点插播闭眼帧 ---- */
        this.frameTime += dt;
        // 频率被改（设置面板拖动滑杆）→ 立刻按新频率重排，不等旧周期走完
        if (bc.meanGap !== this.gapSeen) {
          this.gapSeen = bc.meanGap;
          if (bc.meanGap > 0) this._scheduleBlink(bc);
          else this.blinkAt = Infinity;
        }
        if (this.blinkAt === Infinity && bc.meanGap > 0) this._scheduleBlink(bc);   // 首次进入 idle 时排期

        // 闭眼中：定格闭眼帧；frameTime 继续走，末端 35% 由插值淡回睁眼帧（收尾不硬切）
        if (this.blinkHold > 0) {
          this.blinkHold -= dt;
          this.frameIndex = bc.blinkFrame;
          this.nextIdx = this.blinkReturn;
          if (this.blinkHold <= 0) {
            this.frameIndex = this.blinkReturn;
            this.frameTime = 0;
            this.nextIdx = this._activeNext(bc, this.frameIndex);
            this._scheduleBlink(bc);
          }
          return;
        }

        // 到点 → 开始眨眼：硬切入闭眼帧（现实眨眼也是这样闭上的），定格 1 帧时长
        if (this.clock >= this.blinkAt) {
          this.blinkReturn = this.frameIndex;
          this.blinkHold = dur;
          this.frameIndex = bc.blinkFrame;
          this.frameTime = 0;
          this.nextIdx = this.blinkReturn;
          return;
        }

        // 常态：只在 active 帧间循环
        let guardB = 0;
        while (this.frameTime >= dur && guardB++ < 16) {
          this.frameTime -= dur;
          this.frameIndex = this._activeNext(bc, this.frameIndex);
        }
        this.nextIdx = this._activeNext(bc, this.frameIndex);
        return;
      }

      // ---- 普通整序列循环（原逻辑） ----
      this.nextIdx = null;
      this.frameTime += dt;
      // 逐帧停留：opts.hold 覆盖当前帧的停留时长（舔爪主帧要停久一点）
      const durOf = (i) => this.frameDur(this.current, i);
      // 单次播放：到最后一帧定格，不再循环（避免跳跃在空中反复蹲起）
      if (this.once && this.frameIndex >= seq.length - 1) {
        this.frameTime = 0;
        return;
      }
      // 用 while 兼容低帧率或长帧间隔，避免丢帧
      let guard = 0;
      while (this.frameTime >= durOf(this.frameIndex) && guard++ < 16) {
        this.frameTime -= durOf(this.frameIndex);
        const nxt = (this.frameIndex + 1) % seq.length;
        if (nxt === 0) this.laps++;          // 环回 = 播完一整轮
        this.frameIndex = nxt;
        if (this.once && this.frameIndex >= seq.length - 1) { this.frameTime = 0; break; }
      }
    }
  }

  /** active 帧集合中的下一帧（当前帧不在集合时回到集合首帧） */
  _activeNext(bc, idx) {
    const a = bc.active;
    const i = a.indexOf(idx);
    return a[(i + 1) % a.length];
  }

  /** 排下一次眨眼：平均间隔 ±45% 均匀随机 */
  _scheduleBlink(bc) {
    if (!(bc.meanGap > 0)) { this.blinkAt = Infinity; return; }
    this.blinkAt = this.clock + bc.meanGap * (0.55 + Math.random() * 0.9);
  }

  /**
   * 绘制当前（及过渡中的上一个）姿态。
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} o { x, y, scale, facing, mods }
   */
  draw(ctx, o) {
    const { x, y, scale = 1, facing = 1, mods = {} } = o;
    // nextIdx 仅对「idle + 眨眼配置」有效；prev 姿态/其他姿态沿用 idx+1
    const useNext = (this.current === 'idle' && this.blinkCfg) ? this.nextIdx : null;

    if (this.prev && this.blend < 1) {
      // 离场画面必须用它自己的姿态缩放系数（mods.prevScaleMul）：
      // mods.scaleMul 是「进场」姿态的，直接复用会把仍在淡出的旧姿态一起缩放，
      // 表现为「整只猫先缩一下，再以新尺寸换成新姿态」。
      const prevMods = (mods.prevScaleMul != null && mods.prevScaleMul !== mods.scaleMul)
        ? Object.assign({}, mods, { scaleMul: mods.prevScaleMul })
        : mods;
      this._drawSeq(ctx, this.prev, this.prevFrame, 1 - this.blend, x, y, scale, facing, prevMods, 0, 0, null);
    }
    if (this.current) {
      this._drawSeq(
        ctx, this.current, this.frameIndex, this.blend,
        x, y, scale, facing, mods,
        this.frameTime, this.frameDur(this.current, this.frameIndex), useNext
      );
    }
  }

  /** 绘制一个姿态序列：当前帧 + 与下一帧的插值淡入（nextOverride 供眨眼循环指定后继帧） */
  _drawSeq(ctx, name, idx, alpha, x, y, scale, facing, mods, frameTime, curDur, nextOverride) {
    const seq = this.sprites[name];
    if (!seq || !seq.length || alpha <= 0) return;

    this._drawOne(ctx, seq[idx % seq.length], x, y, scale, facing, mods, alpha);

    // 帧间插值：curDur 是该帧的实际停留时长（含 hold 覆盖），窗口取其后 35%
    if (seq.length > 1 && curDur > 0 && !NO_FRAME_BLEND.has(name)) {
      const t = clamp01(frameTime / curDur);
      if (t > 1 - FRAME_BLEND) {
        const k = clamp01(Core.Ease.inOutQuad((t - (1 - FRAME_BLEND)) / FRAME_BLEND));
        const nxt = (nextOverride != null && nextOverride >= 0) ? nextOverride : (idx + 1) % seq.length;
        this._drawOne(ctx, seq[nxt], x, y, scale, facing, mods, alpha * k);
      }
    }
  }

  _drawOne(ctx, name, x, y, scale, facing, mods, alpha) {
    const img = typeof name === 'string' ? this.sprites[name] : name;
    const frame = Array.isArray(img) ? img[0] : img;
    if (!frame) return;

    const s = scale * (mods.scaleMul || 1);
    const sx = s * (mods.squashX || 1);
    const sy = s * (mods.squashY || 1);
    const bob = mods.bob || 0;
    const tilt = mods.tilt || 0;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * (mods.alpha != null ? mods.alpha : 1)));
    ctx.translate(x, y + bob);
    if (tilt) ctx.rotate(tilt * facing);
    ctx.scale(facing * sx, sy);
    // 缩放后按锚点偏移，使素材的 (256,470) 落在 (0,0)。
    // 注意：宽高不能再乘 sx/sy —— ctx.scale 已经负责缩放，
    // 重复相乘会使实际渲染尺寸变成 scale²，猫比设计尺寸小一圈，
    // 且阴影/命中区/气泡等按线性换算的部分全部错位。
    ctx.drawImage(frame, -SPRITE_CENTER, -SPRITE_GROUND, SPRITE_SIZE, SPRITE_SIZE);
    ctx.restore();
  }
}
