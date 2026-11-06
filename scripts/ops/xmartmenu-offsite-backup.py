#!/usr/bin/env python3
"""Xmartmenu off-host SQL backup, verified by a throwaway restore.

Xmartmenu profile of the Xmail mechanism (docs/xmail-owned-backup.md in the Xmail
repository). Offline by default: without --backup or --receive nothing runs.

  --backup   on the PostgreSQL host (49): exported repeatable-read snapshot, pg_dump of
             database `xmartmenu`, row/schema manifest, CMS-encrypted archive, pushed over a
             dedicated forced-command SSH key to 188, then the receipt latest.json.
  --receive  on the target (188), invoked only by sshd's forced command: verifies, decrypts,
             restores into a throwaway container with hard limits, compares the manifest,
             publishes the archive and keeps the last 7.

Nothing here prints rows, SQL, keys or driver messages: failures carry fixed labels and
code coordinates only. The module is importable; every path, host and limit lives in Config
so the tests can drive the real functions against a disposable PostgreSQL and a temp dir.
"""
import argparse
import dataclasses
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import traceback
from pathlib import Path

try:
    import fcntl
except ImportError:  # Windows: only the offline tests run there
    fcntl = None

SOURCE = '49.13.197.250'
TARGET = '188.245.112.3'
PG_CONTAINER = 'e12scyfsrp822dag7m9wwd4x'
PG_IMAGE = 'sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'
# The recipient certificate the Xmail mechanism already uses (public part; the RSA private key
# stays on 188). Reusing it adds no key to hold; the pin is the DER fingerprint.
RECIPIENT_SHA = '2efbf3fc906a50317413cb6994842229b81062897a3d3849dd3f835abbdfa0cb'
FORCED_COMMAND = 'xmartmenu-offsite-backup'
OPERATION = re.compile(r'xmartmenu-\d{8}T\d{6}Z-[a-f0-9]{16}')
HEX64 = re.compile(r'[a-f0-9]{64}')
SAFE_ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
MIB = 1024 * 1024


@dataclasses.dataclass
class Config:
    source_ip: str = SOURCE
    target_ip: str = TARGET
    pg_container: str = PG_CONTAINER
    database: str = 'xmartmenu'
    admin_user: str = 'xmail_owner'
    pg_image: str = PG_IMAGE
    recipient_sha: str = RECIPIENT_SHA
    # root of everything Xmartmenu owns on both hosts
    base: Path = Path('/opt/xmartmenu')
    recipient_dir: Path = Path('/opt/xmail/offsite-backups/v1/recipient')
    # other Xmail processes this one must never overlap with
    xmail_backup_lock: Path = Path('/opt/xmail/owned-backup-ops/backup.lock')
    xmail_receiver_lock: Path = Path('/opt/xmail/owned-backup-ops/receiver.lock')
    xmail_deploy_lock: Path = Path('/opt/xmail/owned-runtime-ops/deploy.lock')
    sentinel_tables: tuple = ('app_accounts', 'profiles', 'orders')
    keep: int = 7
    max_cipher_bytes: int = 64 * MIB
    max_dump_bytes: int = 32 * MIB     # the restore profile below is sized for dumps up to this
    min_mem_available_mib: int = 1024  # same floor the cutover operator uses
    max_swap_used_mib: int = 512
    min_disk_gib: int = 2
    strict: bool = True                # root-owned 0700/0600 files, SSH peer pins, flock; off only in tests on Windows
    uid: int = 0
    production: bool = True            # pins host identity through SSH_CONNECTION
    capacity: object = None            # test hook: callable(cfg) -> dict
    docker: str = 'docker'
    ssh: str = 'ssh'

    @property
    def ops(self):
        return self.base / 'offsite-backup-ops'

    @property
    def archives(self):  # on the target
        return self.base / 'offsite-backups' / 'v1'

    @property
    def receipt_dir(self):  # on the source: where the cutover operator looks
        return self.base / 'offsite-backups'

    @property
    def receipt(self):
        return self.receipt_dir / 'latest.json'


class Refused(Exception):
    """A safe, labelled refusal. The label is a fixed identifier, never data."""
    def __init__(self, label, sqlstate=None, detail=None):
        super().__init__(label)
        self.label, self.sqlstate, self.detail = label, sqlstate, detail


def need(value, label='refused'):
    if not value:
        raise Refused(label)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


# ------------------------------------------------------------------ files
def guard(cfg, path, directory=False, mode=None):
    info = path.lstat()
    need(not stat.S_ISLNK(info.st_mode), 'file-symlink')
    need(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode), 'file-kind')
    if cfg.strict:
        need(info.st_uid == cfg.uid, 'file-owner')
        need(directory or info.st_nlink == 1, 'file-links')
        if mode is not None:
            need(stat.S_IMODE(info.st_mode) == mode, 'file-mode')
    return info


def private_dir(cfg, path, create=False):
    if create and not os.path.lexists(path):
        path.mkdir(mode=0o700, parents=False)
    guard(cfg, path, True, 0o700)


def syncdir(path):
    if not hasattr(os, 'O_DIRECTORY'):
        return
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0), 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def read_json(cfg, path):
    info = guard(cfg, path, False, 0o600)
    need(info.st_size <= 65536, 'json-size')
    return json.loads(path.read_bytes())


def digest(cfg, path):
    guard(cfg, path, False, 0o600)
    h, size = hashlib.sha256(), 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def replace_file(path, data):
    """Atomic replace with a durable result (receipt)."""
    temporary = path.with_name('.' + path.name + '.' + secrets.token_hex(4))
    write_new(temporary, data)
    os.replace(temporary, path)
    syncdir(path.parent)


