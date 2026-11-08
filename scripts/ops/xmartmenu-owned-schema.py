#!/usr/bin/env python3
"""Apply reviewed schema files to the owned xmartmenu database (after the final cutover).

Runs as root on the PostgreSQL host, shipped there by scripts/ops/run-xmartmenu-owned-schema.sh
(workflow .github/workflows/owned-schema.yml). Files live in docs/owned-schema/*.sql, each one
transaction, idempotent, run as xmartmenu_owner (SET ROLE from the admin login, the same path the
cutover operator uses for its proposals).

  --mode plan    read only: which files are applied, pending or changed since they were applied
  --mode apply   lock, schema-only dump, apply each pending file in name order, record it in the ledger

Ledger: xmartmenu_ops.owned_schema(name, sha256, applied_at, run). A file already recorded with a
different SHA-256 is refused (write a new file instead of editing an applied one).

Output: only `xmartmenu-owned-schema key=value` lines with counts, names and SQLSTATE codes, never
SQL text, connection strings or driver error messages.
"""
import argparse
import dataclasses
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    import fcntl
except ImportError:  # pragma: no cover - the host is Linux
    fcntl = None

SAFE_ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
NAME = re.compile(r'^[0-9]{14}_[a-z0-9_]{1,80}\.sql$')
LEDGER_SQL = """CREATE SCHEMA IF NOT EXISTS xmartmenu_ops;
REVOKE ALL ON SCHEMA xmartmenu_ops FROM PUBLIC;
CREATE TABLE IF NOT EXISTS xmartmenu_ops.owned_schema(
 name text PRIMARY KEY, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 applied_at timestamptz NOT NULL DEFAULT now(), run text NOT NULL);
REVOKE ALL ON xmartmenu_ops.owned_schema FROM PUBLIC;"""


class Refused(Exception):
    pass


class SqlFailed(Exception):
    pass


def say(**kv):
    parts = []
    for key, value in kv.items():
        text = str(value).lower() if isinstance(value, bool) else str(value)
        parts.append(f"{key}={text if re.fullmatch(r'[A-Za-z0-9_.:/-]{0,120}', text) else 'redacted'}")
    print('xmartmenu-owned-schema ' + ' '.join(parts), flush=True)


@dataclasses.dataclass
class Config:
    container: str = 'e12scyfsrp822dag7m9wwd4x'
    database: str = 'xmartmenu'
    admin_user: str = 'xmail_owner'
    owner: str = 'xmartmenu_owner'
    runtime: str = 'xmartmenu_runtime'
    root: Path = Path('/opt/xmartmenu/owned-schema')
    cutover_lock: Path = Path('/opt/xmartmenu/cutover/lock')
    xmail_deploy_lock: Path = Path('/opt/xmail/owned-runtime-ops/deploy.lock')
    production_host: bool = True
    docker: str = 'docker'


