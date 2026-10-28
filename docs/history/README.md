# 历史方案归档

这里保存各阶段的**方案原稿**，用于追溯决策脉络。它们保留当时的版本号、待确认清单与被放弃的路线，**不具约束力**——与 [`../`](../README.md) 下的现行分册或代码冲突时，一律以现行文档与代码为准。

| 文档 | 阶段 | 结案状态 | 现在该看哪里 |
|---|---|---|---|
| [`design-plan.md`](design-plan.md) | 立项 | 技术选型、模块划分基本沿用；帧数（71 帧）、窗口尺寸（400×400）、`electron-store`、双语界面等**已全部变更** | `01-architecture.md` |
| [`settings-plan.md`](settings-plan.md) | 设置系统 v1 | 机制（schema 单一来源、主进程真源、原子写、迁移）全部落地；项数（34 项 7 组）、`configVersion 2`、双语、`showNameInBubble`/`allowSleep`/`allowRun`/`singleInstance` 等**已过时** | `04-settings.md` |
| [`settings-ui-spec.md`](settings-ui-spec.md) | 设置窗 UI 评审稿 | 栅格、色彩 token、控件与状态规格沿用；导航 7 组 → 9 组，「关闭即应用」语义**已改为"关闭前确认丢弃"** | `04-settings.md` §六 |
| [`motion-plan.md`](motion-plan.md) | v1.8.0 四项需求 | 需求 3（应用/取消反馈）、需求 4（尺寸恒定）**已实现**；需求 1（帧数翻倍）被 `frames-plan.md` 取代；需求 2（动作完全随机）**用户确认取消** | `02-animation.md`、`03-behavior.md` |
| [`frames-plan.md`](frames-plan.md) | 帧扩容 v2（198 帧） | **未执行**。程序合成补间（光流 / SDF-demons）实测失败已放弃；198 帧目标未采纳，当前仍为 47 帧。其中"不要用透明叠加帧凑流畅度"的结论仍然有效 | `02-animation.md` §三 |
| [`needs-plan.md`](needs-plan.md) | 属性驱动 v1.7.0 | 分档/权重/仲裁/实时性/冷却**全部落地**；`allowSleep`/`allowBath`/`allowRun` 相关分支随设置项下线而移除，阈值与文案有小幅调整 | `03-behavior.md` |
| [`voice-plan.md`](voice-plan.md) | 语音 v1.8.0 | 分层架构、SPEC、调度、限流**全部落地**；情境由 14 收敛为 **12**（`sad`/`dirty`/`urgent`/`sys` 下线），素材由 29 条精选为 **15 条** | `05-audio.md` |
| [`tone-plan.md`](tone-plan.md) | 音色统一 | 处理链参数（EQ/压缩/起音/响度档）与"高音轻喵易被削成呜"的结论**仍有效**；文中 29 条的逐条数据属精选前素材 | `05-audio.md` §五 |
| [`voice-sfx-report.md`](voice-sfx-report.md) | 素材抓取报告 | 抓取渠道实测、来源与许可、15 条精选清单**仍准确**；`sad/dirty/urgent/sys` 的下线记录见其末节说明 | `05-audio.md` §四 |
| [`ai-chat-plan.md`](ai-chat-plan.md) | AI 自言自语 v3.1 | 形态（单向播报）、内容规格、模型接入、降级、去重**全部落地**；`dailyLimit`/`affectPet` 两项已于 1.0.0 下线，`ai` 组为 **11 项** | `06-ai.md` |
| [`lick-paw-plan.md`](lick-paw-plan.md) | 舔爪 v1.1.0 | **已落地**（5 fps + 150 ms 停留，进食后必播 2 轮、空闲 90–130 s 随机）；本文件只留方案本体，1.1.4 之后的追改已迁往 `pose-fix-log.md` | `02-animation.md`、`03-behavior.md` |
| [`pose-fix-log.md`](pose-fix-log.md) | 姿态修复 1.1.4–1.1.8 | 五轮修复的完整记录：残影与截断（1.1.4）、走跑最少 2 循环（1.1.5）、摇尾巴 / 抚摸 / 伤心尺度烘焙（1.1.6–1.1.8）。**参数与真机验证数据可直接复用**；结论已并入 `02-animation.md` | `02-animation.md` §三、`03-behavior.md` |

## 保留这些文件的原因

1. **决策可追溯**：为什么砍掉聊天窗、为什么不做程序合成补间、为什么把 14 个语音情境收敛到 12 —— 这些判断在正文分册里只写结论，理由在这里。
2. **回滚依据**：某条路线想重新启用时（例如恢复 `urgent` 危急叫声），原稿里的参数与验收数据可直接复用。
3. **避免重复踩坑**：失败路线的记录本身就是约束（见 `frames-plan.md` 开头那段修订说明）。

> 归档文档不再修改。若其中的结论被新证据推翻，请在对应现行分册里写明并引用这里的文件名；**新的追加内容另建文件**（例如 1.1.4–1.1.8 的姿态修复就从 `lick-paw-plan.md` 拆成了 `pose-fix-log.md`）。
>
> **关于文中提到的 `_backup/`**：本地快照目录已于 2026-10-26 清理（内容与 git 历史重复），各篇里写的 `_backup/pose-orig/`、`_backup/sfx-*/` 路径不再存在。要回滚请用 git（`git show <提交>:<路径>`）或从 `assets-src/audio-raw/` 重跑导入脚本；以下记录保留当时的原文表述。
