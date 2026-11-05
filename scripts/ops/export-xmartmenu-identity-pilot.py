#!/usr/bin/python3 -I
"""Private candidate export for the isolated pilot. No operation without explicit review."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import time

sys.dont_write_bytecode = True
HELPER = Path(__file__).with_name('backup-xmartmenu-identity-candidate.py')
HELPER_SHA = 'cc9b692f82daee9d0862e8f1367b7060c36c289f0f8323ac2ff462fa9c3bf255'
QUERY_SHA = 'c6927942f87978706e123b36e827119eb5716973f0d93b3666ec8bbd17cc0f6c'
ROOT = Path('/opt/xmartmenu/backups')
MAXIMUM = 32 * 1024 * 1024


def require(value):
    if not value:
        raise ValueError('Isolated pilot export refused')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def check_snapshot(value):
    require(isinstance(value, dict) and set(value) == {'business', 'tables', 'ledgerCount', 'ledgerLatest', 'ledgerDigest', 'identity', 'disabled', 'profilesHash', 'accountsHash'})
    business = value['business']
    require(isinstance(business, dict) and business.get('publicTableCount') == 47 and business.get('authIdCount') == 7
            and business.get('ledgerCount') == 92 and business.get('ledgerLatest') == '20261027097000'
            and len(business.get('digests', {})) == 47 and business.get('roles') == {'superadmin': 1, 'store-admin': 3, 'customer': 3})
    identity = value['identity']
    require(isinstance(identity, dict) and set(identity) == {'app_accounts', 'app_identity_bindings', 'app_sessions', 'app_identity_challenges'}
            and len(value['tables']) == 51 and len(set(value['tables'])) == 51 and value['ledgerCount'] == 95
            and value['ledgerLatest'] == '20261103210000' and value['disabled'] == 1)
    for name, row in identity.items():
        require(isinstance(row, dict) and set(row) == {'count', 'digest'} and row['count'] == (7 if name == 'app_accounts' else 0)
                and isinstance(row['digest'], str) and re.fullmatch('[a-f0-9]{64}', row['digest']))
    for field in ['ledgerDigest', 'profilesHash', 'accountsHash']:
        require(isinstance(value[field], str) and re.fullmatch('[a-f0-9]{64}', value[field]))
    return value


def read_snapshot(helper, query):
    raw = helper.sql("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout=8000; SET LOCAL lock_timeout=500;"
                     "SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex';\n"
                     + query + ';\nROLLBACK;')
    return check_snapshot(json.loads(raw))


def source_state(helper):
    value = json.loads(helper.sql("BEGIN READ ONLY; SELECT json_build_object('oid',d.oid,'owner',pg_get_userbyid(d.datdba),"
        "'runtime',EXISTS(SELECT FROM pg_authid WHERE rolname='xmartmenu_runtime' AND NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=12),"
        "'reader',EXISTS(SELECT FROM pg_authid WHERE rolname='xmartmenu_staging_reader' AND NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=2),"
        "'otherSessions',(SELECT count(*) FROM pg_stat_activity WHERE datid=d.oid AND pid<>pg_backend_pid()))"
        " FROM pg_database d WHERE datname=current_database(); ROLLBACK;"))
    require(value == {'oid': 30227, 'owner': 'xmartmenu_owner', 'runtime': True, 'reader': True, 'otherSessions': 0})
    return value


def capacity_guard(value):
    require(value['available'] >= 1024 * 1024**2 and value['disk'] >= 512 * 1024**2
            and value['some'] <= .10 and value['full'] <= .05 and value['idle'] >= .50
            and value['swapOutDelta'] == 0 and value['pgCurrent'] <= 448 * 1024**2)
    return value


def admission(helper):
    metadata = helper._transport.inspected(helper._transport.TARGET)
    _, pid, _ = helper._transport.snapshot_guard(metadata)
    memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    psi = {line.split()[0]: float(dict(item.split('=') for item in line.split()[1:])['avg60']) for line in Path('/proc/pressure/memory').read_text().splitlines()}
    group = Path('/sys/fs/cgroup') / Path(f'/proc/{pid}/cgroup').read_text().strip().split(':')[-1].lstrip('/')
    events = dict((key, int(value)) for key, value in (line.split() for line in (group / 'memory.events').read_text().splitlines()))
    cpu = lambda: [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    swap = lambda: int(dict(line.split() for line in Path('/proc/vmstat').read_text().splitlines())['pswpout'])
    before, swap_before = cpu(), swap()
    time.sleep(1)
    after = cpu()
    total = sum(b - a for a, b in zip(before, after))
    require(total > 0)
    disk = os.statvfs(ROOT)
    capacity_guard({'available': int(memory['MemAvailable'].split()[0]) * 1024, 'disk': disk.f_bavail * disk.f_frsize,
                    'some': psi['some'], 'full': psi['full'], 'idle': (after[3] - before[3]) / total,
                    'swapOutDelta': swap() - swap_before, 'pgCurrent': int((group / 'memory.current').read_text())})
    return {'pid': pid, 'group': str(group), 'events': events}


def run(expected, packet):
    import fcntl
    require(os.getuid() == 0 and Path('/etc/hostname').read_text().strip() == 'skaleclub-mail')
    require(re.fullmatch('[a-f0-9]{64}', expected or '') and digest(Path(__file__).read_bytes()) == expected)
    require(isinstance(packet, dict) and set(packet) == {'snapshotSql', 'expectedSnapshotSha256'})
    query = packet['snapshotSql']
    require(isinstance(query, str) and len(query.encode()) <= 32768 and digest(query.encode()) == QUERY_SHA)
    require(isinstance(packet['expectedSnapshotSha256'], str) and re.fullmatch('[a-f0-9]{64}', packet['expectedSnapshotSha256']))
    metadata = HELPER.lstat()
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1 and not metadata.st_mode & 0o022
            and digest(HELPER.read_bytes()) == HELPER_SHA)
    spec = importlib.util.spec_from_file_location('reviewed_pilot_backup', HELPER)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    helper.host_guard(HELPER_SHA)
    lock = os.open(ROOT / 'identity-backup.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Current pressure and event deltas; historical counters are never reset or required to be zero.
        before = admission(helper)
        source_state(helper)
        baseline = read_snapshot(helper, query)
        raw_snapshot = json.dumps(baseline, sort_keys=True, separators=(',', ':')).encode()
        require(digest(raw_snapshot) == packet['expectedSnapshotSha256'])
        archive = helper.command('pg_dump', ['-w', '-U', 'xmail_owner', '--format=custom', '--no-owner', '--no-acl', '--lock-wait-timeout=2s',
            '--schema=public', '--schema=auth', '--schema=supabase_migrations', 'xmartmenu'])
        require(archive.startswith(b'PGDMP') and 0 < len(archive) <= MAXIMUM)
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key, iv = secrets.token_bytes(32), secrets.token_bytes(12)
        encrypted = helper.encrypt(archive, key, iv, AESGCM)
        require(digest(helper.decrypt(encrypted, key, AESGCM)) == digest(archive))
        archive = b''
        require(read_snapshot(helper, query) == baseline)
        source_state(helper)
        after = admission(helper)
        require(after == before)
        folder = ROOT / ('pilot-export-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + secrets.token_hex(8))
        folder.mkdir(mode=0o700)
        helper.write_new(folder / 'archive.gcm', encrypted)
        helper.write_new(folder / 'archive.key', key.hex().encode() + b'\n')
        helper.write_new(folder / 'snapshot.json', raw_snapshot)
        receipt = {'sourceOid': 30227, 'publicTables': 51, 'businessTables': 47, 'ledgerRows': 95, 'accounts': 7,
                   'sourceCandidateUnchanged': True, 'sourceRolesDormant': True, 'archiveAuthenticated': True,
                   'archiveSha256': digest(encrypted), 'snapshotSha256': digest(raw_snapshot), 'snapshotQuerySha256': QUERY_SHA,
                   'encryptedDirectory': str(folder), 'restoreProven': False, 'pilotStarted': False, 'applicationCutover': False}
        helper.write_new(folder / 'receipt.json', json.dumps(receipt, sort_keys=True).encode())
        helper.durable_directory(folder)
        helper.durable_directory(ROOT)
        return receipt
    finally:
        os.close(lock)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--export-reviewed', action='store_true')
    parser.add_argument('--expected-operator-sha256')
    args = parser.parse_args()
    if not args.export_reviewed:
        print('PLAN ONLY: encrypted fixed candidate51/95/7 export; no restore, role, Source, service or flag mutation.')
        return
    require(not sys.stdin.isatty())
    raw = sys.stdin.buffer.read(32769)
    require(len(raw) <= 32768)
    print(json.dumps(run(args.expected_operator_sha256, json.loads(raw)), sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Isolated pilot export refused; inspect private artifacts before any retry.', file=sys.stderr)
        sys.exit(1)
