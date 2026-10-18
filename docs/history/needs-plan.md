# 属性驱动气泡与行为 —— 设计方案

> 目标版本：v1.7.0
> 适用范围：`cat-pet/`（Electron 桌面宠物）
> 状态：**待确认**（确认后再进入编码）

---

## 1. 需求拆解与本轮要解决的问题

需求原文：宠物的**心情、清洁、饱食、体力**四项状态会**实时**影响宠物的气泡文字（如「要喂食」「要陪玩」）以及行为表现（如睡觉、跑、走等）。

对照当前实现（v1.6.0），差距如下：

| 现状 | 问题 |
|------|------|
| `decide()` 中硬编码 `energy < 22` / `hunger < 28` / `happiness < 30` / `happiness < 45` | 阈值零散、无档位概念、无法统一调节 |
| **清洁（cleanliness）完全不参与决策** | 脏了猫没有任何反应，气泡与行为都无变化 |
| 属性变化只在**下一次决策 tick**（2.2–5.5s 后）才被感知 | 不"实时"：刚洗完澡不会立刻开心、喂饱后仍可能继续喊饿 |
| 没有阈值穿越的即时反应 | 属性从 40 掉到 20 的瞬间，玩家完全无感 |
| 低档只有一句固定文案 | 反复刷同一句，观感廉价 |
| 属性好看不出任何"好"的表现 | 只有负面提醒，缺少正反馈 |

本轮要做的是：**把四项属性变成一套统一的「分档 → 气泡 / 行为」驱动系统**，并让属性变化的那一刻就有反应。

---

## 2. 核心概念

### 2.1 分档（Tier）

每项属性 0–100，按阈值划为 4 档：

```
 危  critical ──┤ 低  low ──┤ 正常 normal ──┤ 良好 good
 0            T1           T2              T3          100
```

- **critical（危）**：强制行为 + 高优先气泡 + 系统通知
- **low（偏低）**：行为倾向修正 + 概率性气泡
- **normal（正常）**：不做任何干预，行为按原有随机表
- **good（良好）**：低概率正向气泡 + 轻微活泼化

### 2.2 阈值表（标准档）

| 属性 | T1 危 critical | T2 低 low | T3 良好 good | 取值范围 |
|------|---------------|-----------|-------------|---------|
| 饱食 hunger | `< 15` | `15 ~ 34` | `≥ 70` | 0–100 |
| 体力 energy | `< 15` | `15 ~ 34` | `≥ 70` | 0–100 |
| 心情 happiness | `< 20` | `20 ~ 44` | `≥ 70` | 0–100 |
| 清洁 cleanliness | `< 15` | `15 ~ 39` | `≥ 70` | 0–100 |

中间的 `T2 ~ T3-1` 区间即 normal 档。

> **与现有数值的兼容性**：现有 `hunger<28` → 新 `low` 档上界 35（更早提醒一点）；`energy<22` → 新拆成 `critical<15` 强制睡 + `low<35` 大幅提高睡意；`happiness<30/<45` → 收敛为新 `critical<20` / `low<45`。整体手感从"到点突然变脸"改为"渐进制"。

### 2.3 灵敏度（阈值整体平移）

为覆盖不同用户口味，新增设置项 `behavior.needSensitivity`（宽松 / 标准 / 严格），只平移 T1、T2，**不动 T3**（避免"良好"档被压缩）：

| 档位 | 平移量 | 效果（以饱食为例） |
|------|-------|-------------------|
| 宽松 relaxed | −8 | 危 `<7`、低 `7~26`，更晚才提醒 |
| 标准 standard | 0 | 危 `<15`、低 `15~34`（默认） |
| 严格 strict | +8 | 危 `<23`、低 `23~42`，更早提醒 |

T1 平移后下限夹紧到 `≥ 5`，保证 `critical` 区间永远非空。

### 2.4 迟滞（Hysteresis）

避免属性在阈值上下抖动导致**反复刷气泡**：

