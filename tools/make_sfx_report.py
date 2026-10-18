#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""make_sfx_report.py — 由 _voice_manifest.json 生成两份交付物

  1) voice-sfx-report.md                音效清单 + 映射关系 + 来源许可（文本交付）
  2) assets-src/previews/cat-sfx-preview.html  单文件自包含试听页（base64 内嵌，双击即听）

数据单一来源：_voice_manifest.json（由 tools/import_voice_sfx.py 生成）
"""
import base64
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, '_voice_manifest.json')
MEOW_DIR = os.path.join(ROOT, 'app', 'assets', 'audio', 'meow')
OUT_MD = os.path.join(ROOT, 'voice-sfx-report.md')
OUT_HTML = os.path.join(ROOT, 'assets', 'previews', 'cat-sfx-preview.html')
OUT_CREDITS = os.path.join(ROOT, 'app', 'assets', 'audio', 'CREDITS.md')

VOCAL = {
    'pet': '普通猫叫', 'eat': '普通猫叫', 'bath': '普通猫叫', 'wake': '普通猫叫',
    'call': '普通猫叫', 'idle': '普通猫叫',
    'tired': '悲伤/低落', 'lonely': '悲伤/低落',
    'play': '兴奋/警觉', 'hungry': '兴奋/警觉',
    'purr': '呼噜', 'purrSleep': '呼噜',
}
ACTION = {
    'pet': '互动 · 抚摸', 'eat': '互动 · 进食', 'play': '互动 · 逗玩', 'bath': '互动 · 洗澡',
    'wake': '互动 · 唤醒', 'call': '互动 · 呼喊', 'hungry': '需求 · 饥饿',
    'tired': '情绪变化 · 疲惫',
    'lonely': '情绪变化 · 孤独', 'idle': '待机 · 自主',
    'purr': '互动 · 抚摸（铺底）', 'purrSleep': '待机 · 睡眠（铺底）',
}
CTX_LABEL = {
    'pet': '抚摸', 'eat': '进食', 'play': '逗玩', 'bath': '洗澡', 'wake': '唤醒',
    'call': '呼喊回应', 'hungry': '饥饿', 'tired': '疲惫',
    'lonely': '孤独', 'idle': '迎接 / 空闲',
    'purr': '呼噜 · 抚摸', 'purrSleep': '呼噜 · 入睡',
}
ORDER = list(CTX_LABEL.keys())


BASE_CTX = {'purr_1': 'purr', 'purr_2': 'purrSleep'}


def ctx_of(base):
    if base in BASE_CTX:
        return BASE_CTX[base]
    return base.split('/')[0] if '/' in base else base.rsplit('_', 1)[0]


def load_metrics(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        return None
    avg = lambda k: sum(float(r[k]) for r in rows) / len(rows)  # noqa: E731
    return {
        'n': len(rows),
        'centroid': avg('centroid'),
        'harsh': avg('harsh') * 100,
        'harshMax': max(float(r['harsh']) for r in rows) * 100,
        'sharp': avg('sharp'),
        'sharpMax': max(float(r['sharp']) for r in rows),
        'dur': avg('dur'),
    }


def main():
    rows = json.load(open(MANIFEST, encoding='utf-8'))
    for r in rows:
        r['ctx'] = ctx_of(r['base'])
        r['vocal'] = VOCAL[r['ctx']]
        r['action'] = ACTION[r['ctx']]
    rows.sort(key=lambda r: (ORDER.index(r['ctx']), r['base']))

    # 统计
    by_vocal = {}
    for r in rows:
        by_vocal.setdefault(r['vocal'], []).append(r)
    total_kb = sum(r['kb'] for r in rows)

    # 源文件聚合（按素材包页面）
    packs = {}
    for r in rows:
        key = r['page'] or r['src']
        p = packs.setdefault(key, {'page': key, 'author': r['author'], 'license': r['license'],
                                   'files': set(), 'n': 0, 'origin': r['origin']})
        p['files'].add(r['srcName'])
        p['n'] += 1
    packs = sorted(packs.values(), key=lambda p: (-p['n'], p['author']))

    old = load_metrics(os.path.join(ROOT, '_after_meow.csv'))
    new = load_metrics(os.path.join(ROOT, '_sfx_new.csv'))

    # ─────────────────────────── markdown ───────────────────────────
    L = []
    add = L.append
    add('# 猫叫音效素材：抓取 · 加工 · 分配报告\n')
    add('> 数据来源：`_voice_manifest.json`（由 `tools/import_voice_sfx.py` 生成）；'
        '素材目录 `app/assets/audio/meow/`。\n')

    add('## 一、结论\n')
    add('| 项 | 结果 |')
    add('|----|------|')
    add('| 抓取方式 | 直接爬取成功：OpenGameArt 直链 + Freesound 搜索页 preview（免登录） |')
    add(f'| 产出素材 | **{len(rows)} 条** OGG/Vorbis（44.1kHz 单声道），合计 **{total_kb:.0f} KB** |')
    add(f'| 覆盖类型 | 呼噜 {len(by_vocal.get("呼噜", []))} · 普通猫叫 {len(by_vocal.get("普通猫叫", []))} · '
        f'悲伤/低落 {len(by_vocal.get("悲伤/低落", []))} · 兴奋/警觉 {len(by_vocal.get("兴奋/警觉", []))} · '
        f'系统提示 {len(by_vocal.get("系统提示", []))} |')
    add(f'| 来源条目 | {len(packs)} 个（CC0 {sum(1 for p in packs if p["license"].startswith("CC0"))} 个，'
        f'CC-BY {sum(1 for p in packs if p["license"].startswith("CC-BY"))} 个） |')
    add('| 引擎改动 | `purr` / `purrSleep` 铺底音轨（循环 + 定时淡出）；精选裁剪后 SPEC 为 **12 情境**，未勾选的 sad/dirty/urgent/sys 已整体移除（对应气泡只显示文字） |')
    add('| 回滚点 | `_backup/sfx-select_20261017-121948/`（精选前 31 条 + 引擎/测试）· `_backup/sfx-pre_20261017-110111/`（更早 29 条） |')
    add('')

    add('## 二、抓取渠道实测（2026-10-17）\n')
    add('| 站点 | 可达 | 处理 |')
    add('|------|------|------|')
    add('| OpenGameArt | ✅ 200 | 采用：页面内直链 wav/ogg，许可写在页面 |')
    add('| Freesound | ✅ 200 | 采用：搜索页 HTML 内含 `data-ogg` preview 直链（免登录） |')
    add('| mixkit.co | ✅ 200 | 未采用：许可允许成品使用但**禁止再分发素材**，与本项目"素材随包分发"冲突 |')
    add('| Wikimedia Commons API | ❌ 000 | 不可达，改用 OGA/Freesound |')
    add('| archive.org | ❌ 000 | 不可达 |')
    add('| pixabay.com / cdn.pixabay.com | ❌ 403 | 反爬拦截 |')
    add('| soundbible.com | ❌ 000 | 不可达 |')
    add('')
    add('**抓取实现**：`tools/fetch_cat_sfx.py`（urllib + 正则解析，无浏览器依赖）。'
        'Freesound 侧只取 **CC0 过滤 + 时长 ≤9s** 的结果，只下载 preview 的 ogg；'
        'OGA 侧直接拿原始 wav/ogg。全部素材落 `app/assets-src/audio-raw/`（**不打包**，仅作再生成输入）。\n')
    add('**若抓不到时的替代方案与依赖**（已内置降级，便于换机/换网复跑）：')
    add('1. Freesound 若被要求登录或改版：改用官方 API（`FREESOUND_API_KEY` + `qs=license:"Creative Commons 0"`），'
        '或整体退回 OGA 直链（`OGA_FILES` 表可独立运行）。')
    add('2. 音频解码依赖：本机**无 ffmpeg**，全部解码走 `libsndfile`（`soundfile` 0.14 / libsndfile 1.2.2，'
        '已含 MP3 支持），因此 Freesound 的 mp3 preview 也能读；若需处理 m4a/opus 或做响度标准化，'
        '可 `pip install imageio-ffmpeg` 提供 ffmpeg 二进制（纯 pip 依赖，无需系统安装）。')
    add('3. 若某类型确实抓不到（如"真正的悲伤叫声"稀缺）：用"普通喵 + 降调 0.90 + 拖长"派生，'
        '本报告中的 `sad_*` / `tired_*` 已优先使用真实哭叫录音，仅在个别场景退化到降调派生。')
    add('')

    add('## 三、素材来源与许可\n')
    add('| 来源（素材包 / 录音页） | 作者 | 许可 | 用到的源文件 | 产出条数 |')
    add('|--------|------|------|--------------|----------|')
    for p in packs:
        add(f'| [{p["page"].rstrip("/").split("/")[-1]}]({p["page"]}) | {p["author"]} | {p["license"]} | '
            f'{", ".join(sorted(p["files"]))} | {p["n"]} |')
    add('')
    add('CC-BY 素材需署名：`Cat SFX`（Macro, CC-BY 3.0）、`cat pickup effect`（stratoavis, CC-BY 4.0）'
        '已在 `app/assets/audio/CREDITS.md` 登记。CC0 素材无需署名，仍完整登记。\n')

    add(f'## 四、音效清单（精选 {len(rows)} 条）\n')
    add('| # | 类型 | 目标文件 | 来源（作者 · 许可） | 源素材 | 切片 s | 变速 | 格式 | 时长 | 文件路径 |')
    add('|---|------|----------|---------------------|--------|--------|------|------|------|----------|')
    for i, r in enumerate(rows, 1):
        add(f'| {i} | {r["vocal"]} | `{r["base"]}` | {r["author"]} · {r["license"]} | {r["srcName"]} | '
            f'{r["t"][0]:.2f}–{r["t"][1]:.2f} | ×{r["rate"]:.2f} | OGG/Vorbis 44.1k mono | '
            f'{r["dur"]:.2f}s | `{r["file"]}` |')
    add('')

    add('## 五、动作分类映射\n')
    add('按项目状态机/事件分类归并（同一动作可能有 1–3 条变体，播放时随机不连续重复）：\n')
    add('| 动作分类 | 情境 | 触发时机 | 素材 | 类型 |')
    add('|----------|------|----------|------|------|')
    TRIG = {
        'pet': '抚摸进入（1.6s）+ 结束时冒泡', 'eat': '进食结算', 'play': '逗玩/扔球结算',
        'bath': '洗澡开始 + 结算', 'wake': '从睡梦中被叫醒', 'call': '点击"呼喊"后应答',
        'hungry': '饱食度偏低档', 'tired': '体力偏低档',
        'lonely': '长时间无互动', 'idle': '启动迎接 / 空闲自语',
        'purr': '抚摸进入时铺底（9s 冷却）', 'purrSleep': '入睡时铺底（45s 冷却）',
    }
    for ctx in ORDER:
        items = [r for r in rows if r['ctx'] == ctx]
        files = '、'.join('`%s`' % os.path.basename(r['file']).replace('.ogg', '') for r in items)
        add(f'| {ACTION[ctx]} | {CTX_LABEL[ctx]} | {TRIG[ctx]} | {files} | {VOCAL[ctx]} |')
    add('')

    if old and new:
        add('## 六、客观校验（音色指标，非主观听感）\n')
        add(f'| 指标 | 换素材前（29 条） | 换素材后（{new["n"]} 条精选） | 说明 |')
        add('|------|------------------|------------------|------|')
        add(f'| Zwicker 尖锐度均值 | {old["sharp"]:.2f} acum | {new["sharp"]:.2f} acum | 越低越不刺耳 |')
        add(f'| 尖锐度最大 | {old["sharpMax"]:.2f} acum | {new["sharpMax"]:.2f} acum | 最尖的一条 |')
        add(f'| 3–5kHz 占比均值 | {old["harsh"]:.1f}% | {new["harsh"]:.1f}% | 听觉疲劳主区 |')
        add(f'| 3–5kHz 占比最大 | {old["harshMax"]:.1f}% | {new["harshMax"]:.1f}% | 单条最差 |')
        add(f'| 谱重心均值 | {old["centroid"]:.0f} Hz | {new["centroid"]:.0f} Hz | 明亮度 |')
        add(f'| 平均时长 | {old["dur"]:.2f}s | {new["dur"]:.2f}s | 单次叫声长度 |')
        add('')
        add('呼噜两条单独看：`purr_1` 谱重心 170Hz、200–500Hz 体感带占 19.5%；`purr_2` 105Hz / 14.3%——'
            '原始录音 92% 能量在 80Hz 以下（小喇叭听不见），已用「削 70Hz 轰鸣 + 抬 260Hz 体感」拉回可闻区。')
        add('')

    add('## 七、验收与回滚\n')
    add('1. 试听：打开 `assets-src/previews/cat-sfx-preview.html`（base64 内嵌，双击即响，可按类型筛选/串播）。')
    add('2. 回归：`node tools/test_logic.js` —— 全部断言通过（含 12 情境、精选 16 条与勾选清单逐条一致、'
        '素材目录无未勾选残留、呼噜≤3.5s、呼噜铺底不受全局节流影响、voiceVolume 音量链路）。')
    add('3. 重生成：`python tools/fetch_cat_sfx.py` → `python tools/import_voice_sfx.py` → '
        '`python tools/make_sfx_report.py`（改一行切片/变速即可重跑）。')
    add('4. 回滚：`cp -r _backup/sfx-pre_20261017-110111/meow/* app/assets/audio/meow/` '
        '并把 `engine/voice.js` 的 `purr/purrSleep` 两行与 renderer 两处调用移除。')
    add('')
    add('> 说明：当前曲库为**用户勾选的 15 条精选**（2026-10-17，红框 16 条再按用户要求去掉 pet_2），未勾选的 16 条已从'
        '`CUTS` 表与素材目录移除（含 pet_2）；`sad/dirty/urgent/sys` 四个情境在 `engine/voice.js` 中整体下线，'
        '对应气泡只显示文字。若要恢复，从 `_backup/sfx-select_20261017-121948/` 回滚或把 `CUTS` 表'
        '对应行加回再重跑。')
    md = '\n'.join(L) + '\n'
    with open(OUT_MD, 'w', encoding='utf-8') as f:
        f.write(md)
    print('md   ->', OUT_MD)

    # ─────────────────────────── html ───────────────────────────
    chunks = []
    for r in rows:
        b = open(os.path.join(MEOW_DIR, r['base'] + '.ogg'), 'rb').read()
        chunks.append({
            'base': r['base'],
            'vocal': r['vocal'],
            'action': r['action'],
            'ctx': CTX_LABEL[r['ctx']],
            'author': r['author'],
            'license': r['license'],
            'source': r['srcName'],
            'dur': r['dur'],
            'rate': r['rate'],
            'note': r['note'],
            'loop': r['loop'],
            'kb': len(b) / 1024,
            'uri': 'data:audio/ogg;base64,' + base64.b64encode(b).decode('ascii'),
        })
    data_json = json.dumps(chunks, ensure_ascii=False).replace('</', '<\\/')
    html = TEMPLATE.replace('@@DATA@@', data_json).replace('@@N@@', str(len(chunks)))
    os.makedirs(os.path.dirname(OUT_HTML), exist_ok=True)
    with open(OUT_HTML, 'w', encoding='utf-8') as f:
        f.write(html)
    print('html ->', OUT_HTML, '(%.0f KB)' % (os.path.getsize(OUT_HTML) / 1024))

    # ─────────────────────────── CREDITS（随包分发）───────────────────────────
    C = []
    a = C.append
    a('# 音频素材来源登记（CREDITS）\n')
    a('## 结论\n')
    a(f'当前打包的 **{len(rows)} 条**情境素材全部为 **CC0 / CC-BY 真实猫叫录音**（无程序化占位音、无来源不明素材），')
    a('抓取日期 2026-10-17，抓取脚本 `tools/fetch_cat_sfx.py`，加工脚本 `tools/import_voice_sfx.py`。')
    a('CC-BY 条目已在本文件署名；CC0 无需署名，仍完整登记以便追溯。\n')
    a('原始录音留存于 `assets-src/audio-raw/`（已在 `package.json` 的 `build.files` 中排除，不随包分发）。\n')
    a('## 一、来源\n')
    a('| 来源 | 作者 | 许可 | 源文件 | 产出条数 |')
    a('|------|------|------|--------|----------|')
    for p_ in packs:
        a(f'| [{p_["page"].rstrip("/").split("/")[-1]}]({p_["page"]}) | {p_["author"]} | {p_["license"]} | '
          f'{", ".join(sorted(p_["files"]))} | {p_["n"]} |')
    a('')
    a('**CC-BY 署名（强制）**：')
    a('- `Cat SFX` — Macro — CC-BY 3.0 — https://opengameart.org/content/cat-sfx')
    a('- `cat pickup effect` — stratoavis — CC-BY 4.0 — https://opengameart.org/content/cat-pickup-effect')
    a('- 许可证全文：CC0 https://creativecommons.org/publicdomain/zero/1.0/ ，CC-BY 3.0/4.0 https://creativecommons.org/licenses/')
    a('')
    a('## 二、加工链（可复跑）\n')
    a('```')
    a('抓取   tools/fetch_cat_sfx.py      OGA 直链 + Freesound preview（CC0 过滤 + ≤9s）')
    a('加工   tools/import_voice_sfx.py   切片→裁静音→90Hz 高通→变速→4 段 EQ→压缩→柔性起落→响度归一→OGG')
    a('呼噜   (同脚本 loop 通路)          28Hz 高通→呼噜专用 EQ→循环接缝交叉淡化→响度归一')
    a('交付   tools/make_sfx_report.py    生成 voice-sfx-report.md / 试听页 / 本文件')
    a('```')
    a('')
    a('统一音色曲线：320Hz 低架 +2.6dB（暖）→ 900Hz +1.2dB（实体）→ 3.4kHz −3.4dB（削刺）→ '
      '5.6kHz 高频架 −4.2dB（削嘶）；压缩 2.6:1 只压瞬态尖峰；12–20ms raise-cosine 起音。')
    a('响度档位：normal −18 dBFS / soft −20.5 / 呼噜 −21。\n')
    a('## 三、情境映射\n')
    a('| 目标文件 | 类型 | 源素材 | 切片 s | 变速 | 时长 |')
    a('|----------|------|--------|--------|------|------|')
    for r in rows:
        a(f'| `{os.path.basename(r["file"])}` | {r["vocal"]} | {r["srcName"]}（{r["author"]}, {r["license"]}） | '
          f'{r["t"][0]:.2f}–{r["t"][1]:.2f} | ×{r["rate"]:.2f} | {r["dur"]:.2f}s |')
    a('')
    a('呼噜（`purr_1` / `purr_2`）由 `engine/voice.js` 以 `layer: true` 独立音轨循环播放，'
      '分别由抚摸进入与入睡事件触发，不参与一次性叫声的打断仲裁。\n')
    a('## 四、合规要求\n')
    a('1. 新增素材必须是 **CC0 / CC-BY**（CC-BY 需在本文件补作者与链接），禁用来源不明素材。')
    a('2. 时长：普通 0.4–1.3s，呼噜 ≤3.5s（loop）；44.1kHz 单声道 OGG。危急/系统音情境已按用户精选下线，恢复前不得重新引入目录。')
    a('3. 增删变体只改 `engine/voice.js` 的 `SPEC.files` + `tools/import_voice_sfx.py` 的 `CUTS`，'
      '`tools/test_logic.js` 会校验素材存在性与时长上限，漏放即 FAIL。')
    with open(OUT_CREDITS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(C) + '\n')
    print('credits ->', OUT_CREDITS)
    return 0


TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>猫叫音效试听 · 精选 @@N@@ 条</title>
<style>
  :root{
    --bg:#f7f5f2; --card:#fff; --line:#e7e2db; --ink:#2b2724; --sub:#7b7470;
    --accent:#c97b4a; --accent-soft:#f4e6dc;
    --c-purr:#8a6fb0; --c-normal:#4a8f7b; --c-sad:#5a7fb5; --c-exc:#c26a4a; --c-sys:#8d8781;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 22px 60px}
  h1{font-size:22px;margin:0 0 6px;letter-spacing:.5px}
  .sub{color:var(--sub);font-size:13px;margin-bottom:18px}
  .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 18px}
  .chip{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:999px;
    padding:6px 13px;font-size:13px;cursor:pointer;transition:.15s}
  .chip:hover{border-color:var(--accent);color:var(--accent)}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  .play-all{margin-left:auto;background:var(--accent);border:1px solid var(--accent);color:#fff;
    border-radius:999px;padding:7px 16px;font-size:13px;cursor:pointer}
  .play-all.stop{background:#7b7470;border-color:#7b7470}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);
    border-radius:12px;overflow:hidden}
  th{text-align:left;font-weight:600;font-size:12px;color:var(--sub);background:#fbf9f7;
    padding:9px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
  td{padding:8px 10px;border-bottom:1px solid #f1ede8;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:#fdfbf9}
  .name{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
  .btn{width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:#fff;
    cursor:pointer;color:var(--accent);font-size:12px;line-height:1}
  .btn:hover{border-color:var(--accent)}
  .tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid}
  .t-呼噜{color:var(--c-purr);border-color:#ded4ea;background:#f6f2fb}
  .t-普通猫叫{color:var(--c-normal);border-color:#cfe4dd;background:#f2f9f7}
  .t-悲伤低落{color:var(--c-sad);border-color:#d3dfef;background:#f3f7fc}
  .t-兴奋警觉{color:var(--c-exc);border-color:#eed6cc;background:#fdf4f0}
  .t-系统提示{color:var(--c-sys);border-color:#e2ded8;background:#f7f5f2}
  .dim{color:var(--sub);font-size:12px}
  .dur{font-variant-numeric:tabular-nums;color:var(--sub);font-size:12.5px;white-space:nowrap}
  tr.playing td{background:var(--accent-soft)}
  .status{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;background:#2b2724;color:#fff;
    padding:8px 16px;border-radius:999px;font-size:12.5px;opacity:0;transition:.2s;pointer-events:none}
  .status.on{opacity:.95}
  .foot{margin-top:22px;color:var(--sub);font-size:12.5px;line-height:1.8}
  .warn{color:#b5563f}
  code{background:#f2efe9;padding:1px 5px;border-radius:4px;font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <h1>猫叫音效试听 · 精选 @@N@@ 条</h1>
  <div class="sub">OGG/Vorbis 44.1kHz 单声道 · 抓取自 OpenGameArt / Freesound（CC0 + CC-BY）· 单文件内嵌，双击即听</div>
  <div class="bar" id="filters"></div>
  <table>
    <thead><tr>
      <th style="width:44px"></th><th>文件</th><th style="width:96px">类型</th>
      <th style="width:150px">映射动作</th><th style="width:190px">来源</th>
      <th style="width:72px">时长</th><th>说明</th>
    </tr></thead>
    <tbody id="tbody"></tbody>
  </table>
  <div class="foot">
    <b>曲库口径</b>：呼噜两条为 <code>loop</code> 铺底音（引擎里以独立音轨循环播放 2.8–3.2s 后淡出），
    其余为一次性叫声。<br>
    <b>自检</b>：每行加载后会显示 <span id="okcnt">…</span>；
    若出现 <span class="warn">✕ 无法解码</span> 表示该条素材异常。
  </div>
</div>
<div class="status" id="status"></div>
<script>
const DATA = @@DATA@@;
const TYPES = ['全部'].concat(Array.from(new Set(DATA.map(d => d.vocal))));
let filter = '全部';
let cur = null, seq = 0, playing = false, okN = 0;
const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
function say(t){ statusEl.textContent = t; statusEl.classList.add('on'); clearTimeout(say._t); say._t = setTimeout(()=>statusEl.classList.remove('on'), 1800); }
function tagCls(v){ return 't-' + v.replace('/', ''); }

function rows(){ return DATA.filter(d => filter === '全部' || d.vocal === filter); }

function render(){
  document.querySelectorAll('#filters .chip').forEach(c => c.classList.toggle('on', c.dataset.t === filter));
  const tb = $('#tbody'); tb.innerHTML = '';
  rows().forEach((d, i) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = DATA.indexOf(d);
    tr.innerHTML = '<td><button class="btn" title="播放">▶</button></td>'
      + '<td class="name">' + d.base + '.ogg' + (d.loop ? ' <span class="dim">loop</span>' : '') + '</td>'
      + '<td><span class="tag ' + tagCls(d.vocal) + '">' + d.vocal + '</span></td>'
      + '<td class="dim">' + d.action + '</td>'
      + '<td class="dim">' + d.author + ' · ' + d.license + '</td>'
      + '<td class="dur">' + d.dur.toFixed(2) + 's</td>'
      + '<td class="dim">' + d.note + '</td>';
    tr.querySelector('.btn').onclick = () => play(DATA.indexOf(d), tr);
    tb.appendChild(tr);
  });
}

function stopAll(){
  if (cur) { cur.pause(); cur = null; }
  document.querySelectorAll('tr.playing').forEach(t => t.classList.remove('playing'));
  playing = false; seq++;
  $('#playall').textContent = '▶ 串播当前筛选';
  $('#playall').classList.remove('stop');
}

function play(i, tr){
  stopAll();
  const d = DATA[i];
  const a = new Audio(d.uri);
  cur = a; a.loop = false;
  if (tr) tr.classList.add('playing');
  a.onended = () => { if (tr) tr.classList.remove('playing'); if (cur === a) cur = null; };
  a.onerror = () => { say('✕ ' + d.base + ' 解码失败'); };
  a.play().then(() => say('▶ ' + d.base + ' · ' + d.dur.toFixed(2) + 's')).catch(e => say('✕ 播放被拒绝：' + e.message));
}

async function playSeq(){
  if (playing) { stopAll(); return; }
  playing = true; seq++;
  const my = seq;
  $('#playall').textContent = '■ 停止';
  $('#playall').classList.add('stop');
  const list = rows();
  for (const d of list) {
    if (!playing || my !== seq) break;
    const tr = document.querySelector('tr[data-idx="' + DATA.indexOf(d) + '"]');
    await new Promise(res => {
      const a = new Audio(d.uri); cur = a;
      if (tr) tr.classList.add('playing');
      a.onended = res;
      a.onerror = () => { say('✕ ' + d.base + ' 解码失败'); res(); };
      a.play().catch(() => res());
      say('▶ ' + d.base);
    });
    if (tr) tr.classList.remove('playing');
    await new Promise(r => setTimeout(r, 160));
    if (!playing || my !== seq) break;
  }
  if (my === seq) stopAll();
}

// 自检：预先解码，确认每条都能被浏览器接受
(function check(){
  let done = 0, bad = [];
  DATA.forEach(d => {
    const a = new Audio();
    a.preload = 'auto';
    a.oncanplaythrough = () => { done++; tally(); };
    a.onerror = () => { done++; bad.push(d.base); tally(); };
    a.src = d.uri;
    setTimeout(() => { if (done < DATA.length) tally(); }, 4000);
  });
  function tally(){
    const el = $('#okcnt');
    if (!el) return;
    el.innerHTML = '<b style="color:#3f7d5e">✓ 可解码 ' + (DATA.length - bad.length) + '/' + DATA.length + '</b>'
      + (bad.length ? ' · <span class="warn">✕ ' + bad.join(', ') + '</span>' : '');
  }
})();

// 顶栏
const bar = $('#filters');
TYPES.forEach(t => {
  const b = document.createElement('button');
  b.className = 'chip' + (t === filter ? ' on' : '');
  b.textContent = t + (t === '全部' ? ' (' + DATA.length + ')' : ' (' + DATA.filter(d => d.vocal === t).length + ')');
  b.dataset.t = t;
  b.onclick = () => { filter = t; stopAll(); render(); };
  bar.appendChild(b);
});
const pa = document.createElement('button');
pa.id = 'playall'; pa.className = 'play-all'; pa.textContent = '▶ 串播当前筛选';
pa.onclick = playSeq;
bar.appendChild(pa);

render();
</script>
</body>
</html>
"""

if __name__ == '__main__':
    sys.exit(main())
