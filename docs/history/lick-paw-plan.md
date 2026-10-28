# 「舔爪子」动作方案（lick-paw-plan.md）

> 状态：**已实现（2026-10-25）** —— 4 项决策已拍板并落地，回归全绿
> 基线：当前工作区 `E:\AIWork\桌面宠物`，v1.0.0，原始 47 张序列帧 + 1 张 drag，14 个姿态 → 现 **51 帧 + drag，15 个姿态**
> 分镜图：`design/preview/storyboard-lick-paw.png`　节奏动图：`design/preview/preview-lick-paw.gif`（同目录 `preview-lick-paw-strip.png` 是横向帧条带，便于逐帧看姿态）

**拍板结果**：① F1 头未低下去，接受；② 6 fps，`lick_2` 加 75 ms 停留；③ 进食后 2 轮；④ 空闲 90–130 s 一次。

> **节奏二次修订（2026-10-25 晚，已落地）**：虎哥反馈「整体偏快、主帧不够停」，遂把基础帧率 **6 → 5 fps**、主帧停留 **75 → 150 ms**。单轮 **0.742 → 0.950 s**，进食 2 轮 **1.48 → 1.90 s**。下文原始 6 fps 段落仅作决策留痕，**实际代码以 5 fps / 150 ms 为准**；`docs/02-animation.md` 与 `tools/check/test_logic.js` 已同步。

**实测与方案的差异**：基线核心高度是 **331 px**（不是 322——322 是同批 96 帧版本的数值），因此 4 帧全部按 331 归一，`POSE_SCALE` **不需要新增条目**（`lick` 组核心 329–331，与 `idle` 差 ≤0.6%，走默认系数 1.0 即可）。

---

## 一、动作定义

猫咪坐下后抬起一只前爪，伸舌舔爪背，再用沾湿的爪子抹一把脸，最后放下爪子回到待机。

- **帧数**：4 帧（与 `eat` / `play` 同档，不引入 96 帧那套膨胀）
- **帧率**：6 fps（与 `eat` 同速，慢条斯理）
- **单轮时长**：4 / 6 + 0.075 = **0.742 s**
- **播放次数**：进食后 2 轮（1.48 s）；空闲触发 1–2 轮（0.74–1.48 s，随机）

| 帧 | 名称 | 节拍 | 姿态要点 |
|---|---|---|---|
| `lick_1` | 起势 | 0 ms | 右前爪抬离地面停在胸口，掌垫朝外；头正对前方、视线略下，嘴闭无舌 |
| `lick_2` | 舔爪 | 167 ms + **75 ms 停留** | 爪送到嘴边，粉舌伸出舔在爪背上；眼睛半闭，**整段的主节拍** |
| `lick_3` | 擦脸 | 409 ms | 舌头收回，沾湿的爪子贴到右侧脸颊靠近眼睛处；头向爪侧倾、眼睛闭成弧线 |
| `lick_4` | 收势 | 575 ms | 爪落回地面，回到接近 `idle_1` 的坐姿；尾巴轻摆 |

> 已拍板：`lick_2` 停留 167 + 75 = 242 ms。节拍标注见分镜图与 `design/preview/preview-lick-paw.gif`。

---

## 二、素材规格与管线

| 项 | 要求 |
|---|---|
| 画布 | 512×512 RGBA，透明底 |
| 核心高度 | 322 px（与 `idle` 一致；`binary_erosion(alpha>100, 8)` 量腐蚀核心） |
| 底边 | 与 `idle` 同基线（`SPRITE_GROUND_Y = 470`） |
| 横向对齐 | 腐蚀核心质心 x 对齐，不用 bbox 中心（尾巴会把 bbox 撑偏） |
| 流程 | 抠图 → 去杂点 → `scale_to_canvas.py --target 322` → `frame_audit` → `magenta_audit` |
| 组内一致性 | 4 帧核心高度极差 ≤ 1.0%、底边极差 0 px |

生成路线：`ImageGen image-to-image`，参考图先拷到 `%TEMP%\igen_ref\`（中文路径会让 `image1` 静默返回空），`input_fidelity: high`，纯白底 → 抠图。

---

## 三、状态机改动（7 处）

| # | 位置 | 改动 |
|---|---|---|
| 1 | `renderer.js` `SPRITE_FILES` | 新增 `lick: ['.../lick_1.png' … 'lick_4.png']` |
| 2 | `renderer.js` `SPRITE_FPS` | 新增 `lick: 8` |
| 3 | ~~`renderer.js` `POSE_SCALE`~~ | **不改**：`lick` 组核心 329–331 与 `idle` 的 331 同档，默认系数 1.0 |
| 4 | `renderer.js` `INTERRUPTIBLE` | 新增 `lick: true`（危急需求可随时打断） |
| 5 | `renderer.js` `states.eat.update` | 计时结束时 `return 'lick'`（原 `'idle'`），结算饥饿/心情与气泡逻辑不变 |
| 6 | `renderer.js` `states` | 新增 `lick` 状态：`enter` 播 `lick`（淡化 0.18 s）+ 设 `pet.lickTimer`；`update` 计时归零 → `'idle'` |
| 7 | `renderer.js` `decide()` | 在 P9（趴睡）之后、P10（加权表）之前插入空闲随机分支 |

`states.lick` 形态与 `tailwag` / `unhappy` 完全一致（计时器型），不碰 `animator.js`。

---

## 四、两种触发情形

### ① 进食结束 —— 必定触发

```
eat.update：eatTimer ≤ 0
  → 结算 hunger +42 / happiness +6
  → food = null、flushStats()、气泡
  → return 'lick'          // 原来是 'idle'
