#!/usr/bin/env python3
"""Install only Xprout's off-host backup: dedicated SSH key, forced receiver, daily timer.

--plan (the default) reads this directory's backup script to print its SHA-256 and changes nothing.
--apply is for reviewed execution, once per host (docs/xprout-offsite-backup.md has the exact order):

  --prepare-transport --role source    create/verify the dedicated Ed25519 key; prints only its public half
  --apply --role target                authorize that key on 188 for one forced command, create the receiver lock
  --apply --role source                pin the recipient certificate and 188's host key, install the unit and timer

Existing files and units must match exactly; conflicting state refuses. Other authorized keys are preserved.
The timer is enabled but not started: start it only after one manual run produced a verified receipt.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
from pathlib import Path

SOURCE = '49.13.197.250'
TARGET = '188.245.112.3'
# SHA-256 of 188's already trusted Ed25519 host key (the same pin the Xmail installer carries).
HOST_SHA = '76811c7f728946b63c41a9f656caee1015bd91db43eb6f6363efd699976b62cb'
BASE = Path('/opt/xmartmenu')
OPS = BASE / 'offsite-backup-ops'
# Keep the installed command/archive protocol until a separately reviewed host migration.
SCRIPT = 'xmartmenu-offsite-backup.py'
SOURCE_SCRIPT = 'xprout-offsite-backup.py'
KEY_COMMENT = 'xmartmenu-offsite-backup-v1'
UNIT = 'xmartmenu-offsite-backup'
SERVICE = '''[Unit]
Description=Xprout SQL encrypted off-host backup and isolated restore proof
After=docker.service network-online.target xmail-owned-backup.service
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=root
Group=root
UMask=0077
ExecStart=/usr/bin/python3 -B /opt/xmartmenu/offsite-backup-ops/code/xmartmenu-offsite-backup.py --backup
TimeoutStartSec=650
CPUQuota=50%
MemoryMax=256M
Nice=10
IOSchedulingClass=idle
StandardOutput=journal
StandardError=journal
'''
# Xmail runs at 03:15 UTC plus up to 15 minutes and finishes well inside 11 minutes: this starts at 03:50 UTC plus up to 10 minutes.
TIMER = '''[Unit]
Description=Daily verified Xprout off-host SQL backup

[Timer]
OnCalendar=*-*-* 03:50:00 UTC
RandomizedDelaySec=10m
Persistent=true
Unit=xmartmenu-offsite-backup.service

[Install]
WantedBy=timers.target
'''


def need(value):
    if not value:
        raise ValueError('Xprout backup installation refused')


def public_key(value):
    need(isinstance(value, str) and re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]{60,100}={0,2}(?: ' + KEY_COMMENT + ')?', value))
    raw = base64.b64decode(value.split()[1], validate=True)
    need(len(raw) == 51 and raw[:15] == b'\x00\x00\x00\x0bssh-ed25519')
    return ' '.join(value.split()[:2])


def authorized_line(key):
    return ('from="' + SOURCE + '",restrict,command="/usr/bin/python3 -B ' + OPS.as_posix() + '/code/' + SCRIPT + ' --receive" '
            + public_key(key) + ' ' + KEY_COMMENT)


def host_line(value):
    need(isinstance(value, str) and '\n' not in value and '\r' not in value)
    parts = value.split()
    need(len(parts) == 3 and parts[:2] == [TARGET, 'ssh-ed25519'] and hashlib.sha256(base64.b64decode(parts[2], validate=True)).hexdigest() == HOST_SHA)
    return value + '\n'


def lf(raw):
    return raw.replace(b'\r\n', b'\n')


def plan(here=None):
    here = here or Path(__file__).parent
    script = here / SOURCE_SCRIPT
    digest = hashlib.sha256(lf(script.read_bytes())).hexdigest() if script.exists() else None
    return {
        'mode': 'plan', 'changes': 'none', 'backupScriptSha256': digest,
        'schedule': 'daily 03:50 UTC + up to 10 min (Xmail: 03:15 UTC + up to 15 min)',
        'steps': [
            'source: --prepare-transport --role source  (key stays on 49, prints the public half)',
            'target: --apply --role target --backup-script-sha256 <sha>  (stdin: transportPublicKey)',
            'source: --apply --role source --backup-script-sha256 <sha>  (stdin: recipientPublicPem, targetKnownHost)',
            'source: systemctl start xmartmenu-offsite-backup.service once, read the receipt, then start the timer',
        ],
        'files': {'source': [str(OPS) + '/{code,transport.key,known_hosts,recipient.crt,backup.lock,local-archives}', '/opt/xmartmenu/offsite-backups (receipt directory)',
                             '/etc/systemd/system/' + UNIT + '.service', '/etc/systemd/system/' + UNIT + '.timer'],
                  'target': [str(OPS) + '/{code,receiver.lock}', '/opt/xmartmenu/offsite-backups/v1', '/root/.ssh/authorized_keys (one forced-command line)']},
        'unchanged': ['Xmail units, locks, recipient key and archives', 'application containers', 'PostgreSQL settings', 'firewall'],
    }


def run(args):
    need(sys.platform.startswith('linux') and os.geteuid() == 0 and args.role in ('source', 'target') and re.fullmatch(r'[a-f0-9]{64}', args.backup_script_sha256 or ''))
    path = Path(__file__).with_name(SOURCE_SCRIPT)
    need(hashlib.sha256(lf(path.read_bytes())).hexdigest() == args.backup_script_sha256)
    spec = importlib.util.spec_from_file_location('reviewed_offsite_backup', path)
    ob = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ob)
    cfg = ob.Config()
    os.umask(0o077)
    need(os.environ.get('SSH_CONNECTION', '').split()[2:3] == [SOURCE if args.role == 'source' else TARGET])
    # /opt/xmartmenu may already exist (cutover state lives there): it must be root-owned and not group/world writable
    if os.path.lexists(BASE):
        info = ob.guard(cfg, BASE, True)
        need(stat.S_IMODE(info.st_mode) & 0o022 == 0)
    else:
        BASE.mkdir(mode=0o700)
    ob.private_dir(cfg, OPS, True)
    code = OPS / 'code'
    ob.private_dir(cfg, code, True)

    def exact_file(destination, content):
        if os.path.lexists(destination):
            ob.guard(cfg, destination, False, 0o600)
            need(destination.read_bytes() == content)
        else:
            ob.write_new(destination, content)
            ob.syncdir(destination.parent)
    exact_file(code / SCRIPT, lf(path.read_bytes()))
    payload = {}
    if not args.prepare_transport:
        raw = sys.stdin.buffer.read(32769)
        need(len(raw) <= 32768)
        payload = json.loads(raw)
    if args.role == 'target':
        need(not args.prepare_transport and set(payload) == {'transportPublicKey'})
        pem = (cfg.recipient_dir / 'recipient.crt')
        ob.guard(cfg, pem, False, 0o600)
        ob.guard(cfg, cfg.recipient_dir / 'recipient.key', False, 0o600)
        need(ob.recipient_fingerprint(cfg, pem.read_bytes()) == ob.RECIPIENT_SHA)
        ob.private_dir(cfg, cfg.receipt_dir, True)
        ob.private_dir(cfg, cfg.archives, True)
        exact_file(OPS / 'receiver.lock', b'')
        ssh = Path('/root/.ssh')
        ob.private_dir(cfg, ssh)
        keys = ssh / 'authorized_keys'
        ob.guard(cfg, keys, False, 0o600)
        old = keys.read_bytes()
        need(len(old) <= 1024 * 1024 and b'\x00' not in old)
        line = authorized_line(payload['transportPublicKey']).encode()
        current = [v for v in old.splitlines() if KEY_COMMENT.encode() in v]
        need(not current or current == [line])
        if not current:
            replacement = old + (b'' if not old or old.endswith(b'\n') else b'\n') + line + b'\n'
            temporary = keys.with_name('.authorized_keys.xmartmenu')
            ob.write_new(temporary, replacement)
            os.replace(temporary, keys)
            ob.syncdir(ssh)
        need(keys.read_bytes().splitlines().count(line) == 1)
        return {'targetTransportInstalled': True, 'forcedCommandOnly': True, 'recipientPreserved': True, 'applicationChanged': False,
                'recipientPublicPem': pem.read_text('ascii')}
    key, pub = OPS / 'transport.key', OPS / 'transport.key.pub'
    if not os.path.lexists(key):
        need(not os.path.lexists(pub))
        ob.call(cfg, ['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', KEY_COMMENT, '-f', str(key)])
        os.chmod(key, 0o600)
        os.chmod(pub, 0o600)
        for p in (key, pub):
            with p.open('rb') as stream:
                os.fsync(stream.fileno())
        ob.syncdir(OPS)
    ob.guard(cfg, key, False, 0o600)
    ob.guard(cfg, pub, False, 0o600)
    derived = public_key(ob.call(cfg, ['ssh-keygen', '-y', '-f', str(key)]).strip())
    need(derived == public_key(pub.read_text().strip()))
    if args.prepare_transport:
        return {'transportPublicKey': derived, 'privateKeyStayedOnSource': True}
    need(set(payload) == {'recipientPublicPem', 'targetKnownHost'})
    pem = payload['recipientPublicPem'].encode('ascii')
    need(len(pem) <= 16384 and b'PRIVATE KEY' not in pem and ob.recipient_fingerprint(cfg, pem) == ob.RECIPIENT_SHA)
    exact_file(OPS / 'recipient.crt', pem)
    exact_file(OPS / 'known_hosts', host_line(payload['targetKnownHost']).encode())
    exact_file(OPS / 'backup.lock', b'')
    ob.private_dir(cfg, OPS / 'local-archives', True)
    ob.private_dir(cfg, cfg.receipt_dir, True)
    for name, content in ((UNIT + '.service', SERVICE), (UNIT + '.timer', TIMER)):
        destination = Path('/etc/systemd/system') / name
        if os.path.lexists(destination):
            ob.guard(cfg, destination, False)
            need(stat.S_IMODE(destination.stat().st_mode) == 0o644 and destination.read_text() == content)
        else:
            ob.write_new(destination, content.encode())
            os.chmod(destination, 0o644)
            ob.syncdir(destination.parent)
    ob.call(cfg, ['systemd-analyze', 'verify', '/etc/systemd/system/' + UNIT + '.service', '/etc/systemd/system/' + UNIT + '.timer'])
    ob.call(cfg, ['systemctl', 'daemon-reload'])
    ob.call(cfg, ['systemctl', 'enable', UNIT + '.timer'])
    return {'sourceTransportInstalled': True, 'timerEnabled': True, 'timerStarted': False, 'privateKeyStayedOnSource': True, 'applicationChanged': False}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--plan', action='store_true')
    p.add_argument('--apply', action='store_true')
    p.add_argument('--role', choices=['source', 'target'])
    p.add_argument('--prepare-transport', action='store_true')
    p.add_argument('--backup-script-sha256')
    args = p.parse_args(argv)
    if not args.apply and not args.prepare_transport:
        print(json.dumps(plan(), indent=2))
        return 0
    print(json.dumps(run(args)))
    return 0


if __name__ == '__main__':
    try:
        code = main()
    except Exception:
        print('Xprout backup installation refused/failed; diagnostics suppressed; application and existing credentials unchanged.', file=sys.stderr)
        sys.exit(1)
    sys.exit(code)
