# 04 · 设置与配置

## 一、schema 是唯一来源

`engine/config-schema.js` 一份文件同时承担：字段定义、默认值、校验夹紧、补丁合并、版本迁移、变更比对。设置页**不硬编码任何设置项**——界面上的分组、控件类型、取值范围、默认值、生效徽标全部从 schema 生成，所以"加一个设置项"通常只改这一个文件。

```js
GROUPS   // 9 个分组：{ id, zh, en, items: [...] }
ITEMS    // 扁平索引：{ [key]: item }（按 key 反查所属分组）
defaults()        // 从 schema 生成默认配置
coerce(k, v)      // 单字段类型转换 + 夹紧 / 非法枚举回退默认
normalize(cfg)    // 全量规范化，返回 { config, issues }
mergePatch(cfg, patch)   // 深合并补丁（仅覆盖出现的键）
changedPaths(a, b)       // 变更的 'group.key' 路径列表（广播用）
load(raw)         // 版本识别 + 迁移链 + normalize
```

### 字段能带什么

| 字段 | 含义 |
|---|---|
| `k` / `t` / `d` | 键名 / 控件类型 / 默认值 |
| `min` `max` `step` `opts` | 数值范围与枚举选项 |
| `fmt` | 显示格式：`pct`（整数百分比）、`pctRef`（相对 `ref` 的百分比）、`ms` / `sec` / `secLong` / `min`、`times`（N 次/分） |
| `badge` / `sec` | 生效徽标：`restart`（重启后生效）、`login`（下次登录生效） |
| `requires` / `requiresIn` | 依赖某开关为真（或取到某个值）才可用；`requiresIn` 用于"仅 tts 生效"这类 |
| `blockedBy` | 被某开关为真时**禁用**（语义与 `requires` 相反，别混用） |
| `ro` | 只读展示项 |
| `max`（text） | 最大字符数 |
| `zh` / `en`、`hzh` / `hen`、`nzh` / `nen` | 名称、说明、开关旁注（中英） |
| `act` | 动作按钮的 IPC 动作名（不产生配置字段） |

**控件类型**：`switch` / `select` / `range` / `text` / `password` / `date` / `path` / `action`。

### 两条容易踩的规则

1. **`select` 数值越界回退默认值，不夹紧**；`range` 才夹紧到边界。
2. **界面固定中文**：`defaults()` / `normalize()` 强制 `appear.language = 'zh-CN'`，设置页里 `lang` 是常量；i18n 仍保留英文词条（用于托盘/菜单的兼容路径），但不提供切换项。

---

## 二、设置项清单（9 组 56 项）

### 宠物（4）

| 设置项 | 键 | 控件 | 范围 / 默认 |
|---|---|---|---|
| 宠物名字 | `petName` | text | 1–12 字符，默认「小银」；禁控制字符、去首尾空白 |
| 主人称呼 | `ownerName` | text | 0–8 字符，默认「主人」；留空用通用称呼 |
| 体型大小 | `size` | range | 0.176–0.88，步长 0.044，默认 0.88（显示 20%–100%） |
| 宠物出生日期 | `birthday` | date | 默认空；不允许未来日期 |

### 启动与运行（3）

| 设置项 | 键 | 控件 | 默认 / 生效 |
|---|---|---|---|
| 开机自启动 | `autoStart` | switch | 关，**下次登录生效** |
| 静默启动 | `startHidden` | switch | 开，重启生效 |
| 记住窗口位置 | `rememberPosition` | switch | 开，即时 |

### 交互（5）

| 设置项 | 键 | 控件 | 默认 |
|---|---|---|---|
| 点击穿透 | `clickThrough` | switch | 关 |
| 滚轮缩放 | `wheelZoom` | switch | 开 |
| 呼喊快捷键 | `hotkeyCall` | select | `Ctrl+Shift+C`（另有 Ctrl+Alt+C / Alt+Shift+C / 无） |
| 双击托盘呼喊 | `trayDoubleClickCall` | switch | 开 |
| 限制活动区域 | `keepOnScreen` | switch | 开 |

