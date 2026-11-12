/**
 * Shrinks a photo in the browser before upload: phone photos are often
 * 4–12 MB, which used to hit the 5 MB upload limit and took long on mobile
 * data. The server still converts to WebP (src/lib/upload.ts); this only
 * makes the trip small. Respects the photo's EXIF orientation.
 *
 * Leaves alone what it should not touch: SVG, GIF (animation), files that are
 * already small, and anything the browser cannot decode.
 */

import { imagePolicy, type ImageOptimizationOptions } from './image-policy'

// The server preserves animation; canvas would flatten these formats.
const SKIP_TYPES = new Set(['image/svg+xml', 'image/gif', 'image/webp', 'image/avif'])

export interface CompressOptions extends ImageOptimizationOptions {
  /** Longest side, in pixels. */
  maxSide?: number
  /** 0–1 encoder quality. */
  quality?: number
  /** Files at or under this size (bytes) are sent as they are. */
  skipUnder?: number
}

/** Target size keeping the aspect ratio, never enlarging. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxSide || longest <= 0) return { width, height }
  const scale = maxSide / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function compressImageForUpload(file: File, options: CompressOptions = {}): Promise<File> {
  const { maxSide, maxBytes } = imagePolicy(options)
  const { quality = 0.8, skipUnder = 0 } = options
  if (typeof window === 'undefined' || !file.type.startsWith('image/') || SKIP_TYPES.has(file.type)) return file
  if (file.size <= skipUnder) return file
  let bitmap: ImageBitmap | undefined
  try {
    if (file.type === 'image/png') {
      const bytes = new DataView(await file.arrayBuffer())
      // APNG's animation control chunk occurs before the first frame.
      for (let offset = 8; offset + 12 <= bytes.byteLength;) {
        const type = bytes.getUint32(offset + 4)
        if (type === 0x6163544c) return file // acTL
        if (type === 0x49444154) break // IDAT
        offset += bytes.getUint32(offset) + 12
      }
    }
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    if (file.size <= maxBytes && Math.max(bitmap.width, bitmap.height) <= maxSide) return file
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    let side = maxSide
    for (let attempt = 0; attempt < 6; attempt++) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side)
      canvas.width = width
      canvas.height = height
      ctx.drawImage(bitmap, 0, 0, width, height)
      let encoded: Blob | null = null
      for (const q of [quality, Math.min(quality, 0.68), Math.min(quality, 0.56)]) {
        encoded = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', q))
        // Unsupported WebP encoders must not lose alpha through a JPEG fallback.
        if (!encoded || encoded.type !== 'image/webp') return file
        if (encoded.size <= maxBytes) {
          if (encoded.size >= file.size) return file
          const name = file.name.replace(/\.[^.]+$/, '') || 'image'
          return new File([encoded], `${name}.webp`, { type: encoded.type, lastModified: Date.now() })
        }
      }
      side = Math.max(1, Math.floor(side * Math.min(0.8, Math.sqrt(maxBytes / encoded!.size) * 0.9)))
    }
    return file // The server enforces the final storage budget.
  } catch {
    return file
  } finally {
    bitmap?.close?.()
  }
}
