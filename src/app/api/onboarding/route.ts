import { BRAND_PRIMARY } from '@/lib/brand'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { slugify } from '@/lib/utils'
import { z } from 'zod'
import { RESERVED_PATHS } from '@/lib/marketing/reserved-paths'
import { enqueueXphereSync } from '@/lib/xphere/queue'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { publishPendingNativeTenantEffects } from '@/lib/tenant-effects/publish-pending'
import { ownedAdminTransaction } from '@/lib/data/admin-menus-runtime'
import { nativeOnboarding, NativeOnboardingDenied } from '@/lib/auth/native-onboarding'
import { ownedApplicantContext } from '@/lib/access-requests/applicant-context'
import { selfServiceOnboardingEnabled } from '@/lib/access-requests/switch'

const CUISINE_PALETTES: Record<string, { primary: string; accent: string }> = {
  pizza:        { primary: '#E74C3C', accent: '#FFFFFF' },
  japanese:     { primary: '#C0392B', accent: '#1A1A1A' },
  burger:       { primary: '#F39C12', accent: '#2C3E50' },
  cafe:         { primary: '#6F4E37', accent: '#FDF5E6' },
  churrascaria: { primary: '#27AE60', accent: '#F39C12' },
}

const ALLOWED_MENU_PURPOSES = new Set(['restaurant', 'bar', 'cafe', 'hotel', 'salon', 'retail', 'other'])
const MENU_PURPOSE_ALIASES: Record<string, string> = {
  pizzaria: 'restaurant',
  pizzeria: 'restaurant',
  lanchonete: 'restaurant',
  padaria: 'cafe',
  sorveteria: 'cafe',
}

function sanitizeMenuPurpose(raw: unknown) {
  if (typeof raw !== 'string') return 'restaurant'
  const normalized = raw.trim().toLowerCase()
  const mapped = MENU_PURPOSE_ALIASES[normalized] ?? normalized
  return ALLOWED_MENU_PURPOSES.has(mapped) ? mapped : 'restaurant'
}

const text = (max: number) => z.string().max(max)
const onboardingSchema = z.object({
  company_name: text(120).refine((v) => v.trim().length > 0, 'Company name is required'),
  business_type: text(40).optional(),
  responsible_name: text(120).nullish(),
  phone: text(40).nullish(),
  address: text(300).nullish(),
  menu_name: text(120).refine((v) => v.trim().length > 0, 'Menu name is required'),
  category_name: text(120).refine((v) => v.trim().length > 0, 'Category name is required'),
  product_name: text(200).refine((v) => v.trim().length > 0, 'Product name is required'),
  product_price: z.coerce.number().min(0).max(1_000_000).optional(),
})

export async function GET(request: Request) {
  if (!ownedAuthSelected()) return NextResponse.json({ error: 'Not found' },{ status: 404 })
  try {
    const principal = await ownedApplicantContext(request)
    const state = await ownedAdminTransaction(true,query => nativeOnboarding(query,principal.userId,principal.sessionHash))
    return NextResponse.json(state,{ headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: 'Onboarding is unavailable.' },{ status: error instanceof NativeOnboardingDenied ? 403 : 503 }) }
}

async function ownedPost(request: Request) {
  try {
    const principal = await ownedApplicantContext(request)
    const body = await request.text()
    if (body.length > 12000) return NextResponse.json({ error: 'Invalid onboarding data' },{ status: 400 })
    const parsed = onboardingSchema.strict().safeParse(JSON.parse(body))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid onboarding data' },{ status: 400 })
    const data = parsed.data, tenantSlug = slugify(data.company_name)
    if (!tenantSlug || RESERVED_PATHS.has(tenantSlug)) return NextResponse.json({ error: 'This name is reserved. Please choose a different restaurant name.' },{ status: 400 })
    const palette = CUISINE_PALETTES[data.business_type?.trim().toLowerCase() ?? ''] ?? { primary: BRAND_PRIMARY,accent: '#09090b' }
    const input = { company_name: data.company_name.trim(),tenant_slug: tenantSlug,
      full_name: data.responsible_name?.trim() || principal.fullName,phone: data.phone?.trim() || null,address: data.address?.trim() || null,
      primary_color: palette.primary,accent_color: palette.accent,menu_name: data.menu_name.trim(),menu_slug: slugify(data.menu_name) || 'menu',
      menu_purpose: sanitizeMenuPurpose(data.business_type),category_name: data.category_name.trim(),product_name: data.product_name.trim(),product_price: data.product_price ?? 0 }
    const current=await ownedApplicantContext(request)
    if(current.userId!==principal.userId||current.sessionHash!==principal.sessionHash)throw new NativeOnboardingDenied('Onboarding actor changed')
    const done = await ownedAdminTransaction(true,query => nativeOnboarding(query,current.userId,current.sessionHash,input))
    if (!('tenant_id' in done)) throw new Error('Onboarding failed')
    await publishPendingNativeTenantEffects(done.tenant_id).catch(()=>{})
    return NextResponse.json({ tenant_slug: done.tenant_slug,menu_slug: done.menu_slug,
      ...(done.already_configured ? { already_configured: true } : {}) },{ headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: 'Onboarding is unavailable. Please try again.' },{ status: error instanceof NativeOnboardingDenied ? 403 : error instanceof SyntaxError ? 400 : 503 })
  }
}

