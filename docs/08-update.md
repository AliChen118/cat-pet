# 08 · 版本更新（安装版 / 便携版）

面向维护者：说明「怎么发版、客户端怎么发现新版本、怎么把新包换上去」。范围只含 **Windows 两种包**（Portable / NSIS 安装版），Linux AppImage 暂不接入。

一句话架构：**二进制放 GitHub Releases，版本清单放仓库 `channel/latest.json`（固定 URL），客户端自研更新器负责比对、下载、校验、替换。**

---

## 一、为什么不直接把 exe 提交进仓库

| 方案 | 结论 | 原因 |
|---|---|---|
| exe 提交进 git | ✗ | 每版 +140 MB 永久进历史，clone 变灾难；且无法用 Release 页 |
| **GitHub Releases 存二进制 + `channel/latest.json` 存清单** | ✓ **采用** | 二进制作 Release asset（不占 git 体积）；清单走 `raw.githubusercontent.com`，**无 API 限流、无 token、不用解析 latest release** |
| 只用 GitHub API `/releases/latest` | △ 备用 | 未认证 60 次/小时，企业网络下易被限；作为清单拉取失败时的兜底 |

**为什么不用 `electron-updater`**：便携版是自解压外壳，运行时真实 exe 在 `%TEMP%`，updater 无法替换用户手里那个文件；且它需要 `publish` 配置与额外依赖。自研两条路径统一，**0 新增依赖**（`electron.net` 已在 AI 模块使用）。

---

## 二、发布侧

### 2.1 版本号管理

| 项 | 规则 |
|---|---|
| 单一真相源 | `app/package.json` 的 `version`（客户端运行时读 `app.getVersion()`） |
| tag | `v${version}`，如 `v1.1.11` |
| CI 一致性校验 | `test` job 里断言 `tag` 去掉 `v` == `package.json.version`，不等直接 fail（防止发错包） |
| 递增 | 修 bug → patch；加功能 → minor；不兼容的配置迁移 → minor + 递增 `config-schema.js` 的 `CONFIG_VERSION`（两者无关，别混） |
| 禁止 | 复用/移动已推送的 tag；同一版本号发两次 |
| 强制更新阈值 | 清单里的 `minFrom`：当前版本低于它则提示不可跳过（用于修安全问题时） |

### 2.2 仓库文件组织与命名

```
cat-pet/
├─ channel/
│  └─ latest.json               ← 唯一版本清单，随发版自动更新（固定 URL）
└─ .github/workflows/build.yml  ← 发版时生成清单 + 校验和

Releases/tag/v1.1.11            ← 二进制都在这里
├─ CatDesktopPet-Portable-1.1.11.exe
├─ CatDesktopPet-Setup-1.1.11.exe
├─ CatDesktopPet-Setup-1.1.11.exe.blockmap
├─ SHA256SUMS.txt
└─ latest.json                  ← 同 channel/ 那份，附一份方便人工核对
```

| 类型 | 命名 | 说明 |
|---|---|---|
| tag | `v1.1.11` | 带 `v` |
| 便携版 | `CatDesktopPet-Portable-1.1.11.exe` | 已由 `build.portable.artifactName` 决定 |
| 安装版 | `CatDesktopPet-Setup-1.1.11.exe` | 已由 `build.nsis.artifactName` 决定 |
| 校验和 | `SHA256SUMS.txt` | `sha256sum *.exe` 输出 |
| 清单 | `latest.json` | 见下 |
| 运行时残留 | `*.old` | 便携版替换后待清理的旧 exe |

**下载 URL 由命名推导**，不需要清单里再写 URL：
`https://github.com/AliChen118/cat-pet/releases/download/v{version}/{file}`

### 2.3 `channel/latest.json` 格式