def rename_new(cfg, source, destination):
    """Rename that refuses to overwrite (renameat2 RENAME_NOREPLACE on Linux)."""
    need(not os.path.lexists(destination), 'destination-exists')
    if sys.platform.startswith('linux'):
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        fn = libc.renameat2
        fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        fn.restype = ctypes.c_int
        need(fn(-100, os.fsencode(source), -100, os.fsencode(destination), 1) == 0, 'rename')
    else:
        os.rename(source, destination)


def lock_file(cfg, path, optional=False, label='lock', foreign=False):
    """Exclusive non-blocking flock on a root-owned empty 0600 file; held until the fd is closed."""
    if not os.path.lexists(path):
        need(optional, label + '-missing')
        return None
    fd = os.open(path, os.O_WRONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        info = os.fstat(fd)
        if cfg.strict:
            if foreign:  # a lock another program owns: only refuse something that is not a plain root-owned file
                need(info.st_uid == cfg.uid and stat.S_ISREG(info.st_mode), label + '-state')
            else:
                need(info.st_uid == cfg.uid and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1 and info.st_size == 0, label + '-state')
        if fcntl:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise Refused(label + '-busy')
    except BaseException:
        os.close(fd)
        raise
    return fd


def release(fds):
    for fd in fds:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass


# ------------------------------------------------------------------ host capacity
def host_capacity(cfg):
    if cfg.capacity:
        return cfg.capacity(cfg)
    mem = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    kb = lambda key: int(mem[key].split()[0]) // 1024
    st = os.statvfs(cfg.base if cfg.base.exists() else '/')
    return {'mem_available_mib': kb('MemAvailable'), 'swap_used_mib': kb('SwapTotal') - kb('SwapFree'),
            'disk_free_bytes': st.f_bavail * st.f_frsize}


def capacity_problems(cfg, info, extra_mem_mib=0, extra_disk_bytes=0):
    out = []
    if info['mem_available_mib'] < cfg.min_mem_available_mib + extra_mem_mib:
        out.append('memory')
    if info['swap_used_mib'] > cfg.max_swap_used_mib:
        out.append('swap')
    if info['disk_free_bytes'] < max(cfg.min_disk_gib * 1024 ** 3, extra_disk_bytes):
        out.append('disk')
    return out


def admit(cfg, where, extra_mem_mib=0, extra_disk_bytes=0):
    bad = capacity_problems(cfg, host_capacity(cfg), extra_mem_mib, extra_disk_bytes)
    need(not bad, 'capacity-' + where + '-' + '-'.join(bad))


# ------------------------------------------------------------------ docker / psql
def call(cfg, args, data=None, timeout=60, binary=False):
    try:
        p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=os.environ if os.name == 'nt' else SAFE_ENV, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused('command-' + Path(args[0]).name[:16])
    if p.returncode != 0:
        raise Refused('command-' + Path(args[0]).name[:16] + '-failed', sqlstate=sqlstate_of(p.stderr))
    need(len(p.stdout) <= 8 * MIB, 'command-output')
    return p.stdout if binary else p.stdout.decode()


def sqlstate_of(stderr):
    codes = re.findall(rb'(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?:\r?\n|$)', (stderr or b'')[:65536])
    return codes[-1].decode() if codes else None


def inspect(cfg, name):
    value = json.loads(call(cfg, [cfg.docker, 'inspect', name]))
    need(isinstance(value, list) and len(value) == 1, 'inspect')
    return value[0]


def psql(cfg, container, user, database, sql, timeout=130):
    return call(cfg, [cfg.docker, 'exec', '-i', container, 'psql', '-XwqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-U', user, '-d', database],
                sql.encode(), timeout).strip()


def readonly_prelude(snapshot=None):
    head = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;' + (" SET TRANSACTION SNAPSHOT '" + snapshot + "';" if snapshot else '')
    return head + (" SET LOCAL log_statement='none'; SET LOCAL statement_timeout='120s'; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO,YMD';"
                   " SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex'; SET LOCAL search_path=public,pg_catalog; ")


# ------------------------------------------------------------------ manifest
IDENT = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,62}$')
TABLES_SQL = ("SELECT coalesce(jsonb_agg(c.relname ORDER BY c.relname COLLATE \"C\"),'[]'::jsonb) FROM pg_class c "
              "WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')")


def H(expr):
    return "encode(sha256(convert_to(coalesce((" + expr + "),''),'UTF8')),'hex')"


