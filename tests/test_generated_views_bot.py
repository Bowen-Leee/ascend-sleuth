"""生成物由主干机器人维护：PR 只交源、合入后重建、PR 守卫拦手改。

三条主张，每条用一次真 git 操作回答：
  ① 两个只改源文件的 PR 合入时不碰生成物 → 不冲突；
  ② 每次合入后跑一次 rebuild_generated.py → 索引与路由聚合覆盖两个 PR 的改动，门全绿；
  ③ PR 手改生成物 → 守卫红，并给出还原命令；只改源文件 → 守卫绿。

为什么用临时仓库而不是 mock：这里要证的正是 git 合并行为（不冲突）与生成器覆盖
（两个 PR 的内容都在），mock 掉任何一边都证不到。
"""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]

CASE = """cases:
  - id: {cid}
    title: "生成物机器人实验 {cid}"
    category: interrupt
    tags: [exp]
    confidence:
      score: 0.5
    symptoms:
      - "机器人实验症状 {cid}"
"""


def sh(cwd: Path, *args):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", check=False)


class GeneratedViewsBotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="generated-views-bot-")
        self.repo = Path(self.tmp.name) / "repo"
        r = self.repo
        r.mkdir(parents=True)
        for name in ("knowledge", "references", "scripts", "metrics"):
            shutil.copytree(
                ROOT / name,
                r / name,
                ignore=shutil.ignore_patterns("__pycache__"),
            )
        shutil.copytree(ROOT / "triage-tree.d", r / "triage-tree.d")
        for name in (".gitattributes", ".gitignore", "triage-tree.yaml"):
            shutil.copy2(ROOT / name, r / name)
        sh(r, "git", "init", "-q", "-b", "main")
        sh(r, "git", "config", "user.email", "t@example.com")
        sh(r, "git", "config", "user.name", "t")
        sh(r, "git", "add", "-A")
        sh(r, "git", "commit", "-qm", "base")

    def tearDown(self):
        self.tmp.cleanup()

    # ---------------------------------------------------------------- 人的动作
    def add_case(self, cid: str):
        p = self.repo / "knowledge" / "inference" / "vllm-ascend" / "interrupt" / f"{cid}.yaml"
        p.write_text(CASE.format(cid=cid), encoding="utf-8")

    def add_route_word(self, word: str, family: str = "10-interrupt.yaml", branch: str = "interrupt"):
        p = self.repo / "triage-tree.d" / family
        lines = p.read_text(encoding="utf-8").split("\n")
        start = next(i for i, l in enumerate(lines) if l.strip() == f"- id: {branch}")
        si = next(i for i in range(start, len(lines)) if lines[i].strip() == "symptoms:")
        at = si + 1
        while at < len(lines) and (not lines[at].strip() or lines[at].startswith("      ")):
            at += 1
        lines.insert(at, f'      - ["{word}"]')
        p.write_text("\n".join(lines), encoding="utf-8")

    def commit(self, msg: str):
        sh(self.repo, "git", "add", "-A")
        p = sh(self.repo, "git", "commit", "-qm", msg)
        self.assertEqual(p.returncode, 0, p.stderr)

    def branch(self, name: str):
        p = sh(self.repo, "git", "checkout", "-q", "-b", name, "main")
        self.assertEqual(p.returncode, 0, p.stderr)

    # ---------------------------------------------------------------- 机器人的动作
    def rebuild(self):
        p = sh(self.repo, "python3", "scripts/rebuild_generated.py", "--check")
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def guard(self, base: str = "main"):
        return sh(self.repo, "python3", "scripts/check_generated_untouched.py", "--base", base)

    # ---------------------------------------------------------------- ① + ②
    def test_two_source_only_prs_merge_and_bot_rebuild_covers_both(self):
        self.branch("kb/a")
        self.add_case("TEST-BOT-A")
        self.add_route_word("botWordA")
        self.commit("a: case + route word")

        sh(self.repo, "git", "checkout", "-q", "main")
        self.branch("kb/b")
        self.add_case("TEST-BOT-B")
        self.add_route_word("botWordB")
        self.commit("b: case + route word")

        sh(self.repo, "git", "checkout", "-q", "main")

        # a 合入：只改源，无生成物冲突；合入后机器人重建。
        p = sh(self.repo, "git", "merge", "--no-ff", "-m", "merge kb/a", "kb/a")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.rebuild()
        self.commit("chore: rebuild generated views")

        # b 合入：仍然只改源；a 的生成物已在主干，b 没有改它，不冲突。
        p = sh(self.repo, "git", "merge", "--no-ff", "-m", "merge kb/b", "kb/b")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.rebuild()
        self.commit("chore: rebuild generated views")

        index = (self.repo / "knowledge" / "_index.yaml").read_text(encoding="utf-8")
        self.assertIn("TEST-BOT-A", index)
        self.assertIn("TEST-BOT-B", index)

        triage = (self.repo / "triage-tree.yaml").read_text(encoding="utf-8")
        self.assertIn("botWordA", triage)
        self.assertIn("botWordB", triage)
        yaml.safe_load(triage)

    # ---------------------------------------------------------------- ③
    def test_guard_rejects_hand_edited_generated_file(self):
        self.branch("kb/hand")
        p = self.repo / "knowledge" / "_index.yaml"
        p.write_text(p.read_text(encoding="utf-8") + "\n# 手改一行\n", encoding="utf-8")
        self.commit("hand edit index")

        g = self.guard()
        self.assertEqual(g.returncode, 1, g.stdout + g.stderr)
        self.assertIn("knowledge/_index.yaml", g.stdout)
        self.assertIn("git checkout main --", g.stdout)

    def test_guard_allows_source_only_change(self):
        self.branch("kb/src")
        self.add_case("TEST-BOT-SRC")
        self.commit("source only")

        g = self.guard()
        self.assertEqual(g.returncode, 0, g.stdout + g.stderr)

    # ---------------------------------------------------------------- ④ 手动同步
    def make_remote(self):
        remote = Path(self.tmp.name) / "remote.git"
        sh(self.tmp.name, "git", "init", "--bare", "-q", str(remote))
        sh(self.repo, "git", "remote", "add", "origin", str(remote))
        p = sh(self.repo, "git", "push", "-q", "-u", "origin", "main")
        self.assertEqual(p.returncode, 0, p.stderr)

        other = Path(self.tmp.name) / "other"
        p = sh(self.tmp.name, "git", "clone", "-q", str(remote), str(other))
        self.assertEqual(p.returncode, 0, p.stderr)
        sh(other, "git", "config", "user.email", "t@example.com")
        sh(other, "git", "config", "user.name", "t")
        return remote, other

    def test_sync_pulls_rebuilds_commits_and_pushes_in_one_command(self):
        remote, other = self.make_remote()
        p = other / "knowledge" / "inference" / "vllm-ascend" / "interrupt" / "TEST-SYNC-1.yaml"
        p.write_text(CASE.format(cid="TEST-SYNC-1"), encoding="utf-8")
        sh(other, "git", "add", "-A")
        sh(other, "git", "commit", "-qm", "add case")
        p = sh(other, "git", "push", "-q", "origin", "main")
        self.assertEqual(p.returncode, 0, p.stderr)

        p = sh(
            self.repo,
            "python3",
            "scripts/rebuild_generated.py",
            "--sync",
            "--remote",
            "origin",
            "--main-branch",
            "main",
        )
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("已推送到 origin/main", p.stdout)
        self.assertIn(
            "TEST-SYNC-1",
            (self.repo / "knowledge" / "_index.yaml").read_text(encoding="utf-8"),
        )
        log = sh(remote, "git", "log", "-1", "--format=%s", "main").stdout.strip()
        self.assertEqual(log, "chore: rebuild generated views")

    def test_sync_pr_branch_pushes_branch_and_leaves_main_alone(self):
        remote, other = self.make_remote()
        p = other / "knowledge" / "inference" / "vllm-ascend" / "interrupt" / "TEST-SYNC-2.yaml"
        p.write_text(CASE.format(cid="TEST-SYNC-2"), encoding="utf-8")
        sh(other, "git", "add", "-A")
        sh(other, "git", "commit", "-qm", "add case 2")
        p = sh(other, "git", "push", "-q", "origin", "main")
        self.assertEqual(p.returncode, 0, p.stderr)

        p = sh(
            self.repo,
            "python3",
            "scripts/rebuild_generated.py",
            "--sync",
            "--remote",
            "origin",
            "--main-branch",
            "main",
            "--pr-branch",
            "chore/rebuild-generated",
        )
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("已推送分支 chore/rebuild-generated", p.stdout)

        main_log = sh(remote, "git", "log", "-1", "--format=%s", "main").stdout.strip()
        self.assertEqual(main_log, "add case 2")
        branch_log = sh(remote, "git", "log", "-1", "--format=%s", "chore/rebuild-generated").stdout.strip()
        self.assertEqual(branch_log, "chore: rebuild generated views")


if __name__ == "__main__":
    unittest.main()
