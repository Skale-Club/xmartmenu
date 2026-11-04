"""Owned fixed-destination relay tests. No SQL or production socket is used."""
import contextlib
import copy
import importlib.util
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("stdio", ROOT / "xmartmenu-pg-stdio.py")
stdio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stdio)


def container():
    return {"Id": "a"*64, "Name": "/"+stdio.TARGET, "Image": stdio.IMAGE,
            "State": {"Pid": 1234, "Running": True, "Health": {"Status": "healthy"}},
            "HostConfig": {"PortBindings": {}, "NetworkMode": "coolify", "Memory": 536870912,
                           "MemorySwap": 536870912, "NanoCpus": 750000000},
            "NetworkSettings": {"Ports": {"5432/tcp": None}, "Networks": {"coolify": {
                "NetworkID": stdio.NETWORK_ID, "IPAddress": "10.0.1.15", "Gateway": "10.0.1.1"}}},
            "Mounts": [{"Destination": "/var/lib/postgresql/data", "Type": "volume", "Name": stdio.VOLUME, "RW": True}]}


class FixedDestination(unittest.TestCase):
    def test_docker_filters_credentials_before_the_unprivileged_relay_heap(self):
        with patch.object(stdio.subprocess, "run", return_value=types.SimpleNamespace(stdout=json.dumps(container()).encode())) as run:
            self.assertEqual(stdio.inspected(stdio.TARGET), container())
        args = run.call_args.args[0]
        self.assertIn("--format", args)
        self.assertEqual(args[-1], stdio.TARGET)
        self.assertEqual(args[args.index("--format")+1], stdio.INSPECT_FORMAT)
        self.assertNotIn(".Config", stdio.INSPECT_FORMAT)
        self.assertNotIn("Env", stdio.INSPECT_FORMAT)
        self.assertNotIn(".Containers", stdio.NETWORK_FORMAT)
    def test_container_ip_may_change_only_in_the_same_pinned_private_network(self):
        c = container()
        self.assertEqual(stdio.snapshot_guard(c), ("a"*64, 1234, "10.0.1.15"))
        c["NetworkSettings"]["Networks"]["coolify"]["IPAddress"] = "10.0.1.27"
        self.assertEqual(stdio.snapshot_guard(c)[2], "10.0.1.27")
        for address in ["10.0.1.0", "10.0.1.1", "10.0.1.255", "10.0.2.15", "49.13.197.250", "::1", "hostname"]:
            bad = copy.deepcopy(c)
            bad["NetworkSettings"]["Networks"]["coolify"]["IPAddress"] = address
            with self.assertRaises(ValueError):
                stdio.snapshot_guard(bad)
        for edit in [lambda b: b["State"].update(Pid=0),
                     lambda b: b["NetworkSettings"]["Networks"]["coolify"].update(NetworkID="other"),
                     lambda b: b["NetworkSettings"]["Networks"]["coolify"].update(Gateway="10.0.1.2")]:
            bad = copy.deepcopy(c)
            edit(bad)
            with self.assertRaises(ValueError):
                stdio.snapshot_guard(bad)

    def test_bridge_name_id_driver_and_ipv4_subnet_are_pinned(self):
        value = {"Name": "coolify", "Id": stdio.NETWORK_ID, "Driver": "bridge",
                 "IPAM": {"Config": [{"Subnet": "10.0.1.0/24", "Gateway": "10.0.1.1"},
                                      {"Subnet": "fddc:5d2:8808::/64", "Gateway": "fddc:5d2:8808::1"}]}}
        stdio.network_guard(value)
        for update in [{"Name": "other"}, {"Id": "other"}, {"Driver": "host"},
                       {"IPAM": {"Config": [{"Subnet": "10.0.2.0/24", "Gateway": "10.0.2.1"}]}}]:
            with self.assertRaises(ValueError):
                stdio.network_guard({**value, **update})

    def test_connect_is_exact_port_five_seconds_and_requires_same_pid_after_connect(self):
        value, connection = container(), Mock()
        connector = Mock(return_value=connection)
        snapshot = stdio.snapshot_guard(value)
        with patch.object(stdio, "inspected", return_value=value):
            self.assertIs(stdio.connected(snapshot, connector), connection)
        connector.assert_called_once_with(("10.0.1.15", 5432), timeout=5)
        connection.setblocking.assert_called_once_with(False)
        changed = copy.deepcopy(value)
        changed["State"]["Pid"] += 1
        connection.reset_mock()
        with patch.object(stdio, "inspected", return_value=changed):
            with self.assertRaises(ValueError):
                stdio.connected(snapshot, Mock(return_value=connection))
        connection.close.assert_called_once()


LINUX_ROOT = sys.platform == "linux" and os.getuid() == 0


