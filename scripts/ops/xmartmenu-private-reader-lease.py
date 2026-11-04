#!/usr/bin/python3 -I
"""Private controller child. Four-minute SELECT lease; default plan only."""
import argparse
import contextlib
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import select
import stat
import struct
import subprocess
import sys
import time

sys.dont_write_bytecode = True
TARGET = "e12scyfsrp822dag7m9wwd4x"
ROLE = "xmartmenu_staging_reader"
RUNTIME = "xmartmenu_runtime"
DATABASE = "xmartmenu"
LEASE_SECONDS = 240
WRAPPER = Path("/usr/local/libexec/xmartmenu-pg-stdio.py")
WRAPPER_SHA = "3ceff767ed9b062b52c2c1784769dd0b10e29e5494ef081a79a536fed1727a5f"
LOCK = Path("/var/lib/xmartmenu-private-transport-install/reader-lease.lock")
DOCKER = ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock"]
_transport = None
QUIET = """BEGIN;
SET LOCAL statement_timeout=5000;
SET LOCAL lock_timeout=2000;
SET LOCAL log_statement='none';
SET LOCAL log_duration=off;
SET LOCAL log_min_duration_statement=-1;
SET LOCAL log_min_duration_sample=-1;
SET LOCAL log_statement_sample_rate=0;
SET LOCAL log_min_error_statement='panic';
SET LOCAL log_min_messages='panic';
SET LOCAL log_parameter_max_length=0;
SET LOCAL log_parameter_max_length_on_error=0;
SET LOCAL pg_stat_statements.track='none';
"""


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read_line(fd=0, limit=4096):
    raw = bytearray()
    while len(raw) < limit:
        value = os.read(fd, 1)
        if not value:
            raise ValueError("Private controller channel closed")
        if value == b"\n":
            return json.loads(raw)
        raw.extend(value)
    raise ValueError("Private control packet too large")


def emit_frame(value):
    raw = json.dumps(value, separators=(",", ":")).encode()
    if len(raw) > 8192:
        raise ValueError("Private frame too large")
    sys.stdout.buffer.write(struct.pack(">I", len(raw))+raw)
    sys.stdout.buffer.flush()


def checked(path, directory=False):
    info = path.lstat()
    if (not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or info.st_uid != 0 or info.st_mode & 0o022):
        raise ValueError("Unsafe private lease storage")


