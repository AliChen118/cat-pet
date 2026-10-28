#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成「喵叫素材试听」页面 —— 单文件自包含版。

为什么内嵌而不是相对路径引用：
  试听页常被放在内置预览面板 / 沙箱 iframe / 别人机器上打开。相对路径
  `../../app/assets/audio/meow/x.ogg` 在 http 服务根被限定为
  assets-src/previews/ 时会越出根目录被拒（404），表现为「点了没反应、没声音」，
  且页面没有任何失败提示，极难自查。改成 base64 内嵌后：
    - 任意打开方式（file:// / http / iframe / 拷贝分享）都能播；
    - 无需 extern 目录，单文件可独立分发。

用法：python tools/audio/make_meow_preview.py
输出：assets-src/previews/meow-preview.html
"""
import base64
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # tools/
sys.path.insert(0, HERE)                    # 同目录兄弟模块
from _root import find_root  # noqa: E402

ROOT = find_root()

spec = importlib.util.spec_from_file_location('im', os.path.join(HERE, 'import_meows.py'))
im = importlib.util.module_from_spec(spec)
spec.loader.exec_module(im)

MEOW_DIR = os.path.join(ROOT, 'app', 'assets', 'audio', 'meow')
OUT = os.path.join(ROOT, 'assets', 'previews', 'meow-preview.html')

# 情境展示顺序与中文标签
CTX = [
    ('pet', '抚摸 · 被摸', '互动 · 单个短喵'),
    ('eat', '进食 · 吃完', '互动 · 满足短喵'),
    ('play', '逗玩 · 扔球', '互动 · 兴奋'),
    ('bath', '洗澡 · 入水', '互动 · 委屈'),
    ('wake', '唤醒', '互动 · 迷迷糊糊'),
    ('call', '呼喊回应', '互动 · 应答'),
    ('hungry', '饥饿（偏低）', '需求 · 讨食'),
    ('tired', '疲惫（偏低）', '需求 · 拖长低音'),
    ('sad', '心情低落', '需求 · 低落'),
    ('dirty', '脏 / 脏乱', '需求 · 抱怨'),
    ('lonely', '长时间无互动', '需求 · 寻找'),
    ('idle', '迎接 / 空闲', '自主'),
    ('urgent', '危急档 · 急促喵', '独立目录 · 可打断'),
    ('sys', '系统提示音 · 轻量', '0.16s · 增益 0.45'),
]


def ctx_of(base):
    return base.split('/')[0] if '/' in base else base.rsplit('_', 1)[0]


def main():
    entries = []
    total_bytes = 0
    for base in im.TARGETS:                      # 保持 import 脚本里的定义顺序
        p = os.path.join(MEOW_DIR, base + '.ogg')
        if not os.path.exists(p):
            raise SystemExit('missing audio: %s' % p)
        raw = open(p, 'rb').read()
        total_bytes += len(raw)
        entries.append({
            'base': base,
            'ctx': ctx_of(base),
            'rate': im.TARGETS[base][3],
            'bytes': len(raw),
            'uri': 'data:audio/ogg;base64,' + base64.b64encode(raw).decode('ascii'),
        })

    by_ctx = {}
    for e in entries:
        by_ctx.setdefault(e['ctx'], []).append(e)

    sections = []
    for ctx, label, note in CTX:
        items = by_ctx.get(ctx, [])
        if not items:
            continue
        cells = ''.join(
            '<button class="snd" data-base="%s"><span class="nm">%s</span>'
            '<span class="meta"><span class="dur" data-for="%s">…</span> · ×%.2f</span>'
            '<span class="st" data-st="%s"></span></button>'
            % (e['base'], e['base'], e['base'], e['rate'], e['base'])
            for e in items
        )
        sections.append(
            '<section><h3>%s<span class="cnt">%d 条</span><span class="note">%s</span></h3>'
            '<div class="grid">%s</div></section>' % (label, len(items), note, cells)
        )

    src_map = ',\n'.join('  %s: "%s"' % (_js(e['base']), e['uri']) for e in entries)

    doc = (TEMPLATE
           .replace('@@N@@', str(len(entries)))
           .replace('@@KB@@', '%.0f' % (total_bytes / 1024.0))
           .replace('@@SECTIONS@@', '\n'.join(sections))
           .replace('@@SRCMAP@@', src_map))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(doc)
    size = os.path.getsize(OUT)
    print('written: %s' % OUT)
    print('sounds: %d  |  audio %d KB  |  html %.0f KB' % (len(entries), total_bytes / 1024, size / 1024))


def _js(s):
    return '"%s"' % s if all(c.isalnum() or c in '_-' for c in s) else '"%s"' % s.replace('"', '\\"')


TEMPLATE = r'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>喵叫素材试听 · 阶段 2</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--line:#e3e7ee;--tx:#1f2430;--dim:#6b7486;--acc:#3f72c3;--ok:#2e8b57;--bad:#c0392b;--warn:#b8860b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:26px 30px 60px}
  header{max-width:980px;margin:0 auto 14px}
  h1{font-size:20px;margin:0 0 6px}
  .sub{color:var(--dim);font-size:13px}
  .bar{display:flex;gap:10px;align-items:center;margin:14px 0 0;flex-wrap:wrap}
  button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--tx);border-radius:10px;padding:8px 14px;cursor:pointer;transition:.12s}
  button:hover{background:#f4f6f9;border-color:#c9d2e0;box-shadow:0 2px 6px rgba(31,36,48,.07)}
  button:active{background:#e6eaf1;transform:translateY(1px)}
  button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
  button.play-all{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
  button.play-all:hover{background:#3a67b0}
  .status{font-size:13px;padding:6px 12px;border-radius:8px;background:#eef1f6;color:var(--dim)}
  .status.ok{background:#e8f4ed;color:var(--ok)}
  .status.bad{background:#fbeceb;color:var(--bad);font-weight:600}
  .status.warn{background:#fdf6e3;color:var(--warn)}
  main{max-width:980px;margin:0 auto}
  section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px 16px 15px;margin:11px 0}
  h3{margin:0 0 10px;font-size:14px;font-weight:600;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  .cnt{font-weight:400;color:var(--dim);font-size:12px}
  .note{font-weight:400;color:#98a1b3;font-size:12px;margin-left:auto}
  .grid{display:flex;gap:9px;flex-wrap:wrap}
  .snd{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:152px;text-align:left;position:relative;padding-right:26px}
  .snd .nm{font-weight:600;font-size:13px}
  .snd .meta{color:var(--dim);font-size:12px}
  .snd .st{position:absolute;right:9px;top:50%;transform:translateY(-50%);font-size:12px}
  .snd[data-state="ok"] .st{color:var(--ok)}
  .snd[data-state="bad"]{border-color:#e8b4ae;background:#fdf5f4}
  .snd[data-state="bad"] .st{color:var(--bad)}
  .snd.on{border-color:var(--ok);box-shadow:0 0 0 2px rgba(46,139,87,.18)}
  footer{max-width:980px;margin:20px auto 0;color:var(--dim);font-size:12px}
  code{background:#eef1f6;border-radius:4px;padding:1px 5px;font-size:12px}
  .hint{margin-top:6px;font-size:12px;color:var(--dim)}
</style></head><body>
<header>
  <h1>喵叫素材试听 · 阶段 2（真实 CC0 录音）</h1>
  <div class="sub">共 <b>@@N@@</b> 条 / 14 个情境，音频已内嵌（单文件 @@KB@@ KB，无外部依赖）。点单条试听；「连续试听」按顺序自动播一遍。</div>
  <div class="bar">
    <button class="play-all" id="all">▶ 连续试听全部</button>
    <button id="stop">■ 停止</button>
    <span class="status" id="status">正在自检音频…</span>
  </div>
  <div class="hint">若按钮显示红色 ✕ 或状态条报错，说明当前浏览器/播放环境不支持该音频格式，请改用 Edge / Chrome 打开本文件。</div>
</header>
<main>
@@SECTIONS@@
</main>
<footer>素材为 CC0，来源与每条加工参数见 <code>app/assets/audio/CREDITS.md</code>。引擎侧另有 muted / volume / voice 三重门禁，实际响度随设置缩放。</footer>
<audio id="au" preload="auto"></audio>
<script>
var SRC = {
@@SRCMAP@@
};
var au = document.getElementById('au');
var statusEl = document.getElementById('status');
var allBtns = [].slice.call(document.querySelectorAll('.snd'));
var queue = [], qi = 0, timer = null, failCount = 0, okCount = 0;

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}
function mark(el) {
  var on = document.querySelectorAll('.snd.on');
  for (var i = 0; i < on.length; i++) on[i].classList.remove('on');
  if (el) el.classList.add('on');
}
function durText(e) {
  var el = document.querySelector('.dur[data-for="' + e.base + '"]');
  if (el) el.textContent = e.dur.toFixed(2) + 's';
}

/* ---- 自检：逐条用 Audio 解析内嵌数据，确认可播放并取到时长效 ---- */
var entries = allBtns.map(function (b) { return { base: b.dataset.base, el: b, dur: 0, done: false }; });
var pending = entries.length;
entries.forEach(function (e) {
  var a = new Audio();
  var settled = false;
  function finish(ok, why) {
    if (settled) return;
    settled = true;
    e.done = true;
    if (ok) {
      okCount++;
      e.el.dataset.state = 'ok';
      e.el.querySelector('.st').textContent = '✓';
      durText(e);
    } else {
      failCount++;
      e.el.dataset.state = 'bad';
      e.el.querySelector('.st').textContent = '✕';
      e.el.title = why || '无法解码';
      e.el.querySelector('.dur').textContent = '失败';
    }
    if (--pending === 0) {
      if (failCount === 0) setStatus('自检通过：' + okCount + '/' + entries.length + ' 条可播放，点任意按钮试听', 'ok');
      else setStatus('自检发现问题：' + failCount + ' 条无法解码（已标红）', 'bad');
    }
  }
  a.addEventListener('loadedmetadata', function () {
    if (!isFinite(a.duration)) return finish(false, '时长异常');
    e.dur = a.duration;
    finish(true);
  });
  a.addEventListener('error', function () {
    var code = a.error && a.error.code;
    finish(false, 'error code=' + code + ' (' + ({1:'加载中止',2:'网络错误',3:'解码失败',4:'格式不支持'}[code] || '未知') + ')');
  });
  a.src = SRC[e.base];
  a.load();
  setTimeout(function () { if (!settled) finish(false, '3s 内未解析完成'); }, 3000);
});

/* ---- 播放 ---- */
function playBase(base, el) {
  var uri = SRC[base];
  if (!uri) { setStatus('缺少音频数据：' + base, 'bad'); return; }
  clearTimeout(timer); queue = [];
  mark(el);
  try { au.pause(); } catch (_) {}
  au.src = uri;
  au.currentTime = 0;
  var p = au.play();
  if (p && p.catch) {
    p.then(function () {
      setStatus('正在播放：' + base + '（' + au.duration.toFixed(2) + 's）', 'ok');
    }).catch(function (err) {
      var msg = err && err.name === 'NotAllowedError'
        ? '浏览器拦截了自动播放，请再点一次按钮'
        : '播放失败：' + (err && err.message ? err.message : err);
      setStatus(msg, 'bad');
    });
  }
  au.onerror = function () {
    var code = au.error && au.error.code;
    setStatus('无法播放 ' + base + '：error code=' + code + '（格式不支持或数据损坏）', 'bad');
  };
}
allBtns.forEach(function (b) {
  b.addEventListener('click', function () { playBase(b.dataset.base, b); });
});

document.getElementById('stop').addEventListener('click', function () {
  clearTimeout(timer); queue = []; mark(null);
  try { au.pause(); au.currentTime = 0; } catch (_) {}
  setStatus('已停止', '');
});

document.getElementById('all').addEventListener('click', function () {
  queue = allBtns.slice(); qi = 0; step();
});

function step() {
  if (qi >= queue.length) { mark(null); setStatus('连续试听播放完毕（' + queue.length + ' 条）', 'ok'); return; }
  var b = queue[qi++];
  playBase(b.dataset.base, b);
  setStatus('连续试听 ' + qi + '/' + queue.length + '：' + b.dataset.base, 'ok');
  au.onended = function () { timer = setTimeout(step, 420); };
}
</script></body></html>'''

if __name__ == '__main__':
    main()
