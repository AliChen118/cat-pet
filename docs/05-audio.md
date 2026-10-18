# 05 · 语音（喵叫）

## 一、目标与分层

猫冒气泡时同步播一声匹配情境的喵叫。**宁可少叫，不可刷屏**；任何音频异常都必须静默降级，绝不影响气泡与行为系统。

```
触发层  renderer.js：showBubble(text, voiceKey?) / 需要铺底时直接 Voice.play('purr')
   │     key 由调用点显式传入（不从渲染后的文本反查——i18n 文案会变，语义 key 稳定）
   ▼
调度层  engine/voice.js：SPEC（情境→素材/冷却/优先级，单一来源）
   │     + 门禁 → 全局节流 → 情境冷却 → 优先级仲裁 → 变体不连续
   ▼
播放层  渲染进程 Web Audio：AudioContext + AudioBuffer 缓存 + gain 包络
   ▼
素材层  app/assets/audio/meow/<ctx>_<n>.ogg（.ogg 优先、.wav 兜底）
```

**为什么播放放渲染进程**：交互反馈要求 <100ms，走主进程要多一次 IPC 往返；且音频与气泡天然同源，便于对齐。

---

## 二、情境 SPEC

`engine/voice.js` 的 `SPEC` 是唯一来源：改叫声不动逻辑代码。

| 情境 | 素材 | 冷却 | 优先级 | 额外增益 | 触发 |
|---|---|---|---|---|---|
| `pet` | `pet_3` | 900ms | 2 | 1.0 | 抚摸结算、嗅闻 |
| `eat` | `eat_1` | 1500ms | 2 | 1.0 | 进食结算 |
| `play` | `play_2` | 1200ms | 2 | 1.0 | 逗玩结算、扔球 |
| `bath` | `bath_1` `bath_2` | 3000ms | 2 | 0.95 | 入水、洗澡结算 |
| `wake` | `wake_1` `wake_2` | 2000ms | 2 | 1.0 | 从睡眠被唤醒 |
| `call` | `call_2` | 1500ms | 2 | 1.0 | 呼喊应答 |
| `hungry` | `hungry_2` | 6000ms | 3 | 1.0 | 饱食偏低档台词 |
| `tired` | `tired_1` | 6000ms | 3 | 0.9 | 体力偏低档台词 |
| `lonely` | `lonely_2` | 8000ms | 1 | 0.9 | 孤独 / 无聊台词 |
| `idle` | `idle_1` `idle_2` | 10000ms | 1 | 0.8 | 启动迎接、空闲自语 |
| `purr`（铺底） | `purr_1` | 9000ms | 1 | 0.55 | 抚摸时循环铺底，`maxDur 2.8s` 淡出 |
| `purrSleep`（铺底） | `purr_2` | 45000ms | 1 | 0.40 | 入睡时铺底，`maxDur 3.2s` 淡出 |

### key → 情境的解析

```js
MAP: pet→pet  play→play  eat→eat  bath→bath  wake→wake  callReply→call
     ball→play  bathStart→bath  smell→pet  welcome→idle  lonely→lonely
     bored→lonely  hungry→hungry  purr→purr  purrSleep→purrSleep

need.<stat>.<tier>:
  critical → null（危急档素材未入选，只出文字）
  good     → null（属性良好不出声，保持"只在有事时叫"）
  low      → hunger→hungry / energy→tired / 其他 → null
```

未登记的 key、空 key 一律不发声。

---

## 三、调度规则

| 规则 | 实现 |
|---|---|
| 门禁 | `enabled=false` 或 `muted=true` → 直接返回（零开销） |
| 全局节流 | 任意两次叫声最小间隔 **1200ms**（跨情境生效） |
| 情境冷却 | 同情境在 `cd` 内丢弃 |
| 优先级仲裁 | 正在播放时，优先级更高者打断旧源；低/同级丢弃（同级不打断，避免"合奏"） |
| 变体轮换 | 同情境多条素材时随机，但**避开上一次用的那条** |
| 微变调 | `playbackRate = 0.94–1.06`，同一素材听感不呆板 |
| 音量 | `gain = (volume/100) × SPEC.gain`，`attack 8ms` 防"啪"声 |
| 铺底音 | `layer:true` 走独立音轨（循环 + 定时淡出），**不参与**一次性叫声的节流与仲裁 |
| 失败静默 | 文件缺失、解码失败、上下文未解锁、API 不存在 → `console.warn` 后跳过，气泡照常 |

