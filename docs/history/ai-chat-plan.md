# AI 自言自语方案 v3（v1.9.0 规划）

> 状态：**v3.1 已确认，S1+S2 已实现** | 日期：2026-10-17 | 当前版本：1.8.0
> v3.1 变更：**取消右键菜单 5 项**（用户拍板），触发只剩「空闲随机自主」；设置页保留「现在讲一段」按钮作为唯一手动入口（试听用）。S1（离线链路）已完成；**S2（模型接入）已完成**：OpenAI 兼容 SSE 流式 + 错误分类 + 静默降级离线 + 首句超时，281 断言全绿 + mock 端到端实机验证通过。S3（语音实测）待做。
> v3 变更：**取消一切输入通道**（无聊天窗、无说话条、无猜谜互动）。猫只**单向自言自语**：讲笑话、讲故事、念诗、出谜语（自问自答）、科普猫咪常识、随口观察。
> 形态原型：`assets/previews/bubble-mockup.html`

---

## 0. 一句话方案

宠物**自己开口说话**：右键菜单点一下（或到点自己想起），就按**句子队列**逐句冒泡讲一小段——笑话 3 句、故事 5–8 句、诗 3–5 行、谜语自问自答、冷知识 3 句；后端一套 OpenAI 兼容协议（DeepSeek 预设）生成，无 Key / 断网自动降级内置离线语料；语音默认**喵语节奏**（每段首句一声轻喵），可选系统 TTS 朗读。**没有任何输入框、对话历史、回合制交互。**

---

## 1. 形态：单向播报

### 1.1 输出通道：气泡句子队列

现有 `showBubble` 是覆盖式单条，需在其下新增**队列层**（`renderer.js` 约 80 行）：

```
主进程生成整段文本
  → 切句（。！？…\n，超 36 字硬切）→ 逐句下发 onAiSay { text, voiceKey, last }
  → renderer 入队（上限 8 句，超出丢尾部并在末句补「…」）
  → 逐条显示：hold = clamp(字数×118 + 780, 1500, 6000)ms × ai.bubblePace
  → 句间 350ms 空隙；换句 pop 弹跳；末句后 4s 淡出
```

- 切句在主进程完成，气泡与语音拿到**同一节奏**
- 诗句按 `|` 分行（模型输出约定），气泡内换行、字号 13px、行高 1.85
- **让路规则**（关键）：
  - 抚摸 / 喂食 / 逗玩 / 呼喊 / 拖拽 → 立即 `clearQueue()`，优先响应交互
  - 属性**危急**提醒 → 插到队首，其余属性气泡在播报期间挂起
  - `sleep` / `drag` 状态不启动自主播报；正在讲时进入 sleep 则淡出停讲
- 讲完自动停，**不连续追问、不等回复**

### 1.2 触发：手动 5 项 + 空闲自主

| 触发 | 说明 |
|------|------|
| ~~右键菜单 / 托盘~~ | v3.1 取消；设置页「现在讲一段」按钮承担试听入口 |
| 空闲自主 | 无交互 ≥ 3min 且队列空闲，每 60s 掷骰；间隔由 `ai.autoTalk` 控制（关 / 偶尔 15–30min / 平常 6–15min / 经常 3–8min） |
| 时段 | 23:00–07:00 自主频率减半（不静默，避免"半夜突然说话"吓人则改静默——待确认，默认减半） |
| 上限 | 自主播报计入 `ai.dailyLimit`（默认 60 次/天），手动触发不受限但同样受费用保护 |

### 1.3 入口（菜单 5 → 10 项，单层）

```
右键菜单 / 托盘：保持原样（抚摸/喂食/逗玩/呼喊/洗澡/静音/设置…/退出），不新增项。
手动试听入口：设置 → AI 自言自语 → 「现在讲一段」按钮。
```

双击猫仍是呼喊，不改。

---

