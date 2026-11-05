import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

SOURCE = Path(__file__).with_name('export-xmartmenu-identity-pilot.py')
spec = importlib.util.spec_from_file_location('pilot_export', SOURCE)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


def fixture():
    return {'business': {'publicTableCount': 47, 'authIdCount': 7, 'ledgerCount': 92, 'ledgerLatest': '20261027097000',
                         'digests': {str(index): 'a' * 64 for index in range(47)}, 'roles': {'superadmin': 1, 'store-admin': 3, 'customer': 3}},
            'tables': [str(index) for index in range(51)], 'ledgerCount': 95, 'ledgerLatest': '20261103210000', 'ledgerDigest': 'b' * 64,
            'identity': {name: {'count': 7 if name == 'app_accounts' else 0, 'digest': 'c' * 64}
                         for name in ['app_accounts', 'app_identity_bindings', 'app_sessions', 'app_identity_challenges']},
            'disabled': 1, 'profilesHash': 'd' * 64, 'accountsHash': 'e' * 64}


class PilotExportTests(unittest.TestCase):
    def test_default_is_an_offline_plan(self):
        result = subprocess.run([sys.executable, '-B', str(SOURCE)], capture_output=True, timeout=4)
        self.assertEqual(result.returncode, 0)
        self.assertIn(b'PLAN ONLY', result.stdout)
        self.assertEqual(result.stderr, b'')

    def test_query_pin_matches_the_public_compiler(self):
        result = subprocess.run(['node', '--input-type=module', '-e',
            "import {PILOT_SNAPSHOT_SHA256} from './scripts/ops/xmartmenu-identity-pilot-snapshot.mjs';console.log(PILOT_SNAPSHOT_SHA256)"], capture_output=True, timeout=4)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.decode().strip(), subject.QUERY_SHA)

    def test_only_the_dormant_foundation_snapshot_is_exportable(self):
        self.assertEqual(subject.check_snapshot(fixture())['ledgerCount'], 95)
        for changed in [{'disabled': 0}, {'ledgerCount': 92}, {'ledgerLatest': 'unknown'}, {'accountsHash': 'raw-user'}, {'unexpected': True}]:
            with self.assertRaises(ValueError):
                subject.check_snapshot({**fixture(), **changed})
        for name in ['app_identity_bindings', 'app_sessions', 'app_identity_challenges']:
            value = fixture()
            value['identity'][name]['count'] = 1
            with self.assertRaises(ValueError):
                subject.check_snapshot(value)

    def test_current_capacity_is_bounded_without_a_historical_oom_zero_rule(self):
        good = {'available': 2 * 1024**3, 'disk': 1024**3, 'some': 0, 'full': 0, 'idle': .75, 'swapOutDelta': 0, 'pgCurrent': 256 * 1024**2}
        self.assertEqual(subject.capacity_guard(good), good)
        for change in [{'available': 1024}, {'disk': 1024}, {'some': .11}, {'full': .06}, {'idle': .49}, {'swapOutDelta': 1}, {'pgCurrent': 449 * 1024**2}]:
            with self.assertRaises(ValueError):
                subject.capacity_guard({**good, **change})

    def test_fixed_database_oid_dormant_roles_and_no_concurrent_session_are_required(self):
        class Helper:
            value = {'oid': 30227, 'owner': 'xmartmenu_owner', 'runtime': True, 'reader': True, 'otherSessions': 0}

            @classmethod
            def sql(cls, query):
                self.assertIn('BEGIN READ ONLY', query)
                return json.dumps(cls.value)
        self.assertEqual(subject.source_state(Helper)['oid'], 30227)
        original = dict(Helper.value)
        for change in [{'oid': 30228}, {'owner': 'other'}, {'runtime': False}, {'reader': False}, {'otherSessions': 1}]:
            Helper.value = {**original, **change}
            with self.assertRaises(ValueError):
                subject.source_state(Helper)


if __name__ == '__main__':
    unittest.main()
