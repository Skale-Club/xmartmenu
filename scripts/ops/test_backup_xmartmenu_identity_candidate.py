import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SOURCE = Path(__file__).with_name('backup-xmartmenu-identity-candidate.py')
spec = importlib.util.spec_from_file_location('identity_backup', SOURCE)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)


class FixtureAES:
    def __init__(self, key):
        self.key = key

    def encrypt(self, iv, raw, aad):
        assert len(self.key) == 32 and len(iv) == 12 and aad is None
        return raw + b't' * 16

    def decrypt(self, iv, raw, aad):
        assert len(self.key) == 32 and len(iv) == 12 and aad is None
        if raw[-16:] != b't' * 16:
            raise ValueError('fixture tag mismatch')
        return raw[:-16]


class BackupTests(unittest.TestCase):
    def test_default_plan_has_no_execution_or_secret(self):
        for args in [[], ['--plan']]:
            result = subprocess.run([sys.executable, '-B', str(SOURCE), *args], capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 0)
            self.assertIn('PLAN ONLY', json.loads(result.stdout)['plan'])
        result = subprocess.run([sys.executable, '-B', str(SOURCE), '--plan', '--backup-rehearse-reviewed'], capture_output=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)

    def test_archive_framing_matches_existing_gcm_format(self):
        raw, key, iv = b'PGDMP synthetic archive', b'k' * 32, b'i' * 12
        archive = subject.encrypt(raw, key, iv, FixtureAES)
        self.assertEqual(archive[:8], b'XMRH0001')
        self.assertEqual(archive[8:20], iv)
        self.assertEqual(archive[-16:], b't' * 16)
        self.assertEqual(subject.decrypt(archive, key, FixtureAES), raw)
        with self.assertRaises(ValueError):
            subject.decrypt(archive[:-1] + b'x', key, FixtureAES)

    def test_archive_size_and_framing_fail_closed(self):
        for raw, key, iv in [(b'', b'k' * 32, b'i' * 12), (b'x', b'k' * 31, b'i' * 12), (b'x', b'k' * 32, b'i' * 11)]:
            with self.assertRaises(ValueError):
                subject.encrypt(raw, key, iv, FixtureAES)
        for raw in [b'XMRH0001', b'x' * 40, b'XMRH0001' + b'i' * 12 + b't' * 16]:
            with self.assertRaises(ValueError):
                subject.decrypt(raw, b'k' * 32, FixtureAES)

    def test_durable_files_never_overwrite_or_follow_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'archive'
            # O_NOFOLLOW is required by the real Linux runner. Windows can
            # exercise O_EXCL/fsync policy without weakening production guards.
            with patch.object(subject.os, 'O_NOFOLLOW', getattr(subject.os, 'O_NOFOLLOW', 0), create=True):
                subject.write_new(path, b'synthetic')
                self.assertEqual(path.read_bytes(), b'synthetic')
                with self.assertRaises(FileExistsError):
                    subject.write_new(path, b'replacement')
                self.assertEqual(path.read_bytes(), b'synthetic')
            path.chmod(0o600)

    def test_sql_refuses_any_other_database_before_process(self):
        with patch.object(subject, 'command') as process:
            for database in ['xmail', 'postgres', 'xmartmenu_identity_restore_other', 'xmartmenu;DROP DATABASE xmail']:
                with self.assertRaises(ValueError):
                    subject.sql('SELECT 1', database)
            process.assert_not_called()

    def test_process_resolves_target_every_time_and_never_exposes_stderr(self):
        with patch.object(subject, '_transport') as transport, patch.object(subject, 'target', return_value='a' * 64) as target, patch.object(subject.subprocess, 'run') as run:
            transport.DOCKER = ['docker']
            run.return_value = subprocess.CompletedProcess([], 1, b'', b'private database diagnostic')
            with self.assertRaisesRegex(ValueError, '^Candidate backup/rehearsal refused$'):
                subject.command('pg_dump', ['fixed'])
            target.assert_called_once()
            self.assertEqual(run.call_args.args[0], ['docker', 'exec', '-i', '-u', 'postgres', 'a' * 64, 'pg_dump', 'fixed'])

    def test_no_foundation_login_or_existing_database_cleanup_entrypoint(self):
        source = SOURCE.read_text()
        self.assertNotIn('ALTER ROLE', source)
        self.assertNotIn('DROP DATABASE xmartmenu;', source)
        self.assertNotIn('DROP DATABASE xmail', source)
        self.assertNotIn('WITH (FORCE)', source)
        self.assertIn("manifest(query, restore_db) == baseline and manifest(query) == baseline", source)
        self.assertLess(source.index('durable_directory(folder); durable_directory(ROOT)'), source.index('CREATE DATABASE {restore_db}'))


if __name__ == '__main__':
    unittest.main()
