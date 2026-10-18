/**
 * fx.js — 特效定位与尺寸换算（纯逻辑，不碰 DOM/Canvas）
 *
 * 为什么需要它：
 * 爱心、Zzz、玩具球早期都用「窗口绝对像素」写死（如 GROUND-250、GROUND-150..215）。
 * 这些常量是按 100% 体型（scale 0.88，猫在窗口里约 300px 高）手调的；
 * 一旦把体型调到 30%（猫只有约 100px 高），特效仍固定在 250px 高处 —— 于是飘在猫头顶
 * 一百多像素之外、看起来「跟猫没关系」。
 *
 * 这里把换算收敛成两个纯函数：
 *   geom()  按当前头顶 / 可见高度算出特效该出现的坐标（贴着猫）
 *   scaleFactor() / sizeMul()  让特效的速度与尺寸跟着体型走，但保留看得见的下限
 */
'use strict';

const Fx = (() => {
  const REF_SCALE = 0.88;     // 100% 体型（与 config-schema 的 pet.size 上限/默认值一致）
  const WIDTH_RATIO = 0.46;   // 素材实测：内容半宽 / 内容高 ≈ 0.46（idle/pet/play/sleep 汇总取中位）
  const MIN_FACTOR = 0.5;     // 速度/尺寸缩放下限：再小的猫也留一半力度，避免特效看不见
  const MAX_FACTOR = 1.15;

  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /**
   * 特效力度/尺寸相对系数。
   * @param {number} scale 当前体型（pet.scale）
   * @returns {number} 0.5–1.15
   */
  function scaleFactor(scale) {
    return clamp(num(scale, REF_SCALE) / REF_SCALE, MIN_FACTOR, MAX_FACTOR);
  }

  /** 尺寸混合：小体型也保留 55% 以上大小，避免爱心/Z 缩成看不见的点 */
  function sizeMul(scale) {
    return 0.55 + 0.45 * scaleFactor(scale);
  }

  /**
   * 猫在窗口内的可见几何。
   * @param {{contentTop:number, spriteGroundY?:number, ground:number, y?:number,
   *          scale:number, poseScale?:number}} o
   *        contentTop 素材内容顶部（sprite 像素）；spriteGroundY 素材基线（默认 470）；
   *        ground 落地点；y 物理位移（跳跃时为负）；scale 体型；poseScale 姿态级校正
   * @returns {{top:number, h:number, halfW:number, bottom:number}}
   *        top 头顶 y、h 可见高、halfW 可见半宽、bottom 脚底 y
   */
  function geom(o) {
    const src = o || {};
    const scale = num(src.scale, REF_SCALE);
    const poseScale = num(src.poseScale, 1) || 1;
    const spriteGroundY = num(src.spriteGroundY, 470);
    const ground = num(src.ground, 0);
    const dy = num(src.y, 0);
    let contentTop = num(src.contentTop, 70);
    if (contentTop < 0 || contentTop > spriteGroundY) contentTop = 70;   // 实测失败时回退

    const h = Math.max(20, (spriteGroundY - contentTop) * scale * poseScale);
    const bottom = ground + dy;
    return {
      top: bottom - h,
      h,
      halfW: h * WIDTH_RATIO,
      bottom,
    };
  }

  return { REF_SCALE, WIDTH_RATIO, scaleFactor, sizeMul, geom };
})();
