#!/usr/bin/python3 -I
"""One reviewed foundation transaction, fixed candidate and backup; default plan."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

sys.dont_write_bytecode = True
BACKUP_SOURCE_SHA = 'cc9b692f82daee9d0862e8f1367b7060c36c289f0f8323ac2ff462fa9c3bf255'
COMPILER_SHA = '76e7be15ab5f5e5fa713e9a158c193072559e175b3223795e581aa04c1deeec6'
PRELUDE_SHA = 'a5453557b08928c83cadb24fea9e074751ec6204409d4ea5f59e7cd39d2c77d7'
PRESERVED_QUERY_SHA = '582e959d30f127ce0d518b8b6428be3a9a40ccaea6a4936d538b28036c42e41b'
BACKUP = Path('/opt/xmartmenu/backups/identity-20261104T161702Z-3a8d70dc23a3989e')
ARCHIVE_SHA = '95df4fedb8fb3a5e38590c4a08533bfe04f20daaec92392a8ec14358b327fd0c'
MANIFEST_SHA = 'a71caedb653ad18358861ed280a885b25f784d937d0b382925f91f886b4d887d'
DATABASE_OID = '30227'
SOURCE_PROJECT = 'ktogbpqookfcqilqvici'
MAXIMUM = 256 * 1024
MIGRATIONS = {
    '20261103190000': '9f0e4a498409c7c9d08752f1841384deafd9bc24008bbfcb950a6a972a7ada25',
    '20261103200000': '9f05416e0a01fbd8d952804d13a7e288013611274779ede9d4090da078912480',
    '20261103210000': 'afc546ea90481d093c96bccfc785e600a21b72bae2565c23945b5d54373142d0',
}


def require(value):
    if not value:
        raise ValueError('Identity foundation operation refused')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def validate_review(value, baseline, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    fields = {'version', 'sourceProject', 'capturedAt', 'profilesDigest', 'authorityDigest', 'authIdsDigest', 'users', 'readOnlySnapshot'}
    require(isinstance(value, dict) and set(value) == fields and type(value['version']) is int and value['version'] == 1
            and value['sourceProject'] == SOURCE_PROJECT and value['readOnlySnapshot'] is True
            and isinstance(value['capturedAt'], str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z', value['capturedAt']))
    captured = dt.datetime.fromisoformat(value['capturedAt'].replace('Z', '+00:00'))
    require(-5 <= (now - captured).total_seconds() <= 300
            and value['profilesDigest'] == baseline['digests']['profiles']
            and value['authorityDigest'] == baseline['criticalDigests']['profile_authority']
            and value['authIdsDigest'] == baseline['criticalDigests']['auth_ids']
            and isinstance(value['users'], list) and len(value['users']) == 7)
    ids = set()
    for row in value['users']:
        require(isinstance(row, dict) and set(row) == {'id', 'disabled'} and type(row['disabled']) is bool
                and isinstance(row['id'], str) and re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', row['id'])
                and row['id'] not in ids)
        ids.add(row['id'])
    return int(captured.timestamp())


def checked_source(path, expected):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
            and re.fullmatch('[a-f0-9]{64}', expected or '') and digest(path.read_bytes()) == expected)


def load_backup_operator(expected):
    require(os.getuid() == 0 and Path('/etc/hostname').read_text().strip() == 'skaleclub-mail')
    checked_source(Path(__file__), expected)
    parent = Path(__file__).parent
    info = parent.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700)
    source = parent / 'backup-xmartmenu-identity-candidate.py'
    checked_source(source, BACKUP_SOURCE_SHA)
    spec = importlib.util.spec_from_file_location('pinned_identity_backup', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.host_guard(BACKUP_SOURCE_SHA)
    return module


def backup_proof(module):
    module.checked(BACKUP, directory=True)
    require(stat.S_IMODE(BACKUP.stat().st_mode) == 0o700)
    for name in ['archive.gcm', 'manifest.json', 'proof.json', 'temporary-database.json', 'archive.key']:
        info = module.checked(BACKUP / name)
        require(info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o400)
        if name == 'archive.key':
            require(info.st_size == 65)  # Producer writes 64 hex bytes + LF; metadata only.
    require(digest((BACKUP / 'archive.gcm').read_bytes()) == ARCHIVE_SHA
            and digest((BACKUP / 'manifest.json').read_bytes()) == MANIFEST_SHA)
    # Never read or transmit archive.key. Its authentication/restore was reviewed
    # separately; this caller admits only that exact durable proof and data hash.
    proof = json.loads((BACKUP / 'proof.json').read_bytes())
    require(proof['backupAuthenticated'] is True and proof['restoreMatchedTables'] == 47
            and proof['originalLedgerRows'] == 92 and proof['temporaryDatabaseRemoved'] is True
            and proof['foundationApplied'] is False and proof['archiveSha256'] == ARCHIVE_SHA
            and proof['manifestSha256'] == MANIFEST_SHA)
    marker = json.loads((BACKUP / 'temporary-database.json').read_bytes())
    require(re.fullmatch('xmartmenu_identity_restore_[a-f0-9]{16}', marker['name'])
            and module.sql("BEGIN READ ONLY;SELECT count(*) FROM pg_database WHERE datname='" + marker['name'] + "';ROLLBACK;") == b'0')
    return json.loads((BACKUP / 'manifest.json').read_bytes())


def role_state(module):
    return json.loads(module.sql("BEGIN READ ONLY; SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY rolname) FROM pg_roles r; ROLLBACK;"))


def postcheck(module, review, baseline, preserved_query, roles):
    require(module.manifest(preserved_query) == baseline and role_state(module) == roles)
    result = json.loads(module.sql("""BEGIN READ ONLY; SET LOCAL timezone='UTC';
