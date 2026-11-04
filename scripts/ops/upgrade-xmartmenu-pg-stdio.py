#!/usr/bin/python3 -I
"""One-wrapper source+receipt revision; explicit digest-guarded rollback, no SQL writes."""
import argparse
import ast
import contextlib
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

sys.dont_write_bytecode = True
STAGE = Path("/tmp/xmartmenu-private-transport-stage-20261104T131617Z-e11950c4")
INSTALLER_SHA = "c06bb6a09be447b9e6486c000eb655cc1a0b393e8fa36f4b111cfe6970aaf0d1"
OLD_SHA = "0039d08b691a9b9e462e77a5a6c8262700ceab6239a3647bb01bb18a72a8d040"
STATE = Path("/var/lib/xmartmenu-private-transport-install")
SCRIPT = Path("/usr/local/libexec/xmartmenu-pg-stdio.py")
RECEIPT = STATE / "receipt.json"
BACKUP = STATE / "stdio-host-relay-v2"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def checked(path, directory=False):
    value = path.lstat()
    if (not (stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode))
            or value.st_uid != 0 or value.st_mode & 0o022):
        raise ValueError("Unsafe root-owned upgrade path")
    return value


def revision(before, new_sha, upgrade_sha):
    result = copy.deepcopy(before)
    if (result.get("side") != "server" or result.get("applicationCutover") is not False
            or result.get("runtimeLoginEnabled") is not False or result.get("stdioImplementation") is not None):
        raise ValueError("Unexpected existing receipt revision")
    entries = [entry for entry in result.get("created", []) if entry.get("path") == str(SCRIPT)]
    if len(entries) != 1 or entries[0].get("sha256") != OLD_SHA or entries[0].get("uid") != 0 or entries[0].get("mode") != 0o755:
        raise ValueError("Old reviewed wrapper receipt mismatch")
    entries[0]["sha256"] = new_sha
    result["stdioImplementation"] = {"version": 2, "kind": "pinned-private-host-socket",
                                     "oldSourceSha256": OLD_SHA, "sourceSha256": new_sha,
                                     "upgradeOperatorSha256": upgrade_sha, "recovery": str(BACKUP),
                                     "connectTimeoutSeconds": 5, "bufferBytes": 32768,
                                     "idleDeadline": False, "dropsRootBeforeBytes": True}
    # The original bundle is historical and stays byte-for-byte represented.
    if result.get("bundle") != before.get("bundle"):
        raise ValueError("Historical bundle must remain unchanged")
    return result


def checked_states(wrapper_sha, receipt_sha, plan):
    if wrapper_sha not in (plan["oldWrapperSha256"], plan["newWrapperSha256"]):
        raise ValueError("Concurrent wrapper change; refuse overwrite")
    if receipt_sha not in (plan["beforeReceiptSha256"], plan["afterReceiptSha256"]):
        raise ValueError("Concurrent receipt change; refuse overwrite")


def reserve_all():
    import fcntl
    root = Path("/run/xmartmenu-pg-stdio")
    checked(root, True)
    held = []
    try:
        for n in range(12):
            path = root / str(n)
            checked(path)
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            held.append(fd)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return held
    except BaseException:
        for fd in held:
            os.close(fd)
        raise


