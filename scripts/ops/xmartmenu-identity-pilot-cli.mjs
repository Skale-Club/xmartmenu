#!/usr/bin/env node
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
const directory=new URL('./',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex')
if(process.argv.length!==4||process.argv[2]!=='--serve-reviewed'||!/^([a-f0-9]{64})$/.test(process.argv[3])){
  console.log('PLAN ONLY: isolated Xmartmenu identity harness; no socket, database, provider or filesystem mutation.');process.exit(0)
}
try{
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0'||process.env.FIREBASE_AUTH_EMULATOR_HOST||process.env.NODE_OPTIONS)throw new Error()
  const raw=await readFile(new URL('manifest.json',directory))
  if(sha(raw)!==process.argv[3])throw new Error()
  const manifest=JSON.parse(raw)
  if(Object.keys(manifest).sort().join('|')!=='browser.js|launcher.sh|server.cjs|xmartmenu-identity-pilot-cli.mjs')throw new Error()
  for(const [name,hash]of Object.entries(manifest))if(!/^[a-f0-9]{64}$/.test(hash)||sha(await readFile(new URL(name,directory)))!==hash)throw new Error()
  let size=0;const chunks=[]
  const timer=setTimeout(()=>process.stdin.destroy(new Error('Configuration timeout')),5000)
  try{for await(const part of process.stdin){size+=part.length;if(size>32768)throw new Error();chunks.push(part)}}finally{clearTimeout(timer)}
  const configuration=JSON.parse(Buffer.concat(chunks).toString('utf8'));chunks.length=0
  const {startPilot}=createRequire(import.meta.url)(fileURLToPath(new URL('server.cjs',directory)))
  const active=await startPilot(configuration,await readFile(new URL('browser.js',directory),'utf8'))
  process.stdin.destroy();console.log(JSON.stringify({isolatedPilotReady:true}))
  const stop=()=>{void active.close().then(()=>process.exit(0),()=>process.exit(1))}
  process.once('SIGTERM',stop);process.once('SIGINT',stop)
}catch{console.error('Isolated pilot refused.');process.exit(1)}