def manifest_sql(tables, ledger):
    """One read-only query: schema parts per table, functions, enum types, sequences, ledger and row fingerprints.

    Row fingerprint = count and two sums of the halves of each row's md5: order independent, constant memory,
    so the restore never sorts or spills (a sort spill is what filled the Xmail restore's data volume).
    """
    for name in tables:
        need(isinstance(name, str) and IDENT.fullmatch(name), 'table-name')
    parts = [
        H("SELECT string_agg(format('%s:%s:%s:%s:%s:%s',a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attgenerated,a.attidentity),E'\\n' ORDER BY a.attnum) "
          "FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped"),
        # precedence-aware deparser: pg_dump flattens redundant grouping in CHECK expressions on reload (seen on Xmail)
        H("SELECT string_agg(format('%s:%s:%s:%s',k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true)),E'\\n' ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid"),
        H("SELECT string_agg(pg_get_indexdef(i.indexrelid),E'\\n' ORDER BY ic.relname) FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=c.oid"),
        H("SELECT string_agg(format('%s:%s:%s:%s:%s:%s',p.polname,p.polcmd,p.polpermissive,(SELECT string_agg(r.rolname,',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid=ANY(p.polroles)),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)),E'\\n' ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid"),
        H("SELECT string_agg(pg_get_triggerdef(t.oid,true),E'\\n' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal"),
        'c.relrowsecurity', 'c.relforcerowsecurity',
    ]
    one = ("(SELECT jsonb_build_object('count',count(*),'sum',coalesce(sum(('x'||left(m,16))::bit(64)::bigint::numeric),0)::text||':'||coalesce(sum(('x'||right(m,16))::bit(64)::bigint::numeric),0)::text) "
           "FROM (SELECT md5(t::text) AS m FROM public.\"%s\" t) q)")
    # jsonb_build_object takes at most 100 arguments; jsonb_object_agg over VALUES has no such limit
    rows = "(SELECT coalesce(jsonb_object_agg(k,v),'{}'::jsonb) FROM (VALUES " + ','.join("('%s',%s)" % (name, one % name) for name in tables) + ") x(k,v))" if tables else "'{}'::jsonb"
    ledger_sql = ("(SELECT jsonb_build_object('count',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE \"C\"),''),'UTF8')),'hex')) "
                  "FROM supabase_migrations.schema_migrations t)") if ledger else 'NULL::jsonb'
    return ("SELECT jsonb_build_object("
            "'version',1,"
            "'tables',(" + TABLES_SQL + "),"
            "'schema',(SELECT coalesce(jsonb_object_agg(c.relname,jsonb_build_array(" + ','.join(parts) + ")),'{}'::jsonb) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')),"
            "'functions',(SELECT coalesce(jsonb_object_agg(p.oid::regprocedure::text," + H("SELECT pg_get_functiondef(p.oid)") + "),'{}'::jsonb) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p') "
            "AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')),"
            "'types',(SELECT coalesce(jsonb_object_agg(t.typname,(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid)),'{}'::jsonb) FROM pg_type t WHERE t.typnamespace='public'::regnamespace AND t.typtype='e'),"
            "'sequences',(SELECT coalesce(jsonb_object_agg(s.sequencename,jsonb_build_array(s.last_value,s.start_value,s.increment_by,s.min_value,s.max_value,s.cycle)),'{}'::jsonb) FROM pg_sequences s WHERE s.schemaname='public'),"
            "'ledger'," + ledger_sql + ","
            "'policyRoles',(SELECT coalesce(jsonb_agg(DISTINCT r.rolname ORDER BY r.rolname),'[]'::jsonb) FROM pg_policy p JOIN pg_class k ON k.oid=p.polrelid JOIN pg_namespace n ON n.oid=k.relnamespace CROSS JOIN LATERAL unnest(p.polroles) v JOIN pg_roles r ON r.oid=v WHERE n.nspname='public'),"
            "'rows'," + rows + ")")


def build_manifest(cfg, runner):
    """runner(sql) executes inside the same snapshot/session wrapper and returns stdout."""
    tables = json.loads(runner(TABLES_SQL))
    ledger = runner("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL") == 't'
    manifest = json.loads(runner(manifest_sql(tables, ledger)))
    validate_manifest(cfg, manifest)
    return manifest


def validate_manifest(cfg, value):
    need(isinstance(value, dict) and set(value) == {'version', 'tables', 'schema', 'functions', 'types', 'sequences', 'ledger', 'policyRoles', 'rows'}, 'manifest-shape')
    tables = value['tables']
    need(value['version'] == 1 and isinstance(tables, list) and tables and len(tables) <= 512 and tables == sorted(set(tables)), 'manifest-tables')
    need(all(isinstance(t, str) and IDENT.fullmatch(t) for t in tables), 'manifest-table-name')
    need(set(value['schema']) == set(tables) == set(value['rows']), 'manifest-coverage')
    need(set(cfg.sentinel_tables) <= set(tables), 'manifest-wrong-database')
    for name in tables:
        part = value['schema'][name]
        need(isinstance(part, list) and len(part) == 7 and all(isinstance(x, str) and HEX64.fullmatch(x) for x in part[:5]) and all(type(x) is bool for x in part[5:]), 'manifest-schema')
        row = value['rows'][name]
        need(isinstance(row, dict) and set(row) == {'count', 'sum'} and type(row['count']) is int and row['count'] >= 0 and re.fullmatch(r'-?\d{1,40}:-?\d{1,40}', row['sum'] or ''), 'manifest-rows')
    need(all(isinstance(value[k], dict) for k in ['functions', 'types', 'sequences']), 'manifest-parts')
    need(isinstance(value['policyRoles'], list) and all(isinstance(r, str) and IDENT.fullmatch(r) for r in value['policyRoles']), 'manifest-roles')
    ledger = value['ledger']
    need(ledger is None or (isinstance(ledger, dict) and set(ledger) == {'count', 'sha256'} and type(ledger['count']) is int and HEX64.fullmatch(ledger['sha256'])), 'manifest-ledger')
    need(len(encoded(value)) <= 4 * MIB, 'manifest-size')


