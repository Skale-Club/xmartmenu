#!/usr/bin/env python3
"""Offline bundle renderer and explicit local READ ONLY admission. No apply mode."""
import argparse
import base64
import hashlib
import json
import os
import ipaddress
import re
from pathlib import Path
import shutil
import subprocess
import sys
import time

sys.dont_write_bytecode = True  # Read-only admission must not leave helper pyc files.

ROOT = Path(__file__).resolve().parent
HOST = "49.13.197.250"
FINGERPRINT = "XnGL1DaHCR2OOCEvHKz4S2rh0DSzwHrP9Bq9OMLgMC0"
NETWORK = "gmaayluj11x1m6j7baogonfn"
NETWORK_ID = "9618654f72854308768936727d24ecd948decaa235eaf51a163d845958f47c37"
UNIT = """[Unit]
Description=Xprout bounded private PostgreSQL transport
After=network-online.target docker.service
BindsTo=sys-subsystem-net-devices-br\\x2d9618654f7285.device
After=sys-subsystem-net-devices-br\\x2d9618654f7285.device
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=xmartmenu-pg-client
Group=xmartmenu-pg-client
ExecStartPre=+/usr/bin/python3 -I /usr/local/libexec/prepare-xmartmenu-private-transport.py --admit-local client
ExecStart=/usr/bin/python3 -I /usr/local/libexec/xmartmenu-private-forwarder.py --serve
Restart=on-failure
RestartSec=5
TimeoutStopSec=5
KillMode=control-group
MemoryHigh=96M
MemoryMax=128M
MemorySwapMax=0
TasksMax=32
CPUQuota=50%
LimitNOFILE=256
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_UNIX AF_NETLINK
CapabilityBoundingSet=
AmbientCapabilities=
IPAddressDeny=any
IPAddressAllow=10.0.4.0/24
IPAddressAllow=49.13.197.250/32

[Install]
WantedBy=multi-user.target
"""
SUDOERS = '''# Only this zero-argument root-owned transport; never docker group access.
Defaults:xmartmenu-pg-ssh env_keep += "SSH_ORIGINAL_COMMAND SSH_CONNECTION"
xmartmenu-pg-ssh ALL=(root) NOPASSWD: /usr/local/libexec/xmartmenu-pg-stdio.py ""
'''
# sudo authorizes a script executable directly, preserving its shebang and no args.
KEY_PREFIX = 'restrict,from="188.245.112.3",command="/usr/bin/sudo -n -- /usr/local/libexec/xmartmenu-pg-stdio.py"'
SSHD_MATCH = '''# Include this fragment only at the END of the main config.
Match User xmartmenu-pg-ssh
    AuthorizedKeysFile /etc/ssh/authorized_keys/xmartmenu-pg-ssh
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    PermitUserRC no
    DisableForwarding yes
    ForceCommand /usr/bin/sudo -n -- /usr/local/libexec/xmartmenu-pg-stdio.py
    ClientAliveInterval 5
    ClientAliveCountMax 1
'''


def trusted_key(path, runner=subprocess.run):
    result = runner(["ssh-keygen", "-F", HOST, "-f", str(path)], capture_output=True, text=True, check=True)
    keys = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        if parts and parts[0].startswith("@"):
            raise ValueError("Marked/revoked known_hosts entry refused")
        if line.startswith("#") or len(parts) < 3 or parts[1] != "ssh-ed25519":
            continue
        raw = base64.b64decode(parts[2], validate=True)
        fingerprint = base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")
        if fingerprint != FINGERPRINT:
            raise ValueError("Trusted known_hosts does not match independently observed host key")
        keys.add(parts[2])
    if len(keys) != 1:
        raise ValueError("One trusted pinned ED25519 host key required")
    return f"{HOST} ssh-ed25519 {keys.pop()}\n"


