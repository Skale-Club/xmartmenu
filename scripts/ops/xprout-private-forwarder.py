#!/usr/bin/env python3
"""Bounded TCP -> SSH stdio relay. No shell, SQL, credentials in logs or replay."""
import asyncio
import contextlib
import ipaddress
import json
import os
import signal
import stat
import sys
from pathlib import Path

HOST = "49.13.197.250"
USER = "xmartmenu-pg-ssh"
BIND = "10.0.4.1"
SOURCE_NETWORK = "10.0.4.0/24"
PORT = 15432
MAX_CONNECTIONS = 12
LIMIT = 32768
CHUNK = 16384
READY = b"XMARTMENU_PG_READY\n"
DIRECTORY = Path("/etc/xmartmenu-private-transport")


def allowed_source(source):
    try:
        address = ipaddress.ip_address(source)
        network = ipaddress.ip_network(SOURCE_NETWORK)
        return (address in network and address not in (network.network_address,
                network.broadcast_address, ipaddress.ip_address(BIND)))
    except ValueError:
        return False


async def close_writer(writer):
    writer.close()
    try:
        await asyncio.wait_for(writer.wait_closed(), 2)
    except (OSError, RuntimeError, asyncio.TimeoutError):
        with contextlib.suppress(AttributeError, OSError):
            writer.transport.abort()


def checked_file(path, owner=None, private=True):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & (0o077 if private else 0o022) or (owner is not None and info.st_uid != owner):
        raise ValueError("Unsafe transport file")


def ssh_arguments(directory=DIRECTORY):
    return ["/usr/bin/ssh", "-F", "/dev/null", "-T", "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
            "-o", "StrictHostKeyChecking=yes", "-o", "GlobalKnownHostsFile=/dev/null",
            "-o", f"UserKnownHostsFile={directory / 'known_hosts'}",
            "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "UpdateHostKeys=no",
            "-o", "ConnectTimeout=5", "-o", "ConnectionAttempts=1",
            "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=1",
            "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes",
            "-o", "RequestTTY=no", "-o", "ControlMaster=no", "-o", "ControlPath=none",
            "-o", "PermitLocalCommand=no", "-o", "LogLevel=ERROR",
            "-i", str(directory / "id_ed25519"), f"{USER}@{HOST}"]


async def stop_process(process):
    if process.returncode is None:
        with contextlib.suppress(ProcessLookupError):
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), 1)
        except asyncio.TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()


async def open_channel(spawn=asyncio.create_subprocess_exec):
    process = await spawn(*ssh_arguments(), stdin=asyncio.subprocess.PIPE,
                          stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                          limit=LIMIT, env={"PATH": "/usr/bin:/bin", "LANG": "C"})
    try:
        if await asyncio.wait_for(process.stderr.readline(), 5) != READY:
            raise ConnectionError("Transport refused")
        # The fixed wrapper emits no further diagnostics. Discard bounded chunks;
        # never forward SSH stderr into PostgreSQL or credential-bearing logs.
        return process
    except BaseException:
        await stop_process(process)
        raise


async def discard_errors(reader):
    while await reader.read(CHUNK):
        pass


async def pump(reader, writer):
    writer.transport.set_write_buffer_limits(high=LIMIT, low=LIMIT // 2)
    while True:
        data = await reader.read(CHUNK)
        if not data:
            with contextlib.suppress(OSError, RuntimeError):
                writer.write_eof()
            return
        writer.write(data)
        await writer.drain()


async def relay(reader, writer, process):
    tasks = [asyncio.create_task(pump(reader, process.stdin)),
             asyncio.create_task(pump(process.stdout, writer)),
             asyncio.create_task(discard_errors(process.stderr))]
    try:
        # Preserve half-close: the opposite direction can still finish its reply.
        done, _ = await asyncio.wait(tasks[:2], return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
        if tasks[1] not in done:
            await asyncio.wait_for(tasks[1], 10)
    finally:
        for task in tasks:
            task.cancel()
        await stop_process(process)
        await asyncio.gather(*tasks, return_exceptions=True)


async def probe_channel(opener=open_channel):
    process = await opener()
    try:
        # PostgreSQL SSLRequest only, never authentication, SELECT or a write.
        process.stdin.write(bytes.fromhex("0000000804d2162f"))
        await process.stdin.drain()
        return await asyncio.wait_for(process.stdout.readexactly(1), 3) in (b"N", b"S")
    finally:
        await stop_process(process)


class Forwarder:
    def __init__(self, opener=open_channel):
        self.active = 0
        self.tasks = set()
        self.opener = opener
        self.handshakes = asyncio.Semaphore(3)
        self.healthy = False

    async def channel(self):
        # Existing sshd MaxStartups begins random admission at ten preauth peers.
        # At most three of ours authenticate concurrently; queued time is also
        # inside the five-second deadline. SQL is never sent before readiness.
        async def connect():
            async with self.handshakes:
                return await self.opener()
        return await asyncio.wait_for(connect(), 5)

    async def accept(self, reader, writer):
        peer = writer.get_extra_info("peername")
        if not peer or not allowed_source(peer[0]) or self.active >= MAX_CONNECTIONS:
            await close_writer(writer)
            return
        self.active += 1  # No await before reserving one of twelve slots.
        task = asyncio.current_task()
        self.tasks.add(task)
        try:
            process = await self.channel()
            await relay(reader, writer, process)
        except (OSError, ValueError, asyncio.TimeoutError, asyncio.IncompleteReadError):
            pass  # Close the exact connection; never replay a PostgreSQL byte.
        finally:
            try:
                await close_writer(writer)
            finally:
                self.active -= 1
                self.tasks.discard(task)

    async def heartbeat(self):
        while True:
            if self.active < MAX_CONNECTIONS:
                self.active += 1
                try:
                    self.healthy = await probe_channel(self.channel)
                except (OSError, ValueError, asyncio.TimeoutError, asyncio.IncompleteReadError):
                    self.healthy = False
                finally:
                    self.active -= 1
                print(json.dumps({"event": "transport_health", "healthy": self.healthy,
                                  "active": self.active}), flush=True)
            await asyncio.sleep(30)

    async def serve(self):
        # Numeric exact private gateway only; no wildcard, DNS or environment override.
        assert ipaddress.ip_address(BIND).is_private and BIND == "10.0.4.1"
        server = await asyncio.start_server(self.accept, BIND, PORT, limit=LIMIT, backlog=12)
        heartbeat = asyncio.create_task(self.heartbeat())
        stopped = asyncio.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            asyncio.get_running_loop().add_signal_handler(sig, stopped.set)
        try:
            async with server:
                await stopped.wait()
        finally:
            heartbeat.cancel()
            for task in list(self.tasks):
                task.cancel()
            await asyncio.gather(heartbeat, *list(self.tasks), return_exceptions=True)


def main():
    if sys.argv[1:] not in (["--serve"], ["--health"]):
        print("PLAN ONLY: reviewed private transport bundle required; no operation")
        return 0 if sys.argv[1:] in ([], ["--plan"]) else 2
    if os.getuid() == 0:
        raise ValueError("Forwarder must be unprivileged")
    checked_file(DIRECTORY / "id_ed25519", os.getuid())
    checked_file(DIRECTORY / "known_hosts", 0, private=False)
    if sys.argv[1:] == ["--health"]:
        ok = asyncio.run(probe_channel())
        print(json.dumps({"healthy": ok}))
        return 0 if ok else 1
    asyncio.run(Forwarder().serve())
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("Transport refused", file=sys.stderr)
        sys.exit(1)
