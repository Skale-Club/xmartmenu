import { ownedAuthSelected } from '@/lib/auth/owned-principal'

export const dynamic = 'force-dynamic'
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' }
  try {
    const authority = ownedAuthSelected() ? 'owned' : 'legacy'
    if (authority === 'owned' && process.env.GOOGLE_AUTH_ENABLED !== 'true') return Response.json({ authority: 'unavailable' },{ status: 503,headers })
    return Response.json({ authority },{ headers })
  } catch { return Response.json({ authority: 'unavailable' },{ status: 503,headers }) }
}
