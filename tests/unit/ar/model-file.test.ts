import { describe, expect, it } from 'vitest'
import {
  MAX_AR_MODEL_BYTES,
  RECOMMENDED_AR_MODEL_BYTES,
  arModelStoragePath,
  arUnsupportedExtensions,
  checkArModelFile,
  formatModelSize,
  glbFootprint,
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

  it('refuses a GLB compressed in a way Android AR cannot open', () => {
    const result = checkArModelFile(glbWithJson({ asset: { version: '2.0' }, extensionsUsed: ['KHR_draco_mesh_compression', 'KHR_materials_unlit'], extensionsRequired: ['KHR_draco_mesh_compression'] }), 'glb')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('KHR_draco_mesh_compression')
  })

  it('accepts a plain GLB with extensions Scene Viewer reads', () => {
    const data = glbWithJson({ asset: { version: '2.0' }, extensionsUsed: ['KHR_materials_unlit', 'KHR_texture_transform'] })
    expect(checkArModelFile(data, 'glb')).toMatchObject({ ok: true, format: 'glb' })
  })
})

/** A GLB whose first chunk is the given glTF JSON (padded to 4 bytes). */
function glbWithJson(json: unknown): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const padded = Math.ceil(text.length / 4) * 4
  const data = new Uint8Array(20 + padded).fill(0x20, 20)
  const view = new DataView(data.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, data.length, true)
  view.setUint32(12, padded, true)
  view.setUint32(16, 0x4e4f534a, true)
  data.set(text, 20)
  return data
}

describe('arUnsupportedExtensions', () => {
  it('lists every blocked extension the model uses, and nothing for a GLB without a JSON chunk', () => {
    expect(arUnsupportedExtensions(glbWithJson({ extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_materials_unlit'] })))
      .toEqual(['EXT_meshopt_compression', 'EXT_texture_webp'])
    expect(arUnsupportedExtensions(glb())).toEqual([])
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

describe('glbFootprint', () => {
  // The Aurora sandwich: a photogrammetry scan modelled Z-up, turned upright by its node.
  const sandwich = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, rotation: [-0.7071067811865475, 0, 0, 0.7071067811865476] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [-0.187, -0.137, 0], max: [0.168, 0.147, 0.073] }],
  }

  it('measures the model through its node transforms, in centimetres', () => {
    expect(glbFootprint(glbWithJson(sandwich))).toEqual({ widthCm: 35.5, depthCm: 28.4, heightCm: 7.3, largestSideCm: 35.5 })
  })

  it('applies parent scale and translation', () => {
    const scaled = { ...sandwich, scenes: [{ nodes: [1] }], nodes: [sandwich.nodes[0], { children: [0], scale: [0.5, 0.5, 0.5], translation: [3, 0, 0] }] }
    expect(glbFootprint(glbWithJson(scaled))?.largestSideCm).toBe(17.8)
  })

  it('is null without meshes or JSON', () => {
    expect(glbFootprint(glbWithJson({ asset: { version: '2.0' } }))).toBeNull()
    expect(glbFootprint(new Uint8Array(8))).toBeNull()
  })
})
