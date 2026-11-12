import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { IMAGE_PROFILES } from '@/lib/media/image-policy'

async function webpFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await webpFiles(file))
    else if (entry.isFile() && entry.name.endsWith('.webp')) result.push(file)
  }
  return result
}

describe('published local image budgets', () => {
  it('keeps every checked-in WebP within its byte and pixel budget', async () => {
    const files = await webpFiles(path.resolve('public'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const name = path.basename(file)
      const policy = /logo|favicon/i.test(name) ? IMAGE_PROFILES.logo : /banner|hero|cta-bg/i.test(name) ? IMAGE_PROFILES.wide : IMAGE_PROFILES.photo
      const bytes = await fs.readFile(file)
      const meta = await sharp(bytes, { animated: true }).metadata()
      expect(bytes.length, path.relative(process.cwd(), file)).toBeLessThanOrEqual(policy.maxBytes)
      expect(Math.max(meta.width ?? 0, meta.pageHeight ?? meta.height ?? 0), name).toBeLessThanOrEqual(policy.maxSide)
    }
  })
})
