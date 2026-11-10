#!/usr/bin/python3 -I
"""Same-host root timer: stop only the exact newly receipted pilot containers."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path('/opt/xmartmenu/identity-pilot')
PG_IMAGE = 'sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'
DOCKER = ['/usr/bin/docker', '--host', 'unix:///var/run/docker.sock']
INSPECT = '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Labels":{{json .Config.Labels}},"Running":{{json .State.Running}}}'
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


def require(value):
    if not value:
        raise ValueError('Pilot cleanup refused')


def checked(path, directory=False):
    value = path.lstat()
    require((stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode)) and value.st_uid == 0
            and not value.st_mode & 0o022 and (directory or value.st_nlink == 1))
    return value


def validate_receipt(value, nonce):
    require(isinstance(value, dict) and set(value) == {'nonce', 'pgId', 'appId', 'appImage', 'volume', 'createdAt', 'stopAfter'}
            and re.fullmatch('[a-f0-9]{16}', nonce) and value['nonce'] == nonce
            and all(isinstance(value[key], str) and re.fullmatch('[a-f0-9]{64}', value[key]) for key in ['pgId', 'appId'])
            and value['pgId'] != value['appId'] and isinstance(value['appImage'], str) and re.fullmatch('sha256:[a-f0-9]{64}', value['appImage'])
            and value['volume'] == 'xmartmenu-identity-pilot-pg-' + nonce
            and type(value['createdAt']) is int and type(value['stopAfter']) is int and value['stopAfter'] - value['createdAt'] == 7200)
    return value


def owned_container(metadata, receipt, kind):
    require(isinstance(metadata, dict) and metadata.get('Id') == receipt[kind + 'Id']
            and metadata.get('Name') == '/xmartmenu-identity-pilot-' + ('db' if kind == 'pg' else 'app')
            and metadata.get('Image') == (PG_IMAGE if kind == 'pg' else receipt['appImage'])
            and metadata.get('Labels', {}).get('io.xmartmenu.isolated-pilot') == receipt['nonce']
            and type(metadata.get('Running')) is bool)
    return metadata['Running']


def command(args):
    result = subprocess.run([*DOCKER, *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, env=ENV)
    require(result.returncode == 0 and len(result.stdout) <= 65536 and len(result.stderr) <= 65536)
    return result.stdout


def stop_owned(receipt, runner=command):
    stopped = 0
    for kind in ['app', 'pg']:
        identity = receipt[kind + 'Id']
        metadata = json.loads(runner(['inspect', '--format', INSPECT, identity]))
        if owned_container(metadata, receipt, kind):
            runner(['stop', '--time', '5', identity])
            require(not owned_container(json.loads(runner(['inspect', '--format', INSPECT, identity])), receipt, kind))
        stopped += 1
    return {'pilotContainersStopped': stopped, 'volumeRetained': True, 'productionApplicationChanged': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cleanup-reviewed', action='store_true')
    parser.add_argument('--nonce')
    parser.add_argument('--expected-operator-sha256')
    parser.add_argument('--expected-receipt-sha256')
    args = parser.parse_args()
    if not args.cleanup_reviewed:
        print('PLAN ONLY: stop exact receipted pilot IDs; retain volume, backup and production application.')
        return
    require(os.getuid() == 0 and Path('/etc/hostname').read_text().strip() == 'skaleclub-server')
    checked(Path(__file__))
    require(re.fullmatch('[a-f0-9]{64}', args.expected_operator_sha256 or '')
            and hashlib.sha256(Path(__file__).read_bytes()).hexdigest() == args.expected_operator_sha256)
    require(re.fullmatch('[a-f0-9]{16}', args.nonce or '') and re.fullmatch('[a-f0-9]{64}', args.expected_receipt_sha256 or ''))
    for path in [Path('/opt'), Path('/opt/xmartmenu'), ROOT, ROOT / args.nonce]:
        checked(path, directory=True)
    require(stat.S_IMODE((ROOT / args.nonce).stat().st_mode) == 0o700)
    path = ROOT / args.nonce / 'cleanup-receipt.json'
    info = checked(path)
    require(stat.S_IMODE(info.st_mode) == 0o400 and info.st_size <= 4096)
    raw = path.read_bytes()
    require(hashlib.sha256(raw).hexdigest() == args.expected_receipt_sha256)
    print(json.dumps(stop_owned(validate_receipt(json.loads(raw), args.nonce)), sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Pilot cleanup refused; original application untouched, inspect the exact pilot receipt.', file=sys.stderr)
        sys.exit(1)