- **降档**（如 normal → low）：用原阈值 `T`
- **升档**（如 low → normal）：用 `T + 4`

即：饱食掉到 34 触发"饿"提醒，必须回到 39 以上才算脱离低档。迟滞**只用于气泡与档位快照**；行为权重用瞬时值，不受影响（属性是连续变化的，不需要迟滞）。

---

## 3. 分级气泡文案表

新增 i18n 词条结构 `bubbles.need.<key>.<tier>`，每档 3 句，中英各一套（共 4 属性 × 3 档 × 3 句 × 2 语言 = **72 条**）。

### 3.1 饱食 hunger

| 档位 | 气泡文案（zh-CN） | 备注 |
|------|------------------|------|
| critical | 「饿扁了…喵…」/「{owner}，我快饿晕了…」/「肚子咕咕叫，好难受…」 | + 系统通知 `notify.hungerLow` |
| low | 「{owner}，肚子饿了…喵」/「有饭吃吗？」/「{name}想吃东西了」 | 沿用现有 `bubbles.hungry` |
| good | 「吃得好饱，好满足～」 | 仅在**进食结算后 20s 内**低概率出现 |

### 3.2 体力 energy

| 档位 | 气泡文案（zh-CN） | 备注 |
|------|------------------|------|
| critical | 「眼皮好重…快睁不开了…」/「一点力气都没有了…」/「想马上趴下…」 | + 系统通知 `notify.energyLow` |
| low | 「有点困了…」/「想眯一小会儿～」/「可以打个盹吗？」 | 沿用现有 `say.sleepy` 语感 |
| good | 「精神满满！」 | 长冷却、低概率 |

### 3.3 心情 happiness

| 档位 | 气泡文案（zh-CN） | 备注 |
|------|------------------|------|
| critical | 「呜…好难过…」/「谁都不理我…」/「尾巴都抬不起来了…」 | + 系统通知 `notify.happyLow` |
| low | 「好无聊，陪我玩玩～」/「陪我玩会儿嘛！」/「好想玩逗猫棒…」 | 沿用现有 `bubbles.bored`，另有 40% 走 `bubbles.sulk` |
| good | 「今天心情超好！」/「{owner}在真好～」/「想跑两圈！」 | 长冷却、低概率 |

### 3.4 清洁 cleanliness（**本轮新增能力**）

| 档位 | 气泡文案（zh-CN） | 备注 |
|------|------------------|------|
| critical | 「身上痒痒的，脏脏的…」/「毛毛都打结了…」/「想洗澡澡…」 | 第 3 句**仅 `allowBath=true` 时**使用；关闭时用「浑身不舒服…」兜底 |
| low | 「有点脏了呢…」/「身上沾灰了，帮我洗洗？」/「毛毛不蓬松了…」 | 同上，洗澡引导句受限 |
| good | 「刚洗完澡，香香的～」 | 仅在**洗澡结算后 30s 内**低概率出现 |

> 所有文案均走现有 `bubble(key)` 通道，自动处理 `{name}` / `{owner}` 占位符与「气泡中带上名字」开关。
> `sound.bubbles = false` 时全部不显示，但**行为变化照常生效**。

---

## 4. 行为映射表

### 4.1 行为权重乘子

以 `ACTIVITY.normal`（walk .36 / idle .16 / run .16 / jump .08 / stretch .08 / meow .06 / tailwag .10）为基准 1.0，各档位乘子如下：

