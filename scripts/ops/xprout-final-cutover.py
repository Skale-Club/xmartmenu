#!/usr/bin/python3 -I
"""Xprout final data cutover: Supabase -> own PostgreSQL.

Runs as root on the PostgreSQL host (delivered by .github/workflows/final-cutover.yml).
Modes: plan (read only, default) | apply | rollback.

Output rule: only fixed labels, integers and booleans. Never a row, URL, token or
password, and never raw driver/psql error text.
"""
import argparse
import base64
import dataclasses
try:
    import fcntl
except ImportError:  # Windows: only the offline test harness runs there
    fcntl = None
import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True

FLAGS = ['OWNED_AUTH_ENABLED', 'OWNED_PLATFORM_APPEARANCE_ENABLED', 'OWNED_PUBLIC_MENU_ENABLED',
         'OWNED_ADMIN_MENUS_ENABLED', 'OWNED_ADMIN_CATALOG_ENABLED', 'OWNED_ORDER_DATA_ENABLED',
         'OWNED_PAYMENT_DATA_ENABLED', 'OWNED_ACCOUNT_ADMIN_ENABLED', 'OWNED_TENANT_ADMIN_ENABLED',
         'OWNED_TENANT_EFFECTS_ENABLED', 'OWNED_MCP_ENABLED', 'OWNED_REGISTRATION_ENABLED',
         'OWNED_ONBOARDING_ENABLED', 'OWNED_ADMIN_WAITER_CALLS_ENABLED']
PREFIXES = ['IDENTITY', 'PLATFORM_APPEARANCE', 'PUBLIC_MENU', 'ADMIN_MENUS', 'ORDERS', 'PAYMENTS']
GOOGLE_STAGED = ['GOOGLE_AUTH_PROJECT_ID', 'GOOGLE_AUTH_PROJECT_NUMBER', 'GOOGLE_AUTH_WEB_API_KEY',
                 'GOOGLE_AUTH_ADC_FILE', 'GOOGLE_AUTH_ADC_AUDIENCE', 'GOOGLE_AUTH_ADC_SERVICE_ACCOUNT',
                 'GOOGLE_AUTH_ADC_SUBJECT']
# Not business writes: login artifacts and public telemetry never block a rollback.
EPHEMERAL = ('app_sessions', 'app_identity_challenges', 'menu_events', 'menu_sessions', 'scan_events')
STORAGE_KEYS = ['STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY', 'STORAGE_S3_ENDPOINT', 'STORAGE_S3_REGION',
                'STORAGE_S3_BUCKET_PRODUCT_IMAGES', 'STORAGE_S3_BUCKET_TENANT_ASSETS', 'STORAGE_S3_PUBLIC_URL_BASE']
CLAIMS_FILE = '20261104090000_identity_google_claims.sql'
BLOG_FILE = 'native-blog-operations-owned-only.sql'
OPTIONAL_PROPOSALS = {'native-blog-operations'}  # only when the file is in the commit (PR 67)
RUN_LOCK_ENV = 'XM_CUTOVER_ACTIVE'  # scripts/coolify-deploy.sh refuses while this exists
SECRET_NAMES = ['COOLIFY_TOKEN', 'SUPABASE_SOURCE_DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL']

# (name, file, sentinel). Order: effects -> dispatch -> operations -> the rest.
PROPOSALS = [
    ('identity-foundation', None, "SELECT to_regclass('public.app_accounts') IS NOT NULL AND EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261103210000')"),
    ('native-tenant-effects', 'native-tenant-effects-owned-only.sql', "SELECT to_regclass('public.app_tenant_effects') IS NOT NULL"),
    ('native-tenant-effects-dispatch', 'native-tenant-effects-dispatch-owned-only.sql', "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_tenant_effects' AND column_name='event_id')"),
    ('native-tenant-operations', 'native-tenant-operations-owned-only.sql', "SELECT to_regclass('public.app_tenant_operations') IS NOT NULL"),
    ('native-customer-account-fks', 'native-customer-account-fks-owned-only.sql', "SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='orders_customer_id_fkey' AND conrelid='public.orders'::regclass AND confrelid='public.app_accounts'::regclass)"),
    ('native-waiter-actor', 'native-waiter-actor-owned-only.sql', "SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='waiter_calls_acknowledged_by_fkey' AND conrelid='public.waiter_calls'::regclass AND confrelid='public.app_accounts'::regclass)"),
    ('native-registration', 'native-registration-owned-only.sql', "SELECT NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_id_fkey')"),
    ('identity-google-claims', CLAIMS_FILE, "SELECT to_regclass('public.identity_google_subject_claims') IS NOT NULL"),
    ('native-account-administration', 'native-account-administration-owned-only.sql', "SELECT to_regclass('public.app_staff_access_codes') IS NOT NULL"),
    ('native-subscription-billing', 'native-subscription-billing-owned-only.sql', "SELECT to_regclass('public.app_subscription_billing_requests') IS NOT NULL"),
    ('native-stripe-oauth', 'native-stripe-oauth-owned-only.sql', "SELECT to_regclass('public.app_stripe_oauth_attempts') IS NOT NULL"),
    ('native-ai-billing', 'native-ai-billing-owned-only.sql', "SELECT to_regclass('public.ai_billing_requests') IS NOT NULL"),
    ('native-mcp-oauth', 'native-mcp-oauth-owned-only.sql', "SELECT to_regclass('public.app_mcp_clients') IS NOT NULL"),
    ('native-blog-operations', BLOG_FILE, "SELECT to_regclass('public.app_blog_operations') IS NOT NULL"),
]


@dataclasses.dataclass
class Config:
    hostname: str = 'skaleclub-mail'
    container: str = 'e12scyfsrp822dag7m9wwd4x'
    database: str = 'xmartmenu'
    admin_user: str = 'xmail_owner'
    owner: str = 'xmartmenu_owner'
    runtime: str = 'xmartmenu_runtime'
    reader: str = 'xmartmenu_staging_reader'
    app_uuid: str = 'gmaayluj11x1m6j7baogonfn'
    coolify_base: str = 'https://coolify.skale.club'
    public_url: str = 'https://xprout.app'
    image_repository: str = 'ghcr.io/skale-club/xprout'
    runtime_host: str = '10.0.4.1'
    runtime_port: int = 15432
    source_project: str = 'ktogbpqookfcqilqvici'
    expected_tables: int = 47
    expected_accounts: int = 7
    runtime_limit: int = 12
    root: Path = Path('/opt/xmartmenu/cutover')
    app_host: str = '188.245.112.3'
    app_ssh_key: Path = Path('/opt/xmartmenu/cutover/app-host/key')
    app_known_hosts: Path = Path('/opt/xmartmenu/cutover/app-host/known_hosts')
    network_id: str = '9618654f72854308768936727d24ecd948decaa235eaf51a163d845958f47c37'
    xmail_deploy_lock: Path = Path('/opt/xmail/owned-runtime-ops/deploy.lock')
    offhost_receipt: Path = Path('/opt/xmartmenu/offsite-backups/latest.json')
    offhost_max_age_hours: int = 26
    require_offhost: bool = True
    production_host: bool = True
    poll_seconds: float = 5.0
    stop_attempts: int = 36
    deploy_attempts: int = 60
    health_attempts: int = 36
    sleep: object = time.sleep


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(_NoRedirect)
# Cloudflare in front of the public URL answers 403 to the default 'Python-urllib/x' agent.
OPENER.addheaders = [('User-Agent', 'xmartmenu-cutover/1')]


class Refused(Exception):
    """A safe, labelled refusal."""
    def __init__(self, label):
        super().__init__(label)
        self.label = label


class Interrupted(Exception):
    pass


class SqlFailed(Exception):
    def __init__(self, sqlstate):
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


_SAFE = re.compile(r'^[A-Za-z0-9_.|\-]{0,400}$')


def say(**kv):
    parts = []
    for key, value in kv.items():
        text = str(value).lower() if isinstance(value, bool) else str(value)
        parts.append(f'{key}={text if _SAFE.match(text) else "redacted"}')
    line = 'xmartmenu-cutover ' + ' '.join(parts)
    try:
        print(line, flush=True)
    except OSError:
        pass  # runner disconnected; the durable state file is the record
    return line


def ident(name):
    if not re.fullmatch(r'[a-z_][a-z0-9_]*', name):
        raise Refused('identifier')
    return '"' + name + '"'


def scram_verifier(password, salt=None, iterations=4096):
    salt = salt or os.urandom(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, iterations)
    stored = hashlib.sha256(hmac.new(salted, b'Client Key', 'sha256').digest()).digest()
    server = hmac.new(salted, b'Server Key', 'sha256').digest()
    b = lambda raw: base64.b64encode(raw).decode()
    return f'SCRAM-SHA-256${iterations}:{b(salt)}${b(stored)}:{b(server)}'