def compare(expected, actual):
    """Safe classification of a mismatch: technical table names and booleans, never values."""
    names = sorted(set(expected['tables']) | set(actual['tables']))
    fields = ['columns', 'constraints', 'indexes', 'policies', 'triggers', 'rls', 'forceRls']
    schema = [{'table': n, **{f: (expected['schema'].get(n) or [None] * 7)[i] == (actual['schema'].get(n) or [None] * 7)[i] for i, f in enumerate(fields)}}
              for n in names if expected['schema'].get(n) != actual['schema'].get(n)]
    rows = [n for n in names if expected['rows'].get(n) != actual['rows'].get(n)]
    return {'tableNamesEqual': expected['tables'] == actual['tables'], 'functionsEqual': expected['functions'] == actual['functions'],
            'typesEqual': expected['types'] == actual['types'], 'sequencesEqual': expected['sequences'] == actual['sequences'],
            'ledgerEqual': expected['ledger'] == actual['ledger'], 'policyRolesEqual': expected['policyRoles'] == actual['policyRoles'],
            'schemaDifferences': schema[:64], 'rowDifferences': rows[:64]}


def equivalent(summary):
    return (all(summary[k] for k in ['tableNamesEqual', 'functionsEqual', 'typesEqual', 'sequencesEqual', 'ledgerEqual', 'policyRolesEqual'])
            and not summary['schemaDifferences'] and not summary['rowDifferences'])


# ------------------------------------------------------------------ packet, archive, retention
def packet(cfg, value):
    need(isinstance(value, dict) and set(value) == {'version', 'app', 'operation', 'archiveSha256', 'archiveBytes', 'cipherSha256', 'cipherBytes', 'dumpBytes', 'recipientDerSha256', 'createdAt'}, 'packet-shape')
    need(type(value['version']) is int and value['version'] == 1 and value['app'] == 'xmartmenu' and value['recipientDerSha256'] == cfg.recipient_sha
         and isinstance(value['operation'], str) and OPERATION.fullmatch(value['operation']), 'packet-identity')
    for key in ['archiveSha256', 'cipherSha256']:
        need(isinstance(value[key], str) and HEX64.fullmatch(value[key]), 'packet-hash')
    need(all(type(value[k]) is int for k in ['archiveBytes', 'cipherBytes', 'dumpBytes']) and 0 < value['dumpBytes'] <= cfg.max_dump_bytes
         and 0 < value['archiveBytes'] < value['cipherBytes'] <= cfg.max_cipher_bytes, 'packet-size')
    now = dt.datetime.now(dt.timezone.utc)
    try:
        created = dt.datetime.fromisoformat(value['createdAt'].replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        raise Refused('packet-time')
    need(created.tzinfo is not None and -5 <= (now - created).total_seconds() <= 900, 'packet-stale')
    return value


def restore_profile(dump_bytes):
    """(data tmpfs bytes, memory MiB) for the throwaway restore, from the dump size.

    Xmail measured ~11x the compressed dump in PGDATA; 16x with 256 MiB floor, 512 MiB ceiling. Memory also holds
    the tmpfs pages, so it is the data size plus working room; swap equals memory so the container never swaps.
    """
    data = min(512 * MIB, max(256 * MIB, 16 * dump_bytes))
    data = (data + MIB - 1) // MIB * MIB
    return data, data // MIB + 224


def retention(cfg, root, keep):
    """Keep the newest `keep` verified archives. Only the exact layout this program writes is ever deleted."""
    found = []
    for path in root.iterdir():
        if not OPERATION.fullmatch(path.name):
            continue
        guard(cfg, path, True, 0o700)
        need({p.name for p in path.iterdir()} == {'snapshot.tar.cms', 'receipt.json'}, 'retention-unknown-content')
        receipt = read_json(cfg, path / 'receipt.json')
        need(receipt.get('version') == 1 and receipt.get('app') == 'xmartmenu' and receipt.get('operation') == path.name
             and receipt.get('restoreEquivalent') is True and receipt.get('aeadVerified') is True, 'retention-unverified')
        need(digest(cfg, path / 'snapshot.tar.cms') == (receipt['cipherSha256'], receipt['cipherBytes']), 'retention-checksum')
        found.append(path)
    found.sort(key=lambda p: p.name, reverse=True)
    for path in found[keep:]:
        (path / 'snapshot.tar.cms').unlink()
        (path / 'receipt.json').unlink()
        path.rmdir()
    syncdir(root)
    return min(len(found), keep)


def remove_stage(cfg, stage, parent, allowed):
    if not os.path.lexists(stage):
        return
    guard(cfg, stage, True, 0o700)
    need({p.name for p in stage.iterdir()} <= set(allowed), 'cleanup-unknown-content')
    for p in stage.iterdir():
        guard(cfg, p, False, 0o600)
        p.unlink()
    stage.rmdir()
    syncdir(parent)


# ------------------------------------------------------------------ crypto
def recipient_fingerprint(cfg, pem):
    return sha(call(cfg, ['openssl', 'x509', '-outform', 'DER'], pem, binary=True))


def cms_algorithms(cfg, path):
    p = subprocess.Popen(['openssl', 'cms', '-cmsout', '-print', '-inform', 'DER', '-in', str(path)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    head = b''
    try:
        while len(head) < 65536 and b'encryptedContent:' not in head:
            chunk = p.stdout.read1(4096)
            if not chunk:
                break
            head += chunk
        text = head.decode('ascii', 'strict')
    finally:
        if p.poll() is None:
            p.kill()
        p.wait(timeout=5)
        p.stdout.close()
    need(re.search(r'contentType:\s+id-smime-ct-authEnvelopedData', text) and re.search(r'algorithm:\s+aes-256-gcm', text)
         and re.search(r'algorithm:\s+rsaesOaep', text) and text.count('d.ktri:') == 1, 'cms-algorithms')


def encrypt(cfg, plaintext, destination, certificate):
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0), 0o600)
    with os.fdopen(fd, 'wb') as out:
        p = subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-stream', '-outform', 'DER', '-aes-256-gcm', '-recip', str(certificate),
                            '-keyopt', 'rsa_padding_mode:oaep', '-keyopt', 'rsa_oaep_md:sha256', '-keyopt', 'rsa_mgf1_md:sha256', '-in', str(plaintext)],
                           stdout=out, stderr=subprocess.DEVNULL, timeout=120)
        need(p.returncode == 0, 'encrypt')
        out.flush()
        os.fsync(out.fileno())