| 来源档位 | walk | idle | run | jump | stretch | tailwag | meow |
|---------|------|------|-----|------|---------|---------|------|
| energy critical | 0.3 | 1.0 | **0** | **0** | 0.6 | 0.3 | 0.6 |
| energy low | 0.8 | 1.4 | 0.4 | 0.3 | 1.5 | 0.8 | 1.0 |
| energy good | 1.0 | 0.8 | 1.25 | 1.2 | 0.8 | 1.1 | 1.0 |
| hunger critical | 0.5 | 1.1 | 0.3 | 0.2 | 0.8 | 0.6 | **2.5** |
| hunger low | 1.0 | 1.0 | 0.8 | 0.7 | 1.0 | 1.0 | 1.6 |
| happiness critical | 0.7 | 1.3 | 0.4 | 0.3 | 1.2 | **0** | 1.5 |
| happiness low | 0.9 | 1.15 | 0.7 | 0.6 | 1.1 | 0.2 | 1.3 |
| happiness good | 1.0 | 0.9 | 1.2 | 1.15 | 0.9 | 1.5 | 0.8 |
| cleanliness critical | 0.8 | 1.3 | 0.6 | 0.5 | 1.1 | **0** | 1.2 |
| cleanliness low | 0.95 | 1.1 | 0.85 | 0.8 | 1.0 | 0.5 | 1.1 |
| cleanliness good | 1.0 | 1.0 | 1.05 | 1.05 | 1.0 | 1.15 | 1.0 |

**合成规则**（一句话说明白）：

1. 取四项属性各自的乘子行；
2. **逐列相乘**得到原始乘子；
3. 每个原始乘子 `clamp 到 [0.05, 3.5]`，防止极端归零；
4. 与 `ACTIVITY[activityLevel]` 的基础权重相乘后**归一化到总和 1**（保证仍是合法概率表）；
5. `allowRun = false` 时 run 权重置 0 并把权重并入 walk（沿用现有规则）。

**语义解读**：
- 又困又饿 → 几乎不跑不跳，主要 idle + stretch + 讨食喵叫
- 心情好 + 清洁好 → 跑跳与摇尾巴明显增多（正反馈）
- 脏了 → 不再摇尾巴（掩饰不适），改以 idle / 不高兴为主

### 4.2 趴睡倾向修正（叠加到 `restiness`，单位：百分点）

| 来源 | 修正 |
|------|------|
| energy critical | **强制 sleep**（跳过随机判定） |
| energy low | +25 |
| energy good | −10 |
| happiness critical | +10（没精神，蔫着） |
| happiness good | −5 |
| cleanliness critical | +8 |
| hunger critical | −15（饿得睡不着） |

最终：`restiness_eff = clamp(restiness_base + activityLevel 修正 + Σ上表, 0, 100) / 100`

（`restiness_base` 与 `activityLevel` 修正是 v1.6.0 已有逻辑：low +15 / high −20）

### 4.3 表现层（程序化微动）

| 条件 | 表现 |
|------|------|
| cleanliness `critical` 且当前 idle | idle 微动中加入**低频轻微抖动**（±1px @ 6Hz，每 3–5s 持续 0.6s），表现「痒/不舒服」 |
| happiness `good` | idle 呼吸幅度略放大 10%，节奏稍快 |
| 其他 | 维持 v1.6.0 现状 |

> 抖动幅度刻意压到 ±1px：帧序列本身已含呼吸起伏，幅度过大会出现"双重动画"抖动（项目已踩过的坑）。
> `appear.reduceMotion = true` 时抖动与放大**全部不生效**，只保留行为与气泡层面的变化。

---

## 5. 联动规则

### 5.1 决策优先级（仲裁顺序）

`decide()` 按下表自上而下判定，**命中即返回，一个决策周期只出一个行为 + 一句气泡**：

