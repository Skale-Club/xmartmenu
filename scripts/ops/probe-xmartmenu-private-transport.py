#!/usr/bin/python3 -I
"""Protocol-only bounded capacity/denial proof; no auth payload or SQL."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import time

sys.dont_write_bytecode = True
STAGE = Path("/tmp/xmartmenu-private-transport-stage-20261104T131617Z-e11950c4")
OP_SHA = "c06bb6a09be447b9e6486c000eb655cc1a0b393e8fa36f4b111cfe6970aaf0d1"
NODE = r'''
const net=require('node:net');
const sockets=[];let ready=0,closed=0;const began=Date.now();
const request=Buffer.from('0000000804d2162f','hex');
function opened(){return new Promise((resolve,reject)=>{
 const s=net.createConnection({host:'10.0.4.1',port:15432});sockets.push(s);
 s.once('close',()=>closed++);
 s.setTimeout(6000,()=>reject(Error('timeout')));
 s.once('error',()=>reject(Error('connection')));
 s.once('connect',()=>s.write(request));
 s.once('data',b=>{if(b.length!==1||![78,83].includes(b[0]))return reject(Error('protocol'));ready++;s.setTimeout(0);resolve();});
 s.once('end',()=>{if(ready<12)reject(Error('early EOF'));});
});}
function extraDenied(){return new Promise(resolve=>{
 let done=false;const finish=v=>{if(!done){done=true;s.destroy();resolve(v);}};
 const s=net.createConnection({host:'10.0.4.1',port:15432});
 s.setTimeout(3000,()=>finish(false));s.on('error',()=>finish(true));
 s.once('connect',()=>s.write(request));s.once('data',()=>finish(false));s.once('end',()=>finish(true));
});}
(async()=>{
 try{
  // Capacity proof: retain twelve channels, admitting each inside its own
  // bounded handshake. A12-way burst also measures queue latency, separately.
  for(let i=0;i<12;i++)await opened();
  const denied=await extraDenied();if(!denied)throw Error('extra admitted');
  console.log(JSON.stringify({ready:12,thirteenthDenied:true,oldestAgeMs:Date.now()-began,
    bothDirectionsOpen:sockets.every(s=>!s.writableEnded&&!s.readableEnded)}));
  await new Promise(resolve=>setTimeout(resolve,20000));
  if(closed!==0)throw Error('held channel closed early');
  for(const s of sockets)s.destroy();
  console.log(JSON.stringify({released:12,oldestAgeMs:Date.now()-began,closedBeforeRelease:closed}));
 }catch(_){for(const s of sockets)s.destroy();console.log(JSON.stringify({failed:true,ready,closed,oldestAgeMs:Date.now()-began}));process.exitCode=1;}
})();
'''


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def events(path):
    return {k: int(v) for k, v in (line.split() for line in (path / "memory.events").read_text().splitlines())}


def main():
    if sys.argv[1:] != ["--execute-readonly-proof"]:
        if sys.argv[1:] not in ([], ["--plan"]):
            return 2
        print(json.dumps({"plan": "PLAN ONLY: 12 protocol SSLRequests + denied13th, SSH command/forward denied; never auth/SQL"}))
        return 0
    if os.getuid() != 0 or Path("/etc/hostname").read_text().strip() != "skaleclub-server":
        raise ValueError("Exact app host/root required")
    installer = load(STAGE / "install-xmartmenu-private-transport.py", "installer")
    if installer.sha((STAGE / "install-xmartmenu-private-transport.py").read_bytes()) != OP_SHA:
        raise ValueError("Reviewed installer digest changed")
    installer.verify_client(False)
    # Both the positive check and periodic heartbeat use a server slot. Allow
    # stdin-EOF cleanup, then start in the quiet part of the30s health interval.
    time.sleep(6)
    deadline = time.monotonic()+40
    while True:
        raw = installer.run(["/usr/bin/journalctl", "-u", installer.UNIT_NAME, "-n", "40", "--no-pager", "-o", "json"])
        health = []
        for line in raw.decode().splitlines():
            event = json.loads(line)
            try:
                message = json.loads(event.get("MESSAGE", ""))
            except (ValueError, TypeError):
                continue
            if message.get("event") == "transport_health":
                health.append((int(event["__REALTIME_TIMESTAMP"])/1000000, message))
        if health and not health[-1][1]["healthy"]:
            installer.run(["/usr/bin/systemctl", "stop", installer.UNIT_NAME])
            raise ValueError("Periodic health false; owned service stopped")
        age = time.time()-health[-1][0] if health else -1
        if 7 <= age <= 15:
            break
        if time.monotonic() >= deadline:
            raise ValueError("No quiescent healthy admission window")
        time.sleep(.5)
    prepare = load(installer.LIB / "prepare-xmartmenu-private-transport.py", "prepare")
    for attempt in range(3):
        capacity = prepare.metrics()
        try:
            prepare.capacity_guard(capacity, "client")
            print(json.dumps({"event": "readonly_capacity_admitted", "attempt": attempt+1,
                              "metrics": capacity}), flush=True)
            break
        except ValueError:
            print(json.dumps({"event": "readonly_capacity_refused", "attempt": attempt+1,
                              "metrics": capacity}), flush=True)
            if attempt == 2:
                raise
            time.sleep(2)
    ids = prepare.command(["/usr/bin/docker", "ps", "-q"]).split()
    containers = json.loads(prepare.command(["/usr/bin/docker", "inspect", *ids]))
    network = json.loads(prepare.command(["/usr/bin/docker", "network", "inspect", prepare.NETWORK]))[0]
    prepare.client_network_guard(containers, network)
    apps = [c for c in containers if c["State"]["Running"] and c["Name"].startswith("/app-"+prepare.NETWORK+"-")]
    app = sorted(apps, key=lambda c: c["Name"])[-1]
    cg_name = installer.run(["/usr/bin/systemctl", "show", installer.UNIT_NAME, "--property=ControlGroup", "--value"]).decode().strip()
    if cg_name != "/system.slice/xmartmenu-private-transport.service":
        raise ValueError("Unexpected cgroup")
    cg = Path("/sys/fs/cgroup"+cg_name)
    before = events(cg)
    process = subprocess.Popen(["/usr/bin/docker", "--host", "unix:///var/run/docker.sock", "exec", app["Id"], "node", "-e", NODE], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        if not select.select([process.stdout], [], [], 25)[0]:
            raise ValueError("Capacity protocol readiness deadline")
        initial = json.loads(process.stdout.readline())
        if initial.get("ready") != 12 or initial.get("thirteenthDenied") is not True or initial.get("bothDirectionsOpen") is not True:
            print(json.dumps({"event": "protocol_capacity_refused", "ready": initial.get("ready", 0),
                              "failed": initial.get("failed", False)}), flush=True)
            raise ValueError("Twelve channels or extra-channel denial failed")
        print(json.dumps({"event": "twelve_readonly_channels_held", **initial}), flush=True)
        measured = []
        for _ in range(4):
            measured.append(int((cg / "memory.current").read_text()))
            if any(events(cg)[k] > before[k] for k in ["high", "max", "oom", "oom_kill"]):
                installer.run(["/usr/bin/systemctl", "stop", installer.UNIT_NAME])
                raise ValueError("Service pressure; owned service stopped")
            time.sleep(1)
        process.wait(timeout=25)
        final = json.loads(process.stdout.readline())
        if process.returncode or final.get("released") != 12 or final.get("closedBeforeRelease") != 0:
            print(json.dumps({"event": "capacity_release_refused", "childExit": process.returncode,
                              "released": final.get("released", 0), "ready": final.get("ready", 0),
                              "closed": final.get("closed", final.get("closedBeforeRelease", 0)),
                              "oldestAgeMs": final.get("oldestAgeMs")}), flush=True)
            raise ValueError("Protocol channels did not release")
        after = events(cg)
        if max(measured) >= 128*1048576 or any(after[k] > before[k] for k in ["high", "max", "oom", "oom_kill"]):
            installer.run(["/usr/bin/systemctl", "stop", installer.UNIT_NAME])
            raise ValueError("Service pressure; owned service stopped")
        forward = load(installer.LIB / "xmartmenu-private-forwarder.py", "forward")
        ssh = forward.ssh_arguments()
        negative = {}
        for name, args in [("command", [*ssh, "id"]), ("forwarding", [*ssh[:-1], "-W", "127.0.0.1:5432", ssh[-1]])]:
            result = subprocess.run(["/usr/sbin/runuser", "-u", installer.CLIENT_USER, "--", *args], input=b"", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            negative[name] = result.returncode != 0 and not result.stdout
        if not all(negative.values()):
            installer.run(["/usr/bin/systemctl", "stop", installer.UNIT_NAME])
            raise ValueError("SSH negative test failed; owned service stopped")
        installer.verify_client(False)
        print(json.dumps({"proof": "passed", "readonlyChannels": 12, "thirteenthDenied": True,
                          "sampledPeakMiB": max(measured)//1048576,
                          "cgroupPeakMiB": int((cg/"memory.peak").read_text())//1048576,
                          "oldestAgeAtReadyMs": initial.get("oldestAgeMs"), "oldestAgeAtReleaseMs": final.get("oldestAgeMs"),
                          "newPressureEvents": {k: after[k]-before[k] for k in ["high", "max", "oom", "oom_kill"]},
                          "sshDenied": negative, "postHealth": True,
                          "sqlAuthentication": False, "sqlWrites": False, "applicationCutover": False}), flush=True)
        return 0
    finally:
        if process.poll() is None:
            process.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=2)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Static messages only; never stdout/stderr/argv/key bytes from children.
        safe = str(error) if isinstance(error, ValueError) else type(error).__name__
        print(json.dumps({"proof": "refused", "reason": safe}), file=sys.stderr)
        sys.exit(1)
