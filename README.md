# 桌面宠物 CatDesktopPet

Q 版长毛银渐层桌面宠物（Electron + Canvas 2D）—— 类 QQ 宠物的桌面陪伴程序：透明无边框置顶窗口，会自己散步、趴睡、摇尾巴、撒娇，也可以抚摸 / 喂食 / 逗玩 / 呼喊 / 洗澡，还会按状态冒台词、发喵叫、自言自语。

- **15 姿态 52 张帧图**动画，帧间交叉淡化 + 随机眨眼（频率可调）
- **五项属性**：心情 / 饱食 / 体力 / 清洁 / 好感；前四项按分档阈值实时改变台词与行为倾向
- **12 情境喵叫**（15 条 CC0 真猫录音，统一柔化音色）+ 呼噜铺底音轨
- **AI 自言自语**：单向播报笑话 / 故事 / 诗 / 谜语 / 冷知识，无 Key 自动降级内置语料
- **9 组 56 项设置**，由 schema 单一来源驱动，改动即时生效
- 用户数据与程序分离，替换 exe 不丢配置；支持开机自启、静默驻留、点击穿透、状态面板

完整使用说明见 [`app/README.md`](app/README.md)。

## 下载安装

前往 [Releases](https://github.com/AliChen118/cat-pet/releases) 下载对应平台的产物：

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows | `CatDesktopPet-Portable-<版本>.exe` | 便携版：单文件免安装，双击即用 |
| Windows | `CatDesktopPet-Setup-<版本>.exe` | 安装版：标准安装向导，可自选安装目录，显示进度与完成页（附桌面 / 开始菜单快捷方式） |
| Linux | `CatDesktopPet-<版本>-x86_64.AppImage` | AppImage：`chmod +x` 后直接运行 |
| 源码 | `CatDesktopPet-<版本>-source.zip` / `.tar.gz` | 与发布版本对应的源码包 |

## 版本记录

| 版本 | 变更 |
|---|---|
| **1.2.0** | 修复「气泡正在显示时拖拽 / 抚摸等交互后，气泡长时间不消失」：`interruptAi()` 过去只 `clearTimeout` 而没摘掉 `.show`，现统一走 `hideBubble()` 收尾，并加 20 s 看门狗兜底（详见 [`docs/06-ai.md`](docs/06-ai.md) 4.1） |
| 1.1.10 | 15 个姿态的素材尺寸一次性统一（内容底边全部 469、横向质心极差 ≤0.8 px、面积 93–113%）；`NO_FRAME_BLEND` 扩到 10 个姿态消除帧间残影；`POSE_SCALE` 清空、比例全部烘焙进素材；阴影随姿态缩放（详见 [`docs/02-animation.md`](docs/02-animation.md)） |
| 1.1.9 | 安装版改标准向导：可自定义安装目录、显示安装进度与完成页 |

## 文档

| 文档 | 内容 |
|---|---|
| [`app/README.md`](app/README.md) | **使用说明**：交互、体型、属性、洗澡、状态面板、AI、设置项、素材管线、已知限制 |
| [`docs/README.md`](docs/README.md) | **文档索引**：规格分册导读、现行事实速查、文档约定 |
| [`docs/01-architecture.md`](docs/01-architecture.md) | 技术选型、进程与窗口模型、IPC 全貌、目录结构、全局约束 |
| [`docs/02-animation.md`](docs/02-animation.md) | 素材规格、帧表、插值与眨眼、体型与形体平滑、气泡/阴影几何 |
| [`docs/03-behavior.md`](docs/03-behavior.md) | 状态机、属性衰减、交互结算、分档阈值、权重乘子、P1–P10 仲裁 |
| [`docs/04-settings.md`](docs/04-settings.md) | schema 机制、56 项清单、生效时机、持久化与迁移链、设置窗 UI 规格 |
| [`docs/05-audio.md`](docs/05-audio.md) | 语音分层、12 情境 SPEC、素材来源与授权、音色处理链 |
| [`docs/06-ai.md`](docs/06-ai.md) | 自言自语形态、内容规格、模型接入与降级、去重与密钥 |
| [`docs/07-engineering.md`](docs/07-engineering.md) | 构建打包、asar 校验、测试体系、验证手法、历史坑清单 |
| [`docs/08-update.md`](docs/08-update.md) | 版本更新**方案**（发布侧清单与命名、客户端检查/下载/校验/替换；尚未实现） |
| [`docs/history/`](docs/history/README.md) | 各阶段方案原稿（含已放弃的路线，仅作追溯） |

## 目录结构

```
桌面宠物/
├── app/                        应用源码（构建输入，目录层级不可随意变动）
│   ├── engine/                 状态机、动画、属性模型、配置 schema、i18n、语音、AI 自言自语
│   ├── assets/                 运行期素材（sprites/frames、audio/meow、tray 图标）
│   ├── build/                  打包资源（icon.ico / icon.png）
│   └── main.js …               主进程与各渲染窗口入口
├── assets-src/                 素材源（不打包，部分入库）
│   ├── raw/                    AI 生成原图：poses / frames / actions / generated
│   ├── sprites-poses/          抠图归一化后的单姿态成片（rebuild_sprites.py 产物）
│   ├── audio-raw/              抓取的原始叫声与呼噜录音（CC0）
│   ├── previews/               试听页、抠图对比页、循环展开图（工具按需再生，平时为空）
│   └── style-options/          早期风格候选图（归档）
├── docs/                       规格与决策文档（README.md 为索引，history/ 为方案原稿）
├── tools/                      辅助脚本（按用途分层）
│   ├── _root.py                仓库根定位（子目录脚本共用）
│   ├── check/                  回归与校验：test_logic.js、verify_asar.js
│   ├── probe/                  实机探针：打包版/走跑/摇尾巴/抚摸/眨眼/取色
│   ├── sprites/                素材管线：抠图、归一化、接缝审计、预览
│   ├── audio/                  音频管线：抓取、导入、音色分析、报告生成
│   └── legacy/                 一次性历史脚本（洋红底修复等，只读留存）
├── design/                     设计稿与验收图（preview/ 演示图、checks/ 对比图）
├── dist/                       构建产物（electron-builder 输出，不入库）
├── archive/                    本地归档（不入库）：shots/ 截图、audio-history/ 音频报表
└── .github/workflows/          CI 构建与发布流水线
```

## 从源码构建

依赖：Node.js ≥ 20（开发使用 22）、npm。

```bash
git clone <仓库地址>
cd CatDesktopPet/app

npm ci            # 安装依赖（含 Electron 31）
npm start         # 开发运行
npm test          # 逻辑回归（tools/check/test_logic.js，452 条断言）

npm run dist:win      # Windows：便携版 + NSIS 安装版
npm run dist:linux    # Linux：AppImage
```

构建产物输出到仓库根目录 `dist/`（由 `app/package.json` 的 `build.directories.output` 指定）。

打包前请先关闭正在运行的宠物（否则产物 exe 被占用，构建会一直等待解锁），并且**打包期间不要修改 `app/` 下任何文件**——详情见 [`docs/07-engineering.md`](docs/07-engineering.md)。

## CI/CD（GitHub Actions）

工作流：[`.github/workflows/build.yml`](.github/workflows/build.yml)

| 触发方式 | 行为 |
|---|---|
| 推送 `v*` 标签（如 `v1.0.0`） | 测试 → Windows / Linux 构建 → 源码打包 → 自动创建 Release 并附全部产物 |
| 手动触发（workflow_dispatch） | 测试 → 构建 → 源码打包，产物在运行页的 Artifacts 区下载 |

流水线五个任务：`test`（Node 22 跑逻辑回归）、`build-windows`（Portable + Setup，缓存 Electron 下载）、`build-linux`（AppImage）、`package-source`（`git archive` 生成 zip/tar.gz）、`release`（仅标签触发，创建 Release）。

发布新版本的标准流程：

```bash
# 创建tag
git tag -a v1.0.0 -m "release v1.0.0"

# 推送单个tag
git push origin v1.0.0

# 一次性推送所有本地tag（谨慎使用）
git push origin --tags
```

## 路径约定

- 应用只读取 `app/assets/` 下的素材；`assets-src/` 不参与打包，仅供再生成。
- 素材重跑：`python tools/sprites/rebuild_sprites.py`（原图 → 抠图 → 归一化，单姿态成片落 `assets-src/sprites-poses/`，`drag.png` 同步进 `app/assets/sprites/`）。
- 姿态统一：`python tools/sprites/fix_pose_frames.py`（一次性把 52 帧的尺度/横向对位/落地基线统一，可 `--dry` 预演、`--restore` 回滚）。
- 改完素材必跑：`python tools/sprites/sprite_bounds.py`（重算 `CONTENT_TOP_FALLBACK` 与 `POSE_SHADOW_K` 两张表 + 横向余量校验）、`python tools/check/pose_iou.py`（校验 `NO_FRAME_BLEND` 是否与实测 IoU 一致）。
- 叫声重跑：`python tools/audio/import_voice_sfx.py`（切片 → 音色 → 响度归一 → OGG，参数表驱动）。

## 许可证

MIT（见 `app/package.json`）。第三方音效授权登记见 [`app/assets/audio/CREDITS.md`](app/assets/audio/CREDITS.md)（其中 `Cat SFX` / `cat pickup effect` 为 CC-BY，需署名）。