| 优先级 | 条件 | 行为 | 气泡 | 通知 |
|-------|------|------|------|------|
| **P1** | energy `critical` 且 `allowSleep` | 强制 `sleep` | energy.critical | energyLow |
| **P1'** | energy `critical` 且 `!allowSleep` | 强制 `meow`（累瘫） | energy.critical | energyLow |
| **P2** | hunger `critical` | 强制 `meow`（讨食） | hunger.critical | hungerLow |
| **P3** | cleanliness `critical` | 50% `unhappy` / 50% `meow` | cleanliness.critical | **新增** `notify.cleanLow` |
| **P4** | happiness `critical` | 50% `unhappy` / 50% `meow` | happiness.critical 或 `sulk` | happyLow |
| **P5** | happiness `low` | 40% `unhappy` / 60% 继续判 | `sulk` | — |
| **P6** | 其余 low 档（energy / hunger / cleanliness） | 不强制行为，仅走加权表 | 概率性出对应气泡 | — |
| **P7** | `time - lastInteraction > callInterval` | `meow` | `lonely` | alone |
| **P8** | 全部 good 且长冷却已过 | — | 概率 6% 出正向气泡 | — |
| **P9** | — | 按 `restiness_eff` 决定 sleep | — | — |
| **P10** | — | 加权随机表（含 4.1 乘子） | — | — |

**多个 critical 同时出现**：按 P1 → P2 → P3 → P4 顺序只执行最高优先级项；被压下的需求**不丢**，下一次决策继续参评（下一轮通常几十毫秒到几秒后）。这样天然形成轮转，不会出现"永远只喊饿"。

### 5.2 实时性（三个触发点）

```
① 帧级跨档检测   decayStats(dt) → checkNeedTransitions()   ← 属性缓慢变化
② 紧急中断       maybeUrgent()  在每帧调用                  ← 不等待 think 计时
③ 交互即时反馈   喂食 / 洗澡 / 玩耍 / 抚摸结算 → 属性跳变
```

**① 帧级跨档检测**
每帧记录四项属性的档位快照 `tierSnapshot`。属性穿越阈值（含迟滞方向）时，立即：

- **降档**：出该档对应负面气泡（受 20s/属性 冷却）
- **升档**：出恢复类气泡（如「身上干净啦～」「有力气啦！」「吃饱饱，好幸福～」「开心起来了～」）

**② 紧急中断**
`maybeUrgent()` 每帧执行：若当前状态属于**可打断集合** `{ idle, meow, tailwag, unhappy, walk }`（**不含** drag / eat / play / bath / pet / jump / fall / stretch / sleep），且出现 P1–P4 的 critical 需求 → 立即 `fsm.transition(...)`。

**关键边界**：`sleep` **不在**可打断集合内 —— 睡着时不会被"饿"或"累"打断（否则趴睡为主的节奏会被彻底破坏），醒来那一刻由 ① 补发提醒。

**③ 交互即时反馈**
喂食（hunger +42）、洗澡（cleanliness +55）、玩耍（happiness +26）等结算后属性跨档，由 ① 立即捕获 → 出现「吃得好饱，好满足～」「刚洗完澡，香香的～」这类正向台词 —— 这就是"实时"最直观的观感来源。

### 5.3 冷却与限流（防刷屏）

| 通道 | 冷却 | 说明 |
|------|------|------|
| 全局自主气泡 | 5s | 沿用现有 `autoBubble` |
| 每属性负向提醒 | 90s | 新增 `needCd[key]`，同一属性不会连续唠叨 |
| 跨档即时反应 | 20s/属性 | 比常规提醒宽松，因为它是有意义的即时反馈 |
| good 档正向气泡 | 200s + 概率 6% | 必须"稀罕"才有惊喜感 |
| 交互结算气泡保护 | 1.2s | 结算台词不被状态气泡覆盖 |

---

## 6. 边界情况处理

