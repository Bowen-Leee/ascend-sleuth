"""升格闸门（`verify_case_draft --gate`）的闭环判据回归测试。

护的是 2026-10 的判据修正：闭环有两条承载轴——
  - 命中 case：`feedback.outcome: resolved`；
  - 无命中 case：没有 case 可归属，结果只记 `status: resolved`。
此前只读 feedback，于是"无命中但已解决"的新形态 case 永远被拦，而这类恰是知识增长的
主路径（无命中才会产出新 case）。这两种写法各有面板的闭环命令对应，改判据时两边要一起看
（词表见仓库根 `trace-status.yaml`）。
"""

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import verify_case_draft as vcd  # noqa: E402


class GateTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "traces").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def trace(self, text):
        (self.root / "traces" / "s1.yaml").write_text(text, encoding="utf-8")

    def gate(self, case, sid="s1"):
        case = dict({"id": "C-1", "source_session": sid}, **case)
        fails, warns = [], []
        verdict = vcd.gate_case(
            case, Path("draft.case.yaml"), self.root, fails.append, warns.append)
        return verdict, fails, warns

    def test_hit_feedback_resolved_passes(self):
        self.trace("status: resolved\nactive_case: C-9\n"
                   "feedback: {case: C-9, outcome: resolved}\n")
        self.assertEqual(self.gate({})[0], "pass")

    def test_hit_feedback_pending_blocks(self):
        self.trace("status: in_progress\nactive_case: C-9\n"
                   "feedback: {case: C-9, outcome: pending}\n")
        verdict, fails, _ = self.gate({})
        self.assertEqual(verdict, "block")
        self.assertTrue(fails and "feedback.outcome" in fails[0])

    def test_no_hit_status_resolved_passes(self):
        # 面板的无命中闭环命令：只写 status（不写 feedback），闸门必须认这一条。
        self.trace("status: resolved\nactive_case: null\n")
        self.assertEqual(self.gate({})[0], "pass")

    def test_no_hit_status_in_progress_blocks(self):
        self.trace("status: in_progress\n")
        self.assertEqual(self.gate({})[0], "block")

    def test_strong_evidence_gets_cosign_not_pass(self):
        self.trace("status: in_progress\nactive_case: null\n")
        verdict, _, warns = self.gate({"verification": {"source": "upstream-fix-merged"}})
        self.assertEqual(verdict, "cosign")
        self.assertTrue(warns)

    def test_pipeline_case_skipped(self):
        verdict = vcd.gate_case(
            {"id": "C-1"}, Path("draft.case.yaml"), self.root, lambda m: None, lambda m: None)
        self.assertEqual(verdict, "skip")


if __name__ == "__main__":
    unittest.main()
