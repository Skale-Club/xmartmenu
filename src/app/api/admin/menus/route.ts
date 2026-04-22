import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { slugify } from '@/lib/utils'

const ALLOWED_LANGUAGE_CODES = ['en', 'pt', 'es', 'fr', 'de', 'it']

function sanitizeLanguages(language: unknown, supported: unknown): { language: string; supported_languages: string[] } {
  const base = typeof language === 'string' && ALLOWED_LANGUAGE_CODES.includes(language) ? language : 'en'
  const raw = Array.isArray(supported) ? supported : [base]
  const deduped = Array.from(new Set(raw.filter((x): x is string => typeof x === 'string' && ALLOWED_LANGUAGE_CODES.includes(x))))
  const normalized = deduped.length > 0 ? deduped : [base]
  if (!normalized.includes(base)) normalized.unshift(base)
  return { language: base, supported_languages: normalized }
}

function sanitizeTranslations(translations: unknown, supportedLanguages: string[]) {
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) return {}
  const out: Record<string, { name?: string; description?: string }> = {}

  for (const lang of supportedLanguages) {
    const value = (translations as Record<string, unknown>)[lang]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const valueMap = value as Record<string, unknown>
    const rawName = valueMap.name
    const rawDescription = valueMap.description
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    const description = typeof rawDescription === 'string' ? rawDescription.trim() : ''
    if (name || description) out[lang] = { ...(name ? { name } : {}), ...(description ? { description } : {}) }
  }

  return out
}

async function getTenantId() {
  const effective = await getEffectiveTenant()
  return effective?.tenantId ?? null
}

export async function GET() {
  const tenantId = await getTenantId()
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createClient()
  const { data } = await supabase
    .from('menus')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('position')

  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const tenantId = await getTenantId()
  if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, language = 'en', supported_languages, translations, purpose = 'restaurant', description } = body
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const i18n = sanitizeLanguages(language, supported_languages)
  const safeTranslations = sanitizeTranslations(translations, i18n.supported_languages)

  const slug = slugify(name)
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('menus').select('id').eq('tenant_id', tenantId).eq('slug', slug).single()

  const finalSlug = existing ? `${slug}-${Date.now().toString(36)}` : slug

  const { data, error } = await supabase
    .from('menus')
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      slug: finalSlug,
      language: i18n.language,
      supported_languages: i18n.supported_languages,
      translations: safeTranslations,
      purpose,
      description: description ?? null,
    })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
