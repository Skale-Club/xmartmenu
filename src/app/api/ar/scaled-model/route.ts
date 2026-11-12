import { getStorageClient } from '@/lib/storage'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { scaledModelResponse } from '@/lib/ar/scaled-model-response'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const client = await rateLimit('ar-scaled-model', getClientIp(request), 30, '1 m')
  const shared = client.ok && await rateLimit('ar-scaled-model-global', 'all', 60, '1 m')
  if (!client.ok || !shared || !shared.ok) return Response.json({ error: 'Too many model requests' }, {
    status: 429, headers: { 'Cache-Control': 'no-store' },
  })
  // A dummy key obtains the provider's public bucket prefix without a network call.
  try {
    const base = getStorageClient().getPublicUrl('product-images', '')
    return scaledModelResponse(request, base.endsWith('/') ? base : `${base}/`)
  } catch {
    return Response.json({ error: 'Model storage is unavailable' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    })
  }
}
