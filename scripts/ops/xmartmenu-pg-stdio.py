#!/usr/bin/python3 -I
"""Exact sudo command for the dedicated SSH key; no general Docker privilege."""
import contextlib
import json
import ipaddress
import os
from pathlib import Path
try:
    import pwd
except ModuleNotFoundError:
    pwd = None  # Pure admission guards remain portable for offline tests.
import selectors
import signal
import socket
import stat
import subprocess
import sys
import time

TARGET = "e12scyfsrp822dag7m9wwd4x"
IMAGE = "sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b"
VOLUME = "postgres-data-" + TARGET
SLOTS = Path("/run/xmartmenu-pg-stdio")
DOCKER = ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock"]
NETWORK = "coolify"
NETWORK_ID = "3d6a1305106acfa0c120c280e047ecdc3c3016b83ec20fcce361d2db6da4d078"
SUBNET = ipaddress.ip_network("10.0.1.0/24")
GATEWAY = "10.0.1.1"
BUFFER = 32768
CHUNK = 16384
# Docker must filter before emitting JSON. Full inspect includes Config.Env with
# cluster credentials, which must never enter the heap of the later dropped uid.
INSPECT_FORMAT = ('{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},'
                  '"State":{"Running":{{json .State.Running}},"Pid":{{json .State.Pid}},'
                  '"Health":{"Status":{{json .State.Health.Status}}}},'
                  '"HostConfig":{"PortBindings":{{json .HostConfig.PortBindings}},'
                  '"PublishAllPorts":{{json .HostConfig.PublishAllPorts}},'
                  '"NetworkMode":{{json .HostConfig.NetworkMode}},"Memory":{{json .HostConfig.Memory}},'
                  '"MemorySwap":{{json .HostConfig.MemorySwap}},"NanoCpus":{{json .HostConfig.NanoCpus}}},'
                  '"Mounts":{{json .Mounts}},"NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}},'
                  '"Ports":{{json .NetworkSettings.Ports}}}}')
NETWORK_FORMAT = ('{"Name":{{json .Name}},"Id":{{json .Id}},"Driver":{{json .Driver}},'
                  '"IPAM":{"Config":{{json .IPAM.Config}}}}')


def request_guard(argv, env, uid):
    if argv or uid != 0 or env.get("SSH_ORIGINAL_COMMAND", "") != "":
        raise ValueError("Unexpected command")
    connection = env.get("SSH_CONNECTION", "").split()
    if (len(connection) != 4 or connection[0] != "188.245.112.3"
            or connection[2] != "49.13.197.250" or connection[3] != "22"
            or not connection[1].isdigit() or not 1 <= int(connection[1]) <= 65535):
        raise ValueError("Unexpected SSH source")


def target_guard(value):
    mounts = [m for m in value.get("Mounts", []) if m.get("Destination") == "/var/lib/postgresql/data"]
    state, host = value.get("State", {}), value.get("HostConfig", {})
    if (value.get("Name") != "/" + TARGET or value.get("Image") != IMAGE
            or not state.get("Running") or state.get("Health", {}).get("Status") != "healthy"
            or host.get("PortBindings") or host.get("PublishAllPorts")
            or any(value.get("NetworkSettings", {}).get("Ports", {}).values())
            or host.get("NetworkMode") == "host"
            or host.get("Memory") != 536870912 or host.get("MemorySwap") != 536870912
            or host.get("NanoCpus") != 750000000 or len(mounts) != 1
            or mounts[0].get("Type") != "volume" or mounts[0].get("Name") != VOLUME
            or mounts[0].get("RW") is not True):
        raise ValueError("PostgreSQL identity refused")
    identity = value.get("Id", "")
    if len(identity) != 64 or any(c not in "0123456789abcdef" for c in identity):
        raise ValueError("Invalid container identity")
    return identity


def owned_path(path, regular):
    info = path.lstat()
    if (info.st_uid != 0 or info.st_mode & 0o022
            or (stat.S_ISREG(info.st_mode) if regular else stat.S_ISDIR(info.st_mode)) is not True):
        raise ValueError("Unsafe wrapper storage")


def snapshot_guard(value):
    identity = target_guard(value)
    pid = value.get("State", {}).get("Pid")
    networks = value.get("NetworkSettings", {}).get("Networks", {})
    if type(pid) is not int or pid <= 1 or set(networks) != {NETWORK}:
        raise ValueError("PostgreSQL PID/network identity refused")
    network = networks[NETWORK]
    address = ipaddress.ip_address(network.get("IPAddress", ""))
    if (address.version != 4 or address not in SUBNET or str(address) == GATEWAY
            or address in (SUBNET.network_address, SUBNET.broadcast_address)
            or network.get("NetworkID") != NETWORK_ID or network.get("Gateway") != GATEWAY):
        raise ValueError("Current PostgreSQL private address refused")
    return identity, pid, str(address)


def network_guard(value):
    configs = value.get("IPAM", {}).get("Config", [])
    ipv4 = [c for c in configs if ":" not in c.get("Subnet", "")]
    if (value.get("Name") != NETWORK or value.get("Id") != NETWORK_ID
            or value.get("Driver") != "bridge"
            or ipv4 != [{"Subnet": str(SUBNET), "Gateway": GATEWAY}]):
        raise ValueError("PostgreSQL Docker bridge refused")


def inspected(reference):
    result = subprocess.run([*DOCKER, "inspect", "--format", INSPECT_FORMAT, reference], capture_output=True,
                            timeout=2, check=True, env={"PATH": "/usr/bin:/bin"})
    return json.loads(result.stdout)


