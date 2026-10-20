"""reference 的 case 来源必须已升格（`verify_references.check_reference_case_sources`）。

护的是一条静默失效：to-reference 在 case 还是 inbox 草稿时归纳，会把尚未入库（甚至
可能被 groom 拒掉）的 id 写进 `sources[].cases`。旧校验只数条数、不查存在性，
"出处指空"永远不会报错。
"""

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import verify_references as vr  # noqa: E402


class CaseSourceTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "knowledge").mkdir()
        (self.root / "references").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def check(self):
        errors = []
        return vr.check_reference_case_sources(self.root, errors)

    def test_promoted_case_accepted(self):
        self.write("knowledge/ns/case.yaml", "cases:\n  - id: C-1\n")
        self.write("references/r.yaml",
                   "sources:\n  - type: case-derived\n    cases: [C-1]\n")
        self.assertEqual(self.check(), [])

    def test_draft_case_rejected(self):
        self.write("knowledge/ns/case.yaml", "cases:\n  - id: C-1\n")
        self.write("references/r.yaml",
                   "sources:\n  - type: case-derived\n    cases: [C-1, C-2]\n")
        errors = self.check()
        self.assertEqual(len(errors), 1)
        self.assertIn("C-2", errors[0])

    def test_archived_case_still_valid_source(self):
        self.write("knowledge/_archive/old.yaml", "cases:\n  - id: C-OLD\n")
        self.write("references/r.yaml",
                   "sources:\n  - type: case-derived\n    cases: [C-OLD]\n")
        self.assertEqual(self.check(), [])

    def test_content_source_cases_checked(self):
        self.write("knowledge/ns/case.yaml", "cases:\n  - id: C-1\n")
        self.write("references/r.yaml",
                   "sources:\n  - type: case-derived\n    cases: [C-1]\n"
                   "content:\n  errors:\n    - code: '507903'\n      source_cases: [C-9]\n")
        errors = self.check()
        self.assertEqual(len(errors), 1)
        self.assertIn("C-9", errors[0])

    def test_no_knowledge_dir_skips(self):
        # 只装 skill、没有知识仓的部署：如实跳过，不报"全部悬挂"
        (self.root / "knowledge").rmdir()
        self.write("references/r.yaml",
                   "sources:\n  - type: case-derived\n    cases: [C-X]\n")
        self.assertEqual(self.check(), [])


if __name__ == "__main__":
    unittest.main()