# ---------------------------------------------------------------- SQL pieces
MANIFEST_FN = r"""
CREATE FUNCTION pg_temp.xm_manifest(tables text[]) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE t text; o jsonb := '{}'; n bigint; d text;
BEGIN
 FOREACH t IN ARRAY tables LOOP
  EXECUTE format($q$SELECT count(*), encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') h FROM public.%I r) s$q$, t) INTO n, d;
  o := o || jsonb_build_object(t, jsonb_build_object('n', n, 'd', d));
 END LOOP;
 RETURN o;
END $f$;
CREATE FUNCTION pg_temp.xm_groups() RETURNS jsonb LANGUAGE sql AS $f$
SELECT jsonb_object_agg(names.name, g.value) FROM (VALUES ('auth_ids'),('profile_authority'),('tenants'),('product_tenants'),('orders'),('order_items')) names(name)
JOIN LATERAL (SELECT encode(sha256(convert_to(coalesce(string_agg(r.row_sha,'' ORDER BY r.key COLLATE "C"),''),'UTF8')),'hex') AS value FROM (
 SELECT 'auth_ids' AS name, id::text AS key, jsonb_build_object('id',id)::text AS payload FROM auth.users
 UNION ALL SELECT 'profile_authority',id::text,jsonb_build_object('id',id,'tenant_id',tenant_id,'role',role)::text FROM public.profiles
 UNION ALL SELECT 'tenants',id::text,jsonb_build_object('id',id)::text FROM public.tenants
 UNION ALL SELECT 'product_tenants',id::text,jsonb_build_object('id',id,'tenant_id',tenant_id,'menu_id',menu_id)::text FROM public.products
 UNION ALL SELECT 'orders',id::text,jsonb_build_object('id',id,'tenant_id',tenant_id,'customer_id',customer_id,'currency',currency,'total',total)::text FROM public.orders
 UNION ALL SELECT 'order_items',id::text,jsonb_build_object('id',id,'order_id',order_id,'product_id',product_id)::text FROM public.order_items
) x CROSS JOIN LATERAL (SELECT encode(sha256(convert_to(x.payload,'UTF8')),'hex') AS row_sha, x.key AS key) r WHERE x.name = names.name) g ON true
$f$;
CREATE FUNCTION pg_temp.xm_sequences() RETURNS jsonb LANGUAGE sql AS $f$
SELECT coalesce(jsonb_object_agg(sequencename, (CASE WHEN last_value IS NULL THEN start_value ELSE last_value + increment_by END)::text), '{}'::jsonb)
FROM pg_sequences WHERE schemaname='public'
$f$;
"""

SESSION_SETUP = "SET timezone='UTC'; SET datestyle='ISO, YMD'; SET extra_float_digits=3; SET bytea_output='hex'; SET client_encoding='UTF8';\n"

BUSINESS_TABLES_SQL = "SELECT coalesce(jsonb_agg(relname ORDER BY relname),'[]'::jsonb)::text FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')"

COUNTS_SQL = ("SELECT coalesce(jsonb_object_agg(relname, ((xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', relname), false, true, '')))[1])::text::bigint),'{}'::jsonb)::text "
              "FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')")


def fence_sql(tables):
    lock = ', '.join('public.' + ident(t) for t in tables)
    out = ["BEGIN;", "SET LOCAL lock_timeout='30s';", f"LOCK TABLE {lock} IN ACCESS EXCLUSIVE MODE;",
           "CREATE SCHEMA xm_cutover_fence;",
           "CREATE FUNCTION xm_cutover_fence.reject() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION USING ERRCODE='XM001', MESSAGE='writes closed: data moved to its own database'; END $f$;"]
    for t in tables:
        out.append(f"CREATE TRIGGER xm_cutover_fence BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.{ident(t)} FOR EACH STATEMENT EXECUTE FUNCTION xm_cutover_fence.reject();")
        out.append(f"ALTER TABLE public.{ident(t)} ENABLE ALWAYS TRIGGER xm_cutover_fence;")
    out.append("COMMIT;")
    return '\n'.join(out) + '\n'


def unfence_sql(tables):
    lock = ', '.join('public.' + ident(t) for t in tables)
    out = ["BEGIN;", "SET LOCAL lock_timeout='30s';", f"LOCK TABLE {lock} IN ACCESS EXCLUSIVE MODE;"]
    for t in tables:
        out.append(f"DROP TRIGGER IF EXISTS xm_cutover_fence ON public.{ident(t)};")
    out += ["DROP FUNCTION IF EXISTS xm_cutover_fence.reject();", "DROP SCHEMA IF EXISTS xm_cutover_fence;", "COMMIT;"]
    return '\n'.join(out) + '\n'


def fence_verify_sql(expected):
    return f"""BEGIN;
DO $do$ DECLARE t text; n int := 0; BEGIN
 FOR t IN SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p') LOOP
  BEGIN EXECUTE format('DELETE FROM public.%I WHERE false', t);
  EXCEPTION WHEN SQLSTATE 'XM001' THEN n := n + 1; END;
 END LOOP;
 IF n <> {int(expected)} THEN RAISE EXCEPTION USING ERRCODE='XM009', MESSAGE='fence incomplete'; END IF;
END $do$;
ROLLBACK;
SELECT count(*) FROM pg_trigger WHERE tgname='xm_cutover_fence' AND tgenabled='A';
"""


COPY_HEADER = re.compile(rb'^COPY public\.([a-z_][a-z0-9_]*) \(([^)]*)\) FROM stdin;$')


def filter_dump(raw, tables):
    """Keep only the COPY blocks of the expected tables; refuse anything unexpected."""
    blocks, lines, i = {}, raw.split(b'\n'), 0
    while i < len(lines):
        line = lines[i]
        match = COPY_HEADER.match(line)
        if match:
            table = match.group(1).decode()
            if table not in tables or table in blocks:
                raise Refused('dump-table')
            j = i + 1
            while j < len(lines) and lines[j] != b'\\.':
                j += 1
            if j >= len(lines):
                raise Refused('dump-truncated')
            blocks[table] = b'\n'.join(lines[i:j + 1]) + b'\n'
            i = j + 1
            continue
        if not (line == b'' or line.startswith(b'--') or line.startswith(b'SET ')
                or line.startswith((b'\\restrict ', b'\\unrestrict ')) or line.startswith(b'SELECT pg_catalog.set_config') or line.startswith(b'SELECT pg_catalog.setval(')):
            raise Refused('dump-statement')
        i += 1
    if set(blocks) != set(tables):
        raise Refused('dump-incomplete')
    return blocks


FK_CHECK = r"""
DO $do$ DECLARE c record; bad bigint; BEGIN
 FOR c IN SELECT con.conname,
   con.conrelid::regclass::text AS child, con.confrelid::regclass::text AS parent,
   (SELECT string_agg(format('c.%I IS NOT NULL', a.attname), ' AND ' ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum) AS notnull,
   (SELECT string_agg(format('p.%I = c.%I', pa.attname, ca.attname), ' AND ' ORDER BY k.ord) FROM unnest(con.conkey, con.confkey) WITH ORDINALITY k(ck, pk, ord) JOIN pg_attribute ca ON ca.attrelid=con.conrelid AND ca.attnum=k.ck JOIN pg_attribute pa ON pa.attrelid=con.confrelid AND pa.attnum=k.pk) AS joincond
  FROM pg_constraint con WHERE con.contype='f' AND con.connamespace='public'::regnamespace
 LOOP
  EXECUTE format('SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s)', c.child, c.notnull, c.parent, c.joincond) INTO bad;
  IF bad > 0 THEN RAISE EXCEPTION USING ERRCODE='XM003', MESSAGE='orphan rows after copy'; END IF;
 END LOOP;
END $do$;
"""


def copy_script(tables, blocks, expected, controls):
    """One transaction: replace the business tables, reconcile controls, compare, then COMMIT."""
    arr = 'ARRAY[' + ','.join("'" + t + "'" for t in tables) + ']::text[]'
    lock = ', '.join(['public.' + ident(t) for t in tables] + ['public.app_accounts', 'auth.users'])
    head = [SESSION_SETUP, "BEGIN;", "SET LOCAL lock_timeout='20s'; SET LOCAL statement_timeout='600s';",
            f"LOCK TABLE {lock} IN ACCESS EXCLUSIVE MODE;", MANIFEST_FN,
            "SET LOCAL session_replication_role = replica;"]
    head += [f"DELETE FROM public.{ident(t)};" for t in tables]
    body = b''.join(blocks[t] for t in tables)
    tail = ["SET LOCAL session_replication_role = origin;",
            "CREATE TEMP TABLE xm_source_auth ON COMMIT DROP AS SELECT id, disabled FROM jsonb_to_recordset($lit$"
            + json.dumps(controls) + "$lit$::jsonb) AS x(id uuid, disabled boolean);",
            """DO $do$ BEGIN
 IF EXISTS (SELECT 1 FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM xm_source_auth s WHERE s.id=u.id))
 OR EXISTS (SELECT 1 FROM public.app_accounts a WHERE NOT EXISTS (SELECT 1 FROM xm_source_auth s WHERE s.id=a.id))
 THEN RAISE EXCEPTION USING ERRCODE='XM004', MESSAGE='local account absent from source'; END IF;
END $do$;
INSERT INTO auth.users(id) SELECT id FROM xm_source_auth ON CONFLICT DO NOTHING;
INSERT INTO public.app_accounts(id, disabled_at) SELECT id, CASE WHEN disabled THEN now() END FROM xm_source_auth ON CONFLICT (id) DO NOTHING;
UPDATE public.app_accounts a SET disabled_at = CASE WHEN s.disabled THEN coalesce(a.disabled_at, now()) END, session_version = a.session_version + 1
 FROM xm_source_auth s WHERE s.id=a.id AND ((s.disabled AND a.disabled_at IS NULL) OR (NOT s.disabled AND a.disabled_at IS NOT NULL));""",
            FK_CHECK,
            "DO $do$ DECLARE e jsonb := $lit$" + json.dumps(expected) + "$lit$::jsonb; BEGIN "
            f"IF pg_temp.xm_manifest({arr}) IS DISTINCT FROM e->'tables' OR pg_temp.xm_groups() IS DISTINCT FROM e->'groups' "
            "THEN RAISE EXCEPTION USING ERRCODE='XM002', MESSAGE='reconciliation mismatch'; END IF; END $do$;"]
    for name, nxt in sorted(expected['sequences'].items()):
        tail.append(f"SELECT pg_catalog.setval('public.{ident(name)}'::regclass, {int(nxt['value'])}, {'true' if nxt['called'] else 'false'});")
    tail.append("DO $do$ DECLARE e jsonb := $lit$" + json.dumps(expected) + "$lit$::jsonb; BEGIN "
                "IF pg_temp.xm_sequences() IS DISTINCT FROM e->'next' THEN RAISE EXCEPTION USING ERRCODE='XM005', MESSAGE='sequence mismatch'; END IF; END $do$;")
    tail.append("COMMIT;")
    return ('\n'.join(head) + '\n').encode() + body + ('\n'.join(tail) + '\n').encode()