| # | 场景 | 处理 |
|---|------|------|
| 1 | `sound.bubbles = false` | 气泡全不出，**行为变化照常生效** |
| 2 | `sound.muted = true` | 仅影响音效，不影响气泡（维持现有语义） |
| 3 | `needs.*Decay = 0`（属性不衰减） | 档位恒定，跨档检测自然不触发 |
| 4 | 属性恰在阈值抖动 | 迟滞 +4 点解决（见 2.4） |
| 5 | 属性为 0 | 档位函数保证恒为 `critical`，不出现 `NaN` |
| 6 | **睡眠中** | 不出任何需求气泡、不做紧急中断；醒来后立即补检（避免"睡着还在喊饿"） |
| 7 | **拖拽中** | 不在可打断集合，一切状态驱动暂停 |
| 8 | 交互动作进行中（eat/play/bath/pet） | 不强制切换；气泡受 1.2s 保护不被覆盖 |
| 9 | `allowSleep = false` | energy critical 退化为强制 `meow`，体力继续下降到 0 并停在 0 |
| 10 | `allowBath = false` | 清洁档位只出通用抱怨文案，**不出现"想洗澡"引导**（避免指向不存在的入口） |
| 11 | `allowRun = false` | run 乘子归零后权重并入 walk（沿用现有规则） |
| 12 | 多属性同时 critical | 按 P1–P4 顺序轮转，不丢失（见 5.1） |
| 13 | `appear.reduceMotion = true` | 抖动 / 呼吸放大不生效，行为与气泡照常 |
| 14 | 状态面板未打开 | 属性照常驱动（面板仅显示层） |
| 15 | 首次启动（四项默认 80） | 全 good 档，只可能出极低概率正向气泡，不打扰 |
| 16 | 切换语言 | 文案从下一句起生效（沿用现有约定），已在屏气泡不追改 |
| 17 | 宠物被喂到 100（过饱） | 不设"过饱"档，仅 `good` 档；耗到 <70 自动回落 |
| 18 | 「气泡中带上名字」关闭 | 走现有 `bubble()` 的 `{name}` 剥离逻辑，新增词条零改动适配 |

---

## 7. 实现思路与落点

### 7.1 新增单一来源模块 `cat-pet/engine/needs-profile.js`

沿用 `i18n.js` 的双模块 UMD 写法（主进程 `require` / 渲染进程挂 `window.NeedsProfile`），导出：

```js
NEED_TIERS        // 4 属性 × {critical, low, good} 阈值
SENSITIVITY       // { relaxed: -8, standard: 0, strict: +8 }
WEIGHT_MODS       // 4 属性 × 档位 → 7 个行为乘子
SLEEP_MODS        // 档位 → restiness 修正
PRIORITY          // ['energy','hunger','cleanliness','happiness']
tierOf(key, value, sensitivity)              // 瞬时档位
resolve(key, value, prevTier, sensitivity)   // 带迟滞的档位判定
combineWeights(base, tiers)                  // 乘子合成 + 归一化
sleepBias(tiers)                             // restiness 修正合计
```

**设计理由**：阈值、文案、权重三者分开——数值与行为表放 `needs-profile.js`，文案放 `i18n.js`，设置项放 `config-schema.js`。改数值不动文案，改文案不动逻辑。

### 7.2 改动清单

| 文件 | 改动 |
|------|------|
| `engine/needs-profile.js` | **新增**（约 130 行） |
| `renderer.js` | `decide()` 重写（分级阈值 + 权重乘子 + 优先级表）；新增 `checkNeedTransitions()` / `maybeUrgent()` / `needBubble()` / `tierSnapshot`；`restiness()` 叠加 `sleepBias`；`computeMods()` 加 idle 抖动；`index.html` 引 script |
| `engine/i18n.js` | 新增 72 条 need 文案 + `notify.cleanLow` + 4 条恢复类文案（中英各） |
| `engine/config-schema.js` | 新增 2 项（`behavior.needVoice` / `behavior.needSensitivity`）；`CONFIG_VERSION` 4 → **5**；`load()` 显式放行 v4 |
| `tools/test_logic.js` | 新增分档 / 迟滞 / 权重合成 / 优先级 / 跨档反应 / 睡眠抑制 / `allowSleep=false` 退化 共约 30 条断言（91 → ~121） |
| `README.md` | 新增「属性驱动」章节、阈值表、路径图更新 |
| `package.json` | 版本 1.6.0 → 1.7.0 |

### 7.3 新增设置项

