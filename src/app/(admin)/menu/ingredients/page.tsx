export const dynamic = 'force-dynamic'

import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { ownedCatalogEnabled } from '@/lib/data/admin-ingredients'
import { readOwnedIngredientsPage } from '@/lib/data/admin-ingredients-runtime'
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import IngredientsClient from './IngredientsClient'

export default async function IngredientsPage() {
  const effective = await getEffectiveTenant()
  if (!effective) notFound()

  const tenantId = effective.tenantId
  const canManage = effective.role !== 'store-staff'

  if (ownedCatalogEnabled()) {
    const { ingredients, settings } = await readOwnedIngredientsPage({ tenantId, role: effective.role })
    if (!settings.ingredient_customization_enabled) redirect('/dashboard')

    return (
      <IngredientsClient
        ingredients={ingredients}
        tenantId={tenantId}
        currency={settings.currency ?? 'USD'}
        canManage={canManage}
        ownedSource
      />
    )
  }

  const supabase = await createClient()

  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('ingredient_customization_enabled, currency')
    .eq('tenant_id', tenantId)
    .single()

  if (!settings?.ingredient_customization_enabled) redirect('/dashboard')

  const { data: ingredients } = await supabase
    .from('ingredients')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('position')

  return (
    <IngredientsClient
      ingredients={ingredients ?? []}
      tenantId={tenantId}
      currency={settings?.currency ?? 'USD'}
      canManage={canManage}
      ownedSource={false}
    />
  )
}
