# 语音系统集成方案 —「喵喵」叫声（voice-plan.md）

> 目标：猫在显示文字气泡的同时，播放与情境匹配的「喵」叫声。
> 状态：**阶段 1 + 阶段 2 + 阶段 3（音色统一）已完成**——29 条 CC0 真实录音已统一柔化为
> 「可爱 / 温柔 / 不刺耳」，258KB，断言全绿 + Chromium 解码通过 + 试听页/A-B 页就绪。
> 待办：人工听感确认（`assets/previews/meow-preview-ab.html`）→ 阶段 4 打包 v1.8.0。
> 版本规划：整体作为 **v1.8.0** 交付（当前基线 1.7.3，阶段 1 未打包）。

---

## 一、现状与挂载点分析

| 现状 | 结论 |
|------|------|
| 气泡唯一出口 `showBubble(text)`（renderer.js:244） | **语音挂载点**：为其增加可选第二参数（语义 key），避免从渲染文本反查 |
| 气泡上游 `bubble(key)` / `say(key, params)` 均携带语义 key | 调用点只需把 key 顺手传下去，改动面小 |
| `config.sound` 组已有 muted / volume / bubbles / bubbleDuration | **语音直接复用** muted（一票否决）与 volume，不另设音量项 |
| 项目当前无任何音频播放代码；无头测试 `tools/check/test_logic.js` 为 vm 沙箱 | 播放用 Web Audio（渲染进程）；纯逻辑（映射/节流/变体）可进沙箱测试 |

---

## 二、整体架构（三层）

```
触发层  renderer.js 行为系统（互动 / 需求 / 自主 / 系统四类调用点）
          │  showBubble(text, voiceKey?)   ← key 缺省则不发声（渐进接入）
          ▼
调度层  engine/voice.js（新增，表驱动单一来源，风格对齐 STATS_SPEC / needs-profile）
          │  VOICE_SPEC 映射表 + 防骚扰调度 + 音量整合
          ▼
播放层  渲染进程 Web Audio（AudioContext + AudioBuffer 缓存）
          │
          ▼
素材层  assets/audio/meow/<context>_<n>.ogg（随 asar 打包）
```

**关键决策与理由**
1. **播放放渲染进程，不经主进程**：延迟最低（互动反馈要求 <100ms），主进程零改动（无需新 IPC）。
2. **key 由调用点显式传入**，不用文本反查：i18n 双语文案会变，语义 key 稳定。
3. **VOICE_SPEC 单一来源**：情境→素材文件列表、冷却、优先级全部表驱动，改叫声不动逻辑代码。
4. **渐进接入**：showBubble 的 voiceKey 为可选参数，未传即静默——可分批改造调用点，任何时刻不破坏现有行为。

---

## 三、核心模块设计

### 3.1 调度层 `engine/voice.js`（新建，被 renderer.js 以 <script> 引入）

```js
// VOICE_SPEC 结构示意（最终以实施为准）
{
  pet:      { files: ['pet_1.ogg','pet_2.ogg','pet_3.ogg'], cooldown: 800,  priority: 2 },
  hungry:   { files: ['hungry_1.ogg','hungry_2.ogg'],       cooldown: 5000, priority: 3 },
  urgent:   { files: ['urgent_1.ogg'],                      cooldown: 2000, priority: 4 },  // 危急档专用
  lonely:   { files: ['idle_1.ogg','idle_2.ogg'],           cooldown: 6000, priority: 1 },
  ...
}
```

`voice.play(key)` 内部流程：
1. **门禁**：`config.sound.muted` 或未启用语音 → 直接返回（零开销）。
2. **节流**：距上次播放 < `minGap`（全局 1.2s）→ 丢弃；同 key 冷却期内 → 丢弃。
3. **优先级仲裁**：正在播放时，priority 更高者打断（`stop()` 旧源），低/同级丢弃。
4. **变体轮换**：随机挑选，但**避开上一次同 key 用的变体**（不连续重复）。
5. **微变调**：`playbackRate = 0.92~1.08` 随机 + `detune` 微调，同一素材听感不呆板。
6. **音量**：`gain = (config.sound.volume / 100) × 响度归一系数`，平滑 attack 8ms 防"啪"声。

