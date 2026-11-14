#!/usr/bin/python3 -I
"""Fresh encrypted candidate backup/rehearsal; offline unless explicitly reviewed."""
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
import subprocess
import sys
import time

sys.dont_write_bytecode = True
WRAPPER = Path('/usr/local/libexec/xmartmenu-pg-stdio.py')
WRAPPER_SHA = '3ceff767ed9b062b52c2c1784769dd0b10e29e5494ef081a79a536fed1727a5f'
QUERY_SHA = '02a027f4f79ce1afdcd1d5212fdec1b38781d5766478faaede28270209dd1fb1'
ROOT = Path('/opt/xmartmenu/backups')
DATABASE = 'xmartmenu'
MAXIMUM = 32 * 1024 * 1024
MAGIC = b'XMRH0001'
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
_transport = None


def require(condition):
    if not condition:
        raise ValueError('Candidate backup/rehearsal refused')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def checked(path, directory=False):
    value = path.lstat()
    require((stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode))
            and value.st_uid == 0 and not value.st_mode & 0o022)
    return value


def write_new(path, raw, mode=0o400):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())


def durable_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def target():
    require(_transport is not None)
    return _transport.snapshot_guard(_transport.inspected(_transport.TARGET))[0]


def command(binary, args, data=None, maximum=MAXIMUM, timeout=45):
    # Every exec resolves/revalidates the exact immutable PG container first.
    result = subprocess.run([*_transport.DOCKER, 'exec', '-i', '-u', 'postgres', target(), binary, *args],
                            input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env=ENV, timeout=timeout)
    require(result.returncode == 0 and len(result.stdout) <= maximum and len(result.stderr) <= 65536)
    return result.stdout


def sql(query, database=DATABASE):
    require(database == DATABASE or re.fullmatch(r'xmartmenu_identity_restore_[a-f0-9]{16}', database))
    return command('psql', ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'xmail_owner', '-d', database],
                   query.encode(), maximum=1024 * 1024, timeout=20).strip()


def manifest(query, database=DATABASE):
    value = json.loads(sql("BEGIN READ ONLY; SET LOCAL statement_timeout=8000; SET LOCAL lock_timeout=500; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex';\n" + query + ';\nROLLBACK;', database))
    require(value.get('publicTableCount') == 47 and value.get('authIdCount') == 7
            and value.get('ledgerCount') == 92 and value.get('ledgerLatest') == '20261027097000'
            and value.get('orphanProfiles') == 0 and value.get('authWithoutProfile') == 0
            and value.get('sequenceCount') == 2 and len(value.get('digests', {})) == 47
            and value.get('roles') == {'superadmin': 1, 'store-admin': 3, 'customer': 3})
    return value


