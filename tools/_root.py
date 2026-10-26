# -*- coding: utf-8 -*-
"""仓库根定位工具。

tools/ 下脚本分属 check/probe/sprites/audio/legacy 子目录，`dirname(dirname(__file__))`
不再等于仓库根。统一改为「向上逐级查找同时含 app/ 与 tools/ 的祖先」，脚本在仓库内
任意位置被调用（含被其它脚本 import）都能定位正确。

用法：
    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from _root import find_root
    ROOT = find_root()
"""
import os

_MARKERS = ('app', 'tools')


def find_root(start=None):
    """从 start（默认本文件所在目录）向上查找仓库根，找不到则退回 start 的两级上。"""
    d = os.path.abspath(start or os.path.dirname(os.path.abspath(__file__)))
    cur = d
    while True:
        if all(os.path.isdir(os.path.join(cur, m)) for m in _MARKERS):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:                       # 已到盘根
            return os.path.dirname(d)
        cur = parent


ROOT = find_root()