def decrypt(cfg, encrypted, destination):
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0), 0o600)
    with os.fdopen(fd, 'wb') as out:
        p = subprocess.run(['openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER', '-in', str(encrypted), '-recip', str(cfg.recipient_dir / 'recipient.crt'),
                            '-inkey', str(cfg.recipient_dir / 'recipient.key')], stdout=out, stderr=subprocess.DEVNULL, timeout=120)
        need(p.returncode == 0, 'decrypt')
        out.flush()
        os.fsync(out.fileno())


# ------------------------------------------------------------------ source: backup
def check_source(cfg):
    old = inspect(cfg, cfg.pg_container)
    health = old['State'].get('Health', {}).get('Status')
    need(old['State']['Running'] is True and health in (None, 'healthy'), 'postgres-not-healthy')
    version = int(psql(cfg, cfg.pg_container, cfg.admin_user, cfg.database, 'SHOW server_version_num'))
    need(170000 <= version < 180000, 'postgres-version')
    return old


def ssh_send(cfg, header, cipher_path):
    key, known = cfg.ops / 'transport.key', cfg.ops / 'known_hosts'
    command = [cfg.ssh, '-T', '-i', str(key), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'UserKnownHostsFile=' + str(known), '-o', 'ForwardAgent=no', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15',
               '-o', 'ServerAliveCountMax=2', 'root@' + cfg.target_ip, FORCED_COMMAND]
    # header line + ciphertext as one private file, so a receiver that refuses early cannot break a pipe and hide its reason
    request = cipher_path.with_name('request.bin')
    fd = os.open(request, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0), 0o600)
    with os.fdopen(fd, 'wb') as out, cipher_path.open('rb') as data:
        out.write(encoded(header) + b'\n')
        shutil.copyfileobj(data, out, 65536)
        out.flush()
        os.fsync(out.fileno())
    try:
        with request.open('rb') as stdin:
            p = subprocess.run(command, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=480)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused('transport')
    finally:
        request.unlink()
    if p.returncode != 0:
        raise remote_failure(p.stderr[-4096:])
    need(len(p.stdout) <= 65536, 'proof-size')
    return json.loads(p.stdout)


def remote_failure(raw):
    try:
        lines = [x for x in raw.decode('utf8', 'replace').splitlines() if x.strip()]
        value = json.loads(lines[-1])
        need(isinstance(value, dict) and value.get('xmartmenuOffsiteFailed') is True, 'remote')
        step = value.get('step')
        need(isinstance(step, str) and re.fullmatch(r'[a-z0-9-]{1,64}', step), 'remote')
        state = value.get('sqlState')
        need(state is None or (isinstance(state, str) and re.fullmatch(r'[0-9A-Z]{5}', state)), 'remote')
        detail = value.get('comparison')
        if detail is not None:
            need(isinstance(detail, dict) and len(encoded(detail)) <= 8192, 'remote')
        return Refused('remote-' + step, state, detail)
    except Exception:
        return Refused('remote-unknown')


