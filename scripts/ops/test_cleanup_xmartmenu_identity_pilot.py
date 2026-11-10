import importlib.util
import json
from pathlib import Path
import secrets
import subprocess
import sys
import unittest

SOURCE = Path(__file__).with_name('cleanup-xmartmenu-identity-pilot.py')
spec = importlib.util.spec_from_file_location('pilot_cleanup', SOURCE)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


def fixture():
    nonce = secrets.token_hex(8)
    return {'nonce': nonce, 'pgId': secrets.token_hex(32), 'appId': secrets.token_hex(32), 'appImage': 'sha256:' + secrets.token_hex(32),
            'volume': 'xmartmenu-identity-pilot-pg-' + nonce, 'createdAt': 1000, 'stopAfter': 8200}


def inspected(receipt, kind, running=True):
    return {'Id': receipt[kind + 'Id'], 'Name': '/xmartmenu-identity-pilot-' + ('db' if kind == 'pg' else 'app'),
            'Image': subject.PG_IMAGE if kind == 'pg' else receipt['appImage'], 'Labels': {'io.xmartmenu.isolated-pilot': receipt['nonce']}, 'Running': running}


class CleanupTests(unittest.TestCase):
    def test_default_plan_never_calls_docker(self):
        result = subprocess.run([sys.executable, '-B', str(SOURCE)], capture_output=True, timeout=4)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b'PLAN ONLY', result.stdout)
        self.assertEqual(result.stderr, b'')

    def test_receipt_has_exact_nonreusable_identity_and_bounded_lifetime(self):
        value = fixture()
        self.assertEqual(subject.validate_receipt(value, value['nonce']), value)
        for change in [{'pgId': value['appId']}, {'volume': 'production'}, {'stopAfter': 1000000}, {'nonce': 'other'}, {'credential': 'never-accepted'}]:
            with self.assertRaises(ValueError):
                subject.validate_receipt({**value, **change}, value['nonce'])

    def test_exact_id_name_image_and_label_are_all_required_before_stop(self):
        receipt = fixture()
        value = inspected(receipt, 'app')
        self.assertTrue(subject.owned_container(value, receipt, 'app'))
        for change in [{'Id': secrets.token_hex(32)}, {'Name': '/production-app'}, {'Image': subject.PG_IMAGE}, {'Labels': {}}, {'Running': 'true'}]:
            with self.assertRaises(ValueError):
                subject.owned_container({**value, **change}, receipt, 'app')

    def test_stops_app_before_pg_and_verifies_both_stopped_without_removal(self):
        receipt = fixture()
        calls, stopped = [], set()

        def runner(args):
            calls.append(args)
            kind = 'app' if args[-1] == receipt['appId'] else 'pg'
            if args[0] == 'stop':
                self.assertEqual(args[:3], ['stop', '--time', '5'])
                stopped.add(kind)
                return b''
            return json.dumps(inspected(receipt, kind, kind not in stopped))
        self.assertEqual(subject.stop_owned(receipt, runner)['pilotContainersStopped'], 2)
        self.assertEqual([args[-1] for args in calls if args[0] == 'stop'], [receipt['appId'], receipt['pgId']])
        self.assertFalse(any(args[0] in ['rm', 'volume', 'network'] for args in calls))

    def test_no_retry_or_second_target_after_unknown_stop_outcome(self):
        receipt, calls = fixture(), []

        def runner(args):
            calls.append(args)
            if args[0] == 'stop':
                raise TimeoutError('unknown result')
            return json.dumps(inspected(receipt, 'app'))
        with self.assertRaises(TimeoutError):
            subject.stop_owned(receipt, runner)
        self.assertEqual(sum(args[0] == 'stop' for args in calls), 1)
        self.assertTrue(all(args[-1] == receipt['appId'] for args in calls))


if __name__ == '__main__':
    unittest.main()