### 声音与通知（8）

| 设置项 | 键 | 控件 | 范围 / 默认 |
|---|---|---|---|
| 静音 | `muted` | switch | 关 |
| 音量 | `volume` | range | 0–100 步 5，默认 70（静音时禁用） |
| 喵叫声 | `voice` | switch | 开 |
| 叫声音量 | `voiceVolume` | range | 0–100 步 5，默认 100（依赖 `voice`） |
| 气泡提示 | `bubbles` | switch | 开 |
| 气泡停留时长 | `bubbleDuration` | range | 1200–6000 ms 步 200，默认 2200（气泡关闭时禁用） |
| 系统通知 | `notifications` | switch | 关 |
| 通知最短间隔 | `notifyInterval` | range | 5–120 分钟步 5，默认 30（依赖 `notifications`） |

### 外观与主题（8）

| 设置项 | 键 | 控件 | 范围 / 默认 |
|---|---|---|---|
| 主题 | `theme` | select | light / dark / auto |
| 界面文字缩放 | `uiScale` | range | 80–140% 步 10，默认 100 |
| 整体不透明度 | `opacity` | range | 40–100% 步 5，默认 100 |
| 显示地面阴影 | `showShadow` | switch | 开 |
| 显示粒子特效 | `showParticles` | switch | 开 |
| 减少动态效果 | `reduceMotion` | switch | 关 |
| 状态面板 | `statusPanel` | switch | 开 |
| 年龄显示精度 | `agePrecision` | select | day / month |

### 行为与活动（7）

| 设置项 | 键 | 控件 | 范围 / 默认 |
|---|---|---|---|
| 活跃度 | `activityLevel` | select | low / normal / high |
| 动作速度 | `animSpeed` | range | 20–100% 步 5，默认 75 |
| 主动呼喊间隔 | `callInterval` | range | 30–300 秒步 15，默认 75 |
| 眨眼频率 | `blinkRate` | range | 0–30 次/分步 1，默认 8（0 = 不眨眼） |
| 趴睡倾向 | `restiness` | range | 0–100% 步 10，默认 70 |
| 状态驱动气泡与行为 | `needVoice` | switch | 开 |
| 提醒灵敏度 | `needSensitivity` | select | relaxed / standard / strict（依赖 `needVoice`） |

### 状态与成长（5）

每项独立下拉「每 30 分钟下降点数」（0–20，0 = 不下降）：

| 设置项 | 键 | 默认 |
|---|---|---|
| 饱食下降点数 | `decayHunger` | 20 |
| 体力下降点数 | `decayEnergy` | 20 |
| 心情下降点数 | `decayHappiness` | 5 |
| 清洁下降点数 | `decayCleanliness` | 20 |
| 好感下降点数 | `decayAffinity` | 3 |

### AI 自言自语（11）

| 设置项 | 键 | 控件 | 默认 |
|---|---|---|---|
| 启用 AI 自言自语 | `enabled` | switch | **关** |
| 模型服务 | `preset` | select | zhipu（另含 siliconflow / modelscope / dashscope / ark / deepseek / moonshot / ollama / custom） |
| 接口地址 | `baseUrl` | text | `https://open.bigmodel.cn/api/paas/v4` |
| 模型名称 | `model` | text | `glm-4-flash` |
| API Key | `apiKey` | password | 空（加密存 `ai-secret.bin`，只显掩码） |
| 连接测试 | `testConn` | action | — |
| 现在讲一段 | `sayNow` | action | —（唯一手动入口） |
| 自主频率 | `autoTalk` | select | normal（off / rare / normal / often） |
| 说话的声音 | `speech` | select | purr（off / purr / tts） |
| 朗读语速 | `speechRate` | range | 80–140% 步 10，默认 100（仅 tts 生效） |
| 句子节奏 | `bubblePace` | select | normal（fast ×0.75 / normal ×1 / slow ×1.35） |