### 3.2 播放层要点
- `AudioContext` **惰性创建 + 首次用户手势解锁**（pointerdown 一次性监听 resume）——规避 autoplay 策略；解锁前的自主喵静默跳过（降级不报错）。
- `AudioBuffer` 按 key+变体缓存，首次解码后驻留；解码失败（文件缺失/损坏）记 console.warn 并从 SPEC 标记剔除，**不影响气泡**。
- 文件用 `new Audio(url)` 兜底？**不用**——统一 Web Audio 便于 gain/打断/变调。

### 3.3 触发逻辑（情境 → 叫声，四类）

| 类别 | 气泡 key（现存） | 语音情境 | 说明 |
|------|------------------|----------|------|
| 互动反馈 | pet / eat / play / bath / callReply / wake | pet / eat / play / bath / call / wake | 高频，2–3 变体，冷却 0.8–1.5s |
| 需求驱动 | hungry/tired/lonely/dirty 类需求台词 | hungry / tired / lonely / dirty / unhappy | 属性档位联动：critical 档换更急促的 urgent 变体 |
| 自主闲聊 | 随机小语料 | idle | 与 autoBubble 冷却对齐，不另加 |
| 系统事件 | settingsSaved / sizePct / maxSize… | **不发声或轻喵** | 避免操作噪音；默认不发声 |

接线方式：`showBubble(text, key)` 增加可选参数 → 在 showBubble 内部一行调用 `Voice.play(key)`。
调用点改造清单（renderer.js 现有）：互动 6 处（L710/754/787/827/1081/1130）、自主 1 处（L1029 走 autoBubble）、需求台词 1 处（L342 autoBubble 汇聚点）、系统类**不接**。

### 3.4 设置扩展（config-schema `sound` 组，只加 1 项）

```js
{ k: 'voice', t: 'switch', d: true, requires: 挂在 bubbles 之外独立,
  zh: '喵叫声', en: 'Meow sounds',
  nzh: '猫说话时同步发出叫声（静音总开关仍生效）', nen: '...' }
```
- 复用现有 `muted`（总闸）与 `volume`（音量）——**不新增音量项**，schema 驱动 UI 自动出现。
- `coerce()` 兼容旧配置：缺省即 true，configVersion 不升（新增键带默认值即可）。

---

## 四、音频资源

### 4.1 规格约定
| 项 | 约定 |
|----|------|
| 格式 | Ogg Vorbis（Electron 原生支持、体积小；44.1kHz 单声道即可） |
| 时长 | 单条 0.4–1.5s（危急叫可短促 0.3s） |
| 命名 | `<context>_<n>.ogg`，全 ASCII，如 `pet_1.ogg`、`hungry_2.ogg` |
| 响度 | 统一归一化（约 -16 LUFS），避免忽大忽小 |
| 数量 | P0：8 情境 × 2 变体 ≈ 16 条，总体积 < 1MB（asar 可承受） |
| 目录 | `assets/audio/meow/`（`files: "**/*"` 打包规则自动包含） |

### 4.2 获取路线（二选一或混用）
- **路线 A（推荐先走）**：CC0/CC-BY 素材库（freesound.org、pixabay）筛选真实猫叫 → 按情境剪辑分类；**记录每条来源与许可证**写入 `assets/audio/CREDITS.md`。
- **路线 B**：自录真猫或 AI 音频合成 → 更贴合"Q 版银渐层"人设，但耗时。
- **处理管线**：`tools/normalize_audio.py`（新建）——批量解码 → 裁剪静音头尾 → 响度归一 → 转 ogg → 按命名规范重命名 → 输出清单校验报告。与现有精灵图管线（rebuild_sprites.py）同一套用法习惯。

---

## 五、实施步骤（4 阶段，每阶段独立验收）

### 阶段 1：引擎与接线（纯代码，用占位音或静音跑通）
- [ ] 新建 `engine/voice.js`：VOICE_SPEC 骨架 + play/门禁/节流/变体/优先级
- [ ] `showBubble(text, key)` 加可选参数并接 Voice.play；改造 3 个高频调用点（pet/eat/play）
- [ ] schema 加 `voice` 开关
- **验收**：开关关闭/静音时零发声；开启后互动有叫声；气泡行为无任何回归（test_logic 全绿）