**音量链**：渲染端 `voiceOpts()` 每次播放实时读取配置，`volume = sound.volume × (sound.voiceVolume/100)`，再乘 `SPEC.gain`。两个音量项相乘，设置页「应用」后立即生效。

**自动播放策略**：`AudioContext` 惰性创建，首次用户手势（`pointerdown`）时 `resume()` 解锁。开机静默启动到用户首次点击之前的自主喵会静默跳过——属预期降级，不是 bug。

---

## 四、素材

15 条 OGG（44.1kHz 单声道），合计约 184 KB：

| 情境 | 文件 | 来源（作者 · 许可） |
|---|---|---|
| 抚摸 | `pet_3` | steffcaffrey · CC0 1.0 |
| 进食 | `eat_1` | patchytherat · CC0 1.0 |
| 逗玩 | `play_2` | Macro · **CC-BY 3.0**（需署名） |
| 洗澡 | `bath_1` `bath_2` | AntumDeluge · CC0 / tuberatanka · CC0 |
| 唤醒 | `wake_1` `wake_2` | qubodup · CC0 / Kerzoven · CC0 |
| 呼喊 | `call_2` | tuberatanka · CC0 |
| 饥饿 | `hungry_2` | AntumDeluge · CC0 |
| 疲惫 | `tired_1` | steffcaffrey · CC0 |
| 孤独 | `lonely_2` | AntumDeluge · CC0 |
| 迎接/空闲 | `idle_1` `idle_2` | steffcaffrey · CC0 / Kerzoven · CC0 |
| 呼噜 | `purr_1` `purr_2` | Kerzoven · CC0 |

完整来源、许可证与逐条加工参数登记在 `app/assets/audio/CREDITS.md`。原始录音存 `assets-src/audio-raw/`（**不打包**，仅作再生成输入）。

> 当前是**用户精选集**（2026-10-17 定稿）：`sad` / `dirty` / `urgent` / `sys` 四个情境整体下线，对应气泡只显示文字。要恢复，把 `CUTS` 表对应行加回并重跑脚本，再在 `SPEC` 里补一行。

---

## 五、音色处理链

所有素材走同一条链，`tools/import_voice_sfx.py` 表驱动（`CUTS` 改一行即可重生成）：

```
源 WAV/OGG → 单声道 44.1k → 切片 → 裁静音（留 10ms 前导）
           → 高通 90Hz
           → 重采样变速（定音高与时长）
           → 【音色】4 段 EQ：加暖 → 补实体 → 削刺 → 削嘶
           → 【动态】温和峰值压缩（只压瞬态尖峰）
           → 柔性起音/收尾（raise-cosine）
           → 响度归一（分档 RMS）+ 软限幅（tanh，仅峰值样本）
           → OGG/Vorbis
```

| 环节 | 参数 | 解决 | 为什么不更狠 |
|---|---|---|---|
| 320Hz 低架 | +2.6 dB | 胸腔厚度，不"薄" | 超 +4 dB 会糊成一团 |
| 900Hz 峰 | +1.2 dB | 补实体感 | 超 +3 dB 变鼻音 |
| 3.4kHz 峰（Q 1.15） | −3.4 dB | 刺耳主区（人耳 2–5kHz 最敏感） | 削到 −8 dB 会让「喵」变「呜」 |
| 5.6kHz 高架 | −4.2 dB | 嘶声、毛刺 | 深架会连气声细节一起抹掉 |
| 11kHz 低通 | 二阶 Butterworth | 超高频毛刺 | 不做 brickwall，保住瞬态锐度 |
| 压缩 | 2.6:1，阈值 RMS+2.5dB，atk 10ms / rel 120ms | 只压峰值（crest 19.6 → ≤15.9） | 4:1 会压扁气声与颤音 → 机械感 |
| 起音 | 12–20ms raise-cosine | 起音点击 | 线性 6ms 仍有 click；>25ms 吃掉"启动感" |
| 响度 | normal −18 / soft −20.5 / urgent −15.5 / sys −20 dBFS | 15 条音量齐平 | 削峰只作用于 <0.5% 采样 |

