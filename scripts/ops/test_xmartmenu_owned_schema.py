"""Tests for scripts/ops/xmartmenu-owned-schema.py and the files in docs/owned-schema/.

Offline tests always run. The PostgreSQL tests need a disposable PostgreSQL 17 container whose
superuser is xmail_owner (CI job owned-schema-postgres): XM_TEST_PG_CONTAINER=<name>.

  python3 -B scripts/ops/test_xmartmenu_owned_schema.py
"""
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('owned_schema', REPO / 'scripts/ops/xmartmenu-owned-schema.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
CONTAINER = os.environ.get('XM_TEST_PG_CONTAINER')
AR_FILE = '20261107090000_product_ar_models.sql'
REAL_SIZE_FILE = '20261111090000_ar_real_size_and_cart_source.sql'
STAGING_FILE = '20261111120000_menu_staging.sql'
SUBDOMAIN_FILE = '20261111140000_tenant_subdomain.sql'


def make_bundle(root: Path, files: dict, tamper: str = None):
    (root / 'schema').mkdir(parents=True)
    digests = {}
    for name, text in files.items():
        (root / 'schema' / name).write_text(text)
        digests[name] = hashlib.sha256(text.encode()).hexdigest()
    if tamper:
        digests[tamper] = '0' * 64
    (root / 'bundle.json').write_text(json.dumps({'files': digests}))
    return root


class FakePg:
    def __init__(self, ledger=None):
        self.ledger, self.calls = dict(ledger or {}), []

    def sql(self, query, role=None, timeout=120):
        self.calls.append((query, role))
        if 'to_regclass' in query:
            return 't' if self.ledger else 'f'
        if 'json_object_agg' in query:
            return json.dumps(self.ledger)
        if query.startswith('INSERT INTO xmartmenu_ops.owned_schema'):
            name = query.split("('")[1].split("'")[0]
            self.ledger[name] = query.split("', '")[1].split("'")[0]
        return ''

    def dump_schema(self):
        return b'dump'


class OfflineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = ops.Config(root=self.tmp / 'root', cutover_lock=self.tmp / 'none1', xmail_deploy_lock=self.tmp / 'none2')

    def test_every_repo_file_has_a_valid_name(self):
        names = [p.name for p in (REPO / 'docs/owned-schema').glob('*.sql')]
        self.assertIn(AR_FILE, names)
        for name in names:
            self.assertRegex(name, ops.NAME)

    def test_bundle_refuses_tampered_or_unlisted_files(self):
        files = {'20260101000000_a.sql': 'SELECT 1;'}
        self.assertEqual(len(ops.load_bundle(make_bundle(self.tmp / 'ok', files))), 1)
        with self.assertRaises(ops.Refused):
            ops.load_bundle(make_bundle(self.tmp / 'bad', files, tamper='20260101000000_a.sql'))
        extra = make_bundle(self.tmp / 'extra', files)
        (extra / 'schema' / '20260101000001_b.sql').write_text('SELECT 2;')
        with self.assertRaises(ops.Refused):
            ops.load_bundle(extra)

    def test_plan_reports_pending_applied_and_changed(self):
        files = ops.load_bundle(make_bundle(self.tmp / 'b', {'20260101000000_a.sql': 'A', '20260101000001_b.sql': 'B'}))
        a_digest = files[0][1]
        op = ops.Operator(self.cfg, FakePg({'20260101000000_a.sql': a_digest}), files, 'run1')
        self.assertEqual(op.statuses(), [('20260101000000_a.sql', 'applied'), ('20260101000001_b.sql', 'pending')])
        self.assertEqual(op.plan(), 0)
        changed = ops.Operator(self.cfg, FakePg({'20260101000000_a.sql': '1' * 64}), files, 'run1')
        self.assertEqual(changed.plan(), 2)
        with self.assertRaises(ops.Refused):
            changed.apply()

    def test_apply_dumps_then_applies_pending_files_in_order_as_owner(self):
        files = ops.load_bundle(make_bundle(self.tmp / 'b', {'20260101000001_b.sql': 'B;', '20260101000000_a.sql': 'A;'}))
        pg = FakePg()
        self.assertEqual(ops.Operator(self.cfg, pg, files, 'run1').apply(), 0)
        bodies = [q for q, _ in pg.calls if q in ('A;', 'B;')]
        self.assertEqual(bodies, ['A;', 'B;'])
        self.assertTrue(all(role == 'xmartmenu_owner' for q, role in pg.calls if q in ('A;', 'B;')))
        self.assertTrue((self.cfg.root / 'run1' / 'schema-before.dump').exists())
        # Nothing pending the second time: no dump, no SQL file runs.
        again = FakePg(pg.ledger)
        self.assertEqual(ops.Operator(self.cfg, again, files, 'run2').apply(), 0)
        self.assertFalse((self.cfg.root / 'run2').exists())

    def test_output_never_echoes_unsafe_values(self):
        from io import StringIO
        from contextlib import redirect_stdout
        out = StringIO()
        with redirect_stdout(out):
            ops.say(check='postgres://user:secret@host/db', ok=True)
        self.assertNotIn('secret', out.getvalue())
        self.assertIn('check=redacted', out.getvalue())


@unittest.skipUnless(CONTAINER, 'XM_TEST_PG_CONTAINER not set')
class PostgresTests(unittest.TestCase):
    """The AR file against a minimal owned database, twice, through the real operator."""
    def psql(self, query, database='postgres', check=True):
        p = subprocess.run(['docker', 'exec', '-i', '-u', 'postgres', CONTAINER, 'psql', '-U', 'xmail_owner', '-X', '-qAt',
                            '-v', 'ON_ERROR_STOP=1', '-d', database], input=query.encode(), capture_output=True)
        if check and p.returncode != 0:
            raise AssertionError(p.stderr.decode())
        return p

    def setUp(self):
        self.psql("DROP DATABASE IF EXISTS xmartmenu WITH (FORCE);")
        self.psql("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='xmartmenu_owner') THEN CREATE ROLE xmartmenu_owner NOLOGIN; END IF;"
                  " IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='xmartmenu_runtime') THEN CREATE ROLE xmartmenu_runtime NOLOGIN BYPASSRLS; END IF; END $$;")
        self.psql("CREATE DATABASE xmartmenu OWNER xmartmenu_owner;")
        self.psql("""SET ROLE xmartmenu_owner;
CREATE TABLE public.tenants(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id));
CREATE TABLE public.product_media(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid);
CREATE TABLE public.menu_events(id bigserial PRIMARY KEY, event_name text NOT NULL,
  source text CONSTRAINT menu_events_source_check CHECK (source IS NULL OR source = ANY (ARRAY['grid'::text, 'featured'::text,
  'detail'::text, 'cart'::text, 'checkout'::text, 'feed'::text, 'search'::text, 'upsell'::text, 'unknown'::text])),
  CONSTRAINT menu_events_event_name_check CHECK (event_name = ANY (ARRAY['menu_session_started'::text, 'product_impression'::text,
  'product_engagement'::text, 'product_detail_opened'::text, 'media_started'::text, 'media_completed'::text, 'media_swiped'::text,
  'category_selected'::text, 'search_performed'::text, 'add_to_cart'::text, 'upsell_shown'::text, 'order_created'::text])));
INSERT INTO public.menu_events(event_name, source) VALUES ('upsell_shown', 'upsell'), ('order_created', NULL);
GRANT SELECT ON public.products, public.tenants TO xmartmenu_runtime;""", 'xmartmenu')
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = ops.Config(container=CONTAINER, root=self.tmp / 'root', cutover_lock=self.tmp / 'n1', xmail_deploy_lock=self.tmp / 'n2')
        text = (REPO / 'docs/owned-schema' / AR_FILE).read_text()
        self.files = ops.load_bundle(make_bundle(self.tmp / 'bundle', {AR_FILE: text}))
        self.text = text

    def test_real_size_file_adds_columns_and_the_ar_source_once(self):
        pg = ops.Pg(self.cfg)
        texts = {name: (REPO / 'docs/owned-schema' / name).read_text() for name in (AR_FILE, REAL_SIZE_FILE)}
        files = ops.load_bundle(make_bundle(self.tmp / 'both', texts))
        self.assertEqual(ops.Operator(self.cfg, pg, files, 'r1').apply(), 0)
        self.assertEqual(ops.Operator(self.cfg, pg, files, 'r2').statuses(), [(AR_FILE, 'applied'), (REAL_SIZE_FILE, 'applied')])
        pg.sql(texts[REAL_SIZE_FILE], role='xmartmenu_owner')  # a second run changes nothing
        check = pg.sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='menu_events_source_check';")
        for name in ('ar', 'upsell', 'detail', 'unknown'):
            self.assertIn(f"'{name}'", check)
        self.assertEqual(pg.sql("SELECT column_default FROM information_schema.columns WHERE table_name='product_ar_models' AND column_name='scale';"), '1')
        self.assertEqual(pg.sql("SELECT has_column_privilege('xmartmenu_runtime','public.product_ar_models','scale','SELECT,UPDATE');"), 't')
        bad = self.psql("SET ROLE xmartmenu_owner; UPDATE public.product_ar_models SET scale = 50;", 'xmartmenu', check=False)
        self.assertEqual(bad.returncode, 0)  # no rows yet: the CHECK is exercised below
        self.psql("SET ROLE xmartmenu_owner; INSERT INTO public.tenants DEFAULT VALUES;"
                  " INSERT INTO public.products(tenant_id) SELECT id FROM public.tenants LIMIT 1;"
                  " INSERT INTO public.product_ar_models(product_id, tenant_id, glb_url) SELECT id, tenant_id, 'https://cdn.example/a.glb' FROM public.products LIMIT 1;", 'xmartmenu')
        out_of_range = self.psql("SET ROLE xmartmenu_owner; UPDATE public.product_ar_models SET scale = 50;", 'xmartmenu', check=False)
        self.assertNotEqual(out_of_range.returncode, 0)
        self.psql("SET ROLE xmartmenu_owner; INSERT INTO public.menu_events(event_name, source) VALUES ('add_to_cart', 'ar');", 'xmartmenu')

    def test_ar_file_applies_once_keeps_events_and_is_idempotent(self):
        pg = ops.Pg(self.cfg)
        self.assertEqual(ops.Operator(self.cfg, pg, self.files, 'r1').apply(), 0)
        self.assertEqual(ops.Operator(self.cfg, pg, self.files, 'r2').statuses(), [(AR_FILE, 'applied')])
        # Running the file itself again (e.g. by hand) changes nothing and does not fail.
        pg.sql(self.text, role='xmartmenu_owner')
        check = pg.sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='menu_events_event_name_check';")
        for name in ('ar_launched', 'model_viewer_opened', 'upsell_shown', 'order_created', 'menu_session_started'):
            self.assertIn(f"'{name}'", check)
        self.assertEqual(pg.sql("SELECT has_table_privilege('xmartmenu_runtime','public.product_ar_models','SELECT,INSERT,UPDATE,DELETE');"), 't')
        self.assertEqual(pg.sql("SELECT count(*) FROM xmartmenu_ops.owned_schema;", role='xmartmenu_owner'), '1')

    def test_staging_file_adds_hidden_staging_columns_once(self):
        pg = ops.Pg(self.cfg)
        self.psql("SET ROLE xmartmenu_owner; CREATE TABLE public.menus(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,"
                  " slug text NOT NULL, is_active boolean NOT NULL DEFAULT true, is_default boolean NOT NULL DEFAULT false, UNIQUE(tenant_id, slug));"
                  " GRANT SELECT, INSERT, UPDATE, DELETE ON public.menus TO xmartmenu_runtime;"
                  " INSERT INTO public.menus(tenant_id, slug, is_default) VALUES (gen_random_uuid(), 'main', true);", 'xmartmenu')
        text = (REPO / 'docs/owned-schema' / STAGING_FILE).read_text()
        files = ops.load_bundle(make_bundle(self.tmp / 'staging', {STAGING_FILE: text}))
        self.assertEqual(ops.Operator(self.cfg, pg, files, 'r1').apply(), 0)
        self.assertEqual(ops.Operator(self.cfg, pg, files, 'r2').statuses(), [(STAGING_FILE, 'applied')])
        pg.sql(text, role='xmartmenu_owner')  # a second run changes nothing
        for column in ('staging_of', 'preview_token', 'replaced_at'):
            self.assertEqual(pg.sql(f"SELECT has_column_privilege('xmartmenu_runtime','public.menus','{column}','SELECT,INSERT,UPDATE');"), 't')
        # A staging copy can never be visible or the default.
        live = self.psql("SET ROLE xmartmenu_runtime; INSERT INTO public.menus(tenant_id, slug, is_active, staging_of)"
                         " SELECT tenant_id, 'staging', true, id FROM public.menus LIMIT 1;", 'xmartmenu', check=False)
        self.assertNotEqual(live.returncode, 0)
        self.assertIn(b'menus_staging_hidden', live.stderr)
        self.psql("SET ROLE xmartmenu_runtime; INSERT INTO public.menus(tenant_id, slug, is_active, staging_of, preview_token)"
                  " SELECT tenant_id, 'staging', false, id, repeat('a', 32) FROM public.menus LIMIT 1;", 'xmartmenu')
        weak = self.psql("SET ROLE xmartmenu_runtime; UPDATE public.menus SET preview_token='short' WHERE slug='staging';", 'xmartmenu', check=False)
        self.assertNotEqual(weak.returncode, 0)

    def test_subdomain_file_adds_a_unique_dns_label_once(self):
        pg = ops.Pg(self.cfg)
        self.psql("SET ROLE xmartmenu_owner; ALTER TABLE public.tenants ADD COLUMN slug text;"
                  " GRANT SELECT, INSERT, UPDATE ON public.tenants TO xmartmenu_runtime;"
                  " INSERT INTO public.tenants(slug) VALUES ('a'), ('b');", 'xmartmenu')
        text = (REPO / 'docs/owned-schema' / SUBDOMAIN_FILE).read_text()
        files = ops.load_bundle(make_bundle(self.tmp / 'subdomain', {SUBDOMAIN_FILE: text}))
        self.assertEqual(ops.Operator(self.cfg, pg, files, 'r1').apply(), 0)
        self.assertEqual(ops.Operator(self.cfg, pg, files, 'r2').statuses(), [(SUBDOMAIN_FILE, 'applied')])
        pg.sql(text, role='xmartmenu_owner')  # a second run changes nothing
        self.assertEqual(pg.sql("SELECT has_column_privilege('xmartmenu_runtime','public.tenants','subdomain','SELECT,UPDATE');"), 't')
        self.psql("SET ROLE xmartmenu_runtime; UPDATE public.tenants SET subdomain='aurora' WHERE slug='a';", 'xmartmenu')
        taken = self.psql("SET ROLE xmartmenu_runtime; UPDATE public.tenants SET subdomain='aurora' WHERE slug='b';", 'xmartmenu', check=False)
        self.assertNotEqual(taken.returncode, 0)
        for bad in ('Aurora', 'a--b', '-a', 'a.b'):
            out = self.psql(f"SET ROLE xmartmenu_runtime; UPDATE public.tenants SET subdomain='{bad}' WHERE slug='b';", 'xmartmenu', check=False)
            self.assertNotEqual(out.returncode, 0, bad)

    def test_tenant_trigger_rejects_a_foreign_dish(self):
        pg = ops.Pg(self.cfg)
        ops.Operator(self.cfg, pg, self.files, 'r1').apply()
        ok = """SET ROLE xmartmenu_runtime;
WITH t AS (SELECT id FROM public.tenants LIMIT 1), p AS (SELECT id, tenant_id FROM public.products LIMIT 1)
INSERT INTO public.product_ar_models(product_id, tenant_id, glb_url) SELECT p.id, p.tenant_id, 'https://cdn.example/a.glb' FROM p;"""
        self.psql("SET ROLE xmartmenu_owner; INSERT INTO public.tenants DEFAULT VALUES; INSERT INTO public.tenants DEFAULT VALUES;"
                  " INSERT INTO public.products(tenant_id) SELECT id FROM public.tenants ORDER BY id LIMIT 1;", 'xmartmenu')
        self.psql(ok, 'xmartmenu')
        foreign = self.psql("""SET ROLE xmartmenu_runtime;
INSERT INTO public.product_ar_models(product_id, tenant_id, glb_url)
SELECT p.id, (SELECT id FROM public.tenants WHERE id <> p.tenant_id LIMIT 1), 'https://cdn.example/b.glb' FROM public.products p LIMIT 1;""", 'xmartmenu', check=False)
        self.assertNotEqual(foreign.returncode, 0)
        self.assertIn(b'does not belong to tenant', foreign.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=1)
