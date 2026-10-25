/**
 * Shrinks a photo in the browser before upload: phone photos are often
 * 4–12 MB, which used to hit the 5 MB upload limit and took long on mobile
 * data. The server still converts to WebP (src/lib/upload.ts); this only
 * makes the trip small. Respects the photo's EXIF orientation.
 *
 * Leaves alone what it should not touch: SVG, GIF (animation), files that are
 * already small, and anything the browser cannot decode.
 */

const SKIP_TYPES = new Set(['image/svg+xml', 'image/gif'])

export interface CompressOptions {
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
  const { maxSide = 2048, quality = 0.85, skipUnder = 1_200_000 } = options
  if (typeof window === 'undefined' || !file.type.startsWith('image/') || SKIP_TYPES.has(file.type)) return file
  if (file.size <= skipUnder) return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality))
    // Safari without WebP encoding hands back PNG; JPEG is smaller then.
    const encoded = blob && blob.type === 'image/webp'
      ? blob
      : await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!encoded || encoded.size >= file.size) return file
    const ext = encoded.type === 'image/webp' ? 'webp' : 'jpg'
    const name = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([encoded], `${name}.${ext}`, { type: encoded.type, lastModified: Date.now() })
  } catch {
    return file
  }
}