```json
{
  "version": "1.1.11",
  "releasedAt": "2026-11-02T10:00:00Z",
  "minFrom": "1.0.0",
  "notes": "修复奔跑横向抖动；新增更新检查",
  "assets": {
    "portable": { "file": "CatDesktopPet-Portable-1.1.11.exe", "size": 72043858, "sha256": "…" },
    "setup":    { "file": "CatDesktopPet-Setup-1.1.11.exe",    "size": 72286039, "sha256": "…" }
  }
}
```

`size` + `sha256` 是**下载校验的唯一依据**，客户端不信任任何自报信息。

### 2.4 CI 改动（`build.yml` 的 `release` job 内追加）

1. `test` job 增加 tag/version 一致性断言。
2. `release` job 在 attach 之前：`sha256sum *.exe > SHA256SUMS.txt`，用 `node tools/release/make_manifest.js` 生成 `latest.json`（读 `app/package.json` + 哈希 + release notes 首行）。
3. attach 里加入这两个文件。
4. 通过 `git commit` 回写 `channel/latest.json` 并 push 到 `main`（`permissions: contents: write` 已有）。**只改这一个文件**，不提交二进制。

---

## 三、客户端

### 3.1 模块划分

新建 `app/engine/updater/`，全部在主进程（不碰渲染层安全边界）：

| 文件 | 职责 | 关键点 |
|---|---|---|
| `paths.js` | 识别当前是哪种包、算出目录 | 便携版：`process.env.PORTABLE_EXECUTABLE_FILE` 存在即为便携版，替换目标是它（**不是** `process.execPath`，那在 `%TEMP%`）；否则按安装版处理。下载目录 `DATA_DIR/updates/` |
| `manifest.js` | 拉清单、校验结构、选 asset | 8 s 超时；只接受 `https` + host 白名单；字段缺失/sha256 非 64 位十六进制即拒绝 |
| `version.js` | SemVer 比对 | 纯函数 `compare(a,b)`、`isNewer(cur,latest)`，无依赖，单测主战场 |
| `download.js` | 流式下载 + 进度 + 校验 | 写 `.part` → 校验 size/sha256 → 原子 rename；失败删残片，最多 3 次指数退避 |
| `apply.js` | 两条安装路径 | 见 3.3 |
| `index.js` | 状态机、定时器、IPC | `idle→checking→available→downloading→verifying→ready→applying`，同一时刻只允许一个进行中任务 |

配套：
- `main.js` 注册 IPC：`update:check`、`update:download`、`update:apply`、`update:state`（推送）、`update:open-page`。
- 渲染层：气泡提示 + 设置窗新增「更新」分组（自动检查开关、当前版本、手动检查、进度条、跳过此版本）。
- `engine/config-schema.js` 新增 `update` 组一个字段 `autoCheckUpdate`（默认 `true`）；`skippedVersion` / `lastCheckAt` **不进 config**（不是用户可见设置），存 `DATA_DIR/update-state.json`。

### 3.2 检查与比对流程

```
启动（app.isPackaged 才启用）
  └─ 20 s 后首次检查 ──→ GET channel/latest.json（带 If-None-Match，命中 304 直接结束）
        ├─ 未命中 / 网络失败 ──→ 静默，1 h 后重试（最多 3 次退避：1h/3h/9h）
        └─ 命中 ──→ isNewer(app.getVersion(), manifest.version)?
              ├─ 否 → 记录 lastCheckAt，结束
              └─ 是 → 读取 skippedVersion：相同且未低于 minFrom → 不提示
                      否则 → available：气泡「发现新版本 1.1.11，去更新？」
  └─ 每 6 h 轮询一次；`Date.now()-lastCheckAt < 1h` 时跳过（防频繁重启打请求）
```

比对规则：`x.y.z` 逐段数值比较（不做字符串比较，`1.1.10 > 1.1.9`）；不解析 pre-release（当前不发预发布）；`minFrom` 命中则忽略 `skippedVersion`，提示不可跳过。

### 3.3 提示与执行

