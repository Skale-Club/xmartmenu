import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { slugify } from '@/lib/utils'
import { normalizeRole } from '@/lib/auth/role-utils'

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

function isMissingI18nColumnError(message: string) {
  const msg = message.toLowerCase()
  return msg.includes('supported_languages') || msg.includes('translations')
}

function isMissingColumnError(message: string) {
  const msg = message.toLowerCase()
  return msg.includes('column') && msg.includes('does not exist')
}

function isSchemaCacheColumnError(message: string) {
  const msg = message.toLowerCase()
  return msg.includes('schema cache') && msg.includes('column')
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
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
    } = body
    const safeMenuPurpose = sanitizeMenuPurpose(business_type)

    if (!company_name?.trim()) return NextResponse.json({ error: 'Company name is required' }, { status: 400 })
    if (!menu_name?.trim()) return NextResponse.json({ error: 'Menu name is required' }, { status: 400 })
    if (!category_name?.trim()) return NextResponse.json({ error: 'Category name is required' }, { status: 400 })
    if (!product_name?.trim()) return NextResponse.json({ error: 'Product name is required' }, { status: 400 })
    const service = createServiceClient()
    const { data: currentProfile, error: profileError } = await service
      .from('profiles')
      .select('role, tenant_id, tenants(slug)')
      .eq('id', user.id)
      .single()

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('onboarding.profile_lookup_error', profileError)
      return NextResponse.json({ error: 'Failed to validate user profile' }, { status: 500 })
    }

    if (normalizeRole(currentProfile?.role) === 'superadmin') {
      return NextResponse.json({
        error: 'Superadmin accounts do not require onboarding.',
      }, { status: 403 })
    }

    let tenant: { id: string; slug: string }

    if (currentProfile?.tenant_id) {
      const { data: existingMenu } = await service
        .from('menus')
        .select('slug')
        .eq('tenant_id', currentProfile.tenant_id)
        .order('position')
        .limit(1)
        .maybeSingle()

      if (existingMenu) {
        return NextResponse.json({
          already_configured: true,
          tenant_slug: (currentProfile.tenants as any)?.slug ?? null,
          menu_slug: existingMenu.slug,
        })
      }

      // Tenant exists but no menu — previous attempt failed mid-way. Resume from menu creation.
      tenant = {
        id: currentProfile.tenant_id,
        slug: (currentProfile.tenants as any)?.slug ?? '',
      }
    } else {
      // 1. Create tenant
      let slug = slugify(company_name)
      const { data: existingTenant } = await service.from('tenants').select('id').eq('slug', slug).single()
      if (existingTenant) slug = `${slug}-${Date.now().toString(36)}`

      const { data: newTenant, error: tenantError } = await service
        .from('tenants')
        .insert({ name: company_name.trim(), slug, plan: 'free' })
        .select()
        .single()

      if (tenantError || !newTenant) {
        console.error('onboarding.create_tenant_error', tenantError)
        return NextResponse.json({ error: 'Failed to create store' }, { status: 500 })
      }

      tenant = newTenant

      // 2. Create tenant settings with contact info
      const { error: tenantSettingsError } = await service.from('tenant_settings').insert({
        tenant_id: tenant.id,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
      })
      if (tenantSettingsError) {
        console.error('onboarding.create_tenant_settings_error', tenantSettingsError)
        return NextResponse.json({ error: 'Failed to save store settings' }, { status: 500 })
      }

      // 3. Update user profile
      const { error: profileUpsertError } = await service.from('profiles').upsert({
        id: user.id,
        tenant_id: tenant.id,
        role: 'store-admin',
        full_name: responsible_name?.trim() || user.user_metadata?.full_name || null,
        phone: phone?.trim() || null,
      })
      if (profileUpsertError) {
        console.error('onboarding.update_profile_error', profileUpsertError)
        return NextResponse.json({ error: 'Failed to update user profile' }, { status: 500 })
      }
    }

    // 4. Create default menu
    let menuSlug = slugify(menu_name)
    const { data: existingMenu } = await service
      .from('menus').select('id').eq('tenant_id', tenant.id).eq('slug', menuSlug).single()
    if (existingMenu) menuSlug = `${menuSlug}-${Date.now().toString(36)}`

    const menuBasePayload = {
      tenant_id: tenant.id,
      name: menu_name.trim(),
      slug: menuSlug,
    }
    const menuPayloadCandidates: Array<Record<string, unknown>> = [
      {
        ...menuBasePayload,
        language: 'en',
        supported_languages: ['en'],
        purpose: safeMenuPurpose,
        is_active: true,
        is_default: true,
      },
      {
        ...menuBasePayload,
        language: 'en',
        purpose: safeMenuPurpose,
        is_active: true,
        is_default: true,
      },
      {
        ...menuBasePayload,
        language: 'en',
        is_active: true,
        is_default: true,
      },
      {
        ...menuBasePayload,
        language: 'en',
        is_active: true,
      },
      {
        ...menuBasePayload,
      },
    ]

    let menu: { id: string; slug: string } | null = null
    let menuError: { message?: string; code?: string } | null = null
    for (const candidate of menuPayloadCandidates) {
      const result = await service.from('menus').insert(candidate).select('id, slug').single()
      if (!result.error && result.data) {
        menu = result.data
        menuError = null
        break
      }

      menuError = result.error
      const message = result.error?.message ?? ''
      if (!message) break

      const shouldTryNext =
        isMissingI18nColumnError(message) ||
        isMissingColumnError(message) ||
        isSchemaCacheColumnError(message)

      if (!shouldTryNext) break
    }

    if (menuError || !menu) {
      console.error('onboarding.create_menu_error', menuError)
      return NextResponse.json({
        error: 'Failed to create menu',
        ...(process.env.NODE_ENV !== 'production'
          ? { details: menuError?.message ?? null, code: menuError?.code ?? null }
          : {}),
      }, { status: 500 })
    }

    // 5. Create first category
    const { data: category, error: categoryError } = await service
      .from('categories')
      .insert({
        tenant_id: tenant.id,
        menu_id: menu.id,
        name: category_name.trim(),
        position: 0,
        is_active: true,
      })
      .select()
      .single()

    if (categoryError || !category) {
      console.error('onboarding.create_category_error', categoryError)
      return NextResponse.json({ error: 'Failed to create category' }, { status: 500 })
    }

    // 6. Create first product
    const { error: productError } = await service.from('products').insert({
      tenant_id: tenant.id,
      menu_id: menu.id,
      category_id: category.id,
      name: product_name.trim(),
      price: parseFloat(product_price) || 0,
      is_available: true,
      is_featured: false,
      position: 0,
    })
    if (productError) {
      console.error('onboarding.create_product_error', productError)
      return NextResponse.json({ error: 'Failed to create first product' }, { status: 500 })
    }

    return NextResponse.json({ tenant_slug: tenant.slug, menu_slug: menu.slug })
  } catch (error) {
    console.error('onboarding.unhandled_error', error)
    return NextResponse.json({ error: 'Unexpected server error during onboarding' }, { status: 500 })
  }
}