# ---------------------------------------------------------------- transports
SAFE_ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


class Pg:
    """psql/pg_dump through a launcher(binary, args) -> argv."""
    def __init__(self, launcher, extra=(), env=None):
        self.launcher, self.extra, self.env = launcher, list(extra), env

    def _run(self, binary, args, data=None, timeout=120, maximum=256 << 20):
        env = dict(SAFE_ENV)
        env.update(self.env or {})
        try:
            p = subprocess.run(self.launcher(binary, args), input=data, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=env, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise SqlFailed('timeout')
        if p.returncode != 0:
            m = re.search(rb'ERROR:\s+([0-9A-Z]{5})', p.stderr)
            raise SqlFailed(m.group(1).decode() if m else 'client')
        if len(p.stdout) > maximum:
            raise SqlFailed('output-size')
        return p.stdout

    def sql(self, query, database=None, timeout=120, role=None):
        args = ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', *self.extra]
        if database:
            args += ['-d', database]
        if role:
            query = f'SET ROLE {ident(role)};\n' + query
        return self._run('psql', args, query.encode() if isinstance(query, str) else query, timeout).decode().strip()

    def read(self, query, database=None):
        return self.sql('BEGIN READ ONLY; ' + SESSION_SETUP + query + ';\nROLLBACK;', database)

    def dump(self, args, timeout=600):
        return self._run('pg_dump', [*self.extra, *args], None, timeout)

    def restore(self, data, database):
        return self._run('pg_restore', [*self.extra, '--no-owner', '--no-privileges', '--exit-on-error', '-d', database], data, 600)


def docker_exec_launcher(cfg, user=None):
    def build(binary, args):
        return [cfg.docker if hasattr(cfg, 'docker') else 'docker', 'exec', '-i', '-u', 'postgres', cfg.container, binary, *args]
    return build


# ---------------------------------------------------------------- app host (188)
class SshAppHost:
    """Stops/starts the app container by immutable ID on the app host, never through Coolify (a Coolify
    stop removes the app network and kills the ID-pinned private transport). Forced command, dedicated key."""
    def __init__(self, cfg):
        self.cfg = cfg

    def call(self, verb):
        c = self.cfg
        argv = ['ssh', '-i', str(c.app_ssh_key), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', f'UserKnownHostsFile={c.app_known_hosts}', '-o', 'ConnectTimeout=10', f'root@{c.app_host}', verb]
        try:
            p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=SAFE_ENV, timeout=90)
            if p.returncode != 0:
                raise Refused('app-host-command')
            return json.loads(p.stdout)
        except (OSError, subprocess.TimeoutExpired, ValueError):
            raise Refused('app-host-ssh')

    def inspect(self):
        return self.call('inspect')

    def stop(self, cid):
        return self.call('stop ' + cid)

    def start(self, cid):
        return self.call('start ' + cid)


def capacity_problems(info):
    out = []
    if info['mem_available_mib'] < 1024:
        out.append('memory')
    if info['swap_used_mib'] > 512:
        out.append('swap')
    if info['disk_free_gib'] < 2:
        out.append('disk')
    return out


def operator_recovery_sql(account_id, project_id, subject):
    """Exact emergency SQL: link an existing enabled superadmin to a Firebase subject. Printed, never run."""
    if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', account_id or ''):
        raise Refused('recovery-account')
    if not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project_id or '') or not re.fullmatch(r'[A-Za-z0-9]{1,128}', subject or ''):
        raise Refused('recovery-subject')
    return f"""BEGIN;
DO $do$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
   WHERE p.id='{account_id}' AND p.role='superadmin' AND a.disabled_at IS NULL)
 THEN RAISE EXCEPTION 'not an enabled superadmin'; END IF;
END $do$;
INSERT INTO public.app_identity_bindings(project_id, subject, user_id, provider, binding_proof)
 VALUES ('{project_id}', '{subject}', '{account_id}', 'google.com', 'operator-recovery');
COMMIT;
"""


SCHEMA_FP_SQL = """SELECT encode(sha256(convert_to(coalesce(string_agg(format('%s.%s:%s:%s:%s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '')), E'\n' ORDER BY c.relname COLLATE "C", a.attnum), ''), 'UTF8')), 'hex')
FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND c.relname = ANY(__TABLES__)"""