def host_guard(expected):
    global _transport
    require(os.getuid() == 0 and Path('/etc/hostname').read_text().strip() == 'skaleclub-mail')
    checked(Path(__file__))
    require(re.fullmatch('[a-f0-9]{64}', expected or '') and digest(Path(__file__).read_bytes()) == expected)
    checked(WRAPPER)
    require(digest(WRAPPER.read_bytes()) == WRAPPER_SHA)
    checked(Path('/opt'), directory=True)
    checked(Path('/opt/xmartmenu'), directory=True)
    checked(ROOT, directory=True)
    require(stat.S_IMODE(ROOT.stat().st_mode) == 0o700)
    spec = importlib.util.spec_from_file_location('identity_backup_transport', WRAPPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _transport = module
    target()


def admission():
    metadata = _transport.inspected(_transport.TARGET)
    _transport.snapshot_guard(metadata)
    memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    require(int(memory['MemAvailable'].split()[0]) >= 1572864)
    require(int(memory['SwapTotal'].split()[0]) - int(memory['SwapFree'].split()[0]) <= 524288)
    cpu_before = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    swap_before = dict(line.split() for line in Path('/proc/vmstat').read_text().splitlines())['pswpout']
    time.sleep(1)
    cpu_after = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    swap_after = dict(line.split() for line in Path('/proc/vmstat').read_text().splitlines())['pswpout']
    total = sum(cpu_after) - sum(cpu_before)
    require(total > 0 and (cpu_after[3] - cpu_before[3]) / total >= 0.50 and swap_before == swap_after)
    for path in [ROOT, Path('/var/lib/docker')]:
        disk = os.statvfs(path)
        require(disk.f_bavail * disk.f_frsize >= 3 * 1024**3)
    for line in Path('/proc/pressure/memory').read_text().splitlines():
        values = dict(item.split('=') for item in line.split()[1:])
        require(float(values['avg60']) <= (0.10 if line.startswith('some ') else 0.05))
    pid = metadata['State']['Pid']
    group = Path('/sys/fs/cgroup') / Path(f'/proc/{pid}/cgroup').read_text().strip().split(':')[-1].lstrip('/')
    current = int((group / 'memory.current').read_text())
    events = dict((key, int(value)) for key, value in (line.split() for line in (group / 'memory.events').read_text().splitlines()))
    require(current <= 288 * 1024**2 and events.get('oom', 0) == 0 and events.get('oom_kill', 0) == 0)
    # Peak/max are historical counters: record/compare, never reset or require zero.
    state = json.loads(sql("BEGIN READ ONLY; SET LOCAL statement_timeout=5000; SELECT json_build_object("
        "'owner',pg_get_userbyid(d.datdba),'size',pg_database_size(d.oid),'oid',d.oid,'provider',d.datlocprovider,"
        "'locale',to_jsonb(d)->>'datlocale','recorded',d.datcollversion,'actual',pg_database_collation_actual_version(d.oid),"
        "'runtime',EXISTS(SELECT FROM pg_authid WHERE rolname='xmartmenu_runtime' AND NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=12),"
        "'reader',EXISTS(SELECT FROM pg_authid WHERE rolname='xmartmenu_staging_reader' AND NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=2),"
        "'ownSessions',(SELECT count(*) FROM pg_stat_activity WHERE usename IN ('xmartmenu_runtime','xmartmenu_staging_reader'))) "
        "FROM pg_database d WHERE d.datname=current_database(); ROLLBACK;"))
    require(state['owner'] == 'xmartmenu_owner' and state['size'] <= 64 * 1024**2
            and state['provider'] == 'i' and state['locale'] == 'en-US' and state['recorded'] == state['actual'] == '153.136'
            and state['runtime'] is True and state['reader'] is True and state['ownSessions'] == 0)
    return {'databaseOid': state['oid'], 'events': events, 'group': group}


def encrypt(raw, key, iv, aes):
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAXIMUM and len(key) == 32 and len(iv) == 12)
    return MAGIC + iv + aes(key).encrypt(iv, raw, None)


def decrypt(raw, key, aes):
    require(isinstance(raw, bytes) and 36 < len(raw) <= MAXIMUM + 36 and raw[:8] == MAGIC and len(key) == 32)
    return aes(key).decrypt(raw[8:20], raw[20:], None)


