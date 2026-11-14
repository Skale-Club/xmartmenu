"""Offline, no real SSH, SQL or systemd; async sockets use loopback fixtures only."""
import asyncio
import base64
import copy
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


forward = load("xprout-private-forwarder")
prepare = load("prepare-xprout-private-transport")
stdio = load("xprout-pg-stdio")


def container():
    return {"Id": "a"*64, "Name": "/"+stdio.TARGET, "Image": stdio.IMAGE,
            "State": {"Running": True, "Health": {"Status": "healthy"}},
            "HostConfig": {"PortBindings": {}, "NetworkMode": "coolify", "Memory": 536870912,
                           "MemorySwap": 536870912, "NanoCpus": 750000000},
            "Mounts": [{"Destination": "/var/lib/postgresql/data", "Type": "volume", "Name": stdio.VOLUME, "RW": True}]}


class Guards(unittest.TestCase):
    def test_entrypoints_default_to_plans_and_refuse_apply(self):
        for name in ["prepare-xprout-private-transport", "xprout-private-forwarder"]:
            for flag in [[], ["--plan"]]:
                value = subprocess.run([sys.executable, "-B", str(ROOT / (name+".py")), *flag], capture_output=True, text=True, timeout=3)
                self.assertEqual(value.returncode, 0, value.stderr)
                self.assertIn("PLAN ONLY", value.stdout)
            value = subprocess.run([sys.executable, "-B", str(ROOT / (name+".py")), "--apply"], capture_output=True, timeout=3)
            self.assertEqual(value.returncode, 2)

    def test_every_server_identity_and_permission_fact_is_pinned(self):
        self.assertEqual(stdio.target_guard(container()), "a"*64)
        changes = [lambda c: c.update(Name="/other"), lambda c: c.update(Id="a;sh"),
                   lambda c: c.update(Image="sha256:"+"b"*64),
                   lambda c: c["State"].update(Running=False),
                   lambda c: c["State"]["Health"].update(Status="starting"),
                   lambda c: c["HostConfig"].update(PortBindings={"5432/tcp": [{"HostPort": "5432"}]}),
                   lambda c: c["HostConfig"].update(PublishAllPorts=True),
                   lambda c: c.update(NetworkSettings={"Ports": {"5432/tcp": [{"HostPort": "32768"}]}}),
                   lambda c: c["HostConfig"].update(NetworkMode="host"),
                   lambda c: c["HostConfig"].update(Memory=0),
                   lambda c: c["Mounts"][0].update(Name="other"),
                   lambda c: c["Mounts"][0].update(Type="bind"),
                   lambda c: c["Mounts"][0].update(RW=False)]
        for change in changes:
            c = container()
            change(c)
            with self.assertRaises(ValueError):
                stdio.target_guard(c)

    def test_original_command_arguments_and_ssh_source_never_reach_docker(self):
        env = {"SSH_CONNECTION": "188.245.112.3 12345 49.13.197.250 22"}
        stdio.request_guard([], env, 0)
        for args, e, uid in [(["x"], env, 0), ([], env, 1000),
                             ([], {**env, "SSH_ORIGINAL_COMMAND": "id"}, 0),
                             ([], {}, 0), ([], {"SSH_CONNECTION": "127.0.0.1 12345 49.13.197.250 22"}, 0),
                             ([], {"SSH_CONNECTION": "188.245.112.3 12345 49.13.197.250 5432"}, 0)]:
            with self.assertRaises(ValueError):
                stdio.request_guard(args, e, uid)

    def test_capacity_is_current_not_a_historical_counter_reset(self):
        good = {"availableMiB": 1779, "diskMiB": 10363, "psi": {"some": 0, "full": 0},
                "swapUsedMiB": 2806, "samples": [{"idle": 94, "swapin": 0, "swapout": 0}]*3}
        prepare.capacity_guard(good, "server")
        for edit in [lambda c: c.update(availableMiB=100), lambda c: c.update(diskMiB=0),
                     lambda c: c["psi"].update(full=.06),
                     lambda c: c["samples"][0].update(swapout=1),
                     lambda c: c["samples"][0].update(swapin=65),
                     lambda c: c["samples"][0].update(idle=49), lambda c: c.update(samples=[])]:
            c = copy.deepcopy(good)
            edit(c)
            with self.assertRaises(ValueError):
                prepare.capacity_guard(c, "server")

    def test_network_id_and_private_app_resource_survive_rolling_ip_change(self):
        c = [{"Name": "/app-"+prepare.NETWORK+"-20261102T010249", "State": {"Running": True},
              "Image": "sha256:"+"a"*64,
              "Config": {"Image": "ghcr.io/skale-club/xmartmenu:"+"b"*40,
                         "Labels": {"coolify.applicationUuid": prepare.NETWORK, "coolify.managed": "true",
                                    "coolify.resourceName": "xmartmenu", "coolify.type": "application",
                                    "com.docker.compose.project": prepare.NETWORK, "com.docker.compose.service": "app"}},
              "NetworkSettings": {"Networks": {prepare.NETWORK: {"IPAddress": "10.0.4.2", "Gateway": "10.0.4.1"}}}}]
        n = {"Name": prepare.NETWORK, "Id": prepare.NETWORK_ID, "Driver": "bridge",
             "IPAM": {"Config": [{"Subnet": "10.0.4.0/24", "Gateway": "10.0.4.1"}]}}
        prepare.client_network_guard(c, n)
        for bad in [{**n, "Id": "new"}, {**n, "Driver": "host"}, {**n, "IPAM": {"Config": []}}]:
            with self.assertRaises(ValueError):
                prepare.client_network_guard(c, bad)
        changed = copy.deepcopy(c)
        changed[0]["NetworkSettings"]["Networks"][prepare.NETWORK]["IPAddress"] = "10.0.4.3"
        prepare.client_network_guard(changed, n)
        prepare.client_network_guard(c+changed, n)
        for mutate in [lambda a: a["Config"].update(Image="ghcr.io/other/app:main"),
                       lambda a: a["Config"]["Labels"].update({"coolify.applicationUuid": "other"}),
                       lambda a: a["NetworkSettings"]["Networks"][prepare.NETWORK].update(IPAddress="10.0.5.3")]:
            wrong = copy.deepcopy(changed)
            mutate(wrong[0])
            with self.assertRaises(ValueError):
                prepare.client_network_guard(wrong, n)
        with self.assertRaises(ValueError):
            prepare.client_network_guard(c+c, n)
        with self.assertRaises(ValueError):
            prepare.client_network_guard(c+changed+c, n)

    def test_known_host_trust_is_existing_pin_not_keyscan(self):
        # Use a synthetic public key and temporarily pin its hash, never a real private key.
        raw = b"synthetic public host key fixture"
        key = base64.b64encode(raw).decode()
        fingerprint = base64.b64encode(prepare.hashlib.sha256(raw).digest()).decode().rstrip("=")
        def runner(args, **kwargs):
            self.assertEqual(args[:3], ["ssh-keygen", "-F", "49.13.197.250"])
            return types.SimpleNamespace(stdout=f"# trusted fixture\n|1|hashed ssh-ed25519 {key}\n")
        with patch.object(prepare, "FINGERPRINT", fingerprint):
            self.assertEqual(prepare.trusted_key(Path("trusted"), runner), f"49.13.197.250 ssh-ed25519 {key}\n")
        with self.assertRaises(ValueError):
            prepare.trusted_key(Path("trusted"), runner)

    def test_offline_bundle_cannot_apply_or_overwrite_and_carries_restrictive_policy(self):
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / "bundle"
            with patch.object(prepare, "trusted_key", return_value="public pinned fixture\n"):
                report = prepare.render_bundle(destination, Path("trusted"))
                self.assertFalse(report["applicationCutover"])
                with self.assertRaises(ValueError):
                    prepare.render_bundle(destination, Path("trusted"))
            # Local brand filenames must not silently migrate deployed command targets.
            for installed, source in [("xmartmenu-pg-stdio.py", "xprout-pg-stdio.py"),
                                      ("xmartmenu-private-forwarder.py", "xprout-private-forwarder.py"),
                                      ("prepare-xmartmenu-private-transport.py", "prepare-xprout-private-transport.py")]:
                self.assertEqual((destination / installed).read_text(), (ROOT / source).read_text())
                self.assertFalse((destination / source).exists())
            unit = (destination / "xmartmenu-private-transport.service").read_text()
            self.assertNotIn(b"\r", (destination / "manifest.json").read_bytes())
            for token in ["MemoryMax=128M", "MemoryHigh=96M", "MemorySwapMax=0", "TasksMax=32", "NoNewPrivileges=yes", "User=xmartmenu-pg-client", "BindsTo=", "IPAddressDeny=any"]:
                self.assertIn(token, unit)
            self.assertIn('NOPASSWD: /usr/local/libexec/xmartmenu-pg-stdio.py ""', prepare.SUDOERS)
            self.assertNotIn("NOPASSWD: /usr/bin/docker", prepare.SUDOERS)
            self.assertIn("restrict,from=", prepare.KEY_PREFIX)
            self.assertIn("ClientAliveInterval 5", prepare.SSHD_MATCH)
            self.assertIn("DisableForwarding yes", prepare.SSHD_MATCH)
            self.assertNotIn("Match all", prepare.SSHD_MATCH)
            self.assertNotIn("__CLIENT_ED25519_PUBLIC_KEY__", unit)
            self.assertFalse(any("PRIVATE KEY" in p.read_text() for p in destination.iterdir()))

    def test_client_cannot_inherit_agent_config_or_open_forwarding(self):
        args = forward.ssh_arguments()
        self.assertEqual(args[-1], "xmartmenu-pg-ssh@49.13.197.250")
        for option in ["IdentityAgent=none", "StrictHostKeyChecking=yes", "ConnectionAttempts=1", "ConnectTimeout=5", "ClearAllForwardings=yes", "ControlMaster=no", "HostKeyAlgorithms=ssh-ed25519", "GlobalKnownHostsFile=/dev/null"]:
            self.assertIn(option, args)
        self.assertNotIn("-L", args)
        self.assertNotIn("-W", args)

    def test_sources_allow_rollout_hosts_but_no_gateway_or_other_network(self):
        for address in ["10.0.4.2", "10.0.4.3", "10.0.4.254"]:
            self.assertTrue(forward.allowed_source(address))
        for address in ["10.0.4.0", "10.0.4.1", "10.0.4.255", "10.0.5.2", "127.0.0.1", "::1", "bad"]:
            self.assertFalse(forward.allowed_source(address))

    @unittest.skipIf(os.name == "nt", "fcntl proof runs on Linux CI; Windows has no flock")
    def test_server_twelve_locks_hold_until_closed_and_thirteenth_is_denied(self):
        with tempfile.TemporaryDirectory() as root:
            slots = Path(root)
            for n in range(12):
                (slots / str(n)).touch(mode=0o600)
            with patch.object(stdio, "SLOTS", slots), patch.object(stdio, "owned_path"):
                fds = [stdio.reserve_slot() for _ in range(12)]
                try:
                    with self.assertRaises(ValueError):
                        stdio.reserve_slot()
                    os.close(fds.pop())
                    fds.append(stdio.reserve_slot())
                finally:
                    for fd in fds:
                        os.close(fd)