### 阶段 2：素材制作与全量接线 —— ✅ 已完成（2026-10-17）
- [x] 素材管线 `tools/audio/import_meows.py`（切片 → 高通 → 重采样变速 → 响度归一 → OGG）
      —— 未另建 `normalize_audio.py`：本项目音频只需一条加工链，单脚本 + 参数表即可，
      与现有 `rebuild_sprites.py`「一脚本跑全素材」的惯例一致
- [x] 采集 4 个 CC0 素材包 / 7 条源录音 → 生成 **29 条**情境素材（占位 wav 已删，1.3MB → 269KB）
- [x] `CREDITS.md` 完整登记：源文件 / 作者 / 许可证 / 来源链接 / 每条加工参数
- [x] VOICE_SPEC 14 情境全覆盖（阶段 1 已接线完成，本阶段未改代码）
- [x] 危急档独立急促素材 `urgent/urgent_1..2.ogg`（0.32s / 0.36s，变速 ×1.14/×1.16）
- **验收**：`test_logic.js` 167 条全绿（新增 3 条阶段 2 规格断言）；Chromium 内 29 条全部解码成功、
  时长/采样率/声道符合规格；素材清单 0 缺失

### 阶段 3：音色统一与打磨（已完成音色部分）
- [x] test_logic.js 增补断言：VOICE_SPEC 文件存在性守卫、节流逻辑、变体不连续重复、muted/volume 优先级
- [x] **音色统一（柔化）**：29 条统一走「加暖 + 削刺 + 削嘶 + 温和压缩 + 柔性起音」，个体只做定点偏置；
      平均尖锐度 1.11→1.03 acum、3–5k 占比 2.0%→0.5%、谱重心 1373→1225 Hz，1–3k 存在感保留 97%
      （方案与逐条参数见 `tone-plan.md`；测量工具 `tools/audio/analyze_meow_tone.py`）
- [x] 微变调手感调参（playbackRate 0.94–1.06，sys 不抖动）；打断策略实测
- [ ] **人工听感确认**：需用 `assets/previews/meow-preview-ab.html` 逐条 A/B 一遍，确认"变柔但没变闷"
- **验收**：断言全绿 ✅；实机听感确认（连续互动 30s 无刺耳/无漏叫）待人工

### 阶段 4：打包发布 v1.8.0
- [ ] 升版两处（package.json + README 表格）→ 打包双产物 → asar 核对（含音频文件清单与 MD5）→ 实机验证
- **验收**：便携版/安装版双产物，语音在打包版中正常

---

## 六、注意事项 / 风险

1. **autoplay 策略**：AudioContext 必须手势解锁；开机自启（startHidden）场景的自主喵在解锁前会静默——属预期降级，首次用户点击后恢复。
2. **防骚扰是体验核心**：全局最小间隔 1.2s + 分情境冷却；危急叫声例外可打断。宁可少叫，不可刷屏。
3. **失败静默**：任何音频异常（缺失/解码失败/上下文未解锁）都必须静默降级，**绝不能影响气泡与行为系统**。
4. **体积**：全部素材 <1MB，asar 增量可忽略；文件名 ASCII 避免 asar 路径坑（历史教训：中文路径 + asar 工具链易出 not found）。
5. **打断语义**：优先级低者不打断高者；同优先级后到丢弃（不打断）——避免叫成"合奏"。
6. **与状态面板/穿透互不影响**：语音纯渲染进程，无窗口/焦点副作用。
7. **回滚**：阶段化提交 + 开关默认开但可关；出问题先关 `voice` 开关，代码回滚取 `_backup/` 快照。
8. **许可证合规**：路线 A 素材必须留档 CREDITS.md（来源 + 许可证 + 下载日期）。

---

## 七、已拍板决策（2026-10-17 确认）

| # | 决策 | 落地方式 |
|---|------|----------|
| 1 | 素材路线：**CC0 现成素材优先**，先基于现有素材快速落地 | 阶段 1 用程序化占位音跑通链路；阶段 2 采集 CC0 真素材替换，来源登记 `cat-pet/assets/audio/CREDITS.md` |
| 2 | **系统类事件同样配轻量叫声** | 新增 `sys` 情境：独立增益 0.45、素材 0.16s、优先级 0（不打断任何叫声）、冷却 1.5s |
| 3 | **危急档急促喵单独录制素材**，与其他音效区分管理 | 独立子目录 `assets/audio/meow/urgent/`，SPEC 中 `prio=4`（最高，可打断普通叫）、时长 0.26s、增益 1.0 |
| 4 | 阶段 1 先用**占位音**跑通全流程 | 占位音 `.wav`；播放器 **`.ogg` 优先 / `.wav` 兜底** → 阶段 2 放入同名 `.ogg` 即完成替换，**零代码改动** |

