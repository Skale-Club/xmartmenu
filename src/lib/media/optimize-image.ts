import sharp from 'sharp'
import { imagePolicy, type ImageOptimizationOptions } from './image-policy'

/** Keep animation, alpha and EXIF orientation while removing embedded metadata. */
export async function optimizeImageToWebP(input: Buffer, options: ImageOptimizationOptions = {}): Promise<Buffer> {
  const { maxSide, maxBytes } = imagePolicy(options)
  let side = maxSide
  for (let attempt = 0; attempt < 8; attempt++) {
    let smallest: Buffer | undefined
    for (const quality of [80, 68, 56]) {
      const buffer = await sharp(input, { animated: true })
        .rotate()
        .resize(side, side, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, alphaQuality: 100, effort: 5, smartSubsample: true })
        .toBuffer()
      if (buffer.length <= maxBytes) return buffer
      smallest = buffer
    }
    // Difficult textures need fewer pixels, not arbitrarily low quality.
    const next = Math.max(1, Math.floor(side * Math.min(0.8, Math.sqrt(maxBytes / smallest!.length) * 0.9)))
    if (next === side) break
    side = next
  }
  throw new Error(`Image cannot fit the ${Math.round(maxBytes / 1024)}KB limit while preserving its content.`)
}
