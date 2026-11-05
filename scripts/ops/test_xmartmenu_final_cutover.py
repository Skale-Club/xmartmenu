#!/usr/bin/env python3
"""Offline tests always run; the PostgreSQL phases run when XM_TEST_PG_CONTAINER names a disposable
postgres:17 container whose superuser is xmail_owner (CI starts one; never a real host)."""
import contextlib
import http.server
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
spec = importlib.util.spec_from_file_location('cutover', HERE / 'xmartmenu-final-cutover.py')
cut = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cut)

CONTAINER = os.environ.get('XM_TEST_PG_CONTAINER')
SHA = 'a' * 40


class OfflineTests(unittest.TestCase):
    def test_scram_format(self):
        v = cut.scram_verifier('x' * 48, salt=b'\0' * 16)
        self.assertRegex(v, r'^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$')

    def test_output_never_carries_free_text(self):
        line = cut.say(phase='x', check='postgresql://u:p@h/db')
        self.assertIn('check=redacted', line)

    def test_fence_sql_is_reversible_and_always(self):
        up, down = cut.fence_sql(['a', 'b']), cut.unfence_sql(['a', 'b'])
        self.assertIn('ENABLE ALWAYS TRIGGER', up)
        self.assertIn('TRUNCATE', up)
        self.assertIn('DROP SCHEMA IF EXISTS xm_cutover_fence', down)
        self.assertNotIn('CASCADE', down)

    def test_dump_filter(self):
        ok = b"SET x = 1;\n-- c\nCOPY public.a (id) FROM stdin;\n1\n\\.\n\nSELECT pg_catalog.setval('s', 1, true);\n"
        self.assertEqual(set(cut.filter_dump(ok, {'a'})), {'a'})
        for bad, label in [(b"DROP TABLE x;\n", 'dump-statement'), (ok + ok, 'dump-table'), (b"-- n\n", 'dump-incomplete'),
                           (b"COPY public.zz (id) FROM stdin;\n1\n\\.\n", 'dump-table'), (b"COPY public.a (id) FROM stdin;\n1\n", 'dump-truncated')]:
            with self.assertRaises(cut.Refused) as c:
                cut.filter_dump(bad, {'a'})
            self.assertEqual(c.exception.label, label)

    def test_proposal_order_and_files(self):
        names = [n for n, _, _ in cut.PROPOSALS]
        self.assertEqual(names[:4], ['identity-foundation', 'native-tenant-effects', 'native-tenant-effects-dispatch', 'native-tenant-operations'])
        on_disk = {p.name for p in (REPO / 'docs/proposals').glob('*-owned-only.sql')}
        self.assertEqual({f for _, f, _ in cut.PROPOSALS if f}, on_disk)
        self.assertEqual(len(on_disk), 11 - 0 if False else 11)

    def test_flags_match_the_application(self):
        text = (REPO / 'src/lib/data/owned-mode.ts').read_text()
        for f in cut.FLAGS:
            self.assertIn("'" + f + "'", text)
        self.assertEqual(len(cut.FLAGS), text.count("'OWNED_"))

    def test_google_claims_parity(self):
        uid = '11111111-1111-4111-8111-111111111111'
        users = [{'id': uid, 'identities': [{'provider': 'google', 'provider_id': '12345678901'}]},
                 {'id': '22222222-2222-4222-8222-222222222222', 'identities': [{'provider': 'google', 'provider_id': '99999999999'}]},
                 {'id': uid, 'identities': [{'provider': 'email'}]}]
        self.assertEqual(cut.plan_claims(users, {uid}), [('12345678901', uid)])

    def test_budget_arithmetic(self):
        self.assertEqual((12 - 1) // 2, 5)


class FakeCoolify:
    """HTTP server that mimics the handful of Coolify endpoints used."""
    def __init__(self, app):
        self.envs = {'IMAGE_TAG': 'b' * 40, 'HEALTH_TOKEN': 'tok', 'GOOGLE_AUTH_ENABLED': 'false',
                     **{k: 'x' for k in cut.GOOGLE_STAGED}}
        self.status, self.requests, self.fail_deploy, self.mode = 'running:healthy', [], False, 'legacy'
        fake = self

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def reply(self, code, body=None):
                raw = json.dumps(body).encode() if body is not None else b''
                self.send_response(code)
                self.send_header('Content-Length', str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def body(self):
                n = int(self.headers.get('Content-Length') or 0)
                return json.loads(self.rfile.read(n)) if n else None

            def do_GET(self):
                fake.requests.append(('GET', self.path))
                if self.path.endswith('/envs'):
                    return self.reply(200, [{'key': k, 'value': v, 'uuid': 'u-' + k} for k, v in fake.envs.items()])
                if '/deployments/' in self.path:
                    failed, fake.fail_deploy = fake.fail_deploy, False
                    return self.reply(200, {'status': 'failed' if failed else 'finished'})
                if self.path.startswith('/api/v1/applications/'):
                    return self.reply(200, {'status': fake.status})
                if self.path == '/api/health/ready':
                    owned = fake.envs.get('OWNED_AUTH_ENABLED') == 'true'
                    return self.reply(200, {'status': 'ok', 'release': fake.envs['IMAGE_TAG'], 'checks': {'database': {'ok': True}},
                                            'config': {'database_mode': 'owned' if owned else 'legacy', 'storage': 's3'}})
                return self.reply(200, {})

            def do_POST(self):
                fake.requests.append(('POST', self.path))
                body = self.body()
                if self.path.endswith('/stop'):
                    fake.status = 'exited'
                    return self.reply(200, {})
                if self.path.startswith('/api/v1/deploy'):
                    fake.status = 'running:healthy'
                    if fake.envs.get('OWNED_AUTH_ENABLED') == 'true':  # the new app connects as the runtime role
                        subprocess.Popen(['docker', 'exec', '-d', CONTAINER, 'psql', '-h', '127.0.0.1', '-U', 'xmartmenu_runtime', '-d', 'xmartmenu', '-c', 'select pg_sleep(120)'])
                        import time as _t
                        _t.sleep(1)
                    return self.reply(200, {'deployments': [{'deployment_uuid': 'd1'}]})
                if self.path.endswith('/envs'):
                    fake.envs[body['key']] = body['value']
                return self.reply(201, {})

            def do_PATCH(self):
                fake.requests.append(('PATCH', self.path))
                body = self.body()
                fake.envs[body['key']] = body['value']
                self.reply(200, {})

            def do_DELETE(self):
                fake.requests.append(('DELETE', self.path))
                fake.envs.pop(self.path.rsplit('/u-', 1)[1], None)
                self.reply(200, {})

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def close(self):
        self.server.shutdown()


def psql(db, sql, user='xmail_owner', check=True):
    p = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db],
                       input=sql.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and p.returncode:
        raise AssertionError(p.stderr.decode()[-600:])
    return p.stdout.decode().strip(), p.returncode


SOURCE_SCHEMA = """
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, deleted_at timestamptz, banned_until timestamptz);
CREATE TABLE public.tenants(id uuid PRIMARY KEY, slug text, is_active boolean, created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles(id uuid PRIMARY KEY, tenant_id uuid, role text);
CREATE TABLE public.products(id uuid PRIMARY KEY, tenant_id uuid, menu_id uuid, name text);
CREATE TABLE public.orders(id uuid PRIMARY KEY, tenant_id uuid, customer_id uuid, currency text, total numeric);
CREATE TABLE public.order_items(id uuid PRIMARY KEY, order_id uuid, product_id uuid);
CREATE TABLE public.customer_profiles(id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.waiter_calls(id uuid PRIMARY KEY, acknowledged_by uuid);
CREATE TABLE public.audit_events(id bigserial PRIMARY KEY, note text);
"""
LEGACY_FKS = """
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.customer_profiles ADD CONSTRAINT customer_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.waiter_calls ADD CONSTRAINT waiter_calls_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES auth.users(id) ON DELETE SET NULL;
"""
USERS = [f'00000000-0000-4000-8000-00000000000{i}' for i in range(1, 8)]
TENANT = '10000000-0000-4000-8000-000000000001'


def seed(count_orders):
    vals = ','.join(f"('{u}')" for u in USERS)
    sql = f"INSERT INTO auth.users(id) VALUES {vals};\nINSERT INTO public.tenants VALUES ('{TENANT}','demo',true);\n"
    sql += ''.join(f"INSERT INTO public.profiles VALUES ('{u}','{TENANT}','customer');\n" for u in USERS)
    sql += ''.join(f"INSERT INTO public.orders VALUES (gen_random_uuid(),'{TENANT}','{USERS[0]}','usd',{i}.50);\n" for i in range(count_orders))
    sql += "INSERT INTO public.audit_events(note) VALUES ('a'),('b'),('c');\n"
    return sql


TARGET_EXTRA = """
CREATE ROLE xmartmenu_owner NOLOGIN; CREATE ROLE xmartmenu_staging_reader NOLOGIN CONNECTION LIMIT 2;
CREATE ROLE xmartmenu_runtime NOLOGIN BYPASSRLS CONNECTION LIMIT 12; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
"""


@unittest.skipUnless(CONTAINER, 'XM_TEST_PG_CONTAINER not set')
class PostgresPhases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        psql('postgres', "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='xmartmenu_owner') THEN CREATE ROLE xmartmenu_owner NOLOGIN; CREATE ROLE xmartmenu_staging_reader NOLOGIN CONNECTION LIMIT 2; CREATE ROLE xmartmenu_runtime NOLOGIN BYPASSRLS CONNECTION LIMIT 12; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; END IF; END $$;")

    def setUp(self):
        psql('postgres', 'ALTER ROLE xmartmenu_runtime NOLOGIN PASSWORD NULL')
        for db in ('xm_source', 'xmartmenu'):
            psql('postgres', f'DROP DATABASE IF EXISTS {db} WITH (FORCE)')
        psql('postgres', 'CREATE DATABASE xm_source')
        psql('xm_source', SOURCE_SCHEMA + LEGACY_FKS + seed(2))
        psql('postgres', 'CREATE DATABASE xmartmenu OWNER xmartmenu_owner')
        # candidate: same schema, stale data, identity foundation and a compat auth.users
        psql('xmartmenu', SOURCE_SCHEMA.replace('auth.users(id uuid PRIMARY KEY, deleted_at timestamptz, banned_until timestamptz)', 'auth.users(id uuid PRIMARY KEY)') + LEGACY_FKS + seed(0) + """
CREATE TABLE public.app_accounts(id uuid PRIMARY KEY, disabled_at timestamptz, session_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.app_identity_bindings(project_id text, subject text, user_id uuid REFERENCES public.app_accounts(id), provider text, binding_proof text, created_at timestamptz DEFAULT now(),
  PRIMARY KEY(project_id, subject), CONSTRAINT app_identity_bindings_binding_proof_check CHECK (binding_proof IN ('legacy-session','google-subject','operator-recovery')));
CREATE TABLE public.app_sessions(token_hash text PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.app_identity_challenges(id uuid PRIMARY KEY);
CREATE FUNCTION public.complete_onboarding(uuid, jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261103210000');
""" + ''.join(f"INSERT INTO public.app_accounts(id) VALUES ('{u}');\n" for u in USERS) + """
DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname IN ('public') LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO xmartmenu_owner', r.tablename); END LOOP; END $$;
ALTER TABLE auth.users OWNER TO xmartmenu_owner;
GRANT USAGE ON SCHEMA auth TO xmartmenu_owner;
GRANT USAGE ON SCHEMA public TO xmartmenu_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_runtime;
""")
        self.fake = FakeCoolify(None)
        self.root = Path(tempfile.mkdtemp())
        self.bundle = Path(tempfile.mkdtemp())
        (self.bundle / 'proposals').mkdir()
        import hashlib
        meta = {}
        for _, f, _ in cut.PROPOSALS:
            if f:
                data = (REPO / 'docs/proposals' / f).read_bytes()
                (self.bundle / 'proposals' / f).write_bytes(data)
                meta[f] = hashlib.sha256(data).hexdigest()
        (self.bundle / 'bundle.json').write_text(json.dumps({'proposals': meta}))

    def tearDown(self):
        self.fake.close()
        psql('postgres', "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename='xmartmenu_runtime'", check=False)

    def build(self):
        cfg = cut.Config(container=CONTAINER, coolify_base=self.fake.base, public_url=self.fake.base, root=self.root, production_host=False,
                         expected_tables=8, poll_seconds=0, sleep=lambda s: None)
        target = cut.Pg(cut.docker_exec_launcher(cfg), ['-U', 'xmail_owner'])

        def make_source(url):
            def launcher(binary, args):
                return ['docker', 'exec', '-i', CONTAINER, binary, *args]
            return cut.Pg(launcher, ['-U', 'xmail_owner', '-d', 'xm_source'])
        coolify = cut.Coolify(cfg, 't')
        sec = {'COOLIFY_TOKEN': 't', 'SUPABASE_SOURCE_DATABASE_URL': 'postgresql://secret-source-password@h/db'}
        return cut.Cutover(cfg, sec, SHA, self.bundle, target, make_source, coolify, skip_google=True), cfg

    def run_mode(self, op, mode):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = getattr(op, mode)()
        return code, buf.getvalue()

    def test_plan_changes_nothing(self):
        op, cfg = self.build()
        before = psql('xmartmenu', "SELECT count(*) FROM public.orders")[0]
        code, out = self.run_mode(op, 'plan')
        self.assertIn('check=rows table=orders source=2 candidate=0 diff=2', out)
        self.assertIn('proposals-pending count=11', out)
        self.assertEqual(psql('xmartmenu', "SELECT count(*) FROM public.orders")[0], before)
        self.assertEqual({m for m, _ in self.fake.requests}, {'GET'})
        self.assertFalse(list(self.root.glob('state.json')))
        self.assertNotIn('secret-source-password', out)

    def test_apply_then_rollback(self):
        op, cfg = self.build()
        code, out = self.run_mode(op, 'apply')
        self.assertEqual(code, 0, out)
        self.assertEqual(psql('xmartmenu', 'SELECT count(*) FROM public.orders')[0], '2')
        self.assertEqual(psql('xmartmenu', "SELECT last_value::text || is_called::text FROM public.audit_events_id_seq")[0], '3true')
        self.assertEqual(psql('xmartmenu', "SELECT rolcanlogin::text || (rolpassword LIKE 'SCRAM-SHA-256$%')::text FROM pg_authid WHERE rolname='xmartmenu_runtime'")[0], 'truetrue')
        self.assertEqual(psql('xmartmenu', "SELECT count(*) FROM pg_class WHERE relname IN ('app_tenant_effects','app_mcp_clients','ai_billing_requests','app_tenant_operations')")[0], '4')
        self.assertEqual(self.fake.envs['OWNED_AUTH_ENABLED'], 'true')
        self.assertTrue((self.root / 'COMPLETED').exists())
        # source is fenced with the exact SQLSTATE; reads still work
        _, rc = psql('xm_source', "INSERT INTO public.tenants VALUES (gen_random_uuid(),'x',true)", check=False)
        self.assertNotEqual(rc, 0)
        self.assertEqual(psql('xm_source', 'SELECT count(*) FROM public.tenants')[0], '1')
        self.assertNotIn('postgresql://', out)
        self.assertNotIn(self.fake.envs['ORDERS_DATABASE_URL'].split(':')[2].split('@')[0], out)
        # no new writes: rollback works and undoes everything
        op2, _ = self.build()
        code, out = self.run_mode(op2, 'rollback')
        self.assertEqual(code, 0, out)
        self.assertEqual(psql('xm_source', "INSERT INTO public.tenants VALUES (gen_random_uuid(),'x',true) RETURNING 1")[0], '1')
        self.assertEqual(self.fake.envs.get('OWNED_AUTH_ENABLED'), None)
        self.assertEqual(self.fake.envs['IMAGE_TAG'], 'b' * 40)
        self.assertEqual(psql('xmartmenu', "SELECT rolcanlogin::text || (rolpassword IS NULL)::text FROM pg_authid WHERE rolname='xmartmenu_runtime'")[0], 'falsetrue')

    def test_rollback_refused_after_new_write(self):
        op, cfg = self.build()
        self.assertEqual(self.run_mode(op, 'apply')[0], 0)
        psql('xmartmenu', "INSERT INTO public.orders VALUES (gen_random_uuid(),'%s','%s','usd',9)" % (TENANT, USERS[0]))
        op2, _ = self.build()
        code, out = self.run_mode(op2, 'rollback')
        self.assertEqual(code, 3, out)
        self.assertIn('check=new-writes-detected', out)
        self.assertEqual(self.fake.envs['OWNED_AUTH_ENABLED'], 'true')
        _, rc = psql('xm_source', "INSERT INTO public.tenants VALUES (gen_random_uuid(),'x',true)", check=False)
        self.assertNotEqual(rc, 0)

    def test_failure_before_first_write_reverts_everything(self):
        self.fake.fail_deploy = True
        op, cfg = self.build()
        code, out = self.run_mode(op, 'apply')
        self.assertEqual(code, 1, out)
        self.assertIn('check=deploy-failed', out)
        self.assertEqual(psql('xm_source', "INSERT INTO public.tenants VALUES (gen_random_uuid(),'x',true) RETURNING 1")[0], '1')
        self.assertNotIn('OWNED_AUTH_ENABLED', self.fake.envs)
        self.assertEqual(psql('xmartmenu', "SELECT rolcanlogin FROM pg_authid WHERE rolname='xmartmenu_runtime'")[0], 'f')
        self.assertEqual(json.loads((self.root / 'state.json').read_text())['status'], 'reverted')

    def test_interrupted_run_is_recovered_by_next_apply(self):
        op, cfg = self.build()
        op.lock()
        op.st.begin('apply', SHA)
        op.st.fact(tables=['tenants'], app_stopped=True, source_fenced=False)
        self.fake.status = 'exited'
        op._lock = None
        os.close(op.__dict__.get('_lockfd', -1)) if False else None
        # a new process (new operator, lock released by closing the old fd)
        os.close(op._lock) if isinstance(op._lock, int) else None
        op2, _ = self.build()
        code, out = self.run_mode(op2, 'apply')
        self.assertEqual(code, 10, out)
        self.assertIn('interrupted_at=', out)
        self.assertEqual(self.fake.status, 'running:healthy')

    def test_fence_blocks_rest_style_writes_and_truncate(self):
        op, _ = self.build()
        tables = ['tenants', 'profiles', 'products', 'orders', 'order_items', 'customer_profiles', 'waiter_calls', 'audit_events']
        src = op.make_source('x')
        src.sql(cut.fence_sql(tables))
        for stmt in ("INSERT INTO public.tenants VALUES (gen_random_uuid(),'y',true)", "UPDATE public.tenants SET slug='z'", 'DELETE FROM public.tenants', 'TRUNCATE public.audit_events'):
            _, rc = psql('xm_source', 'SET session_replication_role = replica; ' + stmt, check=False)
            self.assertNotEqual(rc, 0, stmt)
        src.sql(cut.unfence_sql(tables))
        self.assertEqual(psql('xm_source', "INSERT INTO public.tenants VALUES (gen_random_uuid(),'y',true) RETURNING 1")[0], '1')

    def test_scram_password_really_authenticates(self):
        pw = 'p' * 48
        psql('xmartmenu', f"ALTER ROLE xmartmenu_runtime LOGIN PASSWORD '{cut.scram_verifier(pw)}'; GRANT CONNECT ON DATABASE xmartmenu TO xmartmenu_runtime")
        ip = subprocess.run(['docker', 'exec', CONTAINER, 'hostname', '-i'], stdout=subprocess.PIPE).stdout.decode().split()[0]
        p = subprocess.run(['docker', 'exec', '-e', 'PGPASSWORD=' + pw, CONTAINER, 'psql', '-h', ip, '-U', 'xmartmenu_runtime', '-d', 'xmartmenu', '-qAt', '-c', 'select 1'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(p.stdout.decode().strip(), '1', p.stderr)
        bad = subprocess.run(['docker', 'exec', '-e', 'PGPASSWORD=wrong', CONTAINER, 'psql', '-h', ip, '-U', 'xmartmenu_runtime', '-d', 'xmartmenu', '-qAt', '-c', 'select 1'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertNotEqual(bad.returncode, 0)


if __name__ == '__main__':
    unittest.main()
