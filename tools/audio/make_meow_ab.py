#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_meow_ab.py — 生成「柔化前 / 柔化后」A/B 对比试听页（单文件自包含）

为什么要 A/B：柔化是音色调整，只看数字无法判断"是否削过头变闷"。
把同一句喵的新旧两版并排放，各带客观指标（尖锐度 / 3–5k 占比 / 谱重心），
肉耳对照一遍就能定稿。

用法：python tools/audio/make_meow_ab.py [--old 旧素材目录]
输出：assets-src/previews/meow-preview-ab.html
"""
import base64
import csv
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # tools/
from _root import find_root  # noqa: E402

ROOT = find_root()
NEW = os.path.join(ROOT, 'app', 'assets', 'audio', 'meow')
OUT = os.path.join(ROOT, 'assets', 'previews', 'meow-preview-ab.html')

CTX = [
    ('pet', '抚摸 · 被摸', '互动'),
    ('eat', '进食 · 吃完', '互动'),
    ('play', '逗玩 · 扔球', '互动'),
    ('bath', '洗澡 · 入水', '互动'),
    ('wake', '唤醒', '互动'),
    ('call', '呼喊回应', '互动'),
    ('hungry', '饥饿（偏低）', '需求'),
    ('tired', '疲惫（偏低）', '需求'),
    ('sad', '心情低落', '需求'),
    ('dirty', '脏 / 脏乱', '需求'),
    ('lonely', '长时间无互动', '需求'),
    ('idle', '迎接 / 空闲', '自主'),
    ('urgent', '危急档 · 急促喵', '独立目录'),
    ('sys', '系统提示音 · 轻量', '轻提示'),
]


def find_old():
    cands = sorted(glob.glob(os.path.join(ROOT, '_backup', 'tone-pre_*', 'meow')))
    return cands[-1] if cands else None


def load_csv(name):
    p = os.path.join(ROOT, 'archive', 'audio-history', name)
    if not os.path.exists(p):
        return {}
    with open(p, encoding='utf-8-sig') as f:
        return {r['base']: r for r in csv.DictReader(f)}


def b64(path):
    return 'data:audio/ogg;base64,' + base64.b64encode(open(path, 'rb').read()).decode('ascii')


def ctx_of(base):
    return base.split('/')[0] if '/' in base else base.rsplit('_', 1)[0]


def main():
    old_dir = None
    if '--old' in sys.argv:
        old_dir = sys.argv[sys.argv.index('--old') + 1]
    old_dir = old_dir or find_old()
    if not old_dir or not os.path.isdir(old_dir):
        raise SystemExit('找不到旧素材目录，请用 --old 指定')

    base_csv = load_csv('_baseline_meow.csv')
    after_csv = load_csv('_after_meow.csv')

    files = sorted(glob.glob(os.path.join(NEW, '*.ogg'))) + \
            sorted(glob.glob(os.path.join(NEW, 'urgent', '*.ogg')))

    src_old, src_new = [], []
    groups = {}
    total = 0
    for p in files:
        rel = os.path.relpath(p, NEW).replace(os.sep, '/')
        op = os.path.join(old_dir, rel)
        if not os.path.exists(op):
            continue
        key = rel[:-4]
        src_old.append('  "%s": "%s"' % (key, b64(op)))
        src_new.append('  "%s": "%s"' % (key, b64(p)))
        total += os.path.getsize(p) + os.path.getsize(op)

        ob = base_csv.get(rel + '.ogg') or base_csv.get(key)
        nb = after_csv.get(rel + '.ogg') or after_csv.get(key)
        groups.setdefault(ctx_of(key), []).append({
            'key': key,
            'name': key.split('/')[-1],
            'old': ob, 'new': nb,
        })

    sections = []
    for ctx, label, cat in CTX:
        items = groups.get(ctx, [])
        if not items:
            continue
        rows = []
        for it in items:
            o, n = it['old'] or {}, it['new'] or {}
            cs_o = float(o.get('sharp', 0) or 0)
            cs_n = float(n.get('sharp', 0) or 0)
            h_o = float(o.get('harsh', 0) or 0) * 100
            h_n = float(n.get('harsh', 0) or 0) * 100
            c_o = float(o.get('centroid', 0) or 0)
            c_n = float(n.get('centroid', 0) or 0)
            d_n = float(n.get('dur', 0) or 0)
            delta = cs_n - cs_o
            cls = 'up' if delta > 0.02 else ('down' if delta < -0.02 else 'flat')
            rows.append(
                '<tr>'
                '<td class="nm">%s<span class="meta">%s · %.2fs</span></td>'
                '<td><button class="play old" data-k="%s" data-v="old">旧</button></td>'
                '<td><button class="play new" data-k="%s" data-v="new">新</button></td>'
                '<td class="num">%s → <b>%s</b></td>'
                '<td class="num">%s → <b>%s</b></td>'
                '<td class="num">%d → <b>%d</b></td>'
                '</tr>' % (
                    it['name'], cat, d_n, it['key'], it['key'],
                    ('%.2f' % cs_o), ('%.2f' % cs_n),
                    ('%.1f%%' % h_o), ('%.1f%%' % h_n),
                    round(c_o), round(c_n)))
        sections.append(
            '<section><h3>%s<span class="cnt">%d 条</span></h3>'
            '<table><thead><tr><th>素材</th><th>旧</th><th>新</th>'
            '<th>尖锐度 acum</th><th>3–5k 占比</th><th>谱重心 Hz</th></tr></thead>'
            '<tbody>%s</tbody></table></section>' % (label, len(items), ''.join(rows)))

    doc = (TEMPLATE
           .replace('@@N@@', str(sum(len(v) for v in groups.values())))
           .replace('@@KB@@', '%.0f' % (total / 1024.0))
           .replace('@@SECTIONS@@', '\n'.join(sections))
           .replace('@@OLD@@', ',\n'.join(src_old))
           .replace('@@NEW@@', ',\n'.join(src_new)))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(doc)
    print('written: %s  (%.0f KB)' % (OUT, os.path.getsize(OUT) / 1024))


TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>喵叫柔化 · 新旧 A/B 对比</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--line:#e3e7ee;--tx:#1f2430;--dim:#6b7486;--acc:#3f72c3;--ok:#2e8b57;--bad:#c0392b;--warm:#b8860b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:26px 30px 60px}
  header,main,footer{max-width:1000px;margin:0 auto}
  h1{font-size:20px;margin:0 0 6px}
  .sub{color:var(--dim);font-size:13px}
  .bar{display:flex;gap:10px;align-items:center;margin:14px 0 0;flex-wrap:wrap}
  button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--tx);border-radius:9px;padding:6px 13px;cursor:pointer;transition:.12s}
  button:hover{background:#f4f6f9;border-color:#c9d2e0;box-shadow:0 2px 6px rgba(31,36,48,.07)}
  button:active{background:#e6eaf1;transform:translateY(1px)}
  button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
  button.play-all{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
  button.play-all:hover{background:#3a67b0}
  .status{font-size:13px;padding:6px 12px;border-radius:8px;background:#eef1f6;color:var(--dim)}
  .status.ok{background:#e8f4ed;color:var(--ok)}
  .status.bad{background:#fbeceb;color:var(--bad);font-weight:600}
  section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px 16px 8px;margin:11px 0}
  h3{margin:0 0 8px;font-size:14px;font-weight:600}
  .cnt{margin-left:8px;font-weight:400;color:var(--dim);font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-weight:600;color:var(--dim);font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}
  td{padding:7px 8px;border-bottom:1px solid #f0f2f6;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  td.nm{font-weight:600}
  td.nm .meta{display:block;font-weight:400;color:var(--dim);font-size:11px}
  td.num{font-variant-numeric:tabular-nums;color:var(--dim);font-size:12px}
  td.num b{color:var(--tx)}
  button.play{padding:4px 11px;font-size:12px;min-width:52px}
  button.play.old{color:var(--dim)}
  button.play.new{border-color:#bcd3ea}
  button.play.on{background:#e8f4ed;border-color:var(--ok);color:var(--ok);font-weight:600}
  footer{margin-top:20px;color:var(--dim);font-size:12px}
  .hint{margin-top:6px;font-size:12px;color:var(--dim)}
  .tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;margin-left:6px;background:#eef1f6;color:var(--dim)}
</style></head><body>
<header>
  <h1>喵叫柔化 · 新旧 A/B 对比</h1>
  <div class="sub">共 <b>@@N@@</b> 条，音频已内嵌（单文件 @@KB@@ KB，无外部依赖）。
    「旧」= 上一版素材，「新」= 柔化后。数字为客观指标：尖锐度越低越不刺耳，3–5k 占比是刺耳主区能量。</div>
  <div class="bar">
    <button class="play-all" id="all">▶ 连续播放（新）</button>
    <button id="stop">■ 停止</button>
    <span class="status" id="status">正在自检…</span>
  </div>
  <div class="hint">建议顺序：先按情境听「旧→新」各一条，判断是否"变柔但没变闷"；再整轮连续播放确认 29 条性格统一。</div>
</header>
<main>
@@SECTIONS@@
</main>
<footer>柔化链：3.4kHz 削刺 + 5.6kHz 高频架衰减 + 320Hz 加暖 + 温和峰值压缩 + raise-cosine 起音。生成器 <code>tools/audio/import_meows.py</code>。</footer>
<audio id="au" preload="auto"></audio>
<script>
var OLD_SRC = {
@@OLD@@
};
var NEW_SRC = {
@@NEW@@
};
var au = document.getElementById('au');
var statusEl = document.getElementById('status');
var btns = [].slice.call(document.querySelectorAll('button.play'));
var queue = [], qi = 0, timer = null, okCount = 0, failCount = 0;

function setStatus(t, cls) { statusEl.textContent = t; statusEl.className = 'status' + (cls ? ' ' + cls : ''); }
function clearOn() { [].forEach.call(document.querySelectorAll('button.play.on'), function (b) { b.classList.remove('on'); }); }

/* 自检：每条新素材解析一次 */
(function selfCheck() {
  var keys = Object.keys(NEW_SRC), pending = keys.length;
  if (!pending) { setStatus('没有音频数据', 'bad'); return; }
  keys.forEach(function (k) {
    var a = new Audio(), done = false;
    function fin(ok, why) {
      if (done) return; done = true;
      if (ok) okCount++; else { failCount++; console.warn('decode fail', k, why); }
      if (--pending === 0) {
        if (failCount === 0) setStatus('自检通过：' + okCount + '/' + keys.length + ' 条可播放', 'ok');
        else setStatus('自检失败 ' + failCount + ' 条（浏览器可能不支持 Ogg，请用 Edge/Chrome）', 'bad');
      }
    }
    a.addEventListener('loadedmetadata', function () { fin(isFinite(a.duration)); });
    a.addEventListener('error', function () { fin(false, a.error && a.error.code); });
    a.src = NEW_SRC[k]; a.load();
    setTimeout(function () { fin(false, 'timeout'); }, 3000);
  });
})();

function play(k, v, btn) {
  clearTimeout(timer); queue = [];
  clearOn(); btn.classList.add('on');
  var uri = (v === 'old' ? OLD_SRC : NEW_SRC)[k];
  if (!uri) { setStatus('缺少音频：' + k, 'bad'); return; }
  try { au.pause(); } catch (e) {}
  au.src = uri; au.currentTime = 0;
  var p = au.play();
  if (p && p.catch) p.then(function () {
    setStatus((v === 'old' ? '旧' : '新') + '：' + k + '（' + (au.duration || 0).toFixed(2) + 's）', 'ok');
  }).catch(function (e) {
    setStatus(e && e.name === 'NotAllowedError' ? '浏览器拦截自动播放，请再点一次' : ('播放失败：' + (e && e.message)), 'bad');
  });
  au.onerror = function () { setStatus('无法播放 ' + k + '（error ' + (au.error && au.error.code) + '）', 'bad'); };
}

btns.forEach(function (b) { b.addEventListener('click', function () { play(b.dataset.k, b.dataset.v, b); }); });

document.getElementById('stop').addEventListener('click', function () {
  clearTimeout(timer); queue = []; clearOn();
  try { au.pause(); au.currentTime = 0; } catch (e) {}
  setStatus('已停止', '');
});

document.getElementById('all').addEventListener('click', function () {
  queue = [].slice.call(document.querySelectorAll('button.play.new'));
  qi = 0; step();
});

function step() {
  if (qi >= queue.length) { clearOn(); setStatus('连续播放完毕（' + queue.length + ' 条）', 'ok'); return; }
  var b = queue[qi++];
  play(b.dataset.k, 'new', b);
  setStatus('连续 ' + qi + '/' + queue.length + '：' + b.dataset.k, 'ok');
  au.onended = function () { timer = setTimeout(step, 400); };
}
</script></body></html>'''

if __name__ == '__main__':
    main()
