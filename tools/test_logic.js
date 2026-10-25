/**
 * test_logic.js — 无头逻辑冒烟测试
 *
 * 两部分：
 *   A. Schema 单元断言：v1 迁移、越界夹紧、枚举回退、补丁合并、变更路径；
 *   B. 渲染进程行为：Node vm 模拟 DOM/Canvas，驱动数千帧，模拟交互与
 *      config-changed 广播，验证无运行时错误、姿态渲染、持久化、菜单、
 *      体型边界、语言切换、通知与设置入口。
 *
 * 运行： node tools/test_logic.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'app');
const Schema = require(path.join(ROOT, 'engine', 'config-schema.js'));
const I18N = require(path.join(ROOT, 'engine', 'i18n.js'));
const NP = require(path.join(ROOT, 'engine', 'needs-profile.js'));

let fail = 0;
function ok(cond, msg) {
  if (cond) console.log('[ok] ' + msg);
  else { console.error('[FAIL] ' + msg); fail = 1; }
}

/* ============================================================
 * A. Schema 单元断言
 * ============================================================ */

(function schemaTests() {
  console.log('--- Schema 单元断言 ---');

  // v1 扁平结构 → v2 分组迁移
  const legacy = {
    autoStart: true, muted: true, clickThrough: true,
    size: 0.7, x: 12, y: 34,
    stats: { hunger: 50, energy: 60, happiness: 70 },
  };
  const m = Schema.load(legacy).config;
  ok(m.startup.autoStart === true, '迁移: autoStart → startup.autoStart');
  ok(m.sound.muted === true, '迁移: muted → sound.muted');
  ok(m.interact.clickThrough === true, '迁移: clickThrough → interact.clickThrough');
  ok(Math.abs(m.pet.size - 0.704) < 1e-9,
    `迁移: size 0.7 → pet.size ${m.pet.size}（量化到 5% 网格，显示同为 80%）`);
  ok(m.runtime.x === 12 && m.runtime.y === 34, '迁移: x/y → runtime');
  ok(m.runtime.stats.hunger === 50, '迁移: stats → runtime.stats');
  ok(m.configVersion === Schema.CONFIG_VERSION, '迁移: configVersion 标记');

  // 越界夹紧
  const clamped = Schema.normalize({
    pet: { size: 5, petName: '' },
    sound: { volume: 999, bubbleDuration: 10, notifyInterval: -3 },
    appear: { theme: 'rainbow', language: 'fr-FR', uiScale: 500, opacity: 5 },
    behavior: { callInterval: 1000, activityLevel: 'crazy' },
    data: { saveInterval: 0, backupKeep: 99 },
  }).config;
  ok(clamped.pet.size === 0.88, `夹紧: size 5 → ${clamped.pet.size}（期望 0.88 = 100%）`);
  ok(clamped.pet.petName === '小银', '回退: 空名字 → 默认名');
  ok(clamped.sound.volume === 100, '夹紧: volume 999 → 100');
  ok(clamped.sound.bubbleDuration === 1200, '夹紧: bubbleDuration 10 → 1200');
  ok(clamped.sound.notifyInterval === 5, '夹紧: notifyInterval -3 → 5');
  ok(clamped.appear.theme === 'light', '回退: theme rainbow → light');
  ok(clamped.appear.language === 'zh-CN', '回退: language fr-FR → zh-CN');
  ok(clamped.appear.uiScale === 140, '夹紧: uiScale 500 → 140');
  ok(clamped.appear.opacity === 40, '夹紧: opacity 5 → 40');
  ok(clamped.behavior.callInterval === 300, '夹紧: callInterval 1000 → 300');
  ok(clamped.behavior.activityLevel === 'normal', '回退: activityLevel crazy → normal');
  ok(clamped.data.saveInterval === 5, '夹紧: saveInterval 0 → 5');
  ok(clamped.data.backupKeep === 3, '回退: backupKeep 99 → 默认 3');
  ok(clamped.behavior.animSpeed === 75, `默认: animSpeed 缺省 → ${clamped.behavior.animSpeed}（期望 75，v9 起新默认）`);
  ok(!Schema.ITEMS.language,
    '语言固定中文: 设置页语言切换项已下线（schema 无 language 条目）');
  ok(Schema.normalize({ appear: { language: 'en-US' } }).config.appear.language === 'zh-CN',
    '语言固定中文: 存量 en-US 配置归一化为 zh-CN');
  // 动作速度范围 20%–100%：越界值向两端夹紧
  const spItem = Schema.ITEMS.animSpeed;
  ok(spItem.min === 20 && spItem.max === 100 && spItem.step === 5,
    `动作速度范围: min=${spItem.min} / max=${spItem.max} / step=${spItem.step}（20%–100%，每格 5%）`);
  ok(spItem.fmt === 'pct' && spItem.max > 1,
    `动作速度显示: fmt=${spItem.fmt} 且 max>1 → 标签按整数百分比渲染（20% / 100%）`);
  const spClamp = Schema.normalize({ behavior: { animSpeed: 200 } }).config;
  ok(spClamp.behavior.animSpeed === 100, `夹紧: animSpeed 200 → ${spClamp.behavior.animSpeed}（期望 100）`);
  const spClampLo = Schema.normalize({ behavior: { animSpeed: 5 } }).config;
  ok(spClampLo.behavior.animSpeed === 20, `夹紧: animSpeed 5 → ${spClampLo.behavior.animSpeed}（期望 20）`);
  /* 界面显示与实际生效必须一致：renderer.js 的 animSpeed() 夹紧区间应等于 schema 的 min/max ÷ 100 */
  const rendererSrc = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  const mAnim = /function animSpeed\(\)\s*\{\s*return clamp\([^;]*?,\s*([\d.]+)\s*,\s*([\d.]+)\s*\);/.exec(rendererSrc);
  ok(!!mAnim, '动作速度: 已定位 renderer.js 中 animSpeed() 的夹紧区间');
  if (mAnim) {
    const lo = parseFloat(mAnim[1]);
    const hi = parseFloat(mAnim[2]);
    ok(Math.abs(lo - spItem.min / 100) < 1e-9 && Math.abs(hi - spItem.max / 100) < 1e-9,
      `动作速度一致性: 生效倍率区间 [${lo}, ${hi}] == 设置区间 [${spItem.min / 100}, ${spItem.max / 100}]`);
  }

  // 体型范围收窄到 20%–100%（0.176–0.88），旧版 50%–150% 的存量值必须被夹回
  const sizeItem = Schema.ITEMS.size;
  ok(sizeItem.min === 0.176 && sizeItem.max === 0.88 && sizeItem.step === 0.044,
    `体型范围: min=${sizeItem.min} / max=${sizeItem.max} / step=${sizeItem.step}（45 项网格 20%–100%，每格 5%）`);
  const narrowHi = Schema.normalize({ pet: { size: 1.32 } }).config.pet.size;
  ok(narrowHi === 0.88, `收窄上限: 旧 150% 体型 1.32 → ${narrowHi}（期望 0.88 = 100%）`);
  const narrowLo = Schema.normalize({ pet: { size: 0.1 } }).config.pet.size;
  ok(narrowLo === 0.176, `收窄下限: 低于 20% 的 0.1 → ${narrowLo}（期望 0.176 = 20%）`);
  const steps = Math.round((sizeItem.max - sizeItem.min) / sizeItem.step);
  const grid = [];
  for (let i = 0; i <= steps; i++) {
    const v = sizeItem.min + i * sizeItem.step;
    grid.push(Math.round((v / sizeItem.ref) * 100));
  }
  ok(grid[0] === 20 && grid[grid.length - 1] === 100 && grid.every((p, i) => i === 0 || p - grid[i - 1] === 5),
    `体型百分比网格: ${grid[0]}% … ${grid[grid.length - 1]}%（共 ${grid.length} 档，每档 5%）`);

  // runtime.stats 扩展字段（清洁 / 好感度 / 经验）
  const st = Schema.defaults().runtime.stats;
  ok(st.cleanliness === 80 && st.affinity === 10 && st.xp === 0,
    `默认属性: cleanliness=${st.cleanliness} affinity=${st.affinity} xp=${st.xp}`);
  const stMig = Schema.load({ stats: { hunger: 50 } }).config.runtime.stats;
  ok(stMig.hunger === 50 && stMig.cleanliness === 80 && stMig.affinity === 10 && stMig.xp === 0,
    '迁移: 旧 stats 自动补齐清洁/好感度/经验');
  const stClamp = Schema.normalize({ runtime: { stats: { cleanliness: 999, affinity: -5, xp: 1e12 } } }).config.runtime.stats;
  ok(stClamp.cleanliness === 100 && stClamp.affinity === 0 && stClamp.xp === 9999999,
    `夹紧: cleanliness=${stClamp.cleanliness} affinity=${stClamp.affinity} xp=${stClamp.xp}`);

  // v2 → v3：窗口 480→640，坐标平移保持猫的屏幕位置（x-80 / y-186）
  const v3 = Schema.load({
    configVersion: 2,
    pet: { size: 0.66 },
    runtime: { x: 1000, y: 500, stats: { hunger: 50 } },
  }).config;
  ok(v3.configVersion === Schema.CONFIG_VERSION, `版本迁移: configVersion → ${v3.configVersion}`);
  ok(v3.runtime.x === 920 && v3.runtime.y === 314,
    `版本迁移: 窗口坐标平移 (1000,500) → (${v3.runtime.x},${v3.runtime.y})（期望 920,314）`);
  ok(v3.pet.size === 0.66, '版本迁移: 已存体型值（网格内）原样保留');
  ok(v3.runtime.stats.hunger === 50, '版本迁移: 属性值原样保留');
  // 不在 5% 网格上的存量值会被量化到最近一档（体感差异 < 2.5%）
  const v3snap = Schema.load({ configVersion: 2, pet: { size: 0.62 } }).config;
  ok(Math.abs(v3snap.pet.size - 0.616) < 1e-9,
    `版本迁移: 旧默认 0.62 → ${v3snap.pet.size}（量化到 5% 网格，显示同为 70%）`);

  // 类型错误（字符串数字 / 布尔字符串）
  const coerced = Schema.normalize({
    pet: { size: '0.44' },
    startup: { autoStart: 'true' },
    data: { backupKeep: '5' },
  }).config;
  ok(Math.abs(coerced.pet.size - 0.44) < 1e-9, '转换: size "0.44" → 0.44');
  ok(coerced.startup.autoStart === true, '转换: autoStart "true" → true');
  ok(coerced.data.backupKeep === 5, '转换: backupKeep "5" → 5');

  // 补丁合并（嵌套深合并 + runtime.stats）
  const base = Schema.defaults();
  const merged = Schema.mergePatch(base, {
    pet: { petName: '年糕' },
    runtime: { stats: { hunger: 33 } },
  });
  ok(merged.pet.petName === '年糕', '合并: pet.petName');
  ok(merged.pet.size === 0.88, '合并: 未提及字段保持不变（默认 100% = 0.88）');
  ok(merged.runtime.stats.hunger === 33, '合并: runtime.stats.hunger');
  ok(merged.runtime.stats.energy === 80, '合并: runtime.stats 其余字段保持');

  // 变更路径
  const diff = Schema.changedPaths(base, merged);
  ok(diff.indexOf('pet.petName') >= 0 && diff.indexOf('runtime.stats') >= 0,
    '变更路径: ' + diff.join(', '));

  // 待重启项
  const restartFields = Object.keys(Schema.ITEMS).filter((k) => Schema.ITEMS[k].sec === 'restart');
  ok(restartFields.indexOf('dataDir') >= 0 && restartFields.indexOf('startHidden') >= 0,
    '待重启字段: ' + restartFields.join(', '));

  // 条目完整性：1.0.0 下线 9 个固定行为项 + needs 改为每属性独立设置 - 新增眨眼频率后 56 项
  const n = Object.keys(Schema.ITEMS).length;
  ok(n === 56, `条目数: ${n}（期望 56：下线 9 项，needs 2→5，新增 behavior.blinkRate）`);
  // 固定行为项已从 schema 移除（行为恒开 / 恒关，不再提供设置入口）
  const removedKeys = ['showNameInBubble', 'singleInstance', 'closePanelOnBlur', 'showBubbles',
    'allowSleep', 'allowRun', 'allowBath', 'dailyLimit', 'affectPet'];
  const stillThere = removedKeys.filter((k) => !!Schema.ITEMS[k]);
  ok(!stillThere.length, '1.0.0 固定行为项已全部下线: ' + (stillThere.length ? '残留 ' + stillThere : 'OK'));
  // 眨眼频率：0–30 次/分钟，默认 8；0 = 不眨眼
  const blinkIt = Schema.ITEMS.blinkRate;
  ok(blinkIt && blinkIt.t === 'range' && blinkIt.d === 8 && blinkIt.min === 0 && blinkIt.max === 30
    && Schema.normalize({ behavior: { blinkRate: 99 } }).config.behavior.blinkRate === 30
    && Schema.normalize({ behavior: { blinkRate: -1 } }).config.behavior.blinkRate === 0,
    'schema: 眨眼频率 0–30 次/分钟（默认 8），越界夹紧');
  // v4 新增字段
  const newKeys = ['pet.birthday', 'appear.agePrecision',
    'interact.keepOnScreen', 'behavior.restiness'];
  const missingNew = newKeys.filter((k) => {
    const [g, f] = k.split('.');
    return !Schema.ITEMS[f] || !Schema.GROUPS.some((x) => x.id === g && x.items.some((i2) => i2.k === f));
  });
  ok(!missingNew.length, 'v4 新增字段齐全: ' + (missingNew.length ? '缺 ' + missingNew : 'OK'));
  // date 类型校验：合法 / 闰年 / 非法 / 未来
  const B = Schema.ITEMS.birthday;
  ok(Schema.coerce(B, '2024-02-29')[0] === '2024-02-29', 'date: 闰年合法日期通过');
  ok(Schema.coerce(B, '2023-02-29')[1] === true, 'date: 非闰年 2/29 被拒');
  ok(Schema.coerce(B, '2030-01-01')[0] === '', 'date: 未来日期被拒');
  ok(Schema.coerce(B, '')[0] === '' && Schema.coerce(B, '')[1] === false, 'date: 空值合法（未设置）');
  // needs 独立下拉框：5 项各 0–20 点（每 30 分钟），默认饱食/体力/清洁 20、心情 5、好感 3
  const DECAY_KEYS_T = ['decayHunger', 'decayEnergy', 'decayHappiness', 'decayCleanliness', 'decayAffinity'];
  const decayDefaults = Schema.defaults().needs;
  const EXPECT_DECAY = { decayHunger: 20, decayEnergy: 20, decayHappiness: 5, decayCleanliness: 20, decayAffinity: 3 };
  const decayOk = DECAY_KEYS_T.every((k) => {
    const it = Schema.ITEMS[k];
    return it && it.t === 'select' && it.opts.length === 21 && it.opts[0] === 0 && it.opts[20] === 20
      && it.d === EXPECT_DECAY[k] && decayDefaults[k] === EXPECT_DECAY[k];
  });
  ok(decayOk, 'needs 独立设置: 5 个属性各 0–20 点下拉框，默认 20/20/5/20/3（心情 5、好感 3）');
  ok(!Schema.ITEMS.decayMinutes && !Schema.ITEMS.decayPoints && !Schema.ITEMS.hungerDecay,
    'needs 重构: 统一 decayMinutes/decayPoints 与旧百分比滑杆已从 schema 移除');
  // select 数值越界 → 回退默认；字符串数字 → 转换为规范枚举值
  ok(Schema.normalize({ needs: { decayHunger: 999 } }).config.needs.decayHunger === 20
    && Schema.normalize({ needs: { decayHappiness: '7' } }).config.needs.decayHappiness === 7,
    'needs 下拉框: 非法值回退默认 + 字符串数字转换');
  // v7 → 当前：旧倍率 → v8 点数（只取 hungerDecay，夹 0–20）→ v10 换算「每 30 分钟点数」。
  // 150% 夹到 20 点后恰好等于旧默认（30 分钟 / 20 点），按未定制处理 → 跟随新默认。
  const v8r = Schema.load({
    configVersion: 7,
    needs: { hungerDecay: 150, energyDecay: 0, happinessDecay: 100, cleanlinessDecay: 50, affinityDecay: 100 },
  }).config;
  ok(v8r.configVersion === Schema.CONFIG_VERSION && v8r.needs.decayHunger === 20
    && v8r.needs.decayHappiness === 5 && v8r.needs.decayEnergy === 20
    && v8r.needs.hungerDecay === undefined && !('cleanlinessDecay' in v8r.needs)
    && v8r.needs.decayMinutes === undefined && v8r.needs.decayPoints === undefined,
    'v7→当前: 150%→20 点（等于旧默认 → 跟随新默认），旧键全部移除');
  ok(Schema.load({ configVersion: 7, needs: { hungerDecay: 0 } }).config.needs.decayHappiness === 0,
    'v7→当前: 0%（不下降）→ 全部 0 点（意图保留）');
  ok(Schema.load({ configVersion: 7, needs: { hungerDecay: 50 } }).config.needs.decayHunger === 10,
    'v7→当前: 50% → 10 点（线性换算，非默认值不做统一化）');
  // v9 → 当前：旧默认（30 分钟 / 20 点）视为未定制 → 心情 5、其余 20、好感 3（v11 收敛）
  const v10r = Schema.load({ configVersion: 9 }).config;
  ok(v10r.needs.decayHappiness === 5 && v10r.needs.decayHunger === 20 && v10r.needs.decayAffinity === 3,
    'v9→当前: 旧默认统一设置跟随新默认（心情 5、其余 20、好感 3）');
  // 自定义换算：每 45 分钟 8 点 → 每 30 分钟 5 点（四舍五入）；好感 5 属历史默认 → 收敛为 3
  const v10c = Schema.load({ configVersion: 9, needs: { decayMinutes: 45, decayPoints: 8 } }).config;
  ok(v10c.needs.decayHunger === 5 && v10c.needs.decayHappiness === 5 && v10c.needs.decayAffinity === 3,
    'v9→当前: 自定义 45 分钟 8 点 → 每 30 分钟 5 点（好感收敛为 3）');
  // 原来不下降 → 全部 0（0 不是历史默认值，保留「不下降」意图）
  ok(Schema.load({ configVersion: 9, needs: { decayMinutes: 0 } }).config.needs.decayAffinity === 0,
    'v9→当前: 原「不下降」意图保留（全部 0 点）');
  // v10 → v11：好感默认 20 → 3；早期试跑产出的 5 一并收敛；其他自定值原样保留
  ok(Schema.load({ configVersion: 10, needs: { decayAffinity: 20 } }).config.needs.decayAffinity === 3,
    'v10→v11: 好感旧默认 20 → 3');
  ok(Schema.load({ configVersion: 10, needs: { decayAffinity: 5 } }).config.needs.decayAffinity === 3,
    'v10→v11: 好感 5（历史产物）→ 3');
  ok(Schema.load({ configVersion: 10, needs: { decayAffinity: 10 } }).config.needs.decayAffinity === 10,
    'v10→v11: 用户自定好感 10 原样保留');
  ok(Schema.load({ configVersion: 10, needs: { decayAffinity: 0 } }).config.needs.decayAffinity === 0,
    'v10→v11: 好感 0（不下降）原样保留');
  const v11r = Schema.load({ configVersion: 10, needs: { decayAffinity: 20 } }).config;
  ok(v11r.configVersion === Schema.CONFIG_VERSION && v11r.needs.decayHappiness === 5,
    `v10→v11: 版本号升至 ${v11r.configVersion}，心情默认不受影响`);
  // v8 → v9：动作速度旧默认 85 跟随新默认 75，自定值保留；语言项下线由 normalize 兜底
  const v9r = Schema.load({ configVersion: 8, behavior: { animSpeed: 85 } }).config;
  ok(v9r.configVersion === Schema.CONFIG_VERSION && v9r.behavior.animSpeed === 75 && v9r.appear.language === 'zh-CN',
    `v8→当前: 旧默认 animSpeed 85 → ${v9r.behavior.animSpeed}，语言归一 zh-CN`);
  ok(Schema.load({ configVersion: 8, behavior: { animSpeed: 60 } }).config.behavior.animSpeed === 60,
    'v8→当前: 用户自定 animSpeed 60 原样保留');
  ok(Schema.load({ configVersion: 5, behavior: { animSpeed: 85 } }).config.behavior.animSpeed === 75,
    'v5→当前: 链式迁移同样跟随新默认 animSpeed 75');
  // v3 → 当前版本迁移：保留旧值 + 补新默认
  const v3cfg = { configVersion: 3, pet: { petName: '咪咪' }, runtime: { x: 100, y: 200, stats: { hunger: 55, energy: 66, happiness: 77, cleanliness: 88, affinity: 22, xp: 150 } } };
  const v4r = Schema.load(v3cfg).config;
  ok(v4r.configVersion === Schema.CONFIG_VERSION && v4r.pet.petName === '咪咪' && v4r.runtime.stats.hunger === 55,
    `v3→当前: 旧配置保留原值（configVersion = ${v4r.configVersion}）`);
  ok(v4r.pet.birthday === '' && v4r.behavior.restiness === 70
    && v4r.needs.decayHunger === 20 && v4r.needs.decayHappiness === 5,
    'v3→当前: 新字段补默认值');
  // v5 新增字段与默认值
  ok(Schema.ITEMS.needVoice && Schema.ITEMS.needVoice.d === true
    && Schema.ITEMS.needSensitivity && Schema.ITEMS.needSensitivity.d === 'standard'
    && Schema.ITEMS.needSensitivity.opts.join(',') === 'relaxed,standard,strict',
    'v5: 状态驱动开关（默认开）与灵敏度（默认 standard）');
  // v4 → 当前迁移：字段原样保留 + needs 换算 + 补齐新字段
  const v4cfg = {
    configVersion: 4,
    pet: { petName: '咪咪', size: 0.396, birthday: '2024-03-05' },
    behavior: { restiness: 80 },
    needs: { decayMinutes: 45, decayPoints: 8 },
    runtime: { x: 900, y: 300, stats: { hunger: 12, energy: 90, happiness: 55, cleanliness: 8, affinity: 30, xp: 119 } },
  };
  const v5r = Schema.load(v4cfg).config;
  ok(v5r.configVersion === Schema.CONFIG_VERSION
    && v5r.pet.petName === '咪咪' && v5r.pet.size === 0.396 && v5r.pet.birthday === '2024-03-05'
    && v5r.behavior.restiness === 80
    && v5r.needs.decayMinutes === undefined && v5r.needs.decayHunger === 5 && v5r.runtime.stats.cleanliness === 8,
    'v4→当前: 旧配置逐字段保留（含 needs 换算 / behavior / runtime.stats）');
  ok(v5r.behavior.needVoice === true && v5r.behavior.needSensitivity === 'standard',
    'v4→v5: 新增字段补默认值');
  const labeled = Object.keys(Schema.ITEMS).every((k) => {
    const it = Schema.ITEMS[k];
    return it.zh && it.en && it.d !== undefined && it.t;
  });
  ok(labeled, '全部条目具备 zh/en 标签、类型与默认值');

  // i18n 完整性：两种语言键集合一致
  const zhKeys = Object.keys(I18N.STRINGS['zh-CN']).sort().join(',');
  const enKeys = Object.keys(I18N.STRINGS['en-US']).sort().join(',');
  ok(zhKeys === enKeys, 'i18n: zh/en 顶层键集合一致');
  ok(I18N.t('zh-CN', 'say.sizePct', { n: 62 }) === '大小 62%', 'i18n: 参数替换');

  /* ---- needs-profile：分档阈值 / 迟滞 / 权重合成 / 优先级 ---- */

  // 阈值（标准档 + 灵敏度平移）
  ok(NP.thresholds('hunger', 'standard').critical === 15 && NP.thresholds('hunger', 'standard').low === 35,
    'NP 阈值: 饱食 危<15 / 低<35');
  ok(NP.thresholds('happiness', 'standard').critical === 20 && NP.thresholds('happiness', 'standard').low === 45,
    'NP 阈值: 心情 危<20 / 低<45');
  ok(NP.thresholds('cleanliness', 'standard').low === 40, 'NP 阈值: 清洁 低<40');
  ok(NP.thresholds('hunger', 'relaxed').critical === 7 && NP.thresholds('hunger', 'strict').low === 43,
    'NP 灵敏度: 宽松 −8 / 严格 +8');
  ok(NP.thresholds('hunger', 'bogus').critical === 15, 'NP 灵敏度: 非法值按标准处理');

  // 瞬时档位（四项属性 × 全部边界）
  const tierCases = [
    ['hunger', 0, 'critical'], ['hunger', 14.99, 'critical'], ['hunger', 15, 'low'],
    ['hunger', 34.99, 'low'], ['hunger', 35, 'normal'], ['hunger', 69.99, 'normal'], ['hunger', 70, 'good'], ['hunger', 100, 'good'],
    ['energy', 15, 'low'], ['energy', 35, 'normal'],
    ['happiness', 19.99, 'critical'], ['happiness', 20, 'low'], ['happiness', 44.99, 'low'], ['happiness', 45, 'normal'],
    ['cleanliness', 14.99, 'critical'], ['cleanliness', 15, 'low'], ['cleanliness', 39.99, 'low'], ['cleanliness', 40, 'normal'],
  ];
  const badTier = tierCases.filter(([k, v, want]) => NP.tierOf(k, v, 'standard') !== want);
  ok(!badTier.length, 'NP 分档边界: ' + (badTier.length
    ? '不符 ' + badTier.map(([k, v, w]) => `${k}=${v}≠${w}`).join(',')
    : '全部 18 个边界值正确'));

  // 迟滞：升档需越过「原档上界 + 4」，降档越界即生效
  ok(NP.resolve('hunger', 35, 'low', 'standard') === 'low'
    && NP.resolve('hunger', 38.99, 'low', 'standard') === 'low'
    && NP.resolve('hunger', 39, 'low', 'standard') === 'normal',
    'NP 迟滞: 饱食 35→39 才脱离 low（防阈值抖动刷气泡）');
  ok(NP.resolve('happiness', 73, 'normal', 'standard') === 'normal'
    && NP.resolve('happiness', 74, 'normal', 'standard') === 'good'
    && NP.resolve('happiness', 69, 'good', 'standard') === 'normal',
    'NP 迟滞: 心情 74 进 good / 69 出 good');
  ok(NP.resolve('hunger', 10, 'low', 'standard') === 'critical',
    'NP 迟滞: 降档无迟滞（34→10 立刻判 critical）');
  ok(NP.resolve('hunger', 50, null, 'standard') === 'normal', 'NP: 首次判定直接采纳');

  // 权重合成：归一化 / 硬否决 / 单调性
  const ACT_NORMAL = { walk: 0.36, idle: 0.16, run: 0.16, jump: 0.08, stretch: 0.08, meow: 0.06, tailwag: 0.10 };
  const wsum = (o) => Object.keys(o).reduce((a, k) => a + o[k], 0);
  const wNeutral = NP.combineWeights(ACT_NORMAL, NP.NEUTRAL_TIERS);
  ok(Math.abs(wsum(wNeutral) - 1) < 1e-9
    && Math.abs(wNeutral.walk - ACT_NORMAL.walk) < 1e-9,
    'NP 权重: 全 normal 时保持原概率分布');
  const wAllCrit = NP.combineWeights(ACT_NORMAL, { hunger: 'critical', energy: 'critical', happiness: 'critical', cleanliness: 'critical' });
  ok(Math.abs(wsum(wAllCrit) - 1) < 1e-9 && Object.keys(wAllCrit).every((k) => Number.isFinite(wAllCrit[k])),
    'NP 权重: 四项全 critical 仍归一化为合法概率表');
  ok(wAllCrit.run === 0 && wAllCrit.jump === 0 && wAllCrit.tailwag === 0,
    'NP 权重: 因子为 0 时硬否决（不再跑 / 跳 / 摇尾巴）');
  ok(wAllCrit.idle > ACT_NORMAL.idle && wAllCrit.meow > ACT_NORMAL.meow,
    `NP 权重: 又困又饿又脏又丧 → 发呆 ${wAllCrit.idle.toFixed(3)} / 喵叫 ${wAllCrit.meow.toFixed(3)} 占比上升`);
  const wDirty = NP.combineWeights(ACT_NORMAL, { hunger: 'normal', energy: 'normal', happiness: 'normal', cleanliness: 'critical' });
  ok(wDirty.tailwag === 0 && wDirty.run < ACT_NORMAL.run && wDirty.idle > ACT_NORMAL.idle,
    'NP 权重: 脏到极危 → 不摇尾巴、少跑、多发呆');
  const wTired = NP.combineWeights(ACT_NORMAL, { hunger: 'low', energy: 'low', happiness: 'normal', cleanliness: 'normal' });
  ok(wTired.run < ACT_NORMAL.run && wTired.jump < ACT_NORMAL.jump && wTired.stretch > ACT_NORMAL.stretch,
    'NP 权重: 又困又饿 → 少跑跳、多伸懒腰');
  const wHappy = NP.combineWeights(ACT_NORMAL, { hunger: 'good', energy: 'good', happiness: 'good', cleanliness: 'good' });
  ok(wHappy.run > ACT_NORMAL.run && wHappy.tailwag > ACT_NORMAL.tailwag && wHappy.idle < ACT_NORMAL.idle,
    'NP 权重: 四项良好 → 跑与摇尾巴明显增多（正反馈）');
  const wZero = NP.combineWeights({ walk: 0, idle: 0, run: 0, jump: 0, stretch: 0, meow: 0, tailwag: 0 }, NP.NEUTRAL_TIERS);
  ok(wZero.idle === 1, 'NP 权重: 基础权重全 0 时兜底为「发呆」（不产生 NaN）');

  // 趴睡修正与优先级
  ok(NP.sleepBias({ energy: 'low' }) === 25 && NP.sleepBias({ energy: 'good', happiness: 'good' }) === -15
    && NP.sleepBias({ hunger: 'critical' }) === -15 && NP.sleepBias(NP.NEUTRAL_TIERS) === 0,
    'NP 趴睡修正: 困 +25 / 精神好 −10 / 心情好 −5 / 饿极 −15');
  ok(NP.firstCritical({ energy: 'critical', hunger: 'critical' }) === 'energy'
    && NP.firstCritical({ hunger: 'critical', cleanliness: 'critical' }) === 'hunger'
    && NP.firstCritical({ cleanliness: 'critical', happiness: 'critical' }) === 'cleanliness'
    && NP.firstCritical(NP.NEUTRAL_TIERS) === null,
    'NP 优先级: 体力 > 饱食 > 清洁 > 心情，无危急返回 null');

  // 新增台词完整性：4 属性 × 档位均有多句可选，双语一致
  const needZh = I18N.STRINGS['zh-CN'].bubbles.need;
  const needEn = I18N.STRINGS['en-US'].bubbles.need;
  const needMissing = [];
  ['hunger', 'energy', 'happiness', 'cleanliness'].forEach((k) => {
    ['critical', 'low', 'good'].forEach((tr) => {
      if (!Array.isArray(needZh[k][tr]) || needZh[k][tr].length < 2) needMissing.push('zh.' + k + '.' + tr);
      if (!Array.isArray(needEn[k][tr]) || needEn[k][tr].length < 2) needMissing.push('en.' + k + '.' + tr);
    });
  });
  ok(!needMissing.length, 'i18n: 属性分级台词齐全（4 属性 × 3 档 × 中英，每档 ≥2 句）'
    + (needMissing.length ? ' 缺 ' + needMissing.join(',') : ''));
  ok(['hunger', 'energy', 'happiness', 'cleanliness'].every(
    (k) => Array.isArray(I18N.STRINGS['zh-CN'].bubbles.recover[k]) && Array.isArray(I18N.STRINGS['en-US'].bubbles.recover[k])),
    'i18n: 四项属性的「恢复」台词齐全（zh/en）');
  ok(['hunger', 'energy', 'happiness', 'cleanliness'].every(
    (k) => ['critical', 'low', 'good'].every((tr) => typeof I18N.t('zh-CN', `panel.tier.${k}.${tr}`) === 'string'
      && I18N.t('zh-CN', `panel.tier.${k}.${tr}`) !== `panel.tier.${k}.${tr}`)),
    'i18n: 面板档位徽章文案齐全（4 属性 × 3 档）');
  ok(I18N.t('zh-CN', 'notify.cleanLow', { name: '七七' }).indexOf('七七') >= 0
    && I18N.t('en-US', 'notify.cleanLow', { name: 'Qiqi' }).indexOf('Qiqi') >= 0,
    'i18n: 新增「该洗澡了」系统通知（含宠物名占位符）');
  console.log('');
})();

/* ============================================================
 * B. 渲染进程行为（vm 沙箱）
 * ============================================================ */

/* ============================================================
 * A2. 语音层断言（voice.js + SPEC + 素材 + 接线守卫）
 * ============================================================ */

(function voiceTests() {
  console.log('--- 语音层断言 ---');

  // schema：voice 默认开启，旧配置缺键自动补默认
  const cfgDefault = Schema.defaults();
  ok(cfgDefault.sound.voice === true, 'schema: sound.voice 默认开启');
  const oldCfg = Schema.normalize({ sound: { muted: false, volume: 60, bubbles: true } }).config;
  ok(oldCfg.sound.voice === true, 'schema: 旧配置缺 voice 键 → 补默认 true');
  ok(cfgDefault.sound.voiceVolume === 100,
    'schema: sound.voiceVolume 默认 100（不改变现有响度行为）');
  ok(oldCfg.sound.voiceVolume === 100, 'schema: 旧配置缺 voiceVolume 键 → 补默认 100');
  ok(Schema.normalize({ sound: { voiceVolume: 130 } }).config.sound.voiceVolume === 100
    && Schema.normalize({ sound: { voiceVolume: -5 } }).config.sound.voiceVolume === 0,
    'schema: voiceVolume 越界值按 0-100 夹紧');

  // mini 沙箱：只加载 voice.js，隔离 renderer 行为
  let vclock = 1000;
  const vSources = [];            // 记录 createBufferSource 的参数，供循环铺底断言
  function FakeAC() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.createGain = () => ({
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} },
      connect() {},
    });
    this.createBufferSource = () => {
      const s = {
        buffer: null, playbackRate: { value: 1 }, onended: null, loop: false,
        started: null, stopped: null,
        connect() {},
        start(t) { this.started = t == null ? 0 : t; },
        stop(t) { this.stopped = t == null ? 0 : t; },
      };
      vSources.push(s);
      return s;
    };
    // 解码成功（返回 mock buffer）→ 让 start/stop 真正被调度，才能校验循环铺底
    this.decodeAudioData = (buf, ok) => { if (ok) ok({ duration: 1 }); };
    this.resume = () => Promise.resolve();
  }
  function FakeXHR() { this.response = null; this.responseType = ''; }
  FakeXHR.prototype.open = function () {};
  FakeXHR.prototype.send = function () {
    this.response = new ArrayBuffer(64);       // 非空响应，避免走"素材缺失"兜底
    if (this.onload) this.onload();
  };

  const vb = {
    console,
    performance: { now: () => vclock },
    XMLHttpRequest: FakeXHR,
    window: { addEventListener() {} },
  };
  vb.globalThis = vb;
  vm.createContext(vb);
  vb.window.AudioContext = FakeAC;
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'engine', 'voice.js'), 'utf8'), vb, { filename: 'engine/voice.js' });
    ok(true, 'voice.js 沙箱加载无异常');
  } catch (e) {
    ok(false, 'voice.js 沙箱加载失败: ' + e.message);
    return;
  }
  const V = vb.window.Voice;
  ok(!!V && typeof V.play === 'function', 'voice.js 暴露 window.Voice.play');

  // 情境映射
  const R = (k) => V.resolve(k);
  ok(R('pet') === 'pet' && R('eat') === 'eat' && R('callReply') === 'call',
    '映射: 互动 key 命中对应情境');
  ok(R('settingsSaved') === null && R('sulk') === null && R('sizePct') === null,
    '精选: 系统提示/赌气气泡未勾选素材 → 不发声（只显示文字）');
  ok(R('need.hunger.critical') === null, '精选: 危急档素材未勾选 → 不发声');
  ok(R('need.energy.low') === 'tired' && R('need.happiness.low') === null,
    '映射: 需求按属性分流（energy→tired；happiness 的 sad 情境已移除）');
  ok(R('need.cleanliness.good') === null && R('need.cleanliness.low') === null,
    '映射: 良好档与 cleanliness（dirty 已移除）均不出声');
  ok(R('nonsense') === null && R('') === null, '映射: 未知/空 key 返回 null');

  // SPEC 约束
  const SPEC = V.SPEC;
  ok(Object.keys(SPEC).length === 12, `SPEC: 12 个情境（10 喵 + 2 呼噜，实际 ${Object.keys(SPEC).length}）`);
  ok(SPEC.sad === undefined && SPEC.dirty === undefined && SPEC.urgent === undefined && SPEC.sys === undefined,
    '精选: 未勾选的 sad/dirty/urgent/sys 情境已整体移除');
  ok(SPEC.purr.layer === true && SPEC.purrSleep.layer === true && SPEC.purr.maxDur > 1,
    'SPEC: 呼噜走 layer 铺底音轨（循环 + 定时淡出），不参与一次性叫声仲裁');
  ok(SPEC.purr.gain < SPEC.pet.gain && SPEC.purrSleep.gain < SPEC.purr.gain,
    'SPEC: 呼噜音量低于喵叫，入睡呼噜再轻一档');
  const fileSet = [];
  Object.keys(SPEC).forEach((k) => SPEC[k].files.forEach((f) => fileSet.push(f)));
  const EXPECT = ['bath_1', 'bath_2', 'call_2', 'eat_1', 'hungry_2', 'idle_1', 'idle_2', 'lonely_2',
    'pet_3', 'play_2', 'purr_1', 'purr_2', 'tired_1', 'wake_1', 'wake_2'];
  ok(fileSet.slice().sort().join() === EXPECT.join(),
    '精选: SPEC 引用的 15 条素材与勾选清单完全一致（无多余/缺失）');

  // 素材存在性 + 轻量音时长上限
  const meowDir = path.join(ROOT, 'assets', 'audio', 'meow');
  let missing = [];
  let fileCount = 0;
  Object.keys(SPEC).forEach((ctx) => {
    SPEC[ctx].files.forEach((base) => {
      const hit = ['.wav', '.ogg'].map((e) => path.join(meowDir, base + e)).filter((p) => fs.existsSync(p));
      if (!hit.length) missing.push(base); else fileCount++;
    });
  });
  ok(missing.length === 0, `素材: SPEC 引用的 ${fileCount} 条素材全部存在` + (missing.length ? `（缺 ${missing.join(',')}）` : ''));

  const wavDur = (p) => {
    const b = fs.readFileSync(p);
    const sr = b.readUInt32LE(24);
    const dataSize = b.readUInt32LE(40);
    return dataSize / (sr * 2);   // 16bit mono
  };
  /** 解析 OGG/Vorbis 时长：采样率取自 identification header，样本总数取末页 granule */
  const oggDur = (p) => {
    const b = fs.readFileSync(p);
    const vi = b.indexOf(Buffer.from([1, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]), 0, 'latin1');
    if (vi < 0) return 0;
    const sr = b.readUInt32LE(vi + 12);
    let gran = 0;
    let i = 0;
    while (i + 27 < b.length) {
      const j = b.indexOf('OggS', i, 'latin1');
      if (j < 0) break;
      const nsegs = b[j + 26];
      let len = 27 + nsegs;
      for (let k = 0; k < nsegs; k++) len += b[j + 27 + k];
      const gp = b.readBigUInt64LE(j + 6);
      if (gp > 0n && gp !== 0xFFFFFFFFFFFFFFFFn) gran = Number(gp);
      i = j + Math.max(len, 27);
    }
    return sr ? gran / sr : 0;
  };
  const durOf = (p) => (p.endsWith('.ogg') ? oggDur(p) : wavDur(p));
  const onDisk = fs.readdirSync(meowDir).filter((f) => f.endsWith('.ogg')).sort();
  ok(onDisk.length === EXPECT.length && onDisk.join() === EXPECT.map((b) => b + '.ogg').join(),
    `精选: 素材目录恰好 15 条 ogg、无未勾选残留（实际 ${onDisk.length} 条）`);

  /* ---- 阶段 2：真实素材规格（全 ogg / 时长上限 / 无占位残留） ---- */
  const missOgg = [];
  const tooLong = [];
  let maxDur = 0;
  let oggBytes = 0;
  Object.keys(SPEC).forEach((ctx) => {
    const cap = (ctx === 'purr' || ctx === 'purrSleep') ? 3.50 : 1.30;
    SPEC[ctx].files.forEach((base) => {
      const p = path.join(meowDir, base + '.ogg');
      if (!fs.existsSync(p)) { missOgg.push(base); return; }
      oggBytes += fs.statSync(p).size;
      const d = oggDur(p);
      if (d > maxDur) maxDur = d;
      if (!(d > 0.05 && d <= cap)) tooLong.push(`${base}=${d.toFixed(2)}s>${cap}s`);
    });
  });
  ok(missOgg.length === 0, `阶段2: ${fileCount} 条情境素材均有真实 ogg` + (missOgg.length ? `（缺 ${missOgg.join(',')}）` : ''));
  ok(tooLong.length === 0, `阶段2: 时长均在上限内（最长 ${maxDur.toFixed(2)}s；呼噜≤3.5 其余≤1.30）` + (tooLong.length ? `（超限 ${tooLong.join(',')}）` : ''));
  let wavLeft = 0;
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach((it) => {
      const p = path.join(d, it.name);
      if (it.isDirectory()) walk(p);
      else if (/\.wav$/i.test(it.name)) wavLeft++;
    });
  })(meowDir);
  ok(wavLeft === 0, `阶段2: 占位 wav 已清理（残留 ${wavLeft} 个），真素材总体积 ${(oggBytes / 1024).toFixed(0)} KB`);

  // 门禁 / 节流 / 失败静默
  vclock = 5000;
  ok(V.play('pet', { volume: 70 }) === true, '门禁: 正常设置进入播放流程');
  ok(V.play('pet', { volume: 70 }) === false, '节流: 1.2s 内重复触发被丢弃');
  ok(V.play('eat', { volume: 70 }) === false, '节流: 全局最小间隔跨情境生效');
  vclock += 1300;
  ok(V.play('eat', { volume: 70 }) === true, '节流: 超过 1.2s 后恢复');
  ok(V.play('pet', { enabled: false }) === false, '门禁: 语音开关关闭不发声');
  ok(V.play('pet', { muted: true }) === false, '门禁: 静音不发声');
  ok(V.stats.dropped >= 4, `门禁/节流计数: dropped=${V.stats.dropped}`);
  let vthrew = false;
  try { V.play('need.hunger.critical', { volume: 70 }); } catch (e) { vthrew = true; }
  ok(vthrew === false, '失败静默: 已移除情境/解码失败不抛异常（仅内部计数）');
  ok(V.play('need.hunger.critical', { volume: 70 }) === false, '精选: 危急档 key 走门禁后静默丢弃');

  /* 呼噜铺底：绕过全局 MIN_GAP（可紧跟在喵叫后响起），但受自身 9s 冷却约束 */
  vclock += 1300;
  ok(V.play('pet', { volume: 70 }) === true, '呼噜前置: 先播一声喵');
  ok(V.play('purr', { volume: 70 }) === true, '呼噜: 与喵叫并行不抢通道（不受 1.2s 全局间隔限制）');
  ok(V.play('purr', { volume: 70 }) === false, '呼噜: 自身冷却 9s 内重复触发被丢弃');
  vclock += 9100;
  ok(V.play('purr', { volume: 70 }) === true, '呼噜: 冷却结束后可再次触发');
  ok(V.play('purr', { enabled: false }) === false, '呼噜: 语音开关关闭不发声');

  /* 循环铺底的真实调度：loadBuffer 是 Promise，等一个 tick 再断言 */
  setTimeout(() => {
    const loops = vSources.filter((x) => x.loop === true);
    const oneshots = vSources.filter((x) => x.loop === false);
    ok(loops.length >= 1, `呼噜: 以 loop=true 的 BufferSource 播放（实际 ${loops.length} 条循环源）`);
    const L = loops[loops.length - 1];
    ok(L && L.stopped != null && (L.stopped - L.started) > 2.5 && (L.stopped - L.started) < 3.3,
      `呼噜: 按 maxDur 自动淡出（调度时长 ${L ? (L.stopped - L.started).toFixed(2) : 0}s ≈ 2.8s）`);
    ok(oneshots.length >= 1 && oneshots.every((x) => x.loop === false),
      `一次性叫声: 不循环（${oneshots.length} 条一次性源均为 loop=false）`);
  }, 0);

  // 源级接线守卫
  const rend = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  ok(/function showBubble\(text, voiceKey\)/.test(rend) && /window\.Voice\.play\(voiceKey/.test(rend),
    '接线: showBubble 透传 voiceKey 到 Voice.play');
  ok(/enabled:\s*config\.sound\.voice !== false/.test(rend), '接线: 语音开关取自 config.sound.voice');
  ok(rend.indexOf('function voiceOpts()') >= 0
    && rend.split(', voiceOpts())').length - 1 === 4,
    '接线: 四处 Voice.play 均走 voiceOpts() 单一来源（showBubble + purr + purrSleep + aiShow）');
  ok(rend.indexOf('voiceVolume') >= 0 && rend.indexOf('config.sound.volume * trim') >= 0,
    '接线: 叫声音量 = 主音量 × sound.voiceVolume（每次播放实时读取）');
  ok(fs.readFileSync(path.join(ROOT, 'engine', 'config-schema.js'), 'utf8').indexOf('voiceVolume') >= 0,
    '接线: 设置页含 sound.voiceVolume 滑杆（schema 驱动，保存/应用走通用链路）');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/engine\/voice\.js/.test(idx), '接线: index.html 引入 engine/voice.js');
})();

