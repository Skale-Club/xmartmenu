#!/usr/bin/env python3
"""Offline tests always run. The PostgreSQL phases run when XM_TEST_PG_CONTAINER names a disposable
postgres:17 container whose superuser is xmail_owner (CI starts one); the throwaway restore uses the local
postgres:17-alpine image. Never a real host."""
import builtins
import contextlib
import dataclasses
import datetime as dt
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ob', HERE / 'xprout-offsite-backup.py')
ob = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ob)
spec2 = importlib.util.spec_from_file_location('inst', HERE / 'install-xprout-offsite-backup.py')
inst = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(inst)
spec3 = importlib.util.spec_from_file_location('cut', HERE / 'xprout-final-cutover.py')
cut = importlib.util.module_from_spec(spec3)
spec3.loader.exec_module(cut)

CONTAINER = os.environ.get('XM_TEST_PG_CONTAINER')
IMAGE = 'postgres:17-alpine'
AMPLE = lambda cfg: {'mem_available_mib': 8192, 'swap_used_mib': 0, 'disk_free_bytes': 50 * 1024 ** 3}
POSIX = os.name != 'nt'


def make_cfg(root, **extra):
    recipient = root / 'recipient'
    recipient.mkdir(mode=0o700)
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '30', '-subj', '/CN=test recipient',
                    '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,keyEncipherment',
                    '-keyout', str(recipient / 'recipient.key'), '-out', str(recipient / 'recipient.crt')], check=True, capture_output=True)
    for f in recipient.iterdir():
        os.chmod(f, 0o600)
    der = subprocess.run(['openssl', 'x509', '-outform', 'DER'], input=(recipient / 'recipient.crt').read_bytes(), capture_output=True, check=True).stdout
    cfg = ob.Config(base=root / 'xm', recipient_dir=recipient, recipient_sha=ob.sha(der), pg_container=CONTAINER or 'none', pg_image=IMAGE,
                    xmail_backup_lock=root / 'xmail-backup.lock', xmail_receiver_lock=root / 'xmail-receiver.lock', xmail_deploy_lock=root / 'xmail-deploy.lock',
                    sentinel_tables=('app_accounts', 'orders'), strict=POSIX, uid=os.getuid() if POSIX else 0, production=False, capacity=AMPLE, **extra)
    cfg.base.mkdir(mode=0o700)
    cfg.ops.mkdir(mode=0o700)
    for name in ('transport.key', 'known_hosts'):
        (cfg.ops / name).write_bytes(b'placeholder')
        os.chmod(cfg.ops / name, 0o600)
    (cfg.ops / 'recipient.crt').write_bytes((recipient / 'recipient.crt').read_bytes())
    os.chmod(cfg.ops / 'recipient.crt', 0o600)
    for lock in (cfg.ops / 'backup.lock', cfg.ops / 'receiver.lock'):
        lock.write_bytes(b'')
        os.chmod(lock, 0o600)
    return cfg


