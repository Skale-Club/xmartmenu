import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export async function buildReader({ output, expectedCommit }) {
  if (!/^[0-9a-f]{40}$/.test(expectedCommit) || !output || existsSync(output) || existsSync(`${output}.json`)) throw new Error('New public artifact and exact source commit required')
  execFileSync('git', ['cat-file', '-e', `${expectedCommit}^{commit}`])
  const normalized = bytes => Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
  const digest = bytes => createHash('sha256').update(normalized(bytes)).digest('hex')
  if (digest(readFileSync('package-lock.json')) !== digest(execFileSync('git', ['show', `${expectedCommit}:package-lock.json`]))) throw new Error('Matching validated dependency lock required')
  const result = await build({ entryPoints: ['scripts/ops/xmartmenu-private-reader-client.ts'], bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['pg'], write: false, logLevel: 'silent', metafile: true })
  const sourceHashes = {}
  for (const name of Object.keys(result.metafile.inputs).filter(n => n.startsWith('src/'))) {
    const actual = digest(readFileSync(name))
    if (actual !== digest(execFileSync('git', ['show', `${expectedCommit}:${name}`]))) throw new Error('Read adapter differs from validated image commit')
    sourceHashes[name] = actual
  }
  const bytes = result.outputFiles[0].contents
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length > 250_000) throw new Error('Public reader bundle exceeds reviewed limit')
  writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 })
  writeFileSync(`${output}.json`, `${JSON.stringify({ version: 1, sourceCommit: expectedCommit, bundleSha256: hash,
    readerEntrySha256: digest(readFileSync('scripts/ops/xmartmenu-private-reader-client.ts')), adapterSourceHashes: sourceHashes,
    publicCodeOnly: true, sqlWrites: false, providerCalls: false }, null, 2)}
`, { flag: 'wx', mode: 0o600 })
  return { publicBundleCreated: true, sourceCommit: expectedCommit, bundleSha256: hash, adapterSourcesCompared: Object.keys(sourceHashes).length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (!args.length || args.length === 1 && args[0] === '--plan') console.log(JSON.stringify({ plan: 'PLAN ONLY: build public read adapters after validated matching release; no credential or SQL action' }))
  else if (args.length === 4 && args[0] === '--build-reviewed' && args[2] === '--expected-commit') {
    try { console.log(JSON.stringify(await buildReader({ output: args[1], expectedCommit: args[3] }))) }
    catch { console.error('Public reader build refused'); process.exitCode = 1 }
  } else process.exitCode = 2
}