**呼噜单独一条链**：原始录音 92% 能量在 80Hz 以下（小喇叭听不见），改走 `EQ_PURR`——削 70Hz 轰鸣（−4.5）、抬 260Hz 体感（+4.5）、520Hz +1.5、5kHz 以上 −2.5。

### 两个必须记住的个体例外

1. **高音轻喵（`pet_3` / `idle_1`，f0 ≈ 940Hz）**：原始素材一点都不尖（3–5k 占比 ≈0%），套统一曲线会把第 3/4 谐波削掉，实测 1–3kHz 存在感掉过 31%——**「喵」变「呜」**。这两条把削刺收回到 `harsh +1.4`（相对基线相当于 +2dB）、加暖 −0.6。
2. **明亮玩闹喵（`play_2`）**：3–5k 占比高，需要重点削（`harsh −3.0`、`sibil −1.6`），否则连续逗玩会扎耳朵。

> 调参口诀：想更柔 → `harsh` 再减 1–2 dB（净削不要超过 −8 dB）；想更亮 → 加 `harsh` 1 dB，但"清亮感"主要由 `sibil` 决定，优先动它；想更"奶" → `rate` 再减 0.02–0.03（注意 `sys`/`urgent` 有 0.35/0.45s 的时长上限）。

### 客观指标（精选 15 条）

| 指标 | 值 |
|---|---|
| Zwicker 尖锐度均值 / 最大 | 0.86 / 1.07 acum（越低越不刺耳） |
| 3–5kHz 占比均值 / 最大 | 0.8% / 3.7% |
| 谱重心均值 | 966 Hz |
| 平均时长 | 1.11s |

呼噜两条单看：`purr_1` 谱重心 170Hz、200–500Hz 体感带占 19.5%；`purr_2` 105Hz / 14.3%。

---

## 六、复跑与回滚

```bash
# 抓取源素材（OpenGameArt 直链 + Freesound preview，免登录）
python tools/fetch_cat_sfx.py
# 切片 → 音色 → 归一 → OGG（改 CUTS 一行即重生成）
python tools/import_voice_sfx.py
# 交付清单
python tools/make_sfx_report.py
# 客观音色测量（--csv 输出明细）
python tools/analyze_meow_tone.py --csv _after_meow.csv
# 试听页 / A-B 对比页（单文件内嵌，双击即响）
python tools/make_meow_preview.py && python tools/make_meow_ab.py
```

**回滚**：`_backup/tone-pre_<时间戳>/meow/` 是柔化前完整素材，整目录覆盖即可；精选前的 31 条在 `_backup/sfx-select_<时间戳>/`。

**环境依赖**：本机无 ffmpeg，解码走 `libsndfile`（`soundfile`，已含 MP3 支持）；若要处理 m4a/opus 可 `pip install imageio-ffmpeg` 提供二进制。

---

## 七、边界

| 场景 | 行为 |
|---|---|
| 文件缺失 / 解码失败 | 记 warn 并从候选剔除，气泡照常 |
| `muted=true` / `voice=false` | 完全不发声 |
| `voiceVolume=0` | 静音但逻辑不跳过（保留统计） |
| 铺底呼噜与一次性叫声同时 | 独立音轨，互不打断 |
| 连续快速交互 | 全局 1200ms + 情境冷却双重限流，最多每 0.9–3s 一声 |
| 唤醒场景 | 先播 `wake`，再进入目标动作的叫声（受冷却约束可能只出前者） |