class Pg:
    """psql / pg_dump inside the PostgreSQL container, as the admin login."""
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def _argv(self, binary, args):
        c = self.cfg
        return [c.docker, 'exec', '-i', '-u', 'postgres', c.container, binary, '-U', c.admin_user, *args]

    def _run(self, binary, args, data=None, timeout=120):
        try:
            p = subprocess.run(self._argv(binary, args), input=data, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=SAFE_ENV, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise SqlFailed('timeout')
        if p.returncode != 0:
            m = re.search(rb'ERROR:\s+([0-9A-Z]{5})', p.stderr)
            raise SqlFailed(m.group(1).decode() if m else 'client')
        return p.stdout

    def sql(self, query, role=None, timeout=120):
        if role:
            query = f'SET ROLE "{role}";\n' + query
        args = ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-d', self.cfg.database]
        return self._run('psql', args, query.encode(), timeout).decode().strip()

    def dump_schema(self):
        return self._run('pg_dump', ['-Fc', '--schema-only', '-d', self.cfg.database], None, 600)


def load_bundle(bundle: Path):
    manifest = json.loads((bundle / 'bundle.json').read_text())
    files = []
    for name, digest in sorted(manifest['files'].items()):
        path = bundle / 'schema' / name
        if not NAME.match(name) or not path.is_file():
            raise Refused('bundle-file')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            raise Refused('bundle-digest')
        files.append((name, digest, data.decode('utf-8')))
    on_disk = sorted(p.name for p in (bundle / 'schema').glob('*.sql'))
    if on_disk != [name for name, _, _ in files]:
        raise Refused('bundle-manifest')
    return files


class Operator:
    def __init__(self, cfg: Config, pg: Pg, files, run_id: str):
        self.cfg, self.pg, self.files, self.run = cfg, pg, files, run_id
        self._fds = []

    def ledger(self):
        present = self.pg.sql("SELECT to_regclass('xmartmenu_ops.owned_schema') IS NOT NULL;", role=self.cfg.owner)
        if present != 't':
            return {}
        out = self.pg.sql("SELECT coalesce(json_object_agg(name, sha256), '{}') FROM xmartmenu_ops.owned_schema;", role=self.cfg.owner)
        return json.loads(out or '{}')

    def statuses(self):
        applied = self.ledger()
        result = []
        for name, digest, _ in self.files:
            if name not in applied:
                result.append((name, 'pending'))
            elif applied[name] == digest:
                result.append((name, 'applied'))
            else:
                result.append((name, 'changed'))
        return result

    def plan(self):
        statuses = self.statuses()
        for name, status in statuses:
            say(file=name, status=status)
        changed = [n for n, s in statuses if s == 'changed']
        pending = [n for n, s in statuses if s == 'pending']
        say(phase='plan', status='ok', files=len(statuses), pending=len(pending), changed=len(changed),
            ready=not changed)
        return 0 if not changed else 2

    def take_locks(self):
        c = self.cfg
        c.root.mkdir(parents=True, exist_ok=True)
        os.chmod(c.root, 0o700)
        for path, label, create in ((c.root / 'lock', 'another-run-active', True),
                                    (c.cutover_lock, 'cutover-active', False),
                                    (c.xmail_deploy_lock, 'xmail-deploy-lock', False)):
            if not create and not path.exists():
                continue
            try:
                flags = os.O_RDWR | (os.O_CREAT if create else 0) | getattr(os, 'O_NOFOLLOW', 0)
                fd = os.open(path, flags, 0o600)
                if fcntl:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise Refused(label)
            self._fds.append(fd)

    def release(self):
        while self._fds:
            os.close(self._fds.pop())

    def apply(self):
        try:
            self.take_locks()
            statuses = dict(self.statuses())
            if any(s == 'changed' for s in statuses.values()):
                raise Refused('applied-file-changed')
            pending = [(n, d, t) for n, d, t in self.files if statuses[n] == 'pending']
            if not pending:
                say(phase='apply', status='ok', applied=0, note='nothing-pending')
                return 0
            run_dir = self.cfg.root / self.run
            run_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
            dump = run_dir / 'schema-before.dump'
            data = self.pg.dump_schema()
            dump.write_bytes(data)
            os.chmod(dump, 0o400)
            say(phase='schema-dump', status='ok', bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            self.pg.sql(LEDGER_SQL, role=self.cfg.owner)
            for name, digest, text in pending:
                try:
                    self.pg.sql(text, role=self.cfg.owner, timeout=300)
                except SqlFailed as error:
                    say(file=name, status='failed', sqlstate=str(error))
                    raise
                self.pg.sql("INSERT INTO xmartmenu_ops.owned_schema(name, sha256, run) VALUES "
                            f"('{name}', '{digest}', '{self.run}');", role=self.cfg.owner)
                say(file=name, status='applied', sha256=digest)
            say(phase='apply', status='ok', applied=len(pending))
            return 0
        finally:
            self.release()


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['plan', 'apply'], required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--run', default=time.strftime('%Y%m%d%H%M%S'))
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', args.run):
        say(phase=args.mode, status='refused', check='run-id')
        return 2
    cfg = Config()
    try:
        op = Operator(cfg, Pg(cfg), load_bundle(Path(args.bundle)), args.run)
        return op.plan() if args.mode == 'plan' else op.apply()
    except Refused as error:
        say(phase=args.mode, status='refused', check=str(error))
        return 2
    except SqlFailed as error:
        say(phase=args.mode, status='failed', sqlstate=str(error))
        return 1


if __name__ == '__main__':
    sys.exit(main())
