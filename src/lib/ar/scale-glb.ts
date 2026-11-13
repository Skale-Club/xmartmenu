import { checkArModelFile, MAX_AR_MODEL_BYTES } from './model-file'

/** Rewrite only scene roots; geometry and textures stay byte-for-byte intact. */
export function scaleGlb(data: Uint8Array, scale: number): Uint8Array {
  if (!Number.isFinite(scale) || scale < 0.05 || scale > 20) throw new Error('Invalid model scale')
  const check = checkArModelFile(data, 'glb')
  if (!check.ok) throw new Error(check.error)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length < 20 || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Missing model scene')
  const length = view.getUint32(12, true)
  if (length > 1024 * 1024 || length % 4 || 20 + length > data.length) throw new Error('Invalid model scene')
  const scene = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + length)))
  if (!scene || !Array.isArray(scene.nodes) || !Array.isArray(scene.scenes)
    || !scene.scenes.length || scene.nodes.length > 10_000 || scene.scenes.length > 100) throw new Error('Invalid model scene')
  const originalNodeCount = scene.nodes.length
  for (const entry of scene.scenes) {
    if (!entry || !Array.isArray(entry.nodes) || entry.nodes.length > originalNodeCount
      || entry.nodes.some((id: unknown) => !Number.isInteger(id) || (id as number) < 0 || (id as number) >= originalNodeCount)) {
      throw new Error('Invalid model roots')
    }
    const root = scene.nodes.length
    scene.nodes.push({ name: 'real_size', scale: [scale, scale, scale], children: entry.nodes })
    entry.nodes = [root]
  }
  // Validate the remaining chunk boundaries before copying opaque binary data.
  for (let offset = 20 + length; offset < data.length;) {
    if (offset + 8 > data.length) throw new Error('Invalid model chunk')
    const bytes = view.getUint32(offset, true)
    if (bytes % 4 || offset + 8 + bytes > data.length) throw new Error('Invalid model chunk')
    offset += 8 + bytes
  }
  const json = new TextEncoder().encode(JSON.stringify(scene))
  const padded = Math.ceil(json.length / 4) * 4
  const size = data.length - length + padded
  if (padded > 1024 * 1024 || size > MAX_AR_MODEL_BYTES) throw new Error('Scaled model is too large')
  const output = new Uint8Array(size)
  output.set(data.subarray(0, 20))
  new DataView(output.buffer).setUint32(8, size, true)
  new DataView(output.buffer).setUint32(12, padded, true)
  output.fill(0x20, 20, 20 + padded)
  output.set(json, 20)
  output.set(data.subarray(20 + length), 20 + padded)
  return output
}