---

## 八、阶段 1 交付（已完成）

### 8.1 音效分类与触发时机

| 分类 | 情境 ctx | 触发时机（气泡 key） | 素材 | 参数（冷却 / 优先级 / 增益） |
|------|----------|----------------------|------|------------------------------|
| 互动反馈 | `pet` | 抚摸结算 `pet` | pet_1..3 | 0.9s / 2 / 1.0 |
| 互动反馈 | `eat` | 进食结算 `eat` | eat_1..2 | 1.5s / 2 / 1.0 |
| 互动反馈 | `play` | 逗玩结算 `play`、扔球 `ball` | play_1..2 | 1.2s / 2 / 1.0 |
| 互动反馈 | `bath` | 洗澡结算 `bath`、入水 `bathStart` | bath_1..2 | 3.0s / 2 / 0.95 |
| 互动反馈 | `wake` | 睡眠被唤醒 `wake` | wake_1..2 | 2.0s / 2 / 1.0 |
| 互动反馈 | `call` | 呼喊回应 `callReply` | call_1..2 | 1.5s / 2 / 1.0 |
| 互动反馈 | `pet`（复用） | 嗅闻 `smell` | pet_1..3 | 同上 |
| 需求驱动 | `hungry` | `need.hunger.low`、`hungry` | hungry_1..2 | 6s / 3 / 1.0 |
| 需求驱动 | `tired` | `need.energy.low` | tired_1..2 | 6s / 3 / 0.9 |
| 需求驱动 | `sad` | `need.happiness.low`、`sulk` | sad_1..2 | 8s / 1 / 0.85 |
| 需求驱动 | `dirty` | `need.cleanliness.low` | dirty_1..2 | 8s / 1 / 0.9 |
| 需求驱动 | `lonely` | `lonely`、`bored`、长时间无互动 | lonely_1..2 | 8s / 1 / 0.9 |
| **危急档** | `urgent` | `need.*.critical`（四项属性任一危急） | urgent/urgent_1..2 | **3s / 4（最高，可打断）/ 1.0** |
| 自主闲聊 | `idle` | 欢迎语 `welcome` | idle_1..2 | 10s / 1 / 0.8 |
| **系统轻量** | `sys` | 见 8.2 | sys_1..2 | **1.5s / 0（不打断）/ 0.45** |

**不出声的 key**：`need.*.good`（属性良好）、未知 key、空 key。
**全局节流**：任意两次叫声最小间隔 **1.2s**（跨情境生效）。

### 8.2 系统类事件清单（轻量叫声）

| 触发事件 | 气泡 key | 播放时机 |
|----------|----------|----------|
| 设置页「应用」保存成功 | `settingsSaved` | 宠物冒「设置已保存」气泡时 |
| 滚轮调整体型（百分比提示） | `sizePct` | 每次尺寸档位变化提示 |
| 体型到达上限 / 下限 | `maxSize` / `minSize` | 越界尝试时 |
| 已在极限仍继续调整 | `atMax` / `atMin` | 同上 |

**轻量控制**（三重限制，避免操作噪音）
- **音量**：`SPEC.sys.gain = 0.45`（相对主音量再打折；素材峰值本身仅 0.28）
- **时长**：素材 0.16–0.17s（普通叫声 0.4–0.7s）
- **打扰度**：优先级 0（永不打断正在播放的叫声）、冷却 1.5s、不做随机变调（保持提示音辨识度）

### 8.3 交付物清单

