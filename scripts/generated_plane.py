#!/usr/bin/env python3
"""生成物路径清单（单一事实源）。

为什么单独一份：PR 守卫、主干重建 job、测试都要回答"这个文件是不是脚本生成的"。
三处各写一份清单，第一次改生成器输出就会漂移；漂移的表现是守卫放过或误拦，不报错。

生成物由脚本写、由主干 job 在合入后提交。提交者只交源文件，不跑生成器、不提交这些路径。
"""

from __future__ import annotations

GENERATED_FILES = (
    "knowledge/_index.yaml",
    "references/_summary-index.yaml",
    "references/_procedure-index.yaml",
    "references/errors/_code-gaps.yaml",
    "triage-tree.yaml",
    "metrics/timeline.yaml",
)

GENERATED_DIRS = (
    "knowledge/_index/",
    "references/_procedure-index/",
    "metrics/entry-activity/",
)

GENERATED_PATHS = GENERATED_FILES + GENERATED_DIRS


def normalize(path: str) -> str:
    """把 git 输出的路径归一到仓库相对形式（Windows 反斜杠、开头的 ./）。"""
    p = path.strip().replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    return p


def is_generated(path: str) -> bool:
    """这个路径是否属于生成物。目录以 / 结尾，按前缀判；文件按全等判。"""
    p = normalize(path)
    if not p:
        return False
    return p in GENERATED_FILES or any(p.startswith(d) for d in GENERATED_DIRS)
