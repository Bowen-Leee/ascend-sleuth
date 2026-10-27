#!/usr/bin/env python3
"""enable_agent_skills.py —— 关联 agent 与本仓库 skills/（项目级目录链接）

跨平台、幂等可重跑。替代原 enable-agent-skills.sh：`.sh` 在 Windows 上只有 Git Bash
能跑，且 `core.autocrlf=true`（Git for Windows 默认）会让 CRLF 进 shebang / `set -euo
pipefail` 直接报错；即使跑起来，Git Bash 的 `ln -s` 默认退化成**复制**——建出的是
skills/ 的目录副本而非链接，之后 git pull 更新 SKILL.md 不再同步。Python 三平台统一，
Windows 分支先试真 symlink（需 Developer Mode），失败退到 `mklink /J`（junction，免管理员）。

检测策略（两检测，覆盖主流场景）：
  - 配置目录存在（~/.dsh、~/.claude 等六家）——装了 agent 并用过即有目录，是最可靠的信号；
  - 或命令可执行（dsh、claude 等六家）——CLI 版即使目录不在默认位置也能命中。
  两者皆无 → 该 agent 未检测到（不建；可用 --all 或 --agents 手动指定），
  Windows 上逐个打印跳过的原因。
`.dsh` 是例外：`.dsh/skills` 是本仓自己跟踪的条目，任何模式（含 --agents）都修，不参与检测。
  DSH Desktop 的 home 不在 ~/.dsh、不装 dsh 命令，两条检测都不成立；而 Windows clone 下
  它落成内容为 `../skills` 的文本文件，正是必须修的那一个。
某个目录已存在却不是链接（Git Bash `ln -s` 退化成副本、破损的 reparse 点等）→ 打印 ⚠️
  跳过、以非 0 退出，不假装配好了。
只建项目级配置，不碰 agent 全局配置。

用法：
  python3 scripts/enable_agent_skills.py                        # 自动检测已安装 agent
  python3 scripts/enable_agent_skills.py --agents claude,codex  # 手动指定
  python3 scripts/enable_agent_skills.py --all                  # 全部建（不管装没装）
  python3 scripts/enable_agent_skills.py --no-git-adjust      # 不自动做 git 侧适配
"""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_DIR / "skills"
REL_TARGET = "../skills"  # 相对链接：仓库整体挪位置也不失效

# label / 仓库内目录 / 命令
AGENTS: list[tuple[str, str, str]] = [
    ("DeepSeek Harness", ".dsh", "dsh"),
    ("Claude Code", ".claude", "claude"),
    ("Cursor", ".cursor", "cursor"),
    ("Trae", ".trae", "trae"),
    ("CodeBuddy", ".codebuddy", "codebuddy"),
    ("Codex", ".codex", "codex"),
]

# 不参与检测的一家：`.dsh/skills` 是本仓自己跟踪的条目（index mode 120000），Windows clone 下
# 落成内容为 `../skills` 的文本文件，必须修好。它不取决于「检测到 DSH 装了」——DSH Desktop 的
# home 在 %APPDATA%\dsh-desktop\harness、不装 dsh 命令，人手动开的 PowerShell 里两条检测都不成立。
REPO_OWNED_DIR = ".dsh"

IO_REPARSE_TAG_MOUNT_POINT = getattr(stat, "IO_REPARSE_TAG_MOUNT_POINT", 0xA0000003)


def is_link(path: Path) -> bool:
    """symlink 或 Windows junction（两者都是 reparse point）。"""
    try:
        info = path.lstat()
    except OSError:
        return False
    if path.is_symlink():
        return True
    # Windows junction 未必被 is_symlink 认出来，按 reparse tag 兜底
    return getattr(info, "st_reparse_tag", 0) == IO_REPARSE_TAG_MOUNT_POINT


def points_to(path: Path, target: Path) -> bool:
    """链接/目录最终是否落在 target（symlink、junction、真实目录都适用）。"""
    try:
        return path.resolve() == target.resolve()
    except OSError:
        return False


def link_kind(path: Path) -> str:
    return "symlink" if path.is_symlink() else "junction"


