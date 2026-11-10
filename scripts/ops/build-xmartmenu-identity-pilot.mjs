#!/usr/bin/env node
import {build} from 'esbuild'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'

export async function buildPilot(destination){
  const out=resolve(destination);await mkdir(out,{recursive:false})
  const server=await build({entryPoints:['scripts/ops/xmartmenu-identity-pilot-server.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',
    outfile:join(out,'server.cjs'),external:['pg'],metafile:true,logLevel:'silent'})
  const included=Object.values(server.metafile.outputs).flatMap(value=>Object.entries(value.inputs).filter(([,detail])=>detail.bytesInOutput>0).map(([name])=>name))
  if(included.some(name=>/node_modules\/(?:next|stripe|@supabase|@upstash|@aws-sdk)\//.test(name)))throw new Error('Pilot bundle contains an unrelated runtime')
  await build({entryPoints:['scripts/ops/xmartmenu-identity-pilot-browser.ts'],bundle:true,platform:'browser',format:'iife',target:'es2020',
    outfile:join(out,'browser.js'),minify:true,logLevel:'silent'})
  await writeFile(join(out,'xmartmenu-identity-pilot-cli.mjs'),await readFile('scripts/ops/xmartmenu-identity-pilot-cli.mjs'))
  await writeFile(join(out,'launcher.sh'),(await readFile('scripts/ops/xmartmenu-identity-pilot-launcher.sh','utf8')).replaceAll('\r\n','\n'))
  const manifest={}
  for(const file of ['browser.js','server.cjs','xmartmenu-identity-pilot-cli.mjs','launcher.sh'])manifest[file]=createHash('sha256').update(await readFile(join(out,file))).digest('hex')
  const raw=JSON.stringify(manifest,null,2)+'\n';await writeFile(join(out,'manifest.json'),raw)
  return{files:Object.keys(manifest).length,manifestSha256:createHash('sha256').update(raw).digest('hex')}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4||process.argv[2]!=='--output-new')console.log('PLAN ONLY: builds public pilot artifacts into a new directory only when --output-new PATH is supplied.')
  else console.log(JSON.stringify(await buildPilot(process.argv[3])))
}
