#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
fetch_cat_sfx.py — 从 CC0 音效站抓取候选猫叫素材（只下载，不加工）

来源策略（本机实测可达性）：
  · OpenGameArt  https://opengameart.org        —— 直链 wav/ogg，许可写在页面
  · Freesound    https://freesound.org          —— 搜索页 HTML 内含 preview ogg 直链（免登录）
  · Wikimedia / archive.org / pixabay CDN       —— 本机不可达，不用

筛选原则：
  · 仅 CC0 / CC-BY（CC-BY 会在 CREDITS 补署名）；一律记录来源 URL、作者、许可
  · 时长 ≤ MAX_DUR（桌面宠物气泡叫声，过长无意义）
  · 按"用途标签"分类抓取：purr / normal / sad / excited / alert

产物：
  assets-src/audio-raw/oga/<file>                原始文件
  assets-src/audio-raw/freesound/<id>_<user>.<ext>
  assets-src/audio-raw/_sources.json             抓取清单（路径/来源/许可/时长/标签）

用法：
  python tools/fetch_cat_sfx.py              # 抓取全部标签
  python tools/fetch_cat_sfx.py --only purr  # 只抓某标签
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets-src', 'audio-raw')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
MAX_DUR = 9.0          # 原始素材时长上限（秒）
MAX_BYTES = 6 << 20    # 单文件上限

# ---------------------------------------------------------------- 抓取表
# tag: 用途标签；q: freesound 搜索词；n: 每个标签最多保留条数（按相关度）
FS_QUERIES = [
    ('purr',    'cat purr',              4),
    ('purr',    'kitten purring',        3),
    ('normal',  'cat meow',              8),
    ('normal',  'kitten meow',           6),
    ('sad',     'cat crying',            5),
    ('sad',     'sad kitten meow',       5),
    ('excited', 'cat trill chirp',       5),
    ('excited', 'excited kitten meow',   5),
    ('alert',   'cat alert meow',        5),
    ('alert',   'angry cat meow',        5),
]