# ---------------------------------------------------------------- Coolify
class Coolify:
    def __init__(self, cfg, token):
        self.cfg, self.token = cfg, token

    def req(self, method, path, body=None, retries=3):
        last = None
        for attempt in range(retries):
            data = json.dumps(body).encode() if body is not None else None
            r = urllib.request.Request(self.cfg.coolify_base + '/api/v1' + path, data=data, method=method,
                                       headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
            try:
                with OPENER.open(r, timeout=30) as resp:
                    raw = resp.read()
                    return resp.status, (json.loads(raw) if raw else None)
            except urllib.error.HTTPError as e:
                if e.code < 500 or method != 'GET':
                    return e.code, None
                last = e.code
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                last = 0
                if method != 'GET':
                    raise Refused('coolify-unreachable')
            self.cfg.sleep(1)
        raise Refused('coolify-unreachable')

    def envs(self):
        status, body = self.req('GET', f'/applications/{self.cfg.app_uuid}/envs')
        if status != 200 or not isinstance(body, list):
            raise Refused('coolify-envs')
        return [e for e in body if not e.get('is_preview')]

    def env_map(self):
        return {e['key']: e.get('value') for e in self.envs()}

    def set_env(self, key, value):
        payload = {'key': key, 'value': value}
        status, _ = self.req('PATCH', f'/applications/{self.cfg.app_uuid}/envs', payload)
        if status >= 300:
            status, _ = self.req('POST', f'/applications/{self.cfg.app_uuid}/envs', payload)
        if status >= 300 and self.env_map().get(key) != value:
            raise Refused('coolify-env-write')

    def delete_env(self, key):
        for e in self.envs():
            if e['key'] == key and e.get('uuid'):
                self.req('DELETE', f'/applications/{self.cfg.app_uuid}/envs/{e["uuid"]}')

    def app_status(self):
        status, body = self.req('GET', f'/applications/{self.cfg.app_uuid}')
        return (body or {}).get('status', '') if status == 200 else ''

    def deploy(self):
        status, body = self.req('POST', f'/deploy?uuid={self.cfg.app_uuid}')
        uuid = (((body or {}).get('deployments') or [{}])[0]).get('deployment_uuid')
        if status >= 300 or not uuid:
            raise Refused('coolify-deploy')
        for _ in range(self.cfg.deploy_attempts):
            status, body = self.req('GET', f'/deployments/{uuid}')
            s = (body or {}).get('status', '')
            if s == 'finished':
                return
            if s in ('failed', 'cancelled-by-user'):
                raise Refused('deploy-failed')
            self.cfg.sleep(self.cfg.poll_seconds)
        raise Refused('deploy-timeout')


def http_get(url, token=None, timeout=15):
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    try:
        with OPENER.open(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
            return r.status, r.read(1 << 20)
    except urllib.error.HTTPError as e:
        return e.code, b''
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0, b''


def health(cfg, token=None):
    status, raw = http_get(cfg.public_url + '/api/health/ready', token)
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, {}


# ---------------------------------------------------------------- durable state
class State:
    def __init__(self, root):
        self.root, self.path, self.data = Path(root), Path(root) / 'state.json', None

    def load(self):
        try:
            self.data = json.loads(self.path.read_text())
        except (OSError, ValueError):
            self.data = None
        return self.data

    def save(self):
        tmp = self.path.with_suffix('.tmp')
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump(self.data, f, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)
        try:
            run_dir = self.root / self.data['run']
            if run_dir.is_dir():
                (run_dir / 'state.json').write_text(json.dumps(self.data, sort_keys=True))
        except (OSError, KeyError, TypeError):
            pass
        try:
            dfd = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        except OSError:
            pass  # directory fsync is unavailable on the Windows test harness only

    def begin(self, mode, image_sha):
        self.data = {'run': secrets.token_hex(6), 'mode': mode, 'status': 'running', 'image_sha': image_sha, 'phases': {}, 'facts': {}}
        self.save()

    def phase(self, name, status='ok'):
        self.data['phases'][name] = {'status': status, 'at': int(time.time())}
        self.data['phase'] = name
        self.save()
        say(phase=name, status=status, run=self.data['run'])

    def fact(self, **kv):
        self.data['facts'].update(kv)
        self.save()

    @property
    def facts(self):
        return self.data['facts']


# ---------------------------------------------------------------- orchestrator
class Cutover:
    def __init__(self, cfg, secrets_in, image_sha, bundle, target, make_source, coolify, apphost, google_script=False, discard=''):
        self.cfg, self.sec, self.sha, self.bundle = cfg, secrets_in, image_sha, Path(bundle) if bundle else None
        self.target, self.make_source, self.coolify, self.apphost = target, make_source, coolify, apphost
        self.google_script, self.discard = google_script, discard
        self.st = State(cfg.root)
        self.source = None
        self._lock = None
        self._xmail = None

    @property
    def proposals(self):
        keep = []
        for item in PROPOSALS:
            name, file, _ = item
            if name in OPTIONAL_PROPOSALS and not (self.bundle and (self.bundle / 'proposals' / file).exists()):
                continue
            keep.append(item)
        return keep

    @property
    def flags(self):
        return FLAGS + (['OWNED_BLOG_ENABLED'] if any(n == 'native-blog-operations' for n, _, _ in self.proposals) else [])

    def src(self):
        if self.source is None:
            if not self.sec.get('SUPABASE_SOURCE_DATABASE_URL'):
                raise Refused('source-url-missing')
            self.source = self.make_source(self.sec['SUPABASE_SOURCE_DATABASE_URL'])
        return self.source

    def tgt(self, query, database=None, **kw):
        return self.target.sql(query, database or self.cfg.database, **kw)

    def source_tables(self):
        return json.loads(self.src().read(BUSINESS_TABLES_SQL).splitlines()[-1])

    def target_tables(self, database=None):
        return json.loads(self.target.read(BUSINESS_TABLES_SQL, database or self.cfg.database).splitlines()[-1])

    def manifest_query(self, tables):
        arr = 'ARRAY[' + ','.join("'" + t + "'" for t in tables) + ']::text[]'
        return (SESSION_SETUP + 'BEGIN;\n' + MANIFEST_FN +
                f"SELECT jsonb_build_object('tables', pg_temp.xm_manifest({arr}), 'groups', pg_temp.xm_groups(), 'next', pg_temp.xm_sequences())::text;\nROLLBACK;\n")

    def manifest(self, pg, tables, database=None):
        out = pg.sql(self.manifest_query(tables), database)
        return json.loads([l for l in out.splitlines() if l.startswith('{')][-1])

    def tracked_tables(self):
        return [t for t in self.target_tables() if t not in EPHEMERAL]

    # ----- plan
    def plan(self):
        cfg, blockers = self.cfg, []
        state = self.st.load()
        lock_held = False
        if fcntl and (cfg.root / 'lock').exists():
            fd = os.open(cfg.root / 'lock', os.O_RDWR)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(fd, fcntl.LOCK_UN)
            except OSError:
                lock_held = True
            finally:
                os.close(fd)
        say(phase='plan', mode='read-only', state_status=(state or {}).get('status', 'none'), state_phase=(state or {}).get('phase', 'none'), lock_held=lock_held)
        if state and state.get('status') in ('running', 'completed', 'failed-needs-review', 'revert-incomplete'):
            blockers.append('previous-run-' + state['status'])
        code, h = health(cfg, self.health_token())
        say(check='app-health', http=code, database_ok=bool(h.get('checks', {}).get('database', {}).get('ok')),
            release_is_dispatch_sha=h.get('release') == self.sha, database_mode=(h.get('config') or {}).get('database_mode', 'unknown'))
        if code != 200:
            blockers.append('app-not-healthy')
        for name in SECRET_NAMES:
            say(check='secret', name=name, present=bool(self.sec.get(name)))
        try:
            env = self.coolify.env_map()
            for f in self.flags:
                say(check='env-flag', name=f, value=env.get(f, 'absent') if env.get(f) in ('true', 'false') else ('absent' if f not in env else 'set'))
            say(check='env-google-staged', present=sum(1 for k in GOOGLE_STAGED if env.get(k)), expected=len(GOOGLE_STAGED), enabled_flag=env.get('GOOGLE_AUTH_ENABLED', 'absent'))
            say(check='env-database-urls', present=sum(1 for p in PREFIXES if env.get(p + '_DATABASE_URL')), expected=len(PREFIXES))
            legacy = [k for k in ('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY') if env.get(k)]
            say(check='env-runtime-required', legacy_proof_present=len(legacy), expected=2, storage_s3_present=sum(1 for k in STORAGE_KEYS if env.get(k)), storage_s3_expected=len(STORAGE_KEYS))
            say(check='env-misc', health_token=bool(env.get('HEALTH_TOKEN')), storage_provider=env.get('STORAGE_PROVIDER', 'absent'), identity_origin=bool(env.get('IDENTITY_ORIGIN')), cutover_env_lock=RUN_LOCK_ENV in env)
            if len(legacy) != 2:
                blockers.append('runtime-legacy-proof-env')
            if any(not env.get(k) for k in STORAGE_KEYS):
                blockers.append('storage-s3-env')
            if RUN_LOCK_ENV in env:
                blockers.append('cutover-env-lock-present')
        except Refused as e:
            blockers.append(e.label)
        try:
            info = self.apphost.inspect()
            say(check='app-host', containers=info['containers'], running=info['running'], network_pinned=info['network_id'] == cfg.network_id,
                transport_active=info['transport'], mem_available_mib=info['mem_available_mib'], swap_used_mib=info['swap_used_mib'], disk_free_gib=info['disk_free_gib'])
            if info['containers'] != 1 or not info['running'] or info['network_id'] != cfg.network_id or not info['transport']:
                blockers.append('app-host-state')
            blockers += ['app-host-' + x for x in capacity_problems(info)]
        except Refused as e:
            say(check='app-host', ok=False, why=e.label)
            blockers.append(e.label)
        if cfg.production_host:
            cap = self.host_capacity()
            say(check='host', **cap)
            blockers += ['local-' + x for x in capacity_problems(cap)]
        try:
            facts = self.target_facts()
            say(check='candidate-access', ok=True, public_tables=len(facts['tables']), ledger_rows=facts['ledger'],
                accounts=facts['accounts'], runtime_login=facts['runtime']['login'], runtime_limit=facts['runtime']['limit'],
                runtime_sessions=facts['sessions'], always_triggers=facts['always'], tables_not_owned=facts['not_owned'], owner_can_lock_auth_users=facts['auth_lock'])
            pending = []
            for name, applied in self.proposal_state().items():
                say(check='proposal', name=name, applied=applied)
                if not applied:
                    pending.append(name)
            say(check='proposals-pending', count=len(pending), order='|'.join(pending) or 'none')
            say(check='blog-proposal', in_commit=any(n == 'native-blog-operations' for n, _, _ in self.proposals))
            limit = facts['runtime']['limit']
            pool = (limit - 1) // 2
            say(check='connection-budget', role_limit=limit, containers_during_rollout=2, heartbeat_slots=1, pool_max=pool,
                worst_case=2 * pool + 1, headroom=limit - (2 * pool + 1), single_pool=True)
            for cond, label in [(limit != cfg.runtime_limit, 'runtime-limit'), (facts['runtime']['login'], 'runtime-already-login'),
                                (facts['sessions'], 'runtime-sessions'), (facts['always'], 'always-triggers'),
                                (not facts['auth_lock'] or facts['not_owned'], 'owner-privileges')]:
                if cond:
                    blockers.append(label)
        except (SqlFailed, Refused, KeyError, ValueError, IndexError) as e:
            say(check='candidate-access', ok=False, why=getattr(e, 'label', 'sql-error'))
            blockers.append('candidate-access')
            facts = None
        try:
            stables = self.source_tables()
            ttables = facts['tables'] if facts else []
            say(check='source-access', ok=True, public_tables=len(stables), expected=cfg.expected_tables)
            if len(stables) != cfg.expected_tables:
                blockers.append('source-table-count')
            scounts = json.loads(self.src().read(COUNTS_SQL).splitlines()[-1])
            tcounts = json.loads(self.target.read(COUNTS_SQL, cfg.database).splitlines()[-1]) if facts else {}
            different = 0
            for t in stables:
                d = scounts.get(t, 0) - tcounts.get(t, 0)
                different += d != 0
                say(check='rows', table=t, source=scounts.get(t, 0), candidate=tcounts.get(t, 0), diff=d)
            say(check='rows-summary', tables_with_difference=different, missing_in_candidate=len(set(stables) - set(ttables)))
            if set(stables) - set(ttables):
                blockers.append('candidate-missing-tables')
            elif facts:
                same = self.schema_match(stables)
                say(check='schema-fingerprint', match=same)
                if not same:
                    blockers.append('schema-differs')
            sf = self.source_facts()
            say(check='roles', **{('role_' + k): v for k, v in sorted(sf['roles'].items())}, google_users=sf['google_users'], superadmin_with_google=sf['superadmin_google'])
            if sf['roles'].get('superadmin', 0) and not sf['superadmin_google']:
                blockers.append('superadmin-without-google')
            if facts:
                info, bad = self.account_problems(sf)
                say(check='accounts', **info)
                blockers += bad
        except (SqlFailed, Refused, ValueError, IndexError, KeyError) as e:
            say(check='source-access', ok=False, why=getattr(e, 'label', 'sql-error'))
            blockers.append('source-access')
        say(check='google-subject-import', script_in_commit=self.google_script)
        if not self.google_script:
            blockers.append('google-subjects-script-missing')
        problem = self.offhost_problem()
        say(check='offhost-backup', ok=problem is None)
        if problem:
            blockers.append(problem)
        say(phase='plan', status='done', ready=not blockers, blockers='|'.join(blockers) or 'none')
        return 0 if not blockers else 2

    def health_token(self):
        try:
            return self.coolify.env_map().get('HEALTH_TOKEN')
        except Refused:
            return None

    def host_capacity(self):
        mem = dict(l.split(':', 1) for l in Path('/proc/meminfo').read_text().splitlines())
        st = os.statvfs(self.cfg.root if self.cfg.root.exists() else '/')
        kb = lambda k: int(mem[k].split()[0]) // 1024
        return {'mem_available_mib': kb('MemAvailable'), 'swap_used_mib': kb('SwapTotal') - kb('SwapFree'),
                'disk_free_gib': st.f_bavail * st.f_frsize // 2**30}

    def target_facts(self):
        c = self.cfg
        q = f"""SELECT jsonb_build_object(
 'version', current_setting('server_version_num')::int/10000, 'database', current_database(),
 'tables', (SELECT coalesce(jsonb_agg(relname ORDER BY relname),'[]') FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')),
 'ledger', (SELECT count(*) FROM supabase_migrations.schema_migrations),
 'accounts', (SELECT count(*) FROM public.app_accounts),
 'runtime', (SELECT jsonb_build_object('login', rolcanlogin, 'limit', rolconnlimit) FROM pg_authid WHERE rolname='{c.runtime}'),
 'sessions', (SELECT count(*) FROM pg_stat_activity WHERE usename IN ('{c.runtime}','{c.reader}')),
 'always', (SELECT count(*) FROM pg_trigger t JOIN pg_class k ON k.oid=t.tgrelid WHERE k.relnamespace='public'::regnamespace AND NOT t.tgisinternal AND t.tgenabled='A'),
 'auth_lock', (has_schema_privilege('{c.owner}','auth','USAGE') AND has_table_privilege('{c.owner}','auth.users','UPDATE')),
 'not_owned', (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner<>'{c.owner}'))::text"""
        return json.loads(self.target.read(q, c.database).splitlines()[-1])

    def proposal_state(self):
        out = {}
        for name, _, sentinel in self.proposals:
            res = self.target.read(sentinel, self.cfg.database).splitlines()
            out[name] = res[-1].strip() == 't'
        return out

    def offhost_problem(self):
        """Real check of the off-host backup receipt (contract: docs/xprout-final-cutover.md)."""
        c = self.cfg
        if not c.require_offhost:
            return None
        try:
            r = json.loads(c.offhost_receipt.read_text())
            fresh = time.time() - int(r['at']) <= c.offhost_max_age_hours * 3600
            ok = r.get('restored') is True and bool(re.fullmatch('[0-9a-f]{64}', r.get('sha256', ''))) and r.get('database') == c.database
        except (OSError, ValueError, KeyError, TypeError):
            return 'offhost-backup-missing'
        return None if fresh and ok else 'offhost-backup-stale'

    def source_facts(self):
        q = """SELECT jsonb_build_object(
 'auth_ids', (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM auth.users),
 'profile_ids', (SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM public.profiles),
 'roles', (SELECT coalesce(jsonb_object_agg(role, n),'{}') FROM (SELECT role, count(*) AS n FROM public.profiles GROUP BY role) r),
 'superadmin_google', (SELECT count(*) FROM public.profiles p WHERE p.role='superadmin' AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id=p.id AND i.provider='google')),
 'google_users', (SELECT count(DISTINCT user_id) FROM auth.identities WHERE provider='google'))::text"""
        return json.loads(self.src().read(q).splitlines()[-1])

    def account_problems(self, sf):
        """Compare the source Auth/profile sets with the candidate accounts (counts only)."""
        accounts = set(self.tgt('SELECT id FROM public.app_accounts').split())
        auth, profiles = set(sf['auth_ids']), set(sf['profile_ids'])
        info = {'source_auth': len(auth), 'source_profiles': len(profiles), 'candidate_accounts': len(accounts),
                'auth_missing_in_candidate': len(auth - accounts), 'candidate_extra': len(accounts - auth),
                'profiles_without_auth': len(profiles - auth), 'auth_without_profile': len(auth - profiles)}
        bad = []
        if info['candidate_extra']:
            bad.append('candidate-extra-accounts')
        if info['profiles_without_auth'] or info['auth_without_profile']:
            bad.append('source-auth-profiles-differ')
        if info['source_auth'] != self.cfg.expected_accounts:
            bad.append('account-baseline')
        return info, bad

    def schema_match(self, tables):
        arr = "ARRAY[" + ",".join("'" + t + "'" for t in tables) + "]"
        a = self.src().read(SCHEMA_FP_SQL.replace('__TABLES__', arr)).splitlines()[-1]
        b = self.target.read(SCHEMA_FP_SQL.replace('__TABLES__', arr), self.cfg.database).splitlines()[-1]
        return a == b

    def admit(self, where):
        """Capacity of both hosts, rechecked at each heavy step (host 49 refused a deploy for this on 2026-11-05)."""
        bad = []
        if self.cfg.production_host:
            bad += ['local-' + x for x in capacity_problems(self.host_capacity())]
        info = self.apphost.inspect()
        bad += ['app-host-' + x for x in capacity_problems(info)]
        if bad:
            raise Refused('capacity-' + where + '-' + '-'.join(bad))

    def take_xmail_lock(self):
        c = self.cfg
        if not c.production_host:
            return
        try:
            fd = os.open(c.xmail_deploy_lock, os.O_WRONLY | os.O_NOFOLLOW)
            if fcntl:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._xmail = fd
        except OSError:
            raise Refused('xmail-deploy-lock')

    def wait_health(self, release=None, token=None):
        c = self.cfg
        for _ in range(c.health_attempts):
            code, h = health(c, token or self.health_token())
            if code == 200 and h.get('checks', {}).get('database', {}).get('ok') and (release is None or h.get('release') == release):
                return h
            c.sleep(c.poll_seconds)
        return None

    def lock(self):
        self.cfg.root.mkdir(parents=True, exist_ok=True)
        os.chmod(self.cfg.root, 0o700)
        fd = os.open(self.cfg.root / 'lock', os.O_RDWR | os.O_CREAT, 0o600)
        try:
            if fcntl:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise Refused('another-run-active')
        self._lock = fd

    def unlock(self):
        fd, self._lock = getattr(self, '_lock', None), None
        if isinstance(fd, int):
            os.close(fd)

    def apply(self):
        try:
            return self._apply()
        finally:
            self.unlock()

    def rollback(self):
        try:
            return self._rollback()
        finally:
            self.unlock()

    def _apply(self):
        self.lock()
        old = self.st.load()
        if old and old.get('status') == 'running':
            say(phase='recover', status='start', interrupted_at=old.get('phase', 'none'))
            try:
                self.revert('interrupted-' + str(old.get('phase', 'none')), recovering=True)
            except Refused as e:
                say(phase='recover', status='refused', check=e.label)
                return 4 if e.label == 'revert-incomplete' else 3
            say(phase='recover', status='done', action='reverted-re-dispatch-apply')
            return 10
        if old and old.get('status') in ('completed', 'failed-needs-review', 'revert-incomplete'):
            say(phase='apply', status='refused', check='previous-run-' + old['status'], run=old.get('run', 'none'))
            return 2
        self.st.begin('apply', self.sha)
        started_changes = False
        try:
            self.take_xmail_lock()
            self.p_preflight()
            started_changes = True
            self.p_backup()
            self.p_stop_app()
            self.p_fence()
            self.admit('copy')
            self.p_copy()
            self.p_proposals()
            self.p_grants()
            self.p_login()
            self.p_google()
            self.p_post_manifest()
            self.p_env()
            self.admit('deploy')
            self.p_deploy()
            self.p_verify()
        except Refused as e:
            return self.fail(e.label, started_changes)
        except SqlFailed as e:
            return self.fail('sqlstate-' + e.sqlstate, started_changes)
        except Interrupted:
            return self.fail('interrupted', started_changes)
        except Exception:
            return self.fail('unexpected', started_changes)
        try:
            self.p_marker()
        except Exception:
            # A verified switch is never reverted because a marker could not be written (M4).
            say(phase='marker', status='failed', check='marker-write', note='switch-verified-not-reverted')
        say(phase='apply', status='completed', run=self.st.data['run'])
        return 0

    def fail(self, label, started_changes):
        say(phase=self.st.data.get('phase', 'preflight'), status='failed', check=label)
        if not started_changes:
            self.st.data['status'] = 'refused'
            self.st.save()
            return 2
        try:
            self.revert(label)
        except Refused as e:
            say(phase='revert', status='refused', check=e.label)
            return 4 if e.label == 'revert-incomplete' else 3
        except BaseException:
            say(phase='revert', status='failed', check='unexpected')
            return 4
        return 1

    def p_preflight(self):
        c = self.cfg
        if c.production_host:
            if os.getuid() != 0 or Path('/etc/hostname').read_text().strip() != c.hostname:
                raise Refused('wrong-host')
        for name in ('COOLIFY_TOKEN', 'SUPABASE_SOURCE_DATABASE_URL'):
            if not self.sec.get(name):
                raise Refused('secret-' + name.lower().replace('_', '-'))
        if not re.fullmatch(r'[0-9a-f]{40}', self.sha or ''):
            raise Refused('image-sha')
        if not self.google_script:
            raise Refused('google-subjects-script-missing')
        problem = self.offhost_problem()
        if problem:
            raise Refused(problem)
        self.admit('preflight')
        info = self.apphost.inspect()
        if info['containers'] != 1 or not info['running'] or info['network_id'] != c.network_id or not info['transport']:
            raise Refused('app-host-state')
        code, h = health(c, self.health_token())
        if code != 200 or not h.get('checks', {}).get('database', {}).get('ok'):
            raise Refused('app-not-healthy')
        env = self.coolify.env_map()
        if any(env.get(f) == 'true' for f in self.flags):
            raise Refused('flags-already-on')
        if RUN_LOCK_ENV in env:
            raise Refused('cutover-env-lock-present')
        if sum(1 for k in GOOGLE_STAGED if env.get(k)) != len(GOOGLE_STAGED):
            raise Refused('google-staged-incomplete')
        if not (env.get('NEXT_PUBLIC_SUPABASE_URL') and env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')):
            raise Refused('runtime-legacy-proof-env')
        if any(not env.get(k) for k in STORAGE_KEYS):
            raise Refused('storage-s3-env')
        facts = self.target_facts()
        if facts['version'] != 17 or facts['database'] != c.database:
            raise Refused('target-identity')
        if facts['runtime']['login'] or facts['runtime']['limit'] != c.runtime_limit or facts['sessions'] or facts['always']:
            raise Refused('target-roles')
        if not facts['auth_lock'] or facts['not_owned']:
            raise Refused('owner-privileges')
        stables = self.source_tables()
        if len(stables) != c.expected_tables or set(stables) - set(facts['tables']):
            raise Refused('table-set')
        if not self.schema_match(stables):
            raise Refused('schema-differs')
        sf = self.source_facts()
        _, bad = self.account_problems(sf)
        if bad:
            raise Refused(bad[0])
        if sf['roles'].get('superadmin', 0) and not sf['superadmin_google']:
            raise Refused('superadmin-without-google')
        if not self.proposal_state()['identity-foundation']:
            raise Refused('identity-foundation-missing')
        if self.bundle:
            meta = json.loads((self.bundle / 'bundle.json').read_text())
            for _, f, _ in self.proposals:
                if f and hashlib.sha256((self.bundle / 'proposals' / f).read_bytes()).hexdigest() != meta['proposals'].get(f):
                    raise Refused('bundle-hash')
        self.st.fact(tables=stables, image_tag_before=env.get('IMAGE_TAG', ''), release_before=h.get('release', ''), flags=self.flags)
        self.st.phase('preflight')

    def p_backup(self):
        c, run = self.cfg, self.st.data['run']
        dump = self.target.dump(['-Fc', '-d', c.database])
        d = c.root / run
        d.mkdir(mode=0o700)
        path = d / 'candidate-before.dump'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        with os.fdopen(fd, 'wb') as f:
            f.write(dump)
            f.flush()
            os.fsync(f.fileno())
        temp = 'xmartmenu_cutover_' + run
        self.tgt(f'CREATE DATABASE {ident(temp)}', 'postgres')
        self.st.fact(temp_db=temp, dump_sha256=hashlib.sha256(dump).hexdigest())
        self.target.restore(dump, temp)
        tables = self.target_tables()
        if self.manifest(self.target, tables, c.database)['tables'] != self.manifest(self.target, tables, temp)['tables']:
            raise Refused('backup-restore-mismatch')
        self.st.phase('backup-verified')

    def p_stop_app(self):
        c = self.cfg
        info = self.apphost.inspect()
        if info['containers'] != 1 or not info['running'] or info['network_id'] != c.network_id or not info['transport']:
            raise Refused('app-host-state')
        # Normal deploys refuse while this variable exists (scripts/coolify-deploy.sh).
        self.st.fact(app_container=info['id'], network_id=info['network_id'], app_stopped=True, lock_env=True)
        self.coolify.set_env(RUN_LOCK_ENV, self.st.data['run'])
        self.apphost.stop(info['id'])  # docker update --restart=no + docker stop, by immutable ID
        after = self.apphost.inspect()
        if after['network_id'] != c.network_id or not after['transport'] or after['running']:
            raise Refused('network-or-transport-lost')
        self.st.phase('app-stopped')

    def p_fence(self):
        tables = self.st.facts['tables']
        self.st.fact(source_fenced=True)  # marker first: a crash after DDL must still unfence
        self.src().sql(fence_sql(tables))
        self.src().sql(fence_verify_sql(len(tables)))
        self.st.phase('source-fenced')

    def p_copy(self):
        c, tables = self.cfg, self.st.facts['tables']
        src = self.src()
        expected = self.manifest(src, tables)
        seqs = json.loads(src.read("SELECT coalesce(jsonb_object_agg(sequencename, jsonb_build_object('last', last_value::text, 'start', start_value::text)),'{}'::jsonb)::text FROM pg_sequences WHERE schemaname='public'").splitlines()[-1])
        expected['sequences'] = {n: ({'value': int(v['last']), 'called': True} if v['last'] is not None else {'value': int(v['start']), 'called': False}) for n, v in seqs.items()}
        controls = json.loads(src.read("SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'disabled', (deleted_at IS NOT NULL OR (banned_until IS NOT NULL AND banned_until > now())))),'[]')::text FROM auth.users").splitlines()[-1])
        raw = src.dump(['--data-only', '--no-owner', '--no-privileges', '--no-comments', '--no-publications', '--no-subscriptions',
                        '--lock-wait-timeout=30000', *sum((['-t', 'public.' + t] for t in tables), [])])
        blocks = filter_dump(raw, set(tables))
        dpath = c.root / self.st.data['run'] / 'source-final.copy'
        fd = os.open(dpath, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        with os.fdopen(fd, 'wb') as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        self.st.fact(source_manifest_sha256=hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest())
        script = copy_script(tables, blocks, expected, controls)
        self.tgt(script, self.st.facts['temp_db'], timeout=900)       # dress rehearsal on the throwaway copy
        self.tgt(f'DROP DATABASE {ident(self.st.facts["temp_db"])}', 'postgres')
        self.st.fact(temp_db='', rehearsal_ok=True)
        self.st.phase('rehearsal-ok')
        self.st.fact(copy_attempted=True)
        self.tgt(script, timeout=900)
        self.st.fact(copy_committed=True)
        self.st.phase('data-copied')

    def p_proposals(self):
        state = self.proposal_state()
        before = set(self.target_tables())
        for name, file, _ in self.proposals:
            if file is None or state[name]:
                continue
            sql = (self.bundle / 'proposals' / file).read_text()
            try:
                self.target.sql(sql, self.cfg.database, role=self.cfg.owner)
                if file == CLAIMS_FILE:
                    version = file.split('_', 1)[0]
                    self.tgt("INSERT INTO supabase_migrations.schema_migrations(version, name, statements, created_by) VALUES ('"
                             + version + "', 'identity_google_claims', ARRAY[$stmt$" + sql + "$stmt$], 'xmartmenu-final-cutover') ON CONFLICT DO NOTHING")
            except SqlFailed as e:
                say(phase='proposal.' + name, status='failed', check='sqlstate-' + e.sqlstate)
                raise
            if not self.proposal_state()[name]:
                raise Refused('proposal-not-applied')
            self.st.phase('proposal.' + name)
        proof = self.tgt("SELECT pg_get_constraintdef(oid) LIKE '%phone-match%' AND pg_get_constraintdef(oid) LIKE '%native-registration%' FROM pg_constraint WHERE conname='app_identity_bindings_binding_proof_check'").splitlines()[-1]
        if proof != 't':
            raise Refused('binding-proof-constraint')
        self.st.fact(proposal_tables=sorted(set(self.target_tables()) - before))
        self.st.phase('proposals-applied')

    def p_grants(self):
        c = self.cfg
        n = self.tgt(f"""WITH t AS (SELECT c.oid::regclass AS rel FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')
  AND NOT has_table_privilege('{c.runtime}', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_any_column_privilege('{c.runtime}', c.oid, 'SELECT,INSERT,UPDATE'))
SELECT count(*) FROM t;""", role=c.owner).splitlines()[-1]
        self.tgt(f"""DO $do$ DECLARE r regclass; s record; BEGIN
 FOR r IN SELECT c.oid::regclass FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')
   AND NOT has_table_privilege('{c.runtime}', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AND NOT has_any_column_privilege('{c.runtime}', c.oid, 'SELECT,INSERT,UPDATE')
 LOOP EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %s TO {c.runtime}', r); END LOOP;
 FOR s IN WITH q AS MATERIALIZED (SELECT sq.oid AS sqoid, t.oid AS toid FROM pg_class sq JOIN pg_depend d ON d.objid=sq.oid AND d.deptype='a' JOIN pg_class t ON t.oid=d.refobjid
   WHERE sq.relkind='S' AND sq.relnamespace='public'::regnamespace AND t.relkind IN ('r','p'))
   SELECT sqoid::regclass AS seq FROM q WHERE has_table_privilege('{c.runtime}', toid, 'INSERT') AND NOT has_sequence_privilege('{c.runtime}', sqoid, 'USAGE')
 LOOP EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO {c.runtime}', s.seq); END LOOP;
END $do$;""", role=c.owner)
        say(phase='runtime-grants', tables_granted=n)
        self.st.phase('runtime-grants')

    def p_login(self):
        c = self.cfg
        self.password = secrets.token_hex(24)  # memory only
        verifier = scram_verifier(self.password)
        self.st.fact(runtime_login_enabled=True)
        self.tgt(f"SET log_statement='none'; SET log_min_error_statement='panic';\nALTER ROLE {ident(c.runtime)} LOGIN CONNECTION LIMIT {c.runtime_limit} PASSWORD '{verifier}';")
        self.st.phase('runtime-login-enabled')

    def p_google(self):
        base = (self.sec.get('NEXT_PUBLIC_SUPABASE_URL') or '').rstrip('/')
        key = self.sec.get('SUPABASE_SERVICE_ROLE_KEY')
        if not base or not key or not base.startswith(('https://', 'http://127.0.0.1')):
            raise Refused('google-subjects-secrets')
        users = []
        for page in range(1, 101):
            r = urllib.request.Request(f'{base}/auth/v1/admin/users?page={page}&per_page=200', headers={'apikey': key, 'Authorization': 'Bearer ' + key})
            try:
                with OPENER.open(r, timeout=30) as resp:
                    batch = json.loads(resp.read()).get('users')
            except (urllib.error.URLError, ValueError, OSError):
                raise Refused('google-subjects-response')
            if not isinstance(batch, list):
                raise Refused('google-subjects-response')
            users += batch
            if len(batch) < 200:
                break
        def detail(uid):
            r = urllib.request.Request(f'{base}/auth/v1/admin/users/{uid}', headers={'apikey': key, 'Authorization': 'Bearer ' + key})
            try:
                with OPENER.open(r, timeout=30) as resp:
                    return json.loads(resp.read())
            except (urllib.error.URLError, ValueError, OSError):
                raise Refused('google-subjects-response')
        users = enrich_google_users(users, detail)
        claims = plan_claims(users, set(self.tgt('SELECT id FROM public.app_accounts').split()))
        values = ','.join(f"('{s}','{a}')" for s, a in claims)
        if values:
            self.tgt(f"""BEGIN; INSERT INTO public.identity_google_subject_claims(google_sub,account_id,source)
 SELECT s,a::uuid,'supabase-auth-import' FROM (VALUES {values}) v(s,a) ON CONFLICT (google_sub) DO NOTHING;
 DO $do$ BEGIN IF EXISTS (SELECT 1 FROM (VALUES {values}) v(s,a) JOIN public.identity_google_subject_claims c ON c.google_sub=v.s WHERE c.account_id<>v.a::uuid)
 THEN RAISE EXCEPTION 'claimed by another account'; END IF; END $do$; COMMIT;""")
        say(phase='google-subjects', status='ok', claims=len(claims))
        # A superadmin must be able to sign in with the owned login (B3); otherwise nothing goes live.
        n = int(self.tgt("""SELECT count(*) FROM public.profiles p WHERE p.role='superadmin' AND (
 EXISTS (SELECT 1 FROM public.identity_google_subject_claims c WHERE c.account_id=p.id)
 OR EXISTS (SELECT 1 FROM public.app_identity_bindings b WHERE b.user_id=p.id))""").splitlines()[-1])
        total = int(self.tgt("SELECT count(*) FROM public.profiles WHERE role='superadmin'").splitlines()[-1])
        say(phase='google-subjects', superadmins=total, superadmins_with_link=n)
        if total and not n:
            raise Refused('superadmin-without-link')
        self.st.phase('google-subjects')

    def p_post_manifest(self):
        m = self.manifest(self.target, self.tracked_tables(), self.cfg.database)
        self.st.fact(post_manifest=m['tables'], post_next=m['next'])
        self.st.phase('post-manifest-recorded')

    def env_values(self):
        c = self.cfg
        url = f'postgresql://{c.runtime}:{self.password}@{c.runtime_host}:{c.runtime_port}/{c.database}'
        values = {f: 'true' for f in self.flags}
        values.update({'STORAGE_PROVIDER': 's3', 'IDENTITY_ORIGIN': c.public_url, 'GOOGLE_AUTH_ENABLED': 'true',
                       'PROD_DATABASE_HOST': c.runtime_host, 'PROD_DATABASE_NAME': c.database, 'IMAGE_TAG': self.sha, 'IMAGE_REPOSITORY': c.image_repository})
        for p in PREFIXES:
            values[p + '_DATABASE_URL'] = url
            values[p + '_DATABASE_SSL'] = 'disable'
        return values

    def p_env(self):
        values = self.env_values()
        current = self.coolify.env_map()
        self.st.fact(env_previous={k: current.get(k) for k in values})  # None = was absent
        self.st.fact(env_write_started=True)
        for k, v in values.items():
            self.coolify.set_env(k, v)
        after = self.coolify.env_map()
        if any(after.get(k) != v for k, v in values.items()):
            raise Refused('env-readback')
        self.st.phase('env-written')

    def p_deploy(self):
        self.st.fact(deploy_started=True)  # marker before the POST: conservative
        self.coolify.deploy()
        self.st.phase('deployed')

    def p_verify(self):
        c, token = self.cfg, self.health_token()
        h = self.wait_health(self.sha, token)
        if h is None:
            raise Refused('health-release')
        mode = (h.get('config') or {}).get('database_mode')
        if token and (mode != 'owned' or (h.get('config') or {}).get('storage') != 's3'):
            raise Refused('health-mode')
        info = self.apphost.inspect()
        if info['network_id'] != c.network_id or not info['transport']:
            raise Refused('network-or-transport-lost')
        n = int(self.tgt(f"SELECT count(*) FROM pg_stat_activity WHERE usename='{c.runtime}' AND datname='{c.database}'").splitlines()[-1])
        if n < 1:
            raise Refused('app-not-on-owned-database')
        slug = self.tgt("SELECT t.slug FROM public.tenants t WHERE t.is_active ORDER BY t.created_at LIMIT 1").splitlines()[-1]
        code, _ = http_get(f'{c.public_url}/{slug}')
        if code != 200:
            raise Refused('public-menu')
        code, _ = http_get(c.public_url + '/identity')
        if code != 200:
            raise Refused('login-unavailable')
        say(phase='verify', status='ok', database_mode=mode or 'unverified', runtime_sessions=n)
        self.st.phase('verified')

    def p_marker(self):
        run = self.st.data['run']
        (self.cfg.root / 'COMPLETED').write_text(json.dumps({'run': run, 'sha': self.sha, 'at': int(time.time())}))
        self.st.data['status'] = 'completed'
        self.st.phase('completed')
        try:
            self.coolify.delete_env(RUN_LOCK_ENV)
        except Refused:
            say(check='cutover-env-lock-left', note='remove-by-hand')
        self.tgt(f"""CREATE SCHEMA IF NOT EXISTS xmartmenu_cutover;
CREATE TABLE IF NOT EXISTS xmartmenu_cutover.markers(run_id text NOT NULL, phase text NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id, phase));
REVOKE ALL ON SCHEMA xmartmenu_cutover FROM PUBLIC; REVOKE ALL ON xmartmenu_cutover.markers FROM PUBLIC;
INSERT INTO xmartmenu_cutover.markers(run_id, phase) VALUES ('{run}', 'completed') ON CONFLICT DO NOTHING;""")

    def new_writes(self):
        f = self.st.facts
        if 'post_manifest' not in f:
            return False
        m = self.manifest(self.target, self.tracked_tables(), self.cfg.database)
        return m['tables'] != f['post_manifest'] or m['next'] != f['post_next']

    def revert(self, reason, recovering=False):
        """Every step runs even if an earlier one failed; the end state is only 'reverted' when all verified."""
        c, f, errors = self.cfg, self.st.facts, []
        say(phase='revert', status='start', reason=reason)
        deployed = bool(f.get('deploy_started')) or self.st.data.get('status') == 'completed'
        touched = any(f.get(k) for k in ('copy_attempted', 'source_fenced', 'app_stopped', 'runtime_login_enabled', 'env_write_started', 'temp_db', 'lock_env'))
        if not touched and not deployed:
            self.st.data['status'] = 'refused'
            self.st.save()
            return
        current = {}

        def step(name, fn):
            try:
                fn()
            except Refused as e:
                errors.append(name)
                say(phase='revert.' + name, status='failed', check=e.label)
            except SqlFailed as e:
                errors.append(name)
                say(phase='revert.' + name, status='failed', check='sqlstate-' + e.sqlstate)
            except Exception:
                errors.append(name)
                say(phase='revert.' + name, status='failed', check='unexpected')

        def stop_current():
            if deployed:
                info = self.apphost.inspect()
                current['id'] = info['id']
                if info['running']:
                    self.apphost.stop(info['id'])
                if self.new_writes():
                    needs = 'DISCARD-' + self.st.data['run']
                    if self.discard != needs:
                        say(phase='revert', status='refused', check='new-writes-detected', needs=needs)
                        self.apphost.start(info['id'])
                        self.st.data['status'] = 'failed-needs-review'
                        self.st.save()
                        raise Refused('new-writes-detected')
                    self.export_new_rows()

        try:
            stop_current()
        except Refused as e:
            if e.label == 'new-writes-detected':
                raise
            errors.append('stop-current')
            say(phase='revert.stop-current', status='failed', check=e.label)

        def role_off():
            if f.get('runtime_login_enabled') or deployed:
                self.tgt(f"ALTER ROLE {ident(c.runtime)} NOLOGIN PASSWORD NULL; SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename='{c.runtime}';")
                row = self.tgt(f"SELECT rolcanlogin::text || (rolpassword IS NULL)::text FROM pg_authid WHERE rolname='{c.runtime}'").splitlines()[-1]
                if row != 'falsetrue':
                    raise Refused('role-still-login')
        step('role-off', role_off)

        def env_back():
            previous = f.get('env_previous', {})
            if f.get('env_write_started'):
                for k, v in previous.items():
                    if v is None:
                        self.coolify.delete_env(k)
                    else:
                        self.coolify.set_env(k, v)
                now = self.coolify.env_map()
                if any(now.get(k) != v for k, v in previous.items()):
                    raise Refused('env-readback')
        step('env-restore', env_back)

        def unfence():
            if f.get('source_fenced'):
                self.src().sql(unfence_sql(f['tables']))
                left = int(self.src().read("SELECT count(*) FROM pg_trigger WHERE tgname='xm_cutover_fence'").splitlines()[-1])
                if left:
                    raise Refused('unfence-incomplete')
        step('unfence-source', unfence)

        def temp_db():
            if f.get('temp_db'):
                self.tgt(f'DROP DATABASE IF EXISTS {ident(f["temp_db"])}', 'postgres')
        step('temp-database', temp_db)

        def old_app_back():
            if deployed:
                self.coolify.deploy()
                expected = f.get('release_before') or None
            elif f.get('app_container'):
                self.apphost.start(f['app_container'])
                expected = f.get('release_before') or None
            else:
                return
            if self.wait_health(expected) is None:
                raise Refused('revert-health')
            info = self.apphost.inspect()
            if info['network_id'] != c.network_id or not info['transport']:
                raise Refused('network-or-transport-lost')
        step('old-app', old_app_back)

        def drop_lock():
            self.coolify.delete_env(RUN_LOCK_ENV)
            if RUN_LOCK_ENV in self.coolify.env_map():
                raise Refused('cutover-env-lock-left')
        step('cutover-env-lock', drop_lock)

        if errors:
            self.st.data['status'] = 'revert-incomplete'
            self.st.fact(revert_errors=errors)
            say(phase='revert', status='incomplete', failed_steps='|'.join(errors), manual='docs/xprout-final-cutover.md')
            raise Refused('revert-incomplete')
        self.st.data['status'] = 'reverted'
        self.st.save()
        say(phase='revert', status='done', reason=reason)

    def export_new_rows(self):
        """Keep a private copy of everything written to the own database before discarding it (B4)."""
        raw = self.target.dump(['-Fc', '-d', self.cfg.database])
        path = self.cfg.root / self.st.data['run'] / 'owned-new-writes.dump'
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        with os.fdopen(fd, 'wb') as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        self.st.fact(new_rows_exported=hashlib.sha256(raw).hexdigest())
        say(phase='revert', status='exported-new-rows', bytes=len(raw))

    def _rollback(self):
        self.lock()
        old = self.st.load()
        if not old:
            raise Refused('no-run-recorded')
        if old['status'] == 'running':
            try:
                self.revert('interrupted-' + str(old.get('phase', 'none')), recovering=True)
            except Refused as e:
                say(phase='rollback', status='refused', check=e.label)
                return 4 if e.label == 'revert-incomplete' else 3
            return 10
        if old['status'] not in ('completed', 'failed-needs-review', 'revert-incomplete'):
            say(phase='rollback', status='nothing-to-do', last=old['status'])
            return 0
        try:
            self.revert('manual-rollback')
        except Refused as e:
            say(phase='rollback', status='refused', check=e.label)
            return 4 if e.label == 'revert-incomplete' else 3
        say(phase='rollback', status='done')
        return 0

def enrich_google_users(users, get_detail, max_details=100):
    """The Admin API listing returns identities: [] for everyone; only /admin/users/{id} has them.
    app_metadata.providers (in the listing) says who has Google, so only those details are fetched (GET)."""
    uuid = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)
    out, fetched = [], 0
    for u in users:
        meta = u.get('app_metadata') if isinstance(u.get('app_metadata'), dict) else {}
        hinted = 'google' in (meta.get('providers') or [])
        uid = u.get('id')
        if not hinted or u.get('identities') or not (isinstance(uid, str) and uuid.match(uid)):
            out.append(u)
            continue
        fetched += 1
        if fetched > max_details:
            raise Refused('google-subjects-too-many')
        d = get_detail(uid)
        if not isinstance(d, dict) or d.get('id') != uid:
            raise Refused('google-subjects-response')
        out.append({**u, 'identities': d.get('identities') or []})
    return out


def plan_claims(users, account_ids):
    uuid = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)
    claims, seen = [], set()
    for u in users:
        subs = set()
        for i in (u.get('identities') or []):
            if isinstance(i, dict) and i.get('provider') == 'google':
                s = i.get('provider_id') or (i.get('identity_data') or {}).get('sub')
                if isinstance(s, str) and re.fullmatch(r'\d{5,40}', s):
                    subs.add(s)
        if len(subs) != 1:
            continue
        sub = next(iter(subs))
        uid = u.get('id')
        if isinstance(uid, str) and uuid.match(uid) and uid in account_ids and sub not in seen:
            seen.add(sub)
            claims.append((sub, uid))
    return claims


# ---------------------------------------------------------------- production wiring
SOURCE_CA_SHA256 = '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA'


def production_source(cfg, bundle):
    def make(url):
        from urllib.parse import urlparse, unquote
        u = urlparse(url)
        user = unquote(u.username or '')
        direct = u.hostname == f'db.{cfg.source_project}.supabase.co' and user == 'postgres'
        pooler = re.fullmatch(r'aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com', u.hostname or '') and user == f'postgres.{cfg.source_project}'
        if not (direct or pooler) or u.path != '/postgres':
            raise Refused('source-url-shape')
        pem = (Path(bundle) / 'supabase-ca.crt').read_text()
        der = base64.b64decode(''.join(l for l in pem.splitlines() if not l.startswith('-----')))
        if hashlib.sha256(der).hexdigest().upper() != SOURCE_CA_SHA256:
            raise Refused('source-ca')
        image = subprocess.run(['docker', 'inspect', '--format', '{{.Image}}', cfg.container], stdout=subprocess.PIPE, env=SAFE_ENV, check=True).stdout.decode().strip()
        env = {'PGHOST': u.hostname, 'PGPORT': '5432', 'PGDATABASE': 'postgres', 'PGUSER': user, 'PGPASSWORD': unquote(u.password or ''),
               'PGSSLMODE': 'verify-full', 'PGSSLROOTCERT': '/ca.crt', 'PGCONNECT_TIMEOUT': '8', 'PGAPPNAME': 'xmartmenu-cutover'}

        def launcher(binary, args):
            return ['docker', 'run', '--rm', '-i', '--pull=never', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                    '--memory', '256m', '--pids-limit', '64', *sum((['-e', k] for k in env), []),
                    '-v', f'{Path(bundle) / "supabase-ca.crt"}:/ca.crt:ro', '--entrypoint', binary, image, *args]
        return Pg(launcher, env=env)
    return make


def main(argv=None, cfg=None, target=None, make_source=None, coolify=None, apphost=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', choices=['plan', 'apply', 'rollback'], default='plan')
    ap.add_argument('--image-repository', choices=['ghcr.io/skale-club/xprout', 'ghcr.io/skale-club/xmartmenu'], default='ghcr.io/skale-club/xprout')
    ap.add_argument('--image-sha', default='')
    ap.add_argument('--bundle', default='')
    ap.add_argument('--discard-new-writes', default='', help='rollback only: DISCARD-<run> after the owned rows were exported')
    ap.add_argument('--print-operator-recovery', nargs=2, metavar=('ACCOUNT_UUID', 'FIREBASE_SUBJECT'), help='print the emergency superadmin SQL and exit')
    args = ap.parse_args(argv)
    if args.print_operator_recovery:
        print(operator_recovery_sql(args.print_operator_recovery[0], os.environ.get('GOOGLE_AUTH_PROJECT_ID', 'skaleclub'), args.print_operator_recovery[1]))
        return 0
    signal.signal(signal.SIGHUP, signal.SIG_IGN)

    def term(*_):
        raise Interrupted()
    signal.signal(signal.SIGTERM, term)
    cfg = cfg or Config()
    sec = json.loads(sys.stdin.read() or '{}') if not sys.stdin.isatty() else {}
    token = sec.get('COOLIFY_TOKEN', '')
    target = target or Pg(docker_exec_launcher(cfg), ['-U', cfg.admin_user])
    bundle = args.bundle or None
    make_source = make_source or production_source(cfg, bundle)
    coolify = coolify or Coolify(cfg, token)
    google = bool(bundle) and (Path(bundle) / 'google-import-present').exists()
    cfg.image_repository = args.image_repository
    op = Cutover(cfg, sec, args.image_sha, bundle, target, make_source, coolify, apphost or SshAppHost(cfg), google, args.discard_new_writes)
    try:
        if args.mode == 'plan':
            return op.plan()
        if args.mode == 'apply':
            return op.apply()
        return op.rollback()
    except Refused as e:
        say(phase=args.mode, status='refused', check=e.label)
        return 2
    except SqlFailed as e:
        say(phase=args.mode, status='failed', check='sqlstate-' + e.sqlstate)
        return 1


if __name__ == '__main__':
    sys.exit(main())