def make_link(link: Path, target: Path) -> str:
    """建目录链接，返回实际用上的类型（'symlink' / 'junction'）。"""
    relative = os.path.relpath(target, link.parent)
    if os.name == "nt":
        try:
            os.symlink(relative, link, target_is_directory=True)  # 需 Developer Mode / 建链接权限
            return "symlink"
        except OSError:
            pass  # WinError 1314 等：无 symlink 权限 → 退到 junction
        # junction 目标必须是绝对本地路径；mklink 是 cmd 内建命令，免管理员
        subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            check=True, capture_output=True, text=True,
            encoding="utf-8", errors="replace")
        return "junction"
    os.symlink(relative, link)
    return "symlink"


def ensure_link(agent_dir: Path, label: str, target: Path) -> tuple[str, str | None]:
    """保证 <agent_dir>/skills 指向 target。返回 (报告行, 链接类型)。"""
    link = agent_dir / "skills"

    if is_link(link):
        if points_to(link, target):
            return f"[{label}] 已配置：{link} -> {REL_TARGET}（{link_kind(link)}）", link_kind(link)
        return (
            f"[{label}] ⚠️  {link} 是指向别处的链接（仓库挪过位置？）——跳过；"
            f"确认后手动删除再重跑",
            None,
        )

    if link.is_file():
        # Windows core.symlinks=false clone 残留：内容为目标路径的普通文本文件
        try:
            content = link.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            content = ""
        if content in (REL_TARGET, str(target)):
            link.unlink()
            agent_dir.mkdir(parents=True, exist_ok=True)
            kind = make_link(link, target)
            return (
                f"[{label}] ✅ 已修正：{link} 原为文本文件（Windows clone 残留）→ 重建为 {kind}",
                kind,
            )
        return f"[{label}] ⚠️  {link} 是普通文件（内容不是 {REL_TARGET}）——跳过，请手动处理", None

    if link.exists():
        # 真实目录：可能是 Git Bash `ln -s` 退化成副本的结果，也可能是用户自己放的，删不得
        return (
            f"[{label}] ⚠️  {link} 已存在且不是链接（ln -s 退化成副本？）——跳过，"
            f"确认后可手动删除再重跑",
            None,
        )

    agent_dir.mkdir(parents=True, exist_ok=True)
    kind = make_link(link, target)
    return f"[{label}] ✅ 已配置：{link} -> {REL_TARGET}（{kind}）", kind


def git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace")


def ensure_core_symlinks(repo: Path) -> str | None:
    """Windows 上仓库里已有真 symlink 时，让 git 也按 symlink 比对，避免"类型变更"脏状态。"""
    if os.name != "nt":
        return None
    try:
        current = git(repo, "config", "--local", "--get", "core.symlinks").stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        current = ""  # 未设置（git 默认在 Windows 上是 false）
    if current.lower() == "true":
        return None
    try:
        git(repo, "config", "--local", "core.symlinks", "true")
    except (OSError, subprocess.CalledProcessError) as exc:
        return f"⚠️  设置 core.symlinks=true 失败：{exc}"
    return "✅ 已设置 core.symlinks=true（git 按 symlink 比对 .dsh/skills，保持 status 干净）"


def ensure_skip_worktree(repo: Path, rel_path: str) -> str | None:
    """Windows 上 .dsh/skills 被建成 junction 时，git 会永久显示 ` D .dsh/skills`，
    且 `git pull --rebase` 每次都失败（cannot pull with rebase: You have unstaged changes）。
    该路径在仓库里是 mode 120000 的 symlink 条目，内容不会变，用 skip-worktree 让 git
    忽略它的工作区状态即可；万一上游真的改了这个链接，git 会拒绝合并并提示
    `git update-index --no-skip-worktree .dsh/skills` 后再来。"""
    if os.name != "nt":
        return None
    try:
        tracked = git(repo, "ls-files", "-s", "--", rel_path).stdout
    except (OSError, subprocess.CalledProcessError):
        return None  # 不是 git 仓库 / 无 git：与本脚本无关
    if not tracked.startswith("120000"):
        return None  # 该路径未被跟踪为 symlink（如已取消跟踪）→ 无需处理
    try:
        git(repo, "update-index", "--skip-worktree", "--", rel_path)
    except (OSError, subprocess.CalledProcessError) as exc:
        return f"⚠️  {rel_path} 设置 skip-worktree 失败：{exc}"
    return (
        f"✅ 已对 {rel_path} 设置 skip-worktree"
        f"（消除永久 ` D` 脏状态与 pull --rebase 失败；上游改该链接时 git 会提示撤销）"
    )


