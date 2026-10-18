/**
 * particles.js — 轻量粒子系统
 * 支持爱心、Zzz、食物碎屑、星星等，纯代码绘制，无需额外素材。
 */
'use strict';

const Particles = (() => {
  const TAU = Math.PI * 2;

  const DRAWS = {
    heart(ctx, s) {
      ctx.beginPath();
      ctx.moveTo(0, s * 0.3);
      ctx.bezierCurveTo(-s, -s * 0.45, -s * 0.42, -s * 1.05, 0, -s * 0.42);
      ctx.bezierCurveTo(s * 0.42, -s * 1.05, s, -s * 0.45, 0, s * 0.3);
      ctx.closePath();
      ctx.fill();
    },
    zzz(ctx, s) {
      ctx.font = `600 ${Math.round(s * 1.5)}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Z', 0, 0);
    },
    crumb(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.42, 0, TAU);
      ctx.fill();
    },
    star(ctx, s) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s : s * 0.45;
        const a = (i / 10) * TAU - Math.PI / 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    },
    ball(ctx, s) {
      const g = ctx.createLinearGradient(-s * 0.6, -s * 0.6, s * 0.6, s * 0.6);
      g.addColorStop(0, '#ff8a80');
      g.addColorStop(1, '#d64545');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.34, -0.6, 1.9);
      ctx.stroke();
    },
    /* 洗澡泡泡：半透白圆 + 左上高光点 */
    foam(ctx, s) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.55, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1, s * 0.12);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(-s * 0.18, -s * 0.2, Math.max(1, s * 0.14), 0, TAU);
      ctx.fill();
    },
  };

  const COLORS = {
    heart: ['#ff7d9c', '#ff5f8a', '#ff9bb3'],
    zzz: ['#8fa3c8', '#7f95bb'],
    crumb: ['#c9a06a', '#b08a52', '#d8b483'],
    star: ['#ffd76e', '#ffe6a3', '#ffc94d'],
    ball: ['#e05252'],
    foam: ['rgba(214,240,250,0.92)', 'rgba(228,246,252,0.9)', 'rgba(196,232,246,0.92)'],
  };

  class ParticleSystem {
    constructor() {
      this.list = [];
    }

    /** 发射一个粒子 */
    emit(opts) {
      const {
        kind = 'star', x = 0, y = 0,
        vx = 0, vy = 0,
        gravity = 0,
        size = 8,
        life = 1,
        decay = 1,
        spin = 0,
        color = null,
        fade = true,
        fadeTail = 0,          // >0 时在生命最后这段秒数内淡出（fade:false 也生效）
        fixedSize = false,     // 生命末期不缩小（玩具球这类实心物体）
        bounce = 0,
        drag = 0,              // 落地滚动阻尼（1/s），bounce>0 停跳后生效
        restLife = 0,          // 停稳后还停留多久再淡出（秒）；0 表示按原生命走完
        groundY = Infinity,
        minX = null,           // 横向可活动区间：撞边反弹，防止飞出窗口后「凭空消失」
        maxX = null,
      } = opts;
      const palette = COLORS[kind] || COLORS.star;
      this.list.push({
        kind, x, y, vx, vy, gravity,
        size, life, maxLife: life, decay, spin,
        rot: Math.random() * TAU,
        color: color || palette[Math.floor(Math.random() * palette.length)],
        fade, fadeTail, fixedSize, bounce, drag, restLife, groundY, minX, maxX,
        rolling: false,
      });
    }

    /** 批量发射 */
    burst(kind, x, y, count, opts = {}) {
      const {
        spread = 90, up = 120, size = 8, life = 1.1, gravity = 40,
      } = opts;
      for (let i = 0; i < count; i++) {
        this.emit({
          kind, x: x + Core.rand(-10, 10), y: y + Core.rand(-8, 8),
          vx: Core.rand(-spread, spread), vy: Core.rand(-up, -up * 0.25),
          gravity, size: size * Core.rand(0.75, 1.25),
          life: life * Core.rand(0.8, 1.2),
          spin: Core.rand(-2.5, 2.5),
        });
      }
    }

    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.life -= dt * p.decay;
        if (p.life <= 0) {
          this.list.splice(i, 1);
          continue;
        }
        p.vy += p.gravity * dt;
        // 落地滚动：滚动阶段受阻尼，速度归零后停住（而不是被硬删除）
        if (p.rolling && p.drag > 0) p.vx *= Math.max(0, 1 - p.drag * dt);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // 地面弹跳（玩具小球）
        if (p.bounce > 0 && p.y > p.groundY && p.vy > 0) {
          p.y = p.groundY;
          p.vy = -p.vy * p.bounce;
          p.vx *= 0.82;
          // 弹不动了就转入贴地滚动（旧实现这里直接把 life 砍到 0.35s，
          // 且 fade:false 不做淡出 → 球「啪」地凭空消失）
          if (Math.abs(p.vy) < Math.max(24, 40 * (p.size / 20))) {
            p.vy = 0;
            p.y = p.groundY;
            p.rolling = true;
            // 停稳后不再傻等到总生命结束：留下一小段静止时间就淡出
            if (p.restLife > 0) p.life = Math.min(p.life, p.restLife + p.fadeTail);
          }
        }
        if (p.rolling && Math.abs(p.vx) < 6) p.vx = 0;
        // 横向边界：撞到窗口边缘反弹，避免球滚出画面后再也看不见
        if (p.minX != null && p.x < p.minX) {
          p.x = p.minX;
          p.vx = Math.abs(p.vx) * 0.6;
        } else if (p.maxX != null && p.x > p.maxX) {
          p.x = p.maxX;
          p.vx = -Math.abs(p.vx) * 0.6;
        }
        p.rot += p.spin * dt;
      }
    }

    draw(ctx) {
      for (const p of this.list) {
        const k = Core.clamp(p.life / p.maxLife, 0, 1);
        let alpha = p.fade ? k : 1;
        if (p.fadeTail > 0 && p.life < p.fadeTail) {
          alpha = Math.min(alpha, p.life / p.fadeTail);
        }
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const s = p.fixedSize ? p.size : p.size * (0.6 + 0.4 * k);
        ctx.fillStyle = p.color;
        (DRAWS[p.kind] || DRAWS.star)(ctx, s);
        ctx.restore();
      }
    }

    clear() {
      this.list.length = 0;
    }

    /** 只清掉某一类粒子（再次逗玩时收走上一只球，避免地上越滚越多） */
    clearKind(kind) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        if (this.list[i].kind === kind) this.list.splice(i, 1);
      }
    }
  }

  return ParticleSystem;
})();
