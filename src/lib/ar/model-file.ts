/**
 * Augmented reality: checks on the 3D files a restaurant uploads for a dish.
 *
 * Guests only see a dish through the phone's own AR viewer (src/lib/ar/launch.ts):
 *   glb   glTF 2.0 binary. Required. Opened by Google Scene Viewer on Android,
 *         so it must avoid what Scene Viewer cannot read (Draco, meshopt,
 *         KTX2/WebP/AVIF textures) and stay under its 15 MB limit.
 *   usdz  Apple's zipped USD for AR Quick Look on iOS. The back office makes it
 *         from the GLB on upload (src/lib/ar/usdz-export.ts); a hand-made one
 *         can replace it.
 *
 * Checks are on the bytes, not the file name or the browser's MIME type
 * (phones often send .glb as application/octet-stream): a GLB starts with the
 * "glTF" magic, version 2 and its own total length; a USDZ is a zip archive.
 *
 * Pure: no I/O, unit-tested in tests/unit/ar/model-file.test.ts.
 */

export type ArModelFormat = 'glb' | 'usdz'

/** Hard ceiling per file: Scene Viewer refuses models above 15 MB. */
export const MAX_AR_MODEL_BYTES = 15 * 1024 * 1024

/** Above this the back office warns that the model is heavy for a phone. */
export const RECOMMENDED_AR_MODEL_BYTES = 5 * 1024 * 1024

export const AR_MODEL_CONTENT_TYPES: Record<ArModelFormat, string> = {
  glb: 'model/gltf-binary',
  usdz: 'model/vnd.usdz+zip',
}

export const AR_MODEL_EXTENSIONS: Record<ArModelFormat, string> = {
  glb: 'glb',
  usdz: 'usdz',
}

/** What the file input accepts (extensions plus the MIME types browsers report). */
export const AR_MODEL_ACCEPT: Record<ArModelFormat, string> = {
  glb: '.glb,model/gltf-binary',
  usdz: '.usdz,model/vnd.usdz+zip,model/vnd.pixar.usd',
}

const GLB_MAGIC = 0x46546c67 // "glTF", little-endian
const GLB_HEADER_BYTES = 12
const ZIP_LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04] // "PK\x03\x04"

export type ArModelCheck =
  | { ok: true; format: ArModelFormat; bytes: number; heavy: boolean }
  | { ok: false; error: string }

function readUint32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0
}

/** The format the bytes are in, or null when they are neither GLB nor zip. */
export function sniffArModelFormat(data: Uint8Array): ArModelFormat | null {
  if (data.length >= 4 && readUint32LE(data, 0) === GLB_MAGIC) return 'glb'
  if (data.length >= 4 && ZIP_LOCAL_FILE_HEADER.every((b, i) => data[i] === b)) return 'usdz'
  return null
}

/**
 * Checks an uploaded file against the format the slot expects.
 * `expected` is the slot (GLB or USDZ); a file of the other kind is refused
 * with a message that says which slot it belongs in.
 */
export function checkArModelFile(data: Uint8Array, expected: ArModelFormat): ArModelCheck {
  if (data.length === 0) return { ok: false, error: 'The file is empty.' }
  if (data.length > MAX_AR_MODEL_BYTES) {
    return { ok: false, error: `The 3D model is too large (max ${MAX_AR_MODEL_BYTES / 1024 / 1024} MB). Reduce its triangles and textures (e.g. gltf-transform simplify + resize) and try again.` }
  }

  const format = sniffArModelFormat(data)
  if (!format) {
    return {
      ok: false,
      error: expected === 'glb'
        ? 'This is not a GLB file. Export the model as glTF Binary (.glb).'
        : 'This is not a USDZ file. Export the model as .usdz.',
    }
  }
  if (format !== expected) {
    return {
      ok: false,
      error: format === 'glb'
        ? 'This is a GLB file. Upload it as the 3D model, not as the iOS file.'
        : 'This looks like a USDZ (zip) file. Upload it as the iOS file, not as the 3D model.',
    }
  }

  if (format === 'glb') {
    if (data.length < GLB_HEADER_BYTES) return { ok: false, error: 'The GLB file is truncated.' }
    const version = readUint32LE(data, 4)
    if (version !== 2) return { ok: false, error: `Unsupported glTF version ${version}. Export as glTF 2.0.` }
    const declaredLength = readUint32LE(data, 8)
    if (declaredLength !== data.length) {
      return { ok: false, error: 'The GLB file is incomplete or damaged (its size does not match its header). Export it again.' }
    }
    const blocked = arUnsupportedExtensions(data)
    if (blocked.length) {
      return { ok: false, error: `This model uses ${blocked.join(', ')}, which Android's AR viewer cannot open. Export it without mesh or texture compression (plain glTF 2.0 with JPEG/PNG textures) and try again.` }
    }
  }

  return { ok: true, format, bytes: data.length, heavy: data.length > RECOMMENDED_AR_MODEL_BYTES }
}

