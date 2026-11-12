import { afterEach, describe, expect, it, vi } from 'vitest'
import { compressImageForUpload } from '@/lib/media/client-compress'

afterEach(() => vi.unstubAllGlobals())

function browser(encode: (quality?: number) => Blob) {
  const bitmap = { width: 2000, height: 1000, close: vi.fn() }
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (callback: (blob: Blob) => void, _type: string, quality?: number) => callback(encode(quality)),
  }
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  return { bitmap, canvas }
}

describe('browser upload preprocessing', () => {
  it('reduces pixels when quality alone cannot meet its byte budget', async () => {
    let encodes = 0
    const { bitmap, canvas } = browser(() => new Blob([new Uint8Array(++encodes > 3 ? 90_000 : 200_000)], { type: 'image/webp' }))
    const output = await compressImageForUpload(new File([new Uint8Array(300_000)], 'phone.jpg', { type: 'image/jpeg' }))
    expect(output.type).toBe('image/webp')
    expect(output.size).toBeLessThanOrEqual(100 * 1024)
    expect(canvas.width).toBeLessThan(1200)
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('honors a caller byte budget', async () => {
    browser(() => new Blob([new Uint8Array(20_000)], { type: 'image/webp' }))
    const output = await compressImageForUpload(new File([new Uint8Array(300_000)], 'phone.jpg', { type: 'image/jpeg' }), { maxSize: 25_000 })
    expect(output.size).toBeLessThanOrEqual(25_000)
  })

  it('leaves alpha intact when the browser cannot encode WebP', async () => {
    const { bitmap } = browser(() => new Blob(['unsupported fallback'], { type: 'image/png' }))
    const file = new File([new Uint8Array(300_000)], 'transparent.png', { type: 'image/png' })
    expect(await compressImageForUpload(file)).toBe(file)
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it.each(['image/svg+xml', 'image/gif', 'image/webp', 'image/avif'])('leaves %s for the server to preserve vector/animation semantics', async type => {
    browser(() => new Blob())
    const file = new File(['image'], 'image', { type })
    expect(await compressImageForUpload(file)).toBe(file)
    expect(createImageBitmap).not.toHaveBeenCalled()
  })
})