# OpenGameArt 直链（CC0 / CC-BY 已验证，见 CREDITS.md）
OGA_FILES = [
    # (文件名, 标签, 素材包页面, 作者, 许可)
    ('cat_purractive_loop.wav', 'purr',   'https://opengameart.org/content/cat-purr-meow', 'Kerzoven', 'CC0 1.0'),
    ('cat_purrsleepy_loop.wav', 'purr',   'https://opengameart.org/content/cat-purr-meow', 'Kerzoven', 'CC0 1.0'),
    ('cat_softmew.wav',         'normal', 'https://opengameart.org/content/cat-purr-meow', 'Kerzoven', 'CC0 1.0'),
    ('cat_mewpurr.wav',         'normal', 'https://opengameart.org/content/cat-purr-meow', 'Kerzoven', 'CC0 1.0'),
    ('meowing_cat.mp3',         'normal', 'https://opengameart.org/content/meowing-cat-made-in-labchirp', 'LabChirp / OGA user', 'CC0 1.0'),
    ('Meow.ogg',                'normal', 'https://opengameart.org/content/meow', 'IgnasD', 'CC0 1.0'),
    ('kitten_mew-1.wav',        'sad',    'https://opengameart.org/content/kitten-mew', 'AntumDeluge', 'CC0 1.0'),
    ('Cat%201.wav',             'excited', 'https://opengameart.org/content/cat-sfx', 'Macro', 'CC-BY 3.0'),
    ('Cat%202.wav',             'excited', 'https://opengameart.org/content/cat-sfx', 'Macro', 'CC-BY 3.0'),
    ('Cat%203.wav',             'sad',    'https://opengameart.org/content/cat-sfx', 'Macro', 'CC-BY 3.0'),
    ('Cat%204.wav',             'alert',  'https://opengameart.org/content/cat-sfx', 'Macro', 'CC-BY 3.0'),
    ('Cat%205.wav',             'excited', 'https://opengameart.org/content/cat-sfx', 'Macro', 'CC-BY 3.0'),
    ('Cat%206.wav',             'sad',    'https://opengameart.org/content/cat-sfx', 'Macro', 'CC-BY 3.0'),
    ('Cat%207.wav',             'alert',  'https://opengameart.org/content/cat-sfx', 'Macro', 'CC-BY 3.0'),
    ('Cat%208.wav',             'normal', 'https://opengameart.org/content/cat-sfx', 'Macro', 'CC-BY 3.0'),
    ('catpickup.mp3',           'excited', 'https://opengameart.org/content/cat-pickup-effect', 'stratoavis', 'CC-BY 4.0'),
]


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Accept': '*/*',
        'Referer': 'https://freesound.org/',
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def download(url, dest_dir, name, max_bytes=MAX_BYTES):
    os.makedirs(dest_dir, exist_ok=True)
    path = os.path.join(dest_dir, name)
    if os.path.exists(path) and os.path.getsize(path) > 1024:
        return path, os.path.getsize(path)
    data = get(url, timeout=45)
    if len(data) > max_bytes:
        raise RuntimeError('too large: %d bytes' % len(data))
    with open(path, 'wb') as f:
        f.write(data)
    return path, len(data)


# ---------------------------------------------------------------- freesound
BLOCK_RE = re.compile(r'<div class="bw-search__result"')


def search_freesound(q, max_dur=MAX_DUR):
    """返回 [{id,name,user,ogg,mp3,dur,page}] —— 许可已由 URL 过滤为 CC0"""
    flags = 'license:"Creative Commons 0" duration:[0 TO %d]' % int(max_dur)
    url = ('https://freesound.org/search/?q=' + urllib.parse.quote_plus(q)
           + '&f=' + urllib.parse.quote_plus(flags) + '&s=score+desc')
    html = get(url).decode('utf-8', 'replace')
    out = []
    for seg in BLOCK_RE.split(html)[1:]:
        m_id = re.search(r'data-sound-id="(\d+)"', seg)
        m_ogg = re.search(r'data-ogg="([^"]+)"', seg)
        m_dur = re.search(r'data-duration="([\d.]+)"', seg)
        m_lab = re.search(r'aria-label="Sound (.+?) by (.+?)"', seg)
        m_lic = re.search(r'License: ([^"]+)"', seg)
        if not (m_id and m_ogg):
            continue
        if m_lic and 'Creative Commons 0' not in m_lic.group(1):
            continue
        name = m_lab.group(1) if m_lab else ''
        user = m_lab.group(2) if m_lab else ''
        dur = float(m_dur.group(1)) if m_dur else 0.0
        if dur <= 0.15 or dur > max_dur:
            continue
        sid = m_id.group(1)
        out.append({
            'id': sid, 'name': name, 'user': user,
            'ogg': m_ogg.group(1).replace('&amp;', '&'),
            'dur': dur,
            'page': 'https://freesound.org/people/%s/sounds/%s/' % (urllib.parse.quote(user), sid),
            'license': 'CC0 1.0',
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    only = set(x.strip() for x in args.only.split(',') if x.strip())

    os.makedirs(RAW, exist_ok=True)
    manifest_path = os.path.join(RAW, '_sources.json')
    manifest = []
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as f:
            manifest = json.load(f)

    def keep(tag):
        return (not only) or tag in only

    # --- OGA 直链
    for fname, tag, pack, author, lic in OGA_FILES:
        if not keep(tag):
            continue
        url = 'https://opengameart.org/sites/default/files/' + fname
        safe = urllib.parse.unquote(fname).replace(' ', '_')
        try:
            path, n = download(url, os.path.join(RAW, 'oga'), safe)
            print('[OGA] %-28s %7.1f KB  %s' % (safe, n / 1024, tag))
            manifest.append({
                'file': os.path.relpath(path, RAW).replace('\\', '/'),
                'tag': tag, 'origin': 'OpenGameArt', 'url': url, 'page': pack,
                'author': author, 'license': lic, 'bytes': n,
            })
        except Exception as e:                                  # noqa: BLE001
            print('[OGA] FAIL %-28s %s' % (safe, e))

    # --- Freesound（按标签限量）
    got = {}
    for tag, q, n in FS_QUERIES:
        if not keep(tag):
            continue
        try:
            items = search_freesound(q)
        except Exception as e:                                  # noqa: BLE001
            print('[FS ] FAIL search %-24s %s' % (q, e))
            continue
        print('[FS ] %-26s → %d 条候选' % (q, len(items)))
        for it in items:
            have = got.setdefault(tag, 0)
            if have >= n:
                break
            ext = '.ogg'
            name = '%s_%s%s' % (it['id'], re.sub(r'[^A-Za-z0-9]+', '', it['user'])[:14] or 'anon', ext)
            try:
                path, nb = download(it['ogg'], os.path.join(RAW, 'freesound'), name)
            except Exception as e:                              # noqa: BLE001
                print('[FS ]   FAIL %s %s' % (name, e))
                continue
            got[tag] = have + 1
            print('[FS ]   + %-30s %5.1fs %6.1f KB  %s' % (name, it['dur'], nb / 1024, it['name'][:40]))
            manifest.append({
                'file': os.path.relpath(path, RAW).replace('\\', '/'),
                'tag': tag, 'origin': 'Freesound', 'url': it['ogg'], 'page': it['page'],
                'author': it['user'], 'license': it['license'],
                'name': it['name'], 'srcDur': it['dur'], 'bytes': nb,
            })
        time.sleep(0.4)

    # 去重写盘
    seen = set()
    uniq = []
    for m in manifest:
        if m['file'] in seen:
            continue
        seen.add(m['file'])
        uniq.append(m)
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(uniq, f, ensure_ascii=False, indent=2)
    print('\n清单：%s（%d 条）' % (manifest_path, len(uniq)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