SELECT json_build_object(
 'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'owner',(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
 'tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
 'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'migrations',(SELECT jsonb_object_agg(version,encode(sha256(convert_to(statements[1],'UTF8')),'hex')) FROM supabase_migrations.schema_migrations WHERE version IN ('20261103190000','20261103200000','20261103210000') AND cardinality(statements)=1),
 'accounts',(SELECT json_agg(json_build_object('id',id,'disabledAt',extract(epoch from disabled_at)::bigint,'sessionVersion',session_version) ORDER BY id) FROM public.app_accounts),
 'bindings',(SELECT count(*) FROM public.app_identity_bindings), 'sessions',(SELECT count(*) FROM public.app_sessions),
 'challenges',(SELECT count(*) FROM public.app_identity_challenges),
 'dormant',(SELECT count(*) FROM pg_authid WHERE rolname IN ('xmartmenu_owner','xmartmenu_runtime','xmartmenu_staging_reader') AND NOT rolcanlogin AND rolpassword IS NULL),
 'activeNativeSessions',(SELECT count(*) FROM pg_stat_activity WHERE usename IN ('xmartmenu_runtime','xmartmenu_staging_reader')),
 'ownedRls',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('app_accounts','app_identity_bindings','app_sessions','app_identity_challenges') AND c.relrowsecurity AND pg_get_userbyid(c.relowner)='xmartmenu_owner'));
ROLLBACK;"""))
    # Freshness was enforced before apply and again inside the transaction.
    # Crossing the five-minute boundary after COMMIT must not misreport a good
    # committed state as a failed operation.
    captured = int(dt.datetime.fromisoformat(review['capturedAt'].replace('Z', '+00:00')).timestamp())
    expected = sorted([{'id': row['id'], 'disabledAt': captured if row['disabled'] else None, 'sessionVersion': 0} for row in review['users']], key=lambda row: row['id'])
    require(result == {'oid': DATABASE_OID, 'owner': 'xmartmenu_owner', 'tables': 51, 'ledger': 95,
                       'migrations': MIGRATIONS, 'accounts': expected, 'bindings': 0, 'sessions': 0,
                       'challenges': 0, 'dormant': 3, 'activeNativeSessions': 0, 'ownedRls': 4})
    return {'foundationApplied': True, 'businessTableDigestsMatched': 47, 'originalLedgerRowsPreserved': 92,
            'publicTables': 51, 'ledgerRows': 95, 'accounts': 7, 'disabledAccounts': sum(row['disabled'] for row in review['users']),
            'bindings': 0, 'sessions': 0, 'challenges': 0, 'rolesUnchangedNoLogin': True,
            'backupPreserved': True, 'runtimeLoginEnabled': False, 'applicationCutover': False}


def execute(expected_operator, expected_sql, packet):
    module = load_backup_operator(expected_operator)
    require(isinstance(packet, dict) and set(packet) == {'compilerSha256', 'manifestSql', 'preservedManifestSql', 'review', 'publicPrelude', 'privateSql'}
            and packet['compilerSha256'] == COMPILER_SHA
            and digest(packet['manifestSql'].encode()) == module.QUERY_SHA
            and digest(packet['preservedManifestSql'].encode()) == PRESERVED_QUERY_SHA
            and digest(packet['publicPrelude'].encode()) == PRELUDE_SHA
            and re.fullmatch('[a-f0-9]{64}', expected_sql or '') and digest(packet['privateSql'].encode()) == expected_sql
            and packet['privateSql'].endswith('COMMIT;\n'))
    import fcntl
    lock = os.open(module.ROOT / 'identity-backup.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600)
        baseline = backup_proof(module)
        validate_review(packet['review'], baseline)
        admitted = module.admission()
        require(str(admitted['databaseOid']) == DATABASE_OID and module.manifest(packet['manifestSql']) == baseline)
        roles = role_state(module)
        # psql reads each semicolon-terminated public prelude statement first.
        # Private SQL stays in this pipe, never argv/env/file/stdout/stderr.
        module.sql(packet['publicPrelude'] + packet['privateSql'])
        return postcheck(module, packet['review'], baseline, packet['preservedManifestSql'], roles)
    finally:
        os.close(lock)  # No automatic retry, cleanup SQL or rollback after uncertainty.


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--apply-reviewed-foundation', action='store_true')
    modes.add_argument('--plan', action='store_true')
    parser.add_argument('--expected-operator-sha256')
    parser.add_argument('--expected-private-sql-sha256')
    args = parser.parse_args()
    if not args.apply_reviewed_foundation:
        print(json.dumps({'plan': 'PLAN ONLY: fixed candidate foundation from reviewed private stdin and exact fresh backup; no source/login/flags/provider action'}))
        return
    require(not sys.stdin.isatty() and not sys.stdout.isatty())
    raw = sys.stdin.buffer.read(MAXIMUM + 1)
    require(len(raw) <= MAXIMUM)
    print(json.dumps(execute(args.expected_operator_sha256, args.expected_private_sql_sha256, json.loads(raw)), sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Identity foundation failed or commit acknowledgement unknown; inspect privately before any retry', file=sys.stderr)
        sys.exit(1)