lick.enter：pet.lickTimer = 2 * 0.500 = 1.0 s（固定 2 轮）
lick.update：计时归零 → 'idle'
```

被拖拽 / 抚摸 / 逗玩打断时直接退出，不补播（与现有 `eat` 的打断语义一致）。

### ② 空闲随机 —— 低频率

```
// decide() 中，sleep 判断之后
if (time - pet.lastLickAt > LICK_CD && Math.random() < LICK_PROB * cleanFactor()) {
  pet.lastLickAt = time;
  return 'lick';
}
```

| 参数 | 值 | 说明 |
|---|---|---|
| `LICK_CD` | 90 s | 硬冷却，两次之间至少 90 s |
| `LICK_PROB` | 0.05 | 每个决策点 5% 命中 |
| 决策间隔 | 2.2–5.5 s（normal 档 `think`） | 现有 `ACTIVITY` 表 |
| 实际间隔 | **约 90–130 s 一次** | 冷却先到期，再等首个命中（几何分布均值 ≈ 20 次 × 3.5 s，但被 90 s 冷却截断） |
| `cleanFactor()` | `cleanliness` 非 good 时 ×2 | 脏了更爱舔，行为上说得通；good 时 ×1 |

**不加进 `ACTIVITY` 权重表**——权重表与 `walk` / `idle` / `run` 抢比例，会把别的动作挤掉，且间隔不可控。独立冷却＋概率才能做到「低频率、可预期」。

---

## 五、循环衔接

| 措施 | 说明 |
|---|---|
| 姿态闭环 | `lick_4` 与 `idle_1` 只差尾巴角度，核心高度/底边/质心三重对齐，切换时不会有位移跳动 |
| 淡化时长 | 进 `idle` 用 0.18 s 交叉淡化，与 `tailwag` / `unhappy` 同档 |
| 首帧进入 | 从 `idle` 进 `lick` 同样 0.18 s，`lick_1` 的爪子已在半空，避免「爪从地面弹起」 |
| 尺寸稳定 | `POSE_SCALE.lick` 必须使 `lick` 组核心高度 ≈ `idle` 的 322；淡化期间 `prev` 用自己组的系数，不会出现缩放跳变 |
| 不打断睡眠 | `lick` 只在 `idle` 决策点触发，`sleep` 状态不会被它唤醒 |

---

## 六、需同步的文档与测试

- `docs/02-animation.md`：帧表加 `lick`（4 帧 / 8 fps / 0.500 s），姿态总数 14 → 15
- `docs/03-behavior.md`：§决策优先级补「空闲舔爪」分支与参数
- `tools/check/test_logic.js`：`EXPECTED` 加 `lick_1..4`；加断言「进食结束必进 lick」「冷却期内不触发」
- `tools/frame_audit_baseline.json`：加 `lick` count = 4
- `tools/legacy/magenta_audit.py`：51 张精灵全扫
- `app/README.md` / `docs/07-engineering.md`：帧数 47 → 51

---

## 七、待确认（4 项）

1. **姿态**：✅ 已定接受 F1（头没低下去）
2. **节奏**：✅ 已定 6 fps + `lick_2` 停留 75 ms（单轮 0.742 s）
3. **播放次数**：✅ 已定进食后 2 轮（1.48 s）
4. **随机频率**：✅ 已定 90 s 冷却 + 5% 概率（≈ 90–130 s 一次）

---

## 八、落地与验证（2026-10-25）

**改动文件**

| 文件 | 改动 |
|---|---|
| `app/assets/sprites/frames/lick_1..4.png` | 新增 4 帧（512×512 RGBA） |
| `app/engine/animator.js` | 新增 `play()` 的 `opts.hold` 逐帧停留；`CONTENT_TOP_FALLBACK` 补 `lick: 130` |
| `app/renderer.js` | 帧表 / 帧率 / 常量 / `INTERRUPTIBLE` / `eat` 转场 / `states.lick` / `decide()` P9.5 / `cleanFactor()` / 动效分支 |
| `tools/check/test_logic.js` | `EXPECTED` 补 4 帧 + 新增 10 条断言 |
| `docs/02-animation.md`、`docs/03-behavior.md`、`README.md`、`app/README.md` | 帧表、优先级、计数同步 |

**素材实测**

| 帧 | 核心高度 | 底边 | 核心质心 x |
|---|---|---|---|
| `lick_1` | 329 | 468 | 256.5 |
| `lick_2` | 330 | 468 | 256.7 |
| `lick_3` | 331 | 468 | 256.5 |
| `lick_4` | 331 | 468 | 256.9 |
| 对照 `idle_1` | 331 | 468 | 256.8 |

组内核心漂移 **2 px（0.60%）**，底边极差 **0 px**。

**回归结果**

| 项 | 结果 |
|---|---|
| `node tools/check/test_logic.js` | **全部断言通过**（含「出现顺序 eat@51 → lick@404」的行为验证） |
| `python tools/legacy/magenta_audit.py app/assets/sprites` | 52 个文件 **0 命中 / 0 超标** |
| 精灵总数 | 47 → **51**（14 个序列姿态 + drag，共 15 姿态） |
| 真机启动（Electron 31.7.7） | canvas 640×640、画布不透明像素 64904、`lick_1..4` 解码均 512×512、**无 console 异常** |

**环境备注**：本机 `ELECTRON_RUN_AS_NODE=1`，直接跑 `electron.exe .` 会进入 Node 模式并因 `require('electron')` 报错，需 `env -u ELECTRON_RUN_AS_NODE`；另外单实例锁会让上一轮残留进程阻塞新实例，冒烟前先 `taskkill /F /IM electron.exe`。

---

> 后续姿态修复（1.1.4 残影与截断 → 1.1.8 伤心尺度）已迁至 [`pose-fix-log.md`](pose-fix-log.md)，本文件保持「舔爪方案」原貌。
