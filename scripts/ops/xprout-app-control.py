#!/usr/bin/python3 -I
"""Forced SSH command on the app host: inspect / stop / start the Xprout app container by immutable ID.

Why not the Coolify stop: it removes the app network (docker network rm) and the private PostgreSQL
transport is pinned to that network ID. Here the container is only stopped; the network stays.

SSH_ORIGINAL_COMMAND is one of: inspect | stop <64 hex> | start <64 hex>. Output is one JSON object.
Install separately (authorized_keys: restrict,from="49.13.197.250",command="/usr/bin/python3 -I <this file>").
"""
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
APP = 'gmaayluj11x1m6j7baogonfn'
TRANSPORT_UNIT = 'xmartmenu-private-transport.service'
ENV = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


def run(argv):
    p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV, timeout=60)
    return p.returncode, p.stdout.decode()


def containers():
    code, out = run(['docker', 'ps', '-a', '--no-trunc', '--filter', f'label=com.docker.compose.project={APP}',
                     '--filter', 'label=com.docker.compose.service=app', '--format', '{{.ID}} {{.State}}'])
    if code:
        raise SystemExit(1)
    return [line.split() for line in out.splitlines() if line.strip()]


def meminfo():
    mem = dict(l.split(':', 1) for l in open('/proc/meminfo').read().splitlines())
    kb = lambda k: int(mem[k].split()[0]) // 1024
    st = os.statvfs('/')
    return {'mem_available_mib': kb('MemAvailable'), 'swap_used_mib': kb('SwapTotal') - kb('SwapFree'),
            'disk_free_gib': st.f_bavail * st.f_frsize // 2**30}


def inspect():
    rows = containers()
    running = [r for r in rows if r[1] == 'running']
    chosen = running[0] if len(running) == 1 else (rows[0] if len(rows) == 1 else None)
    code, net = run(['docker', 'network', 'inspect', '--format', '{{.Id}}', APP])
    code2, active = run(['systemctl', 'is-active', TRANSPORT_UNIT])
    return {'id': chosen[0] if chosen else '', 'running': len(running) == 1, 'containers': len(running) if running else len(rows),
            'network_id': net.strip() if code == 0 else '', 'transport': code2 == 0 and active.strip() == 'active', **meminfo()}


def act(verb, cid):
    if not re.fullmatch(r'[0-9a-f]{64}', cid) or cid not in [r[0] for r in containers()]:
        raise SystemExit(2)
    if verb == 'stop':
        for argv in (['docker', 'update', '--restart=no', cid], ['docker', 'stop', '--time', '30', cid]):
            if run(argv)[0]:
                raise SystemExit(1)
    else:
        for argv in (['docker', 'update', '--restart=unless-stopped', cid], ['docker', 'start', cid]):
            if run(argv)[0]:
                raise SystemExit(1)
    return inspect()


def main(command):
    parts = command.split()
    if parts == ['inspect']:
        result = inspect()
    elif len(parts) == 2 and parts[0] in ('stop', 'start'):
        result = act(parts[0], parts[1])
    else:
        raise SystemExit(2)
    print(json.dumps(result))


if __name__ == '__main__':
    main(os.environ.get('SSH_ORIGINAL_COMMAND', ' '.join(sys.argv[1:])))
