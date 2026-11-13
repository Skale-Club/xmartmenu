"""Offline upgrade guards; no real installed source, receipt, SSH or SQL touched."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("upgrade", ROOT / "upgrade-xprout-pg-stdio.py")
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


def receipt():
    return {"side": "server", "applicationCutover": False, "runtimeLoginEnabled": False,
            "bundle": {"files": {"xmartmenu-pg-stdio.py": upgrade.OLD_SHA}},
            "created": [{"path": str(upgrade.SCRIPT), "sha256": upgrade.OLD_SHA, "uid": 0, "mode": 0o755},
                        {"path": "/etc/sudoers.d/xmartmenu-pg-stdio", "sha256": "b"*64}],
            "publicKeySha256": "public fingerprint fixture", "sshPolicyDigest": "c"*64}


class UpgradeGuards(unittest.TestCase):
    def test_default_plan_has_no_files_or_os_side_effects(self):
        result = subprocess.run([sys.executable, "-B", str(ROOT/"upgrade-xprout-pg-stdio.py")], capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PLAN ONLY", result.stdout)

    def test_revision_changes_only_current_wrapper_proof_and_adds_explicit_revision(self):
        before = receipt()
        result = upgrade.revision(before, "d"*64, "e"*64)
        self.assertEqual(before, receipt())
        self.assertEqual(result["created"][0]["sha256"], "d"*64)
        self.assertEqual(result["bundle"], before["bundle"])
        self.assertEqual(result["created"][1:], before["created"][1:])
        self.assertEqual(result["publicKeySha256"], before["publicKeySha256"])
        self.assertEqual(result["sshPolicyDigest"], before["sshPolicyDigest"])
        self.assertFalse(result["applicationCutover"] or result["runtimeLoginEnabled"])
        result.pop("stdioImplementation")
        result["created"][0]["sha256"] = upgrade.OLD_SHA
        self.assertEqual(result, before)

    def test_unreviewed_old_receipt_or_an_existing_revision_is_refused(self):
        for mutate in [lambda r: r.update(side="client"), lambda r: r.update(runtimeLoginEnabled=True),
                       lambda r: r.update(applicationCutover=True), lambda r: r.update(stdioImplementation={"version":2}),
                       lambda r: r["created"][0].update(sha256="f"*64), lambda r: r["created"][0].update(uid=1000),
                       lambda r: r["created"][0].update(mode=0o777), lambda r: r.update(created=[]),
                       lambda r: r["created"].append(copy.deepcopy(r["created"][0]))]:
            value = receipt()
            mutate(value)
            with self.assertRaises(ValueError):
                upgrade.revision(value, "d"*64, "e"*64)

    def test_explicit_rollback_recognizes_only_its_before_after_file_pair(self):
        plan = {"oldWrapperSha256": "a"*64, "newWrapperSha256": "b"*64,
                "beforeReceiptSha256": "c"*64, "afterReceiptSha256": "d"*64}
        for source in ["a"*64, "b"*64]:
            for receipt_sha in ["c"*64, "d"*64]:
                upgrade.checked_states(source, receipt_sha, plan)
        for source, receipt_sha in [("e"*64, "c"*64), ("a"*64, "e"*64)]:
            with self.assertRaises(ValueError):
                upgrade.checked_states(source, receipt_sha, plan)

    def test_source_tamper_or_crlf_refuses_before_reading_or_mutating_installed_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"new.py"
            for raw, digest in [(b"print('fixture')\n", "a"*64),
                                (b"print('fixture')\r\n", upgrade.sha(b"print('fixture')\r\n"))]:
                path.write_bytes(raw)
                args = types.SimpleNamespace(new_source=path, expected_new_sha256=digest)
                tool = Mock()
                with patch.object(upgrade, "checked"):
                    with self.assertRaises(ValueError):
                        upgrade.apply(args, "b"*64, tool)
                tool.verify_server.assert_not_called()
                tool.atomic_replace.assert_not_called()

    def test_recovery_manifest_tamper_is_refused_before_source_or_receipt_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/"manifest.json").write_text(json.dumps({"version":1}))
            (root/"old-wrapper.py").write_bytes(b"public source")
            (root/"receipt.before.json").write_text("{}")
            tool = Mock()
            with patch.object(upgrade, "checked"), patch.object(upgrade, "BACKUP", root):
                with self.assertRaises(ValueError):
                    upgrade.rollback(types.SimpleNamespace(expected_recovery_sha256="a"*64), tool)
            tool.atomic_replace.assert_not_called()


if __name__ == "__main__":
    unittest.main()
