#!/usr/bin/python3 -I
"""Reviewed installation only; default offline plan. Never enables SQL/app flags."""
import argparse
import base64
import contextlib
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
try:
    import pwd
    import grp
except ModuleNotFoundError:
    pwd = None  # Offline policy tests/plan are portable; mutation requires Linux.
    grp = None
import re
import stat
import struct
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
STATE = Path("/var/lib/xmartmenu-private-transport-install")
LIB = Path("/usr/local/libexec")
CONFIG = Path("/etc/xmartmenu-private-transport")
UNIT = Path("/etc/systemd/system/xmartmenu-private-transport.service")
AUTH = Path("/etc/ssh/authorized_keys/xmartmenu-pg-ssh")
SUDO = Path("/etc/sudoers.d/xmartmenu-pg-stdio")
TMPFILES = Path("/etc/tmpfiles.d/xmartmenu-pg-stdio.conf")
SSHD = Path("/etc/ssh/sshd_config")
UNIT_NAME = "xmartmenu-private-transport.service"
CLIENT_USER = "xmartmenu-pg-client"
SERVER_USER = "xmartmenu-pg-ssh"
# Legacy bundle filenames are the deployed systemd/SSH contract, not repository branding.
FILES = {"prepare-xmartmenu-private-transport.py", "xmartmenu-private-forwarder.py", "xmartmenu-pg-stdio.py",
         "xmartmenu-private-transport.service", "sudoers", "known_hosts", "tmpfiles.conf",
         "authorized_keys.template", "sshd-match.conf"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked(path, directory=False, private=False):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or info.st_uid != 0 or info.st_mode & (0o077 if private else 0o022):
        raise ValueError("Root-owned non-writable storage required")
    return info


def run(args, data=None, timeout=15):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          check=True, timeout=timeout, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"}).stdout


def module_at(path):
    spec = importlib.util.spec_from_file_location("transport_prepare", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_bundle(path, expected):
    checked(path, True, True)
    checked(path / "manifest.json", private=True)
    raw = (path / "manifest.json").read_bytes()
    if not re.fullmatch("[0-9a-f]{64}", expected or "") or sha(raw) != expected:
        raise ValueError("Reviewed bundle digest mismatch")
    manifest = json.loads(raw)
    if (set(manifest["files"]) != FILES or manifest.get("version") != 1
            or manifest.get("applicationCutover") is not False
            or manifest.get("runtimeLoginEnabled") is not False
            or manifest.get("sshKeysCreated") is not False):
        raise ValueError("Unexpected bundle contract")
    for name, digest in manifest["files"].items():
        checked(path / name, private=True)
        if not re.fullmatch("[0-9a-f]{64}", digest) or sha((path / name).read_bytes()) != digest:
            raise ValueError("Reviewed source digest mismatch")
    return manifest


def public_key(raw):
    parts = raw.decode("ascii").strip().split()
    if len(parts) not in (2, 3) or parts[0] != "ssh-ed25519":
        raise ValueError("Single ED25519 public key required")
    blob = base64.b64decode(parts[1], validate=True)
    # OpenSSH ED25519 wire format: string algorithm, string exactly32 bytes.
    if (len(blob) != 51 or struct.unpack(">I", blob[:4])[0] != 11
            or blob[4:15] != b"ssh-ed25519" or struct.unpack(">I", blob[15:19])[0] != 32):
        raise ValueError("Malformed ED25519 public key")
    return f"ssh-ed25519 {parts[1]} xmartmenu-private-transport\n".encode(), base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")


def atomic_replace(path, data, mode):
    checked(path.parent, True)
    fd, name = tempfile.mkstemp(prefix=".xmartmenu-transport-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(name)


class Receipt:
    def __init__(self, side, manifest):
        if STATE.exists():
            raise ValueError("Prior install state exists; inspect/rollback instead of overwriting")
        checked(STATE.parent, True)
        STATE.mkdir(mode=0o700)
        self.data = {"version": 1, "side": side, "host": Path("/etc/hostname").read_text().strip(),
                     "bundle": manifest, "created": [], "userCreated": False,
                     "sshdBefore": None, "sshdAfter": None, "status": "preparing",
                     "applicationCutover": False, "runtimeLoginEnabled": False}
        self.save()

    def save(self):
        atomic_replace(STATE / "receipt.json", (json.dumps(self.data, indent=2)+"\n").encode(), 0o600)

    def create(self, path, data, mode=0o600, uid=0, gid=0):
        checked(path.parent, True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        identity = os.fstat(fd)
        entry = {"path": str(path), "sha256": sha(data), "uid": uid, "mode": mode}
        appended = False
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
                # Affect only the fd we created, never a replaced pathname.
                os.fchown(handle.fileno(), uid, gid)
                os.fchmod(handle.fileno(), mode)
            self.data["created"].append(entry)
            appended = True
            self.save()
        except BaseException:
            if appended:
                self.data["created"].remove(entry)
            # O_EXCL proves ownership of this inode. Preserve a replacement by
            # another actor, and never unlink a path based only on its name.
            with contextlib.suppress(FileNotFoundError):
                current = path.lstat()
                if (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                    path.unlink()
            raise


def no_existing_user(name):
    try:
        pwd.getpwnam(name)
    except KeyError:
        pass
    else:
        raise ValueError("Dedicated account already exists; refuse reuse")
    try:
        grp.getgrnam(name)
    except KeyError:
        return
    raise ValueError("Dedicated group already exists; refuse reuse")


def preflight_paths(paths):
    if STATE.exists():
        raise ValueError("Prior install state exists")
    for path in paths:
        if path.exists() or path.is_symlink():
            raise ValueError("An installation target already exists")
        checked(path.parent if path.parent.exists() else path.parent.parent, True)
        if not path.parent.exists() and path.parent != LIB:
            raise ValueError("Unexpected missing install parent")


def port15432():
    rows = []
    for name in ["/proc/net/tcp", "/proc/net/tcp6"]:
        for line in Path(name).read_text().splitlines()[1:]:
            fields = line.split()
            if fields[1].split(":")[-1] == "3C48" and fields[3] == "0A":
                rows.append(fields[1])
    return rows


def load_local_admission(bundle):
    return module_at(bundle / "prepare-xmartmenu-private-transport.py")


def base_host(side):
    if os.getuid() != 0 or Path("/etc/hostname").read_text().strip() != ("skaleclub-server" if side == "client" else "skaleclub-mail"):
        raise ValueError("Exact host and root required")
    for path in [Path("/usr/local"), Path("/etc"), STATE.parent]:
        checked(path, True)
    if LIB.exists() or LIB.is_symlink():
        checked(LIB, True)


def check_ssh_policies(config, users, source):
    results = {}
    for user in users:
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+", user):
            raise ValueError("Unsupported local SSH identity")
        for address in sorted({"188.245.112.3", "127.0.0.1", source}):
            ipaddress.ip_address(address)
            context = f"user={user},addr={address},laddr=49.13.197.250,lport=22,host=skaleclub-server"
            args = ["/usr/sbin/sshd", "-T", "-C", context]
            if config is not None:
                args += ["-f", "/dev/stdin"]
            results[(user, address)] = run(args, config)
    return results


def dedicated_policy_guard(raw):
    own = dict(line.split(" ", 1) for line in raw.decode().splitlines())
    required = {"authorizedkeysfile": str(AUTH), "authenticationmethods": "publickey",
                "passwordauthentication": "no", "kbdinteractiveauthentication": "no",
                "permittty": "no", "permituserrc": "no", "disableforwarding": "yes",
                "clientaliveinterval": "5", "clientalivecountmax": "1",
                "forcecommand": "/usr/bin/sudo -n -- /usr/local/libexec/xmartmenu-pg-stdio.py"}
    if any(own.get(k) != v for k, v in required.items()):
        raise ValueError("Dedicated SSH policy not effective")


def ssh_candidate(original, fragment, source):
    # Append the Match block itself atEOF. An early wildcard include can leak
    # Match context into globals, or a conditional include could be skipped.
    candidate = original.rstrip(b"\n") + b"\n\n" + fragment
    users = sorted({entry.pw_name for entry in pwd.getpwall()})
    before = check_ssh_policies(None, users, source)
    after = check_ssh_policies(candidate, users, source)
    if before != after:
        raise ValueError("Existing SSH policy would change")
    own = check_ssh_policies(candidate, [SERVER_USER], "188.245.112.3")[(SERVER_USER, "188.245.112.3")]
    dedicated_policy_guard(own)
    run(["/usr/sbin/sshd", "-t", "-f", "/dev/stdin"], candidate)
    digest = sha(b"\n".join(before[k] for k in sorted(before)))
    return candidate, users, digest


def install_client(bundle, manifest):
    base_host("client")
    no_existing_user(CLIENT_USER)
    destinations = [LIB / name for name in ["prepare-xmartmenu-private-transport.py", "xmartmenu-private-forwarder.py", "xmartmenu-pg-stdio.py"]]
    preflight_paths([*destinations, CONFIG, UNIT])
    admission = load_local_admission(bundle).admit_local("client")
    if port15432():
        raise ValueError("15432 already listening")
    run(["/usr/bin/systemd-analyze", "verify", "--man=no", str(bundle / "xmartmenu-private-transport.service")])
    receipt = Receipt("client", manifest)
    receipt.data["admission"] = admission
    LIB.mkdir(mode=0o755, exist_ok=True)
    checked(LIB, True)
    run(["/usr/sbin/useradd", "--system", "--no-create-home", "--home-dir", "/nonexistent", "--shell", "/usr/sbin/nologin", "--password", "!", "--user-group", CLIENT_USER])
    user = pwd.getpwnam(CLIENT_USER)
    receipt.data.update(userCreated=True, uid=user.pw_uid)
    receipt.save()
    CONFIG.mkdir(mode=0o755)
    for path in destinations:
        receipt.create(path, (bundle / path.name).read_bytes(), 0o755)
    receipt.create(CONFIG / "known_hosts", (bundle / "known_hosts").read_bytes(), 0o644)
    # Key generation is LOCAL ON188, never loaded into Python or coordinator output.
    run(["/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "xmartmenu-private-transport", "-f", str(CONFIG / "id_ed25519")])
    os.chown(CONFIG / "id_ed25519", user.pw_uid, user.pw_gid)
    os.chmod(CONFIG / "id_ed25519", 0o600)
    key, fingerprint = public_key((CONFIG / "id_ed25519.pub").read_bytes())
    receipt.data["publicKeySha256"] = fingerprint
    receipt.save()
    receipt.create(UNIT, (bundle / UNIT_NAME).read_bytes(), 0o644)
    run(["/usr/bin/systemctl", "daemon-reload"])
    # Intentionally not enabled/started until server authorization is reviewed.
    receipt.data["status"] = "client_prepared_not_started"
    receipt.save()
    return {"side": "client", "status": receipt.data["status"], "publicKeySha256": fingerprint,
            "privateKeyRemainsOn188": True, "applicationCutover": False, "runtimeLoginEnabled": False}


def install_server(bundle, manifest, key_path):
    base_host("server")
    no_existing_user(SERVER_USER)
    script = LIB / "xmartmenu-pg-stdio.py"
    # Auth directory itself can be created only if absent; never rewrite other keys.
    for parent in [AUTH.parent, Path("/var/lib/xmartmenu-pg-ssh")]:
        if parent.exists():
            checked(parent, True)
    preflight_paths([script, SUDO, TMPFILES])
    if AUTH.exists() or AUTH.is_symlink() or Path("/var/lib/xmartmenu-pg-ssh").exists():
        raise ValueError("Server identity storage already exists")
    checked(key_path, private=True)
    key, fingerprint = public_key(key_path.read_bytes())
    checked(SSHD)
    if Path("/etc/ssh/sshrc").exists():
        raise ValueError("Unreviewed global ssh rc")
    source = os.environ.get("SSH_CONNECTION", "").split()
    if len(source) != 4:
        raise ValueError("Administrative SSH source required")
    admission = load_local_admission(bundle).admit_local("server")
    original = SSHD.read_bytes()
    candidate, users, policies = ssh_candidate(original, (bundle / "sshd-match.conf").read_bytes(), source[0])
    run(["/usr/sbin/visudo", "-c", "-f", "-"], (bundle / "sudoers").read_bytes())
    run(["/usr/bin/systemctl", "is-active", "--quiet", "ssh.service"])
    receipt = Receipt("server", manifest)
    receipt.data.update(admission=admission, publicKeySha256=fingerprint,
                        sshdBefore=sha(original), sshdAfter=sha(candidate), sshUsers=users,
                        sshSource=source[0], sshPolicyDigest=policies)
    receipt.save()
    receipt.create(STATE / "sshd_config.before", original)
    LIB.mkdir(mode=0o755, exist_ok=True)
    checked(LIB, True)
    run(["/usr/sbin/useradd", "--system", "--no-create-home", "--home-dir", "/var/lib/xmartmenu-pg-ssh", "--shell", "/bin/sh", "--password", "!", "--user-group", SERVER_USER])
    receipt.data.update(userCreated=True, uid=pwd.getpwnam(SERVER_USER).pw_uid)
    receipt.save()
    Path("/var/lib/xmartmenu-pg-ssh").mkdir(mode=0o755)
    AUTH.parent.mkdir(mode=0o755, exist_ok=True)
    receipt.create(script, (bundle / script.name).read_bytes(), 0o755)
    receipt.create(SUDO, (bundle / "sudoers").read_bytes(), 0o440)
    receipt.create(TMPFILES, (bundle / "tmpfiles.conf").read_bytes(), 0o644)
    run(["/usr/bin/systemd-tmpfiles", "--create", str(TMPFILES)])
    prefix = load_local_admission(bundle).KEY_PREFIX
    # sshd reads AuthorizedKeysFile while temporarily using the target uid.
    # Public root-owned0644 is readable but cannot be edited by the SSH account.
    receipt.create(AUTH, prefix.encode() + b" " + key, 0o644)
    if sha(SSHD.read_bytes()) != receipt.data["sshdBefore"]:
        raise ValueError("Concurrent SSH config change; state retained")
    atomic_replace(SSHD, candidate, stat.S_IMODE(SSHD.stat().st_mode))
    run(["/usr/sbin/sshd", "-t"])
    current = check_ssh_policies(None, users, source[0])
    if sha(b"\n".join(current[k] for k in sorted(current))) != policies:
        raise ValueError("Existing effective SSH policy changed; rollback required")
    dedicated_policy_guard(check_ssh_policies(None, [SERVER_USER], "188.245.112.3")[(SERVER_USER, "188.245.112.3")])
    run(["/usr/bin/systemctl", "reload", "ssh.service"])
    receipt.data["status"] = "server_authorized_no_sql_login"
    receipt.save()
    return {"side": "server", "status": receipt.data["status"], "existingSshUsersChecked": len(users),
            "publicKeySha256": fingerprint, "applicationCutover": False, "runtimeLoginEnabled": False}


def receipt_read(side, allow_missing=False):
    base_host(side)
    checked(STATE, True, True)
    checked(STATE / "receipt.json", private=True)
    value = json.loads((STATE / "receipt.json").read_bytes())
    if value.get("version") != 1 or value.get("side") != side or value.get("applicationCutover") is not False or value.get("runtimeLoginEnabled") is not False:
        raise ValueError("Unexpected install receipt")
    for entry in value["created"]:
        path = Path(entry["path"])
        allowed = ({LIB / n for n in ["prepare-xmartmenu-private-transport.py", "xmartmenu-private-forwarder.py", "xmartmenu-pg-stdio.py"]} | {CONFIG / "known_hosts", UNIT}) if side == "client" else {LIB / "xmartmenu-pg-stdio.py", SUDO, TMPFILES, AUTH, STATE / "sshd_config.before"}
        if path not in allowed:
            raise ValueError("Receipt path outside owned installation")
        if allow_missing and not path.exists() and not path.is_symlink():
            continue
        checked(path)
        if sha(path.read_bytes()) != entry["sha256"]:
            raise ValueError("Installed source changed; manual review required")
    return value


def verify_client(start=False):
    value = receipt_read("client")
    if start:
        # Explicit manual recovery when the SAME pinned bridge device returns.
        # BindsTo stops the unit; dependency loss is not an on-failure restart.
        admission = json.loads(run(["/usr/bin/python3", "-I", str(LIB / "prepare-xmartmenu-private-transport.py"), "--admit-local", "client"], timeout=15))
        if admission.get("admitted") is not True:
            raise ValueError("Current app network/capacity not admitted")
        run(["/usr/bin/systemctl", "enable", UNIT_NAME])
        run(["/usr/bin/systemctl", "start", UNIT_NAME], timeout=25)
        for _ in range(15):
            if port15432():
                break
            time.sleep(.2)
    raw = run(["/usr/bin/systemctl", "show", UNIT_NAME, "--property=ActiveState,User,MemoryMax,MemoryHigh,MemorySwapMax,TasksMax,ControlGroup"])
    properties = dict(line.split("=", 1) for line in raw.decode().splitlines())
    required = {"ActiveState": "active", "User": CLIENT_USER, "MemoryMax": "134217728",
                "MemoryHigh": "100663296", "MemorySwapMax": "0", "TasksMax": "32"}
    if any(properties.get(k) != v for k, v in required.items()) or port15432() != ["0104000A:3C48"]:
        raise ValueError("Unit or private listener proof refused")
    health = json.loads(run(["/usr/sbin/runuser", "-u", CLIENT_USER, "--", "/usr/bin/python3", "-I", str(LIB / "xmartmenu-private-forwarder.py"), "--health"], timeout=10))
    if health != {"healthy": True}:
        raise ValueError("Read-only protocol health failed")
    cg = Path("/sys/fs/cgroup" + properties["ControlGroup"])
    memory = int((cg / "memory.current").read_text())
    events = dict(line.split() for line in (cg / "memory.events").read_text().splitlines())
    if memory > 134217728 or any(int(events[k]) for k in ["max", "oom", "oom_kill"]):
        raise ValueError("Transport cgroup pressure; budget review required")
    if start:
        value["status"] = "transport_only_verified_no_cutover"
        atomic_replace(STATE / "receipt.json", (json.dumps(value, indent=2)+"\n").encode(), 0o600)
    return {"side": "client", "transportHealthy": True, "privateListenerOnly": True,
            "memoryCurrentMiB": memory//1048576, "applicationCutover": False,
            "runtimeLoginEnabled": False, "twelveChannelBudgetProven": False}


def verify_server():
    value = receipt_read("server")
    checked(SSHD)
    if sha(SSHD.read_bytes()) != value["sshdAfter"]:
        raise ValueError("Installed SSH config digest changed")
    policies = check_ssh_policies(None, value["sshUsers"], value["sshSource"])
    if sha(b"\n".join(policies[k] for k in sorted(policies))) != value["sshPolicyDigest"]:
        raise ValueError("Existing SSH policies changed")
    dedicated_policy_guard(check_ssh_policies(None, [SERVER_USER], "188.245.112.3")[(SERVER_USER, "188.245.112.3")])
    run(["/usr/sbin/sshd", "-t"])
    run(["/usr/sbin/visudo", "-c", "-f", str(SUDO)])
    wrapper = module_at(LIB / "xmartmenu-pg-stdio.py")
    identity = wrapper.target_guard(json.loads(run([*wrapper.DOCKER, "inspect", wrapper.TARGET]))[0])
    query = "BEGIN READ ONLY; SET LOCAL statement_timeout=3000; SELECT EXISTS(SELECT FROM pg_roles WHERE rolname='xmartmenu_runtime' AND NOT rolcanlogin AND rolconnlimit=12); ROLLBACK;"
    dormant = run([*wrapper.DOCKER, "exec", "-u", "postgres", identity, "psql", "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "xmail_owner", "-d", "postgres", "-c", query]).strip()
    if dormant != b"t":
        raise ValueError("Runtime role no longer dormant")
    return {"side": "server", "pinsAndSshPoliciesVerified": True,
            "existingSshUsersChecked": len(value["sshUsers"]),
            "runtimeLoginEnabled": False, "applicationCutover": False}


def rollback(side):
    value = receipt_read(side, allow_missing=True)
    created = {Path(entry["path"]) for entry in value["created"]}
    if side == "client":
        if UNIT in created and UNIT.exists():
            run(["/usr/bin/systemctl", "disable", "--now", UNIT_NAME])
        if port15432():
            raise ValueError("Listener still active; refuse cleanup")
        # Preserve the private key ONLY on188, quarantined root-only before the
        # dormant account could ever be recycled. Never print/hash private bytes.
        key = CONFIG / "id_ed25519"
        if key.exists():
            info = key.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != value["uid"] or info.st_mode & 0o077:
                raise ValueError("Private key ownership changed")
            os.chown(key, 0, 0)
            key.rename(STATE / "retained-client-private-key")
        # Public key is harmless; preserve as a receipt rather than deleting it.
        if (CONFIG / "id_ed25519.pub").exists():
            (CONFIG / "id_ed25519.pub").rename(STATE / "retained-client-public-key")
    else:
        import fcntl
        locks = []
        try:
            if AUTH in created and AUTH.exists():
                for n in range(12):
                    fd = os.open(f"/run/xmartmenu-pg-stdio/{n}", os.O_RDONLY | os.O_NOFOLLOW)
                    locks.append(fd)
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            checked(SSHD)
            current = sha(SSHD.read_bytes())
            if current not in (value["sshdBefore"], value["sshdAfter"]):
                raise ValueError("Shared SSH config changed; refuse overwrite")
            if current == value["sshdAfter"]:
                original = (STATE / "sshd_config.before").read_bytes()
                if sha(original) != value["sshdBefore"]:
                    raise ValueError("SSH recovery digest mismatch")
                run(["/usr/sbin/sshd", "-t", "-f", "/dev/stdin"], original)
                atomic_replace(SSHD, original, stat.S_IMODE(SSHD.stat().st_mode))
                run(["/usr/bin/systemctl", "reload", "ssh.service"])
        finally:
            for fd in locks:
                os.close(fd)
    for entry in reversed(value["created"]):
        path = Path(entry["path"])
        if path.parent == STATE:
            continue  # Keep the authenticated recovery receipt/config backup.
        if not path.exists() and not path.is_symlink():
            continue
        if sha(path.read_bytes()) != entry["sha256"]:
            raise ValueError("Concurrent installed-file change; refuse unlink")
        path.unlink()
    if side == "client":
        run(["/usr/bin/systemctl", "daemon-reload"])
    # Own accounts remain locked, without keys/sudo/service. No user/group deletion,
    # recursive removal, DB change or shared daemon restart is needed for rollback.
    value["status"] = "rolled_back_locked_account_and_receipts_retained"
    atomic_replace(STATE / "receipt.json", (json.dumps(value, indent=2)+"\n").encode(), 0o600)
    return {"rolledBack": True, "side": side, "privateRecoveryRetainedLocally": True,
            "applicationCutover": False, "runtimeLoginEnabled": False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", nargs="?", choices=["plan", "install-client", "install-server", "start-client", "verify-client", "verify-server", "rollback-client", "rollback-server"], default="plan")
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--expected-manifest-sha256")
    parser.add_argument("--expected-operator-sha256")
    parser.add_argument("--public-key-file", type=Path)
    parser.add_argument("--execute-reviewed-install", action="store_true")
    args = parser.parse_args()
    if args.action == "plan":
        return {"plan": "PLAN ONLY: staged client key stays on188; server restricted key; start/verify separately; no app/SQL cutover", "applicationCutover": False, "runtimeLoginEnabled": False}
    if not re.fullmatch("[0-9a-f]{64}", args.expected_operator_sha256 or "") or sha(Path(__file__).read_bytes()) != args.expected_operator_sha256:
        parser.error("Exact reviewed operator hash required")
    checked(Path(__file__), private=True)
    if not args.action.startswith("verify-") and not args.execute_reviewed_install:
        parser.error("Explicit --execute-reviewed-install required")
    import fcntl
    fd = os.open("/run/lock/xmartmenu-private-transport-install.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1:
            raise ValueError("Unsafe install lock; refuse precreated/untrusted inode")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action.startswith("rollback-"):
            return rollback(args.action.split("-", 1)[1])
        if args.action in ["start-client", "verify-client"]:
            return verify_client(args.action == "start-client")
        if args.action == "verify-server":
            return verify_server()
        if not args.bundle:
            parser.error("Reviewed offline bundle required")
        manifest = verify_bundle(args.bundle, args.expected_manifest_sha256)
        if args.action == "install-client":
            return install_client(args.bundle, manifest)
        if not args.public_key_file:
            parser.error("Explicit root-owned staged CLIENT PUBLIC key required")
        return install_server(args.bundle, manifest, args.public_key_file)
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception:
        print("Install refused; preserve root-only receipt/state and review before retry or rollback", file=sys.stderr)
        sys.exit(1)
