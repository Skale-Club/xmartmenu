import { describe, expect, it } from 'vitest'
import {
  MAX_AR_MODEL_BYTES,
  RECOMMENDED_AR_MODEL_BYTES,
  arModelStoragePath,
  checkArModelFile,
  formatModelSize,
  sniffArModelFormat,
} from '@/lib/ar/model-file'

/** A minimal GLB: 12-byte header ("glTF", version, total length) + padding. */
function glb(totalLength = 20, version = 2, declaredLength = totalLength): Uint8Array {
  const data = new Uint8Array(totalLength)
  const view = new DataView(data.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, version, true)
  view.setUint32(8, declaredLength, true)
  return data
}

function zip(length = 30): Uint8Array {
  const data = new Uint8Array(length)
  data.set([0x50, 0x4b, 0x03, 0x04])
  return data
}

describe('sniffArModelFormat', () => {
  it('recognises GLB and zip (USDZ) by their magic bytes', () => {
    expect(sniffArModelFormat(glb())).toBe('glb')
    expect(sniffArModelFormat(zip())).toBe('usdz')
  })

  it('returns null for anything else', () => {
    expect(sniffArModelFormat(new TextEncoder().encode('{"asset":{"version":"2.0"}}'))).toBeNull()
    expect(sniffArModelFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull()
    expect(sniffArModelFormat(new Uint8Array([0x67]))).toBeNull()
  })
})

describe('checkArModelFile', () => {
  it('accepts a well-formed GLB in the GLB slot', () => {
    expect(checkArModelFile(glb(64), 'glb')).toEqual({ ok: true, format: 'glb', bytes: 64, heavy: false })
  })

  it('accepts a zip in the USDZ slot', () => {
    expect(checkArModelFile(zip(), 'usdz')).toMatchObject({ ok: true, format: 'usdz' })
  })

  it('refuses an empty file', () => {
    expect(checkArModelFile(new Uint8Array(0), 'glb')).toEqual({ ok: false, error: 'The file is empty.' })
  })

  it('refuses a file over the size limit before looking at it', () => {
    const result = checkArModelFile(new Uint8Array(MAX_AR_MODEL_BYTES + 1), 'glb')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/too large/)
  })

  it('flags a heavy (but allowed) model', () => {
    const big = glb(RECOMMENDED_AR_MODEL_BYTES + 4)
    expect(checkArModelFile(big, 'glb')).toMatchObject({ ok: true, heavy: true })
  })

  it('refuses a glTF JSON or an image in the GLB slot', () => {
    const result = checkArModelFile(new TextEncoder().encode('{"asset":{}}'), 'glb')
    expect(result).toEqual({ ok: false, error: 'This is not a GLB file. Export the model as glTF Binary (.glb).' })
  })

  it('says which slot a file of the other format belongs in', () => {
    const usdzInGlb = checkArModelFile(zip(), 'glb')
    const glbInUsdz = checkArModelFile(glb(), 'usdz')
    expect(usdzInGlb.ok || usdzInGlb.error).toMatch(/iOS file/)
    expect(glbInUsdz.ok || glbInUsdz.error).toMatch(/3D model/)
  })

  it('refuses glTF 1.0', () => {
    const result = checkArModelFile(glb(20, 1), 'glb')
    expect(result.ok || result.error).toMatch(/version 1/)
  })

  it('refuses a truncated GLB whose header claims more bytes', () => {
    const result = checkArModelFile(glb(20, 2, 4096), 'glb')
    expect(result.ok || result.error).toMatch(/incomplete or damaged/)
  })

  it('refuses a GLB shorter than its header', () => {
    const data = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])
    expect(checkArModelFile(data, 'glb')).toEqual({ ok: false, error: 'The GLB file is truncated.' })
  })
})

describe('arModelStoragePath', () => {
  it('keeps models under the tenant, in an ar/ folder, with the right extension', () => {
    expect(arModelStoragePath('t1', 'glb', 1000, 0.5)).toBe('t1/ar/1000-i.glb')
    expect(arModelStoragePath('t1', 'usdz', 1000, 0.123456)).toMatch(/^t1\/ar\/1000-[a-z0-9]+\.usdz$/)
  })
})

describe('formatModelSize', () => {
  it('formats sizes for the back office', () => {
    expect(formatModelSize(null)).toBe('')
    expect(formatModelSize(0)).toBe('')
    expect(formatModelSize(100)).toBe('1 KB')
    expect(formatModelSize(820 * 1024)).toBe('820 KB')
    expect(formatModelSize(3.4 * 1024 * 1024)).toBe('3.4 MB')
  })
})