## 2. 内容规格（每类独立 system 提示词 + 长度预算）

| 类型 | 句数 | 字数 | 语气要点 | 语音情境 |
|------|------|------|----------|----------|
| 笑话 | 2–3 | ≤ 90 | 猫咪视角冷幽默，末尾自嘲或反转型 | idle + play |
| 故事 | 5–8 | ≤ 260 | 第三人称小动物日常，有画面感，结尾轻落 | tired 铺底 purr |
| 诗 | 3–5 行 | ≤ 80 | 短句、具象、不押韵也行；模型用 `\|` 分行 | tired |
| 谜语 | 2 | ≤ 70 | 出题 + 停 5s + 自答（无互动，故必须自揭晓） | idle |
| 冷知识 | 3 | ≤ 100 | 真事实 + 一句猫咪吐槽 | idle |
| 随口观察 | 2–3 | ≤ 70 | 结合当前时段/宠物状态/桌面情境 | idle / lonely |

- 全局 system 硬约束：**只输出正文，不解释、不寒暄、不提"作为 AI"、不追问用户**；不使用 Markdown
- 回答超长按句数硬截断（不切半句）
- 温度 0.9（内置，"猫味"比准确性重要）

---

## 3. 模型接入（同 v2）

- **OpenAI 兼容**单协议：`POST {baseUrl}/chat/completions`，SSE 流式
- 预设：**智谱 GLM-4-Flash（默认，免费）** / 硅基流动 / 魔搭 / 百炼 / 火山方舟 / DeepSeek / Moonshot / 本地 Ollama / 自定义
- 主进程 `net.fetch`（走系统代理），`stream:true` 手动解 SSE；超时 30s
- 错误分类成人话（401「钥匙不对」、429「问得太快」、断网→离线降级），只弹一次气泡不打断使用
- **密钥**：`<dataDir>/ai-secret.bin`，`safeStorage`（DPAPI）加密；**不进 config.json**；UI 只显 `sk-****abcd` 掩码

### 3.1 S2 实现记录（2026-10-17）

- `engine/ai-client.js`（新建，纯逻辑可单测）：`buildMessages`（system 硬约束 + 类别指令 + 去重标题 + 时段/心情情境，中英双语）、`createSseParser`（半包安全）、`classify`/`netError`（401 钥匙不对 / 402 余额 / 429 限流 / 404 地址或模型 / 400 参数 / 5xx 服务端 / 断网 / 超时 / 打断）、`streamChat`（首字节 12s / 整体 60s，onText 返回 false 即断流省 token）、`chatOnce`（连接测试，max_tokens 16）。
- `engine/ai-talk.js` 新增 `createSentenceStream`：增量切句，句末标点等下一字符确认（「真的吗？！」不被切坏），同批内过短片段合并，与 `splitSentences` 整段结果一致。
- `main.js`：`aiTell` 改为「生成端 push / 播放端按 hold 消费」的并行队列，首句零等待；`aiReady()` 本地 Ollama（127.0.0.1/localhost）免密钥；**降级策略**：模型失败且未开口 → 静默改用离线语料（不打扰），已开口中断流 → 说完现有句子收尾；**首句超时 8s**：模型排长队时直接降级，不让气泡空等；`aiSleep` 可被 `aiAbort` 立刻唤醒（交互打断零延迟）；`net.fetch` 失败自动回退全局 fetch（Chromium 网络服务崩溃兜底）。
- 设置页：错误码翻译成人话（含 quota/not-found/bad-request 等），「现在讲一段」结果显示来源（模型生成 / 内置内容：原因），本地服务时 Key 框显示「可留空」。
- 验证：mock OpenAI（SSE 分片 420ms/句）端到端——模型内容逐句冒泡、断网 `ERR_CONNECTION_REFUSED` 降级、只回头不发数据的慢服务 8s 首句超时降级；设置页 AI 分组 0 控制台错误。真实 DeepSeek Key 待用户填入验收。