/**
 * glTF extensions Google Scene Viewer (Android AR) cannot read. Guests only
 * ever see a dish through AR, so a model that needs one of these never shows.
 */
export const AR_UNSUPPORTED_EXTENSIONS = [
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_meshopt_compression',
  'KHR_texture_basisu',
  'EXT_texture_webp',
  'EXT_texture_avif',
] as const

/** Extensions of the GLB's JSON chunk that Scene Viewer cannot read (none when there is no JSON chunk). */
export function arUnsupportedExtensions(data: Uint8Array): string[] {
  if (data.length < 20) return []
  const chunkLength = readUint32LE(data, 12)
  const chunkType = readUint32LE(data, 16)
  if (chunkType !== 0x4e4f534a || 20 + chunkLength > data.length) return [] // "JSON"
  let json: { extensionsUsed?: unknown; extensionsRequired?: unknown }
  try {
    json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + chunkLength)))
  } catch {
    return []
  }
  const used = new Set<string>()
  for (const list of [json.extensionsUsed, json.extensionsRequired]) {
    if (Array.isArray(list)) for (const name of list) if (typeof name === 'string') used.add(name)
  }
  return AR_UNSUPPORTED_EXTENSIONS.filter(name => used.has(name))
}

/** A dish model's size as modelled, in centimetres (glTF units are metres, Y up). */
export interface ModelFootprint {
  widthCm: number
  depthCm: number
  heightCm: number
  /** The larger of width and depth: what a guest would measure across the plate. */
  largestSideCm: number
}

type Mat4 = number[] // column-major, as glTF

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k]
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** A node's local matrix: `matrix`, or translation × rotation × scale. */
function nodeMatrix(node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Mat4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

/**
 * The model's size as modelled, from the POSITION bounds glTF requires on
 * each accessor, through the node transforms of the default scene. Null when
 * the GLB has no readable JSON or no meshes. Pure; used by the back office to
 * show "35 × 29 cm in the file" next to the real-size field.
 */
export function glbFootprint(data: Uint8Array): ModelFootprint | null {
  if (data.length < 20 || readUint32LE(data, 16) !== 0x4e4f534a) return null
  const chunkLength = readUint32LE(data, 12)
  if (20 + chunkLength > data.length) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any
  try {
    json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + chunkLength)))
  } catch {
    return null
  }
  const nodes: Array<{ children?: number[]; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }> = json.nodes ?? []
  const meshes: Array<{ primitives?: Array<{ attributes?: { POSITION?: number } }> }> = json.meshes ?? []
  const accessors: Array<{ min?: number[]; max?: number[] }> = json.accessors ?? []
  const scene = (json.scenes ?? [])[json.scene ?? 0]
  const roots: number[] = scene?.nodes ?? nodes.map((_, index) => index)
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]

  const visit = (index: number, parent: Mat4, depth: number) => {
    const node = nodes[index]
    if (!node || depth > 64) return
    const world = multiply(parent, nodeMatrix(node))
    for (const primitive of meshes[node.mesh ?? -1]?.primitives ?? []) {
      const accessor = accessors[primitive.attributes?.POSITION ?? -1]
      if (!accessor?.min || !accessor?.max) continue
      for (let corner = 0; corner < 8; corner++) {
        const p = [0, 1, 2].map(axis => (corner >> axis) & 1 ? accessor.max![axis] : accessor.min![axis])
        for (let axis = 0; axis < 3; axis++) {
          const value = world[axis] * p[0] + world[4 + axis] * p[1] + world[8 + axis] * p[2] + world[12 + axis]
          if (value < min[axis]) min[axis] = value
          if (value > max[axis]) max[axis] = value
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1)
  }
  const identity: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  for (const root of roots) visit(root, identity, 0)
  if (!Number.isFinite(min[0])) return null
  const cm = (axis: number) => Math.round((max[axis] - min[axis]) * 1000) / 10
  const widthCm = cm(0), heightCm = cm(1), depthCm = cm(2)
  return { widthCm, depthCm, heightCm, largestSideCm: Math.max(widthCm, depthCm) }
}

/** Storage key for a dish's model file in the product-images bucket. */
export function arModelStoragePath(tenantId: string, format: ArModelFormat, now = Date.now(), random = Math.random()): string {
  return `${tenantId}/ar/${now}-${random.toString(36).slice(2, 8)}.${AR_MODEL_EXTENSIONS[format]}`
}

/** "3.4 MB" / "820 KB", for the back office. */
export function formatModelSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