def backup(cfg, send=None, now=None):
    """Runs on the PostgreSQL host. `send(header, cipher_path) -> proof` defaults to the forced-command SSH."""
    send = send or (lambda header, cipher_path: ssh_send(cfg, header, cipher_path))
    private_dir(cfg, cfg.ops)
    held = [lock_file(cfg, cfg.ops / 'backup.lock', label='lock')]
    try:
        # Never overlap with the Xmail backup, and never start while an Xmail deploy holds its lock (a probe: held only for an instant).
        held.append(lock_file(cfg, cfg.xmail_backup_lock, optional=True, label='xmail-backup', foreign=True))
        probe = lock_file(cfg, cfg.xmail_deploy_lock, optional=True, label='xmail-deploy', foreign=True)
        release([probe])
        admit(cfg, 'source', extra_disk_bytes=0)
        old = check_source(cfg)
        for name in ['transport.key', 'known_hosts', 'recipient.crt']:
            guard(cfg, cfg.ops / name, False, 0o600)
        pem = (cfg.ops / 'recipient.crt').read_bytes()
        need(recipient_fingerprint(cfg, pem) == cfg.recipient_sha, 'recipient-pin')
        operation = 'xmartmenu-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(8)
        local = cfg.ops / 'local-archives'
        private_dir(cfg, local, True)
        stage = local / ('pending-' + operation)
        stage.mkdir(mode=0o700)
        syncdir(local)
        holder = None
        try:
            holder = subprocess.Popen([cfg.docker, 'exec', '-i', cfg.pg_container, 'psql', '-XwqAt', '-v', 'ON_ERROR_STOP=1', '-U', cfg.admin_user, '-d', cfg.database],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            holder.stdin.write(b"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL idle_in_transaction_session_timeout='300s'; SELECT pg_export_snapshot();\n")
            holder.stdin.flush()
            snapshot = holder.stdout.readline().decode().strip()
            need(re.fullmatch(r'[A-Fa-f0-9-]{8,80}', snapshot), 'snapshot')
            with (stage / 'snapshot.dump').open('xb') as out:
                p = subprocess.run([cfg.docker, 'exec', cfg.pg_container, 'pg_dump', '-U', cfg.admin_user, '-d', cfg.database, '--snapshot=' + snapshot, '--format=custom',
                                    '--compress=6', '--no-owner', '--no-acl', '--lock-wait-timeout=10000'], stdout=out, stderr=subprocess.DEVNULL, timeout=420)
                need(p.returncode == 0, 'pg-dump')
                out.flush()
                os.fsync(out.fileno())
            if os.name != 'nt':
                os.chmod(stage / 'snapshot.dump', 0o600)
            dump_sha, dump_bytes = digest(cfg, stage / 'snapshot.dump')
            need(0 < dump_bytes <= cfg.max_dump_bytes, 'dump-exceeds-restore-profile')

            def at_snapshot(sql):
                return psql(cfg, cfg.pg_container, cfg.admin_user, cfg.database, readonly_prelude(snapshot) + sql + ';ROLLBACK;', 150).splitlines()[-1] if sql else ''
            manifest = build_manifest(cfg, at_snapshot)
            write_new(stage / 'manifest.json', encoded(manifest))
            holder.stdin.write(b'COMMIT;\n\\q\n')
            holder.stdin.close()
            need(holder.wait(timeout=10) == 0, 'snapshot-close')
            holder.stdout.close()
            holder = None

            archive = stage / 'plaintext.tar'
            fd = os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0), 0o600)
            with os.fdopen(fd, 'wb') as out:
                with tarfile.open(fileobj=out, mode='w', format=tarfile.USTAR_FORMAT) as tar:
                    for name in ['snapshot.dump', 'manifest.json']:
                        info = tar.gettarinfo(str(stage / name), arcname=name)
                        info.uid = info.gid = 0
                        info.uname = info.gname = ''
                        info.mode = 0o600
                        with (stage / name).open('rb') as data:
                            tar.addfile(info, data)
                out.flush()
                os.fsync(out.fileno())
            archive_sha, archive_bytes = digest(cfg, archive)
            encrypt(cfg, archive, stage / 'snapshot.tar.cms', cfg.ops / 'recipient.crt')
            cipher_sha, cipher_bytes = digest(cfg, stage / 'snapshot.tar.cms')
            header = packet(cfg, {'version': 1, 'app': 'xmartmenu', 'operation': operation, 'archiveSha256': archive_sha, 'archiveBytes': archive_bytes,
                                  'cipherSha256': cipher_sha, 'cipherBytes': cipher_bytes, 'dumpBytes': dump_bytes, 'recipientDerSha256': cfg.recipient_sha,
                                  'createdAt': dt.datetime.now(dt.timezone.utc).isoformat()})
            proof = send(header, stage / 'snapshot.tar.cms')
            need(isinstance(proof, dict) and all(proof.get(k) == v for k, v in header.items()), 'proof-mismatch')
            need(all(proof.get(k) is True for k in ['aeadVerified', 'restoreEquivalent', 'schemaMatch', 'rowsMatch', 'temporaryRestoreRemoved']), 'proof-flags')
            need(proof.get('tables') == len(manifest['tables']) and 0 < proof.get('retainedVerifiedArchives', 0) <= cfg.keep, 'proof-counts')
            current = inspect(cfg, old['Id'])
            need(current['State']['Running'] is True and current['State']['StartedAt'] == old['State']['StartedAt'], 'postgres-changed')
            write_new(stage / 'receipt.json', encoded(proof))
            for name in ['snapshot.dump', 'manifest.json', 'plaintext.tar']:
                (stage / name).unlink()
            syncdir(stage)
            rename_new(cfg, stage, local / operation)
            syncdir(local)
            kept_local = retention(cfg, local, cfg.keep)
            # The receipt the cutover operator reads is written last: it exists only for a copy that was restored off-host.
            private_dir(cfg, cfg.receipt_dir, True)
            replace_file(cfg.receipt, encoded({'at': int(time.time()), 'sha256': archive_sha, 'restored': True, 'database': cfg.database, 'operation': operation,
                                                'cipherSha256': cipher_sha, 'archiveBytes': archive_bytes, 'tables': len(manifest['tables']), 'offsite': cfg.target_ip}))
            return {'offsiteBackupVerified': True, 'operation': operation, 'tables': len(manifest['tables']), 'restoreEquivalent': True,
                    'retainedOffsite': proof['retainedVerifiedArchives'], 'retainedLocal': kept_local, 'receiptWritten': True}
        finally:
            if holder is not None:
                try:
                    holder.stdin.write(b'ROLLBACK;\n\\q\n')
                    holder.stdin.close()
                    holder.wait(timeout=5)
                except Exception:
                    holder.kill()
                    holder.wait(timeout=5)
            remove_stage(cfg, stage, local, {'snapshot.dump', 'manifest.json', 'plaintext.tar', 'snapshot.tar.cms', 'receipt.json', 'request.bin'})
    finally:
        release(held)


# ------------------------------------------------------------------ target: receive and prove
def extract_archive(cfg, archive, stage):
    names = set()
    with tarfile.open(archive, 'r|') as tar:
        for entry in tar:
            need(entry.name in {'snapshot.dump', 'manifest.json'} and entry.name not in names and entry.isfile()
                 and 0 < entry.size <= cfg.max_dump_bytes and (entry.name != 'manifest.json' or entry.size <= 4 * MIB), 'archive-entry')
            names.add(entry.name)
            fd = os.open(stage / entry.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0), 0o600)
            with os.fdopen(fd, 'wb') as out, tar.extractfile(entry) as source:
                shutil.copyfileobj(source, out, 65536)
                out.flush()
                os.fsync(out.fileno())
    need(names == {'snapshot.dump', 'manifest.json'}, 'archive-entries')


