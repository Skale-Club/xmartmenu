import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { rateLimit } from '@/lib/rate-limit'
import { parseTranslateRequest, pickTranslationModel, translateMenuTexts } from '@/lib/ai/translate-menu'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

/**
 * POST { from, to: string[], items: { key: text } } → { translations: { lang: { key: text } } }
 *
 * Suggests translations of menu texts for the owner to review in the admin;
 * it saves nothing.
 */
async function handlePOST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limit = await rateLimit('menu-translate', effective.tenantId, 60, '1 h')
  if (!limit.ok) return NextResponse.json({ error: 'Too many translation requests. Try again in a few minutes.' }, { status: 429 })

  const parsed = parseTranslateRequest(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const provider = pickTranslationModel()
  if (!provider) {
    return NextResponse.json({ error: 'AI translation is not configured on this server. You can still type the translations.' }, { status: 503 })
  }

  try {
    const translations = await translateMenuTexts(provider.model, parsed)
    return NextResponse.json({ translations })
  } catch (error) {
    log.error('POST /api/admin/translate', { err: error })
    return NextResponse.json({ error: 'The translation service did not answer. Try again.' }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withApi('POST /api/admin/translate', handlePOST)
