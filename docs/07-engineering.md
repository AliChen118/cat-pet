# 07 · 工程与验证

## 一、命令

```bash
cd app
npm ci            # 安装依赖（含 Electron 31）
npm start         # 开发运行
npm test          # 逻辑回归（= node ../tools/check/test_logic.js，444 断言）
npm run dist:win      # Windows：portable + nsis
npm run dist:portable # 只出便携版
npm run dist:linux    # Linux：AppImage
```

**打包前必做**：关闭正在运行的宠物。否则 `dist/CatDesktopPet-Portable-*.exe` 被占用，electron-builder 会一直打印 `output file is locked for writing => waiting for unlock…` 并挂起（曾空等 10 分钟）。

**打包期间禁止改 `app/` 下任何文件。** asar 是在打包早期一次性写入的，若此时编辑源文件，条目的 `size` 会与实际字节不符、内容被截断（实例：`engine/animator.js` 尾部断在 `ctx.drawImage(...` 中间）。改完再打。

---

## 二、构建配置

| 项 | 值 | 备注 |
|---|---|---|
| appId / productName | `com.catpet.desktop` / `CatDesktopPet` | |
| 输出目录 | `../dist`（仓库根） | 产物不落在源码目录 |
| 目标 | `portable` + `nsis`（x64） | 两产物体积相当（≈68 MB） |
| 图标 | `build/icon.ico` | 由 `idle.png` 生成 256/128/64/48/32/16 |
| **`electronDist`** | `node_modules/electron/dist` | **必留**，否则打包会去 GitHub 拉 Electron（实测卡 7 分钟） |
| 应删不可删 | `asar` 归档 + Electron 31 运行时 | |

