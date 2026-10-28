# 猫叫音效素材：抓取 · 加工 · 分配报告

> 数据来源：`_voice_manifest.json`（由 `tools/audio/import_voice_sfx.py` 生成）；素材目录 `cat-pet/assets/audio/meow/`。

## 一、结论

| 项 | 结果 |
|----|------|
| 抓取方式 | 直接爬取成功：OpenGameArt 直链 + Freesound 搜索页 preview（免登录） |
| 产出素材 | **15 条** OGG/Vorbis（44.1kHz 单声道），合计 **184 KB** |
| 覆盖类型 | 呼噜 2 · 普通猫叫 9 · 悲伤/低落 2 · 兴奋/警觉 2 · 系统提示 0 |
| 来源条目 | 7 个（CC0 6 个，CC-BY 1 个） |
| 引擎改动 | `purr` / `purrSleep` 铺底音轨（循环 + 定时淡出）；精选裁剪后 SPEC 为 **12 情境**，未勾选的 sad/dirty/urgent/sys 已整体移除（对应气泡只显示文字） |
| 回滚点 | `_backup/sfx-select_20261017-121948/`（精选前 31 条 + 引擎/测试）· `_backup/sfx-pre_20261017-110111/`（更早 29 条） |

## 二、抓取渠道实测（2026-10-17）

| 站点 | 可达 | 处理 |
|------|------|------|
| OpenGameArt | ✅ 200 | 采用：页面内直链 wav/ogg，许可写在页面 |
| Freesound | ✅ 200 | 采用：搜索页 HTML 内含 `data-ogg` preview 直链（免登录） |
| mixkit.co | ✅ 200 | 未采用：许可允许成品使用但**禁止再分发素材**，与本项目"素材随包分发"冲突 |
| Wikimedia Commons API | ❌ 000 | 不可达，改用 OGA/Freesound |
| archive.org | ❌ 000 | 不可达 |
| pixabay.com / cdn.pixabay.com | ❌ 403 | 反爬拦截 |
| soundbible.com | ❌ 000 | 不可达 |

**抓取实现**：`tools/audio/fetch_cat_sfx.py`（urllib + 正则解析，无浏览器依赖）。Freesound 侧只取 **CC0 过滤 + 时长 ≤9s** 的结果，只下载 preview 的 ogg；OGA 侧直接拿原始 wav/ogg。全部素材落 `cat-pet/assets/audio-raw/`（**不打包**，仅作再生成输入）。

**若抓不到时的替代方案与依赖**（已内置降级，便于换机/换网复跑）：
1. Freesound 若被要求登录或改版：改用官方 API（`FREESOUND_API_KEY` + `qs=license:"Creative Commons 0"`），或整体退回 OGA 直链（`OGA_FILES` 表可独立运行）。
2. 音频解码依赖：本机**无 ffmpeg**，全部解码走 `libsndfile`（`soundfile` 0.14 / libsndfile 1.2.2，已含 MP3 支持），因此 Freesound 的 mp3 preview 也能读；若需处理 m4a/opus 或做响度标准化，可 `pip install imageio-ffmpeg` 提供 ffmpeg 二进制（纯 pip 依赖，无需系统安装）。
3. 若某类型确实抓不到（如"真正的悲伤叫声"稀缺）：用"普通喵 + 降调 0.90 + 拖长"派生，本报告中的 `sad_*` / `tired_*` 已优先使用真实哭叫录音，仅在个别场景退化到降调派生。

## 三、素材来源与许可

