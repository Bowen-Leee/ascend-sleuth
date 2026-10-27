"""enable_agent_skills 的状态判定与目录副本处置。

为什么值得测：这个脚本是 Windows 上 clone 之后唯一还要人手跑一次的动作，判错状态有两个
后果。把目录副本当正常放过，skill 内容静默过期；把可用的链接判成异常，使用者被要求删一个
能用的目录。目录副本与 junction 在 `PSIsContainer`、`is_dir()` 下同形，所以判定（inspect）
与处置（`--fix-copy` 的外来内容闸门）各钉两条。
"""

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import enable_agent_skills as EAS  # noqa: E402


class EnableAgentSkillsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.skills = self.root / "skills"
        (self.skills / "diagnose").mkdir(parents=True)
        (self.skills / "diagnose" / "SKILL.md").write_text("x", encoding="utf-8")
        self.link = self.root / ".dsh" / "skills"
        self.saved = (EAS.REPO_DIR, EAS.SKILLS_DIR, EAS.AGENTS)
        EAS.REPO_DIR = self.root
        EAS.SKILLS_DIR = self.skills
        EAS.AGENTS = [("DeepSeek Harness", ".dsh", "dsh")]

    def tearDown(self):
        EAS.REPO_DIR, EAS.SKILLS_DIR, EAS.AGENTS = self.saved
        self.tmp.cleanup()

    def run_main(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = EAS.main(list(args))
        return code, out.getvalue()

    def make_copy(self):
        shutil.copytree(self.skills, self.link)

    def test_missing_is_created_and_verified(self):
        code, out = self.run_main()
        self.assertEqual(code, 0, out)
        self.assertTrue(EAS.points_to(self.link, self.skills), out)

    def test_plain_text_residual_is_rebuilt(self):
        self.link.parent.mkdir(parents=True)
        self.link.write_text("../skills", encoding="utf-8")
        code, out = self.run_main()
        self.assertEqual(code, 0, out)
        self.assertTrue(EAS.is_reparse_point(self.link), out)
        self.assertTrue(EAS.points_to(self.link, self.skills), out)

    def test_copy_is_reported_as_stale_not_broken(self):
        self.make_copy()
        code, out = self.run_main("--check")
        self.assertEqual(code, 1, out)
        self.assertIn("目录副本", out)
        self.assertNotIn("❌ 不存在", out)
        # --check 不写盘：副本原样留着
        self.assertFalse(EAS.is_reparse_point(self.link))
        self.assertEqual(code, 1)

    def test_fix_copy_replaces_pure_copy(self):
        self.make_copy()
        code, out = self.run_main("--fix-copy")
        self.assertEqual(code, 0, out)
        self.assertTrue(EAS.is_reparse_point(self.link), out)
        self.assertTrue(EAS.points_to(self.link, self.skills), out)

    def test_fix_copy_refuses_when_foreign_content_present(self):
        self.make_copy()
        (self.link / "mine.txt").write_text("keep", encoding="utf-8")
        code, out = self.run_main("--fix-copy")
        self.assertEqual(code, 1, out)
        self.assertIn("mine.txt", out)
        self.assertTrue((self.link / "mine.txt").is_file(), out)

    def test_check_passes_on_good_link(self):
        self.run_main()
        code, out = self.run_main("--check")
        self.assertEqual(code, 0, out)
        self.assertIn("✅ 正常", out)


if __name__ == "__main__":
    unittest.main()
