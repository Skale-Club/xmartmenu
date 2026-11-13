import { describe, expect, it } from 'vitest'
import { scaleGlb } from '@/lib/ar/scale-glb'
import { glbFootprint, MAX_AR_MODEL_BYTES } from '@/lib/ar/model-file'

export function fixtureGlb() {
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }, { nodes: [0] }],
    nodes: [{ mesh: 0, translation: [0.1, 0, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [0, 0, 0], max: [1, 0.2, 0.5] }],
  }))
  const length = Math.ceil(json.length / 4) * 4
  const bytes = new Uint8Array(20 + length + 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true)
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true)
  bytes.fill(0x20, 20, 20 + length); bytes.set(json, 20)
  view.setUint32(20 + length, 4, true); view.setUint32(24 + length, 0x004e4942, true)
  bytes.set([1, 2, 3, 4], 28 + length)
  return bytes
}

describe('Scene Viewer real-size GLB', () => {
  it('bakes scale into each scene while preserving the original and all binary bytes', () => {
    const input = fixtureGlb(), before = input.slice()
    const output = scaleGlb(input, 0.3)
    expect(glbFootprint(output)).toEqual({ widthCm: 30, depthCm: 15, heightCm: 6, largestSideCm: 30 })
    expect(output.slice(-12)).toEqual(input.slice(-12))
    expect(input).toEqual(before)
    const view = new DataView(output.buffer)
    expect(view.getUint32(8, true)).toBe(output.length)
    const json = JSON.parse(new TextDecoder().decode(output.subarray(20, 20 + view.getUint32(12, true))))
    expect(json.scenes).toEqual([{ nodes: [1] }, { nodes: [2] }])
    expect(json.nodes[2].scale).toEqual([0.3, 0.3, 0.3])
  })

  it.each([0, NaN, Infinity, -1, 21])('rejects invalid scale %s', scale => {
    expect(() => scaleGlb(fixtureGlb(), scale)).toThrow(/scale/)
  })

  it('rejects corrupt chunks and oversized files before producing a model', () => {
    const bad = fixtureGlb()
    new DataView(bad.buffer).setUint32(bad.length - 12, 1024, true)
    expect(() => scaleGlb(bad, 0.3)).toThrow(/chunk/)
    expect(() => scaleGlb(new Uint8Array(MAX_AR_MODEL_BYTES + 1), 1)).toThrow(/large/)
  })
})
