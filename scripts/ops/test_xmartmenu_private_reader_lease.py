"""Offline only: mocks all role SQL, no actual login/password or database touched."""
import base64
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import secrets
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("lease", ROOT/"xmartmenu-private-reader-lease.py")
lease = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lease)


def preflight():
    return {"database":"xmartmenu","runtimeDormant":True,"readerSafe":True,
            "readerPasswordNull":True,"noMemberships":True,"allTablesSelect":True,
            "readerSessions":0,"canCreate":False,"anyTableWrite":False,"preload":""}


class LeasePolicy(unittest.TestCase):
    def test_plan_cannot_change_roles_or_read_credentials(self):
        result = subprocess.run([sys.executable, "-B", str(ROOT/"xmartmenu-private-reader-lease.py"), "--plan"], capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PLAN ONLY", result.stdout)
        self.assertFalse(json.loads(result.stdout)["runtimeLoginEnabled"])

    def test_scram_verifier_uses_random_salt_and_valid_stored_server_keys(self):
        generated = secrets.token_urlsafe(32)
        value = lease.verifier(generated)
        algorithm, parameters, keys = value.split("$")
        iterations, salt = parameters.split(":")
        stored, server = (base64.b64decode(v) for v in keys.split(":"))
        self.assertEqual(algorithm, "SCRAM-SHA-256")
        self.assertEqual(iterations, "4096")
        self.assertEqual(len(base64.b64decode(salt)), 16)
        salted = hashlib.pbkdf2_hmac("sha256", generated.encode(), base64.b64decode(salt), 4096)
        self.assertEqual(stored, hashlib.sha256(hmac.new(salted,b"Client Key",hashlib.sha256).digest()).digest())
        self.assertEqual(server, hmac.new(salted,b"Server Key",hashlib.sha256).digest())
        self.assertNotIn(generated, value)
        self.assertNotEqual(value, lease.verifier(generated))

    def test_grant_is_fixed_reader_bounded_and_never_sends_plaintext_to_sql(self):
        generated = secrets.token_urlsafe(32)
        derived = lease.verifier(generated)
        with patch.object(lease,"sql") as sql:
            lease.grant(derived, int(time.time())+lease.LEASE_SECONDS)
        text = sql.call_args.args[0]
        self.assertIn("ALTER ROLE xmartmenu_staging_reader LOGIN", text)
        self.assertIn("VALID UNTIL", text)
        self.assertNotIn(generated,text)
        self.assertNotIn("ALTER ROLE xmartmenu_runtime",text)
        self.assertNotIn("ALTER SYSTEM",text)
        self.assertIn("SET LOCAL log_min_error_statement='panic'",text)
        self.assertTrue(text.endswith("COMMIT;\n"))

    def test_invalid_verifier_or_deadline_has_no_sql_side_effect(self):
        for value,deadline in [("untrusted",int(time.time())+200),(lease.verifier(secrets.token_urlsafe(32)),int(time.time())+600)]:
            with patch.object(lease,"sql") as sql:
                with self.assertRaises(ValueError):lease.grant(value,deadline)
                sql.assert_not_called()

    def test_preflight_requires_unused_dormant_select_only_reader_and_runtime_nologin(self):
        with patch.object(lease,"sql",return_value=json.dumps(preflight()).encode()):lease.preflight()
        for key,value in [("database","other"),("runtimeDormant",False),("readerSafe",False),
                          ("readerPasswordNull",False),("noMemberships",False),("allTablesSelect",False),
                          ("readerSessions",1),("canCreate",True),("anyTableWrite",True),("preload","pgaudit")]:
            data={**preflight(),key:value}
            with patch.object(lease,"sql",return_value=json.dumps(data).encode()):
                with self.assertRaises(ValueError):lease.preflight()

    def test_request_never_accepts_destination_role_sql_or_extra_fields(self):
        value={"protocol":"xmartmenu-private-read-v1","nonce":"a"*32,"bundleSha256":"b"*64,"appCommit":"c"*40}
        self.assertEqual(lease.request_guard(value),value)
        for changes in [{"host":"remote"},{"database":"other"},{"role":"superuser"},{"sql":"SELECT 1"},
                        {"nonce":"bad"},{"appCommit":"main"}]:
            with self.assertRaises(ValueError):lease.request_guard({**value,**changes})

    def test_revoke_is_reader_only_and_checks_password_null_and_zero_sessions(self):
        final={"readerDormant":True,"runtimeDormant":True,"readerSessions":0}
        with patch.object(lease,"sql",side_effect=[b"0",json.dumps(final).encode()]) as sql:
            self.assertEqual(lease.revoke("a"*32),final)
        first=sql.call_args_list[0].args[0]
        self.assertIn("ALTER ROLE xmartmenu_staging_reader NOLOGIN PASSWORD NULL",first)
        self.assertIn("application_name='xmartmenu-read-proof-",first)
        self.assertNotIn("ALTER ROLE xmartmenu_runtime",first)
        for check in [{**final,"readerDormant":False},{**final,"readerSessions":1}]:
            with patch.object(lease,"sql",side_effect=[b"0",json.dumps(check).encode()]):
                with self.assertRaises(ValueError):lease.revoke("a"*32)

    def test_watchdog_is_independent_holds_lock_and_settles_late_grant_without_new_login(self):
        source=(ROOT/"xmartmenu-private-reader-lease.py").read_text()
        self.assertIn("pass_fds=(fd,)",source)
        self.assertIn("start_new_session=True",source)
        self.assertIn("settle = time.monotonic()+20",source)
        watchdog=source[source.index("def watchdog("):source.index("def serve(")]
        self.assertNotIn("grant(",watchdog)
        self.assertNotIn("token_urlsafe",watchdog)
        self.assertIn("revoke(plan[",watchdog)


if __name__=="__main__":unittest.main()
