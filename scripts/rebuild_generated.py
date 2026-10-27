#!/usr/bin/env python3
"""重建全部生成物。

PR 只交源文件；本脚本是"生成物由谁写"的唯一实现：
  - 主干重建 job：合入后跑 `--check`，有 diff 就提交；
  - PR CI：跑默认模式，让后续检查读到一份与源一致的工作树；
  - 本地复现：`python3 scripts/rebuild_generated.py --check`。

为什么用 `sys.executable` 而不是写死 `python3`：Windows 上 `python3` 常不存在
（装的是 `python` / `py -3`），CI 与本地跑同一个解释器可以少一类环境差异。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from _stdio import pin_utf8_stdio
from generated_plane import GENERATED_PATHS

ROOT = Path(__file__).resolve().parent.parent

# 顺序按依赖从少到多：索引与 reference 索引互相独立，路由聚合最后。
BUILDERS = (
    "scripts/build_index.py",
    "scripts/build_ref_summary_index.py",
    "scripts/build_procedure_index.py",
    "scripts/build_error_gap_index.py",
    "scripts/build_triage_tree.py",
    "scripts/build_timeline.py",
    "scripts/build_entry_activity.py",
)

CHECKS = (
    ("scripts/build_index.py", ("--check",)),
    ("scripts/build_ref_summary_index.py", ("--check",)),
    ("scripts/build_procedure_index.py", ("--check",)),
    ("scripts/build_error_gap_index.py", ("--check",)),
    ("scripts/build_triage_tree.py", ("--check-sources",)),
    ("scripts/build_triage_tree.py", ("--check-coverage",)),
    ("scripts/build_triage_tree.py", ("--check",)),
    ("scripts/build_timeline.py", ("--check",)),
    ("scripts/build_entry_activity.py", ("--check",)),
)


def run(script: str, args: tuple[str, ...] = ()) -> None:
    cmd = [sys.executable, str(ROOT / script), *args]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        print(f"失败：{' '.join(cmd)}", file=sys.stderr)
        if p.stdout:
            print(p.stdout, file=sys.stderr)
        if p.stderr:
            print(p.stderr, file=sys.stderr)
        raise SystemExit(p.returncode)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="重建全部生成物（PR 不提交它们；主干 job 用 --check 后提交）"
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="生成后再跑各生成器的覆盖/一致性检查（主干 job 用这个；失败即退出）",
    )
    ap.add_argument(
        "--list",
        action="store_true",
        help="只打印生成物路径，不生成（守卫 / 文档 / 测试取清单用）",
    )
    args = ap.parse_args()

    if args.list:
        print("\n".join(GENERATED_PATHS))
        return 0

    for script in BUILDERS:
        run(script)
        print(f"生成 {script}")

    if args.check:
        for script, extra in CHECKS:
            run(script, extra)
            print(f"检查 {script} {' '.join(extra)}")

    return 0


if __name__ == "__main__":
    pin_utf8_stdio()
    raise SystemExit(main())
