import datetime as dt
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch
from types import SimpleNamespace
from uuid import uuid4

sys.dont_write_bytecode = True
SOURCE = Path(__file__).with_name('apply-xmartmenu-identity-foundation.py')
spec = importlib.util.spec_from_file_location('foundation_apply', SOURCE)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


def fixture():
    value = 'a' * 64
    baseline = {'digests': {'profiles': value}, 'criticalDigests': {'profile_authority': value, 'auth_ids': value}}
    review = {'version': 1, 'sourceProject': subject.SOURCE_PROJECT,
              'capturedAt': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
              'profilesDigest': value, 'authorityDigest': value, 'authIdsDigest': value,
              'users': [{'id': str(uuid4()), 'disabled': index == 0} for index in range(7)], 'readOnlySnapshot': True}
    return baseline, review


class RunnerTests(unittest.TestCase):
    def test_plan_has_no_source_or_database_operation_and_ambiguous_execute_refuses(self):
        for args in [[], ['--plan']]:
            result = subprocess.run([sys.executable, '-B', str(SOURCE), *args], capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 0)
            self.assertIn('PLAN ONLY', json.loads(result.stdout)['plan'])
        result = subprocess.run([sys.executable, '-B', str(SOURCE), '--plan', '--apply-reviewed-foundation'], capture_output=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)

    def test_review_requires_exact_fresh_seven_uuids_boolean_state_and_authority(self):
        baseline, review = fixture()
        self.assertGreater(subject.validate_review(review, baseline), 0)
        mutations = [lambda r: r['users'].append(r['users'][0]),
                     lambda r: r['users'][1].update(id=r['users'][0]['id']),
                     lambda r: r['users'][0].update(disabled='false'),
                     lambda r: r['users'][0].update(email='not-ownership'),
                     lambda r: r.update(version=True), lambda r: r.update(sourceProject='other'),
                     lambda r: r.update(readOnlySnapshot=False), lambda r: r.update(authIdsDigest='b' * 64),
                     lambda r: r.update(capturedAt='2020-01-01T00:00:00.000Z')]
        for mutate in mutations:
            changed = json.loads(json.dumps(review)); mutate(changed)
            with self.assertRaises(ValueError):
                subject.validate_review(changed, baseline)

    def test_private_packet_hash_mismatch_refuses_before_backup_or_sql(self):
        module = Mock()
        with patch.object(subject, 'load_backup_operator', return_value=module):
            with self.assertRaises(ValueError):
                subject.execute('a' * 64, 'b' * 64, {'privateSql': 'not accepted'})
            module.sql.assert_not_called()
            module.admission.assert_not_called()

    def test_missing_or_wrong_size_recovery_key_refuses_by_metadata_without_reading_it(self):
        folder = MagicMock(); folder.stat.return_value.st_mode = 0o40700
        folder.__truediv__.side_effect = lambda name: Path('/synthetic-private-backup') / name
        for size in [None, 64, 66]:
            module = Mock()
            def checked(path, directory=False):
                if not directory and path.name == 'archive.key':
                    if size is None:
                        raise FileNotFoundError('synthetic missing recovery key')
                    return SimpleNamespace(st_nlink=1, st_mode=0o100400, st_size=size)
                return SimpleNamespace(st_nlink=1, st_mode=0o100400, st_size=100)
            module.checked.side_effect = checked
            with patch.object(subject, 'BACKUP', folder), patch.object(Path, 'read_bytes') as read:
                with self.assertRaises((ValueError, FileNotFoundError)):
                    subject.backup_proof(module)
                read.assert_not_called()
                module.sql.assert_not_called()

    def test_postproof_checks_exact_controls_full_data_role_state_and_ledger_bodies(self):
        baseline, review = fixture()
        captured = subject.validate_review(review, baseline)
        rows = sorted([{'id': r['id'], 'disabledAt': captured if r['disabled'] else None, 'sessionVersion': 0} for r in review['users']], key=lambda row: row['id'])
        proof = {'oid': subject.DATABASE_OID, 'owner': 'xmartmenu_owner', 'tables': 51, 'ledger': 95,
                 'migrations': subject.MIGRATIONS,
                 'executionProjections': {version: 'xmartmenu-native-projection-sha256:' + subject.PROJECTION_SHA for version in subject.MIGRATIONS},
                 'accounts': rows, 'bindings': 0, 'sessions': 0,
                 'challenges': 0, 'dormant': 3, 'activeNativeSessions': 0, 'ownedRls': 4}
        module = Mock(); module.manifest.return_value = baseline; module.sql.return_value = json.dumps(proof)
        with patch.object(subject, 'role_state', return_value=['unchanged']):
            result = subject.postcheck(module, review, baseline, 'pinned query', ['unchanged'])
            self.assertEqual(result['accounts'], 7); self.assertFalse(result['runtimeLoginEnabled'])
            self.assertFalse(result['applicationCutover'])
            self.assertEqual(result['executionProjectionSha256'], subject.PROJECTION_SHA)
            self.assertEqual(result['sourceMigrationHashesMatched'], 3)
            for key, value in [('oid', 'different'), ('dormant', 2), ('bindings', 1), ('ledger', 94), ('ownedRls', 3)]:
                changed = dict(proof); changed[key] = value; module.sql.return_value = json.dumps(changed)
                with self.assertRaises(ValueError):
                    subject.postcheck(module, review, baseline, 'pinned query', ['unchanged'])
            changed = json.loads(json.dumps(proof)); changed['accounts'][0]['sessionVersion'] = 1
            module.sql.return_value = json.dumps(changed)
            with self.assertRaises(ValueError):
                subject.postcheck(module, review, baseline, 'pinned query', ['unchanged'])
            changed = json.loads(json.dumps(proof)); changed['executionProjections']['20261103190000'] = 'wrong projection'
            module.sql.return_value = json.dumps(changed)
            with self.assertRaises(ValueError):
                subject.postcheck(module, review, baseline, 'pinned query', ['unchanged'])

    def test_postproof_failure_never_attempts_cleanup_or_enables_login(self):
        baseline, review = fixture(); module = Mock(); module.manifest.return_value = {'changed': True}
        with self.assertRaises(ValueError):
            subject.postcheck(module, review, baseline, 'pinned query', [])
        module.sql.assert_not_called()
        source = SOURCE.read_text()
        self.assertNotIn('ALTER ROLE', source)
        self.assertNotIn('DROP DATABASE', source)
        self.assertNotIn('archive.key\').read', source)
        self.assertIn("module.sql(packet['publicPrelude'] + packet['privateSql'])", source)


if __name__ == '__main__':
    unittest.main()
