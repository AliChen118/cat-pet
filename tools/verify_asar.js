/* 校验打包产物内的 asar 内容：版本、舔爪节奏常量、帧清单逐帧 MD5。
 * 用法：node tools/verify_asar.js <asar 路径> [磁盘 frames 目录]
 * 默认：dist-113-r2/win-unpacked/resources/app.asar + app/assets/sprites/frames
 * 只读校验，不启动应用，不影响正在运行的实例。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const asar = require('../app/node_modules/@electron/asar');

const ROOT = path.resolve(__dirname, '..');
const ASAR = path.resolve(ROOT, process.argv[2] || 'dist-113-r2/win-unpacked/resources/app.asar');
const DISK = path.resolve(ROOT, process.argv[3] || 'app/assets/sprites/frames');

let fail = 0;
const ok = (c, m) => { console.log(`[${c ? 'ok' : 'FAIL'}] ${m}`); if (!c) fail++; };
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

if (!fs.existsSync(ASAR)) {
  console.error(`[FAIL] 找不到 asar: ${ASAR}`);
  process.exit(1);
}
console.log(`asar  : ${ASAR}  ${(fs.statSync(ASAR).size / 1048576).toFixed(1)} MB`);
console.log(`磁盘帧: ${DISK}\n`);

// ---- 1. 版本 ----
const pkg = JSON.parse(asar.extractFile(ASAR, 'package.json').toString('utf8'));
ok(/^\d+\.\d+\.\d+$/.test(pkg.version), `package.json version = ${pkg.version}`);
ok(pkg.main === 'main.js', `main = ${pkg.main}`);

// ---- 2. 舔爪节奏常量（本轮改动的全部落点） ----
const src = asar.extractFile(ASAR, 'renderer.js').toString('utf8');
const grab = (re) => { const m = src.match(re); return m ? m[1] : null; };
const fps = grab(/lick:\s*(\d+)\s*,/);
const lfps = grab(/const LICK_FPS\s*=\s*([\d.]+)/);
const lhold = grab(/const LICK_HOLD\s*=\s*([\d.]+)/);
const lrounds = grab(/const LICK_ROUNDS_EAT\s*=\s*(\d+)/);
const lcd = grab(/const LICK_CD\s*=\s*(\d+)/);
ok(fps === '5', `SPRITE_FPS.lick = ${fps}（应为 5）`);
ok(lfps === '5', `LICK_FPS = ${lfps}（应为 5）`);
ok(lhold === '0.15', `LICK_HOLD = ${lhold}（应为 0.15）`);
ok(lrounds === '2', `LICK_ROUNDS_EAT = ${lrounds}（应为 2）`);
ok(lcd === '90', `LICK_CD = ${lcd}（应为 90）`);
if (lfps && lhold) {
  const cycle = 4 / Number(lfps) + Number(lhold);
  ok(Math.abs(cycle - 0.95) < 0.002, `单轮 ${cycle.toFixed(4)} s ≈ 0.95 s（4/${lfps} + ${lhold}）`);
}
ok(/lick:\s*\[/.test(src) && (src.match(/lick_\d\.png/g) || []).length === 4, 'lick 注册 4 帧');
ok(/states\.lick|\n\s*lick:\s*\{/.test(src), 'lick 状态已注册');
ok(/hold:\s*LICK_HOLD_MAP/.test(src), 'hold 映射已传入 play');
ok(/LICK_HOLD_MAP\s*=\s*\{\s*1:/.test(src), 'LICK_HOLD_MAP 只作用于帧索引 1');

// ---- 2b. 残影 / 截断修复落点（1.1.4） ----
const anim = asar.extractFile(ASAR, path.join('engine', 'animator.js')).toString('utf8');
ok(/NO_FRAME_BLEND\s*=\s*new Set\([^)]*'lick'[^)]*\)/.test(anim), 'animator: lick 排除帧间插值');
ok(/NO_FRAME_BLEND\s*=\s*new Set\([^)]*'walk'[^)]*\)/.test(anim) && /'run'[^)]*\)/.test(anim),
  'animator: 走/跑同样排除帧间插值（相邻帧 IoU 0.56–0.75）');
ok(/lapsDone\(\)\s*<\s*WALK_MIN_LOOPS/.test(src) && /atCycleStart\(\)/.test(src),
  'renderer: 走/跑满 2 轮且只在循环首帧收尾');
ok(/frameDur\(name, idx\)/.test(anim) && /clamp01\(frameTime \/ curDur\)/.test(anim),
  'animator: 插值窗口按实际停留时长计算并夹取');
ok(/lickEnd\s*=\s*animator\.clock/.test(src) && !/lickTimer\s*-=/.test(src),
  'renderer: 舔爪结束挂动画时钟（弃用墙钟）');
ok(/LICK_END_TRIM/.test(src), `renderer: 收尾提前半帧（LICK_END_TRIM = ${grab(/const LICK_END_TRIM\s*=\s*([\d.]+)/)}）`);

// ---- 2c. 摇尾巴残影 / 体型 / 状态分布（1.1.6） ----
ok(/NO_FRAME_BLEND\s*=\s*new Set\([^)]*'tailwag'[^)]*\)/.test(anim),
  'animator: tailwag 排除帧间插值（相邻帧 IoU 0.76–0.92）');
const poseScale = grab(/const POSE_SCALE = \{([^}]*)\}/) || '';
ok(!/tailwag/.test(poseScale), `renderer: POSE_SCALE 不再含 tailwag（{${poseScale.trim()}}）→ 运行期系数恒为 1`);
ok(/pet\.tailwagEnd = animator\.clock \+ Core\.rand/.test(src),
  'renderer: 摇尾巴计时挂动画时钟');
ok(/animator\.clock < pet\.tailwagEnd/.test(src) && /atCycleStart\(\) \? 'idle'/.test(src),
  'renderer: 摇尾巴「时间到 + 循环首帧」双条件退出');
const tiers = {};
for (const tier of ['low', 'normal', 'high']) {
  const m = src.match(new RegExp('\\b' + tier + ':\\s*\\{([^}]*think[^}]*)\\}'));
  if (!m) continue;
  const o = {};
  const re = /(\w+):\s*([0-9.]+)/g;
  let g;
  while ((g = re.exec(m[1]))) o[g[1]] = Number(g[2]);
  tiers[tier] = o;
}
ok(Object.keys(tiers).length === 3, `ACTIVITY 三档齐全: ${Object.keys(tiers).join('/')}`);
for (const tier of Object.keys(tiers)) {
  const o = tiers[tier];
  const keys = Object.keys(o).filter((k) => k !== 'think');
  const sum = keys.reduce((s, k) => s + o[k], 0);
  const top = keys.slice().sort((x, y) => o[y] - o[x])[0];
  ok(top === 'idle' && Math.abs(sum - 1) < 1e-9,
    `ACTIVITY.${tier}: idle=${o.idle} 为第一权重（walk ${o.walk} / run ${o.run}），权重和 ${sum.toFixed(2)}`);
}

// ---- 3. 帧清单逐帧比对 ----
const asarFrames = asar.listPackage(ASAR)
  .map((p) => p.replace(/\\/g, '/'))
  .filter((p) => /^\/assets\/sprites\/frames\/[^/]+\.png$/.test(p))
  .map((p) => p.split('/').pop())
  .sort();
const diskFrames = fs.readdirSync(DISK).filter((f) => f.endsWith('.png')).sort();

ok(asarFrames.length === diskFrames.length,
  `帧数量一致: asar ${asarFrames.length} / 磁盘 ${diskFrames.length}`);
const miss = diskFrames.filter((f) => !asarFrames.includes(f));
const extra = asarFrames.filter((f) => !diskFrames.includes(f));
ok(miss.length === 0, `asar 无缺帧${miss.length ? ': ' + miss.join(',') : ''}`);
ok(extra.length === 0, `asar 无多余帧${extra.length ? ': ' + extra.join(',') : ''}`);

let same = 0; const diff = [];
// 注意：Windows 下 @electron/asar 的 extractFile 只认 path.sep 分隔的路径，
// 传正斜杠会报 "was not found in this archive"。
const fr = (...p) => p.join(path.sep);
for (const f of diskFrames) {
  if (!asarFrames.includes(f)) continue;
  const a = md5(asar.extractFile(ASAR, fr('assets', 'sprites', 'frames', f)));
  const b = md5(fs.readFileSync(path.join(DISK, f)));
  if (a === b) same++; else diff.push(f);
}
ok(diff.length === 0, `逐帧 MD5 一致: ${same}/${diskFrames.length}${diff.length ? '，不一致: ' + diff.join(',') : ''}`);

const lickFrames = diskFrames.filter((f) => f.startsWith('lick_'));
ok(lickFrames.length === 4 && lickFrames.every((f) => asarFrames.includes(f)),
  `lick_1..4 均在包内（${lickFrames.join(',')}）`);

const wagFrames = diskFrames.filter((f) => f.startsWith('tailwag_'));
ok(wagFrames.length === 4 && wagFrames.every((f) => asarFrames.includes(f)),
  `tailwag_1..4 均在包内（${wagFrames.join(',')}）`);

console.log('');
if (fail) { console.error(`[FAIL] ${fail} 项未通过`); process.exit(1); }
console.log('[PASS] asar 校验全部通过');