export async function POST(request: Request) {
  // Server-side lock: restaurants are created only by approving an access request.
  if (!selfServiceOnboardingEnabled()) return NextResponse.json({ error: 'Self-service onboarding is disabled.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  if (ownedAuthSelected()) return ownedPost(request)
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = onboardingSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? ''
      return NextResponse.json({ error: message.endsWith('is required') ? message : 'Invalid onboarding data' }, { status: 400 })
    }
    const {
      company_name,
      business_type = 'restaurant',
      responsible_name,
      phone,
      address,
      menu_name,
      category_name,
      product_name,
      product_price,
    } = parsed.data
    const defaultPalette = CUISINE_PALETTES[business_type?.trim().toLowerCase() ?? ''] ?? { primary: BRAND_PRIMARY, accent: '#09090b' }

    // Reject slugs that collide with reserved marketing paths | dual enforcement
    // (middleware blocks access; API blocks creation). D-07 from CONTEXT.md.
    const tenantSlug = slugify(company_name)
    if (!tenantSlug || RESERVED_PATHS.has(tenantSlug)) {
      return NextResponse.json(
        { error: 'This name is reserved. Please choose a different restaurant name.' },
        { status: 400 }
      )
    }

    const service = createServiceClient()
    const { data: currentProfile } = await service
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle()
    const hadTenant = Boolean(currentProfile?.tenant_id)

    // EX-08: tenant, settings, profile link, subscription and first catalog in
    // one transaction (migration 20261027096000). Repeating the request — a
    // retry, a double submit, a resume after a failure — converges to the same
    // restaurant and repairs whatever is missing; nothing is left orphaned.
    const { data: result, error: onboardingError } = await service.rpc('complete_onboarding', {
      p_user_id: user.id,
      p_input: {
        company_name: company_name.trim(),
        tenant_slug: tenantSlug,
        full_name: responsible_name?.trim() || user.user_metadata?.full_name || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        primary_color: defaultPalette.primary,
        accent_color: defaultPalette.accent,
        menu_name: menu_name.trim(),
        menu_slug: slugify(menu_name) || 'menu',
        menu_purpose: sanitizeMenuPurpose(business_type),
        category_name: category_name.trim(),
        product_name: product_name.trim(),
        product_price: product_price ?? 0,
      },
    })

    if (onboardingError || !result) {
      if (onboardingError?.code === 'P0403') {
        return NextResponse.json({ error: 'Superadmin accounts do not require onboarding.' }, { status: 403 })
      }
      console.error('onboarding.complete_error', onboardingError)
      return NextResponse.json({ error: 'Failed to set up your restaurant, please try again' }, { status: 500 })
    }
    const done = result as { tenant_id: string; tenant_slug: string; menu_slug: string; created_tenant: boolean }

    // CRM after commit, enqueue-only and fail-open: a QStash/Xphere outage never
    // undoes or blocks a valid onboarding. A new restaurant gets the
    // 'onboarded' event (LIF-01); a resume re-asserts state with a no-note full
    // sync ('manual'), so the onboarded note is never posted twice.
    await enqueueXphereSync(done.tenant_id, done.created_tenant ? 'onboarded' : 'manual')

    return NextResponse.json({
      ...(hadTenant ? { already_configured: true } : {}),
      tenant_slug: done.tenant_slug,
      menu_slug: done.menu_slug,
    })
  } catch (error) {
    console.error('onboarding.unhandled_error', error)
    return NextResponse.json({ error: 'Unexpected server error during onboarding' }, { status: 500 })
  }
}