| 组 | 键 | 类型 | 默认 | 说明 |
|----|-----|------|------|------|
| behavior | `needVoice` | switch | `true` | 「状态驱动气泡与行为」总开关。关闭后完全回到 v1.6.0 的固定阈值逻辑（便于对照排查） |
| behavior | `needSensitivity` | select | `standard` | 「提醒灵敏度」宽松 / 标准 / 严格（阈值平移 −8 / 0 / +8），`needVoice` 关闭时灰置 |

设置项总数 48 → **50**（分组仍为 8 组）。

### 7.4 需要配套的资源

**零新增美术素材** —— 全部复用现有 14 个姿态（idle / walk / run / jump / stretch / sleep / eat / play / pet / meow / tailwag / unhappy / bath / drag）。"清洁"与"疲惫"的表现靠现有 `unhappy` 姿态 + 程序化微动 + 气泡文案组合表达。

---

## 8. 验证计划

1. **单元层**（`tools/test_logic.js`，无头）：
   - 分档函数：四项属性 × 各档边界值（14/15/34/35/69/70）× 三种灵敏度
   - 迟滞：34→35 不升档、35→39 才升档
   - 权重合成：四项全 critical 时归一化后仍合法（总和 = 1、无 NaN）
   - 优先级：hunger+cleanliness 同时 critical 时的返回顺序
   - 睡眠抑制：sleep 中属性跌到 critical 不触发 transition 与气泡
   - `allowSleep=false` / `allowBath=false` / `bubbles=false` 三条降级路径
2. **数值沙箱**：构造 10 分钟虚拟时长，验证跨档时刻与气泡触发次数符合冷却预期
3. **实机验收**（需你肉眼确认，自动化测不了）：
   - 洗澡后是否立刻出现"香香的"
   - 饿到极危时是否立刻停下跑跳去讨食
   - 脏了是否明显蔫下来（不摇尾巴、走得多）
   - 睡着时是否不再中途喊饿
   - 心情好时是否更活跃
4. **回归**：现有 91 条断言必须全绿（`needVoice` 默认开启，但 v1.6.0 的既有行为路径要保留可复现）

---

## 9. 待确认的关键决策点

| # | 问题 | 我的建议 |
|---|------|---------|
| 1 | 阈值是否按 2.2 表执行（饱食/体力 危<15 低<35；心情 危<20 低<45；清洁 危<15 低<40）？ | 按表执行 |
| 2 | 是否暴露「提醒灵敏度」设置项（宽松/标准/严格），还是固定在标准档？ | **暴露**，成本低、覆盖口味差异 |
| 3 | 正向气泡（心情好 / 刚吃饱 / 刚洗完澡）要不要？会不会觉得吵？ | **要**，但用 200s 冷却 + 6% 概率压制频率 |
| 4 | 脏了是否要影响行为（提高不高兴、不再摇尾巴、少跑动），还是清洁只影响气泡？ | **要影响行为**，否则"实时影响行为"只兑现了 3/4 |
| 5 | 状态面板是否加一行档位小徽章（如「饿」「困」「脏」「开心」），把档位可视化？ | **建议加**（低成本，让"实时影响"看得见）。如你不需要则不做 |

---

## 10. 确认后的执行顺序

1. 新增 `engine/needs-profile.js`（阈值 + 权重表 + 纯函数）
2. `engine/i18n.js` 补 72 + 5 条词条（中英）
3. `engine/config-schema.js` 加 2 项 + `CONFIG_VERSION` 5 + `load()` 放行 v4
4. `renderer.js` 重写 `decide()` + 新增三个机制函数 + `computeMods()` 抖动
5. `tools/test_logic.js` 补断言 → 跑全量回归
6. 数值沙箱验证跨档时刻
7. 实机冒烟（源码版）→ 交付你验收
8. 升版 1.7.0 → 打包 → 更新 README 与项目记忆

---

*文档生成时间：2026-10-16*
