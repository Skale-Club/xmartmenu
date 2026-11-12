import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { convertBufferToWebP, validateAndConvertToWebP } from '@/lib/upload'
import { IMAGE_PROFILES } from '@/lib/media/image-policy'

describe('bounded image optimization', () => {
  it('bounds a detailed source by both bytes and dimensions, including a custom budget', async () => {
    const width = 1400, height = 1000
    const pixels = Buffer.alloc(width * height * 3)
    let seed = 12345
    for (let i = 0; i < pixels.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
      pixels[i] = seed & 255
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer()
    const output = await convertBufferToWebP(input)
    const meta = await sharp(output).metadata()
    expect(output.length).toBeLessThanOrEqual(IMAGE_PROFILES.photo.maxBytes)
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1200)
    expect(meta.format).toBe('webp')
    const tighter = await convertBufferToWebP(input, { maxSize: 30 * 1024 })
    expect(tighter.length).toBeLessThanOrEqual(30 * 1024)
  }, 30_000)

  it('turns EXIF-oriented photos upright and strips their metadata', async () => {
    const input = await sharp({ create: { width: 600, height: 300, channels: 3, background: 'red' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const output = await convertBufferToWebP(input)
    const meta = await sharp(output).metadata()
    expect([meta.width, meta.height]).toEqual([300, 600])
    expect(meta.orientation).toBeUndefined()
    expect(meta.exif).toBeUndefined()
    expect(meta.icc).toBeUndefined()
  })

  it('keeps transparency and caps logo dimensions and bytes', async () => {
    const input = await sharp({ create: { width: 1000, height: 1000, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.3 } } }).png().toBuffer()
    const result = await validateAndConvertToWebP(new File([input], 'logo.png', { type: 'image/png' }), { profile: 'logo' })
    expect(result.error).toBeUndefined()
    const meta = await sharp(result.buffer!).metadata()
    expect([meta.width, meta.height]).toEqual([512, 512])
    expect(meta.hasAlpha).toBe(true)
    expect(result.buffer!.length).toBeLessThanOrEqual(40 * 1024)
    const { data, info } = await sharp(result.buffer!).raw().toBuffer({ resolveWithObject: true })
    expect(data[info.channels - 1]).toBeCloseTo(77, -1)
  })

  it('keeps both frames and timing when a GIF is converted to animated WebP', async () => {
    const pixels = Buffer.alloc(40 * 80 * 4)
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i + (i < pixels.length / 2 ? 0 : 2)] = 255
      pixels[i + 3] = 255
    }
    const input = await sharp(pixels, { raw: { width: 40, height: 80, channels: 4, pageHeight: 40 } })
      .gif({ delay: [100, 200], loop: 0 }).toBuffer()
    const result = await validateAndConvertToWebP(new File([input], 'animated.gif', { type: 'image/gif' }), { maxSide: 20 })
    expect(result.error).toBeUndefined()
    const meta = await sharp(result.buffer!, { animated: true }).metadata()
    expect(meta.pages).toBe(2)
    expect(meta.width).toBe(20)
    expect(meta.pageHeight).toBe(20)
    expect(meta.delay).toEqual([100, 200])
    expect(meta.loop).toBe(0)
  })

  it('preserves vector bytes and MIME, rejecting SVG above its profile budget', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'
    const result = await validateAndConvertToWebP(new File([svg], 'logo.svg', { type: 'image/svg+xml' }), { profile: 'logo' })
    expect(result).toMatchObject({ contentType: 'image/svg+xml', extension: 'svg' })
    expect(result.buffer?.toString()).toBe(svg)
    const oversized = await validateAndConvertToWebP(new File([svg, ' '.repeat(41 * 1024)], 'big.svg', { type: 'image/svg+xml' }), { profile: 'logo' })
    expect(oversized.error).toContain('SVG is too large')
  })

  it('returns a validation error for corrupt raster bytes instead of uploading them', async () => {
    const result = await validateAndConvertToWebP(new File(['broken'], 'bad.png', { type: 'image/png' }))
    expect(result.error).toContain('could not be optimized')
  })
})
