"""Offline parser/orchestration fixtures; no SSH, Docker, API or live env reads."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest import mock

SOURCE = Path(__file__).with_name("stage-xmartmenu-google-config.py")
spec = importlib.util.spec_from_file_location("google_config_stage", SOURCE)
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
FIXTURE_KEY = "AIza" + "A" * 35


class StageTests(unittest.TestCase):
    def values(self):
        return {**ops.FIXED, "GOOGLE_AUTH_WEB_API_KEY": FIXTURE_KEY}

    def encode(self, values):
        return "".join(f"{key}={value}\n" for key, value in values.items()).encode("ascii")

    def proof(self):
        return {"configStaged": True, "tokenRevoked": True, "createdAny": True,
                "googleAuthRemainsDisabled": True, "existingGoogleValuesPreserved": True,
                "unrelatedEnvironmentMetadataPreserved": True, "previewIsolated": True,
                "automaticPreviewsDisabled": True, "existingPreviewsPreserved": True, "deploymentRequested": False}

    def result(self, proof, code=0):
        return subprocess.CompletedProcess([], code, json.dumps(proof).encode("ascii"))

    def test_plan_never_reads_input_or_inspects_runtime(self):
        with mock.patch.object(ops, "read_input", side_effect=AssertionError("Offline")), \
                mock.patch.object(ops, "snapshot", side_effect=AssertionError("Offline")), \
                mock.patch.object(ops.subprocess, "run", side_effect=AssertionError("Offline")), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(ops.main([]), 0)
        plan = json.loads(output.getvalue())
        self.assertTrue(plan["planOnly"])
        self.assertFalse(plan["inputRead"])
        self.assertFalse(plan["googleAuthEnabled"])
        self.assertEqual(set(plan["allowedKeys"]), set(self.values()))

    def test_input_accepts_exact_eight_keys_with_crlf_or_literal_quotes(self):
        self.assertEqual(ops.parse_values(self.encode(self.values())), self.values())
        quoted = {key: "'" + value + "'" for key, value in self.values().items()}
        self.assertEqual(ops.parse_values(self.encode(quoted).replace(b"\n", b"\r\n")), self.values())

    def test_input_refuses_activation_wrong_app_or_project_and_ambient_settings(self):
        for key, value in (("GOOGLE_AUTH_ENABLED", "true"), ("GOOGLE_AUTH_PROJECT_ID", "otherproject"),
                           ("GOOGLE_AUTH_PROJECT_NUMBER", "123456789012"),
                           ("GOOGLE_AUTH_ADC_FILE", "/run/secrets/xmail-google-identity/adc.json"),
                           ("GOOGLE_AUTH_ADC_AUDIENCE", ops.FIXED["GOOGLE_AUTH_ADC_AUDIENCE"].replace("xmartmenu", "xmail")),
                           ("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/ambient.json")):
            with self.subTest(key=key), self.assertRaises(ValueError):
                ops.parse_values(self.encode({**self.values(), key: value}))

    def test_input_refuses_duplicates_missing_keys_malformed_or_oversized_values(self):
        data = self.encode(self.values())
        bad = [data + b"GOOGLE_AUTH_ENABLED=false\n", self.encode(ops.FIXED),
               data.replace(FIXTURE_KEY.encode(), b"not-a-google-browser-key"),
               data + b" export SECRET=value\n", b"A" * 16385, data + b"\x00\n"]
        for value in bad:
            with self.subTest(length=len(value)), self.assertRaises(ValueError):
                ops.parse_values(value)

    def test_staging_sends_values_only_on_stdin_and_never_activates_or_deploys(self):
        calls = []
        def command(args, data, timeout, allow_failure):
            calls.append((args, data, timeout, allow_failure))
            return self.result(self.proof())
        result = ops.apply(self.values(), command, lambda: {"image": ops.IMAGE, "id": "fixture-container"})
        self.assertTrue(result["configStaged"])
        self.assertTrue(result["productionContainerUnchanged"])
        self.assertFalse(result["applicationEnvironmentActivated"])
        args, data, timeout, allow_failure = calls[0]
        self.assertEqual(args[:6], ["/usr/bin/docker", "exec", "-i", "coolify", "php", "-r"])
        self.assertNotIn(FIXTURE_KEY, " ".join(args))
        self.assertEqual(json.loads(data), {"values": self.values()})
        self.assertEqual(timeout, 110)
        self.assertTrue(allow_failure)
        self.assertNotIn(FIXTURE_KEY, json.dumps(result))

    def test_uncertain_api_failure_never_reports_success_or_retries(self):
        proof = {**self.proof(), "configStaged": False, "failurePhase": "api-create"}
        command = mock.Mock(return_value=self.result(proof, 1))
        result = ops.apply(self.values(), command, lambda: {"id": "original"})
        self.assertFalse(result["configStaged"])
        self.assertTrue(result["tokenRevoked"])
        self.assertEqual(result["failurePhase"], "api-create")
        command.assert_called_once()

    def test_failed_revocation_denies_success(self):
        proof = {**self.proof(), "tokenRevoked": False, "failurePhase": "token-revoke"}
        result = ops.apply(self.values(), lambda *_: self.result(proof, 1), lambda: {"id": "original"})
        self.assertFalse(result["configStaged"])
        self.assertFalse(result["tokenRevoked"])

    def test_failed_preview_or_preservation_postcheck_denies_success(self):
        for key in ("previewIsolated", "automaticPreviewsDisabled", "existingPreviewsPreserved",
                    "existingGoogleValuesPreserved", "unrelatedEnvironmentMetadataPreserved"):
            proof = {**self.proof(), key: False}
            with self.subTest(key=key):
                result = ops.apply(self.values(), lambda *_: self.result(proof), lambda: {"id": "original"})
                self.assertFalse(result["configStaged"])

    def test_unknown_failure_phase_and_unexpected_output_are_not_forwarded(self):
        proof = {**self.proof(), "configStaged": False, "failurePhase": FIXTURE_KEY}
        result = ops.apply(self.values(), lambda *_: self.result(proof, 1), lambda: {"id": "original"})
        self.assertEqual(result["failurePhase"], "unknown")
        self.assertNotIn(FIXTURE_KEY, json.dumps(result))
        with self.assertRaises(ValueError):
            ops.apply(self.values(), lambda *_: self.result({**self.proof(), "rawValue": FIXTURE_KEY}), lambda: {})

    def test_changed_production_snapshot_denies_success(self):
        snapshots = iter([{"id": "old", "image": ops.IMAGE}, {"id": "new", "image": ops.IMAGE}])
        with self.assertRaises(ValueError):
            ops.apply(self.values(), lambda *_: self.result(self.proof()), lambda: next(snapshots))

    def test_snapshot_requires_one_matching_healthy_pinned_image_and_production_uid(self):
        template_state = {"id": "fixture", "image": ops.IMAGE, "running": True, "health": "healthy", "mounts": []}
        for failure in (None, "image", "health", "uid", "two"):
            state = copy.deepcopy(template_state)
            if failure in ("image", "health"):
                state[failure] = "wrong"
            def command(args):
                if args[1] == "ps":
                    names = "app-" + ops.APP + "-fixture\n"
                    return subprocess.CompletedProcess(args, 0, (names * (2 if failure == "two" else 1)).encode())
                if args[1] == "inspect":
                    return subprocess.CompletedProcess(args, 0, json.dumps(state).encode())
                return subprocess.CompletedProcess(args, 0, json.dumps({"uid": 0 if failure == "uid" else 1000, "gid": 1000}).encode())
            with self.subTest(failure=failure):
                if failure:
                    with self.assertRaises(ValueError):
                        ops.snapshot(command)
                else:
                    self.assertEqual(ops.snapshot(command), state)

    def test_invalid_cli_argument_never_echoes_value(self):
        with contextlib.redirect_stderr(io.StringIO()) as output, self.assertRaises(ValueError):
            ops.main(["--api-key", FIXTURE_KEY])
        self.assertEqual(output.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