---

## 4. 防重复（替代"对话上下文"）

自言自语没有多轮上下文，唯一需要记住的是"别讲重复的"：

- `<dataDir>/ai-recent.json` 保存最近 **20 条**记录：`{ category, title, hash, ts }`
- 生成时把最近同类 `title` 注入 system（「最近讲过：…，请换一个」）
- 同 `hash` 内容 **3 天内不再出现**；离线语料同样走这套去重
- 设置页提供「清空播报记录」按钮（`t:'action'`）

---

## 5. 语音（沿用拍板：双形态可切换）

`ai.speech` 三档：

| 档 | 行为 |
|----|------|
| **off** | 静音，只出气泡 |
| **purr（默认）** | 喵语节奏：每段**首句**一声轻喵，长段（≥4 句）在中间再加 1 声；受现有 MIN_GAP 1200ms 自然限流，绝不逐句连叫 |
| **tts** | 系统 `speechSynthesis` 朗读整段（`ai.speechRate` 80–140%）；按句排队，与气泡同步；开头仍保留一声轻喵作「开口提示」 |

TTS 在阶段 3 实测 zh-CN 语音；不可用时该选项自动灰掉并提示去 Windows 设置添加，**不会让功能落空**。
云端 / 猫娘音 TTS 本期不做，只预留 `voice.js` 的接口位。

---

## 6. 设置项（schema 第 9 组 `ai`，**12 项**，CONFIG_VERSION 5→6）

| 键 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `enabled` | switch | **false** | 总开关（拍板：默认关；关掉后菜单 5 项变灰） |
| `preset` | select | `zhipu` | zhipu / siliconflow / modelscope / dashscope / ark / deepseek / moonshot / ollama / custom |
| `baseUrl` | text | `https://open.bigmodel.cn/api/paas/v4` | 选预设自动填 |
| `model` | text | `glm-4-flash` | 同上 |
| `apiKey` | **password** | `''` | 掩码显示，存 ai-secret.bin |
| `testConn` | **action** | — | 「测试连接」按钮 + 结果回显 |
| `dailyLimit` | range 20–300 step 20 | `60` | 每日自动播报上限 |
| `autoTalk` | select | `normal` | off / rare(15–30min) / normal(6–15min) / often(3–8min) |
| `speech` | select | `purr` | off / purr / tts |
| `speechRate` | range 80–140 step 10 | `100` | 仅 tts 有效（`requires:'speech'`） |
| `bubblePace` | select | `normal` | 句子停留节奏 fast×0.75 / normal×1 / slow×1.35 |
| `affectPet` | switch | `true` | 每次讲完心情 +1（10min 冷却，日上限 20） |

`settings.js` 新增 `t:'password'`（掩码+眼睛）与 `t:'action'`（按钮+结果区）两种通用控件（约 45 行），保持"改设置只改 schema"。

**已删项**（v2 → v3）：`temperature`、`maxTokens`（内置固定）、`sharePetState`（始终注入）、`autoHint`（无互动）、`contextTurns`（无对话）。

---

## 7. IPC 与文件清单

### IPC（preload 新增）

```js
aiTell(category)   → invoke 'ai-tell'   // category: joke|story|poem|riddle|fact|idle
aiAbort()          → invoke 'ai-abort'  // 换话题/交互打断时取消进行中的流
aiTest()           → invoke 'ai-test'
aiSetKey(k) / aiClearKey() / aiHasKey()
aiClearRecent()    → invoke 'ai-clear-recent'
onAiSay(cb)        // { text, voiceKey, verse, last }
onAiBusy(cb)       // { busy, category }
onAiNotice(cb)     // { code, message }   错误一次性气泡
```

### 文件