def connected(snapshot, connector=socket.create_connection):
    identity, _, address = snapshot
    connection = connector((address, 5432), timeout=5)
    try:
        # An IP can change after a restart. Validate the SAME immutable container,
        # current hostPID and current address again after opening the socket.
        if snapshot_guard(inspected(identity)) != snapshot:
            raise ValueError("PostgreSQL identity changed during connection")
        connection.setblocking(False)
        return connection
    except BaseException:
        connection.close()
        raise


def drop_privileges():
    import ctypes
    account = pwd.getpwnam("xmartmenu-pg-ssh")
    if account.pw_uid <= 0 or account.pw_gid <= 0:
        raise ValueError("Dedicated unprivileged account required")
    # No executable is launched after this point. Remove supplementary groups,
    # real/effective/saved gids/uids and future setuid/file-capability elevation.
    if ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) != 0:
        raise ValueError("NoNewPrivileges failed")
    os.setgroups([])
    os.setresgid(account.pw_gid, account.pw_gid, account.pw_gid)
    os.setresuid(account.pw_uid, account.pw_uid, account.pw_uid)
    status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
    if (os.getresuid() != (account.pw_uid,)*3 or os.getresgid() != (account.pw_gid,)*3
            or os.getgroups() or status.get("NoNewPrivs", "").strip() != "1"
            or any(int(status.get(key, "1").strip(), 16) for key in ["CapInh", "CapPrm", "CapEff", "CapAmb"])):
        raise ValueError("Privilege drop verification failed")


def relay(connection, stdin=0, stdout=1):
    """No idle deadline. Only a genuine input EOF starts a10s final-drain bound."""
    os.set_blocking(stdin, False)
    os.set_blocking(stdout, False)
    connection.setblocking(False)
    tcp = connection.fileno()
    to_pg, to_stdout = bytearray(), bytearray()
    input_open = output_open = write_open = True
    final_deadline = None
    registered = {}
    with selectors.DefaultSelector() as selector:
        while True:
            if not input_open and not to_pg and write_open:
                with contextlib.suppress(OSError):
                    connection.shutdown(socket.SHUT_WR)
                write_open = False
            if not output_open and not to_stdout:
                return
            if final_deadline is not None and time.monotonic() >= final_deadline:
                return
            desired = {}
            if input_open and len(to_pg) < BUFFER:
                desired[stdin] = selectors.EVENT_READ
            network_events = ((selectors.EVENT_READ if output_open and len(to_stdout) < BUFFER else 0)
                              | (selectors.EVENT_WRITE if to_pg and write_open else 0))
            if network_events:
                desired[tcp] = network_events
            if to_stdout:
                desired[stdout] = selectors.EVENT_WRITE
            for fd in set(registered)-set(desired):
                selector.unregister(fd)
                del registered[fd]
            for fd, flags in desired.items():
                if fd not in registered:
                    selector.register(fd, flags)
                elif registered[fd] != flags:
                    selector.modify(fd, flags)
                registered[fd] = flags
            if not desired:
                return
            timeout = max(0, final_deadline-time.monotonic()) if final_deadline is not None else None
            for key, flags in selector.select(timeout):
                try:
                    if key.fd == stdin:
                        data = os.read(stdin, min(CHUNK, BUFFER-len(to_pg)))
                        if data:
                            to_pg.extend(data)
                        else:
                            input_open = False
                            final_deadline = time.monotonic()+10
                    elif key.fd == stdout:
                        sent = os.write(stdout, to_stdout)
                        if not sent:
                            return
                        del to_stdout[:sent]
                    else:
                        if flags & selectors.EVENT_READ:
                            data = connection.recv(min(CHUNK, BUFFER-len(to_stdout)))
                            if data:
                                to_stdout.extend(data)
                            else:
                                output_open = input_open = False
                                to_pg.clear()
                        if flags & selectors.EVENT_WRITE and to_pg:
                            sent = connection.send(to_pg)
                            if not sent:
                                return
                            del to_pg[:sent]
                except BlockingIOError:
                    continue
                except (BrokenPipeError, ConnectionResetError):
                    return


def reserve_slot():
    import fcntl  # Linux-only execution; pure guards remain testable offline on Windows.
    owned_path(SLOTS, False)
    for n in range(12):
        path = SLOTS / str(n)
        owned_path(path, True)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except BlockingIOError:
            os.close(fd)
    raise ValueError("Transport capacity exhausted")


def main():
    request_guard(sys.argv[1:], os.environ, os.getuid())
    for path in [Path("/usr/local"), Path("/usr/local/libexec")]:
        owned_path(path, False)
    owned_path(Path(__file__), True)
    slot = reserve_slot()
    connection = None
    try:
        result = subprocess.run([*DOCKER, "network", "inspect", "--format", NETWORK_FORMAT, NETWORK], capture_output=True,
                                timeout=2, check=True, env={"PATH": "/usr/bin:/bin"})
        network_guard(json.loads(result.stdout))
        connection = connected(snapshot_guard(inspected(TARGET)))
        for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda signum, _: sys.exit(128+signum))
        drop_privileges()
        # Only after a bounded successful connect and irreversible privilege drop.
        print("XMARTMENU_PG_READY", file=sys.stderr, flush=True)
        relay(connection)
        return 0
    finally:
        if connection is not None:
            connection.close()
        os.close(slot)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Transport refused", file=sys.stderr)
        sys.exit(1)
