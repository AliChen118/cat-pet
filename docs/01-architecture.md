# 01 · 架构总览

## 一、定位与范围

一款 Windows 桌面陪伴程序（类 QQ 宠物）：透明无边框置顶窗口里住着一只 Q 版长毛银渐层，可抚摸 / 喂食 / 逗玩 / 呼喊 / 洗澡，无交互时自主行走、趴睡、摇尾、撒娇，并会按属性状态冒台词、自言自语、发出喵叫。

**范围边界**（明确不做）：账号与云同步、多宠物管理、皮肤包/插件系统、聊天式对话（AI 只单向自言自语）。

**平台**：Windows 10/11 为主；Linux（AppImage）由 CI 顺带构建，未经实机验收。

---

## 二、技术选型

| 维度 | 采用 | 理由 |
|---|---|---|
| 运行时 | **Electron 31** | 透明无边框窗、`alwaysOnTop`、托盘、`setLoginItemSettings` 原生支持最成熟；可打包为独立 exe |
| 渲染 | **HTML5 Canvas 2D** | 帧动画 + 粒子 + 程序化微动足够，无需 WebGL；调试成本低 |
| 状态管理 | **自写有限状态机**（`engine/fsm.js`） | 15 个状态、规则集中，引入 Redux 类库反而增加间接层 |
| 配置 | **自写 schema + 文件持久化** | 需要"单一来源驱动 UI"与逐版迁移，通用库不满足 |
| 打包 | **electron-builder**（portable + NSIS 向导式） | 双产物、asar 归档、图标多尺寸生成；安装版走标准向导（可选安装目录） |
| 音频 | **Web Audio**（渲染进程） | 交互反馈要求 <100ms，放渲染进程免 IPC 往返 |

**兼容性开关（不可删）**：`disableHardwareAcceleration` + `--disable-gpu` / `--in-process-gpu` / `--no-sandbox`。部分 Windows 显卡驱动下透明窗口会黑底或撕裂，这几个开关是实机验证过的兜底。

---

## 三、运行架构

```
┌──────────────────────── 主进程 main.js ────────────────────────┐
│  配置真源 config（内存）· 写队列 · 原子写 · 迁移 · 备份          │
│  宠物窗口 / 设置窗口 / 状态面板窗口 · 托盘 · 全局快捷键          │
│  AI 生成（ai-client 流式）· 系统通知                            │
└───┬─────────────────┬──────────────────────┬──────────────────┘
    │ config-changed  │ stats-changed        │ ai-say / ai-busy
    │（广播，双向同步）│（0.25s 节流推送）     │（逐句下发）
    ▼                 ▼                      ▼
┌────────────┐  ┌──────────────┐  ┌──────────────────┐
│ 宠物窗口    │  │ 状态面板窗口  │  │ 设置窗口          │
│ renderer.js│  │status-panel.js│  │ settings.js       │
│ 状态机/物理 │  │ 只读展示      │  │ schema 驱动表单   │
│ /绘制/语音  │  │ + 互动按钮    │  │ 脏值快照/回滚     │
└────────────┘  └──────────────┘  └──────────────────┘
```

**两条真源原则**（历史上踩过坑，改动前必读）：

1. **配置真源在主进程。** 两个渲染窗口各持只读副本，只能提交补丁、通过 `config-changed` 接收更新——避免"两窗各改一半互相覆盖"。
2. **属性（`runtime.stats`）真源在宠物窗口。** 启动后属性只由渲染进程改写（衰减、结算都在渲染端逐帧发生），主进程只是持久化通道。因此运行期的任何 `config-changed` **不得**采纳主进程属性快照，否则会用过期值回滚刚结算的收益（表现为"喂完开了个面板，饱食度又掉回去"）。例外：冷启动（adopt）与显式 `statsReset`（导入/重置）才采纳主进程快照。

---

## 四、窗口与系统集成

| 窗口 | 尺寸 | 关键参数 | 职责 |
|---|---|---|---|
| 宠物窗 | 640×640 | `frame:false` `transparent:true` `alwaysOnTop:true` `skipTaskbar:true` `resizable:false` `movable:false` | 绘制猫、气泡、菜单、粒子；拖动经 IPC 让主进程移动窗口 |
| 设置窗 | 620×580 | 标准标题栏、非置顶、非模态、`resizable:false`、单例 | schema 驱动表单、脏值快照、导入导出、数据目录迁移 |
| 状态面板 | 212×496 | 无边框透明置顶、不可缩放 | 年龄/档位徽章/属性条/互动按钮，贴猫身左缘 |

- **窗口为什么 640×640**：需容纳最宽跨步姿态在 100% 体型下的完整身体，并按 `SPRITE_HALF_W = 253` 标定活动边界。窗口大但**动态穿透**（`setIgnoreMouseEvents(true,{forward:true})`），鼠标不在猫身/菜单/拖拽中时事件穿透到下层，不挡桌面操作。
- **托盘**：抚摸 / 喂食 / 逗玩 / 呼喊 / 静音 / 设置… / 退出。体型、自启动、点击穿透只在设置页（避免托盘菜单过长）。
- **全局快捷键**：默认 `Ctrl+Shift+C` 呼喊；被占用时注册失败但保留原设置并提示。
- **开机自启**：`app.setLoginItemSettings({openAtLogin, openAsHidden, path, args:['--autostart']})`，静默启动只驻留托盘。

---

## 五、IPC 通道