| 文件 | 动作 | 说明 |
|------|------|------|
| `engine/ai-talk.js` | 新建 | 类别提示词 / SSE 解析 / 切句 / 限流 / 去重（纯逻辑，test_logic 可加载） |
| `engine/ai-fallback.js` | 新建 | 离线语料：笑话 24 / 故事 8 / 诗 12 / 谜语 16 / 冷知识 30 / 观察 20 |
| `engine/ai-secret.js` | 新建 | safeStorage 加解密 + 掩码 |
| `main.js` | 改 | IPC 7 个、菜单/托盘 +5 项、自主调度计时器、属性联动结算 |
| `preload.js` | 改 | 上述 API |
| `renderer.js` | 改 | 句子队列、让路规则、onAiSay 接线、说话姿态 |
| `index.html` | 改 | 气泡 `.verse` 分行样式（约 12 行） |
| `engine/config-schema.js` | 改 | ai 组 12 项，CONFIG_VERSION 6 |
| `settings.js` | 改 | password / action 控件 |
| `engine/i18n.js` | 改 | 中英文案约 26 条 |
| `tools/test_logic.js` | 改 | 新增约 26 条断言（切句、队列、去重、限流、降级、schema、掩码） |
| `package.json` | 改 | 1.9.0 |

---

## 8. 阶段与验收

| 阶段 | 内容 | 验收标准 | 需 Key |
|------|------|----------|--------|
| **S1 骨架+离线** | 句子队列、菜单 5 项、schema ai 组、离线语料、让路规则 | 无 Key 可用：点「讲个笑话」逐句冒泡并自然收尾；抚摸能立刻打断；`test_logic` 全绿 | ❌ |
| **S2 接模型** | `engine/ai-client.js`（OpenAI 兼容 SSE 流式、错误分类、提示词构建）＋ 主进程队列播放器 + 降级 + 连接测试 + 首句超时 8s | mock 端到端：模型内容逐句冒泡；断网/超时/空响应自动降级离线；`test_logic` 281 断言全绿 | ✅（真实 Key 待用户验收） |
| **S3 语音** | 喵语节奏 + TTS 实测 | 首句一声喵、不机关枪；TTS 与气泡对齐；不可用自动灰掉 | ✅ |
| **S4 自主调度** | 空闲计时、时段降频、去重、属性联动、记录清空 | 静置到点自己开口；3 天内不重复；摸它就停 | ✅ |
| **S5 打包** | 回归 + v1.9.0 | 断言 ≥ 207 全绿；asar 核对；双产物实机启动 | — |

---

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| Key 泄漏 | 独立加密文件，不进 config.json，UI 只显掩码 |
| 费用失控 | 内置 maxTokens（按类型 160/320）、每日上限、30s 超时、句数硬截断 |
| 内容跑偏 | system prompt 硬约束 + 前后关键词过滤 + 离线兜底；不涉政治/医疗/投资 |
| **自言自语变成刷屏** | 每段 2–8 句硬上限 + 队列上限 8 + 讲完即停 + 最短间隔 3min |
| **重复讲同一个笑话** | 最近 20 条 hash + 同类标题注入，3 天窗口 |
| **打扰用户** | 无交互 3min 才触发；任何交互立即停；深夜降频；默认总开关关 |
| TTS 不可用 | 默认喵语；TTS 探测失败自动灰掉 |
| 无 Key 时功能空转 | 离线语料 110 条覆盖 6 类，永久可用 |

---

## 10. 拍板记录

1. 语音：双形态可切换，默认喵语 ✅
2. 默认预设：智谱 GLM-4-Flash（v7 起；v6 及以前为 DeepSeek，未启用且仍是旧默认值的配置会自动跟随） ✅
3. ~~独立聊天窗~~ → ~~纯气泡 + 说话条~~ → **v3：无任何输入通道，纯自言自语** ✅
4. 属性联动：允许（讲完心情 +1，10min 冷却，日上限 20）✅
5. 记录：保留最近 20 条（仅用于去重，本地文件，可清空）✅
6. 默认开关：关 ✅