### 数据与存储（5）

| 设置项 | 键 | 控件 | 默认 / 生效 |
|---|---|---|---|
| 数据存储位置 | `dataDir` | path | 空 = 系统 userData，**重启生效** |
| 自动保存进度 | `autoSave` | switch | 开 |
| 保存间隔 | `saveInterval` | range | 5–120 秒步 5，默认 5（依赖 `autoSave`） |
| 自动备份 | `autoBackup` | switch | 开 |
| 备份保留份数 | `backupKeep` | select | 3（1 / 2 / 3 / 5 / 10，依赖 `autoBackup`） |

**动作按钮**（不产生字段）：浏览/打开数据目录、导出配置、导入配置（校验 + 确认后应用）、迁移并重启、恢复默认设置（可勾选「保留宠物名字」，固定在底栏）。

**1.0.0 已下线**（旧文档与旧配置里还会看到，属正常）：`language`、`showNameInBubble`、`singleInstance`、`closePanelOnBlur`、`showBubbles`、`allowSleep` / `allowRun` / `allowBath`、`ai.dailyLimit`、`ai.affectPet`。

---

## 三、生效时机

| 类别 | 覆盖项 | UI 表现 |
|---|---|---|
| **即时** | 其余全部 | 改动立刻反映到宠物窗口，无提示 |
| **重启** | `dataDir`、`startHidden` | 琥珀色徽标 + 底栏「有 N 项需重启后生效」 |
| **下次登录** | `autoStart` | 蓝色徽标；勾选状态即时可见 |

即时生效的链路：设置页 `saveConfig(patch)` → 主进程合并写盘 → 广播 `config-changed`（含变更键路径）→ 宠物窗 `applyConfig()` 逐项应用。所以新加一个设置项，只要在 `applyConfig` 里接一行，就自动具备"实时生效"。

---

## 四、持久化

**位置**：`%APPDATA%/cat-desktop-pet/config.json`（默认）。真实目录由固定位置的 `bootstrap.json` 引导（始终在系统 userData），避免"配置文件在哪由配置文件决定"的循环依赖。

| 场景 | 写盘策略 |
|---|---|
| 离散项（开关 / 下拉 / 文本框失焦） | 立即写 |
| 滑杆拖动 | 300ms 防抖，松手立即写 |
| 窗口位置 | 400ms 防抖 |
| 属性 `stats` | 按 `saveInterval` 节流（面板可见 0.25s / 关闭 1s 推送，落盘按间隔） |
| 设置窗关闭 / 应用退出 | 强制 flush |

**原子写**：先写 `config.json.tmp` → fsync → rename 覆盖，避免断电或被强杀时留下半截 JSON。**写队列**串行化（主进程单定时器），杜绝两个窗口同时写造成内容交错。**滚动备份**：每次覆盖前复制为 `backup/config-<时间戳>.json`，保留 `backupKeep` 份。

**读取容错**（顺序执行）：

1. 读 `bootstrap.json` 定目录；目录不可用则回退默认并记日志；
2. `config.json` 解析失败 → 另存 `config.corrupt-<时间戳>.json`，用默认值启动（**不静默丢数据**）；
3. schema 逐字段 `coerce`：类型转换、超范围夹紧、非法枚举回退默认；
4. 版本迁移（见下）；
5. 未知字段原样保留，向前兼容。

---

## 五、迁移链

`load()` 按 `configVersion` 分派，迁移后统一 `normalize`。当前 `CONFIG_VERSION = 11`。