`preload.js` 只暴露下表的具名方法，不透传任意通道；渲染进程无 Node 权限（`contextIsolation:true`、`nodeIntegration:false`）。

| 方向 | 通道 | 用途 |
|---|---|---|
| 渲染→主 | `get-config` / `save-config` / `reset-config` | 读全量、提交补丁、恢复默认 |
| 渲染→主 | `get-meta` | 版本号、AI 用量、路径等只读元信息 |
| 渲染→主 | `open-settings` / `settings-close-request` / `settings-close-confirm` | 打开设置、关窗确认握手 |
| 渲染→主 | `export-config` / `import-config` | 导出/导入（导入先校验再确认） |
| 渲染→主 | `choose-data-dir` / `open-data-dir` / `migrate-data` / `restart-app` | 数据目录与重启 |
| 渲染→主 | `pet-action` / `notify` / `win-move` / `mouse-pass` / `quit` | 动作触发、系统通知、窗口位移、穿透接管、退出 |
| 渲染→主 | `stats-live` | 属性节流上报（面板可见 0.25s / 不可见 1s） |
| 渲染→主 | `ai-tell` / `ai-abort` / `ai-test` / `ai-set-key` / `ai-clear-key` / `ai-has-key` / `ai-clear-recent` | AI 生成与密钥 |
| 主→渲染 | `config-changed` | 全量配置 + 本次变更键路径（双向同步的依据） |
| 主→渲染 | `stats-changed` / `panel-side` / `screen-edge` | 面板数据、贴靠侧、屏幕边缘事件 |
| 主→渲染 | `ai-say` / `ai-busy` / `ai-done` | 逐句台词、忙闲、收尾 |

---

## 六、目录结构

```
桌面宠物/
├── app/                    应用源码（打包内容）
│   ├── main.js             主进程：窗口/托盘/自启/快捷键/配置持久化/AI 生成
│   ├── preload.js          contextBridge 桥接
│   ├── index.html          宠物窗口（Canvas + 菜单 + 气泡）
│   ├── renderer.js         状态机装配、物理、决策、交互、绘制、语音接线
│   ├── settings.html/js    设置窗口（schema 驱动表单）
│   ├── status-panel.html/js 状态面板
│   ├── engine/             纯逻辑模块（可被无头测试直接加载）
│   │   ├── core.js         缓动/插值/随机
│   │   ├── fsm.js          有限状态机
│   │   ├── animator.js     精灵加载、帧序列、交叉淡化、眨眼
│   │   ├── particles.js    粒子（爱心/Zzz/食物屑/星星/泡泡）
│   │   ├── fx.js           特效几何（洗澡泡泡、落地尘等）
│   │   ├── needs-profile.js 属性分档阈值 / 权重乘子 / 优先级（行为单一来源）
│   │   ├── config-schema.js 配置字段定义表（UI 单一来源）
│   │   ├── i18n.js         中英文案词条
│   │   ├── voice.js        语音 SPEC + 调度 + Web Audio 播放
│   │   ├── ai-talk.js      提示词/切句/队列
│   │   ├── ai-client.js    OpenAI 兼容 SSE 客户端 + 错误分类
│   │   ├── ai-fallback.js  离线语料
│   │   └── ai-secret.js    DPAPI 密钥加解密
│   ├── assets/             运行期素材（sprites / audio / tray 图标）
│   └── build/              打包资源（icon.ico / icon.png）
├── assets-src/             素材源与中间产物（不打包）：raw/（poses/frames/actions/generated）、sprites-poses/、audio-raw/、style-options/、previews/（工具按需再生）
├── docs/                   本文档目录
├── tools/                  辅助脚本，按用途分层
│   ├── _root.py            仓库根定位（各子目录脚本共用）
│   ├── check/              回归与校验（test_logic / verify_asar）
│   ├── probe/              实机探针（打包版 / 走跑 / 摇尾巴 / 抚摸 / 眨眼 / 取色）
│   ├── sprites/            素材管线（抠图 / 归一化 / 接缝审计 / 预览）
│   ├── audio/              音频管线（抓取 / 导入 / 音色 / 报告）
│   └── legacy/             一次性历史脚本（magenta_audit.py / diag_target_pc.bat，只读留存）
├── design/                 设计稿与验收图（preview/ 演示图、checks/ 对比图）
├── dist/                   构建产物（electron-builder 输出）
├── archive/                本地归档（shots/ 截图、audio-history/ 音频报表、deletion-manifest 删除台账，不入库）
└── .github/workflows/      CI：测试 → 构建 → 源码打包 → Release
```

---

## 七、全局工程约束

| 约束 | 说明 |
|---|---|
| `SPRITE_HALF_W = 253` | 出现在 `renderer.js` / `main.js` / `tools/sprites/sprite_bounds.py` **三处**，改素材宽度必须同步 |
| 窗口与地面基线 | 精灵底边在 `y=470`、地面线 `GROUND=588`；气泡与特效几何一律由实测 `contentTop()` 推导，禁用绝对像素 |
| 环境变量 | 从命令行跑 Electron/打包前必须 `env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS`，否则进程被当作纯 Node 运行、无窗口 |
| 中文路径 | `@electron/asar`、部分 `loadFile` 场景对中文路径不稳；离线验证一律复制到 ASCII 临时目录 |
| 打包输出 | 由 `app/package.json` 的 `build.directories.output = "../dist"` 指定，产物不落在源码目录 |
| 素材不入包 | `assets-src/` 仅供再生成；运行期只读 `app/assets/` |
