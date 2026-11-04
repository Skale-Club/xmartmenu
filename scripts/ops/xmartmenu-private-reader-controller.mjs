import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const hash = value => createHash('sha256').update(value).digest('hex')
const SSH = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
  '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'RequestTTY=no']
const CLIENT = '188.245.112.3', SERVER = '49.13.197.250'

function processAt(host, python) {
  if (![CLIENT, SERVER].includes(host)) throw new Error('Fixed host required')
  const code = Buffer.from(python).toString('base64')
  // Only base64 public code enters the remote shell command. Secrets use stdin.
  return spawn('ssh', [...SSH, `root@${host}`, `python3 -c 'import base64;exec(base64.b64decode("${code}"))'`], { stdio: ['pipe', 'pipe', 'pipe'] })
}

export function privateFrames(stream) {
  let buffer = Buffer.alloc(0), waiting, closed = false
  const ready = []
  const fail = () => { closed = true; buffer.fill(0); buffer = Buffer.alloc(0); ready.length = 0; if (waiting) { clearTimeout(waiting.timer); waiting.reject(new Error('Private channel closed')); waiting = undefined } }
  stream.on('data', chunk => {
    if (closed) return
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > 32768) return fail()
    while (buffer.length >= 4) {
      const size = buffer.readUInt32BE(0)
      if (size < 2 || size > 8192) return fail()
      if (buffer.length < 4 + size) break
      const body = buffer.subarray(4, 4 + size)
      let packet
      try { packet = JSON.parse(body.toString('utf8')) } catch { return fail() }
      body.fill(0)
      buffer = Buffer.from(buffer.subarray(4 + size))
      if (waiting) { clearTimeout(waiting.timer); waiting.resolve(packet); waiting = undefined }
      else { ready.push(packet); if (ready.length > 2) return fail() }
    }
  })
  stream.on('end', () => {
    if (buffer.length) return fail()
    closed = true
    if (waiting) { clearTimeout(waiting.timer); waiting.reject(new Error('Private channel closed')); waiting = undefined }
  })
  stream.on('error', fail)
  return { next(timeout) {
    if (ready.length) return Promise.resolve(ready.shift())
    if (closed) return Promise.reject(new Error('Private channel closed'))
    if (waiting) throw new Error('Sequential private frame required')
    return new Promise((resolve, reject) => { waiting = { resolve, reject, timer: setTimeout(() => { waiting = undefined; reject(new Error('Private channel deadline')) }, timeout) } })
  } }
}