def installer():
    source = STAGE / "install-xmartmenu-private-transport.py"
    checked(STAGE, True)
    checked(source)
    if sha(source.read_bytes()) != INSTALLER_SHA:
        raise ValueError("Original installer source changed")
    spec = importlib.util.spec_from_file_location("reviewed_installer", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def create_backup(name, raw):
    fd = os.open(BACKUP / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())


def apply(args, own_sha, tool):
    checked(args.new_source)
    new = args.new_source.read_bytes()
    if sha(new) != args.expected_new_sha256 or b"\r" in new:
        raise ValueError("Exact reviewed LF source required")
    ast.parse(new)
    checked(SCRIPT)
    checked(STATE, True)
    checked(RECEIPT)
    if sha(SCRIPT.read_bytes()) != OLD_SHA:
        raise ValueError("Installed old wrapper source differs")
    before_raw = RECEIPT.read_bytes()
    if sha(before_raw) != args.expected_receipt_sha256:
        raise ValueError("Current receipt digest differs")
    tool.verify_server()  # Bounded READ ONLY role/pins/policy verification.
    before = json.loads(before_raw)
    after_raw = (json.dumps(revision(before, sha(new), own_sha), indent=2)+"\n").encode()
    old = SCRIPT.read_bytes()
    if BACKUP.exists() or BACKUP.is_symlink():
        raise ValueError("Prior upgrade recovery exists; inspect instead of retry")
    BACKUP.mkdir(mode=0o700)
    plan = {"version": 1, "oldWrapperSha256": sha(old), "newWrapperSha256": sha(new),
            "beforeReceiptSha256": sha(before_raw), "afterReceiptSha256": sha(after_raw),
            "upgradeOperatorSha256": own_sha, "applicationCutover": False, "runtimeLoginEnabled": False}
    create_backup("old-wrapper.py", old)
    create_backup("receipt.before.json", before_raw)
    create_backup("receipt.after.json", after_raw)
    create_backup("manifest.json", (json.dumps(plan, indent=2)+"\n").encode())
    directory = os.open(BACKUP, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    # Persist the recovery directory's entry in its parent before touching the
    # installed pair; fsync(BACKUP) alone does not durably create that entry.
    directory = os.open(STATE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    checked_states(sha(SCRIPT.read_bytes()), sha(RECEIPT.read_bytes()), plan)
    # Two local files cannot be committed in one filesystem primitive. On error
    # preserve the exact pair/recovery for explicit rollback, never blind retry.
    tool.atomic_replace(SCRIPT, new, 0o755)
    if sha(RECEIPT.read_bytes()) != plan["beforeReceiptSha256"]:
        raise ValueError("Receipt changed during replacement; preserve recovery")
    tool.atomic_replace(RECEIPT, after_raw, 0o600)
    if sha(SCRIPT.read_bytes()) != plan["newWrapperSha256"] or sha(RECEIPT.read_bytes()) != plan["afterReceiptSha256"]:
        raise ValueError("Upgrade pair verification failed; preserve recovery")
    tool.verify_server()
    return {"upgraded": True, "wrapperSha256": sha(new), "receiptSha256": sha(after_raw),
            "recoveryManifestSha256": sha((BACKUP/"manifest.json").read_bytes()),
            "runtimeLoginEnabled": False, "applicationCutover": False}


def rollback(args, tool):
    checked(BACKUP, True)
    for name in ["manifest.json", "old-wrapper.py", "receipt.before.json"]:
        checked(BACKUP / name)
    raw = (BACKUP / "manifest.json").read_bytes()
    if sha(raw) != args.expected_recovery_sha256:
        raise ValueError("Exact recovery manifest digest required")
    plan = json.loads(raw)
    if (plan.get("version") != 1 or plan.get("oldWrapperSha256") != OLD_SHA
            or plan.get("runtimeLoginEnabled") is not False or plan.get("applicationCutover") is not False):
        raise ValueError("Unexpected recovery contract")
    old = (BACKUP / "old-wrapper.py").read_bytes()
    before = (BACKUP / "receipt.before.json").read_bytes()
    if sha(old) != OLD_SHA or sha(before) != plan["beforeReceiptSha256"]:
        raise ValueError("Recovery source digest mismatch")
    checked(SCRIPT)
    checked(RECEIPT)
    checked_states(sha(SCRIPT.read_bytes()), sha(RECEIPT.read_bytes()), plan)
    tool.atomic_replace(SCRIPT, old, 0o755)
    tool.atomic_replace(RECEIPT, before, 0o600)
    tool.verify_server()
    return {"rolledBack": True, "sourceSha256": OLD_SHA, "runtimeLoginEnabled": False,
            "applicationCutover": False, "clientMustRemainStopped": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", nargs="?", choices=["plan", "apply", "rollback"], default="plan")
    parser.add_argument("--new-source", type=Path)
    parser.add_argument("--expected-new-sha256")
    parser.add_argument("--expected-receipt-sha256")
    parser.add_argument("--expected-recovery-sha256")
    parser.add_argument("--expected-operator-sha256")
    parser.add_argument("--confirmed-client-stopped", action="store_true")
    parser.add_argument("--execute-reviewed-upgrade", action="store_true")
    args = parser.parse_args()
    if args.action == "plan":
        return {"plan": "PLAN ONLY: one fixed wrapper + guarded receipt revision; preserve old source/recovery; no app/SQL change"}
    if os.getuid() != 0 or Path("/etc/hostname").read_text().strip() != "skaleclub-mail":
        raise ValueError("Exact PG host/root required")
    checked(Path(__file__))
    own_sha = sha(Path(__file__).read_bytes())
    if args.expected_operator_sha256 != own_sha or not args.confirmed_client_stopped or not args.execute_reviewed_upgrade:
        raise ValueError("Explicit reviewed hash/stopped-client/upgrade required")
    import fcntl
    fd = os.open("/run/lock/xmartmenu-private-transport-install.lock", os.O_RDWR | os.O_NOFOLLOW)
    held = []
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1:
            raise ValueError("Unsafe install lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        held = reserve_all()
        tool = installer()
        if args.action == "rollback":
            return rollback(args, tool)
        if not args.new_source or not args.expected_new_sha256 or not args.expected_receipt_sha256:
            raise ValueError("New source and exact before digests required")
        return apply(args, own_sha, tool)
    finally:
        for lock in held:
            os.close(lock)
        os.close(fd)


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception:
        print("Upgrade refused; preserve source/receipt/recovery and do not retry blindly", file=sys.stderr)
        sys.exit(1)