| 来源（素材包 / 录音页） | 作者 | 许可 | 用到的源文件 | 产出条数 |
|--------|------|------|--------------|----------|
| [cat-purr-meow](https://opengameart.org/content/cat-purr-meow) | Kerzoven | CC0 1.0 | cat_mewpurr.wav, cat_purractive_loop.wav, cat_purrsleepy_loop.wav | 4 |
| [kitten-mew](https://opengameart.org/content/kitten-mew) | AntumDeluge | CC0 1.0 | kitten_mew-1.wav | 3 |
| [479272](https://freesound.org/people/steffcaffrey/sounds/479272/) | steffcaffrey | CC0 1.0 | New Cat Meow 1 | 3 |
| [110011](https://freesound.org/people/tuberatanka/sounds/110011/) | tuberatanka | CC0 1.0 | cat meow | 2 |
| [cat-sfx](https://opengameart.org/content/cat-sfx) | Macro | CC-BY 3.0 | Cat_1.wav | 1 |
| [534269](https://freesound.org/people/patchytherat/sounds/534269/) | patchytherat | CC0 1.0 | meow 1.wav | 1 |
| [813113](https://freesound.org/people/qubodup/sounds/813113/) | qubodup | CC0 1.0 | Cat Meowing | 1 |

CC-BY 素材需署名：`Cat SFX`（Macro, CC-BY 3.0）、`cat pickup effect`（stratoavis, CC-BY 4.0）已在 `cat-pet/assets/audio/CREDITS.md` 登记。CC0 素材无需署名，仍完整登记。

## 四、音效清单（精选 15 条）

| # | 类型 | 目标文件 | 来源（作者 · 许可） | 源素材 | 切片 s | 变速 | 格式 | 时长 | 文件路径 |
|---|------|----------|---------------------|--------|--------|------|------|------|----------|
| 1 | 普通猫叫 | `pet_3` | steffcaffrey · CC0 1.0 | New Cat Meow 1 | 0.03–0.82 | ×0.97 | OGG/Vorbis 44.1k mono | 0.82s | `assets/audio/meow/pet_3.ogg` |
| 2 | 普通猫叫 | `eat_1` | patchytherat · CC0 1.0 | meow 1.wav | 0.28–0.76 | ×1.02 | OGG/Vorbis 44.1k mono | 0.47s | `assets/audio/meow/eat_1.ogg` |
| 3 | 兴奋/警觉 | `play_2` | Macro · CC-BY 3.0 | Cat_1.wav | 0.00–1.09 | ×0.96 | OGG/Vorbis 44.1k mono | 1.14s | `assets/audio/meow/play_2.ogg` |
| 4 | 普通猫叫 | `bath_1` | AntumDeluge · CC0 1.0 | kitten_mew-1.wav | 0.04–0.88 | ×1.00 | OGG/Vorbis 44.1k mono | 0.84s | `assets/audio/meow/bath_1.ogg` |
| 5 | 普通猫叫 | `bath_2` | tuberatanka · CC0 1.0 | cat meow | 0.16–1.21 | ×0.95 | OGG/Vorbis 44.1k mono | 1.10s | `assets/audio/meow/bath_2.ogg` |
| 6 | 普通猫叫 | `wake_1` | qubodup · CC0 1.0 | Cat Meowing | 0.00–0.60 | ×0.96 | OGG/Vorbis 44.1k mono | 0.62s | `assets/audio/meow/wake_1.ogg` |
| 7 | 普通猫叫 | `wake_2` | Kerzoven · CC0 1.0 | cat_mewpurr.wav | 0.01–0.89 | ×0.90 | OGG/Vorbis 44.1k mono | 0.97s | `assets/audio/meow/wake_2.ogg` |
| 8 | 普通猫叫 | `call_2` | tuberatanka · CC0 1.0 | cat meow | 0.16–1.21 | ×0.98 | OGG/Vorbis 44.1k mono | 1.07s | `assets/audio/meow/call_2.ogg` |
| 9 | 兴奋/警觉 | `hungry_2` | AntumDeluge · CC0 1.0 | kitten_mew-1.wav | 0.04–0.88 | ×0.98 | OGG/Vorbis 44.1k mono | 0.85s | `assets/audio/meow/hungry_2.ogg` |
| 10 | 悲伤/低落 | `tired_1` | steffcaffrey · CC0 1.0 | New Cat Meow 1 | 0.03–0.82 | ×0.90 | OGG/Vorbis 44.1k mono | 0.88s | `assets/audio/meow/tired_1.ogg` |
| 11 | 悲伤/低落 | `lonely_2` | AntumDeluge · CC0 1.0 | kitten_mew-1.wav | 0.04–0.88 | ×0.94 | OGG/Vorbis 44.1k mono | 0.89s | `assets/audio/meow/lonely_2.ogg` |
| 12 | 普通猫叫 | `idle_1` | steffcaffrey · CC0 1.0 | New Cat Meow 1 | 0.03–0.82 | ×1.00 | OGG/Vorbis 44.1k mono | 0.79s | `assets/audio/meow/idle_1.ogg` |
| 13 | 普通猫叫 | `idle_2` | Kerzoven · CC0 1.0 | cat_mewpurr.wav | 0.01–0.89 | ×1.00 | OGG/Vorbis 44.1k mono | 0.88s | `assets/audio/meow/idle_2.ogg` |
| 14 | 呼噜 | `purr_1` | Kerzoven · CC0 1.0 | cat_purractive_loop.wav | 0.60–3.50 | ×1.00 | OGG/Vorbis 44.1k mono | 2.74s | `assets/audio/meow/purr_1.ogg` |
| 15 | 呼噜 | `purr_2` | Kerzoven · CC0 1.0 | cat_purrsleepy_loop.wav | 0.40–3.30 | ×1.00 | OGG/Vorbis 44.1k mono | 2.74s | `assets/audio/meow/purr_2.ogg` |

## 五、动作分类映射

按项目状态机/事件分类归并（同一动作可能有 1–3 条变体，播放时随机不连续重复）：

| 动作分类 | 情境 | 触发时机 | 素材 | 类型 |
|----------|------|----------|------|------|
| 互动 · 抚摸 | 抚摸 | 抚摸进入（1.6s）+ 结束时冒泡 | `pet_3` | 普通猫叫 |
| 互动 · 进食 | 进食 | 进食结算 | `eat_1` | 普通猫叫 |
| 互动 · 逗玩 | 逗玩 | 逗玩/扔球结算 | `play_2` | 兴奋/警觉 |
| 互动 · 洗澡 | 洗澡 | 洗澡开始 + 结算 | `bath_1`、`bath_2` | 普通猫叫 |
| 互动 · 唤醒 | 唤醒 | 从睡梦中被叫醒 | `wake_1`、`wake_2` | 普通猫叫 |
| 互动 · 呼喊 | 呼喊回应 | 点击"呼喊"后应答 | `call_2` | 普通猫叫 |
| 需求 · 饥饿 | 饥饿 | 饱食度偏低档 | `hungry_2` | 兴奋/警觉 |
| 情绪变化 · 疲惫 | 疲惫 | 体力偏低档 | `tired_1` | 悲伤/低落 |
| 情绪变化 · 孤独 | 孤独 | 长时间无互动 | `lonely_2` | 悲伤/低落 |
| 待机 · 自主 | 迎接 / 空闲 | 启动迎接 / 空闲自语 | `idle_1`、`idle_2` | 普通猫叫 |
| 互动 · 抚摸（铺底） | 呼噜 · 抚摸 | 抚摸进入时铺底（9s 冷却） | `purr_1` | 呼噜 |
| 待机 · 睡眠（铺底） | 呼噜 · 入睡 | 入睡时铺底（45s 冷却） | `purr_2` | 呼噜 |

## 六、客观校验（音色指标，非主观听感）

| 指标 | 换素材前（29 条） | 换素材后（16 条精选） | 说明 |
|------|------------------|------------------|------|
| Zwicker 尖锐度均值 | 1.03 acum | 0.86 acum | 越低越不刺耳 |
| 尖锐度最大 | 1.29 acum | 1.07 acum | 最尖的一条 |
| 3–5kHz 占比均值 | 0.5% | 0.8% | 听觉疲劳主区 |
| 3–5kHz 占比最大 | 3.6% | 3.7% | 单条最差 |
| 谱重心均值 | 1225 Hz | 966 Hz | 明亮度 |
| 平均时长 | 0.66s | 1.11s | 单次叫声长度 |

呼噜两条单独看：`purr_1` 谱重心 170Hz、200–500Hz 体感带占 19.5%；`purr_2` 105Hz / 14.3%——原始录音 92% 能量在 80Hz 以下（小喇叭听不见），已用「削 70Hz 轰鸣 + 抬 260Hz 体感」拉回可闻区。

## 七、验收与回滚

1. 试听：打开 `assets/previews/cat-sfx-preview.html`（base64 内嵌，双击即响，可按类型筛选/串播）。
2. 回归：`node tools/check/test_logic.js` —— 全部断言通过（含 12 情境、精选 16 条与勾选清单逐条一致、素材目录无未勾选残留、呼噜≤3.5s、呼噜铺底不受全局节流影响、voiceVolume 音量链路）。
3. 重生成：`python tools/audio/fetch_cat_sfx.py` → `python tools/audio/import_voice_sfx.py` → `python tools/audio/make_sfx_report.py`（改一行切片/变速即可重跑）。
4. 回滚：`cp -r _backup/sfx-pre_20261017-110111/meow/* cat-pet/assets/audio/meow/` 并把 `engine/voice.js` 的 `purr/purrSleep` 两行与 renderer 两处调用移除。

> 说明：当前曲库为**用户勾选的 15 条精选**（2026-10-17，红框 16 条再按用户要求去掉 pet_2），未勾选的 16 条已从`CUTS` 表与素材目录移除（含 pet_2）；`sad/dirty/urgent/sys` 四个情境在 `engine/voice.js` 中整体下线，对应气泡只显示文字。若要恢复，从 `_backup/sfx-select_20261017-121948/` 回滚或把 `CUTS` 表对应行加回再重跑。