| 迁移 | 处理内容 |
|---|---|
| v1 → v2 | 扁平结构 → 分组嵌套（旧 `size/stats/x/y` 搬入新分组） |
| v2 → v3 | 宠物窗 480×480 → 640×640；坐标按锚点差平移（x −80、y −186），猫的屏幕位置不变 |
| v3 → v6 | 仅新增字段，`normalize` 从默认值出发自动补齐 |
| v6 → v7 | AI 默认服务 DeepSeek → 智谱 GLM-4-Flash。**只跟随"从没启用过 + 仍是旧默认值"的配置**，绝不覆盖用户选择或已填的 Key |
| v7 → v8 | 状态与成长：5 条百分比滑杆 → 两个下拉框（每 N 分钟降 M 点）；旧倍率按 20 点基准换算，0% 保留"不下降"，100% 直接落新默认 |
| v8 → v9 | 界面语言项下线；动作速度默认 85 → 75（只跟随旧默认值）；AI 自主频率整体提前 |
| v9 → v10 | 状态与成长改为**每属性独立**（`decayHunger/Energy/Happiness/Cleanliness/Affinity`）；同时清除 9 个下线键 |
| v10 → v11 | 好感默认 20 → 3（只收敛历史默认值 20 / 5，自定值与 0 保留） |

**迁移三条铁律**：

1. **只收敛"旧默认值"**，用户自定值一律保留（判断依据是"是否等于旧默认"，不是"是否合法"）；
2. **缺席键按旧默认值处理**，不能当 0（曾因 `Number(undefined) = NaN` 被当作 0，把整组衰减值收敛成 0）；
3. 新版本必须同时补 `load()` 分支与 `test_logic.js` 迁移用例，两个都过才算完成。

---

## 六、设置窗 UI 规格

可交互原型：`ui/settings-ui-prototype.html`（单文件，双击即开；原型尺寸比正式窗口大 1.16 倍便于阅读，比例一致）。

### 窗口与栅格

| 项 | 值 |
|---|---|
| 窗口 | **620 × 580**，固定不可缩放；标准系统标题栏（高 36px）；可最小化；非置顶、非模态、不在任务栏之外另立窗口 |
| 左侧导航 | 宽 136px，9 个分组 + 「关于」 |
| 内容区 | 内边距 16px 18px |
| 底部操作条 | 高 52px |
| 行栅格 | 标签列 104px + 控件列自适应，列间距 10px；行内边距 9px 0；行间 1px 分隔线 |
| 分组头 | 组名 15px/500 + 一句话说明 12.5px（次级色），下方 14px 留白 |

导航当前组用「淡主色底 + 主色文字 + 500 字重」标识；「关于」是伪分组（不计入 9 组统计），内容为版本号 + 一句话应用简介。

### 色彩 token

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `bg-window` | `#ffffff` | `#252527` | 窗口主体 |
| `bg-chrome` | `#f7f8fa` / `#fafbfc` | `#202022` | 标题栏、导航、底栏 |
| `border` | `#e5e7eb` / `#d5d9e0` | `#3a3a3c` / `#46464a` | 分隔线、控件描边 |
| `text-primary` | `#1d1d1f` | `#f2f2f7` | 标题、正文 |
| `text-secondary` | `#4a4f57` | `#c9c9ce` | 行标签 |
| `text-muted` | `#8a8f98` | `#9a9a9f` | 说明、单位值 |
| `accent` | `#4a7fd4` | `#4a7fd4` | 焦点、选中、主按钮 |
| `accent-soft` | `#e8f0fd` | `#2f4a6e` | 导航选中底 |
| `warn-bg` / `warn-fg` | `#fff3e0` / `#a86400` | `#3d2f16` / `#ffc46b` | 重启徽标与提示条 |
| `info-bg` / `info-fg` | `#e8f0fd` / `#2f6bd0` | `#253a56` / `#a8caf5` | 下次登录徽标 |
| `danger` | `#c0392b` | `#ff8072` | 校验错误、恢复默认 |
| `ok` | `#2e8b57` | 同浅色 | 保存成功反馈 |

### 字体

分组标题 15px/500；行标签、正文、按钮 13px/400；辅助说明与单位值 12px/400；徽标 11.5px；窗口标题 13px/500。字体栈 `"PingFang SC", "Microsoft YaHei", system-ui, sans-serif`；数值列 `font-variant-numeric: tabular-nums`，滑杆拖动时数字不跳动。

