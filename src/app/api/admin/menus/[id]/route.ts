import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'

interface Props { params: Promise<{ id: string }> }
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

async function assertOwnership(menuId: string) {
  const effective = await getEffectiveTenant()
  if (!effective) return null
  const supabase = await createClient()
  const { data } = await supabase.from('menus').select('id, is_default, tenant_id').eq('id', menuId).single()
  if (!data || data.tenant_id !== effective.tenantId) return null
  return { supabase, menu: data }
}

export async function PATCH(request: Request, { params }: Props) {
  const { id } = await params
  const ctx = await assertOwnership(id)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json()
  const allowed = ['name', 'language', 'supported_languages', 'translations', 'purpose', 'description', 'is_active', 'is_default', 'position']
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]

  if ('language' in update || 'supported_languages' in update) {
    const normalized = sanitizeLanguages(update.language, update.supported_languages)
    update.language = normalized.language
    update.supported_languages = normalized.supported_languages
    if ('translations' in update) {
      update.translations = sanitizeTranslations(update.translations, normalized.supported_languages)
    }
  } else if ('translations' in update) {
    const { data: current } = await ctx.supabase.from('menus').select('supported_languages').eq('id', id).single()
    const supported = Array.isArray(current?.supported_languages) ? current.supported_languages : ['en']
    update.translations = sanitizeTranslations(update.translations, supported)
  }

  // If setting as default, unset others
  if (update.is_default === true) {
    await ctx.supabase.from('menus').update({ is_default: false }).eq('tenant_id', ctx.menu.tenant_id)
  }

  const { data, error } = await ctx.supabase.from('menus').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: Props) {
  const { id } = await params
  const ctx = await assertOwnership(id)
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ctx.menu.is_default) return NextResponse.json({ error: 'Cannot delete the default menu' }, { status: 400 })

  await ctx.supabase.from('menus').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