def run(expected, query):
    host_guard(expected)
    require(isinstance(query, str) and len(query) < 32768 and digest(query.encode()) == QUERY_SHA)
    import fcntl
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    lock = os.open(ROOT / 'identity-backup.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = admission()
        baseline = manifest(query)
        nonce = secrets.token_hex(8)
        restore_db = 'xmartmenu_identity_restore_' + nonce
        folder = ROOT / ('identity-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + nonce)
        folder.mkdir(mode=0o700)
        archive = command('pg_dump', ['-w', '-U', 'xmail_owner', '--format=custom', '--lock-wait-timeout=2s',
                                    '--schema=public', '--schema=auth', '--schema=supabase_migrations', DATABASE])
        require(archive.startswith(b'PGDMP') and 0 < len(archive) <= MAXIMUM)
        key, iv = secrets.token_bytes(32), secrets.token_bytes(12)
        encrypted = encrypt(archive, key, iv, AESGCM)
        write_new(folder / 'archive.gcm', encrypted)
        write_new(folder / 'archive.key', key.hex().encode() + b'\n')
        write_new(folder / 'manifest.json', json.dumps(baseline, sort_keys=True).encode())
        write_new(folder / 'archive.sha256', (digest(encrypted) + '  archive.gcm\n').encode())
        durable_directory(folder); durable_directory(ROOT)
        # Authenticate disk bytes before any recovery SQL or plaintext restore.
        disk = (folder / 'archive.gcm').read_bytes()
        require(digest(disk) == digest(encrypted))
        restored = decrypt(disk, bytes.fromhex((folder / 'archive.key').read_text().strip()), AESGCM)
        require(digest(restored) == digest(archive))
        archive = b''
        toc = command('pg_restore', ['--list'], restored, maximum=1024 * 1024).decode()
        public_schema = re.findall(r'^\d+; \d+ \d+ SCHEMA - public .*$', toc, re.MULTILINE)
        require(len(public_schema) <= 1)
        # Refuse existing target; no DROP/IF EXISTS/retry on creation failure.
        require(sql(f"BEGIN READ ONLY; SELECT count(*) FROM pg_database WHERE datname='{restore_db}'; ROLLBACK;") == b'0')
        sql(f"CREATE DATABASE {restore_db} OWNER xmartmenu_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US';")
        marker = json.loads(sql("BEGIN READ ONLY; SELECT json_build_object('oid',oid,'owner',pg_get_userbyid(datdba)) FROM pg_database WHERE datname=current_database(); ROLLBACK;", restore_db))
        require(marker['owner'] == 'xmartmenu_owner')
        write_new(folder / 'temporary-database.json', json.dumps({'name': restore_db, **marker}).encode())
        durable_directory(folder)
        if public_schema:
            sql('DROP SCHEMA public;', restore_db)  # Newly owned empty DB only; no CASCADE.
        command('pg_restore', ['-w', '-U', 'xmail_owner', '--exit-on-error', '--single-transaction', '-d', restore_db], restored)
        restored = b''; key = b''
        require(manifest(query, restore_db) == baseline and manifest(query) == baseline)
        after = admission()
        require(after['databaseOid'] == before['databaseOid'] and after['events'] == before['events'])
        # Drop only the exact newly created/OID-pinned/owner-pinned temporary DB.
        check = json.loads(sql("BEGIN READ ONLY; SELECT json_build_object('oid',oid,'owner',pg_get_userbyid(datdba)) FROM pg_database WHERE datname=current_database(); ROLLBACK;", restore_db))
        require(check == marker)
        sql(f'DROP DATABASE {restore_db};')
        require(sql(f"BEGIN READ ONLY; SELECT count(*) FROM pg_database WHERE datname='{restore_db}'; ROLLBACK;") == b'0')
        proof = {'backupAuthenticated': True, 'restoreMatchedTables': 47, 'originalLedgerRows': 92,
                 'temporaryDatabaseRemoved': True, 'applicationDataChanged': False,
                 'runtimeLoginEnabled': False, 'foundationApplied': False, 'archiveSha256': digest(encrypted),
                 'manifestSha256': digest(json.dumps(baseline, sort_keys=True).encode()), 'backupDirectory': str(folder)}
        write_new(folder / 'proof.json', json.dumps(proof, sort_keys=True).encode())
        durable_directory(folder); durable_directory(ROOT)
        return proof
    finally:
        # Unknown failures preserve archive/key/receipt and any temporary DB for
        # reviewed diagnosis. Never clean a persistent candidate or retry DDL.
        os.close(lock)


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--backup-rehearse-reviewed', action='store_true')
    parser.add_argument('--expected-operator-sha256')
    mode.add_argument('--plan', action='store_true')
    args = parser.parse_args()
    if not args.backup_rehearse_reviewed:
        print(json.dumps({'plan': 'PLAN ONLY: fresh encrypted backup and isolated temporary-database restore on the existing cluster; no production apply/login/flags'}))
        return
    require(not sys.stdin.isatty())
    raw = sys.stdin.buffer.read(32769)
    require(len(raw) <= 32768)
    packet = json.loads(raw)
    require(isinstance(packet, dict) and set(packet) == {'manifestSql'})
    print(json.dumps(run(args.expected_operator_sha256, packet['manifestSql']), sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Candidate backup/rehearsal failed; private artifacts preserved, no foundation apply attempted', file=sys.stderr)
        sys.exit(1)
