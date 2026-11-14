import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const alt = 'Xprout | Digital menus built for service'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
const asset = join(process.cwd(), 'public/brand/xprout/v1/social-card-1200x630.png')
const MAX_BYTES = 180 * 1024

/** Serve the pre-optimized approved artwork; no request-time image encoding. */
export default async function Image() {
  const info = await stat(asset)
  if (info.size > MAX_BYTES) throw new Error('Platform social image exceeds its media budget')
  const bytes = await readFile(asset)
  if (bytes.length > MAX_BYTES || bytes.length < 24 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a'
    || bytes.readUInt32BE(16) !== size.width || bytes.readUInt32BE(20) !== size.height) {
    throw new Error('Invalid platform social image')
  }
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' } })
}