### 控件

| 控件 | 规格 |
|---|---|
| 文本框 | 高 28px，圆角 7px，内边距 5px 9px；聚焦主色描边 + 3px 半透明焦点环 |
| 下拉框 | 同文本框，最大宽 210px |
| 滑杆 | 原生 range + `accent-color`；右端固定 66px 单位值（右对齐），拖动实时刷新 |
| 开关 | 15×15px 主色复选，右侧 12px 旁注，整行可点 |
| 次级按钮 | 白底 + 1px 描边，圆角 7px |
| 主按钮（应用） | 主色底白字；**无改动时禁用**（α 0.5） |
| 徽标 | 高 20px 胶囊，11.5px，两种语义色 |
| 只读展示 | 灰底 + 次级文字色 |

### 状态

| 状态 | 表现 |
|---|---|
| hover | 控件底色微深；按钮底色 `#f4f6f9` |
| focus | 主色描边 + 3px 焦点环（键盘与鼠标一致） |
| 禁用 | 整体 α 0.5 + `cursor: default`；用于 `blockedBy` / `requires` 未满足的项 |
| 校验错误 | 红描边 + 红字说明，**同时拦截写入**（非法值不进配置） |
| 脏值 | 底栏出现「● N 项未保存的更改」，「应用 / 取消」转为可用 |
| 待重启 | 底栏琥珀色「有 N 项需重启后生效」 |
| 保存成功 | 底栏绿色短反馈（2.6s）+ 顶部 toast；「应用」按钮 1.4s 瞬态「✓ 已应用」 |

### 交互语义

1. **改动即预览**：即时项在控件上改动的同时生效；
2. **应用 = 落盘**并清脏值；
3. **取消**：始终可点。有改动 → 确认后**回滚到打开窗口时的快照并关窗**（瞬态「✓ 已取消」）；无改动 → 直接关窗；
4. **关闭（×/Esc）**：有未保存改动 → 弹确认「放弃 N 项未保存的更改？」，确认后丢弃并关窗（**不会**默默替你保存）；
5. **恢复默认**：底栏左端危险色按钮，二次确认 + 可勾选「保留宠物名字」；
6. **联动禁用**由 schema 的 `blockedBy` / `requires` 描述，不写在界面代码里；
7. **命名联动**：改宠物名字即时更新窗口标题与含 `{name}` 的说明文案；
8. **Esc**：浮层打开时只关浮层，不关窗口。

### 可访问性

Tab 顺序为「导航 → 逐行控件 → 底栏按钮」；开关空格切换、滑杆 ←/→ 按步长、Home/End 到边界、下拉 ↑/↓ 选择；正文对比度 ≥ 4.5:1、辅助文字 ≥ 3:1；「减少动态效果」开启后本窗口过渡动画一并关闭。

### schema → 控件映射

| `t` | 控件 | 附加能力 |
|---|---|---|
| `text` | 文本框 | `max` 截断、控制字符过滤、`allowEmpty` |
| `password` | 掩码框 + 显隐 | 值不回显原文 |
| `switch` | 复选 + 旁注 | `ro`、`blockedBy` / `requires` |
| `range` | 滑杆 + 单位值 | `min/max/step`、`fmt` |
| `select` | 下拉 | `opts`（双语标签） |
| `date` | 日期选择 | 不允许未来 |
| `path` | 只读路径 + 按钮 | `badge`、行内动作 |
| `action` | 按钮 + 结果区 | 无字段，点即执行 |

---

## 七、已知约束

- **单例**：设置窗全局只有一个，重复打开只 `show() + focus()`，不新建。
- **数据目录不可在配置里自指**：切换目录时先把数据复制到新目录再切换，失败自动回滚且不删源数据。
- **导入配置**只读系统文件对话框选中的路径（不接收渲染进程传来的任意路径），避免路径穿越。
- **系统通知不可用**（`Notification.isSupported() === false`）时该项自动禁用并提示。