**环境变量坑（最重要的一条）**：从命令行启动 Electron 或跑 electron-builder 必须清掉两个变量，否则进程被当作纯 Node 运行（表现为进程驻留、没有窗口、打包出的 exe 双击秒退）：

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS <命令>
```

置空字符串无效（`ELECTRON_RUN_AS_NODE=` 仍会被识别为真），必须 unset。

---

## 三、asar 校验

中文路径下 `@electron/asar` 常报错，且打包中断可能留下截断条目。可靠的核对方式是**手写头部解析 + 逐条目比哈希**：

```js
const buf = fs.readFileSync('dist/win-unpacked/resources/app.asar');
const headerSize = buf.readUInt32LE(4);
const raw = buf.slice(8, 8 + headerSize);
const jsonLen = raw.readUInt32LE(4);
const header = JSON.parse(raw.slice(8, 8 + jsonLen).toString('utf8'));
const base = 8 + headerSize;                 // 数据区起点
// 递归 walk header.files → 每项 { offset, size }
const content = buf.slice(base + Number(node.offset), base + Number(node.offset) + Number(node.size));
```

判读标准：

- 每个文本条目的 sha1 与源文件一致（`package.json` 例外——打包器会剥掉 devDeps/scripts，属预期）；
- 条目内容**不能以半行代码结尾**（截断的典型特征，也是上面那条"打包期间禁改源码"的由来）；
- 关注关键条目是否在包里：`engine/*.js`、`assets/audio/meow/*.ogg`、`assets/sprites/frames/*.png`。

---

## 四、测试体系

`tools/check/test_logic.js` 是唯一的自动化回归入口，无框架、无并发、单文件：

- **A. Schema 单元断言**：迁移链各版本、越界夹紧、枚举回退、补丁合并、变更路径；
- **B. 渲染进程行为**：Node `vm` 造一个沙箱 DOM/Canvas（Canvas 用 Proxy 吞掉所有绘图调用），加载真实 `renderer.js`，驱动数千帧，模拟点击/拖拽/滚轮/菜单/`config-changed` 广播，断言状态、几何、持久化调用。

```
node tools/check/test_logic.js
→ [ok]/[FAIL] 逐条输出；末尾 [PASS]/[PASS*]/[FAIL]
→ 部分姿态因随机性未覆盖时给 [PASS*]，属正常
```

**加断言的正确姿势**：

1. 优先断言**不变量**（"任何姿态下 `squashX === 1`"），而不是"某次运行的具体数值"；
2. 随机相关的断言给**区间**（如"180 秒内 14–34 次眨眼"），不要等值；
3. 平滑类断言取**稳态末帧**，不取窗口最大值；
4. 涉及写盘的用例末尾等 300ms（滑杆防抖）再断言；
5. 新功能至少配一条**源级守卫**（读源码字符串断言关键函数存在），防止后续重构悄悄删掉接线。

---

## 五、验证手法

### 1. 设置页离线渲染

设置页是纯 schema 驱动，可以脱离主进程单独渲染并断言 DOM：

1. 把 `settings.html` / `settings.js` / `engine/{config-schema,i18n,ai-talk}.js` 拷到 **ASCII 临时目录**（中文路径 `loadFile` 会 `ERR_FAILED`）；engine 文件必须放在 `engine/` 子目录，因为 HTML 里写的是相对路径；
2. 用 Electron 打开、`show:false`，然后 `executeJavaScript` 点击导航按钮、读行数据；
3. **结果写文件**，不要指望 `console.log` —— 主进程管道下看不到渲染进程日志。

无桥接时 `settings.js` 会走"用默认值渲染"的降级分支，界面照样能看，正好用来验证默认值。

### 2. 实机逐帧观测（CDP）

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS ./node_modules/electron/dist/electron.exe . \
  --user-data-dir=<临时目录> --remote-debugging-port=9222
```

- 后台启动必须用工具的 `run_in_background`，普通 `&` 会在当次 Bash 调用结束时被回收；
- Node 22 自带全局 `WebSocket`，不需要 `ws` 包；
- 钩住 `Animator.prototype.update`（比钩 `draw` 省开销）统计帧索引/时钟；
- **渲染进程桥接是 `window.pet`**——`api` 只是 IIFE 内的局部 `const`，CDP 里取不到；
- 现成脚本：`tools/probe/probe_blink_live.js`（眨眼频率与分布）、`tools/probe/probe_blink_rate.js`（改设置 → 读 `meanGap`，验证实时生效）。

### 3. 默认值验证

用 `--user-data-dir=<临时目录>` 起一次，等 8s 后读该目录下 `config.json`，可验证"全新用户"的默认配置与迁移结果，不影响真实用户数据。

---

## 六、环境约束

| 约束 | 说明 |
|---|---|
| 删文件/目录 | 只能走 PowerShell `.NET`（`[System.IO.Directory]::Delete($p,$true)` / `[System.IO.File]::Delete()`）。`Remove-Item`、Python `shutil`/`os.remove` 会被安全策略拦截，批量删除必超时 |
| 中文路径 | `@electron/asar`、部分 `loadFile`、`git` 输出编码都可能出问题；验证脚本一律在 ASCII 临时目录里跑 |
| 无 ffmpeg | 音频解码走 `libsndfile`（`soundfile`，含 MP3）；需要 m4a/opus 时 `pip install imageio-ffmpeg` |
| 无 GPU | 已加 `disableHardwareAcceleration` + `--disable-gpu` / `--in-process-gpu` / `--no-sandbox`，不可删 |
| 无头环境 | `requestAnimationFrame` 会被节流，依赖帧循环的路径（如 `pet`/`eat` 冒泡）无法自动触发，改用即时入口验证 |

---

## 七、历史坑清单

| 现象 | 根因 | 对策 |
|---|---|---|
| 猫比设计尺寸小一圈、气泡"离猫很远"、阴影比例失调 | `drawImage` 宽高重复乘了缩放系数（`ctx.scale` 已缩过）→ 实际 `scale²` | 宽高只传 `SPRITE_SIZE`，缩放交给 `ctx.scale` |
| 所有动作都只剩第 1 帧 | 重写 `update()` 时漏了普通分支的 `frameTime += dt` | 保留普通分支推进；测试覆盖多帧姿态 |
| 完全不眨眼 | 首次进 idle 时 `blinkAt` 仍是 `Infinity`，从未排期 | 进 idle 时检查并 `_scheduleBlink` |
| 姿态切换时体形单帧跳变 0.114 | 几何代码直接读了 `poseScale()` / `pet.scale` | 绘制一律读平滑值 `sizeCur×poseCur` |
| 洗澡 +55 被"打回" | 打开状态面板触发广播，采纳了主进程的旧属性快照 | 运行期广播不采纳属性快照；结算后 `flushStats()` 立即补推 |
| 面板关闭后属性不再同步 | `pushStats` 以面板可见为前提 | 不以可见为前提（开 0.25s / 关 1s） |
| 序列帧顺序错乱（`_s10` 排在 `_s2` 前） | `sorted()` 字典序 | 数值感知排序 |
| 切姿态后特效离猫极远 | 特效用了绝对像素 | 特效几何一律走 `geom()` 传入的实时几何 |
| 改完设置又"变回去" | 取消时挂起的 300ms 防抖定时器把旧值写回 | `discardChanges` 先清所有 `dirtyTimers` |
| 保存成功但值没变 | IPC 返回 `{config, changed}`，快照取了整个对象 | `saved` 必须取 `.config` |
| 从命令行起 exe 无窗口 | 环境注入了 `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` | `env -u` 清掉；日常直接双击 |
| 打包卡 7 分钟 | 缺 `electronDist`，去 GitHub 下 Electron | 保留 `electronDist: "node_modules/electron/dist"` |
| 打包一直等解锁 | 宠物正在运行，锁住了产物 exe | 打包前关宠物 |
| asar 里文件被截断 | 打包期间编辑了源文件 | 打包期间冻结 `app/` |

---

## 八、发版与文档同步

```bash
# 1. 改版本号（两处）+ 升 CONFIG_VERSION（如涉及配置结构）
#    app/package.json  version
#    app/README.md     产物表里的文件名
# 2. 跑测试
cd app && npm test
# 3. 打包
npm run dist:win
# 4. 提交 + 打标签（推送标签触发 CI 构建与 Release）
git commit -am "release: v1.0.0"
git tag v1.0.0 && git push origin main --tags
```

**版本号只在两处**：`app/package.json` 的 `version`（运行时 `get-meta` 也取它）与 `app/README.md` 的产物表。根 README 不写死版本号。

**同一提交内必须同步的文档**：

| 改了什么 | 要更新的地方 |
|---|---|
| 帧数 / 帧率 / 姿态 | `docs/02-animation.md` 帧表、`app/README.md` 帧表、`test_logic.js` 期望帧清单 |
| 设置项增删 / 默认值 | `docs/04-settings.md` 清单与迁移表、`app/README.md` 设置分组表、断言里的条目数 |
| 阈值 / 权重 / 冷却 | `docs/03-behavior.md`、`app/README.md` 属性章节 |
| 语音情境 / 素材 | `docs/05-audio.md` SPEC 表、`CREDITS.md` |
| AI 预设 / 参数 | `docs/06-ai.md`、`app/README.md` 免费服务表 |
| 构建方式 / 产物名 | `docs/07-engineering.md`、`app/README.md`、根 `README.md` |