def render_bundle(destination, known_hosts):
    # New directory only: no overwriting an operator or a prepared private key.
    if destination.exists():
        raise ValueError("Bundle destination must not exist")
    key = trusted_key(known_hosts)
    files = {"xmartmenu-private-transport.service": UNIT, "sudoers": SUDOERS,
             "sshd-match.conf": SSHD_MATCH,
             "authorized_keys.template": KEY_PREFIX + " __CLIENT_ED25519_PUBLIC_KEY__\n",
             "known_hosts": key,
             "tmpfiles.conf": "d /run/xmartmenu-pg-stdio 0700 root root -\n" +
             "".join(f"f /run/xmartmenu-pg-stdio/{i} 0600 root root -\n" for i in range(12))}
    # Repository names are Xprout; deployed units/forced commands keep their reviewed v1 paths.
    installed_sources = {
        "xmartmenu-private-forwarder.py": "xprout-private-forwarder.py",
        "xmartmenu-pg-stdio.py": "xprout-pg-stdio.py",
        "prepare-xmartmenu-private-transport.py": "prepare-xprout-private-transport.py",
    }
    for installed_name, source_name in installed_sources.items():
        files[installed_name] = (ROOT / source_name).read_text(encoding="utf-8")
    destination.mkdir(mode=0o700)
    for name, value in files.items():
        path = destination / name
        path.write_text(value, encoding="utf-8", newline="\n")
        path.chmod(0o600)
    manifest = {"version": 1, "applicationCutover": False, "runtimeLoginEnabled": False,
                "sshKeysCreated": False, "serverHostKeySha256": FINGERPRINT,
                "files": {name: hashlib.sha256(value.encode()).hexdigest() for name, value in files.items()}}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    return {"preparedFiles": len(files), "applicationCutover": False, "runtimeLoginEnabled": False}


def command(args, timeout=5):
    if args[0] == "/usr/bin/docker":
        args = [args[0], "--host", "unix:///var/run/docker.sock", *args[1:]]
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=timeout)


def metrics():
    mem = {k: int(v.split()[0]) for k, v in (line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())}
    def sample():
        cpu = list(map(int, Path("/proc/stat").read_text().splitlines()[0].split()[1:9]))
        vm = dict(line.split() for line in Path("/proc/vmstat").read_text().splitlines())
        return cpu, int(vm["pswpin"]), int(vm["pswpout"])
    samples = []
    previous = sample()
    for _ in range(3):
        time.sleep(1)
        current = sample()
        a, b = previous[0], current[0]
        samples.append({"idle": (b[3] + b[4] - a[3] - a[4]) * 100 / sum(y-x for x, y in zip(a,b)),
                        "swapin": (current[1]-previous[1])*os.sysconf("SC_PAGE_SIZE")/1024,
                        "swapout": (current[2]-previous[2])*os.sysconf("SC_PAGE_SIZE")/1024})
        previous = current
    psi = {line.split()[0]: float(dict(item.split("=") for item in line.split()[1:])["avg60"])
           for line in Path("/proc/pressure/memory").read_text().splitlines()}
    return {"availableMiB": mem["MemAvailable"]//1024,
            "swapUsedMiB": (mem["SwapTotal"]-mem["SwapFree"])//1024,
            "diskMiB": shutil.disk_usage("/var/lib/docker").free//1048576,
            "psi": psi, "samples": samples}


def capacity_guard(value, side):
    if (value["availableMiB"] < (512 if side == "client" else 1024)
            or value["diskMiB"] < 512 or value["psi"]["some"] > .10 or value["psi"]["full"] > .05
            or len(value["samples"]) != 3
            or any(s["idle"] < 50 or s["swapin"] > 64 or s["swapout"] > 0 for s in value["samples"])):
        raise ValueError("Current host capacity refused")


def client_network_guard(containers, network):
    apps = [c for c in containers if c["State"]["Running"] and
            c["Name"].lstrip("/").startswith("app-" + NETWORK + "-")]
    if len(apps) not in (1, 2):
        raise ValueError("One app or two rolling app containers required")
    ipam = network.get("IPAM", {}).get("Config", [])
    if (network.get("Id") != NETWORK_ID or network.get("Name") != NETWORK
            or network.get("Driver") != "bridge" or len(ipam) != 1
            or ipam[0] != {"Subnet": "10.0.4.0/24", "Gateway": "10.0.4.1"}):
        raise ValueError("Private app source/network pin changed; review required")
    addresses = set()
    for app in apps:
        n = app["NetworkSettings"]["Networks"].get(NETWORK, {})
        labels = app.get("Config", {}).get("Labels", {})
        address = ipaddress.ip_address(n.get("IPAddress", ""))
        if (not re.fullmatch(r"/app-" + NETWORK + r"-\d{8}T\d{6}", app["Name"])
                or not re.fullmatch(r"ghcr\.io/skale-club/xmartmenu:[0-9a-f]{40}", app.get("Config", {}).get("Image", ""))
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", app.get("Image", ""))
                or any(labels.get(k) != v for k, v in {
                    "coolify.applicationUuid": NETWORK, "coolify.managed": "true",
                    "coolify.resourceName": "xmartmenu", "coolify.type": "application",
                    "com.docker.compose.project": NETWORK, "com.docker.compose.service": "app"}.items())
                or address not in ipaddress.ip_network("10.0.4.0/24")
                or str(address) in ("10.0.4.0", "10.0.4.1", "10.0.4.255")
                or n.get("Gateway") != "10.0.4.1" or address in addresses):
            raise ValueError("App rolling identity/source refused")
        addresses.add(address)