function runAt(host, code, payload, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const child = processAt(host, code), out = []
    let length = 0
    const timer = setTimeout(() => { child.kill(); reject(new Error('Remote proof deadline')) }, timeout)
    child.stdout.on('data', data => { length += data.length; if (length > 16384) { child.kill(); reject(new Error('Unexpected proof output')) } else out.push(data) })
    child.stderr.on('data', () => {}) // Never echo remote SQL/credential diagnostics.
    child.on('error', () => { clearTimeout(timer); reject(new Error('Remote process refused')) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error('Remote process refused'))
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8'))) } catch { reject(new Error('Invalid aggregate proof')) }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

export function appBootstrap(expectedCommit, expectedImage, execute) {
  return `import json,sys,subprocess,hashlib,pathlib
data=json.loads(sys.stdin.buffer.read(1000001));assert len(json.dumps(data))<1000000
run=lambda a,**kw:subprocess.run(a,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=kw.pop('timeout',10),**kw).stdout
fmt='{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"State":{"Running":{{json .State.Running}},"Health":{"Status":{{json .State.Health.Status}}}},"Config":{"Image":{{json .Config.Image}},"User":{{json .Config.User}}},"Mounts":{{json .Mounts}},"NetworkSettings":{"Networks":{{json .NetworkSettings.Networks}}}}'
ids=run(['docker','ps','-q','--filter','label=com.docker.compose.project=gmaayluj11x1m6j7baogonfn']).decode().split();apps=[]
for ident in ids:
 c=json.loads(run(['docker','inspect','--format',fmt,ident]))
 if c['Name'].startswith('/app-gmaayluj11x1m6j7baogonfn-'):apps.append(c)
assert len(apps)==1;c=apps[0];assert c['State']['Running'] and c['State']['Health']['Status']=='healthy'
assert c['Config']['Image']=='ghcr.io/skale-club/xmartmenu:${expectedCommit}' and c['Image']=='${expectedImage}' and c['Config']['User']=='node'
n=c['NetworkSettings']['Networks']['gmaayluj11x1m6j7baogonfn'];assert n['NetworkID']=='9618654f72854308768936727d24ecd948decaa235eaf51a163d845958f47c37' and n['Gateway']=='10.0.4.1'
mount=[m for m in c['Mounts'] if m['Destination']=='/run/secrets/xmartmenu-google-identity'];assert len(mount)==1 and mount[0]['Type']=='bind' and mount[0]['Source']=='/opt/xmartmenu/google-identity-runtime' and mount[0]['RW'] is False
assert not any(m['Source']=='/opt/xmartmenu/google-identity-ca' or m['Source'].startswith('/opt/xmartmenu/google-identity-ca/') for m in c['Mounts'])
inspect="const fs=require('node:fs');const f=['OWNED_PLATFORM_APPEARANCE_ENABLED','OWNED_PUBLIC_MENU_ENABLED','OWNED_ADMIN_MENUS_ENABLED','OWNED_ORDER_DATA_ENABLED','OWNED_PAYMENT_DATA_ENABLED'];let pg=false;try{pg=typeof require('pg').Client==='function'}catch{};let adc=false;try{fs.accessSync('/run/secrets/xmartmenu-google-identity/adc.json',fs.constants.R_OK);adc=true}catch{};console.log(JSON.stringify({pg,disabled:f.every(k=>process.env[k]===undefined||process.env[k]==='false'),googleDisabled:process.env.GOOGLE_AUTH_ENABLED==='false',adc:adc&&process.env.GOOGLE_AUTH_ADC_FILE==='/run/secrets/xmartmenu-google-identity/adc.json',uid:process.getuid()===1000,gid:process.getgid()===1000}))"
p=json.loads(run(['docker','exec',c['Id'],'node','-e',inspect]));assert all(p.values())
if ${execute ? 'False' : 'True'}:
 print(json.dumps({'appReady':True,'pgDriver':True,'googleReadOnly':True,'ownedDisabled':True}));raise SystemExit(0)
source=__import__('base64').b64decode(data['source']);assert len(source)<=250000 and hashlib.sha256(source).hexdigest()==data['bundleSha256']
bootstrap="const fs=require('node:fs'),crypto=require('node:crypto'),Module=require('node:module');const raw=fs.readFileSync(0);(async()=>{try{const v=JSON.parse(raw);const source=Buffer.from(v.source,'base64');if(crypto.createHash('sha256').update(source).digest('hex')!==v.bundleSha256)throw Error();const m=new Module('/app/xmartmenu-private-read.cjs');m.filename='/app/xmartmenu-private-read.cjs';m.paths=Module._nodeModulePaths('/app');m._compile(source.toString('utf8'),m.filename);const result=await m.exports.runReadProof(v.credential);console.log(JSON.stringify(result))}catch{console.log(JSON.stringify({privateSqlRead:false}));process.exitCode=1}finally{raw.fill(0)}})()"
result=run(['docker','exec','-i','--env','NODE_OPTIONS=',c['Id'],'node','-e',bootstrap],input=json.dumps(data).encode(),timeout=90)
print(result.decode())
`
}

export const SERVER_BOOTSTRAP = `import json,os,pathlib,hashlib,base64,runpy,sys
raw=bytearray()
while len(raw)<1000000:
 c=os.read(0,1)
 if c==b'\\n':break
 if not c:raise SystemExit(1)
 raw.extend(c)
data=json.loads(raw);assert set(data)=={'source','sourceSha256','nonce'} and __import__('re').fullmatch('[0-9a-f]{32}',data['nonce'])
source=base64.b64decode(data['source']);assert hashlib.sha256(source).hexdigest()==data['sourceSha256'] and b'\\r' not in source
assert os.getuid()==0 and pathlib.Path('/etc/hostname').read_text().strip()=='skaleclub-mail'
root=pathlib.Path('/tmp/xmartmenu-private-reader-'+data['nonce']);root.mkdir(mode=0o700);p=root/'lease.py';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'wb') as f:f.write(source)
sys.argv=[str(p),'--serve-private-lease','--expected-operator-sha256',data['sourceSha256']];runpy.run_path(str(p),run_name='__main__')
`

export function assertAggregate(value) {
  const keys = ['adapters', 'applicationCutover', 'counts', 'privateSqlRead', 'providerCalls', 'queryCount', 'roleReadOnly', 'runtimeLoginEnabled', 'sqlWrites']
  if (!value || Object.keys(value).sort().join() !== keys.sort().join() || value.privateSqlRead !== true || value.roleReadOnly !== true
    || value.sqlWrites !== false || value.providerCalls !== false || value.applicationCutover !== false || value.runtimeLoginEnabled !== false
    || !Number.isSafeInteger(value.queryCount) || value.queryCount < 1 || value.queryCount > 200
    || JSON.stringify(value.counts) !== JSON.stringify({ profiles: 7, tenants: 3, products: 56, orders: 2, order_items: 6 })
    || Object.keys(value.adapters).sort().join() !== 'orders,paymentCheckout,publicMenu' || !Object.values(value.adapters).every(v => v === true)) throw new Error('Aggregate read proof refused')
  return value
}

export async function executeProof(args) {
  if (!/^[a-f0-9]{40}$/.test(args.commit) || !/^sha256:[a-f0-9]{64}$/.test(args.image)
    || !/^[a-f0-9]{64}$/.test(args.leaseSha) || !/^[a-f0-9]{64}$/.test(args.bundleSha)
    || !args.executeReviewed) throw new Error('Explicit reviewed inputs required')
  const self = readFileSync(new URL(import.meta.url))
  if (hash(self) !== args.controllerSha) throw new Error('Exact controller hash required')
  const source = readFileSync(args.bundle), manifest = JSON.parse(readFileSync(`${args.bundle}.json`, 'utf8'))
  const lease = readFileSync(new URL('./xmartmenu-private-reader-lease.py', import.meta.url))
  if (manifest.version !== 1 || manifest.sourceCommit !== args.commit || manifest.publicCodeOnly !== true
    || manifest.sqlWrites !== false || manifest.providerCalls !== false || manifest.bundleSha256 !== hash(source)
    || hash(source) !== args.bundleSha
    || source.length > 250000 || hash(lease) !== args.leaseSha || lease.includes(13)) throw new Error('Reviewed public source provenance required')
  // Driver/mount/flags/image admission happens BEFORE starting any role lease.
  await runAt(CLIENT, appBootstrap(args.commit, args.image, false), {})
  const nonce = randomBytes(16).toString('hex')
  const owner = processAt(SERVER, SERVER_BOOTSTRAP), frames = privateFrames(owner.stdout)
  owner.stderr.on('data', () => {})
  owner.stdin.on('error', () => {})
  owner.stdin.write(`${JSON.stringify({ source: lease.toString('base64'), sourceSha256: args.leaseSha, nonce })}\n`)
  owner.stdin.write(`${JSON.stringify({ protocol: 'xmartmenu-private-read-v1', nonce, bundleSha256: manifest.bundleSha256, appCommit: args.commit })}\n`)
  let credential, result, cleanup
  try {
    credential = await frames.next(20000)
    if (credential.protocol !== 'xmartmenu-private-read-v1' || credential.nonce !== nonce
      || typeof credential.password !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential.password)) throw new Error('Private lease refused')
    result = assertAggregate(await runAt(CLIENT, appBootstrap(args.commit, args.image, true),
      { source: source.toString('base64'), bundleSha256: manifest.bundleSha256, credential }, 100000))
  } finally {
    if (credential) credential.password = ''
    owner.stdin.end() // Dedicated watchdog restores NOLOGIN/passwordNULL on EOF.
    cleanup = await frames.next(55000)
    if (cleanup.revoked !== true || cleanup.readerDormant !== true || cleanup.runtimeDormant !== true || cleanup.readerSessions !== 0 || cleanup.applicationDataWrites !== false) throw new Error('Reader cleanup not proven')
  }
  return { ...result, readerRevoked: true, readerSessions: 0 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (!args.length || args.length === 1 && args[0] === '--plan') console.log(JSON.stringify({ plan: 'PLAN ONLY: matching disabled release admission, private in-memory SELECT lease, mandatory watchdog cleanup; no role change' }))
  else {
    const values = {}
    for (let i = 0; i < args.length; i += 2) values[args[i]] = args[i + 1]
    try { console.log(JSON.stringify(await executeProof({ commit: values['--commit'], image: values['--image'], bundle: values['--bundle'], bundleSha: values['--bundle-sha256'], leaseSha: values['--lease-sha256'], controllerSha: values['--controller-sha256'], executeReviewed: values['--execute-reviewed'] === 'yes' }))) }
    catch { console.error('Private SQL proof refused; verify fixed reader NOLOGIN/passwordNULL before any retry'); process.exitCode = 1 }
  }
}