class FakeWriter:
    def __init__(self, source="10.0.4.2"):
        self.source, self.closed = source, False
    def get_extra_info(self, _):
        return (self.source, 12345)
    def close(self):
        self.closed = True
    async def wait_closed(self):
        pass


class Streams(unittest.IsolatedAsyncioTestCase):
    async def subprocess_channel(self, code):
        async def spawn(*args, **kwargs):
            kwargs.pop("env", None)
            return await asyncio.create_subprocess_exec(sys.executable, "-I", "-c", code, **kwargs)
        return await forward.open_channel(spawn)

    async def test_foreign_source_and_thirteenth_connection_never_spawn_ssh(self):
        called = []
        async def opener():
            called.append(True)
            raise OSError()
        service = forward.Forwarder(opener)
        foreign = FakeWriter("127.0.0.1")
        await service.accept(None, foreign)
        service.active = 12
        extra = FakeWriter()
        await service.accept(None, extra)
        self.assertTrue(foreign.closed and extra.closed)
        self.assertEqual(called, [])
        self.assertEqual(service.active, 12)

    async def test_failed_ssh_is_not_retried_and_releases_slot(self):
        calls = []
        async def opener():
            calls.append(1)
            raise ConnectionError("mock failure")
        service = forward.Forwarder(opener)
        writer = FakeWriter()
        await service.accept(None, writer)
        self.assertEqual(calls, [1])
        self.assertEqual(service.active, 0)
        self.assertTrue(writer.closed)

    async def test_stalled_writer_cleanup_is_bounded_and_releases_the_active_slot(self):
        class Writer(FakeWriter):
            def __init__(self):
                super().__init__()
                self.transport = self
                self.aborted = False
            async def wait_closed(self):
                await asyncio.Event().wait()
            def abort(self):
                self.aborted = True
        async def opener():
            raise OSError()
        service, writer = forward.Forwarder(opener), Writer()
        await asyncio.wait_for(service.accept(None, writer), 2.5)
        self.assertTrue(writer.closed and writer.aborted)
        self.assertEqual(service.active, 0)

    async def test_twelve_admissions_reserve_before_await_and_cancellation_releases(self):
        entered, release = asyncio.Event(), asyncio.Event()
        count = 0
        async def opener():
            nonlocal count
            count += 1
            if count == 3:
                entered.set()
            await release.wait()
            raise OSError()
        service = forward.Forwarder(opener)
        tasks = [asyncio.create_task(service.accept(None, FakeWriter())) for _ in range(12)]
        await asyncio.wait_for(entered.wait(), 1)
        self.assertEqual(service.active, 12)
        await service.accept(None, FakeWriter())
        self.assertEqual(count, 3)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.assertEqual(service.active, 0)

    async def test_wrong_ready_marker_kills_child_and_never_passes_stderr_to_tcp(self):
        class Process:
            def __init__(self):
                self.returncode = None
                self.stderr = asyncio.StreamReader()
                self.stderr.feed_data(b"not protocol ready\n")
                self.stderr.feed_eof()
            def terminate(self):
                self.returncode = 1
            async def wait(self):
                return self.returncode
        process = Process()
        async def spawn(*args, **kwargs):
            self.assertNotIn("SSH_AUTH_SOCK", kwargs["env"])
            return process
        with self.assertRaises(ConnectionError):
            await forward.open_channel(spawn)
        self.assertIsNotNone(process.returncode)

    async def test_pump_backpressure_binary_data_and_half_close(self):
        data = bytes(range(256))*1024
        reader = asyncio.StreamReader(limit=forward.LIMIT)
        reader.feed_data(data)
        reader.feed_eof()
        class Writer:
            def __init__(self):
                self.transport = self
                self.data, self.chunk_sizes, self.drains = b"", [], 0
                self.eof = False
            def set_write_buffer_limits(self, **kwargs):
                self.bounds = kwargs
            def write(self, value):
                self.data += value
                self.chunk_sizes.append(len(value))
            async def drain(self):
                self.drains += 1
                await asyncio.sleep(0)
            def write_eof(self):
                self.eof = True
        writer = Writer()
        await forward.pump(reader, writer)
        self.assertEqual(writer.data, data)
        self.assertEqual(writer.drains, len(writer.chunk_sizes))
        self.assertLessEqual(max(writer.chunk_sizes), 16384)
        self.assertEqual(writer.bounds["high"], 32768)
        self.assertTrue(writer.eof)

    async def test_real_local_pipes_and_tcp_preserve_binary_reply_after_client_half_close(self):
        code = "import sys;sys.stderr.buffer.write(b'XMARTMENU_PG_READY\\n');sys.stderr.flush();data=sys.stdin.buffer.read();sys.stdout.buffer.write(data[::-1]);sys.stdout.buffer.flush()"
        async def opener():
            return await self.subprocess_channel(code)
        service = forward.Forwarder(opener)
        with patch.object(forward, "SOURCE_NETWORK", "127.0.0.0/24"):
            server = await asyncio.start_server(service.accept, "127.0.0.1", 0)
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", server.sockets[0].getsockname()[1])
                data = bytes(range(256))*1024
                writer.write(data)
                await writer.drain()
                writer.write_eof()
                self.assertEqual(await asyncio.wait_for(reader.readexactly(len(data)), 4), data[::-1])
                self.assertEqual(await asyncio.wait_for(reader.read(), 2), b"")
                writer.close()
                await writer.wait_closed()
                await asyncio.sleep(.05)
                self.assertEqual(service.active, 0)
            finally:
                server.close()
                await server.wait_closed()

    async def test_remote_eof_closes_idle_client_without_waiting_for_its_next_query(self):
        code = "import sys;sys.stderr.buffer.write(b'XMARTMENU_PG_READY\\n');sys.stderr.flush()"
        async def opener():
            return await self.subprocess_channel(code)
        service = forward.Forwarder(opener)
        with patch.object(forward, "SOURCE_NETWORK", "127.0.0.0/24"):
            server = await asyncio.start_server(service.accept, "127.0.0.1", 0)
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", server.sockets[0].getsockname()[1])
                self.assertEqual(await asyncio.wait_for(reader.read(), 4), b"")
                writer.close()
                await writer.wait_closed()
                await asyncio.sleep(.05)
                self.assertEqual(service.active, 0)
            finally:
                server.close()
                await server.wait_closed()

    async def test_health_sends_only_protocol_sslrequest_and_checks_response(self):
        for response, expected in [("N", True), ("S", True), ("X", False)]:
            code = ("import sys;sys.stderr.buffer.write(b'XMARTMENU_PG_READY\\n');sys.stderr.flush();"
                    "data=sys.stdin.buffer.read(8);assert data==bytes.fromhex('0000000804d2162f');"
                    f"sys.stdout.buffer.write(b'{response}');sys.stdout.buffer.flush()")
            async def opener():
                return await self.subprocess_channel(code)
            self.assertEqual(await forward.probe_channel(opener), expected)


if __name__ == "__main__":
    unittest.main()