| 文件 | 说明 |
|------|------|
| `cat-pet/engine/voice.js` | 新建。SPEC（14 情境）+ 门禁/节流/变体/打断仲裁 + Web Audio 播放，全链路异常静默 |
| `cat-pet/renderer.js` | `showBubble(text, voiceKey)`、`autoBubble(text, force, voiceKey)`、`needBubble` 透传 key；**15 处调用点**接入（互动 8 / 需求 1 汇聚点 / 自主 / 系统 5） |
| `cat-pet/index.html` | 引入 `engine/voice.js`（renderer 之前） |
| `cat-pet/engine/config-schema.js` | sound 组新增 `voice` 开关（默认开，51 项），旧配置自动补默认 |
| `cat-pet/assets/audio/meow/**/*.ogg` | **29 条 CC0 真实录音素材**（14 情境，269KB），`urgent/` 独立子目录；阶段 1 的 29 条占位 wav 已删除 |
| `cat-pet/assets/audio/CREDITS.md` | 来源登记：4 个素材包 / 7 条源录音 / 作者 / CC0 许可证 / 每条加工参数表 |
| `tools/audio/import_meows.py` | 素材管线（源录音 → 切片 → 变速 → **柔化 EQ/压缩/柔性起音** → 响度归一 → OGG，表驱动可复跑） |
| `assets/previews/meow-preview.html` | 试听页（按情境分组，单条 / 连续试听；单文件自包含，任意打开方式可播） |
| `assets/previews/meow-preview-ab.html` | **新旧 A/B 对比页**（每行「旧/新」双按钮 + 尖锐度/3–5k/谱重心对照），用于听感定稿 |
| `tools/audio/analyze_meow_tone.py` | 音色客观测量（谱重心 / >4k / 3–5k / Zwicker 尖锐度 / 估计基频），支持 `--csv` |
| `tools/audio/make_meow_ab.py` | A/B 对比页生成器（读 `_baseline_meow.csv` / `_after_meow.csv`） |
| `tone-plan.md` | 音色统一方案：判据、统一处理链、逐条调整方向与验收数据 |
| `tools/audio/make_placeholder_meows.py` | 占位音生成脚本（保留作兜底；当前已无 wav 引用） |
| `tools/check/test_logic.js` | 语音断言 25 条 → **28 条**（新增阶段 2 规格：全 ogg / 时长上限 / 无 wav 残留） |

### 8.4 占位音 → 真素材替换方式（决策 4）——✅ 已执行完毕

播放器按 **`.ogg` 优先、`.wav` 兜底** 查找同一基名，因此替换完全无代码改动：

1. 真素材按 `<ctx>_<n>.ogg` 命名放进 `assets/audio/meow/`（危急喵放 `urgent/`）。
2. **同名 `.wav` 占位音已全部删除**（29 个，回收 1.2MB）；`.ogg` 命中后 wav 不再被引用。
3. 增删变体数量时，同步改 `engine/voice.js` 的 `SPEC[ctx].files` + `tools/audio/import_meows.py` 的 `TARGETS`
   （守卫断言会校验素材存在性与时长上限，漏放/超限会 FAIL）。
4. 想换素材：改 `TARGETS` 的「源文件 + 切片 + 变速比」再跑一遍脚本即可，秒级重生成。

### 8.5 阶段 1 范围边界

**包含**：链路打通（14 情境全覆盖）、门禁/节流/打断/变体、占位音、设置开关、单元与实机验证。
**不包含**（留给后续阶段）：
- 真实素材采集与听感调参（阶段 2）
- 危急档急促喵的**真素材**（当前为合成占位，目录与优先级已就位）
- 设置页「试听」按钮、独立语音音量项（当前复用全局 volume / muted）
- 打包发版：**本阶段未打包**，随 v1.8.0 阶段 4 一起出双产物

### 8.6 验证结果

- `tools/check/test_logic.js`：**全部通过**（新增 25 条语音断言：映射 5 / SPEC 约束 4 / 素材存在性 2 / 门禁节流 6 / 静默 1 / 接线守卫 3 等）。
- 实机（真实 app + 驱动真实 action）：**8/8 通过** —— `window.Voice` 加载、系统事件→`sys`、互动 `callReply`→`call`、静音零播放、`voice` 关闭零播放、`pet_1.wav` 可解码（0.55s/48kHz）、渲染进程无 error 日志。
- 已知环境限制：无头验证下 rAF 被节流，依赖帧循环的 `pet/eat` 冒泡路径无法自动触发（改用即时冒泡的 `callReply` 验证；真实桌面环境不受影响）。