def admit_local(side):
    if os.getuid() != 0 or Path("/etc/hostname").read_text().strip() != ("skaleclub-server" if side == "client" else "skaleclub-mail"):
        raise ValueError("Exact host/root admission required")
    value = metrics()
    capacity_guard(value, side)
    if side == "client":
        ids = command(["/usr/bin/docker", "ps", "-q"]).split()
        containers = json.loads(command(["/usr/bin/docker", "inspect", *ids]))
        network = json.loads(command(["/usr/bin/docker", "network", "inspect", NETWORK]))[0]
        client_network_guard(containers, network)
    else:
        # Reuse the exact per-connection image/volume/port guard without executing it.
        import importlib.util
        spec = importlib.util.spec_from_file_location("stdio", ROOT / "xmartmenu-pg-stdio.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        container = json.loads(command(["/usr/bin/docker", "inspect", module.TARGET]))[0]
        identity = module.target_guard(container)
        cg = Path("/sys/fs/cgroup" + Path(f"/proc/{container['State']['Pid']}/cgroup").read_text().strip().split(":")[-1])
        before = dict(line.split() for line in (cg / "memory.events").read_text().splitlines())
        current = int((cg / "memory.current").read_text())
        value["pg"] = {"currentMiB": current//1048576, "peakMiB": int((cg/"memory.peak").read_text())//1048576,
                       "maxEvents": int(before["max"]), "oomEvents": int(before["oom"]), "oomKills": int(before["oom_kill"])}
        if current > 384*1048576 or int(before["oom"]) or int(before["oom_kill"]):
            raise ValueError("Existing PG current pressure/OOM refused")
        sql = "BEGIN READ ONLY; SET LOCAL statement_timeout=3000; SELECT json_build_object('connections',(SELECT count(*) FROM pg_stat_activity),'max',current_setting('max_connections')::int,'runtimeDormant',EXISTS(SELECT FROM pg_roles WHERE rolname='xmartmenu_runtime' AND NOT rolcanlogin AND rolconnlimit=12),'dbExists',EXISTS(SELECT FROM pg_database WHERE datname='xmartmenu')); ROLLBACK;"
        result = json.loads(command(["/usr/bin/docker", "exec", "-u", "postgres", identity, "psql", "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "xmail_owner", "-d", "postgres", "-c", sql]))
        if not result["runtimeDormant"] or not result["dbExists"] or result["connections"] > 40 or result["max"] < 80:
            raise ValueError("Database/runtime admission refused")
        command(["/usr/bin/docker", "exec", "-u", "postgres", identity, "test", "-x", "/usr/bin/nc"])
        after = dict(line.split() for line in (cg / "memory.events").read_text().splitlines())
        if any(before[k] != after[k] for k in ["max", "oom", "oom_kill"]):
            raise ValueError("New PG pressure during admission")
        value["database"] = result
    return {"admitted": True, "side": side, "metrics": value,
            "runtimeLoginEnabled": False, "applicationCutover": False}


def main():
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--plan", action="store_true")
    action.add_argument("--admit-local", choices=["client", "server"])
    action.add_argument("--bundle", type=Path)
    parser.add_argument("--trusted-known-hosts", type=Path)
    args = parser.parse_args()
    if args.admit_local:
        return admit_local(args.admit_local)
    if args.bundle:
        if not args.trusted_known_hosts:
            parser.error("--trusted-known-hosts required; no keyscan or automatic trust")
        return render_bundle(args.bundle, args.trusted_known_hosts)
    if args.trusted_known_hosts:
        parser.error("--trusted-known-hosts only with --bundle")
    return {"plan": "PLAN ONLY: read-only admission or offline bundle; no apply/key/user/service/SQL change",
            "bind": "10.0.4.1:15432", "sourceNetwork": "10.0.4.0/24", "target": HOST,
            "maximumConnections": 12, "memoryMaxMiB": 128, "runtimeLoginEnabled": False,
            "applicationCutover": False}


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception:
        print("Transport preparation refused", file=sys.stderr)
        sys.exit(1)