| 阶段 | 安装版 | 便携版 |
|---|---|---|
| 提示 | 气泡（绿色 #1B7A43 主按钮「立即更新」/「稍后」）；托盘菜单常驻「检查更新…」 | 同左 |
| 下载 | `updates/CatDesktopPet-Setup-1.1.11.exe` + 进度 | `updates/CatDesktopPet-Portable-1.1.11.exe` + 进度 |
| 校验 | size + sha256 全等；不符 → 删文件、提示「安装包校验失败，已阻止安装」 | 同左 |
| 执行 | 写 `%TEMP%/catpet-apply.cmd`：等 3 s → `setup.exe /S` → `start "" "<安装目录>\CatDesktopPet.exe"` → 自删；`detached` 启动后 `app.exit(0)`（`perMachine:false`，无需 UAC） | ① `fs.rename` 当前 exe → `.old`（运行中的 exe **可改名、不可删除**）② 新 exe 落到 `PORTABLE_EXECUTABLE_DIR` ③ `spawn` 新 exe → `app.exit(0)` ④ 下次启动清理 `*.old` |
| 失败降级 | 提示「自动更新失败」+ 按钮打开 Release 页面手动下载 | 同左（改名失败时保留两个 exe，让用户手动替换） |

用户数据全程不动：`%APPDATA%/cat-desktop-pet`（或自定义数据目录）与程序目录分离，重装/替换后配置、宠物状态、统计继续可用。

### 3.4 下载与校验要点

- 只走 `electron.net.request`（自动走系统代理，企业网络更靠谱）；**手动跟随 302**，每一跳校验 host ∈ `{github.com, objects.githubusercontent.com, release-assets.githubusercontent.com}`，防止被劫持到任意域。
- 先写 `<file>.part`，校验通过才 `rename`，避免半截文件被当成可执行包。
- `sha256` 由 `crypto.createHash('sha256')` 流式计算，不整包读入内存（70 MB）。
- 任何校验失败都**不执行**、立即删除；网络类失败静默（不打扰），只有校验失败才弹提示（安全事件）。

---

## 四、主要实现步骤（可分批交付）

| 批次 | 内容 | 交付物 | 风险 |
|---|---|---|---|
| 1 发布侧 | `tools/release/make_manifest.js`；CI 生成 `latest.json` + `SHA256SUMS.txt`；tag/version 一致性断言；回写 `channel/` | 推一个 tag 能产出完整 Release，`channel/latest.json` 自动更新 | 低 |
| 2 检查与提示 | `paths.js` / `manifest.js` / `version.js` / `index.js`；气泡 + 托盘 + 设置页；`autoCheckUpdate` | 有新版会提示，点「立即更新」先打开 Release 页 | 低 |
| 3 下载与执行 | `download.js` / `apply.js`；两条安装路径；`*.old` 清理 | 真机完成一次安装版升级 + 一次便携版替换 | 中（替换逻辑需真机验） |

每批都要落测试：`tools/check/test_logic.js` 新增断言（**离线 fixture，不联网**）——`compare/isNewer` 边界（`1.1.9<1.1.10`、相等、空值）、清单字段缺失/错误 sha256 必须被拒、命名规范与 `package.json` artifactName 一致、便携/安装识别分支、`skippedVersion` 逻辑。

## 五、验收清单

- [ ] tag 与 `version` 不一致时 CI 失败
- [ ] 篡改 `latest.json` 里的 sha256 → 下载完拒绝执行、文件被删
- [ ] 断网 / 404 / 超时 8 s → 无弹窗、无异常日志刷屏
- [ ] 安装版：静默升级后版本号更新，`%APPDATA%` 配置与宠物状态保留
- [ ] 便携版：替换后目录内只有新 exe（`*.old` 下次启动被清），原目录可写（只读 U 盘时提示手动替换）
- [ ] 「跳过此版本」后不再提示；设置页「检查更新」仍可手动触发
- [ ] `minFrom` 命中时跳过无效，提示不可关闭
- [ ] dev 模式（未打包）完全不联网检查
