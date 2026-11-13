import { describe, expect, it, vi } from 'vitest'
import { scaledModelResponse, trustedArModelUrl } from '@/lib/ar/scaled-model-response'
import { glbFootprint, MAX_AR_MODEL_BYTES } from '@/lib/ar/model-file'

const base = 'https://images.example/'
const source = `${base}12345678-1234-1234-1234-123456789abc/ar/123-abc.glb`
const request = (src = source, scale = '0.3') => new Request(`https://menu.example/api/ar/scaled-model?${new URLSearchParams({ src, scale })}`)
function glb() {
  const json = JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ min: [0, 0, 0], max: [1, 0.2, 0.5] }] })
  const data = new Uint8Array(20 + Math.ceil(json.length / 4) * 4)
  const view = new DataView(data.buffer)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, data.length, true)
  view.setUint32(12, data.length - 20, true); view.setUint32(16, 0x4e4f534a, true)
  data.fill(0x20, 20); data.set(new TextEncoder().encode(json), 20)
  return data
}

describe('bounded public scaled-model response', () => {
  it('serves a corrected, cacheable model with cross-origin access', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(glb()))
    const result = await scaledModelResponse(request(), base, fetcher)
    expect(result.status).toBe(200)
    expect(glbFootprint(new Uint8Array(await result.arrayBuffer()))?.largestSideCm).toBe(30)
    expect(result.headers.get('content-type')).toBe('model/gltf-binary')
    expect(result.headers.get('access-control-allow-origin')).toBe('*')
    expect(result.headers.get('cache-control')).toContain('s-maxage=86400')
    expect(fetcher).toHaveBeenCalledWith(source, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
  })

  it.each(['https://evil.example/a.glb', 'http://images.example/a.glb', `${source}?token=secret`,
    `${source}#fragment`, 'https://images.example/other/file.glb', 'https://images.example@evil.example/a.glb',
    'https://images.example/%2e%2e/private.glb'])('refuses untrusted sources: %s', async src => {
    const fetcher = vi.fn()
    expect(trustedArModelUrl(src, base)).toBeNull()
    expect((await scaledModelResponse(request(src), base, fetcher)).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['0', '21', 'NaN', 'Infinity', '-1', '0.12345'])('rejects scale %s without fetching', async scale => {
    const fetcher = vi.fn()
    expect((await scaledModelResponse(request(source, scale), base, fetcher)).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('cancels an oversized response declared by its headers', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    const fetcher = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-length': String(MAX_AR_MODEL_BYTES + 1) } }))
    const result = await scaledModelResponse(request(), base, fetcher)
    expect(result.status).toBe(502)
    expect(cancel).toHaveBeenCalled()
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it('bounds streaming bytes even when no length is declared', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_AR_MODEL_BYTES + 1)) }, cancel })
    expect((await scaledModelResponse(request(), base, vi.fn().mockResolvedValue(new Response(body)))).status).toBe(502)
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects overload without queueing, then releases the slot after a failure', async () => {
    let fail!: (error: Error) => void
    const fetcher = vi.fn().mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    const pending = scaledModelResponse(request(), base, fetcher)
    expect((await scaledModelResponse(request(), base, vi.fn())).status).toBe(503)
    fail(new Error('network failed'))
    expect((await pending).status).toBe(502)
    expect((await scaledModelResponse(request(), base, vi.fn().mockResolvedValue(new Response(glb())))).status).toBe(200)
  })

  it('rejects redirect errors and corrupt data without caching a partial response', async () => {
    expect((await scaledModelResponse(request(), base, vi.fn().mockRejectedValue(new Error('redirect')))).status).toBe(502)
    expect((await scaledModelResponse(request(), base, vi.fn().mockResolvedValue(new Response('invalid')))).status).toBe(502)
  })

  it('cancels an upstream error body instead of leaving its connection open', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    const result = await scaledModelResponse(request(), base, vi.fn().mockResolvedValue(new Response(body, { status: 500 })))
    expect(result.status).toBe(502)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('propagates request cancellation and releases its active slot', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))
    const req = new Request(request(), { signal: controller.signal })
    const pending = scaledModelResponse(req, base, fetcher)
    controller.abort()
    expect((await pending).status).toBe(502)
    expect((await scaledModelResponse(request(), base, vi.fn().mockResolvedValue(new Response(glb())))).status).toBe(200)
  })
})