def host_guard(expected):
    global _transport
    if os.getuid() != 0 or Path("/etc/hostname").read_text().strip() != "skaleclub-mail":
        raise ValueError("Exact PG host/root required")
    checked(Path(__file__))
    if not re.fullmatch(r"[a-f0-9]{64}", expected or "") or sha(Path(__file__).read_bytes()) != expected:
        raise ValueError("Reviewed lease operator hash required")
    checked(WRAPPER)
    if sha(WRAPPER.read_bytes()) != WRAPPER_SHA:
        raise ValueError("Reviewed transport source required")
    spec = importlib.util.spec_from_file_location("pinned_transport", WRAPPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.snapshot_guard(module.inspected(TARGET))
    _transport = module


def sql(text):
    if _transport is None:
        raise ValueError("Verified cluster required before role SQL")
    identity, _, _ = _transport.snapshot_guard(_transport.inspected(TARGET))
    result = subprocess.run([*DOCKER, "exec", "-i", "-u", "postgres", identity, "psql", "-X", "-w", "-qAt",
                             "-v", "ON_ERROR_STOP=1", "-U", "xmail_owner", "-d", DATABASE],
                            input=text.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=8, env={"PATH": "/usr/bin:/bin", "LANG": "C"})
    if result.returncode:
        # Never surface SQL text, raw stderr, bound data or credential verifier.
        raise ValueError("Private role SQL refused")
    return result.stdout.strip()


def preflight():
    query = """BEGIN READ ONLY; SET LOCAL statement_timeout=5000;
SELECT json_build_object(
 'database',current_database(),
 'runtimeDormant',EXISTS(SELECT FROM pg_roles WHERE rolname='xmartmenu_runtime' AND NOT rolcanlogin AND rolconnlimit=12),
 'readerSafe',EXISTS(SELECT FROM pg_roles WHERE rolname='xmartmenu_staging_reader' AND NOT rolcanlogin
 AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolbypassrls AND rolconnlimit=2
 AND coalesce(rolconfig,'{}') @> ARRAY['default_transaction_read_only=on']),
 'readerPasswordNull',(SELECT rolpassword IS NULL FROM pg_authid WHERE rolname='xmartmenu_staging_reader'),
 'noMemberships',NOT EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='xmartmenu_staging_reader'),
 'readerSessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='xmartmenu_staging_reader'),
 'canCreate',has_schema_privilege('xmartmenu_staging_reader','public','CREATE'),
 'allTablesSelect',(SELECT bool_and(has_table_privilege('xmartmenu_staging_reader',c.oid,'SELECT')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
 'anyTableWrite',(SELECT bool_or(has_table_privilege('xmartmenu_staging_reader',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
 'preload',current_setting('shared_preload_libraries'));
ROLLBACK;
"""
    value = json.loads(sql(query))
    if (value.get("database") != DATABASE or not all(value.get(k) is True for k in
            ["runtimeDormant", "readerSafe", "readerPasswordNull", "noMemberships", "allTablesSelect"])
            or value.get("readerSessions") != 0 or value.get("canCreate") or value.get("anyTableWrite")):
        raise ValueError("Dormant SELECT-only reader preflight refused")
    modules = {x.strip().strip('"') for x in value.get("preload", "").split(",") if x.strip()}
    if not modules.issubset({"pg_stat_statements"}):
        raise ValueError("Unreviewed audit/preload module; no credential generated")
    return value


def verifier(secret):
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", secret.encode(), salt, 4096)
    client = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored = hashlib.sha256(client).digest()
    server = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    encoded = lambda value: base64.b64encode(value).decode()
    return f"SCRAM-SHA-256$4096:{encoded(salt)}${encoded(stored)}:{encoded(server)}"


def grant(secret_verifier, deadline):
    if not re.fullmatch(r"SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+", secret_verifier):
        raise ValueError("Invalid generated SCRAM verifier")
    if type(deadline) is not int or not time.time()+30 < deadline <= time.time()+LEASE_SECONDS:
        raise ValueError("Invalid bounded validity")
    stamp = time.strftime("%Y-%m-%d %H:%M:%S+00", time.gmtime(deadline))
    sql(QUIET + f"ALTER ROLE {ROLE} LOGIN PASSWORD '{secret_verifier}' VALID UNTIL '{stamp}';\nCOMMIT;\n")


def revoke(nonce):
    if not re.fullmatch(r"[a-f0-9]{32}", nonce):
        raise ValueError("Invalid lease nonce")
    # Only this fixed reader and this proof's existing sessions. No global Auth,
    # runtime, Xmail role or application table is changed.
    result = sql(QUIET + f"ALTER ROLE {ROLE} NOLOGIN PASSWORD NULL;\n"
                 f"SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='{DATABASE}' AND usename='{ROLE}' AND application_name='xmartmenu-read-proof-{nonce}' AND pid<>pg_backend_pid()) stopped;\nCOMMIT;\n")
    check = json.loads(sql("BEGIN READ ONLY; SET LOCAL statement_timeout=3000; SELECT json_build_object("
                           f"'readerDormant',EXISTS(SELECT FROM pg_authid WHERE rolname='{ROLE}' AND NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=2),"
                           f"'runtimeDormant',EXISTS(SELECT FROM pg_roles WHERE rolname='{RUNTIME}' AND NOT rolcanlogin AND rolconnlimit=12),"
                           f"'readerSessions',(SELECT count(*) FROM pg_stat_activity WHERE usename='{ROLE}')); ROLLBACK;"))
    if check != {"readerDormant": True, "runtimeDormant": True, "readerSessions": 0}:
        raise ValueError("Private reader cleanup not proven")
    return check


def request_guard(value):
    if (not isinstance(value, dict) or set(value) != {"protocol", "nonce", "bundleSha256", "appCommit"}
            or value.get("protocol") != "xmartmenu-private-read-v1"
            or not re.fullmatch(r"[a-f0-9]{32}", value.get("nonce", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("bundleSha256", ""))
            or not re.fullmatch(r"[a-f0-9]{40}", value.get("appCommit", ""))):
        raise ValueError("Fixed private read-proof request required")
    return value


def watchdog(expected):
    host_guard(expected)
    plan = read_line()
    if (set(plan) != {"nonce", "deadline", "lockFd"} or not re.fullmatch(r"[a-f0-9]{32}", plan.get("nonce", ""))
            or type(plan["deadline"]) is not int or not time.time() < plan["deadline"] <= time.time()+LEASE_SECONDS
            or type(plan["lockFd"]) is not int or plan["lockFd"] < 3):
        raise ValueError("Invalid cleanup watchdog plan")
    # The inherited OFD keeps the lease lock even if the owner disappears.
    info = os.fstat(plan["lockFd"])
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1:
        raise ValueError("Unsafe inherited lease lock")
    sys.stdout.write('{"ready":true}\n')
    sys.stdout.flush()
    select.select([0], [], [], max(0, plan["deadline"]-time.time()))
    # A killed owner could leave its bounded grant subprocess in flight. Revoke
    # idempotently during a20s settling window, never retry the LOGIN grant.
    settle = time.monotonic()+20
    final = None
    while True:
        try:
            final = revoke(plan["nonce"])
        except Exception:
            final = None
        if time.monotonic() >= settle:
            break
        time.sleep(1)
    if final is None:
        raise ValueError("Watchdog cleanup refused; explicit recovery required")
    sys.stdout.write(json.dumps({"revoked": True, **final})+"\n")
    sys.stdout.flush()


def serve(expected):
    import fcntl
    host_guard(expected)
    request = request_guard(read_line())
    checked(LOCK.parent, True)
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    child = None
    granted = False
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1:
            raise ValueError("Unsafe private reader lease lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        preflight()
        deadline = int(time.time())+LEASE_SECONDS
        child = subprocess.Popen(["/usr/bin/python3", "-I", str(Path(__file__).resolve()), "--watch-cleanup", "--expected-operator-sha256", expected],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 pass_fds=(fd,), start_new_session=True)
        child.stdin.write((json.dumps({"nonce": request["nonce"], "deadline": deadline, "lockFd": fd})+"\n").encode())
        child.stdin.flush()
        if not select.select([child.stdout], [], [], 8)[0] or json.loads(child.stdout.readline()) != {"ready": True}:
            raise ValueError("Independent cleanup watchdog not ready")
        secret = secrets.token_urlsafe(32)
        grant(verifier(secret), deadline)
        granted = True
        # Secret binary frame is consumed ONLY by the private controller pipe.
        # Never run this child directly in a tool/terminal that logs stdout.
        emit_frame({"protocol": "xmartmenu-private-read-v1", "nonce": request["nonce"],
                    "password": secret, "validUntil": deadline*1000})
        secret = None
        select.select([0], [], [], 120)
    finally:
        try:
            if child is not None:
                with contextlib.suppress(BrokenPipeError):
                    child.stdin.close()  # EOF causes cleanup, including on lost controller.
                if select.select([child.stdout], [], [], 45)[0]:
                    response = json.loads(child.stdout.readline())
                    if response.get("revoked") is not True:
                        raise ValueError("Watchdog cleanup acknowledgement missing")
                    if granted:
                        emit_frame({"revoked": True, "readerDormant": True, "runtimeDormant": True,
                                    "readerSessions": 0, "applicationDataWrites": False})
                else:
                    raise ValueError("Watchdog cleanup deadline; explicit recovery required")
                if child.wait(timeout=3) != 0:
                    raise ValueError("Cleanup watchdog did not exit cleanly")
        finally:
            os.close(fd)


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--serve-private-lease", action="store_true")
    mode.add_argument("--watch-cleanup", action="store_true")
    mode.add_argument("--recover-private-lease", action="store_true")
    mode.add_argument("--plan", action="store_true")
    parser.add_argument("--expected-operator-sha256")
    parser.add_argument("--public-nonce")
    parser.add_argument("--execute-reviewed-recovery", action="store_true")
    args = parser.parse_args()
    if not args.serve_private_lease and not args.watch_cleanup and not args.recover_private_lease:
        print(json.dumps({"plan": "PLAN ONLY: private controlled SELECT lease, existing reader only, no LOGIN/password/service changes", "runtimeLoginEnabled": False}))
        return
    if args.recover_private_lease:
        if not args.execute_reviewed_recovery:
            raise ValueError("Explicit reviewed recovery required")
        host_guard(args.expected_operator_sha256)
        import fcntl
        fd = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print(json.dumps({"recovered": True, **revoke(args.public_nonce or "")}))
        finally:
            os.close(fd)
        return
    if sys.stdin.isatty() or sys.stdout.isatty():
        raise ValueError("Private controller pipes required")
    if args.watch_cleanup:
        watchdog(args.expected_operator_sha256)
    else:
        serve(args.expected_operator_sha256)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Private reader operation refused; inspect and revoke the fixed reader explicitly", file=sys.stderr)
        sys.exit(1)