class OfflineTests(unittest.TestCase):
    def test_plan_modes_do_nothing(self):
        def boom(*a, **k):
            raise AssertionError('plan touched the system')
        buffer = io.StringIO()
        with mock.patch.object(subprocess, 'run', boom), mock.patch.object(subprocess, 'Popen', boom), mock.patch.object(os, 'open', boom), \
                mock.patch.object(os, 'mkdir', boom), mock.patch.object(Path, 'write_bytes', boom), mock.patch.object(Path, 'mkdir', boom), \
                contextlib.redirect_stdout(buffer):
            self.assertEqual(ob.main([]), 0)
            self.assertEqual(ob.main(['--plan']), 0)
            self.assertEqual(inst.main([]), 0)
            self.assertEqual(inst.main(['--plan']), 0)
        self.assertIn('PLAN ONLY', buffer.getvalue())
        self.assertIn('"changes": "none"', buffer.getvalue())

    def test_schedule_does_not_collide_with_xmail(self):
        self.assertIn('03:50:00 UTC', inst.TIMER)
        self.assertIn('RandomizedDelaySec=10m', inst.TIMER)
        self.assertIn('Persistent=true', inst.TIMER)
        self.assertIn('xmail-owned-backup.service', inst.SERVICE)
        self.assertIn('MemoryMax=256M', inst.SERVICE)
        # Xmail: 03:15 + up to 15 min, unit timeout 650 s -> done by 03:41:50 at the latest
        self.assertGreater(3 * 60 + 50, 3 * 60 + 15 + 15 + 11)

    def test_forced_command_line(self):
        key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dk0AFdxQo'
        line = inst.authorized_line(key)
        self.assertTrue(line.startswith('from="49.13.197.250",restrict,command="/usr/bin/python3 -B /opt/xmartmenu/offsite-backup-ops/code/xmartmenu-offsite-backup.py --receive" '))
        self.assertTrue(line.endswith(' xmartmenu-offsite-backup-v1'))
        with self.assertRaises(ValueError):
            inst.authorized_line('ssh-rsa AAAA')
        with self.assertRaises(ValueError):
            inst.host_line('188.245.112.3 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dk0AFdxQo')  # wrong key

    def test_installer_refuses_without_the_exact_script_hash(self):
        args = mock.Mock(role='source', backup_script_sha256='0' * 64, prepare_transport=False)
        with self.assertRaises(ValueError):
            inst.run(args)

    def test_restore_profile_is_bounded(self):
        for size in (1, 5 << 20, 23 << 20, 32 << 20):
            data, memory = ob.restore_profile(size)
            self.assertTrue(256 << 20 <= data <= 512 << 20)
            self.assertLessEqual(memory, 736)
            self.assertGreater(memory * ob.MIB, data)  # tmpfs pages count against the memory limit
        self.assertEqual(ob.restore_profile(23 << 20)[0], 368 << 20)

    def test_capacity_floor_matches_the_cutover_operator(self):
        cfg = ob.Config()
        self.assertEqual((cfg.min_mem_available_mib, cfg.max_swap_used_mib, cfg.min_disk_gib), (1024, 512, 2))
        self.assertEqual(ob.capacity_problems(cfg, {'mem_available_mib': 900, 'swap_used_mib': 600, 'disk_free_bytes': 1}), ['memory', 'swap', 'disk'])
        self.assertEqual(ob.capacity_problems(cfg, {'mem_available_mib': 1500, 'swap_used_mib': 0, 'disk_free_bytes': 9 << 30}, extra_mem_mib=600), ['memory'])

    def test_restore_container_has_hard_limits(self):
        a = ob.restore_arguments(ob.Config(), 'xmartmenu-dr-x', 'x', 368 << 20, 592)
        joined = ' '.join(a)
        for needle in ('--network none', '--read-only', '--memory 592m', '--memory-swap 592m', '--cpus 0.5', '--pids-limit 96', '--oom-score-adj 1000', '--pull=never', 'no-new-privileges'):
            self.assertIn(needle, joined)
        self.assertNotIn('-v ', joined)
        self.assertNotIn('-p ', joined)

    def test_packet_validation(self):
        cfg = ob.Config()
        good = {'version': 1, 'app': 'xmartmenu', 'operation': 'xmartmenu-20261105T031500Z-' + 'a' * 16, 'archiveSha256': 'a' * 64, 'archiveBytes': 10, 'cipherSha256': 'b' * 64,
                'cipherBytes': 20, 'dumpBytes': 5, 'recipientDerSha256': cfg.recipient_sha, 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat()}
        self.assertEqual(ob.packet(cfg, good), good)
        for change in ({'app': 'xmail'}, {'version': 2}, {'recipientDerSha256': 'c' * 64}, {'operation': 'owned-20261105T031500Z-' + 'a' * 16}, {'cipherBytes': 5},
                       {'dumpBytes': 99 << 20}, {'createdAt': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)).isoformat()}, {'createdAt': 'nonsense'}, {'extra': 1}):
            with self.assertRaises(ob.Refused, msg=str(change)):
                ob.packet(cfg, {**good, **change})

    def test_receiver_accepts_only_the_forced_command_from_the_source(self):
        cfg = dataclasses.replace(ob.Config(), strict=False)
        for env in ({}, {'SSH_CONNECTION': '1.2.3.4 1 188.245.112.3 22', 'SSH_ORIGINAL_COMMAND': 'xmartmenu-offsite-backup'},
                    {'SSH_CONNECTION': '49.13.197.250 1 188.245.112.3 22', 'SSH_ORIGINAL_COMMAND': 'xmail-owned-backup'},
                    {'SSH_CONNECTION': '49.13.197.250 1 10.0.0.1 22', 'SSH_ORIGINAL_COMMAND': 'xmartmenu-offsite-backup'}):
            with self.assertRaises(ob.Refused) as c:
                ob.receive(cfg, io.BytesIO(b''), env)
            self.assertEqual(c.exception.label, 'peer')

    def test_failure_payload_has_no_free_text(self):
        try:
            ob.need(False, 'restore-failed')
        except ob.Refused as e:
            e.sqlstate = '53100'
            p = ob.failure_payload(e)
        self.assertEqual((p['step'], p['sqlState']), ('restore-failed', '53100'))
        p = ob.failure_payload(ValueError('postgresql://user:secret@host/db'))
        self.assertEqual(p['step'], 'unexpected')
        self.assertNotIn('secret', json.dumps(p))
        r = ob.remote_failure(b'Warning: noise\n{"xmartmenuOffsiteFailed":true,"step":"restore-mismatch","location":[]}\n')
        self.assertEqual(r.label, 'remote-restore-mismatch')
        self.assertEqual(ob.remote_failure(b'garbage').label, 'remote-unknown')
        self.assertEqual(ob.remote_failure(b'{"xmartmenuOffsiteFailed":true,"step":"x y"}').label, 'remote-unknown')

    def test_manifest_sql_rejects_odd_table_names(self):
        with self.assertRaises(ob.Refused):
            ob.manifest_sql(['a"; DROP TABLE x; --'], False)
        sql = ob.manifest_sql(['orders', 'app_accounts'], True)
        self.assertIn('public."orders"', sql)
        self.assertIn('schema_migrations', sql)
        self.assertNotIn('schema_migrations', ob.manifest_sql(['orders'], False))
        many = ob.manifest_sql(['t%d' % i for i in range(300)], False)  # more than 100 tables must not hit jsonb_build_object's argument limit
        self.assertIn('jsonb_object_agg(k,v)', many)

    def test_ledger_digest_order_does_not_depend_on_the_database_collation(self):
        # source is en_US.UTF-8 (glibc), the restore container is Alpine/musl: a text ORDER BY must pin "C"
        sql = ob.manifest_sql([], True)
        self.assertIn('ORDER BY to_jsonb(t)::text COLLATE "C"', sql)

    def test_compare_classifies_without_values(self):
        base = {'tables': ['a', 'b'], 'schema': {'a': ['1' * 64] * 5 + [False, False], 'b': ['2' * 64] * 5 + [False, False]}, 'functions': {}, 'types': {}, 'sequences': {}, 'ledger': None,
                'policyRoles': [], 'rows': {'a': {'count': 1, 'sum': '1:1'}, 'b': {'count': 2, 'sum': '2:2'}}}
        other = json.loads(json.dumps(base))
        self.assertTrue(ob.equivalent(ob.compare(base, other)))
        other['rows']['b']['sum'] = '9:9'
        other['schema']['a'][1] = '3' * 64
        s = ob.compare(base, other)
        self.assertFalse(ob.equivalent(s))
        self.assertEqual(s['rowDifferences'], ['b'])
        self.assertEqual(s['schemaDifferences'][0]['table'], 'a')
        self.assertFalse(s['schemaDifferences'][0]['constraints'])
        self.assertTrue(s['schemaDifferences'][0]['columns'])

    def test_offsite_receipt_satisfies_the_cutover_check(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'latest.json'
            body = {'at': int(time.time()), 'sha256': 'a' * 64, 'restored': True, 'database': 'xmartmenu'}
            fake = mock.Mock()
            fake.cfg = cut.Config(offhost_receipt=path)
            path.write_text(json.dumps(body))
            self.assertIsNone(cut.Cutover.offhost_problem(fake))
            path.write_text(json.dumps({**body, 'at': int(time.time()) - 27 * 3600}))
            self.assertEqual(cut.Cutover.offhost_problem(fake), 'offhost-backup-stale')
        self.assertEqual(ob.Config().receipt, cut.Config().offhost_receipt)
        self.assertEqual(ob.Config().database, cut.Config().database)
        self.assertEqual((ob.PG_CONTAINER, ob.Config().admin_user), (cut.Config().container, cut.Config().admin_user))


@unittest.skipUnless(CONTAINER, 'XM_TEST_PG_CONTAINER not set')
class PostgresTests(unittest.TestCase):
    def psql(self, sql, db='xmartmenu'):
        return subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'xmail_owner', '-d', db], input=sql.encode(),
                              capture_output=True, check=True).stdout.decode().strip()

    @classmethod
    def setUpClass(cls):
        def admin(sql, db='postgres'):
            subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'xmail_owner', '-d', db], input=sql.encode(), capture_output=True, check=True)
        admin('DROP DATABASE IF EXISTS xmartmenu WITH (FORCE)')
        admin('CREATE DATABASE xmartmenu')
        admin("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;")
        admin("""
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text);
INSERT INTO supabase_migrations.schema_migrations VALUES ('20260101000000','one'),('20260102000000','two');
CREATE TYPE public.mood AS ENUM ('ok','bad');
CREATE TABLE public.app_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, mood public.mood DEFAULT 'ok',
  meta jsonb, score numeric(10,2) CHECK (score BETWEEN 1 AND 128 AND length(email) > 0), created timestamptz DEFAULT now());
CREATE SEQUENCE public.order_no START 100;
CREATE TABLE public.orders(id bigserial PRIMARY KEY, account_id uuid REFERENCES public.app_accounts(id), number int DEFAULT nextval('public.order_no'),
  total numeric NOT NULL, note text, blob bytea, at timestamptz DEFAULT now());
CREATE TABLE public.empty_table(id int);
CREATE INDEX orders_account_idx ON public.orders(account_id);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY own ON public.orders FOR SELECT TO authenticated USING (total > 0);
CREATE FUNCTION public.bump() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN NEW.note := coalesce(NEW.note,'x'); RETURN NEW; END $f$;
CREATE TRIGGER orders_bump BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.bump();
INSERT INTO public.app_accounts(email, meta, score) SELECT 'u' || g || '@example.test', jsonb_build_object('n', g, 'tags', jsonb_build_array('a','b')), (g % 100) + 1 FROM generate_series(1, 300) g;
INSERT INTO public.orders(account_id, total, blob) SELECT id, 10.5, '\\xdeadbeef'::bytea FROM public.app_accounts;
""", 'xmartmenu')

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.cfg = make_cfg(self.root)

    def tearDown(self):
        self._tmp.cleanup()

    def sender(self, cfg=None, hook=None):
        def send(header, cipher_path):
            body = ob.encoded(header) + b'\n' + cipher_path.read_bytes()
            if hook:
                body = hook(body)
            return ob.receive(cfg or self.cfg, io.BytesIO(body))
        return send

    def no_dr_containers(self):
        out = subprocess.run(['docker', 'ps', '-aq', '--filter', 'name=xmartmenu-dr-'], capture_output=True, check=True).stdout.strip()
        self.assertEqual(out, b'')

    def test_full_cycle_restores_proves_and_writes_the_receipt(self):
        result = ob.backup(self.cfg, self.sender())
        self.assertTrue(result['offsiteBackupVerified'] and result['receiptWritten'])
        self.assertEqual(result['tables'], 3)
        self.no_dr_containers()
        receipt = json.loads(self.cfg.receipt.read_text())
        self.assertEqual((receipt['restored'], receipt['database']), (True, 'xmartmenu'))
        self.assertRegex(receipt['sha256'], r'^[0-9a-f]{64}$')
        fake = mock.Mock()
        fake.cfg = cut.Config(offhost_receipt=self.cfg.receipt)
        self.assertIsNone(cut.Cutover.offhost_problem(fake))
        published = list(self.cfg.archives.iterdir())
        self.assertEqual(len(published), 1)
        self.assertEqual({p.name for p in published[0].iterdir()}, {'snapshot.tar.cms', 'receipt.json'})
        self.assertEqual(len(list((self.cfg.ops / 'local-archives').iterdir())), 1)
        self.assertFalse(any(self.cfg.ops.glob('local-archives/pending-*')))
        # plaintext never survives next to the ciphertext
        self.assertNotIn(b'PGDMP', b''.join(p.read_bytes() for p in published[0].iterdir()))

    def test_default_transport_receives_the_config(self):
        # backup() without an injected sender must call ssh_send(cfg, header, cipher_path)
        inner = self.sender()
        seen = []
        def fake_ssh_send(cfg, header, cipher_path):
            seen.append(cfg)
            return inner(header, cipher_path)
        with mock.patch.object(ob, 'ssh_send', fake_ssh_send):
            result = ob.backup(self.cfg)
        self.assertEqual(seen, [self.cfg])
        self.assertTrue(result['offsiteBackupVerified'] and result['receiptWritten'])
        self.no_dr_containers()

    def test_retention_keeps_the_last_seven(self):
        cfg = dataclasses.replace(self.cfg, keep=2)
        for _ in range(3):
            ob.backup(cfg, self.sender(cfg))
            time.sleep(1.1)
        self.assertEqual(len(list(cfg.archives.iterdir())), 2)
        self.assertEqual(len(list((cfg.ops / 'local-archives').iterdir())), 2)

    def test_a_tampered_ciphertext_publishes_nothing_and_writes_no_receipt(self):
        def tamper(body):
            raw = bytearray(body)
            raw[-40] ^= 1
            return bytes(raw)
        with self.assertRaises(ob.Refused):
            ob.backup(self.cfg, self.sender(hook=tamper))
        self.assertFalse(self.cfg.receipt.exists())
        self.assertEqual(list(self.cfg.archives.iterdir()), [])
        self.assertEqual(list((self.cfg.ops / 'local-archives').iterdir()), [])
        self.no_dr_containers()

    def test_a_restore_that_differs_is_refused_with_a_classified_mismatch(self):
        original = ob.restore_and_compare

        def corrupt(cfg, stage, expected, operation, dump_bytes):
            expected['rows']['orders']['sum'] = '1:1'
            return original(cfg, stage, expected, operation, dump_bytes)
        with mock.patch.object(ob, 'restore_and_compare', corrupt):
            with self.assertRaises(ob.Refused) as c:
                ob.backup(self.cfg, self.sender())
        self.assertEqual(c.exception.label, 'restore-mismatch')
        self.assertEqual(c.exception.detail['rowDifferences'], ['orders'])
        self.assertFalse(self.cfg.receipt.exists())
        self.assertEqual(list(self.cfg.archives.iterdir()), [])
        self.no_dr_containers()

    def test_capacity_refusal_happens_before_anything_is_dumped(self):
        low = dataclasses.replace(self.cfg, capacity=lambda c: {'mem_available_mib': 500, 'swap_used_mib': 900, 'disk_free_bytes': 50 << 30})
        with self.assertRaises(ob.Refused) as c:
            ob.backup(low, self.sender())
        self.assertEqual(c.exception.label, 'capacity-source-memory-swap')
        self.assertEqual(list((low.ops).glob('local-archives/*')), [])

    def test_target_capacity_counts_the_restore_container(self):
        calls = []

        def tight(c):
            calls.append(1)
            return {'mem_available_mib': 1024 + 100 if len(calls) > 1 else 8192, 'swap_used_mib': 0, 'disk_free_bytes': 50 << 30}
        cfg = dataclasses.replace(self.cfg, capacity=tight)
        with self.assertRaises(ob.Refused) as c:
            ob.backup(cfg, self.sender(cfg))
        self.assertIn('capacity-target-memory', c.exception.label)
        self.assertEqual(list(cfg.archives.iterdir()), [])

    @unittest.skipUnless(ob.fcntl, 'flock')
    def test_overlapping_xmail_backup_or_deploy_is_never_disturbed(self):
        import fcntl
        for name, label in (('xmail_backup_lock', 'xmail-backup-busy'), ('xmail_deploy_lock', 'xmail-deploy-busy')):
            path = getattr(self.cfg, name)
            path.write_bytes(b'')
            os.chmod(path, 0o600)
            fd = os.open(path, os.O_WRONLY)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                with self.assertRaises(ob.Refused) as c:
                    ob.backup(self.cfg, self.sender())
                self.assertEqual(c.exception.label, label)
            finally:
                os.close(fd)
            path.unlink()
        # the receiver likewise refuses while an Xmail receiver restore holds its lock
        self.cfg.xmail_receiver_lock.write_bytes(b'')
        os.chmod(self.cfg.xmail_receiver_lock, 0o600)
        fd = os.open(self.cfg.xmail_receiver_lock, os.O_WRONLY)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            with self.assertRaises(ob.Refused) as c:
                ob.backup(self.cfg, self.sender())
            self.assertEqual(c.exception.label, 'xmail-receiver-busy')
        finally:
            os.close(fd)
        # and a second run of ours cannot overlap itself
        held = ob.lock_file(self.cfg, self.cfg.ops / 'backup.lock')
        try:
            with self.assertRaises(ob.Refused) as c:
                ob.backup(self.cfg, self.sender())
            self.assertEqual(c.exception.label, 'lock-busy')
        finally:
            ob.release([held])

    def test_wrong_database_is_refused(self):
        cfg = dataclasses.replace(self.cfg, sentinel_tables=('app_accounts', 'no_such_table'))
        with self.assertRaises(ob.Refused) as c:
            ob.backup(cfg, self.sender(cfg))
        self.assertEqual(c.exception.label, 'manifest-wrong-database')

    def test_unknown_files_are_never_deleted_by_retention(self):
        ob.backup(self.cfg, self.sender())
        stray = next(self.cfg.archives.iterdir()) / 'notes.txt'
        stray.write_bytes(b'x')
        os.chmod(stray, 0o600)
        with self.assertRaises(ob.Refused) as c:
            ob.retention(self.cfg, self.cfg.archives, 0)
        self.assertEqual(c.exception.label, 'retention-unknown-content')
        self.assertTrue(stray.exists())

    def test_the_manifest_is_stable_and_sees_changes(self):
        def at(sql):
            return self.psql(ob.readonly_prelude() + sql + ';ROLLBACK;').splitlines()[-1]
        a = ob.build_manifest(self.cfg, at)
        self.assertEqual(a, ob.build_manifest(self.cfg, at))
        self.assertEqual(a['rows']['empty_table'], {'count': 0, 'sum': '0:0'})
        self.assertEqual(a['rows']['orders']['count'], 300)
        self.assertEqual(a['ledger']['count'], 2)
        self.assertEqual(a['policyRoles'], ['authenticated'])
        self.psql("UPDATE public.orders SET note='changed' WHERE id=1")
        try:
            b = ob.build_manifest(self.cfg, at)
            self.assertEqual(ob.compare(a, b)['rowDifferences'], ['orders'])
        finally:
            self.psql("UPDATE public.orders SET note='x' WHERE id=1")


if __name__ == '__main__':
    unittest.main()