def restore_arguments(cfg, name, operation, data_bytes, memory_mib):
    return [cfg.docker, 'run', '-d', '--pull=never', '--name', name, '--label', 'com.skale.xmartmenu-dr=' + operation, '--network', 'none', '--read-only',
            '--tmpfs', '/var/lib/postgresql/data:rw,size=' + str(data_bytes), '--tmpfs', '/var/run/postgresql:rw,size=8388608', '--tmpfs', '/tmp:rw,size=16777216',
            '--memory', str(memory_mib) + 'm', '--memory-swap', str(memory_mib) + 'm', '--cpus', '0.5', '--pids-limit', '96',
            # if the host ever runs short, the kernel picks this disposable container first, not Xmail or the app
            '--oom-score-adj', '1000', '--log-driver', 'none', '--security-opt', 'no-new-privileges', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
            cfg.pg_image, '-c', 'shared_buffers=32MB', '-c', 'work_mem=2MB', '-c', 'max_connections=5', '-c', 'fsync=off']


def restore_and_compare(cfg, stage, expected, operation, dump_bytes):
    data_bytes, memory_mib = restore_profile(dump_bytes)
    admit(cfg, 'restore', extra_mem_mib=memory_mib, extra_disk_bytes=0)
    image = inspect(cfg, cfg.pg_image)
    need(image['Id'] == cfg.pg_image or cfg.pg_image in (image.get('RepoTags') or []), 'restore-image')
    need(set(image['Config'].get('Volumes') or {}) == {'/var/lib/postgresql/data'}, 'restore-image-volumes')
    name = 'xmartmenu-dr-' + operation
    need(not call(cfg, [cfg.docker, 'ps', '-aq', '--filter', 'name=^/' + name + '$']).strip(), 'restore-name-taken')
    started = False
    try:
        call(cfg, restore_arguments(cfg, name, operation, data_bytes, memory_mib), timeout=30)
        started = True
        ready = None
        for _ in range(60):
            ready = subprocess.run([cfg.docker, 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(.5)
        need(ready is not None and ready.returncode == 0, 'restore-not-ready')
        state = inspect(cfg, name)
        host = state['HostConfig']
        need((state['NetworkSettings'].get('Networks') or {}).keys() == {'none'} and not any((state['NetworkSettings'].get('Ports') or {}).values())
             and not any(m.get('Type') in ('volume', 'bind') for m in state.get('Mounts', []))
             and host['Tmpfs'].get('/var/lib/postgresql/data') == 'rw,size=' + str(data_bytes)
             and host['Memory'] == host['MemorySwap'] == memory_mib * MIB and host['NanoCpus'] == 500000000 and host['PidsLimit'] == 96
             and host['OomScoreAdj'] == 1000 and host['ReadonlyRootfs'] is True, 'restore-limits')
        roles = ''.join('CREATE ROLE "%s" NOLOGIN;' % r for r in expected['policyRoles'])
        call(cfg, [cfg.docker, 'exec', '-i', name, 'psql', '-XwqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], (roles + 'CREATE DATABASE xmartmenu_dr;').encode())
        with (stage / 'snapshot.dump').open('rb') as data:
            p = subprocess.run([cfg.docker, 'exec', '-i', name, 'pg_restore', '-U', 'postgres', '-d', 'xmartmenu_dr', '--exit-on-error', '--single-transaction', '--no-owner', '--no-acl'],
                               stdin=data, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
        if p.returncode != 0:
            raise Refused('restore-failed', sqlstate=sqlstate_of(p.stderr))

        def run(sql):
            return psql(cfg, name, 'postgres', 'xmartmenu_dr', readonly_prelude() + sql + ';ROLLBACK;', 150).splitlines()[-1]
        actual = build_manifest(cfg, run)
        summary = compare(expected, actual)
        if not equivalent(summary):
            raise Refused('restore-mismatch', detail=summary)
    finally:
        if started:
            state = inspect(cfg, name)
            need((state['Config'].get('Labels') or {}).get('com.skale.xmartmenu-dr') == operation, 'restore-cleanup-identity')
            call(cfg, [cfg.docker, 'rm', '-f', '-v', name])
        need(not call(cfg, [cfg.docker, 'ps', '-aq', '--filter', 'name=^/' + name + '$']).strip(), 'restore-cleanup')


def receive(cfg, stdin=None, environ=None):
    """Runs on the target through the forced command. Returns the proof dictionary."""
    stdin = stdin or sys.stdin.buffer
    environ = os.environ if environ is None else environ
    if cfg.production:
        peer = environ.get('SSH_CONNECTION', '').split()
        need(peer[0:1] == [cfg.source_ip] and peer[2:3] == [cfg.target_ip] and environ.get('SSH_ORIGINAL_COMMAND') == FORCED_COMMAND, 'peer')
    raw = stdin.readline(32769)
    need(len(raw) <= 32768 and raw.endswith(b'\n'), 'header')
    value = packet(cfg, json.loads(raw))
    private_dir(cfg, cfg.ops)
    private_dir(cfg, cfg.base / 'offsite-backups', True)
    private_dir(cfg, cfg.archives, True)
    held = [lock_file(cfg, cfg.ops / 'receiver.lock', label='lock'),
            lock_file(cfg, cfg.xmail_receiver_lock, optional=True, label='xmail-receiver', foreign=True)]
    stage = None
    try:
        # Another disposable Xmail restore may be running without holding that lock (older invocation): refuse rather than add to the load.
        need(not call(cfg, [cfg.docker, 'ps', '-q', '--filter', 'name=xmail-dr-']).strip(), 'xmail-restore-running')
        _, profile_memory = restore_profile(value['dumpBytes'])
        admit(cfg, 'target', extra_mem_mib=profile_memory, extra_disk_bytes=max(1024 ** 3, 3 * value['cipherBytes'] + 256 * MIB))
        guard(cfg, cfg.recipient_dir / 'recipient.crt', False, 0o600)
        guard(cfg, cfg.recipient_dir / 'recipient.key', False, 0o600)
        need(recipient_fingerprint(cfg, (cfg.recipient_dir / 'recipient.crt').read_bytes()) == cfg.recipient_sha, 'recipient-pin')
        destination = cfg.archives / value['operation']
        need(not os.path.lexists(destination), 'archive-exists')
        stage = cfg.archives / ('staging-' + value['operation'])
        stage.mkdir(mode=0o700)
        syncdir(cfg.archives)
        encrypted = stage / 'snapshot.tar.cms'
        h, count = hashlib.sha256(), 0
        fd = os.open(encrypted, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0), 0o600)
        with os.fdopen(fd, 'wb') as out:
            for chunk in iter(lambda: stdin.read(65536), b''):
                count += len(chunk)
                need(count <= value['cipherBytes'], 'cipher-size')
                h.update(chunk)
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        need((h.hexdigest(), count) == (value['cipherSha256'], value['cipherBytes']), 'cipher-checksum')
        cms_algorithms(cfg, encrypted)
        archive = stage / 'plaintext.tar'
        decrypt(cfg, encrypted, archive)  # authenticated: a bad tag makes openssl fail before this returns
        need(digest(cfg, archive) == (value['archiveSha256'], value['archiveBytes']), 'archive-checksum')
        extract_archive(cfg, archive, stage)
        need(digest(cfg, stage / 'snapshot.dump')[1] == value['dumpBytes'], 'dump-size')
        expected = read_json_big(cfg, stage / 'manifest.json')
        validate_manifest(cfg, expected)
        restore_and_compare(cfg, stage, expected, value['operation'], value['dumpBytes'])
        for name in ['plaintext.tar', 'snapshot.dump', 'manifest.json']:
            (stage / name).unlink()
        proof = {**value, 'aeadVerified': True, 'restoreEquivalent': True, 'schemaMatch': True, 'rowsMatch': True, 'tables': len(expected['tables']),
                 'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'temporaryRestoreRemoved': True}
        write_new(stage / 'receipt.json', encoded(proof))
        syncdir(stage)
        rename_new(cfg, stage, destination)
        stage = None
        syncdir(cfg.archives)
        return {**proof, 'retainedVerifiedArchives': retention(cfg, cfg.archives, cfg.keep)}
    finally:
        try:
            if stage is not None:
                remove_stage(cfg, stage, cfg.archives, {'snapshot.tar.cms', 'plaintext.tar', 'snapshot.dump', 'manifest.json', 'receipt.json'})
        finally:
            release(held)


def read_json_big(cfg, path):
    info = guard(cfg, path, False, 0o600)
    need(info.st_size <= 4 * MIB, 'json-size')
    return json.loads(path.read_bytes())


# ------------------------------------------------------------------ entry point
def failure_location(error):
    me = Path(__file__).name
    return [{'function': f.name, 'line': f.lineno} for f in traceback.extract_tb(error.__traceback__)[-6:] if Path(f.filename).name == me]


def failure_payload(error):
    value = {'xmartmenuOffsiteFailed': True, 'step': error.label if isinstance(error, Refused) and re.fullmatch(r'[a-z0-9-]{1,64}', error.label) else 'unexpected',
             'location': failure_location(error)}
    if isinstance(error, Refused):
        if isinstance(error.sqlstate, str) and re.fullmatch(r'[0-9A-Z]{5}', error.sqlstate):
            value['sqlState'] = error.sqlstate
        if isinstance(error.detail, dict):
            value['comparison'] = error.detail
    return value


def main(argv=None, cfg=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group()
    g.add_argument('--plan', action='store_true')
    g.add_argument('--backup', action='store_true')
    g.add_argument('--receive', action='store_true')
    args = p.parse_args(argv)
    if not (args.backup or args.receive):
        print('PLAN ONLY: Xmartmenu off-host backup (pg_dump of xmartmenu, CMS-encrypted, restore proof on the target, last 7, receipt latest.json); no I/O, backup, transport or host change.')
        return 0
    cfg = cfg or Config()
    need(sys.platform.startswith('linux') and os.geteuid() == 0, 'root-linux')
    os.umask(0o077)
    import signal
    import resource

    def deadline(_signal, _frame):
        raise Refused('deadline')
    for number in (signal.SIGALRM, signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, deadline)
    resource.setrlimit(resource.RLIMIT_FSIZE, (cfg.max_cipher_bytes + 4 * MIB,) * 2)
    signal.alarm(600)
    try:
        print(json.dumps(receive(cfg) if args.receive else backup(cfg)))
    finally:
        signal.alarm(0)
    return 0


if __name__ == '__main__':
    try:
        code = main()
    except BaseException as error:
        print(json.dumps(failure_payload(error)), file=sys.stderr)
        sys.exit(1)
    sys.exit(code)
