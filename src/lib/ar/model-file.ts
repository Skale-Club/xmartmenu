/**
 * Augmented reality: checks on the 3D files a restaurant uploads for a dish.
 *
 * Two formats:
 *   glb   glTF 2.0 binary. Required. Drives the in-page 3D viewer, Android
 *         Scene Viewer and WebXR, and is converted to USDZ on iOS on the fly.
 *   usdz  Apple's zipped USD. Optional, for a hand-tuned iOS Quick Look file.
 *
 * Checks are on the bytes, not the file name or the browser's MIME type
 * (phones often send .glb as application/octet-stream): a GLB starts with the
 * "glTF" magic, version 2 and its own total length; a USDZ is a zip archive.
 *
 * Pure: no I/O, unit-tested in tests/unit/ar/model-file.test.ts.
 */

export type ArModelFormat = 'glb' | 'usdz'

/** Hard ceiling per file. Above this a phone on mobile data waits too long. */
export const MAX_AR_MODEL_BYTES = 25 * 1024 * 1024

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
    return { ok: false, error: `The 3D model is too large (max ${MAX_AR_MODEL_BYTES / 1024 / 1024} MB). Compress it (e.g. with Draco or gltf-transform) and try again.` }
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
  }

  return { ok: true, format, bytes: data.length, heavy: data.length > RECOMMENDED_AR_MODEL_BYTES }
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