@unittest.skipUnless(LINUX_ROOT, "Real uid/capability/pipe proof requires Linux root in private test directory")
class LinuxRelay(unittest.TestCase):
    def setUp(self):
        try:
            stdio.pwd.getpwnam("xmartmenu-pg-ssh")
        except KeyError:
            self.skipTest("Dedicated account must already exist; test never creates it")
        self.temp = tempfile.TemporaryDirectory()
        self.slots = Path(self.temp.name)
        self.slots.chmod(0o700)
        for n in range(12):
            (self.slots / str(n)).touch(mode=0o600)
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.listener.settimeout(5)
        code = (
            "import sys,importlib.util,pathlib,socket,json,os;sys.dont_write_bytecode=True;"
            f"spec=importlib.util.spec_from_file_location('s',{str(ROOT/'xmartmenu-pg-stdio.py')!r});"
            "s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s);"
            f"s.SLOTS=pathlib.Path({str(self.slots)!r});slot=s.reserve_slot();"
            f"c=socket.create_connection(('127.0.0.1',{self.listener.getsockname()[1]}),5);"
            "s.drop_privileges();"
            "sys.stderr.write(json.dumps({'unprivileged':os.getuid()!=0,'groupsEmpty':not os.getgroups()})+'\\n');sys.stderr.flush();"
            "s.relay(c);c.close();os.close(slot)"
        )
        self.process = subprocess.Popen([sys.executable, "-I", "-c", code], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.peer, _ = self.listener.accept()
        self.peer.settimeout(5)
        self.assertTrue(select.select([self.process.stderr], [], [], 5)[0])
        proof = json.loads(self.process.stderr.readline())
        self.assertEqual(proof, {"unprivileged": True, "groupsEmpty": True})

    def tearDown(self):
        if hasattr(self, "process"):
            if self.process.poll() is None:
                self.process.terminate()
                with contextlib.suppress(subprocess.TimeoutExpired):
                    self.process.wait(timeout=2)
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait()
            for handle in [self.process.stdin, self.process.stdout, self.process.stderr]:
                handle.close()
        if hasattr(self, "peer"):
            self.peer.close()
        if hasattr(self, "listener"):
            self.listener.close()
        if hasattr(self, "temp"):
            self.temp.cleanup()

    def read(self, count):
        result = b""
        deadline = time.monotonic()+5
        while len(result) < count:
            self.assertTrue(select.select([self.process.stdout], [], [], max(0, deadline-time.monotonic()))[0])
            value = os.read(self.process.stdout.fileno(), count-len(result))
            self.assertTrue(value)
            result += value
        return result

    def test_twenty_seconds_idle_after_protocol_reply_then_binary_and_cleanup(self):
        request = bytes.fromhex("0000000804d2162f")
        self.process.stdin.write(request)
        self.process.stdin.flush()
        self.assertEqual(self.peer.recv(8), request)
        self.peer.sendall(b"N")
        self.assertEqual(self.read(1), b"N")
        time.sleep(20)
        self.assertIsNone(self.process.poll())
        marker = bytes(range(256))*128
        self.process.stdin.write(marker)
        self.process.stdin.flush()
        received = b""
        while len(received) < len(marker):
            received += self.peer.recv(len(marker)-len(received))
        self.assertEqual(received, marker)
        self.peer.sendall(received)
        self.assertEqual(self.read(len(marker)), marker)
        self.process.stdin.close()
        self.assertEqual(self.peer.recv(1), b"")
        self.peer.close()
        self.assertEqual(self.process.wait(timeout=3), 0)

    def test_binary_backpressure_and_half_close_do_not_truncate_a_large_reply(self):
        payload = bytes(range(256))*4096
        failures = []
        def write():
            try:
                self.process.stdin.write(payload)
                self.process.stdin.close()
            except BaseException as error:
                failures.append(error)
        def echo():
            try:
                while True:
                    value = self.peer.recv(8192)
                    if not value:
                        self.peer.close()
                        return
                    self.peer.sendall(value)
            except BaseException as error:
                failures.append(error)
        writer, backend = threading.Thread(target=write), threading.Thread(target=echo)
        backend.start()
        writer.start()
        self.assertEqual(self.read(len(payload)), payload)
        writer.join(3)
        backend.join(3)
        self.assertFalse(writer.is_alive() or backend.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(self.process.wait(timeout=3), 0)

    def test_peer_disconnect_ends_the_session_and_releases_its_slot(self):
        import fcntl
        fd = os.open(self.slots / "0", os.O_RDONLY)
        try:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.peer.close()
            self.assertEqual(self.process.wait(timeout=3), 0)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(fd)


if __name__ == "__main__":
    unittest.main()
