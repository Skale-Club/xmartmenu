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
spec = importlib.util.spec_from_file_location('cutover', HERE / 'xprout-final-cutover.py')
cut = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cut)

CONTAINER = os.environ.get('XM_TEST_PG_CONTAINER')
SHA = 'a' * 40


class OfflineTests(unittest.TestCase):
    def test_selected_image_repository_is_in_the_reversible_environment_set(self):
        for repository in ['ghcr.io/skale-club/xprout', 'ghcr.io/skale-club/xmartmenu']:
            cfg = cut.Config(image_repository=repository)
            op = cut.Cutover(cfg, {}, SHA, None, None, None, None, None)
            op.password = 'offline-fixture'
            values = op.env_values()
            self.assertEqual(values['IMAGE_REPOSITORY'], repository)
            self.assertEqual(values['IMAGE_TAG'], SHA)

    def test_http_requests_carry_an_explicit_user_agent(self):
        # Cloudflare answers 403 to the default Python-urllib agent (seen on the first production plan)
        agents = [v for k, v in cut.OPENER.addheaders if k.lower() == 'user-agent']
        self.assertEqual(agents, ['xmartmenu-cutover/1'])

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
        # the claims migration must come after registration, which rewrites the same CHECK with a narrower list
        self.assertGreater(names.index('identity-google-claims'), names.index('native-registration'))
        on_disk = {p.name for p in (REPO / 'docs/proposals').glob('*-owned-only.sql')}
        ours = {f for _, f, _ in cut.PROPOSALS if f}
        # tolerant on purpose: PR 67 adds the blog proposal; the operator copes with it being absent or present
        self.assertEqual(on_disk - ours, set())
        self.assertLessEqual(ours - on_disk, {cut.CLAIMS_FILE, cut.BLOG_FILE})
        self.assertTrue((REPO / 'supabase/migrations' / cut.CLAIMS_FILE).exists())

    def test_flags_match_the_application(self):
        text = (REPO / 'src/lib/data/owned-mode.ts').read_text()
        for f in cut.FLAGS:
            self.assertIn("'" + f + "'", text)
        found = set(__import__('re').findall(r"'(OWNED_[A-Z_]+_ENABLED)'", text))
        self.assertEqual(found - set(cut.FLAGS), set() if 'OWNED_BLOG_ENABLED' not in found else {'OWNED_BLOG_ENABLED'})

    def test_operator_recovery_sql_is_exact(self):
        uid = '00000000-0000-4000-8000-000000000001'
        sql = cut.operator_recovery_sql(uid, 'skaleclub', 'AbC123xyz')
        self.assertIn("'google.com', 'operator-recovery'", sql)
        self.assertIn("p.role='superadmin'", sql)
        for bad in [("x", 'skaleclub', 'a'), (uid, 'skaleclub', "a'; DROP TABLE x;--")]:
            with self.assertRaises(cut.Refused):
                cut.operator_recovery_sql(*bad)

    def test_redirects_are_refused(self):
        self.assertIsNone(cut._NoRedirect().redirect_request(None, None, 302, '', {}, 'http://x'))

    def test_capacity_problems(self):
        self.assertEqual(cut.capacity_problems({'mem_available_mib': 2000, 'swap_used_mib': 0, 'disk_free_gib': 9}), [])
        self.assertEqual(cut.capacity_problems({'mem_available_mib': 100, 'swap_used_mib': 900, 'disk_free_gib': 1}), ['memory', 'swap', 'disk'])

    def test_app_control_accepts_only_known_verbs(self):
        spec2 = importlib.util.spec_from_file_location('appctl', HERE / 'xprout-app-control.py')
        ctl = importlib.util.module_from_spec(spec2)
        spec2.loader.exec_module(ctl)
        calls = []
        cid = 'a' * 64

        def fake_run(argv):
            calls.append(argv)
            if argv[:2] == ['docker', 'ps']:
                return 0, f'{cid} running' + chr(10)
            if argv[:3] == ['docker', 'network', 'inspect']:
                return 0, 'netid' + chr(10)
            if argv[0] == 'systemctl':
                return 0, 'active' + chr(10)
            return 0, ''
        ctl.run = fake_run
        ctl.meminfo = lambda: {'mem_available_mib': 1, 'swap_used_mib': 0, 'disk_free_gib': 1}
        for bad in ['', 'rm -rf /', 'stop nothex', 'stop ' + 'b' * 64, 'inspect extra', 'network rm x']:
            with self.assertRaises(SystemExit):
                ctl.main(bad)
        with contextlib.redirect_stdout(io.StringIO()):
            ctl.main('stop ' + cid)
        flat = [' '.join(c) for c in calls]
        self.assertTrue(any(c.startswith('docker update --restart=no ' + cid) for c in flat))
        self.assertTrue(any(c.startswith('docker stop') for c in flat))
        self.assertFalse(any('network rm' in c or 'compose down' in c or 'compose stop' in c for c in flat))

    def test_google_claims_parity(self):
        uid = '11111111-1111-4111-8111-111111111111'
        users = [{'id': uid, 'identities': [{'provider': 'google', 'provider_id': '12345678901'}]},
                 {'id': '22222222-2222-4222-8222-222222222222', 'identities': [{'provider': 'google', 'provider_id': '99999999999'}]},
                 {'id': uid, 'identities': [{'provider': 'email'}]}]
        self.assertEqual(cut.plan_claims(users, {uid}), [('12345678901', uid)])

    def test_google_claims_real_admin_api_shape(self):
        a, b = '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'
        listing = [{'id': a, 'identities': [], 'app_metadata': {'providers': ['email', 'google']}},
                   {'id': b, 'identities': [], 'app_metadata': {'providers': ['email']}}]
        calls = []
        def detail(uid):
            calls.append(uid)
            return {'id': uid, 'identities': [{'provider': 'google', 'provider_id': '12345678901'}]}
        users = cut.enrich_google_users(listing, detail)
        self.assertEqual(calls, [a])
        self.assertEqual(cut.plan_claims(users, {a, b}), [('12345678901', a)])
        self.assertEqual(cut.plan_claims(listing, {a, b}), [])  # the old behaviour
        with self.assertRaises(cut.Refused):
            cut.enrich_google_users(listing, detail, 0)
        with self.assertRaises(cut.Refused):
            cut.enrich_google_users(listing, lambda uid: {'id': b, 'identities': []})

    def test_budget_arithmetic(self):
        self.assertEqual((12 - 1) // 2, 5)


class FakeAppHost:
    """Stand-in for the forced command on the app host. Tracks the container and the (never removed) network."""
    def __init__(self, network_id, transport=True):
        self.network_id, self.transport, self.calls = network_id, transport, []
        self.running, self.cid = True, 'c' * 64
        self.mem = 4000

    def inspect(self):
        self.calls.append('inspect')
        return {'id': self.cid, 'running': self.running, 'containers': 1, 'network_id': self.network_id, 'transport': self.transport,
                'mem_available_mib': self.mem, 'swap_used_mib': 0, 'disk_free_gib': 20}

    def stop(self, cid):
        assert cid == self.cid
        self.calls.append('stop')
        self.running = False

    def start(self, cid):
        assert cid == self.cid
        self.calls.append('start')
        self.running = True


class FakeCoolify:
    """HTTP server that mimics the handful of Coolify endpoints used."""
    def __init__(self, app):
        self.envs = {'IMAGE_TAG': 'b' * 40, 'HEALTH_TOKEN': 'tok', 'GOOGLE_AUTH_ENABLED': 'false',
                     'NEXT_PUBLIC_SUPABASE_URL': 'https://x', 'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'k',
                     **{k: 'x' for k in cut.GOOGLE_STAGED}, **{k: 'x' for k in cut.STORAGE_KEYS}}
        self.status, self.requests, self.fail_deploy, self.mode, self.apphost = 'running:healthy', [], False, 'legacy', None
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
                if self.path.startswith('/auth/v1/admin/users'):
                    return self.reply(200, {'users': [{'id': '00000000-0000-4000-8000-000000000001', 'identities': [{'provider': 'google', 'provider_id': '123456789012'}]}]})
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
                    if fake.apphost:
                        fake.apphost.cid, fake.apphost.running = 'd' * 64, True
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
    sql += ''.join(f"INSERT INTO public.profiles VALUES ('{u}','{TENANT}','{'superadmin' if u == USERS[0] else 'customer'}');\n" for u in USERS)
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
        psql('xm_source', SOURCE_SCHEMA + LEGACY_FKS + seed(2) + "CREATE TABLE auth.identities(user_id uuid, provider text); INSERT INTO auth.identities VALUES ('%s','google');" % USERS[0])
        psql('postgres', 'CREATE DATABASE xmartmenu OWNER xmartmenu_owner')
        # candidate: same schema, stale data, identity foundation and a compat auth.users
        psql('xmartmenu', SOURCE_SCHEMA.replace('auth.users(id uuid PRIMARY KEY, deleted_at timestamptz, banned_until timestamptz)', 'auth.users(id uuid PRIMARY KEY)') + LEGACY_FKS + seed(0) + """
CREATE TABLE public.app_accounts(id uuid PRIMARY KEY, disabled_at timestamptz, session_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.app_identity_bindings(project_id text, subject text, user_id uuid REFERENCES public.app_accounts(id), provider text, binding_proof text, created_at timestamptz DEFAULT now(),
  PRIMARY KEY(project_id, subject), CONSTRAINT app_identity_bindings_binding_proof_check CHECK (binding_proof IN ('legacy-session','google-subject','operator-recovery')));
CREATE TABLE public.app_sessions(token_hash text PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.app_identity_challenges(id uuid PRIMARY KEY);
CREATE FUNCTION public.complete_onboarding(uuid, jsonb) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[], created_by text);
INSERT INTO supabase_migrations.schema_migrations VALUES ('20261103210000');
""" + ''.join(f"INSERT INTO public.app_accounts(id) VALUES ('{u}');\n" for u in USERS) + """
DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname IN ('public') LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO xmartmenu_owner', r.tablename); END LOOP; END $$;
ALTER TABLE auth.users OWNER TO xmartmenu_owner;
GRANT USAGE ON SCHEMA auth TO xmartmenu_owner;
GRANT USAGE ON SCHEMA public TO xmartmenu_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_runtime;
""")
        self.fake = FakeCoolify(None)
        self.apphost = FakeAppHost('netid')
        self.fake.apphost = self.apphost
        self.root = Path(tempfile.mkdtemp())
        (self.root / 'latest.json').write_text(json.dumps({'at': int(__import__('time').time()), 'sha256': 'a' * 64, 'restored': True, 'database': 'xmartmenu'}))
        self.bundle = Path(tempfile.mkdtemp())
        (self.bundle / 'proposals').mkdir()
        import hashlib
        meta = {}
        for _, f, _ in cut.PROPOSALS:
            if f and f not in (cut.CLAIMS_FILE, cut.BLOG_FILE):
                data = (REPO / 'docs/proposals' / f).read_bytes()
                (self.bundle / 'proposals' / f).write_bytes(data)
                meta[f] = hashlib.sha256(data).hexdigest()
        claims = (REPO / 'supabase/migrations' / cut.CLAIMS_FILE).read_bytes()
        (self.bundle / 'proposals' / cut.CLAIMS_FILE).write_bytes(claims)
        meta[cut.CLAIMS_FILE] = hashlib.sha256(claims).hexdigest()
        (self.bundle / 'bundle.json').write_text(json.dumps({'proposals': meta}))

    def tearDown(self):
        self.fake.close()
        psql('postgres', "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename='xmartmenu_runtime'", check=False)

    def build(self, discard='', secrets_extra=None):
        cfg = cut.Config(container=CONTAINER, coolify_base=self.fake.base, public_url=self.fake.base, root=self.root, production_host=False,
                         expected_tables=8, poll_seconds=0, sleep=lambda s: None, network_id='netid', offhost_receipt=self.root / 'latest.json')
        target = cut.Pg(cut.docker_exec_launcher(cfg), ['-U', 'xmail_owner'])

        def make_source(url):
            def launcher(binary, args):
                return ['docker', 'exec', '-i', CONTAINER, binary, *args]
            return cut.Pg(launcher, ['-U', 'xmail_owner', '-d', 'xm_source'])
        coolify = cut.Coolify(cfg, 't')
        sec = {'COOLIFY_TOKEN': 't', 'SUPABASE_SOURCE_DATABASE_URL': 'postgresql://secret-source-password@h/db',
               'NEXT_PUBLIC_SUPABASE_URL': self.fake.base, 'SUPABASE_SERVICE_ROLE_KEY': 'k', **(secrets_extra or {})}
        return cut.Cutover(cfg, sec, SHA, self.bundle, target, make_source, coolify, self.apphost, google_script=True, discard=discard), cfg

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
        self.assertIn('proposals-pending count=12', out)
        self.assertIn('check=schema-fingerprint match=true', out)
        self.assertIn('role_superadmin=1', out)
        self.assertEqual(code, 0, out)
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
        self.assertFalse([r for r in self.fake.requests if r[1].endswith('/stop')], 'the Coolify stop (it removes the app network) must never be used')
        self.assertEqual(self.apphost.calls.count('stop'), 1)
        self.assertNotIn(cut.RUN_LOCK_ENV, self.fake.envs)
        self.assertEqual(psql('xmartmenu', 'SELECT count(*) FROM public.identity_google_subject_claims')[0], '1')
        self.assertEqual(psql('xmartmenu', "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261104090000'")[0], '1')
        self.assertEqual(psql('xmartmenu', "SELECT pg_get_constraintdef(oid) LIKE '%phone-match%' FROM pg_constraint WHERE conname='app_identity_bindings_binding_proof_check'")[0], 't')
        self.assertTrue((self.root / json.loads((self.root / 'state.json').read_text())['run'] / 'state.json').exists())
        # a second apply after a completed run is refused (A1)
        again, _ = self.build()
        self.assertEqual(self.run_mode(again, 'apply')[0], 2)
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
        self.assertNotIn(cut.RUN_LOCK_ENV, self.fake.envs)
        self.assertTrue(self.apphost.running)
        self.assertEqual(json.loads((self.root / 'state.json').read_text())['status'], 'reverted')
        self.assertEqual(psql('xmartmenu', "SELECT rolcanlogin::text || (rolpassword IS NULL)::text FROM pg_authid WHERE rolname='xmartmenu_runtime'")[0], 'falsetrue')

    def test_rollback_refused_after_new_write(self):
        op, cfg = self.build()
        self.assertEqual(self.run_mode(op, 'apply')[0], 0)
        psql('xmartmenu', "INSERT INTO public.orders VALUES (gen_random_uuid(),'%s','%s','usd',9)" % (TENANT, USERS[0]))
        op2, _ = self.build()
        code, out = self.run_mode(op2, 'rollback')
        self.assertEqual(code, 3, out)
        self.assertIn('check=new-writes-detected needs=DISCARD-', out)
        self.assertTrue(self.apphost.running, 'the owned app is brought back')
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
        op.st.fact(tables=['tenants'], app_stopped=True, source_fenced=False, app_container=self.apphost.cid, release_before='b' * 40)
        self.apphost.running = False
        # a new process (new operator, lock released by closing the old fd)
        op.unlock()
        op2, _ = self.build()
        code, out = self.run_mode(op2, 'apply')
        self.assertEqual(code, 10, out)
        self.assertIn('interrupted_at=', out)
        self.assertTrue(self.apphost.running)

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

    def test_discard_needs_the_typed_phrase_and_exports_first(self):
        op, cfg = self.build()
        self.assertEqual(self.run_mode(op, 'apply')[0], 0)
        run = json.loads((self.root / 'state.json').read_text())['run']
        psql('xmartmenu', "INSERT INTO public.orders VALUES (gen_random_uuid(),'%s','%s','usd',9)" % (TENANT, USERS[0]))
        wrong, _ = self.build(discard='DISCARD-nope')
        self.assertEqual(self.run_mode(wrong, 'rollback')[0], 3)
        right, _ = self.build(discard='DISCARD-' + run)
        code, out = self.run_mode(right, 'rollback')
        self.assertEqual(code, 0, out)
        self.assertTrue((self.root / run / 'owned-new-writes.dump').exists())
        self.assertNotIn('OWNED_AUTH_ENABLED', self.fake.envs)

    def test_telemetry_is_not_a_business_write(self):
        op, cfg = self.build()
        self.assertEqual(self.run_mode(op, 'apply')[0], 0)
        psql('xmartmenu', "INSERT INTO public.app_sessions(token_hash) VALUES ('s')")
        op2, _ = self.build()
        self.assertEqual(self.run_mode(op2, 'rollback')[0], 0)

    def test_offhost_backup_blocks_plan_and_apply(self):
        (self.root / 'latest.json').unlink()
        op, _ = self.build()
        code, out = self.run_mode(op, 'plan')
        self.assertIn('offhost-backup-missing', out)
        self.assertEqual(code, 2)
        op2, _ = self.build()
        code, out = self.run_mode(op2, 'apply')
        self.assertEqual(code, 2)
        self.assertIn('check=offhost-backup-missing', out)
        self.assertEqual(self.apphost.calls.count('stop'), 0)
        self.assertEqual(psql('xm_source', "INSERT INTO public.tenants VALUES (gen_random_uuid(),'x',true) RETURNING 1")[0], '1')

    def test_plan_blocks_a_superadmin_without_google_and_a_missing_transport(self):
        psql('xm_source', "DELETE FROM auth.identities")
        self.apphost.transport = False
        op, _ = self.build()
        code, out = self.run_mode(op, 'plan')
        self.assertEqual(code, 2)
        self.assertIn('superadmin-without-google', out)
        self.assertIn('app-host-state', out)

    def test_low_memory_on_the_app_host_blocks_before_any_change(self):
        self.apphost.mem = 200
        op, _ = self.build()
        code, out = self.run_mode(op, 'apply')
        self.assertEqual(code, 2, out)
        self.assertIn('capacity-preflight-app-host-memory', out)
        self.assertEqual(self.apphost.calls.count('stop'), 0)

    def test_env_lock_stops_a_second_run(self):
        self.fake.envs[cut.RUN_LOCK_ENV] = 'someone'
        op, _ = self.build()
        code, out = self.run_mode(op, 'apply')
        self.assertEqual(code, 2)
        self.assertIn('cutover-env-lock-present', out)

    def test_network_lost_after_stop_reverts(self):
        orig = self.apphost.stop

        def stop_and_break(cid):
            orig(cid)
            self.apphost.network_id = 'other'
        self.apphost.stop = stop_and_break
        op, _ = self.build()
        code, out = self.run_mode(op, 'apply')
        self.assertIn('network-or-transport-lost', out)
        self.assertNotEqual(code, 0)

    def test_failed_backup_leaves_no_temporary_database(self):
        op, _ = self.build()
        op.target.restore = lambda data, db: (_ for _ in ()).throw(cut.SqlFailed('XX000'))
        code, out = self.run_mode(op, 'apply')
        self.assertEqual(code, 1, out)
        self.assertEqual(psql('postgres', "SELECT count(*) FROM pg_database WHERE datname LIKE 'xmartmenu_cutover_%'")[0], '0')

    def test_incomplete_revert_runs_every_step_and_has_its_own_exit_code(self):
        self.fake.fail_deploy = True
        op, _ = self.build()
        calls = {'n': 0}
        real = op.src

        def flaky():
            calls['n'] += 1
            if calls['n'] > 6:  # the fence and copy worked; unfencing is what fails
                raise cut.Refused('source-url-missing')
            return real()
        op.src = flaky
        code, out = self.run_mode(op, 'apply')
        self.assertEqual(code, 4, out)
        self.assertIn('revert.unfence-source status=failed', out)
        self.assertNotIn('OWNED_AUTH_ENABLED', self.fake.envs, 'later steps still ran')
        self.assertEqual(json.loads((self.root / 'state.json').read_text())['status'], 'revert-incomplete')

    def test_blog_proposal_and_flag_follow_the_commit(self):
        import hashlib
        (self.bundle / 'proposals' / cut.BLOG_FILE).write_text("CREATE TABLE public.app_blog_operations(id uuid PRIMARY KEY);")
        meta = json.loads((self.bundle / 'bundle.json').read_text())
        meta['proposals'][cut.BLOG_FILE] = hashlib.sha256((self.bundle / 'proposals' / cut.BLOG_FILE).read_bytes()).hexdigest()
        (self.bundle / 'bundle.json').write_text(json.dumps(meta))
        op, _ = self.build()
        self.assertIn('OWNED_BLOG_ENABLED', op.flags)
        self.assertEqual(self.run_mode(op, 'apply')[0], 0)
        self.assertEqual(self.fake.envs['OWNED_BLOG_ENABLED'], 'true')
        self.assertEqual(psql('xmartmenu', "SELECT to_regclass('public.app_blog_operations') IS NOT NULL")[0], 't')

    def test_operator_recovery_sql_works_on_the_database(self):
        op, _ = self.build()
        self.assertEqual(self.run_mode(op, 'apply')[0], 0)
        psql('xmartmenu', "DELETE FROM public.app_identity_bindings")
        psql('xmartmenu', cut.operator_recovery_sql(USERS[0], 'skaleclub', 'FirebaseUid1'))
        self.assertEqual(psql('xmartmenu', "SELECT provider || binding_proof FROM public.app_identity_bindings")[0], 'google.comoperator-recovery')
        _, rc = psql('xmartmenu', cut.operator_recovery_sql(USERS[1], 'skaleclub', 'FirebaseUid2'), check=False)
        self.assertNotEqual(rc, 0, 'a non-superadmin is refused')

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