/* ============================================================
 * A3. AI 自言自语断言（纯逻辑 + 语料合规 + schema + 接线守卫）
 * ============================================================ */

(function aiTests() {
  console.log('--- AI 自言自语断言 ---');
  const AT = require(path.join(ROOT, 'engine', 'ai-talk.js'));
  const AF = require(path.join(ROOT, 'engine', 'ai-fallback.js'));
  const D = Schema.defaults();

  /* 切句 */
  const s3 = AT.splitSentences('这是第一句话，写得很长很长。第二句话也不短，足够独立成句。第三句话同样够长，不会被合并掉。');
  ok(s3.length === 3, `切句: 三个完整句子切成 ${s3.length} 句`);
  ok(s3[0].slice(-1) === '。', '切句: 句末标点保留');
  const long = AT.splitSentences('一'.repeat(90));
  ok(long.length >= 3 && long.every((x) => x.length <= 36),
    `切句: 90 字硬切成 ${long.length} 段、每段 ≤36 字（实际最长 ${Math.max(...long.map((x) => x.length))}）`);
  const poem = AT.splitSentences('日暖窗台窄|风轻尾巴尖|不问人间事', { verse: true });
  ok(poem.length === 3 && poem[0] === '日暖窗台窄', '切句: 诗句按 | 分行且不合并');
  ok(AT.splitSentences('').length === 0 && AT.splitSentences(null).length === 0, '切句: 空输入返回空数组');
  ok(AT.splitSentences('喵。喵。').length === 1, '切句: 过短片段合并（单独的「喵。」不占一次冒泡）');

  /* 停留节奏 */
  const hShort = AT.holdFor('喵', 'normal');
  const hLong = AT.holdFor('一'.repeat(40), 'normal');
  ok(hShort >= 1200 && hShort <= 8000, `节奏: 短句停留 ${hShort}ms 落在 1.2–8s`);
  ok(hLong > hShort, `节奏: 越长停越久（${hShort}ms → ${hLong}ms）`);
  ok(AT.holdFor('一'.repeat(40), 'fast') < AT.holdFor('一'.repeat(40), 'slow'), '节奏: fast < normal < slow');
  ok(AT.holdFor('一'.repeat(300), 'slow') <= 8000, '节奏: 上限 8s（防长句霸屏）');

  /* 自主间隔（v9 起整体提前：经常 1–2 分钟 / 平常 2–5 分钟 / 偶尔 5–10 分钟） */
  ok(AT.delayFor('off') === 0, '间隔: off 返回 0（不排期）');
  const r0 = () => 0, r1 = () => 1;
  ok(AT.delayFor('often', r0) === 60 && AT.delayFor('often', r1) === 120,
    '间隔: often = 1–2 分钟（经常档每 1~2 分钟一次）');
  ok(AT.delayFor('normal', r0) === 120 && AT.delayFor('normal', r1) === 300, '间隔: normal = 2–5 分钟');
  ok(AT.delayFor('rare', r0) === 300 && AT.delayFor('rare', r1) === 600, '间隔: rare = 5–10 分钟');
  ok(AT.delayFor('rare', r1) > AT.delayFor('normal', r1) && AT.delayFor('normal', r1) > AT.delayFor('often', r1),
    '间隔: 经常 < 平常 < 偶尔（梯度单调）');

  /* 类别 */
  ok(Object.keys(AT.CATS).length === 6 &&
    ['joke', 'story', 'poem', 'riddle', 'fact', 'idle'].every((k) => AT.CATS[k]),
    '类别: 六类齐全（笑话/故事/诗/谜语/冷知识/随口说）');
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(AT.pickCategory(Math.random, null));
  ok(seen.size === 6, `类别: 300 次抽样覆盖全部 6 类（实际 ${seen.size}）`);
  ok(AT.pickCategory(r0, 'joke') !== 'joke', '类别: 避免连续两次同类');

  /* 去重 */
  const k1 = AT.keyOf('joke', ['a', 'b']);
  ok(k1 === AT.keyOf('joke', ['a', 'b']) && k1 !== AT.keyOf('joke', ['a', 'c']), '去重: 指纹稳定且区分内容');
  const now = 1750000000000;
  let rec = AT.pushRecent([], { key: k1, cat: 'joke', title: 't' }, now);
  ok(rec.length === 1 && AT.isDup(rec, k1, now), '去重: 刚讲过的算重复');
  ok(!AT.isDup(rec, k1, now + 4 * 86400000), '去重: 3 天后不再算重复');
  for (let i = 0; i < 30; i++) rec = AT.pushRecent(rec, { key: 'k' + i, cat: 'joke', title: 't' + i }, now + i);
  ok(rec.length === 20, `去重: 记录上限 20 条（实际 ${rec.length}）`);

  /* 截断与掩码 */
  const clipped = AT.clipLines(['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(40)], 'joke');
  ok(clipped.length >= 2 && clipped.length <= 3, `截断: 笑话句数硬上限（4 句 → ${clipped.length} 句）`);
  ok(AT.maskKey('sk-abcdefgh1234') === 'sk-****1234', '掩码: sk-abcd…1234 → sk-****1234');
  ok(AT.maskKey('') === '' && AT.maskKey('short') === '****', '掩码: 空值与过短值不泄露');

  /* 离线语料合规 */
  const bad = [];
  Object.keys(AF.CONTENT).forEach((cat) => {
    const c = AT.CATS[cat];
    const ids = new Set();
    AF.CONTENT[cat].forEach((e) => {
      if (ids.has(e.id)) bad.push(cat + ' 重复 id ' + e.id);
      ids.add(e.id);
      if (!e.lines || !e.lines.length) bad.push(e.id + ' 空内容');
      if (e.lines.length > c.maxSent) bad.push(e.id + ' 句数 ' + e.lines.length + '>' + c.maxSent);
      if (e.lines.join('').length > c.maxChars) bad.push(e.id + ' 字数超限');
      e.lines.forEach((l) => { if (l.length > AT.MAX_SENT_LEN) bad.push(e.id + ' 单句 ' + l.length + ' 字'); });
      if (cat === 'riddle' && e.lines.length !== 2) bad.push(e.id + ' 谜语必须题+答');
      if (cat === 'poem' && !e.lines.every((l) => l.indexOf('|') >= 0)) bad.push(e.id + ' 诗缺 | 分行');
    });
  });
  const counts = Object.keys(AF.CONTENT).map((k) => AF.CONTENT[k].length);
  ok(bad.length === 0, `语料: 全量合规（${Object.keys(AF.CONTENT).length} 类 ${counts.join('/')} 共 ` +
    `${counts.reduce((a, b) => a + b, 0)} 条）` + (bad.length ? `（${bad.slice(0, 3).join('; ')}）` : ''));
  ok(counts.every((n) => n >= 6), '语料: 每类 ≥6 条（离线不至于很快重复）');
  ok(AF.CONTENT.riddle.every((e) => /[。？！]$/.test(e.lines[1])), '语料: 谜语第二句是自揭晓（不等人回答）');

  /* schema */
  const aiGroup = Schema.GROUPS.filter((g) => g.id === 'ai')[0];
  ok(!!aiGroup && aiGroup.items.length === 11, `schema: ai 组 11 项（1.0.0 下线每日上限/陪伴心情后，实际 ${aiGroup ? aiGroup.items.length : 0}）`);
  ok(D.ai.enabled === false, 'schema: AI 默认关闭（用户拍板）');
  ok(D.ai.speech === 'purr' && ['off', 'purr', 'tts'].join() === Schema.ITEMS.speech.opts.join(),
    'schema: 声音三档，默认喵语节奏');
  ok(D.ai.autoTalk === 'normal' && Schema.ITEMS.autoTalk.opts.length === 4, 'schema: 自主频率四档');
  ok(Schema.ITEMS.apiKey.t === 'password' && Schema.ITEMS.testConn.t === 'action' &&
    Schema.ITEMS.sayNow.t === 'action', 'schema: 新增 password / action 两种控件');
  ok(Schema.normalize({ ai: { apiKey: 'sk-leak' } }).config.ai.apiKey === '',
    'schema: 密钥永不落 config.json（读到时归零）');
  ok(Schema.ITEMS.speechRate.requires === 'speech' && Schema.ITEMS.speechRate.requiresIn[0] === 'tts',
    'schema: 语速仅在「朗读」模式可用');
  ok(!Schema.ITEMS.dailyLimit && !Schema.ITEMS.affectPet,
    '1.0.0: AI 每日上限与陪伴心情奖励已下线（不限制次数 / 无副作用）');
  ok(Schema.normalize({ ai: { preset: 'nope' } }).config.ai.preset === 'zhipu', 'schema: 未知预设回退智谱（默认服务）');
  ok(Schema.defaults().ai.preset === 'zhipu' && Schema.defaults().ai.model === 'glm-4-flash' &&
    Schema.defaults().ai.baseUrl === 'https://open.bigmodel.cn/api/paas/v4',
    'schema: 全新配置默认智谱 GLM-4-Flash');
  const v6Plain = Schema.load({ configVersion: 6, ai: { enabled: false, preset: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' } });
  ok(v6Plain.config.configVersion === Schema.CONFIG_VERSION && v6Plain.config.ai.preset === 'zhipu' && v6Plain.config.ai.model === 'glm-4-flash',
    'schema: v6 未启用的旧默认值跟随升级为智谱（链式迁移直抵当前版本）');
  const v6Used = Schema.load({ configVersion: 6, ai: { enabled: true, preset: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' } });
  ok(v6Used.config.ai.preset === 'deepseek' && v6Used.config.ai.model === 'deepseek-chat',
    'schema: v6 已启用的 DeepSeek 配置不被改写（保护已有 Key）');
  const v6Custom = Schema.load({ configVersion: 6, ai: { enabled: false, preset: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B' } });
  ok(v6Custom.config.ai.preset === 'siliconflow' && v6Custom.config.ai.model === 'Qwen/Qwen3-8B',
    'schema: v6 用户自选服务不被默认值覆盖');
  const presetOpts = Schema.ITEMS.preset.opts;
  ok(presetOpts.length === 9 && presetOpts[0] === 'zhipu' && presetOpts.indexOf('custom') === 8,
    `schema: 预设列表免费优先、9 项（${presetOpts.join('/')}）`);
  ok(['zhipu', 'siliconflow', 'modelscope', 'dashscope', 'ark', 'deepseek', 'moonshot', 'ollama']
    .every((k) => !!AT.PRESETS[k] && /^https?:\/\//.test(AT.PRESETS[k].baseUrl) && AT.PRESETS[k].model),
    'PRESETS: 每个预设都有合法地址与模型名');
  ok(/^https:\/\/open\.bigmodel\.cn\/api\/paas\/v4$/.test(AT.PRESETS.zhipu.baseUrl) &&
    AT.PRESETS.zhipu.model === 'glm-4-flash', 'PRESETS: 智谱 GLM-4-Flash 地址正确');
  ok(AT.PRESETS.siliconflow.baseUrl.endsWith('/v1') && AT.PRESETS.modelscope.baseUrl.endsWith('/v1') &&
    AT.PRESETS.dashscope.baseUrl.endsWith('/compatible-mode/v1') &&
    AT.PRESETS.ark.baseUrl.endsWith('/api/v3'), 'PRESETS: 四个免费国产平台的接口路径正确');
  ok(presetOpts.every((k) => k === 'custom' || AT.PRESETS[k]),
    'PRESETS: 下拉项与 PRESETS 表一一对应（不会出现空白预设）');
  ok(Schema.load({ configVersion: 5, pet: { petName: '小银' } }).config.configVersion === Schema.CONFIG_VERSION &&
    Schema.load({ configVersion: 5 }).config.ai.enabled === false, 'schema: v5 旧配置自动补 ai 组升到 v6');

  /* 接线守卫（源级） */
  const rend = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const pre = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const setJs = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  ok(rend.indexOf('function aiShow') >= 0 && rend.indexOf('function maybeAutoTalk') >= 0 &&
    rend.indexOf('function interruptAi') >= 0, '接线: 渲染进程有 显示 / 调度 / 打断 三个入口');
  ok(rend.indexOf('api.onAiSay') >= 0 && rend.indexOf('api.onAiDone') >= 0, '接线: 渲染进程订阅 ai-say / ai-done');
  ok(rend.indexOf('if (!force && ai.busy) return false') >= 0, '接线: AI 讲的时候自主气泡让路（危急 force 例外）');
  ok(rend.indexOf("fsm.name === 'sleep'") >= 0 && rend.indexOf("fsm.name === 'drag'") >= 0,
    '接线: 睡觉 / 拖拽时不自己开口');
  ok(rend.indexOf('time - lastInteraction < 180') >= 0, '接线: 静置 3 分钟才开口（不打扰正在用电脑的人）');
  ok(rend.indexOf('h >= 23 || h < 7') >= 0, '接线: 深夜 23–07 间隔翻倍');
  ok(rend.indexOf("bubbleEl.classList.toggle('verse'") >= 0, '接线: 诗句走 verse 排版（保留断行）');
  ok(idx.indexOf('engine/ai-talk.js') >= 0 && idx.indexOf('#bubble.verse') >= 0, '接线: 宠物窗加载逻辑层并支持诗句样式');

  ok(mainJs.indexOf("ipcMain.handle('ai-tell'") >= 0 && mainJs.indexOf('async function aiTell') >= 0,
    '接线: 主进程有 ai-tell 与生成循环');
  ok(mainJs.indexOf('ai-recent.json') >= 0 && mainJs.indexOf('ai-usage.json') >= 0,
    '接线: 去重记录与每日用量各自落盘');
  ok(mainJs.indexOf("if (my !== aiToken) return 'aborted'") >= 0
    && /function aiAbort\(\)\s*\{\s*aiToken\+\+;\s*aiWakeAll\(\);/.test(mainJs),
    '接线: 打断后旧循环立即退出（队列播放器 + 可打断等待 + 网络中止）');
  ok(mainJs.indexOf('AiSecret.hasKey(DATA_DIR)') >= 0 && mainJs.indexOf('aiKeyMask') >= 0,
    '接线: 主进程向设置页暴露密钥状态与掩码');
  ok(pre.indexOf('onAiSay') >= 0 && pre.indexOf('aiSetKey') >= 0 && pre.indexOf('aiTell') >= 0,
    '接线: preload 暴露 AI 通道（无渲染层 Node 权限）');
  ok(setJs.indexOf("it.t === 'password'") >= 0 && setJs.indexOf("it.t === 'action'") >= 0,
    '接线: 设置页支持密钥框与动作按钮');
  ok(setJs.indexOf('requiresIn') >= 0 && setJs.indexOf('AiTalk.PRESETS') >= 0,
    '接线: 设置页支持 requiresIn 联动与预设自动填表');
})();

/* ============================================================
 * A4. 模型接入断言（OpenAI 兼容协议 / SSE / 错误分类 / 流式切句）
 * ============================================================ */

/** 假响应：parts 为 SSE 分片（null 表示无 body，走 text()） */
function fakeRes(status, parts, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: parts ? {
      getReader() {
        let i = 0;
        return {
          read() {
            if (i >= parts.length) return Promise.resolve({ done: true, value: undefined });
            return Promise.resolve({ done: false, value: Buffer.from(parts[i++], 'utf8') });
          },
          cancel() { i = parts.length; return Promise.resolve(); },
          releaseLock() { /* noop */ },
        };
      },
    } : null,
    text() { return Promise.resolve(text == null ? '' : String(text)); },
  };
}

function sseFrame(content) {
  return 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n';
}

async function aiClientTests() {
  console.log('--- AI 模型接入断言 ---');
  const AC = require(path.join(ROOT, 'engine', 'ai-client.js'));
  const AT = require(path.join(ROOT, 'engine', 'ai-talk.js'));
  const base = { baseUrl: 'https://x.example/v1', apiKey: 'sk-test', model: 'm', messages: [] };

  /* 地址归一 */
  ok(AC.endpointOf('https://api.deepseek.com/v1') === 'https://api.deepseek.com/v1/chat/completions',
    '接入: /v1 自动补 /chat/completions');
  ok(AC.endpointOf('https://x.cn/v1/') === 'https://x.cn/v1/chat/completions', '接入: 容忍结尾斜杠');
  ok(AC.endpointOf('http://h/v1/chat/completions') === 'http://h/v1/chat/completions', '接入: 已写全路径不重复拼接');
  ok(AC.endpointOf('') === '', '接入: 空地址返回空串');
  ok(AC.isLocalUrl('http://127.0.0.1:11434/v1') && AC.isLocalUrl('http://localhost:11434/v1')
    && !AC.isLocalUrl('https://api.deepseek.com/v1'), '接入: 本地服务识别（免密钥）');

  /* 提示词 */
  const m = AC.buildMessages('joke', {
    name: '团子', owner: '小鱼', hour: 22, mood: '肚子有点饿',
    titles: ['猫为什么怕黄瓜', '睡着掉下去'], lang: 'zh-CN',
  });
  ok(m.length === 2 && m[0].role === 'system' && m[1].role === 'user', '提示词: system + user 两条');
  ok(m[0].content.indexOf('团子') >= 0 && m[0].content.indexOf('小鱼') >= 0, '提示词: 名字与主人替换占位符');
  ok(m[0].content.indexOf('不要使用 Markdown') >= 0 && m[0].content.indexOf('不要向用户提问') >= 0,
    '提示词: 含硬约束（无 Markdown / 不提问）');
  ok(m[1].content.indexOf('冷笑话') >= 0, '提示词: 类别指令命中（笑话）');
  ok(m[1].content.indexOf('猫为什么怕黄瓜') >= 0, '提示词: 注入最近讲过的标题（防重复）');
  ok(m[1].content.indexOf('22 点') >= 0 && m[1].content.indexOf('肚子有点饿') >= 0, '提示词: 注入时段与当前状态');
  ok(m[0].content.indexOf('{') < 0 && m[1].content.indexOf('{') < 0, '提示词: 占位符全部替换');
  const me = AC.buildMessages('poem', { name: 'Mochi', owner: 'Sam', hour: 9, lang: 'en-US' });
  ok(me[0].content.indexOf('You are Mochi') >= 0 && me[1].content.indexOf('pipe') >= 0,
    '提示词: 英文环境走英文规则与指令');
  ok(AC.tokensFor('story') > AC.tokensFor('joke') && AC.tokensFor('joke') > 0, '提示词: 各类 token 预算（故事 > 笑话）');

  /* 错误分类 */
  ok(AC.classify(401, '{"error":{"message":"Invalid API key"}}').code === 'unauthorized', '错误: 401 → 钥匙无效');
  ok(AC.classify(429, '').code === 'rate-limit' && AC.classify(402, '').code === 'quota', '错误: 429 限流 / 402 余额不足');
  ok(AC.classify(404, '').code === 'not-found' && AC.classify(400, '').code === 'bad-request', '错误: 404 地址或模型 / 400 参数');
  ok(AC.classify(503, '').code === 'server' && AC.classify(418, '').code === 'http', '错误: 5xx → server，其余 → http');
  ok(AC.classify(401, '{"error":{"message":"Invalid API key"}}').detail === 'Invalid API key',
    '错误: 提取服务端原因（用于设置页 title 提示）');
  const eNet = new Error('getaddrinfo ENOTFOUND api.deepseek.com');
  const eTo = new Error('timeout'); eTo.code = 'ETIMEDOUT';
  const eAb = new Error('aborted'); eAb.name = 'AbortError';
  ok(AC.netError(eNet).code === 'network' && AC.netError(eTo).code === 'timeout' && AC.netError(eAb).code === 'aborted',
    '错误: 断网 / 超时 / 主动打断 分类正确');

  /* SSE 解析 */
  const p = AC.createSseParser();
  const frame = sseFrame('天气不错。');
  const half = Math.floor(frame.length / 2);
  const a1 = p.push(frame.slice(0, half));
  const a2 = p.push(frame.slice(half));
  ok(a1.length === 0 && a2.length === 1 && AC.deltaOf(a2[0].json) === '天气不错。', 'SSE: 半包不解析、拼够整行才出事件');
  const a3 = p.push('data: [DONE]\n\n');
  ok(a3.length === 1 && a3[0].done === true, 'SSE: [DONE] 结束标记');
  const a4 = p.push(': keep-alive\n\ndata: {"choices":[{"delta":{"content":"喵"}}]}\n\n');
  ok(a4.length === 1 && AC.deltaOf(a4[0].json) === '喵', 'SSE: 忽略心跳注释行');
  ok(AC.deltaOf({ choices: [{ message: { content: 'x' } }] }) === 'x'
    && AC.deltaOf({ choices: [{ delta: {} }] }) === '' && AC.deltaOf(null) === '',
    'SSE: 兼容非流式形状、空增量返回空串');

  /* 流式生成 */
  let got = '';
  const r1 = await AC.streamChat(Object.assign({}, base, {
    fetchImpl: async () => fakeRes(200, [sseFrame('今天'), sseFrame('天气不错。'), sseFrame('我睡了一整天。'), 'data: [DONE]\n\n']),
    onText: (d) => { got += d; },
  }));
  ok(r1.ok && got === '今天天气不错。我睡了一整天。', `流式: 增量拼接完整（${got.length} 字）`);
  ok(r1.chars === got.length, '流式: 统计字符数正确');

  let partial = '';
  const r2 = await AC.streamChat(Object.assign({}, base, {
    fetchImpl: async () => fakeRes(200, [sseFrame('一开始'), sseFrame('就停了。'), sseFrame('不该出现。')]),
    onText: (d) => { partial += d; return false; },   // 达到句数上限 → 主动断开
  }));
  ok(r2.ok && partial === '一开始' && r2.chars === 3, `流式: onText 返回 false 立刻停止（只收了 ${r2.chars} 字）`);

  const r3 = await AC.streamChat(Object.assign({}, base, {
    fetchImpl: async () => fakeRes(401, null, '{"error":{"message":"bad key"}}'),
  }));
  ok(!r3.ok && r3.code === 'unauthorized' && r3.detail === 'bad key', '流式: 401 → unauthorized（带原因）');

  const r4 = await AC.streamChat(Object.assign({}, base, {
    fetchImpl: async () => fakeRes(200, ['data: [DONE]\n\n']),
  }));
  ok(!r4.ok && r4.code === 'bad-response', '流式: 空内容 → bad-response（触发降级）');

  const r5 = await AC.streamChat(Object.assign({}, base, {
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  }));
  ok(!r5.ok && r5.code === 'network', '流式: 断网 → network（触发降级）');

  /* 连接测试 */
  const c1 = await AC.chatOnce(Object.assign({}, base, {
    fetchImpl: async () => fakeRes(200, null, JSON.stringify({ choices: [{ message: { content: '喵' } }] })),
  }));
  ok(c1.ok && c1.text === '喵' && Number.isFinite(c1.ms), '测试连接: 取回内容与耗时');
  const c2 = await AC.chatOnce(Object.assign({}, base, {
    fetchImpl: async () => fakeRes(404, null, '{"error":{"message":"model not found"}}'),
  }));
  ok(!c2.ok && c2.code === 'not-found' && c2.detail === 'model not found', '测试连接: 失败带分类与原因');

  /* 净化：模型转义/控制字符 */
  ok(AT.sanitize('\\u55b5\\u55b5！') === '喵喵！', 'sanitize: \\uXXXX 转义解码为文字');
  ok(AT.sanitize('第一句\\n第二句') === '第一句 第二句', 'sanitize: \\n 字面量转空格');
  ok(AT.sanitize('普通句子，没有转义。') === '普通句子，没有转义。', 'sanitize: 普通文本原样保留');
  ok(AT.sanitize('a\\u0000\\u0007b') === 'ab', 'sanitize: 控制字符剔除');
  ok(AT.sanitize('') === '' && AT.sanitize(null) === '', 'sanitize: 空值安全');
  ok(AT.sanitize('反斜杠\\u12zz尾巴') === '反斜杠\\u12zz尾巴', 'sanitize: 不完整序列不误伤');

  /* 流式切句 */
  const sp = AT.createSentenceStream();
  ok(sp.push('今天天气').length === 0, '流式切句: 未到句末不吐');
  const l1 = sp.push('不错。我睡了');
  ok(l1.length === 1 && l1[0] === '今天天气不错。', `流式切句: 出第一句（${l1[0]}）`);
  ok(sp.push('一整天。').length === 0, '流式切句: 句末标点等下一字符确认（连续标点不被提前切断）');
  const l2 = sp.push('喵');
  ok(l2.length === 1 && l2[0] === '我睡了一整天。', '流式切句: 下一字符到达后立即吐出整句');
  ok(sp.flush().join('') === '喵', '流式切句: flush 吐出未说完的尾巴');

  const sp2 = AT.createSentenceStream();
  sp2.push('真的吗？');
  sp2.push('！');
  const l3 = sp2.push('我不信。');
  ok(l3.length === 1 && l3[0] === '真的吗？！', '流式切句: 连续标点一起收尾');

  const sp3 = AT.createSentenceStream();
  const l4 = sp3.push('一'.repeat(80));
  ok(l4.length >= 1 && l4[0].length <= 36, `流式切句: 无标点超长硬切（首段 ${l4[0].length} 字）`);

  const sv = AT.createSentenceStream({ verse: true });  const v1 = sv.push('日暖窗台窄|风轻');
  ok(v1.length === 1 && v1[0] === '日暖窗台窄', '流式切句: 诗句按 | 出第一行');
  const v2 = sv.push('尾巴尖|不问人间事');
  ok(v2.length === 1 && v2[0] === '风轻尾巴尖', '流式切句: 诗句跨包续行（风轻 + 尾巴尖 = 一行）');
  const v3 = sv.flush();
  ok(v3.length === 1 && v3[0] === '不问人间事', '流式切句: 诗句末行 flush 吐出');

  const text = '第一句话在这里。第二句话也不短，独立成句。第三句话同样够长。';
  const sfull = AT.createSentenceStream();
  const one = sfull.push(text).concat(sfull.flush());
  ok(one.join('|') === AT.splitSentences(text).join('|'), '流式切句: 整段结果与批量切句一致');

  /* 接线守卫（S2） */
  const mainJs = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const setJs2 = fs.readFileSync(path.join(ROOT, 'settings.js'), 'utf8');
  ok(mainJs.indexOf('AiClient.streamChat') >= 0 && mainJs.indexOf('async function aiTest') >= 0,
    '接线: 主进程接真实流式生成与连接测试');
  ok(mainJs.indexOf('AiTalk.createSentenceStream') >= 0, '接线: 主进程边生成边切句（首句零等待）');
  ok(mainJs.indexOf('aiPickOffline(cat)') >= 0 && mainJs.indexOf("source = 'model'") >= 0,
    '接线: 模型失败且未开口时静默降级离线');
  ok(mainJs.indexOf('function aiReady()') >= 0 && mainJs.indexOf('isLocalUrl') >= 0,
    '接线: 本地服务免密钥判定');
  ok(setJs2.indexOf('no-model') >= 0 && setJs2.indexOf('unauthorized') >= 0, '接线: 设置页把错误码翻译成人话');

  /* ---- 四项交互/显示修复的源级守卫 ---- */
  const rend = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
  ok(rend.indexOf('POSE_SCALE') >= 0 && rend.indexOf('scaleMul: poseCur') >= 0 &&
    rend.indexOf('function updateScaleSmoothing') >= 0,
    '修复: 姿态级尺寸校正走帧级平滑值 scaleMul: poseCur（切姿态不再瞬跳）');
  ok(rend.indexOf('(SPRITE_GROUND_Y - contentTop) * sizeCur * poseCur') >= 0,
    '修复: 气泡头顶定位同样乘平滑后的体型/姿态值（气泡不因校正漂移）');
  ok(rend.indexOf('else if (hitCat(localPos(e)))') >= 0 && rend.indexOf('pointercancel') >= 0 &&
    rend.indexOf('gesture.active = false') >= 0,
    '修复: 只有按在猫身上且松开仍在猫身上才结算抚摸 + pointerup 丢失兜底');
  ok(rend.indexOf('EAT_BOWL_DX') >= 0 && rend.indexOf('alignBowlOnEat()') >= 0 &&
    rend.indexOf("food.x - dir * EAT_BOWL_DX") >= 0,
    '修复: 喂食目标与进食对齐补偿烤碗偏移（猫吃的就是地上那只碗）');
  ok(rend.indexOf("fsm.name !== 'eat') drawBowl") >= 0,
    '修复: 进食中隐藏程序碗（eat 素材自带碗，双碗同屏即错位）');
  ok(rend.indexOf('sanitizeBubbleText') >= 0 && typeof AT.sanitize === 'function',
    '修复: 气泡文本净化挂载（\\uXXXX/\\n 字面量/控制字符不再上屏）');
  ok(mainJs.indexOf('AiTalk.sanitize(line)') >= 0, '修复: 主进程入队前同样净化（去重指纹与显示一致）');

  /* ---- 特效定位 / 玩具球修复的源级守卫 ---- */
  ok(rend.indexOf('function catGeom()') >= 0 && rend.indexOf('Fx.geom({') >= 0 &&
    rend.indexOf('GROUND - Core.rand(240, 300)') < 0 && rend.indexOf('GROUND - Core.rand(150, 215)') < 0,
    '修复: 爱心/Zzz 起点改由 catGeom 推算（不再写死绝对像素，小体型不飘远）');
  ok(rend.indexOf('fadeTail: 0.7') >= 0 && rend.indexOf('minX: 16') >= 0 &&
    rend.indexOf('fixedSize: true') >= 0 && rend.indexOf('drag: 2.2') >= 0,
    '修复: 玩具球带淡出尾/横向边界/贴地滚动参数（不再到点硬删或飞出窗口）');
  const partJs = fs.readFileSync(path.join(ROOT, 'engine', 'particles.js'), 'utf8');
  ok(partJs.indexOf('fadeTail') >= 0 && partJs.indexOf('rolling') >= 0 &&
    partJs.indexOf('p.minX') >= 0 && partJs.indexOf('p.life = Math.min(p.life, 0.35)') < 0,
    '修复: 粒子系统支持淡出尾/贴地滚动/横向边界（旧「到点砍生命」已移除）');
  ok(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').indexOf('engine/fx.js') >= 0,
    '接线: index.html 加载 engine/fx.js（特效定位换算）');
}

const FILES = [
  'engine/core.js',
  'engine/fx.js',
  'engine/particles.js',
  'engine/animator.js',
  'engine/fsm.js',
  'engine/config-schema.js',
  'engine/i18n.js',
  'engine/needs-profile.js',
  'engine/ai-talk.js',
];

/* ---------------- 模拟对象 ---------------- */

const drawCalls = [];
const ellipseCalls = [];   // 记录 ctx.ellipse 参数，用于验证阴影圆盘随体型缩放
const handlers = {};
let rafCb = null;
const apiCalls = [];
const statsPushes = [];   // 状态面板实时推送记录
const scaleCalls = [];    // ctx.scale 调用记录（尺寸恒定断言用）

function makeCtx() {
  const store = {};
  return new Proxy(store, {
    get(t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop() {} });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'drawImage') return (...a) => drawCalls.push(a[0]);
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (prop === 'ellipse') return (...a) => ellipseCalls.push(a);
      if (prop === 'scale') return (...a) => scaleCalls.push(a);
      if (!(prop in t)) t[prop] = () => undefined;
      return t[prop];
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

class FakeImage {
  constructor() { this.width = 512; this.height = 512; this._src = ''; }
  set src(v) {
    this._src = v;
    setTimeout(() => { if (this.onload) this.onload(); }, 0);
  }
  get src() { return this._src; }
}

const canvasStub = {
  width: 640,
  height: 640,
  style: {},
  getContext: () => makeCtx(),
  addEventListener: (type, fn) => { handlers[`canvas:${type}`] = fn; },
  setPointerCapture() {},
  releasePointerCapture() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 640 }),
};

const bubbleStub = {
  textContent: '',
  classList: { add() {}, remove() {}, contains: () => false },
  offsetWidth: 132,
  offsetHeight: 32,
  style: {
    setProperty(k, v) { this[k] = v; },
  },
};

const menuItems = ['pet', 'feed', 'play', 'call', 'bath', 'status', 'settings', 'quit']
  .map((act) => ({ dataset: { act }, textContent: '', classList: { add() {}, remove() {}, contains: () => false } }));

const menuStub = {
  style: {},
  offsetWidth: 130,
  offsetHeight: 210,
  querySelectorAll: () => menuItems,
  addEventListener: (type, fn) => { handlers[`menu:${type}`] = fn; },
  contains: () => false,
};

/* 初始配置：精力低以触发 sleep→stretch；饱食度后续调低以验证通知 */
const initialConfig = Schema.defaults();
initialConfig.runtime.stats = { hunger: 70, energy: 15, happiness: 70 };
let liveConfig = Schema.deepClone(initialConfig);

const mockApi = {
  aiTell: async (cat, opts) => {
    apiCalls.push(['aiTell', cat, opts]);
    return { ok: true, cat: cat || 'joke', lines: 2 };
  },
  aiAbort: async () => { apiCalls.push(['aiAbort']); return true; },
  aiTest: async () => ({ ok: false, reason: 'pending' }),
  aiSetKey: async (k) => ({ ok: true, mask: 'sk-****' }),
  aiClearKey: async () => ({ ok: true }),
  aiHasKey: async () => ({ ok: true, has: false, mask: '' }),
  aiClearRecent: async () => ({ ok: true }),
  onAiSay: (cb) => { handlers['api:aiSay'] = cb; },
  onAiBusy: (cb) => { handlers['api:aiBusy'] = cb; },
  onAiDone: (cb) => { handlers['api:aiDone'] = cb; },
  getConfig: async () => Schema.deepClone(liveConfig),
  getMeta: async () => ({ dataDir: 'C:\\mock\\data', issues: [], notificationsSupported: true }),
  saveConfig: async (patch) => {
    apiCalls.push(['saveConfig', Schema.deepClone(patch)]);
    const before = Schema.deepClone(liveConfig);
    liveConfig = Schema.mergePatch(liveConfig, patch);
    // 模拟主进程行为：保存后向渲染进程广播 config-changed
    if (handlers['api:configChanged']) {
      handlers['api:configChanged']({
        config: Schema.deepClone(liveConfig),
        changed: Schema.changedPaths(before, liveConfig),
      });
    }
    return Schema.deepClone(liveConfig);
  },
  resetConfig: async (opts) => {
    apiCalls.push(['resetConfig', opts]);
    const next = Schema.defaults();
    if (opts && opts.keepPetName) next.pet.petName = liveConfig.pet.petName;
    next.runtime = liveConfig.runtime;
    liveConfig = next;
    return Schema.deepClone(liveConfig);
  },
  openSettings: async () => { apiCalls.push(['openSettings']); },
  exportConfig: async () => ({ ok: true }),
  importConfig: async () => ({ ok: true }),
  chooseDataDir: async () => ({ ok: true, dir: 'D:\\mock\\newdir' }),
  openDataDir: async () => { apiCalls.push(['openDataDir']); },
  migrateData: async () => ({ ok: true }),
  restartApp: async () => { apiCalls.push(['restartApp']); },
  quit: async () => { apiCalls.push(['quit']); },
  notify: async (payload) => { apiCalls.push(['notify', payload]); },
  moveWindow: (dx, dy) => { apiCalls.push(['moveWindow', dx, dy]); },
  pushStats: (p) => {
    statsPushes.push(p);
    // 与真实主进程一致：stats-live 实时镜像进内存 config（0.25s 内新鲜），
    // 否则设置类广播会用旧快照回填 pet.stats，复现「交互后状态不动」的旧 bug
    if (p && p.stats && typeof p.stats === 'object') {
      liveConfig.runtime.stats = Object.assign({}, liveConfig.runtime.stats, p.stats);
    }
  },
  onAction: (cb) => { handlers['api:action'] = cb; },
  onConfigChanged: (cb) => { handlers['api:configChanged'] = cb; },
};

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  performance: { now: () => Date.now() },
  requestAnimationFrame: (fn) => { rafCb = fn; },
  Image: FakeImage,
  document: {
    getElementById: (id) => (id === 'stage' ? canvasStub : id === 'bubble' ? bubbleStub : menuStub),
    addEventListener: (type, fn) => { handlers[`document:${type}`] = fn; },
    documentElement: { style: { setProperty() {} } },
    body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  },
  window: {
    addEventListener: (type, fn) => { handlers[`window:${type}`] = fn; },
    pet: mockApi,
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---------------- 加载脚本 ---------------- */

function load(f) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

for (const f of FILES) {
  try { load(f); console.log(`[load] ${f} OK`); }
  catch (e) { console.error(`[load] ${f} 失败:`, e.message); process.exit(1); }
}
// 浏览器中 window === globalThis；沙箱里需手动桥接
sandbox.window.ConfigSchema = sandbox.ConfigSchema;
sandbox.window.I18N = sandbox.I18N;
sandbox.window.NeedsProfile = sandbox.NeedsProfile;
sandbox.window.AiTalk = sandbox.AiTalk;
try { load('renderer.js'); console.log('[load] renderer.js OK'); }
catch (e) { console.error('[load] renderer.js 失败:', e.message); process.exit(1); }

/* ---------------- 驱动帧 ---------------- */

function step(ms) {
  const cb = rafCb;
  rafCb = null;
  if (!cb) throw new Error('requestAnimationFrame 未续期，主循环中断');
  cb(ms);
}

function frames(n, tRef) {
  for (let i = 0; i < n; i++) { tRef.t += 16.667; step(tRef.t); }
}

async function run() {
  await aiClientTests();
  await new Promise((r) => setTimeout(r, 60));
  if (!rafCb) {
    console.error('[fail] 主循环未启动（boot 可能失败）');
    process.exit(1);
  }

  const errors = [];
  // 必须与沙箱内 performance.now()（= Date.now()）保持同一时钟基准
  const tRef = { t: Date.now() };
  const t = tRef;
  let menuClosed = { outside: false, blur: false, esc: false };
  let zhLabel = '';
  const shape = {};   // 阴影 / 气泡缩放跟随的采样结果

  /* ---- 阶段 1：纯自主运行 1200 帧 ---- */
  try { frames(1200, tRef); }
  catch (e) { errors.push(`自主运行帧 ${e.message}`); }
  console.log(`[phase1] 1200 帧完成，drawImage 调用 ${drawCalls.length} 次`);

  const spritesUsed = new Set(drawCalls.map((img) => (img && img.src ? img.src.split('/').pop() : '?')));
  console.log(`[phase1] 已渲染姿态: ${[...spritesUsed].join(', ')}`);

  /* ---- 阶段 2：模拟交互 ---- */
  try {
    handlers['canvas:pointerdown']({ button: 0, clientX: 320, clientY: 450, screenX: 500, screenY: 500, pointerId: 1 });
    handlers['window:pointerup']({});
    handlers['canvas:pointerdown']({ button: 0, clientX: 320, clientY: 450, screenX: 500, screenY: 500, pointerId: 2 });
    for (let i = 0; i < 30; i++) {
      t.t += 16.667;
      handlers['window:pointermove']({ clientX: 320, clientY: 450, screenX: 500 + i * 4, screenY: 500 + i * 2 });
      step(t.t);
    }
    handlers['window:pointerup']({});
    for (const act of ['feed', 'play', 'call', 'pet']) {
      handlers['api:action'](act);
      frames(240, tRef);
    }

    // 右键菜单：打开 -> 三种关闭路径
    handlers['canvas:contextmenu']({ preventDefault() {}, clientX: 100, clientY: 100 });
    const opened = menuStub.style.display === 'block';
    zhLabel = menuItems[0].textContent;
    handlers['document:pointerdown']({ target: canvasStub });
    menuClosed.outside = menuStub.style.display !== 'block';
    handlers['canvas:contextmenu']({ preventDefault() {}, clientX: 100, clientY: 100 });
    handlers['window:blur']();
    menuClosed.blur = menuStub.style.display !== 'block';
    handlers['canvas:contextmenu']({ preventDefault() {}, clientX: 100, clientY: 100 });
    handlers['window:keydown']({ key: 'Escape', preventDefault() {} });
    menuClosed.esc = menuStub.style.display !== 'block';
    console.log(`[phase2] 菜单: 打开=${opened} 外部=${menuClosed.outside} 失焦=${menuClosed.blur} Esc=${menuClosed.esc} 中文标签="${zhLabel}"`);

    // 菜单点击「设置…」
    handlers['menu:click']({ target: { closest: () => menuItems.find((m) => m.dataset.act === 'settings') } });
    frames(10, tRef);

    /* 体型边界（缩放已迁移至设置与滚轮：用滚轮事件模拟）
       命中区 hitCat 随体型等比缩放，指针纵向固定在 y=530：
       该位置对 20%（k=0.284，命中椭圆纵向 [509,582]）到 100%（[194,557]）全区间都在命中区内。
       横向取「最近一帧阴影圆盘的 x」= pet.x，保证每次滚轮都落在猫身上。 */
    const shadowNow = () => ellipseCalls.filter(
      (a) => a[3] > 0 && Math.abs(a[2] / a[3] - 92 / 17) < 0.05
    );
    const catX = () => {
      const s = shadowNow();
      return s.length ? s[s.length - 1][0] : 320;
    };
    const wheel = (dy) => handlers['canvas:wheel']({ deltaY: dy, clientX: catX(), clientY: 530, preventDefault() {} });
    const sizeCallsCount = () => apiCalls.filter(
      (c) => c[0] === 'saveConfig' && c[1] && c[1].pet && typeof c[1].pet.size === 'number'
    ).length;
    const lastSize = () => {
      for (let i = apiCalls.length - 1; i >= 0; i--) {
        const c = apiCalls[i];
        if (c[0] === 'saveConfig' && c[1] && c[1].pet && typeof c[1].pet.size === 'number') return c[1].pet.size;
      }
      return NaN;
    };
    const setSize = (v) => {
      liveConfig = Schema.mergePatch(liveConfig, { pet: { size: v } });
      handlers['api:configChanged']({ config: Schema.deepClone(liveConfig), changed: ['pet.size'] });
    };

    // 连续 12 次滚轮都不再产生新值 → 判定已到边界
    const zoomUntilSaturated = (dy) => {
      let same = 0, count = sizeCallsCount();
      for (let i = 0; i < 80; i++) {
        wheel(dy);
        frames(4, tRef);
        const c = sizeCallsCount();
        if (c === count) { if (++same >= 12) break; } else { same = 0; count = c; }
      }
      return lastSize();
    };
    setSize(0.528);
    frames(10, tRef);
    const atMax = zoomUntilSaturated(-100);
    const atMin = zoomUntilSaturated(100);
    console.log(`[phase2] 体型: 上限=${atMax} 下限=${atMin}`);
    ok(Math.abs(atMax - 0.88) < 1e-9, `体型上限: 持续滚轮放大 → ${atMax}（期望 0.88 = 100%）`);
    ok(Math.abs(atMin - 0.176) < 1e-9, `体型下限: 持续滚轮缩小 → ${atMin}（期望 0.176 = 20%）`);

    /* 体型百分比语义：100% = 0.88（基准），范围 20%–100%，每格 5%
       猫可能正处于跳跃中（命中区上移），单次滚轮未必生效 → 还原起点后重试，
       一旦气泡出现期望文本即说明该次滚轮命中。 */
    const wheelExpect = (from, dy, expect, label) => {
      for (let i = 0; i < 8; i++) {
        setSize(from);
        frames(2, tRef);
        wheel(dy);
        frames(4, tRef);
        if (bubbleStub.textContent === expect) return true;
      }
      console.log(`[phase2] 未命中: ${label}（最后一次气泡="${bubbleStub.textContent}"）`);
      return false;
    };
    ok(wheelExpect(0.792, 100, '大小 85%', '0.792 → 0.748'),
      `体型百分比: 0.792 → 0.748（期望 大小 85%）`);
    ok(wheelExpect(0.396, 100, '大小 40%', '0.396 → 0.352'),
      `体型百分比: 0.396 → 0.352（期望 大小 40%）`);
    ok(wheelExpect(0.836, -100, '已到最大体型', '0.836 → 0.88'),
      `体型上限提示: 0.836 → 0.88（期望 已到最大体型）`);
    ok(wheelExpect(0.22, 100, '已到最小体型', '0.22 → 0.176'),
      `体型下限提示: 0.22 → 0.176（期望 已到最小体型）`);
    setSize(0.88);
    frames(30, tRef);
  } catch (e) {
    errors.push(`交互阶段: ${e.message}`);
  }

  /* ---- 阶段 3：长时运行（含睡眠周期） ---- */
  try { frames(5400, tRef); }
  catch (e) { errors.push(`长时运行帧: ${e.message}`); }
  console.log(`[phase3] 累计 drawImage ${drawCalls.length} 次`);

  const allSprites = new Set(drawCalls.map((img) => (img && img.src ? img.src.split('/').pop() : '?')));
  console.log(`[phase3] 全部渲染姿态: ${[...allSprites].sort().join(', ')}`);

  /* ---- 阶段 4：config-changed 联动 ---- */
  // 与真实主进程一致：改配置先落 liveConfig，再向渲染进程广播
  const applyLive = (patch) => {
    liveConfig = Schema.mergePatch(liveConfig, patch);
    handlers['api:configChanged']({
      config: Schema.deepClone(liveConfig),
      changed: Object.keys(patch),
      // 测试注入：真实主进程只在「外部权威数据整体替换」时置位；
      // 沙箱靠它下发指定的初始属性（运行期属性归渲染进程所有，普通广播不再采纳）
      statsReset: !!(patch && patch.runtime && patch.runtime.stats),
    });
  };
  try {
    // 4a. 语言固定中文：即使配置携带 en-US，右键菜单仍为中文
    applyLive({ appear: { language: 'en-US' } });
    frames(30, tRef);
    const fixedLabel = menuItems[0].textContent;
    console.log(`[phase4] 语言固定中文: "${zhLabel}" -> "${fixedLabel}"`);
    ok(fixedLabel === zhLabel && fixedLabel !== 'Pet',
      `语言固定中文: 菜单标签 = "${fixedLabel}"（携带 en-US 也不切换）`);

    // 4b. 改名 + 饱食危急 → 强制讨食气泡带新名字（{name} 占位符）
    //     restiness 置 0：保证采样窗口内猫保持活动并高频呼喊
    applyLive({
        behavior: { restiness: 0, needVoice: true },
        pet: { petName: '年糕' },
        runtime: { stats: { hunger: 10, energy: 80, happiness: 80, cleanliness: 80 } },
        sound: { notifications: true, notifyInterval: 5 },
      });
    frames(60, tRef);
    // 饱食处于 critical 档：每次决策都走「强制讨食」，气泡受 45s/属性 危急冷却限制；
    // 采样 18000 帧（300 秒 ≈ 6–7 次气泡），把「全部句子都不含名字」的概率压到 0.2% 以下
    let sawName = false;
    for (let i = 0; i < 18000; i++) {
      t.t += 16.667;
      step(t.t);
      if (bubbleStub.textContent.indexOf('年糕') >= 0) sawName = true;
    }
    ok(sawName, `改名生效: 气泡出现新名字（最后一次气泡="${bubbleStub.textContent}"）`);
    const notified = apiCalls.some((c) => c[0] === 'notify' && c[1] && String(c[1].body).indexOf('年糕') >= 0);
    ok(notified, '系统通知: 低饱食触发且文案带宠物名');

    // 4c. 气泡关闭 → 不再更新气泡文案
    applyLive({ sound: { bubbles: false }, pet: { petName: '关闭气泡喵' } });
    const before = bubbleStub.textContent;
    handlers['api:action']('feed');
    frames(120, tRef);
    handlers['api:action']('call');
    frames(120, tRef);
    ok(bubbleStub.textContent === before, '气泡开关: 关闭后气泡不再更新');

    // 4d. 减少动态效果 + 隐藏阴影 + 关粒子 → 不报错即可
    applyLive({
        appear: { reduceMotion: true, showShadow: false, showParticles: false, opacity: 60, uiScale: 120 },
      });
    frames(300, tRef);
    ok(true, '减少动效/阴影/粒子/透明度/字号: 应用无运行时错误');

    // 4e. 滚轮缩放开关
    applyLive({ interact: { wheelZoom: false } });
    const sizeCallsBefore = apiCalls.filter((c) => c[0] === 'saveConfig' && c[1].pet && c[1].pet.size).length;
    handlers['canvas:wheel']?.({ deltaY: -100, clientX: 320, clientY: 450, preventDefault() {} });
    frames(30, tRef);
    const sizeCallsAfter = apiCalls.filter((c) => c[0] === 'saveConfig' && c[1].pet && c[1].pet.size).length;
    ok(sizeCallsBefore === sizeCallsAfter, '滚轮缩放开关: 关闭后滚轮不再改变体型');

    /* ---- 4f. 修复验证：阴影圆盘 / 气泡随体型同比缩放 ---- */
    const BW = bubbleStub.offsetWidth;
    const applyShape = (patch) => applyLive(patch);
    // 食碗碗沿同样是 ellipse 调用（半轴 32×8），按长短轴比筛出阴影圆盘（92×17）
    const shadowCalls = () => ellipseCalls.filter(
      (a) => a[3] > 0 && Math.abs(a[2] / a[3] - 92 / 17) < 0.02
    );
    const sample = () => {
      const s = shadowCalls();
      return {
        // 平滑过渡：rxMax 含窗口头部旧尺寸帧，稳态取末帧（过渡是否平滑由 4n 断言）
        rx: s.length ? Math.max(...s.map((a) => a[2])) : 0,
        rxLast: s.length ? s[s.length - 1][2] : 0,
        petX: s.length ? s[s.length - 1][0] : NaN,
        left: parseFloat(bubbleStub.style.left),
        top: parseFloat(bubbleStub.style.top),
        k: parseFloat((String(bubbleStub.style.transform).match(/scale\(([\d.]+)\)/) || [0, '0'])[1]),
        tail: parseFloat(bubbleStub.style['--tail-x']),
      };
    };

    // 气泡 scale 由弹出动画（0.86→1，0.16s）决定，与体型无关；
    // 逐帧采样取窗口内最大值，避免恰好抓在弹出中途造成误判
    let kMax = 0;
    const runWindow = (n) => {
      kMax = 0;
      for (let i = 0; i < n; i++) {
        t.t += 16.667;
        step(t.t);
        kMax = Math.max(kMax, sample().k);
      }
    };

    applyShape({
      sound: { bubbles: true, bubbleDuration: 6000 },
      appear: { showShadow: true },
      pet: { size: 0.88 },
    });
    handlers['api:action']('call');       // 呼喊回复：产生一条气泡文案
    ellipseCalls.length = 0;             // 只统计本次采样窗口内的阴影绘制
    runWindow(360);
    const big = sample();
    big.kMax = kMax;

    ellipseCalls.length = 0;
    applyShape({ pet: { size: 0.176 } });   // 新的最小体型 20%
    runWindow(360);
    const small = sample();
    small.kMax = kMax;

    shape.big = big;
    shape.small = small;
    console.log(`[phase4] 阴影半长轴: 0.88→${big.rx.toFixed(1)}px  0.176→${small.rx.toFixed(1)}px`);
    console.log(`[phase4] 气泡: 缩放 ${big.k.toFixed(3)}→${small.k.toFixed(3)}  顶边 ${big.top.toFixed(0)}→${small.top.toFixed(0)}px`);
  } catch (e) {
    errors.push(`config-changed 联动: ${e.message}`);
  }

  /* ---- 4g. 动作速度：区间两端与默认值应用无运行时错误，且恢复默认 ---- */
  try {
    applyLive({ behavior: { animSpeed: 20 } });
    frames(600, tRef);
    applyLive({ behavior: { animSpeed: 100 } });
    frames(600, tRef);
    applyLive({ behavior: { animSpeed: 85 } });
    frames(60, tRef);
    ok(true, '动作速度 20%/100%/85%: 应用无运行时错误');
  } catch (e) {
    errors.push(`动作速度: ${e.message}`);
  }

  /* ---- 4h. 新增非交互动作：不高兴（低心情触发）/ 摇尾巴（随机表）+ 睡醒伸懒腰 ---- */
  try {
    const names = (from) => new Set(drawCalls.slice(from)
      .map((img) => (img && img.src ? img.src.split('/').pop() : '?')));
    applyLive({ appear: { language: 'zh-CN' } });   // 语言固定中文，此补丁等价于空操作

    // (1) 心情压到「偏低」档（25，标准档 low = 20–44）→ P5 有 40% 概率走「不高兴」
    //     注意取值需落在 low 档内且留有余量：采样窗口 100s 内心情还会惯性下滑约 1 点，
    //     若取 20 会在窗口内跌穿 critical 阈值 20，切换到危急分支的台词（与断言不符）
    applyLive({
      behavior: { activityLevel: 'high', animSpeed: 85 },
      runtime: { stats: { happiness: 25, energy: 80, hunger: 80, cleanliness: 80 } },
    });
    const markSad = drawCalls.length;
    let sawSulk = false;
    for (let i = 0; i < 6000; i++) {
      t.t += 16.667;
      step(t.t);
      // 跨档即时反应的「偏低」台词、P5 的 sulk、危急台词都算命中（都是「低心情」表现）
      if (/不高兴|生闷气|难过|静静|谁都不理我|尾巴都抬不起来|好无聊|陪我玩|逗猫棒/.test(bubbleStub.textContent)) sawSulk = true;
    }
    const sadFrames = [...names(markSad)].filter((s) => s.startsWith('unhappy_')).sort();
    console.log(`[phase4] 「不高兴」渲染帧: ${sadFrames.join(', ') || '(无)'}（气泡命中=${sawSulk}）`);
    ok(sawSulk, `新动作「不高兴」: 低心情时气泡出现情绪台词（最后一次="${bubbleStub.textContent}"）`);
    ok(sadFrames.length >= 2, `新动作「不高兴」: 渲染到全部 2 帧（实际 ${sadFrames.join(',') || '无'}）`);

    // (2) 心情恢复 → decide() 落到随机表，覆盖「摇尾巴」
    //     restiness 置 0 让全部决策走活动表（排除趴睡为主的干扰）；
    //     期间定期补满属性，避免饱食/精力跌破阈值后 decide() 一直走 sleep/hungry 分支
    applyLive({ behavior: { restiness: 0 } });
    const markWag = drawCalls.length;
    // 窗口 150 s → 230 s：走/跑现在至少播 2 轮（更长），同样时长内决策次数变少，
    // 窗口太短会让「摇尾巴」偶发漏抽，断言随机翻红。
    for (let i = 0; i < 14000; i++) {
      t.t += 16.667;
      step(t.t);
      if (i % 1500 === 0) {
        applyLive({ runtime: { stats: { happiness: 90, energy: 80, hunger: 80, cleanliness: 80 } } });
      }
    }
    const wagFrames = [...names(markWag)].filter((s) => s.startsWith('tailwag_')).sort();
    if (process.env.WR_DEBUG) {
      const cnt = {};
      names(markWag).forEach((n) => { const k = n.split('_')[0]; cnt[k] = (cnt[k] || 0) + 1; });
      console.log('  [dbg] 150s 窗口姿态分布:', JSON.stringify(cnt));
    }
    console.log(`[phase4] 「摇尾巴」渲染帧: ${wagFrames.join(', ') || '(无)'}`);
    ok(wagFrames.length >= 3,
      `新动作「摇尾巴」: 随机表触发并渲染多帧（实际 ${wagFrames.join(',') || '无'}）`);

    // (3) 睡觉 → 醒来伸懒腰：压低精力后等一个完整睡眠周期（30–70s），确定性覆盖 stretch
    applyLive({ runtime: { stats: { happiness: 80, energy: 10, hunger: 80, cleanliness: 80 } } });
    const markStretch = drawCalls.length;
    for (let i = 0; i < 9600; i++) { t.t += 16.667; step(t.t); }   // 160s > 进入延迟 + 最长睡眠 70s
    const woke = names(markStretch);
    const slept = [...woke].filter((s) => s.startsWith('sleep_'));
    const stretched = [...woke].filter((s) => s.startsWith('stretch_'));
    console.log(`[phase4] 睡眠周期渲染: 睡觉=${slept.join(',') || '无'} 伸懒腰=${stretched.join(',') || '无'}`);
    ok(slept.length >= 2 && stretched.length >= 2,
      `睡眠周期: 趴下睡觉 → 醒来伸懒腰（sleep ${slept.length} 帧 / stretch ${stretched.length} 帧）`);
  } catch (e) {
    errors.push(`新增动作: ${e.message}`);
  }

  /* ---- 4i. 洗澡：入口触发 → 渲染 bath 帧 → 清洁大幅回升；睡觉中被唤醒 ---- */
  try {
    // (1) 睡眠中被洗澡指令唤醒：sleep → stretch 过渡（不硬切）
    applyLive({ runtime: { stats: { happiness: 80, energy: 10, hunger: 80, cleanliness: 40 } } });
    const wakeMark = drawCalls.length;
    for (let i = 0; i < 300; i++) { t.t += 16.667; step(t.t); }   // 等 5s 让猫入睡
    handlers['api:action']('bath');
    const wakeFrames = [];
    for (let i = 0; i < 120; i++) {   // 唤醒后 2s 内应先渲染 stretch 帧
      t.t += 16.667;
      step(t.t);
      const last = drawCalls[drawCalls.length - 1];
      const n = last && last.src ? last.src.split('/').pop() : '';
      if (n.startsWith('stretch_') && wakeFrames.length < 1) wakeFrames.push(n);
    }
    ok(wakeFrames.length >= 1, `睡眠唤醒: 洗澡指令先经伸懒腰过渡（首帧 ${wakeFrames[0] || '无'}）`);

    // (2) 洗澡全程渲染 bath 帧且清洁大幅回升（+55）
    const bathMark = drawCalls.length;
    const pushMark = statsPushes.length;
    const cleanBefore = liveConfig.runtime.stats.cleanliness;
    for (let i = 0; i < 420; i++) {   // 7s > 4.5s 动作时长
      t.t += 16.667;
      step(t.t);
    }
    const bathFrames = [...new Set(drawCalls.slice(bathMark)
      .map((img) => (img && img.src ? img.src.split('/').pop() : '?')))]
      .filter((s) => s.startsWith('bath_')).sort();
    console.log(`[phase4] 「洗澡」渲染帧: ${bathFrames.join(', ') || '(无)'}`);
    ok(bathFrames.length >= 4, `新动作「洗澡」: 渲染到 6 帧序列（实际 ${bathFrames.length} 帧）`);
    // 洗澡结算反映在渲染进程的实时 stats（经 statsPushes 上报，不等落盘节流）
    const pushedClean = statsPushes.slice(pushMark).map((p) => p.stats && p.stats.cleanliness).filter(Number.isFinite);
    const maxClean = pushedClean.length ? Math.max(...pushedClean) : NaN;
    ok(maxClean > cleanBefore + 40,
      `洗澡效果: 清洁 ${Math.round(cleanBefore * 10) / 10} → ${Math.round(maxClean * 10) / 10}（实时推送，应大幅回升 ≥40）`);

    // (3) 洗澡入口恒开放（1.0.0 起「允许洗澡」下线）：指令直接生效
    const offMark = drawCalls.length;
    handlers['api:action']('bath');
    for (let i = 0; i < 60; i++) { t.t += 16.667; step(t.t); }
    const offBath = [...new Set(drawCalls.slice(offMark)
      .map((img) => (img && img.src ? img.src.split('/').pop() : '?')))]
      .filter((s) => s.startsWith('bath_'));
    ok(offBath.length > 0, '洗澡入口: 恒开放（bath 指令渲染 bath 帧）');
    for (let i = 0; i < 360; i++) { t.t += 16.667; step(t.t); }   // 等浴盆动作完整结束（结算不串入后续用例）
    applyLive({ behavior: { restiness: 70 } });
  } catch (e) {
    errors.push(`洗澡功能: ${e.message}`);
  }

  /* ---- 4j. 属性驱动：档位 → 气泡 / 行为 / 面板徽章 ---- */
  try {
    const namesFrom = (from) => new Set(drawCalls.slice(from)
      .map((img) => (img && img.src ? img.src.split('/').pop() : '?')));
    const lastTiers = () => {
      for (let i = statsPushes.length - 1; i >= 0; i--) {
        if (statsPushes[i] && statsPushes[i].tiers) return statsPushes[i].tiers;
      }
      return null;
    };
    applyLive({
      appear: { language: 'zh-CN' },
      behavior: {
        needVoice: true, needSensitivity: 'standard', restiness: 0,
        activityLevel: 'high',
      },
      sound: { bubbles: true, bubbleDuration: 6000 },
      runtime: { stats: { hunger: 80, energy: 80, happiness: 80, cleanliness: 80 } },
    });
    frames(30, tRef);

    // (1) 清洁危急 → 清洁类台词 + 蔫下来的行为
    applyLive({ runtime: { stats: { cleanliness: 5 } } });
    const markDirty = drawCalls.length;
    let sawDirty = false;
    for (let i = 0; i < 6000; i++) {
      t.t += 16.667; step(t.t);
      if (/脏|打结|沾灰|蓬松|不舒服|洗澡/.test(bubbleStub.textContent)) sawDirty = true;
    }
    ok(sawDirty, `清洁危急: 出现清洁相关台词（最后一次="${bubbleStub.textContent}"）`);
    ok([...namesFrom(markDirty)].some((s) => s.startsWith('unhappy_')),
      '清洁危急: 行为上蔫下来（渲染 unhappy 帧）');

    // (2) 面板徽章数据：推送的 tiers 与档位一致
    applyLive({ runtime: { stats: { cleanliness: 5, hunger: 90, energy: 90, happiness: 90 } } });
    frames(30, tRef);
    const tg = lastTiers();
    ok(tg && tg.cleanliness === 'critical' && tg.hunger === 'good' && tg.happiness === 'good',
      `面板徽章数据: 清洁=${tg && tg.cleanliness} 饱食=${tg && tg.hunger} 心情=${tg && tg.happiness}（期望 critical / good / good）`);

    // (3) 饱食危急 → 强制讨食
    applyLive({ runtime: { stats: { hunger: 5, energy: 90, happiness: 90, cleanliness: 90 } } });
    const markStarve = drawCalls.length;
    for (let i = 0; i < 900; i++) { t.t += 16.667; step(t.t); }
    ok([...namesFrom(markStarve)].some((s) => s.startsWith('meow_')),
      '饱食危急: 强制讨食（渲染 meow 帧）');

    // (4) 体力危急 → 强制入睡；睡眠中饱食跌到危急也不被打断
    applyLive({ runtime: { stats: { energy: 5, hunger: 90, happiness: 90, cleanliness: 90 } } });
    const markSleep = drawCalls.length;
    for (let i = 0; i < 300; i++) { t.t += 16.667; step(t.t); }
    ok([...namesFrom(markSleep)].some((s) => s.startsWith('sleep_')), '体力危急: 强制入睡');
    const markSleepHungry = drawCalls.length;
    applyLive({ runtime: { stats: { hunger: 2 } } });     // 睡梦中饱食跌到危急
    for (let i = 0; i < 60; i++) { t.t += 16.667; step(t.t); }
    const during = [...namesFrom(markSleepHungry)];
    ok(during.some((s) => s.startsWith('sleep_')) && !during.some((s) => s.startsWith('meow_')),
      `睡眠抑制: 睡着时饱食跌到危急不被唤醒（睡眠帧 ${during.filter((s) => s.startsWith('sleep_')).join(',')}）`);

    // (5) 灵敏度：同一属性值在 strict / standard / relaxed 下判定不同
    // 先唤醒 (4) 留下的睡眠（sleep → stretch → pet），并让恢复台词覆盖旧气泡
    handlers['api:action']('pet');
    frames(240, tRef);
    applyLive({
      behavior: { needSensitivity: 'strict' },
      runtime: { stats: { cleanliness: 42, hunger: 90, energy: 90, happiness: 90 } },
    });
    frames(30, tRef);
    const tStrict = lastTiers();
    applyLive({ behavior: { needSensitivity: 'relaxed' } });
    frames(30, tRef);
    const tRelaxed = lastTiers();
    applyLive({ behavior: { needSensitivity: 'standard' } });
    frames(30, tRef);
    const tStd = lastTiers();
    ok(tStrict && tStrict.cleanliness === 'low' && tStd && tStd.cleanliness === 'normal'
      && tRelaxed && tRelaxed.cleanliness === 'normal',
      `灵敏度: 清洁 42 → strict=${tStrict && tStrict.cleanliness} standard=${tStd && tStd.cleanliness} relaxed=${tRelaxed && tRelaxed.cleanliness}`);

    // (7) 关闭「状态驱动」→ 属性不再产生任何需求台词，档位回落为全 normal
    applyLive({
      behavior: { needVoice: false },
      runtime: { stats: { cleanliness: 3, hunger: 20, energy: 20, happiness: 20 } },
    });
    let needTextWhenOff = false;
    let offText = '';
    let offAt = -1;
    for (let i = 0; i < 3000; i++) {
      t.t += 16.667; step(t.t);
      if (/脏|打结|沾灰|蓬松|不舒服|洗澡|饿|难过|不高兴|想眯|打个盹/.test(bubbleStub.textContent)) {
        needTextWhenOff = true;
        offText = bubbleStub.textContent;
        if (offAt < 0) offAt = i;
      }
    }
    ok(!needTextWhenOff, `状态驱动关闭: 四项属性不再产生需求台词${needTextWhenOff ? `（误出="${offText}" @${(offAt / 60).toFixed(1)}s）` : ''}`);
    const tOff = lastTiers();
    ok(tOff && ['hunger', 'energy', 'happiness', 'cleanliness'].every((k) => tOff[k] === 'normal'),
      '状态驱动关闭: 面板档位回落为全 normal');

    // 收尾：恢复默认，避免影响后续断言
    applyLive({
      behavior: {
        needVoice: true, needSensitivity: 'standard', restiness: 70,
        activityLevel: 'normal',
      },
    });
    frames(60, tRef);
  } catch (e) {
    errors.push(`属性驱动: ${e.message}`);
  }

  /* ---- 4k. 尺寸恒定：任何动作（含落地、伤心）不得产生非等比缩放 ---- */
  try {
    applyLive({
      behavior: { needVoice: true, restiness: 0, activityLevel: 'high' },
      appear: { reduceMotion: false, showParticles: true },
      runtime: { stats: { hunger: 80, energy: 80, happiness: 80, cleanliness: 80 } },
    });
    const scaleMark = scaleCalls.length;
    // 高活跃度跑 80s：覆盖 walk / run / jump（含落地挤压路径）/ idle / stretch / tailwag / sleep
    for (let i = 0; i < 4800; i++) { t.t += 16.667; step(t.t); }
    // 再补交互动作（pet / bath）与伤心（心情压低）
    handlers['api:action']('pet');
    for (let i = 0; i < 120; i++) { t.t += 16.667; step(t.t); }
    handlers['api:action']('bath');
    for (let i = 0; i < 420; i++) { t.t += 16.667; step(t.t); }
    applyLive({ runtime: { stats: { happiness: 10 } } });
    for (let i = 0; i < 1200; i++) { t.t += 16.667; step(t.t); }

    let worst = 0;
    let worstCall = null;
    for (const c of scaleCalls.slice(scaleMark)) {
      const ax = Math.abs(Number(c[0]) || 0);
      const ay = Math.abs(Number(c[1]) || 0);
      if (ay <= 0) continue;
      const d = Math.abs(ax / ay - 1);
      if (d > worst) { worst = d; worstCall = c; }
    }
    ok(scaleCalls.length > scaleMark && worst < 1e-6,
      `尺寸恒定: ${scaleCalls.length - scaleMark} 次缩放全部等比（最大偏差 ${(worst * 100).toFixed(4)}%${worstCall ? ` @(${worstCall[0]}, ${worstCall[1]})` : ''}）`);
  } catch (e) {
    errors.push(`尺寸恒定: ${e.message}`);
  }

  /* ---- 4l. 特效定位（engine/fx.js）与玩具球物理（engine/particles.js） ---- */
  try {
    const FX = vm.runInContext('Fx', sandbox);
    const PS = vm.runInContext('Particles', sandbox);

    // 力度/尺寸系数：跟体型走，但有下限（否则 20% 体型时爱心只有 2px 看不见）
    ok(Math.abs(FX.scaleFactor(0.88) - 1) < 1e-9, 'FX: 100% 体型系数为 1');
    ok(Math.abs(FX.scaleFactor(0.308) - 0.5) < 1e-9, 'FX: 35% 体型系数夹到下限 0.5（特效仍有力度）');
    ok(Math.abs(FX.scaleFactor(1.2) - 1.15) < 1e-9, 'FX: 超大体型系数夹到上限 1.15');
    ok(Math.abs(FX.sizeMul(0.308) - 0.775) < 1e-9, 'FX: 小体型尺寸只缩到 77.5%（保留可见度）');

    // 几何：idle 素材内容顶部 131、基线 470、落地点 588
    const g100 = FX.geom({ contentTop: 131, spriteGroundY: 470, ground: 588, y: 0, scale: 0.88, poseScale: 1 });
    const g35 = FX.geom({ contentTop: 131, spriteGroundY: 470, ground: 588, y: 0, scale: 0.308, poseScale: 1 });
    ok(Math.abs(g100.h - 298.32) < 0.01 && Math.abs(g100.top - 289.68) < 0.01,
      `FX: 100% 体型头顶 ${g100.top.toFixed(1)} 高 ${g100.h.toFixed(1)}（猫在窗口里约 300px）`);
    ok(Math.abs(g35.h - 104.4) < 0.1 && Math.abs(g35.top - 483.6) < 0.1,
      `FX: 35% 体型头顶 ${g35.top.toFixed(1)} 高 ${g35.h.toFixed(1)}（猫只有约 100px 高）`);

    // 旧实现：爱心写死 GROUND-250、Zzz 写死 GROUND-150..215 —— 小体型时离猫头顶多远
    const oldHeartD = (588 - 250) < g35.top ? g35.top - (588 - 250) : 0;
    ok(oldHeartD > g35.h * 1.2,
      `FX: 旧爱心位置比小体型猫头顶高 ${oldHeartD.toFixed(0)}px（约 ${(oldHeartD / g35.h).toFixed(1)} 倍身高）—— 即「飘在远处」的成因`);

    // 新起点必须落在猫头可见范围内（爱心贴头、Zzz 贴右上）
    let heartInside = true;
    let zzzInside = true;
    for (let i = 0; i < 200; i++) {
      const g = i % 2 ? g35 : g100;
      const hy = g.top + g.h * (0.02 + 0.16 * Math.random());
      if (hy < g.top - 0.5 || hy > g.top + g.h * 0.2) heartInside = false;
      const hx = Math.abs(0.45 * g.halfW);
      if (hx > g.halfW) heartInside = false;
      const zy = g.top + g.h * (-0.02 + 0.12 * Math.random());
      const zx = g.halfW * (0.45 + 0.5 * Math.random());
      if (zy < g.top - 0.03 * g.h || zy > g.top + 0.11 * g.h || zx > g.halfW) zzzInside = false;
    }
    ok(heartInside, 'FX: 爱心起点始终落在头顶范围内（任何体型）');
    ok(zzzInside, 'FX: Zzz 起点贴着头部右上沿（任何体型）');

    // 玩具球：与 renderer 完全一致的参数（100% 体型）
    const makeBall = (px, scale, dir) => {
      const g = FX.geom({ contentTop: 131, spriteGroundY: 470, ground: 588, y: 0, scale, poseScale: 1 });
      const f = FX.scaleFactor(scale);
      const s = 20 * FX.sizeMul(scale);
      const ps = new PS();
      ps.emit({
        kind: 'ball',
        x: Math.min(640 - 24, Math.max(24, px + dir * g.halfW * 0.9)),
        y: g.top + g.h * 0.45,
        vx: dir * 82 * f, vy: -110 * f, gravity: 900 * f,
        size: s, life: 5.2, fade: false, fadeTail: 0.7, fixedSize: true,
        bounce: 0.55, drag: 2.2, restLife: 1.1,
        groundY: 588 - s * 0.6, minX: 16, maxX: 624,
      });
      return ps;
    };

    const runBall = (ps, secs) => {
      const dt = 1 / 120;
      const n = Math.round(secs * 120);
      const st = { maxY: -Infinity, minX: Infinity, maxX: -Infinity, t: 0 };
      for (let i = 0; i < n; i++) {
        const p = ps.list[0];
        if (!p) break;
        st.maxY = Math.max(st.maxY, p.y);
        st.minX = Math.min(st.minX, p.x);
        st.maxX = Math.max(st.maxX, p.x);
        if (!st.settleAt && p.rolling) st.settleAt = i / 120;
        st.t = i / 120;
        ps.update(dt);
      }
      st.alive = ps.list.length > 0;
      return st;
    };

    const b1 = makeBall(320, 0.88, 1);
    const ballGround = 588 - 20 * FX.sizeMul(0.88) * 0.6;
    const s1 = runBall(b1, 2.6);
    ok(s1.alive === true, '玩具球: 2.6s 时仍在（旧实现此刻已被硬删 → 「球消失」）');
    ok(s1.maxY <= ballGround + 0.01,
      `玩具球: 全程不穿地（最深 ${s1.maxY.toFixed(1)} ≤ 贴地 ${ballGround.toFixed(1)}）`);
    ok(s1.minX >= 15.99 && s1.maxX <= 624.01,
      `玩具球: 全程留在窗口内（x ${s1.minX.toFixed(0)}–${s1.maxX.toFixed(0)}，旧实现朝左会飞出画面）`);
    ok(s1.settleAt != null && s1.settleAt > 1.2 && s1.settleAt < 2.6,
      `玩具球: 弹跳 ${s1.settleAt ? s1.settleAt.toFixed(2) : '-'}s 后贴地停稳（有多次弹跳过渡）`);
    const settled = b1.list[0];
    ok(settled && settled.rolling && settled.vy === 0 && Math.abs(settled.y - ballGround) < 0.01,
      `玩具球: 停稳时正好贴地（vy=${settled ? settled.vy : 'gone'} y=${settled ? settled.y.toFixed(1) : '-'}）`);
    runBall(b1, 1.4);
    ok(b1.list.length === 0,
      '玩具球: 停稳后停留约 1.1s + 0.7s 淡出才移除（不是到点硬删）');

    // 朝左抛出也留在窗口内（旧实现 vx 恒为负值，朝左会一路飞出画面）
    const s2 = runBall(makeBall(320, 0.88, -1), 2.6);
    ok(s2.minX >= 15.99 && s2.maxX <= 624.01,
      `玩具球(朝左): 反弹后仍在窗口内（x ${s2.minX.toFixed(0)}–${s2.maxX.toFixed(0)}）`);

    // 淡出尾：fade:false + fadeTail 也要有透明度过渡，不能「啪」地消失
    const alphas = [];
    const ctxStub = new Proxy({}, {
      get(t, k) {
        if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
        return k in t ? t[k] : () => undefined;
      },
      set(t, k, v) { if (k === 'globalAlpha') alphas.push(v); t[k] = v; return true; },
    });
    const b2 = makeBall(320, 0.88, 1);
    b2.list[0].life = 0.35;
    b2.draw(ctxStub);
    ok(alphas.length === 1 && alphas[0] > 0.4 && alphas[0] < 0.6,
      `玩具球: 收尾 0.35s 时透明度 ${alphas[0] ? alphas[0].toFixed(2) : '-'}（0.5=半透明，有淡出）`);

    // 小体型：球也要跟着缩、并且同样贴地不穿模
    const b3 = makeBall(320, 0.308, 1);
    const smallGround = 588 - 20 * FX.sizeMul(0.308) * 0.6;
    const s3 = runBall(b3, 2.6);
    ok(s3.maxY <= smallGround + 0.01 && s3.alive === true,
      `玩具球(35% 体型): 贴地不穿模且 2.6s 仍在（地面 ${smallGround.toFixed(1)}）`);
  } catch (e) {
    errors.push(`特效/玩具球: ${e.message}`);
  }

  /* ---- 4m. 本轮三项修复验证：喂食/逗玩结算、回声不回滚、双下拉框衰减、裸 key 守卫 ---- */
  try {
    const liveStats = () => {
      for (let i = statsPushes.length - 1; i >= 0; i--) {
        const s = statsPushes[i] && statsPushes[i].stats;
        if (s && Number.isFinite(s.hunger)) return s;
      }
      return null;
    };
    const srcRend = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
    const srcMain = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const srcSchema = fs.readFileSync(path.join(ROOT, 'engine', 'config-schema.js'), 'utf8');

    // 源级守卫：衰减改由设置驱动；回声过滤与主进程镜像就位；迁移链完整
    ok(srcRend.indexOf('function decayPerSec(stat)') >= 0 && srcRend.indexOf('DECAY_BASE') < 0,
      '修复: 属性衰减改由 needs 各属性独立「每 30 分钟点数」驱动（decayPerSec(stat)，DECAY_BASE 已移除）');
    ok(srcRend.indexOf("changed.every((p) => p === 'runtime.stats')") >= 0,
      '修复: 渲染进程过滤纯 runtime.stats 回声广播（旧快照不再覆盖交互收益）');
    ok(srcMain.indexOf('config.runtime.stats = Object.assign({}, config.runtime.stats, p.stats)') >= 0,
      '修复: 主进程 stats-live 实时镜像属性（广播携带的属性不落后一个保存周期）');
    ok(srcSchema.indexOf('function migrateV7toV8') >= 0
      && srcSchema.indexOf('migrateV7toV8(migrateV6toV7(raw))') >= 0,
      '修复: v7→v8 迁移就位且 v6 旧配置链式迁移');

    // (1) 喂食结算：饱食 +42 实时反映在面板推送
    applyLive({
      behavior: { needVoice: true, restiness: 0 },
      sound: { bubbles: true, bubbleDuration: 6000 },
      needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },   // 关闭衰减，排除干扰
      runtime: { stats: { hunger: 50, energy: 80, happiness: 60, cleanliness: 80 } },
    });
    frames(30, tRef);
    handlers['api:action']('feed');
    for (let i = 0; i < 480; i++) { t.t += 16.667; step(t.t); }   // 走到位 + 进食 4.2s
    const sFed = liveStats();
    ok(sFed && sFed.hunger > 85 && sFed.hunger < 100,
      `喂食结算: 饱食 → ${sFed ? Math.round(sFed.hunger * 10) / 10 : '-'}（50 + 42 应生效）`);

    // (2) 回声保护：纯 runtime.stats 回声广播（旧快照）不得回滚刚结算的收益
    const stale = Schema.deepClone(liveConfig);
    stale.runtime.stats = { hunger: 50, energy: 80, happiness: 60, cleanliness: 80, affinity: 10, xp: 0 };
    handlers['api:configChanged']({ config: stale, changed: ['runtime.stats'] });
    frames(10, tRef);
    const sEcho = liveStats();
    ok(sEcho && sEcho.hunger > 85,
      `回声过滤: 纯 runtime.stats 回声后饱食仍 ${sEcho ? Math.round(sEcho.hunger * 10) / 10 : '-'}（不被旧快照回滚）`);
    // 对照组：带其他分组的广播（模拟真实外部变更）仍正常生效
    applyLive({ runtime: { stats: { hunger: 30, energy: 80, happiness: 60, cleanliness: 80 } } });
    frames(10, tRef);
    const sExt = liveStats();
    ok(sExt && sExt.hunger < 40,
      `外部变更: 携带其他分组的广播仍正常采纳（饱食 → ${sExt ? Math.round(sExt.hunger * 10) / 10 : '-'}）`);

    // (3) 逗玩结算：心情 +26
    applyLive({ needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 } });
    frames(30, tRef);
    handlers['api:action']('play');
    for (let i = 0; i < 300; i++) { t.t += 16.667; step(t.t); }   // 逗玩 3.2s
    const sPlay = liveStats();
    ok(sPlay && sPlay.happiness > 80,
      `逗玩结算: 心情 → ${sPlay ? Math.round(sPlay.happiness * 10) / 10 : '-'}（+26 应生效）`);

    // (4) 衰减速率：饱食每 30 分钟下降 20 点 → 20/1800 点/秒；30 秒约降 0.333
    applyLive({
      behavior: { restiness: 0 },
      needs: { decayHunger: 20, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
      runtime: { stats: { hunger: 90, energy: 90, happiness: 90, cleanliness: 90 } },
    });
    frames(30, tRef);
    const dBefore = liveStats().hunger;
    for (let i = 0; i < 1800; i++) { t.t += 16.667; step(t.t); }   // 30s
    const dDelta = dBefore - liveStats().hunger;
    ok(Math.abs(dDelta - 20 / 60) < 0.05,
      `衰减速率: 饱食 20 点/30 分钟 → 30 秒降 ${dDelta.toFixed(3)}（期望 ≈${(20 / 60).toFixed(3)}）`);
    // 点数 = 0 → 该属性不随时间下降
    applyLive({ needs: { decayHunger: 0 } });
    const zBefore = liveStats().hunger;
    for (let i = 0; i < 300; i++) { t.t += 16.667; step(t.t); }
    ok(Math.abs(liveStats().hunger - zBefore) < 0.01,
      '衰减关闭: 点数 0 → 饱食不随时间下降（残差仅为镜像两位小数舍入）');

    // (5) 裸 key 守卫：good → normal 跨档（恶化）不再把「bubbles.need.*」当台词
    applyLive({
      behavior: { needVoice: true, needSensitivity: 'standard', restiness: 0 },
      needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
      runtime: { stats: { happiness: 95, hunger: 90, energy: 90, cleanliness: 90 } },
    });
    frames(30, tRef);
    applyLive({ runtime: { stats: { happiness: 55, hunger: 90, energy: 90, cleanliness: 90 } } });
    let sawRawKey = false;
    for (let i = 0; i < 600; i++) {
      t.t += 16.667; step(t.t);
      if (bubbleStub.textContent.indexOf('bubbles.') >= 0) sawRawKey = true;
    }
    ok(!sawRawKey, `裸 key 守卫: good→normal 跨档不出台词（气泡="${bubbleStub.textContent}"）`);

    /* ---- 4n-b. 交互结算不回滚：属性归渲染进程所有，配置类广播不得覆盖 ---- */
    // 源级守卫
    ok(srcRend.indexOf('function applyConfig(adoptStats)') >= 0
      && srcRend.indexOf('config.runtime.stats = pet.stats') >= 0,
      '修复: applyConfig 只有显式权威替换才采纳主进程属性（配置广播保留实时值）');
    ok(srcRend.indexOf('statsPushT = config.appear.statusPanel ? 0.25 : 1') >= 0
      && srcRend.indexOf('api.pushStats && config.appear.statusPanel') < 0,
      '修复: 属性推送不再以「面板打开」为前提（关闭时 1s 一次镜像给主进程）');
    ok(srcRend.indexOf('function flushStats()') >= 0,
      '修复: 交互结算后立即补推属性（flushStats），不等 1s 心跳');

    // (6) 洗澡结算 + 打开面板后不回滚（用户报告的症状）
    applyLive({
      behavior: { needVoice: true, restiness: 0 },
      needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
      runtime: { stats: { hunger: 70, energy: 80, happiness: 60, cleanliness: 40, affinity: 10, xp: 100 } },
    });
    frames(30, tRef);
    handlers['api:action']('bath');
    for (let i = 0; i < 360; i++) { t.t += 16.667; step(t.t); }   // 6s：洗澡 4.5s + 收尾
    const sBath = liveStats();
    ok(sBath && sBath.cleanliness > 90 && sBath.xp >= 106,
      `洗澡结算: 清洁度 ${sBath ? Math.round(sBath.cleanliness * 10) / 10 : '-'}（40+55）、xp ${sBath ? sBath.xp : '-'}（+6）`);

    // 面板关闭时主进程只有旧快照：打开面板的广播（changed 不含 runtime.stats）不得回滚收益
    const staleCfg = Schema.deepClone(liveConfig);
    staleCfg.appear.statusPanel = true;
    staleCfg.runtime.stats = { hunger: 70, energy: 80, happiness: 60, cleanliness: 40, affinity: 10, xp: 100 };
    handlers['api:configChanged']({ config: staleCfg, changed: ['appear.statusPanel'] });
    frames(40, tRef);   // 0.67s：面板打开后 0.25s 一次推送，足以覆盖
    const sKeep = liveStats();
    ok(sKeep && sKeep.cleanliness > 90,
      `打开面板不回滚: 清洁度仍 ${sKeep ? Math.round(sKeep.cleanliness * 10) / 10 : '-'}（旧实现被旧快照打回 40）`);

    // (7) 权威替换（statsReset）仍能生效：迁移 / 导入语义
    const resetCfg = Schema.deepClone(liveConfig);
    resetCfg.runtime.stats = { hunger: 33, energy: 33, happiness: 33, cleanliness: 33, affinity: 0, xp: 7 };
    handlers['api:configChanged']({ config: resetCfg, changed: ['runtime.stats'], statsReset: true });
    frames(40, tRef);
    const sReset = liveStats();
    ok(sReset && sReset.cleanliness < 40 && sReset.xp === 7,
      `权威属性替换: 显式 statsReset 仍采纳（清洁度 ${sReset ? sReset.cleanliness : '-'} / xp ${sReset ? sReset.xp : '-'}）`);

    // (8) 其余交互结算：抚摸 +心情、呼喊 +心情（同样的回滚风险已由上面机制覆盖）
    applyLive({
      behavior: { needVoice: true, restiness: 0 },
      needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
      runtime: { stats: { hunger: 70, energy: 80, happiness: 50, cleanliness: 80, affinity: 10, xp: 100 } },
    });
    frames(30, tRef);
    handlers['api:action']('pet');
    frames(120, tRef);
    const sPet = liveStats();
    ok(sPet && sPet.happiness > 55,
      `抚摸结算: 心情 50 → ${sPet ? Math.round(sPet.happiness * 10) / 10 : '-'}（+8 即时 + 抚摸期间持续）`);

    const beforeCall = liveStats().happiness;
    handlers['api:action']('call');
    frames(20, tRef);   // 立即结算，不等动作结束
    const sCall = liveStats();
    ok(sCall && sCall.happiness > beforeCall + 5,
      `呼喊结算: 心情 ${Math.round(beforeCall * 10) / 10} → ${sCall ? Math.round(sCall.happiness * 10) / 10 : '-'}（+8）`);

    // (9) 面板关闭时属性仍持续镜像给主进程（旧实现整个跳过推送 → 落盘/广播长期落后）
    applyLive({ appear: { statusPanel: false } });
    const nPushBefore = statsPushes.length;
    frames(90, tRef);   // 1.5s
    ok(statsPushes.length - nPushBefore >= 2,
      `面板关闭仍镜像: 1.5s 内推送 ${statsPushes.length - nPushBefore} 次（旧实现 0 次）`);
    applyLive({ appear: { statusPanel: true } });   // 还原默认，避免影响后续菜单开关断言
  } catch (e) {
    errors.push(`三项修复验证: ${e.message}`);
  }

  console.log(`[api] 调用记录: ${[...new Set(apiCalls.map((c) => c[0]))].join(', ') || '(无)'}`);

  /* ---- 4n. 舔爪子动作：帧表 / 节奏 / 两套触发 ---- */
  {
    const src = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
    ok(/lick:\s*\[/.test(src) && (src.match(/lick_\d\.png/g) || []).length === 4,
      '舔爪帧表: lick 注册 4 帧（lick_1..4）');
    ok(/lick:\s*5/.test(src), '舔爪帧率: 5 fps（比 eat 的 6 更慢，舔毛是慢节奏动作）');

    const mFps = src.match(/const LICK_FPS\s*=\s*([\d.]+)/);
    const mHold = src.match(/const LICK_HOLD\s*=\s*([\d.]+)/);
    ok(!!mFps && !!mHold, '舔爪常量: LICK_FPS / LICK_HOLD 已声明');
    if (mFps && mHold) {
      const cycle = 4 / Number(mFps[1]) + Number(mHold[1]);
      ok(Math.abs(cycle - 0.95) < 0.002,
        `舔爪节奏: 单轮 ${cycle.toFixed(4)} s（4/${mFps[1]} + ${mHold[1]} 停留）；进食 2 轮 ≈ ${(cycle * 2).toFixed(2)} s`);
      ok(Number(mFps[1]) < 6, `舔爪慢于进食: ${mFps[1]} fps < eat 的 6 fps`);
    }

    ok(/pet\.lickRounds\s*=\s*LICK_ROUNDS_EAT[\s\S]{0,160}return 'lick'/.test(src),
      '进食结束: 结算饥饿/心情后必定转 lick（原为 idle）');
    ok(/time - pet\.lastLickAt > LICK_CD[\s\S]{0,160}Math\.random\(\) < LICK_PROB/.test(src),
      '空闲触发: 先过 90 s 冷却，再按 5% 概率命中');
    ok(/lick:\s*true/.test(src), '舔爪可打断: INTERRUPTIBLE 含 lick（危急需求能中断）');
    ok(/\{ hold: LICK_HOLD_MAP \}/.test(src), `主帧停留: play 传入 hold 映射（lick_2 加 ${mHold ? Math.round(Number(mHold[1]) * 1000) : '?'} ms）`);
    ok(!/ACTIONS[^;]*'lick'/.test(fs.readFileSync(path.join(ROOT, 'engine', 'needs-profile.js'), 'utf8')),
      '权重表解耦: lick 不进 ACTIONS（不挤占走/跑/待机比例）');

    // 行为验证：喂食流程结束后必定接舔爪（不是回 idle）
    applyLive({
      behavior: { needVoice: false, restiness: 0 },
      needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
      runtime: { stats: { hunger: 40, energy: 90, happiness: 80, cleanliness: 90, affinity: 20, xp: 0 } },
    });
    const n0 = drawCalls.length;
    handlers['api:action']('feed');
    frames(1500, tRef);   // 25 s 模拟：走向食碗 + 4.2 s 进食 + 舔爪 2 轮
    const seq = drawCalls.slice(n0).map((i) => (i && i.src ? i.src.split('/').pop() : ''));
    const iEat = seq.findIndex((s) => s.startsWith('eat_'));
    const iLick = seq.findIndex((s) => s.startsWith('lick_'));
    ok(iEat >= 0 && iLick > iEat,
      `进食结束必播舔爪: 出现顺序 eat@${iEat} → lick@${iLick}（舔爪帧共 ${seq.filter((s) => s.startsWith('lick_')).length} 次）`);

    /* ---- 残影 / 截断回归 ---- */
    const animSrc = fs.readFileSync(path.join(ROOT, 'engine', 'animator.js'), 'utf8');
    ok(/NO_FRAME_BLEND\s*=\s*new Set\([^)]*'lick'[^)]*\)/.test(animSrc),
      '舔爪不参与帧间插值: 相邻帧 IoU 0.86–0.95，叠加会出现双爪/双头残影');
    ok(/frameDur\(name, idx\)/.test(animSrc) && /clamp01\(frameTime \/ curDur\)/.test(animSrc),
      '插值窗口按帧实际停留时长计算并夹取到 [0,1]（hold 帧不再出现「满不透明闪一下再消失」）');
    ok(/pet\.lickEnd\s*=\s*animator\.clock\s*\+/.test(src) && /animator\.clock >= pet\.lickEnd/.test(src),
      '舔爪结束挂在动画时钟上: animSpeed<1 时不再提前掐断（85% 下 2 轮需 2.24 s）');
    ok(!/pet\.lickTimer\s*-=/.test(src), '舔爪已弃用墙钟累加计时');

    const lickRun = seq.filter((s) => s.startsWith('lick_')).map((s) => s[5]);
    const collapsed = lickRun.filter((c, i2) => i2 === 0 || c !== lickRun[i2 - 1]).join('');
    ok((collapsed.match(/1234/g) || []).length >= 2,
      `舔爪完整播满 2 轮: ${collapsed}（应含 ≥2 次 1234 循环）`);
    ok(lickRun.length > 0 && lickRun[lickRun.length - 1] === '4',
      `舔爪收尾到位: 末帧 lick_${lickRun[lickRun.length - 1]}（必须是 4 收爪，不能停在 2/3，也不能环回 1）`);
    ok(/LICK_END_TRIM/.test(src) && /rounds \* LICK_CYCLE - LICK_END_TRIM/.test(src),
      '舔爪收尾提前半帧: 避免淡出时闪回 lick_1「抬爪」');
  }

  /* ---- 4o. 舔爪残影回归：主帧停留全程只绘制一张图，对照姿态仍保留插值 ---- */
  try {
    const AnimCtor2 = vm.runInContext('Animator', sandbox);
    const g2 = makeCtx();
    const a2 = new AnimCtor2();
    a2.sprites.lick = [1, 2, 3, 4].map((i) => ({ src: `lick_${i}.png`, width: 512, height: 512 }));
    a2.tops.lick = [130, 130, 130, 130];
    a2.fps.lick = 5;
    a2.current = 'lick';
    a2.blend = 1;
    a2.prev = null;
    a2.holdMap = { 1: 0.35 };

    const drawsAt = (idx, ft) => {
      a2.frameIndex = idx;
      a2.frameTime = ft;
      const m = drawCalls.length;
      a2.draw(g2, { x: 320, y: 640, scale: 1, facing: 1, mods: {} });
      return drawCalls.length - m;
    };

    // 旧实现：插值按 1/5=200 ms 算，t 在 130 ms 就进窗口、200 ms 时 k=1（下一帧满不透明盖上），
    // 205–342 ms 又反向淡出 —— 表现为「下一帧闪一下再消失」的残影。现在应全程只画 1 张。
    const pts = [0, 0.10, 0.13, 0.20, 0.25, 0.30, 0.349];
    const counts = pts.map((ft) => drawsAt(1, ft));
    ok(counts.every((c) => c === 1),
      `舔爪主帧无叠加: 350 ms 停留内逐点绘制 ${counts.join('/')} 张（应全为 1；旧实现在 200 ms 处叠成 2 张）`);

    // 对照：未列入 NO_FRAME_BLEND 的姿态仍走帧间插值（避免误伤其他动作）
    a2.sprites.idle = [{ src: 'idle_1.png' }, { src: 'idle_2.png' }];
    a2.fps.idle = 5;
    a2.holdMap = null;
    a2.current = 'idle';
    const idleCount = drawsAt(0, 0.19);
    ok(idleCount === 2, `其他姿态保留帧间插值: idle 在插值窗口内绘制 ${idleCount} 张（应为 2）`);
  } catch (e) {
    errors.push(`舔爪残影回归: ${e.message}`);
  }

  /* ---- 4p. 走/跑：最少 2 个完整循环、循环首帧收尾、无叠影 ---- */
  try {
    const animSrc2 = fs.readFileSync(path.join(ROOT, 'engine', 'animator.js'), 'utf8');
    const rsrc = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');

    const wFps = Number((rsrc.match(/walk:\s*(\d+)\s*,\s*run:/) || [])[1]);
    const rFps = Number((rsrc.match(/run:\s*(\d+)\s*,/) || [])[1]);
    ok(wFps > 0 && rFps > 0, `走/跑帧率: walk ${wFps} fps / run ${rFps} fps`);
    const wCycle = 4 / wFps;
    const rCycle = 4 / rFps;
    ok(Math.abs(wCycle * 2 - 0.727) < 0.006,
      `走: 单轮 ${wCycle.toFixed(4)} s，满 2 轮 ${(wCycle * 2).toFixed(3)} s（不太短）`);
    ok(Math.abs(rCycle * 2 - 0.615) < 0.006,
      `跑: 单轮 ${rCycle.toFixed(4)} s，满 2 轮 ${(rCycle * 2).toFixed(3)} s`);

    ok(/const WALK_MIN_LOOPS = 2/.test(rsrc) && /const RUN_MIN_LOOPS = 2/.test(rsrc),
      '最少循环数: 走/跑均要求 2 个完整循环');
    ok(/lapsDone\(\) < WALK_MIN_LOOPS \|\| !animator\.atCycleStart\(\)/.test(rsrc),
      '走: 未满 2 轮或不在循环首帧 → 不收势（不出现半截跨步）');
    ok(/lapsDone\(\) < RUN_MIN_LOOPS \|\| !animator\.atCycleStart\(\)/.test(rsrc),
      '跑: 同样门禁');
    ok(/if \(nxt === 0\) this\.laps\+\+/.test(animSrc2)
      && /atCycleStart\(\)\s*\{\s*return this\.frameIndex === 0;/.test(animSrc2),
      'animator: 环回首帧时累计轮数（动画时间域，动效倍率不影响）');
    ok(/NO_FRAME_BLEND\s*=\s*new Set\([^)]*'walk'[^)]*'run'[^)]*\)/.test(animSrc2),
      '走/跑不参与帧间插值: IoU 0.56–0.75，叠加会变四条腿');
    ok(/pet\.walkSpeed = Math\.min\(WALK_SPEED, span \/ WALK_MIN_TIME\)/.test(rsrc),
      '步速反算: 距离短则放慢，到达时正好满 2 轮，且不会走过头');
    ok(/function runSpeedFor/.test(rsrc) && /RUN_SLOW_FLOOR/.test(rsrc),
      '跑速下限 65%（短距离仍像「跑」）');
    ok(/WALK_SKIP_DIST/.test(rsrc) && /pet\.walkSkip/.test(rsrc),
      '贴脸目标（< 24 px）不播步态，直接进后续动作');

    // Animator 轮数累计单测
    const AC2 = vm.runInContext('Animator', sandbox);
    const a3 = new AC2();
    a3.sprites.walk = [1, 2, 3, 4].map((i) => ({ src: `walk_${i}.png` }));
    a3.fps.walk = wFps;
    a3.play('walk', 0.001);
    const lapsSaw = [];
    let boundaryOk = true;
    for (let i = 0; i < 240; i++) {
      a3.update(1 / 60);
      if (lapsSaw[lapsSaw.length - 1] !== a3.lapsDone()) lapsSaw.push(a3.lapsDone());
      if (a3.lapsDone() >= 2) { boundaryOk = a3.atCycleStart(); break; }
    }
    ok(lapsSaw.includes(1) && lapsSaw.includes(2),
      `animator 轮数: 依次经过 ${lapsSaw.slice(0, 4).join('→')}`);
    ok(boundaryOk, 'animator 轮数: 满 2 轮时正停在循环首帧（frameIndex=0）');

    // 行为验证：40 s 自由漫游，逐帧记录 (姿态, 帧号, 已完成轮数)
    const AC3 = vm.runInContext('Animator', sandbox);
    const origDraw3 = AC3.prototype.draw;
    const poseLog = [];
    AC3.prototype.draw = function (ctx, o) {
      poseLog.push({ name: this.current, idx: this.frameIndex, laps: this.laps });
      return origDraw3.call(this, ctx, o);
    };
    applyLive({
      behavior: { needVoice: false, restiness: 0, animSpeed: 100 },
      needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
      runtime: { stats: { hunger: 70, energy: 95, happiness: 85, cleanliness: 85, affinity: 30, xp: 0 } },
    });
    frames(2400, tRef);
    AC3.prototype.draw = origDraw3;

    for (const pose of ['walk', 'run']) {
      const eps = [];
      let cur = null;
      for (const p2 of poseLog) {
        if (p2.name === pose) {
          if (!cur) { cur = []; eps.push(cur); }
          cur.push(p2);
        } else cur = null;
      }
      const short = [];
      const notBoundary = [];
      const notSeq = [];
      let minLaps = Infinity;
      for (const e of eps) {
        const last = e[e.length - 1];
        minLaps = Math.min(minLaps, last.laps);
        if (last.laps < 2) short.push(`${e.length}帧/${last.laps}轮`);
        if (last.idx !== 0) notBoundary.push(`末帧${last.idx + 1}`);
        // 同一帧会因为 rAF 快于帧率而重复绘制，允许「相等」，但绝不允许跳跃
        for (let k = 1; k < e.length; k++) {
          const a = e[k - 1].idx; const b = e[k].idx;
          if (b !== a && b !== (a + 1) % 4) { notSeq.push(`${a + 1}→${b + 1}`); break; }
        }
      }
      ok(eps.length > 0, `${pose}: 40 s 内触发 ${eps.length} 段（最短 ${minLaps} 轮）`);
      ok(short.length === 0,
        `${pose}: 每段至少 2 个完整循环${short.length ? '，不足的段 ' + short.slice(0, 3).join(' / ') : ''}`);
      ok(notBoundary.length === 0,
        `${pose}: 全部收在循环首帧（不出现半截跨步）${notBoundary.length ? '，例外 ' + notBoundary.slice(0, 3).join(' / ') : ''}`);
      ok(notSeq.length === 0,
        `${pose}: 帧序严格 1→2→3→4→1，无跳帧${notSeq.length ? '，异常 ' + notSeq.slice(0, 3).join(' / ') : ''}`);
    }
  } catch (e) {
    errors.push(`走/跑循环: ${e.message}`);
  }

  /* ---- 4q. 摇尾巴：硬切、尺度烘焙进素材、退出落在循环接缝 ---- */
  try {
    const animSrc3 = fs.readFileSync(path.join(ROOT, 'engine', 'animator.js'), 'utf8');
    const rsrc3 = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');

    ok(/NO_FRAME_BLEND\s*=\s*new Set\([^)]*'tailwag'[^)]*\)/.test(animSrc3),
      '摇尾巴不参与帧间插值: 相邻帧 IoU 0.76–0.92，叠加会出现两条尾巴');

    // 比例已烘焙进素材（tools/normalize_pose_size.py 眼距口径 k≈0.93），运行时系数必须恒为 1
    const psrc = (rsrc3.match(/const POSE_SCALE = \{([^}]*)\}/) || [])[1];
    ok(psrc != null && !/tailwag/.test(psrc),
      `摇尾巴不再走运行时姿态缩放: POSE_SCALE = {${(psrc || '').trim()}}（切进/切出体型零过渡）`);

    ok(/pet\.tailwagEnd = animator\.clock \+ Core\.rand/.test(rsrc3),
      '摇尾巴计时挂在动画时钟上（动作速度 <100% 时不会被墙钟提前掐断）');
    ok(/animator\.clock < pet\.tailwagEnd/.test(rsrc3) && /atCycleStart\(\) \? 'idle'/.test(rsrc3),
      '摇尾巴退出双条件: 时间到 + 停在循环首帧（不出现甩到一半的定格）');

    // 单帧只绘一张（硬切）；对照姿态仍走插值，避免误伤
    const AnimCtor3 = vm.runInContext('Animator', sandbox);
    const g3 = makeCtx();
    const a4 = new AnimCtor3();
    a4.sprites.tailwag = [1, 2, 3, 4].map((i) => ({ src: `tailwag_${i}.png`, width: 512, height: 512 }));
    a4.tops.tailwag = [85, 100, 100, 70];
    a4.fps.tailwag = 7;
    a4.current = 'tailwag';
    a4.blend = 1;
    a4.prev = null;
    a4.holdMap = null;
    const drawAt3 = (idx, ft) => {
      a4.frameIndex = idx;
      a4.frameTime = ft;
      const m0 = drawCalls.length;
      a4.draw(g3, { x: 320, y: 640, scale: 1, facing: 1, mods: {} });
      return drawCalls.length - m0;
    };
    const c3 = [0, 0.04, 0.10, 0.14].map((ft) => drawAt3(0, ft));
    ok(c3.every((c) => c === 1),
      `摇尾巴单帧无叠加: 143 ms 停留内逐点绘制 ${c3.join('/')} 张（应全为 1）`);

    // 行为回放：每段摇尾巴都必须收在循环首帧、至少 2 轮
    const AC4 = vm.runInContext('Animator', sandbox);
    const origDraw4 = AC4.prototype.draw;
    const wagLog = [];
    AC4.prototype.draw = function (ctx2, o) {
      wagLog.push({ name: this.current, idx: this.frameIndex, clock: this.clock });
      return origDraw4.call(this, ctx2, o);
    };
    applyLive({
      behavior: { needVoice: false, restiness: 0, animSpeed: 100 },
      needs: { decayHunger: 0, decayEnergy: 0, decayHappiness: 0, decayCleanliness: 0, decayAffinity: 0 },
      runtime: { stats: { hunger: 70, energy: 95, happiness: 85, cleanliness: 95, affinity: 30, xp: 0 } },
    });
    frames(3000, tRef);
    AC4.prototype.draw = origDraw4;

    const segs = [];
    let curSeg = null;
    for (const p2 of wagLog) {
      if (p2.name === 'tailwag') {
        if (!curSeg) { curSeg = []; segs.push(curSeg); }
        curSeg.push(p2);
      } else curSeg = null;
    }
    const notSeam = segs.filter((s2) => s2[s2.length - 1].idx !== 0).length;
    const wagCycles = segs.map((s2) => (s2[s2.length - 1].clock - s2[0].clock) / (4 / 7));
    ok(segs.length > 0, `摇尾巴: 50 s 内触发 ${segs.length} 段`);
    ok(notSeam === 0,
      `摇尾巴: 全部收在循环首帧（尾部姿态一致）${notSeam ? '，例外 ' + notSeam + ' 段' : ''}`);
    ok(wagCycles.length > 0 && Math.min(...wagCycles) >= 2,
      `摇尾巴: 每段至少 2 个循环（最少 ${wagCycles.length ? Math.min(...wagCycles).toFixed(1) : 0} 轮）`);
  } catch (e) {
    errors.push(`摇尾巴: ${e.message}`);
  }

  /* ---- 4r. 状态分布：idle 为主，走/跑降频，三档和仍为 1 ---- */
  try {
    const rsrc4 = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
    const tiers = {};
    for (const tier of ['low', 'normal', 'high']) {
      const m = rsrc4.match(new RegExp('\\b' + tier + ':\\s*\\{([^}]*think[^}]*)\\}'));
      if (!m) continue;
      const o = {};
      const re = /(\w+):\s*([0-9.]+)/g;
      let g;
      while ((g = re.exec(m[1]))) o[g[1]] = Number(g[2]);
      tiers[tier] = o;
    }
    ok(Object.keys(tiers).length === 3, `权重表: 解析出 ${Object.keys(tiers).join('/')} 三档`);
    for (const tier of ['low', 'normal', 'high']) {
      const o = tiers[tier] || {};
      const keys = Object.keys(o).filter((k) => k !== 'think');
      const sum = keys.reduce((s, k) => s + o[k], 0);
      const sorted = keys.slice().sort((x, y) => o[y] - o[x]);
      ok(sorted[0] === 'idle',
        `${tier}: idle 是第一权重 ${o.idle}（次高 ${sorted[1]} ${o[sorted[1]]}）`);
      ok(Math.abs(sum - 1) < 1e-9, `${tier}: 权重和 ${sum.toFixed(2)}（应为 1.00）`);
    }
    const n = tiers.normal || {};
    ok(n.idle >= 0.40 && n.walk <= 0.25 && n.run <= 0.12,
      `normal: 走/跑降频（walk ${n.walk} ≤ 0.25、run ${n.run} ≤ 0.12），idle ${n.idle} ≥ 0.40`);
    ok((n.walk + n.run) <= 0.36,
      `normal: 走+跑合计 ${(n.walk + n.run).toFixed(2)}（旧表 0.52，降幅明显）`);
  } catch (e) {
    errors.push(`状态分布: ${e.message}`);
  }

  /* ---------------- 断言 ---------------- */

  const EXPECTED = ['drag',
    'walk_1', 'walk_2', 'walk_3', 'walk_4', 'run_1', 'run_2', 'run_3', 'run_4',
    'tailwag_1', 'tailwag_2', 'tailwag_3', 'tailwag_4', 'unhappy_1', 'unhappy_2',
    'idle_1', 'idle_2', 'idle_3', 'idle_4',
    'eat_1', 'eat_2', 'eat_3', 'eat_4',
    'play_1', 'play_2', 'play_3', 'play_4',
    'pet_1', 'pet_2', 'pet_3',
    'jump_1', 'jump_2', 'jump_3',
    'stretch_1', 'stretch_2', 'stretch_3',
    'sleep_1', 'sleep_2', 'sleep_3',
    'meow_1', 'meow_2', 'meow_3',
    'lick_1', 'lick_2', 'lick_3', 'lick_4',
    'bath_1', 'bath_2', 'bath_3', 'bath_4', 'bath_5', 'bath_6'];
  // 用全流程累计的渲染记录（含 phase4 新增动作），而非 phase3 的快照
  const allSpritesNow = new Set(drawCalls.map((img) => (img && img.src ? img.src.split('/').pop() : '?')));
  const missing = EXPECTED.filter((n2) => !allSpritesNow.has(`${n2}.png`));

  if (errors.length) {
    console.error('\n[FAIL] 运行时错误:');
    errors.forEach((e) => console.error('  - ' + e));
    fail = 1;
  }
  if (missing.length) {
    console.error(`\n[WARN] 未渲染到的姿态: ${missing.join(', ')}（可能因随机性未触发，建议重跑）`);
  }
  ok(apiCalls.some((c) => c[0] === 'saveConfig' && c[1] && c[1].runtime && c[1].runtime.stats),
    '属性持久化（runtime.stats）被调用');
  ok(apiCalls.some((c) => c[0] === 'moveWindow'), '拖拽窗口位移被调用');
  ok(apiCalls.some((c) => c[0] === 'openSettings'), '菜单「设置…」打开设置窗口');

  // 状态面板：实时推送含新属性；右键菜单开关生效
  ok(statsPushes.length > 0
    && statsPushes.some((p) => p.stats && 'cleanliness' in p.stats && 'affinity' in p.stats && 'xp' in p.stats),
    `状态面板推送: ${statsPushes.length} 次，含清洁/好感度/经验字段`);
  ok(statsPushes.some((p) => typeof p.bubble === 'string'),
    '状态面板推送: 携带气泡台词字段');
  ok(statsPushes.some((p) => p.tiers
    && ['hunger', 'energy', 'happiness', 'cleanliness'].every((k) => typeof p.tiers[k] === 'string')),
    '状态面板推送: 携带四项属性档位（供档位徽章渲染）');
  const menuItemByAct = (act) => menuItems.find((m) => m.dataset.act === act);
  handlers['menu:click']({ target: { closest: () => menuItemByAct('status') } });   // 状态面板 → 关
  ok(liveConfig.appear.statusPanel === false, '菜单开关: 状态面板 → 关');
  handlers['menu:click']({ target: { closest: () => menuItemByAct('status') } });   // 再点 → 开
  ok(liveConfig.appear.statusPanel === true, '菜单开关: 状态面板 → 开');

  // 体型边界
  const sizeCalls = apiCalls.filter((c) => c[0] === 'saveConfig' && c[1] && c[1].pet && typeof c[1].pet.size === 'number');
  if (!sizeCalls.length) {
    console.error('[FAIL] 体型调整未被持久化');
    fail = 1;
  } else {
    const vals = sizeCalls.map((c) => c[1].pet.size);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    ok(maxV <= 0.88 + 1e-9 && minV >= 0.176 - 1e-9,
      `体型边界正确: 实际范围 [${minV}, ${maxV}] ⊆ [0.176, 0.88]（20%–100%）`);
  }

  ok(menuClosed.outside && menuClosed.blur && menuClosed.esc,
    '右键菜单三种关闭路径均生效（外部点击 / 窗口失焦 / Esc）');

  /* ---- 修复 1：阴影圆盘与宠物同比缩放 ---- */
  if (shape.big && shape.small && shape.big.rxLast > 0 && shape.small.rxLast > 0) {
    shape.big.rx = shape.big.rxLast;
    shape.small.rx = shape.small.rxLast;
    const ratio = shape.big.rx / shape.small.rx;
    const want = 0.88 / 0.176;
    ok(Math.abs(ratio - want) / want < 0.2,
      `阴影随体型缩放: 半长轴 ${shape.big.rx.toFixed(1)}/${shape.small.rx.toFixed(1)} = ${ratio.toFixed(2)} ≈ ${want.toFixed(2)}（0.88/0.176 = 100%/20%）`);
    ok(shape.small.rx < shape.big.rx * 0.3,
      `阴影尺寸随体型单调变化: ${shape.small.rx.toFixed(1)}px < ${shape.big.rx.toFixed(1)}px`);
  } else {
    console.error('[FAIL] 阴影缩放未采样到有效数据');
    fail = 1;
  }

  /* ---- 4n. 切姿态体型平滑：全程无瞬跳（本轮修复） ---- */
  try {
    const AnimCtor = vm.runInContext('Animator', sandbox);
    const origDraw = AnimCtor.prototype.draw;
    const drawScales = [];
    AnimCtor.prototype.draw = function (ctx, o) {
      drawScales.push((o.scale || 0) * ((o.mods && o.mods.scaleMul) || 1));
      return origDraw.call(this, ctx, o);
    };

    // 统一到 100% 体型 / 正常动效 / 100% 速度，先唤醒并让平滑值收敛
    applyLive({
      pet: { size: 0.88 },
      appear: { reduceMotion: false },
      behavior: { animSpeed: 100 },
    });
    handlers['api:action']('pet');      // 若在睡眠中则先唤醒
    frames(300, tRef);

    drawScales.length = 0;
    const markSmooth = drawCalls.length;
    handlers['api:action']('bath');     // bath 姿态校正 0.87（与 idle 差 13%）
    frames(660, tRef);                  // 11s：覆盖 bath → idle/tailwag 的整段回落（含自主换姿态）

    const seq = drawScales.slice();
    let maxStep = 0;
    for (let i = 1; i < seq.length; i++) maxStep = Math.max(maxStep, Math.abs(seq[i] - seq[i - 1]));
    const namesSmooth = [...new Set(drawCalls.slice(markSmooth)
      .map((img) => (img && img.src ? img.src.split('/').pop() : '?')))];
    const sawBath = namesSmooth.some((n) => n.startsWith('bath_'));

    ok(sawBath, `姿态平滑: 采样窗口内确实切到 bath 姿态（${namesSmooth.join(',') || '无'}）`);
    ok(seq.length > 100, `姿态平滑: 采样到 ${seq.length} 帧有效绘制`);
    // 窗口内必须真的发生了大幅体形变化（否则断言「平滑」没有意义）
    const swing = Math.max(...seq) - Math.min(...seq);
    ok(swing > 0.08,
      `姿态平滑: 窗口内体形变化幅度 ${swing.toFixed(3)}（bath 0.87 ↔ idle 1.0 校正，确有切换）`);
    // 旧实现：切姿态那一帧直接跳 |0.87-1.0|×0.88 ≈ 0.114；平滑后单帧应 < 0.02
    ok(maxStep < 0.02,
      `姿态平滑: 相邻帧体形变化最大 ${maxStep.toFixed(4)}（旧实现切姿态单帧跳变 0.114）`);
    // 每次过渡必须真正收敛：序列中至少存在一段 ≥10 帧的平台（不是永远逼近的蠕动）
    let run = 0;
    let bestRun = 0;
    for (let i = 1; i < seq.length; i++) {
      run = Math.abs(seq[i] - seq[i - 1]) <= 0.0015 ? run + 1 : 0;
      bestRun = Math.max(bestRun, run);
    }
    ok(bestRun >= 10,
      `姿态平滑: 存在 ${bestRun} 帧收敛平台（过渡结束后静止，不是持续蠕动）`);

    AnimCtor.prototype.draw = origDraw;
  } catch (e) {
    errors.push(`姿态平滑: ${e.message}`);
  }

  /* ---- 1.0.0 待机眨眼：随机间隔、频率可配、实时生效 ---- */
  try {
    const BlinkCtor = vm.runInContext('Animator', sandbox);
    const mkBlink = () => {
      const a = new BlinkCtor();
      a.sprites.idle = [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }];
      a.fps.idle = 5;
      a.current = 'idle';
      return a;
    };
    const driveBlink = (a, seconds) => {
      const seen = [];           // 每次「闭眼开始」的 clock 时刻
      let inBlink = false;
      const dt = 1 / 60;
      for (let t = 0; t < seconds; t += dt) {
        a.update(dt);
        if (a.frameIndex === 2 && !inBlink) { inBlink = true; seen.push(a.clock); }
        if (a.frameIndex !== 2) inBlink = false;
      }
      return seen;
    };

    // (1) 频率 8 次/分钟（平均 7.5s，±45% 随机）→ 180s 约 24 次
    const a1 = mkBlink();
    a1.blinkCfg = { active: [0, 3], blinkFrame: 2, meanGap: 7.5 };
    const s1 = driveBlink(a1, 180);
    ok(s1.length >= 14 && s1.length <= 34,
      `眨眼频率: 8 次/分钟 × 180s → 实际 ${s1.length} 次（期望 15–33，随机波动）`);

    // (2) 随机性：相邻间隔不全相等（无固定周期机械感）
    const gaps = s1.slice(1).map((t, i) => t - s1[i]);
    const uniqGaps = new Set(gaps.map((g) => Math.round(g * 1000)));
    ok(uniqGaps.size >= 5 && Math.max(...gaps) - Math.min(...gaps) > 1.5,
      `眨眼随机: ${gaps.length} 个间隔中 ${uniqGaps.size} 个不同值（极差 ${(Math.max(...gaps) - Math.min(...gaps)).toFixed(2)}s）`);

    // (3) 常态不播困倦帧：idle_2（半闭困倦）退出常规循环
    const a3 = mkBlink();
    a3.blinkCfg = { active: [0, 3], blinkFrame: 2, meanGap: 7.5 };
    let sawSleepy = false;
    for (let t = 0; t < 30; t += 1 / 60) { a3.update(1 / 60); if (a3.frameIndex === 1) sawSleepy = true; }
    ok(!sawSleepy, '眨眼循环: 常态只在睁眼帧间轮播（idle_2 困倦帧退出循环）');

    // (4) 频率 0 → 不眨眼
    const a4 = mkBlink();
    a4.blinkCfg = { active: [0, 3], blinkFrame: 2, meanGap: 0 };
    ok(driveBlink(a4, 60).length === 0, '眨眼关闭: 频率 0 → 完全不眨眼');

    // (5) 实时生效：meanGap 1s → 10s 后，同等时长内次数骤减
    const a5 = mkBlink();
    a5.blinkCfg = { active: [0, 3], blinkFrame: 2, meanGap: 1 };
    const early = driveBlink(a5, 20);
    a5.blinkCfg = { active: [0, 3], blinkFrame: 2, meanGap: 10 };
    const late = driveBlink(a5, 20);
    ok(early.length >= 8 && late.length <= 5,
      `眨眼实时生效: meanGap 1s→10s 后，20s 内次数 ${early.length} → ${late.length}`);

    // (5b) 频率调「快」立刻作废旧周期：40s 周期改成 1s 后，1.5s 内就该眨（不等旧的 40s 走完）
    const a5b = mkBlink();
    a5b.blinkCfg = { active: [0, 3], blinkFrame: 2, meanGap: 40 };
    const pre = driveBlink(a5b, 2);
    const t0 = a5b.clock;
    a5b.blinkCfg = { active: [0, 3], blinkFrame: 2, meanGap: 1 };
    const quick = driveBlink(a5b, 3);
    const waitSec = quick.length ? quick[0] - t0 : Infinity;
    ok(pre.length === 0 && quick.length >= 1 && waitSec <= 1.5,
      `眨眼改快立即重排: 40s→1s 后首次眨眼等待 ${waitSec.toFixed(2)}s（旧实现需等满 40s）`);

    // (6) 无配置时保持旧整序列循环（向后兼容）
    const a6 = mkBlink();
    let sawBlinkFrame = false;
    for (let t = 0; t < 10; t += 1 / 60) { a6.update(1 / 60); if (a6.frameIndex === 2) sawBlinkFrame = true; }
    ok(sawBlinkFrame, '眨眼兼容: 未配置 blinkCfg 时保持旧 4 帧循环');

    // 源级守卫
    const srcAnim = fs.readFileSync(path.join(ROOT, 'engine', 'animator.js'), 'utf8');
    ok(srcAnim.indexOf('_scheduleBlink') >= 0 && srcAnim.indexOf('blinkCfg') >= 0,
      '眨眼源级: animator 含 blinkCfg / _scheduleBlink');
    ok(fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8').indexOf('animator.blinkCfg') >= 0,
      '眨眼接线: applyConfig 按 blinkRate 写入 animator.blinkCfg');
  } catch (e) {
    errors.push(`眨眼: ${e.message}`);
  }

  /* ---- 修复 2：气泡紧贴猫头顶且尺寸固定（不随体型缩放） ---- */
  if (shape.big && shape.small && shape.big.kMax > 0 && shape.small.kMax > 0) {
    ok(Math.abs(shape.big.kMax - shape.small.kMax) < 0.02 && shape.small.kMax > 0.98,
      `气泡固定尺寸: 完全展开后缩放 ${shape.big.kMax.toFixed(3)} vs ${shape.small.kMax.toFixed(3)}（与体型无关，应为 1.000）`);
    ok(shape.small.top - shape.big.top > 100,
      `气泡贴合头顶: 体型越小气泡越低（顶边 ${shape.big.top.toFixed(0)}px → ${shape.small.top.toFixed(0)}px）`);
    // 尖角末端应指向猫头横坐标（与同帧阴影 x = pet.x 交叉验证）
    const tailVisual = shape.small.left + shape.small.k * (shape.small.tail - 66);
    ok(Math.abs(tailVisual - shape.small.petX) < 3,
      `气泡尖角指向猫头: 尖角 x=${tailVisual.toFixed(1)} 猫 x=${shape.small.petX.toFixed(1)}`);
    const halfW = (132 * shape.small.k) / 2;
    ok(shape.small.left - halfW >= -1 && shape.small.left + halfW <= 641,
      `气泡始终留在窗口内: [${(shape.small.left - halfW).toFixed(1)}, ${(shape.small.left + halfW).toFixed(1)}] ⊆ [0, 640]`);
  } else {
    console.error('[FAIL] 气泡缩放未采样到有效数据');
    fail = 1;
  }

  if (!fail && !missing.length) {
    console.log('\n[PASS] 全部断言通过。');
  } else if (!fail) {
    console.log('\n[PASS*] 核心断言通过（部分姿态因随机性未覆盖）。');
  }
  process.exit(fail);
}

run().catch((e) => {
  console.error('[fail] 测试执行异常:', e);
  process.exit(1);
});