def detected(conf_dir: str, cmd: str) -> bool:
    """本机是否装了该 agent：配置目录存在，或命令可执行。

    两条都不覆盖「home 不在 `~` 下」的形态（DSH Desktop 把 home 放在
    `%APPDATA%\\dsh-desktop\\harness`）——该形态对应的 `.dsh` 不参与检测，见 REPO_OWNED_DIR。
    """
    return (Path.home() / conf_dir).is_dir() or shutil.which(cmd) is not None


def skip_reason(conf_dir: str, cmd: str) -> str:
    """自动模式判定「未安装」时，逐条给出两条检测的实际取值，让用户看出是误判还是真没装。"""
    return f"~/{conf_dir} 不存在、PATH 上没有 {cmd}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="为已安装的 agent 建项目级 skills 链接（指向本仓库 skills/）",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--agents", metavar="LIST", help="逗号分隔手动指定，如 claude,codex")
    group.add_argument("--all", action="store_true", help="全部建（不管装没装）")
    parser.add_argument(
        "--no-git-adjust", action="store_true",
        help="Windows 上不自动做 git 侧适配（junction 的 skip-worktree / 真 symlink 的 core.symlinks）",
    )
    args = parser.parse_args(argv)

    if not SKILLS_DIR.is_dir():
        print(f"错误：{SKILLS_DIR} 不存在（请确认在 ascend-sleuth 仓库内运行）", file=sys.stderr)
        return 1

    known = [conf_dir.lstrip(".") for _, conf_dir, _ in AGENTS]
    if args.agents:
        wanted = {item.strip().lstrip(".") for item in args.agents.split(",") if item.strip()}
        mode = "manual"
        unknown = sorted(wanted - set(known))
        if unknown:
            print(f"--agents 里有不认识的名字：{'、'.join(unknown)}")
            print("可写：" + " ".join(known))
            return 1
    else:
        wanted = set()
        mode = "all" if args.all else "auto"

    unresolved: list[str] = []
    skipped: list[str] = []
    for label, conf_dir, cmd in AGENTS:
        if conf_dir == REPO_OWNED_DIR:
            want = True  # 仓库自己的条目，任何模式都修
        elif mode == "manual":
            want = conf_dir.lstrip(".") in wanted
        elif mode == "all":
            want = True
        else:
            want = detected(conf_dir, cmd)
        if not want:
            skipped.append(f"[跳过] {label}：{skip_reason(conf_dir, cmd)}")
            continue
        report, kind = ensure_link(REPO_DIR / conf_dir, label, SKILLS_DIR)
        print(report)
        if kind is None:  # 已有同名目录 / 指向别处的链接：没建好，也不替用户删
            unresolved.append(label)

    if os.name == "nt" and mode == "auto" and skipped:
        # Windows 上「没建」与「建好了」必须在输出里分开：这正是 `.dsh/skills` 长期修不上的成因。
        # 其他平台的 symlink 随检出就有，跳过一个 agent 没有后果，不必刷屏。
        print()
        for line in skipped:
            print(line)
        print("要连未检测到的 agent 一起建：python3 scripts/enable_agent_skills.py --all")

    if os.name == "nt" and not args.no_git_adjust:
        link = REPO_DIR / ".dsh" / "skills"
        if link.is_symlink():  # 真 symlink（Developer Mode 生效）→ 让 git 也按 symlink 比对
            note = ensure_core_symlinks(REPO_DIR)
        elif is_link(link):  # junction → git 侧需 skip-worktree
            note = ensure_skip_worktree(REPO_DIR, ".dsh/skills")
        else:  # 不是链接（目录副本 / 破损残留）：不动 git 配置，由上面的 ⚠️ 交代
            note = None
        if note:
            print(note)

    print()
    if unresolved:
        print(f"有 {len(unresolved)} 个 agent 的 skills 目录没建好：{'、'.join(unresolved)}（见上面 ⚠️ 行）")
        print("按每行的提示处理后重跑本脚本；`.dsh/skills` 没建好时 DSH 读不到任何 skill。")
        return 1
    print("完成。在仓库目录内启动 agent 即自动发现 skills/（各 agent 项目 roots 扫描）。")
    print("仓库 git pull 更新 SKILL.md 后：DSH 热刷新即时生效；其余 agent 重新加载会话即可。")
    return 0


if __name__ == "__main__":
    from _stdio import pin_utf8_stdio
    pin_utf8_stdio()
    raise SystemExit(main())
