# 音频素材来源登记（CREDITS）

## 结论

当前打包的 **15 条**情境素材全部为 **CC0 / CC-BY 真实猫叫录音**（无程序化占位音、无来源不明素材），
抓取日期 2026-10-17，抓取脚本 `tools/fetch_cat_sfx.py`，加工脚本 `tools/import_voice_sfx.py`。
CC-BY 条目已在本文件署名；CC0 无需署名，仍完整登记以便追溯。

原始录音留存于 `assets/audio-raw/`（已在 `package.json` 的 `build.files` 中排除，不随包分发）。

## 一、来源

| 来源 | 作者 | 许可 | 源文件 | 产出条数 |
|------|------|------|--------|----------|
| [cat-purr-meow](https://opengameart.org/content/cat-purr-meow) | Kerzoven | CC0 1.0 | cat_mewpurr.wav, cat_purractive_loop.wav, cat_purrsleepy_loop.wav | 4 |
| [kitten-mew](https://opengameart.org/content/kitten-mew) | AntumDeluge | CC0 1.0 | kitten_mew-1.wav | 3 |
| [479272](https://freesound.org/people/steffcaffrey/sounds/479272/) | steffcaffrey | CC0 1.0 | New Cat Meow 1 | 3 |
| [110011](https://freesound.org/people/tuberatanka/sounds/110011/) | tuberatanka | CC0 1.0 | cat meow | 2 |
| [cat-sfx](https://opengameart.org/content/cat-sfx) | Macro | CC-BY 3.0 | Cat_1.wav | 1 |
| [534269](https://freesound.org/people/patchytherat/sounds/534269/) | patchytherat | CC0 1.0 | meow 1.wav | 1 |
| [813113](https://freesound.org/people/qubodup/sounds/813113/) | qubodup | CC0 1.0 | Cat Meowing | 1 |

**CC-BY 署名（强制）**：
- `Cat SFX` — Macro — CC-BY 3.0 — https://opengameart.org/content/cat-sfx
- `cat pickup effect` — stratoavis — CC-BY 4.0 — https://opengameart.org/content/cat-pickup-effect
- 许可证全文：CC0 https://creativecommons.org/publicdomain/zero/1.0/ ，CC-BY 3.0/4.0 https://creativecommons.org/licenses/

## 二、加工链（可复跑）

```
抓取   tools/fetch_cat_sfx.py      OGA 直链 + Freesound preview（CC0 过滤 + ≤9s）
加工   tools/import_voice_sfx.py   切片→裁静音→90Hz 高通→变速→4 段 EQ→压缩→柔性起落→响度归一→OGG
呼噜   (同脚本 loop 通路)          28Hz 高通→呼噜专用 EQ→循环接缝交叉淡化→响度归一
交付   tools/make_sfx_report.py    生成 voice-sfx-report.md / 试听页 / 本文件
```

统一音色曲线：320Hz 低架 +2.6dB（暖）→ 900Hz +1.2dB（实体）→ 3.4kHz −3.4dB（削刺）→ 5.6kHz 高频架 −4.2dB（削嘶）；压缩 2.6:1 只压瞬态尖峰；12–20ms raise-cosine 起音。
响度档位：normal −18 dBFS / soft −20.5 / 呼噜 −21。

## 三、情境映射

| 目标文件 | 类型 | 源素材 | 切片 s | 变速 | 时长 |
|----------|------|--------|--------|------|------|
| `pet_3.ogg` | 普通猫叫 | New Cat Meow 1（steffcaffrey, CC0 1.0） | 0.03–0.82 | ×0.97 | 0.82s |
| `eat_1.ogg` | 普通猫叫 | meow 1.wav（patchytherat, CC0 1.0） | 0.28–0.76 | ×1.02 | 0.47s |
| `play_2.ogg` | 兴奋/警觉 | Cat_1.wav（Macro, CC-BY 3.0） | 0.00–1.09 | ×0.96 | 1.14s |
| `bath_1.ogg` | 普通猫叫 | kitten_mew-1.wav（AntumDeluge, CC0 1.0） | 0.04–0.88 | ×1.00 | 0.84s |
| `bath_2.ogg` | 普通猫叫 | cat meow（tuberatanka, CC0 1.0） | 0.16–1.21 | ×0.95 | 1.10s |
| `wake_1.ogg` | 普通猫叫 | Cat Meowing（qubodup, CC0 1.0） | 0.00–0.60 | ×0.96 | 0.62s |
| `wake_2.ogg` | 普通猫叫 | cat_mewpurr.wav（Kerzoven, CC0 1.0） | 0.01–0.89 | ×0.90 | 0.97s |
| `call_2.ogg` | 普通猫叫 | cat meow（tuberatanka, CC0 1.0） | 0.16–1.21 | ×0.98 | 1.07s |
| `hungry_2.ogg` | 兴奋/警觉 | kitten_mew-1.wav（AntumDeluge, CC0 1.0） | 0.04–0.88 | ×0.98 | 0.85s |
| `tired_1.ogg` | 悲伤/低落 | New Cat Meow 1（steffcaffrey, CC0 1.0） | 0.03–0.82 | ×0.90 | 0.88s |
| `lonely_2.ogg` | 悲伤/低落 | kitten_mew-1.wav（AntumDeluge, CC0 1.0） | 0.04–0.88 | ×0.94 | 0.89s |
| `idle_1.ogg` | 普通猫叫 | New Cat Meow 1（steffcaffrey, CC0 1.0） | 0.03–0.82 | ×1.00 | 0.79s |
| `idle_2.ogg` | 普通猫叫 | cat_mewpurr.wav（Kerzoven, CC0 1.0） | 0.01–0.89 | ×1.00 | 0.88s |
| `purr_1.ogg` | 呼噜 | cat_purractive_loop.wav（Kerzoven, CC0 1.0） | 0.60–3.50 | ×1.00 | 2.74s |
| `purr_2.ogg` | 呼噜 | cat_purrsleepy_loop.wav（Kerzoven, CC0 1.0） | 0.40–3.30 | ×1.00 | 2.74s |

呼噜（`purr_1` / `purr_2`）由 `engine/voice.js` 以 `layer: true` 独立音轨循环播放，分别由抚摸进入与入睡事件触发，不参与一次性叫声的打断仲裁。

## 四、合规要求

1. 新增素材必须是 **CC0 / CC-BY**（CC-BY 需在本文件补作者与链接），禁用来源不明素材。
2. 时长：普通 0.4–1.3s，呼噜 ≤3.5s（loop）；44.1kHz 单声道 OGG。危急/系统音情境已按用户精选下线，恢复前不得重新引入目录。
3. 增删变体只改 `engine/voice.js` 的 `SPEC.files` + `tools/import_voice_sfx.py` 的 `CUTS`，`tools/test_logic.js` 会校验素材存在性与时长上限，漏放即 FAIL。
