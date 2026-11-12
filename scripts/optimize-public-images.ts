/** Optimize existing WebP assets with the same limits as future uploads.
 * Dry run: node --import tsx scripts/optimize-public-images.ts
 * Apply:   node --import tsx scripts/optimize-public-images.ts --apply
 * Backups and a report stay under output/image-optimization/ (not versioned).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { optimizeImageToWebP } from '../src/lib/media/optimize-image'
import { imagePolicy, type ImageProfile } from '../src/lib/media/image-policy'

async function main() {
const root = path.resolve('public')
const output = path.resolve('output/image-optimization')
const apply = process.argv.includes('--apply')
sharp.concurrency(1)
async function files(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nested: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) nested.push(...await files(full))
    else if (entry.isFile() && entry.name.endsWith('.webp')) nested.push(full)
  }
  return nested
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const report = []
await fs.mkdir(output, { recursive: true })
for (const file of (await files(root)).sort()) {
  const relative = path.relative(root, file)
  const profile: ImageProfile = /logo|favicon/i.test(path.basename(file)) ? 'logo' : /banner|hero|cta-bg/i.test(path.basename(file)) ? 'wide' : 'photo'
  const policy = imagePolicy({ profile })
  const original = await fs.readFile(file)
  const meta = await sharp(original, { animated: true }).metadata()
  const height = meta.pageHeight ?? meta.height ?? 0
  if (original.length <= policy.maxBytes && Math.max(meta.width ?? 0, height) <= policy.maxSide) {
    report.push({ file: relative, profile, before: original.length, after: original.length, changed: false })
    continue
  }
  const encoded = await optimizeImageToWebP(original, { profile })
  const after = await sharp(encoded, { animated: true }).metadata()
  if (encoded.length > policy.maxBytes || Math.max(after.width ?? 0, after.pageHeight ?? after.height ?? 0) > policy.maxSide) throw new Error(`Image budget failed: ${relative}`)
  if ((meta.pages ?? 1) !== (after.pages ?? 1) || Boolean(meta.hasAlpha) !== Boolean(after.hasAlpha)) throw new Error(`Image content properties changed: ${relative}`)
  if (apply) {
    const backup = path.join(output, 'static-backup', relative)
    await fs.mkdir(path.dirname(backup), { recursive: true })
    await fs.writeFile(backup, original, { flag: 'wx' })
    // Refuse to overwrite a concurrent edit.
    if (hash(await fs.readFile(file)) !== hash(original)) throw new Error(`Source changed: ${relative}`)
    await fs.writeFile(file, encoded)
  }
  report.push({ file: relative, profile, before: original.length, after: encoded.length, changed: true,
    beforeSha256: hash(original), afterSha256: hash(encoded), width: after.width, height: after.pageHeight ?? after.height })
}
const summary = { mode: apply ? 'apply' : 'plan', files: report.length, changed: report.filter(r => r.changed).length,
  before: report.reduce((n, r) => n + r.before, 0), after: report.reduce((n, r) => n + r.after, 0), assets: report }
await fs.writeFile(path.join(output, `static-${apply ? 'applied' : 'plan'}.json`), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ ...summary, assets: undefined }))
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
