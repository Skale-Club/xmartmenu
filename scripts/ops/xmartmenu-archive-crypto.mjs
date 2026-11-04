import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import { chmod, open, readFile, writeFile } from 'node:fs/promises'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { assertPacket, compareManifests, compatibilitySql, MANIFEST_SQL, SEQUENCES, TABLES } from './xmartmenu-source-protocol.mjs'

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAGIC = Buffer.from('XMRH0001')
function cipherKey(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('Archive key refused')
  return Buffer.from(value, 'hex')
}
function cap(limit = MAX_ARCHIVE_BYTES) {
  let size = 0
  return new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > limit ? Error('Archive limit refused') : null, chunk) } })
}
export async function encryptArchive(input, path, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', cipherKey(key), iv)
  const output = createWriteStream(path, { flags: 'wx', mode: 0o600 })
  output.write(Buffer.concat([MAGIC, iv]))
  await pipeline(input, cap(), cipher, output, { end: false })
  output.end(cipher.getAuthTag())
  await new Promise((resolve, reject) => { output.once('finish', resolve); output.once('error', reject) })
  await chmod(path, 0o400)
}
async function archiveHandle(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 36 || stat.size > MAX_ARCHIVE_BYTES + 36
      || (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o400))) throw Error('Archive shape refused')
    const header = Buffer.alloc(20), tag = Buffer.alloc(16)
    await handle.read(header, 0, header.length, 0); await handle.read(tag, 0, tag.length, stat.size - 16)
    if (!header.subarray(0, 8).equals(MAGIC)) throw Error('Archive format refused')
    return { handle, stat, iv: header.subarray(8), tag }
  } catch (error) { await handle.close(); throw error }
}
async function authenticatedPass(archive, key, output) {
  const decipher = createDecipheriv('aes-256-gcm', cipherKey(key), archive.iv)
  decipher.setAuthTag(archive.tag)
  const input = createReadStream('', { fd: archive.handle.fd, autoClose: false, start: 20, end: archive.stat.size - 17 })
  await pipeline(input, decipher, output)
}
export async function authenticateArchive(path, key) {
  const archive = await archiveHandle(path)
  try { await authenticatedPass(archive, key, new Writable({ write(_, __, done) { done() } })) }
  finally { await archive.handle.close() }
}
export async function decryptArchive(path, output, key) {
  const archive = await archiveHandle(path)
  try {
    // First verify the complete ciphertext and GCM tag while discarding output.
    // No unauthenticated byte can reach pg_restore/SQL in the second pass.
    await authenticatedPass(archive, key, new Writable({ write(_, __, done) { done() } }))
    const current = await archive.handle.stat()
    if (current.size !== archive.stat.size || current.mtimeMs !== archive.stat.mtimeMs || current.ino !== archive.stat.ino) throw Error('Archive changed')
    await authenticatedPass(archive, key, output)
  } finally { await archive.handle.close() }
}
export function reviewedToc(text) {
  if (typeof text !== 'string' || text.length > 1024 * 1024) throw Error('Archive TOC refused')
  let publicSchemas = 0, ledgers = 0
  const tables = []
  const sequences = Object.fromEntries(Object.keys(SEQUENCES).map(name => [name, new Set()]))
  const allowed = new Set(['TABLE', 'TABLE DATA', 'FUNCTION', 'VIEW', 'DEFAULT', 'CONSTRAINT', 'FK CONSTRAINT', 'INDEX', 'TRIGGER', 'POLICY', 'ROW SECURITY'])
  const lines = text.split('\n').map(line => {
    if (!line.trim() || line.startsWith(';')) return line
    const match = /^(\d+); \d+ \d+ ([A-Z ]+) ([^ ]+) (.+)$/.exec(line)
    if (!match) throw Error('Archive TOC refused')
    const [, , kind, schema, name] = match
    if (kind === 'SCHEMA' && schema === '-' && /^public(?:\s|$)/.test(name)) { publicSchemas++; return `;${line}` }
    if (kind === 'SCHEMA' && schema === '-' && /^supabase_migrations(?:\s|$)/.test(name)) { ledgers++; return line }
    if (['ENCODING', 'STDSTRINGS', 'SEARCHPATH'].includes(kind) && schema === '-') return line
    if (schema === 'public' && ['SEQUENCE','SEQUENCE OWNED BY','SEQUENCE SET'].includes(kind)) {
      const reviewed = sequences[name.split(' ')[0]]
      if (!reviewed || reviewed.has(kind)) throw Error('Archive sequence refused')
      reviewed.add(kind); return line
    }
    if (!['public', 'supabase_migrations'].includes(schema) || !allowed.has(kind)) throw Error('Archive TOC refused')
    if (kind === 'TABLE' && schema === 'public') tables.push(name.split(' ')[0])
    return line
  })
  if (publicSchemas !== 1 || ledgers !== 1 || tables.sort().join('|') !== TABLES.join('|') || Object.values(sequences).some(kinds => kinds.size !== 3)) throw Error('Archive TOC baseline refused')
  return lines.join('\n')
}
async function readKey(input) {
  const iterator = input[Symbol.asyncIterator]()
  let pending = Buffer.alloc(0)
  for (;;) {
    const chunk = await iterator.next()
    if (chunk.done) throw Error('Archive key missing')
    pending = Buffer.concat([pending, chunk.value])
    const newline = pending.indexOf(10)
    if (newline < 0) { if (pending.length > 65) throw Error('Archive key refused'); continue }
    if (newline !== 64) throw Error('Archive key refused')
    const key = pending.subarray(0, newline).toString('ascii'), rest = pending.subarray(newline + 1)
    cipherKey(key)
    return { key, input: Readable.from((async function* () { if (rest.length) yield rest; for (;;) { const value = await iterator.next(); if (value.done) break; yield value.value } })()) }
  }
}
async function boundedInput(input, limit) {
  const chunks = []; let size = 0
  for await (const chunk of input) { size += chunk.length; if (size > limit) throw Error('Input limit refused'); chunks.push(chunk) }
  return Buffer.concat(chunks).toString('utf8')
}
async function main(operation) {
  const root = '/private'
  if (operation === 'admit') {
    const packet = assertPacket(JSON.parse(await boundedInput(process.stdin, 131072)))
    await writeFile(`${root}/source-ca.crt`, packet.ca, { flag: 'wx', mode: 0o600 })
    await writeFile(`${root}/source-manifest.json`, `${JSON.stringify(packet.manifest)}\n`, { flag: 'wx', mode: 0o600 })
    await writeFile(`${root}/compatibility.sql`, compatibilitySql(packet.authIds), { flag: 'wx', mode: 0o600 })
    await writeFile(`${root}/manifest.sql`, MANIFEST_SQL, { flag: 'wx', mode: 0o600 })
    await writeFile(`${root}/snapshot.id`, packet.snapshot, { flag: 'wx', mode: 0o600 })
    process.stdout.write(packet.environment)
  } else if (operation === 'toc') {
    const source = await readFile(`${root}/archive.list`, 'utf8')
    await writeFile(`${root}/restore.list`, reviewedToc(source), { flag: 'wx', mode: 0o600 })
  } else if (operation === 'compare') {
    const source = JSON.parse(await readFile(`${root}/source-manifest.json`, 'utf8'))
    const target = JSON.parse(await readFile(`${root}/target-manifest.json`, 'utf8'))
    process.stdout.write(JSON.stringify(compareManifests(source, target)))
  } else {
    const { key, input } = await readKey(process.stdin)
    if (operation === 'encrypt') await encryptArchive(input, `${root}/archive.gcm`, key)
    else if (operation === 'verify') await authenticateArchive(`${root}/archive.gcm`, key)
    else if (operation === 'decrypt') await decryptArchive(`${root}/archive.gcm`, process.stdout, key)
    else throw Error('Unknown archive operation')
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch(() => { process.stderr.write('Private rehearsal helper failed; details omitted.'); process.exitCode = 1 })
}
