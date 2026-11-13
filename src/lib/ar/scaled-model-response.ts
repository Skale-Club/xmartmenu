import { MAX_AR_MODEL_BYTES } from './model-file'
import { scaleGlb } from './scale-glb'

const MAX_CONCURRENT = 1
let active = 0

/** Only versioned AR objects on our configured public storage may be read. */
export function trustedArModelUrl(source: string, storageBase: string): string | null {
  try {
    const base = new URL(storageBase)
    const url = new URL(source)
    if (base.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password
      || url.search || url.hash || !url.pathname.startsWith(base.pathname)) return null
    const key = url.pathname.slice(base.pathname.length)
    if (!/^[0-9a-f-]{36}\/ar\/[a-zA-Z0-9_-]+\.glb$/.test(key)) return null
    return url.href
  } catch { return null }
}

async function boundedModel(response: Response): Promise<Uint8Array> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('Model unavailable')
  }
  if (!response.body) throw new Error('Model unavailable')
  const length = Number(response.headers.get('content-length'))
  if (length > MAX_AR_MODEL_BYTES) {
    await response.body.cancel()
    throw new Error('Model is too large')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_AR_MODEL_BYTES) throw new Error('Model is too large')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
  return data
}

/** Bounded container rewrite, with no mesh/texture decoding or re-encoding. */
export async function scaledModelResponse(request: Request, storageBase: string,
  fetchModel: typeof fetch = fetch): Promise<Response> {
  const params = new URL(request.url).searchParams
  const source = trustedArModelUrl(params.get('src') ?? '', storageBase)
  const value = params.get('scale') ?? ''
  const scale = Number(value)
  const error = (status: number, message: string) => Response.json({ error: message }, {
    status, headers: { 'Cache-Control': 'no-store' },
  })
  if (!source || !/^(?:\d{1,2})(?:\.\d{1,4})?$/.test(value) || scale < 0.05 || scale > 20) {
    return error(400, 'Invalid model request')
  }
  if (active >= MAX_CONCURRENT) return error(503, 'Model service is busy; try again')
  active++
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
    const response = await fetchModel(source, { redirect: 'error', signal, cache: 'no-store' })
    const data = await boundedModel(response)
    const output = scaleGlb(data, scale)
    return new Response(output.slice().buffer, { headers: {
      'Content-Type': 'model/gltf-binary',
      'Content-Length': String(output.byteLength),
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch { return error(502, 'Could not prepare the model at its real size') }
  finally { active-- }
}
