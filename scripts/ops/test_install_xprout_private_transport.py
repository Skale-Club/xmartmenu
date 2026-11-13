"""Installer policy tests: no real user, key, service, SSH or SQL operation."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("installer", ROOT / "install-xprout-private-transport.py")
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


def own_policy():
    return (f"authorizedkeysfile {install.AUTH}\n"
            "authenticationmethods publickey\npasswordauthentication no\n"
            "kbdinteractiveauthentication no\npermittty no\npermituserrc no\n"
            "disableforwarding yes\nclientaliveinterval 5\nclientalivecountmax 1\n"
            "forcecommand /usr/bin/sudo -n -- /usr/local/libexec/xmartmenu-pg-stdio.py\n").encode()


class InstallerPolicy(unittest.TestCase):
    def test_default_is_offline_and_mutation_requires_reviewed_hashes(self):
        path = ROOT / "install-xprout-private-transport.py"
        for args in [[], ["plan"]]:
            result = subprocess.run([sys.executable, "-B", str(path), *args], capture_output=True, text=True, timeout=3)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("PLAN ONLY", result.stdout)
            self.assertFalse(json.loads(result.stdout)["runtimeLoginEnabled"])
        for action in ["install-client", "install-server", "start-client", "rollback-client", "rollback-server", "verify-client"]:
            result = subprocess.run([sys.executable, "-B", str(path), action, "--execute-reviewed-install"], capture_output=True, text=True, timeout=3)
            self.assertEqual(result.returncode, 2)
            self.assertIn("Exact reviewed operator hash required", result.stderr)

    def test_only_valid_single_ed25519_public_key_is_accepted(self):
        blob = struct.pack(">I", 11) + b"ssh-ed25519" + struct.pack(">I", 32) + bytes(range(32))
        token = base64.b64encode(blob).decode()
        key, fingerprint = install.public_key(f"ssh-ed25519 {token} fixture\n".encode())
        self.assertEqual(key, f"ssh-ed25519 {token} xmartmenu-private-transport\n".encode())
        self.assertEqual(fingerprint, base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("="))
        for raw in [b"", b"not a key", b"ssh-rsa data", f"ssh-ed25519 {token}\nssh-ed25519 {token}".encode(), b"ssh-ed25519 !!!", b"ssh-ed25519 YQ=="]:
            with self.assertRaises((ValueError, UnicodeError)):
                install.public_key(raw)

    def test_bundle_digest_and_every_file_are_required_before_loading_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = {"version": 1, "applicationCutover": False, "runtimeLoginEnabled": False, "sshKeysCreated": False, "files": {}}
            for name in install.FILES:
                raw = ("public fixture "+name).encode()
                (root/name).write_bytes(raw)
                manifest["files"][name] = install.sha(raw)
            payload = json.dumps(manifest).encode()
            (root/"manifest.json").write_bytes(payload)
            with patch.object(install, "checked"):
                install.verify_bundle(root, install.sha(payload))
                with self.assertRaises(ValueError):
                    install.verify_bundle(root, "a"*64)
                (root/"sudoers").write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    install.verify_bundle(root, install.sha(payload))
                manifest["files"]["../outside"] = "a"*64
                altered = json.dumps(manifest).encode()
                (root/"manifest.json").write_bytes(altered)
                with self.assertRaises(ValueError):
                    install.verify_bundle(root, install.sha(altered))

    def test_candidate_appends_match_at_eof_and_preserves_all_existing_contexts(self):
        original, fragment = b"Port 22\n# existing config\n", b"Match User xmartmenu-pg-ssh\n ClientAliveInterval 5\n"
        calls = []
        def policies(config, users, source):
            calls.append((config, users, source))
            if users == [install.SERVER_USER]:
                return {(install.SERVER_USER, "188.245.112.3"): own_policy()}
            return {(u, "188.245.112.3"): b"unchanged\n" for u in users}
        fake_pwd = types.SimpleNamespace(getpwall=lambda: [types.SimpleNamespace(pw_name="root"), types.SimpleNamespace(pw_name="operator")])
        with patch.object(install, "pwd", fake_pwd), patch.object(install, "check_ssh_policies", policies), patch.object(install, "run") as run:
            result, users, digest = install.ssh_candidate(original, fragment, "192.0.2.10")
        self.assertTrue(result.endswith(fragment))
        self.assertNotIn(b"Include", result)
        self.assertEqual(set(users), {"root", "operator"})
        self.assertEqual(len(digest), 64)
        run.assert_called_once_with(["/usr/sbin/sshd", "-t", "-f", "/dev/stdin"], result)
        self.assertIsNone(calls[0][0])
        self.assertEqual(calls[1][0], result)

    def test_existing_ssh_policy_change_refuses_before_any_file_write(self):
        fake_pwd = types.SimpleNamespace(getpwall=lambda: [types.SimpleNamespace(pw_name="root")])
        def policies(config, users, source):
            return {("root", source): b"changed" if config else b"baseline"}
        with patch.object(install, "pwd", fake_pwd), patch.object(install, "check_ssh_policies", policies), patch.object(install, "run") as run:
            with self.assertRaises(ValueError):
                install.ssh_candidate(b"original", b"fragment", "192.0.2.10")
            run.assert_not_called()

    def test_each_dedicated_policy_fact_is_mandatory(self):
        install.dedicated_policy_guard(own_policy())
        for line in own_policy().splitlines():
            changed = own_policy().replace(line+b"\n", b"")
            with self.assertRaises(ValueError):
                install.dedicated_policy_guard(changed)

    def test_all_local_users_are_compared_in_each_relevant_address_context(self):
        calls = []
        with patch.object(install, "run", side_effect=lambda args,data: calls.append((args,data)) or b"safe\n"):
            result = install.check_ssh_policies(b"candidate", ["root", "operator"], "192.0.2.10")
        self.assertEqual(len(result), 6)
        self.assertTrue(all(c[0][-2:] == ["-f", "/dev/stdin"] and c[1] == b"candidate" for c in calls))
        with self.assertRaises(ValueError):
            install.check_ssh_policies(None, ["unsafe,name"], "127.0.0.1")

    def test_account_and_group_must_both_be_new(self):
        absent = Mock(side_effect=KeyError)
        with patch.object(install, "pwd", types.SimpleNamespace(getpwnam=absent)), patch.object(install, "grp", types.SimpleNamespace(getgrnam=absent)):
            install.no_existing_user("dedicated")
        with patch.object(install, "pwd", types.SimpleNamespace(getpwnam=lambda _: object())), patch.object(install, "grp", types.SimpleNamespace(getgrnam=absent)):
            with self.assertRaises(ValueError):
                install.no_existing_user("dedicated")
        with patch.object(install, "pwd", types.SimpleNamespace(getpwnam=absent)), patch.object(install, "grp", types.SimpleNamespace(getgrnam=lambda _: object())):
            with self.assertRaises(ValueError):
                install.no_existing_user("dedicated")

    def test_installer_refuses_preexisting_destinations_without_overwriting(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"owned"
            path.write_bytes(b"existing")
            with patch.object(install, "STATE", Path(tmp)/"absent"), patch.object(install, "checked"):
                with self.assertRaises(ValueError):
                    install.preflight_paths([path])
            self.assertEqual(path.read_bytes(), b"existing")

    def test_manual_bridge_recovery_rechecks_admission_before_explicit_start(self):
        calls = []
        def command(args, data=None, timeout=15):
            calls.append(args)
            if "--admit-local" in args:
                return b'{"admitted":false}'
            raise AssertionError("No service mutation permitted after failed admission")
        with patch.object(install, "receipt_read", return_value={}), patch.object(install, "run", command):
            with self.assertRaises(ValueError):
                install.verify_client(start=True)
        self.assertEqual(len(calls), 1)
        self.assertIn("--admit-local", calls[0])

    def test_admitted_manual_recovery_runs_start_not_only_enable(self):
        calls = []
        def command(args, data=None, timeout=15):
            calls.append(args)
            if "--admit-local" in args:
                return b'{"admitted":true}'
            if "show" in args:
                return b'ActiveState=inactive\n'
            return b''
        with patch.object(install, "receipt_read", return_value={}), patch.object(install, "run", command), patch.object(install, "port15432", return_value=["0104000A:3C48"]):
            with self.assertRaises(ValueError):
                install.verify_client(start=True)  # State verification remains fail-closed.
        self.assertEqual(calls[1], ["/usr/bin/systemctl", "enable", install.UNIT_NAME])
        self.assertEqual(calls[2], ["/usr/bin/systemctl", "start", install.UNIT_NAME])

    def test_rollback_refuses_shared_ssh_changes_and_keeps_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp)/"sshd_config"
            config.write_bytes(b"concurrent update")
            value = {"created": [], "sshdBefore": "a"*64, "sshdAfter": "b"*64}
            with patch.object(install, "SSHD", config), patch.object(install, "receipt_read", return_value=value), patch.object(install, "checked"), patch.object(install, "run") as run, patch.dict(sys.modules, {"fcntl": types.SimpleNamespace()}):
                with self.assertRaises(ValueError):
                    install.rollback("server")
                run.assert_not_called()
            self.assertEqual(config.read_bytes(), b"concurrent update")

    def test_atomic_file_update_keeps_complete_bytes_and_private_mode_intent(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"receipt"
            with patch.object(install, "checked"), patch.object(install.os, "O_DIRECTORY", 0, create=True):
                # Windows cannot fsync a directory; mock only the descriptor open
                # for that final durability operation; byte writing remains real.
                if sys.platform == "win32":
                    real_open = install.os.open
                    def opened(name, flags, *args, **kwargs):
                        return real_open(path, install.os.O_RDWR) if Path(name)==Path(tmp) else real_open(name, flags, *args, **kwargs)
                    with patch.object(install.os, "open", opened):
                        install.atomic_replace(path, b"complete\nreceipt\n", 0o600)
                else:
                    install.atomic_replace(path, b"complete\nreceipt\n", 0o600)
            self.assertEqual(path.read_bytes(), b"complete\nreceipt\n")
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["receipt"])

    def test_failed_new_file_write_chown_or_save_cleans_only_its_own_inode(self):
        for failure in ["write", "chown", "save"]:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp)/"created"
                receipt = object.__new__(install.Receipt)
                receipt.data = {"created": []}
                receipt.save = Mock(side_effect=OSError("save fixture") if failure=="save" else None)
                real_fdopen = install.os.fdopen
                def opened(fd, mode):
                    handle = real_fdopen(fd, mode)
                    if failure != "write":
                        return handle
                    class BrokenWrite:
                        def __enter__(self):
                            return self
                        def __exit__(self, *args):
                            handle.close()
                        def write(self, _):
                            raise OSError("write fixture")
                    return BrokenWrite()
                with patch.object(install, "checked"), \
                        patch.object(install.os, "O_NOFOLLOW", 0, create=True), \
                        patch.object(install.os, "fchown", side_effect=OSError("chown fixture") if failure=="chown" else None, create=True), \
                        patch.object(install.os, "fchmod", create=True), \
                        patch.object(install.os, "fdopen", opened):
                    with self.assertRaises(OSError):
                        receipt.create(path, b"new public source")
                self.assertFalse(path.exists())
                self.assertEqual(receipt.data["created"], [])
                if failure != "save":
                    receipt.save.assert_not_called()

    def test_failed_receipt_save_preserves_a_concurrently_replaced_inode(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, original = Path(tmp)/"created", Path(tmp)/"original"
            receipt = object.__new__(install.Receipt)
            receipt.data = {"created": []}
            def failed_save():
                path.rename(original)
                path.write_bytes(b"concurrent replacement")
                raise OSError("save fixture")
            receipt.save = failed_save
            with patch.object(install, "checked"), \
                    patch.object(install.os, "O_NOFOLLOW", 0, create=True), \
                    patch.object(install.os, "fchown", create=True), \
                    patch.object(install.os, "fchmod", create=True):
                with self.assertRaises(OSError):
                    receipt.create(path, b"original inode")
            self.assertEqual(path.read_bytes(), b"concurrent replacement")
            self.assertEqual(original.read_bytes(), b"original inode")
            self.assertEqual(receipt.data["created"], [])


if __name__ == "__main__":
    unittest.main()
