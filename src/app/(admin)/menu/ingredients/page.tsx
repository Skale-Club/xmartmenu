export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { notFound, redirect } from 'next/navigation'
import IngredientsClient from './IngredientsClient'

export default async function IngredientsPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  if (!effective) notFound()

  const tenantId = effective.tenantId
  const canManage = effective.role !== 'store-staff'

  const { data: settings } = await supabase
    .from('tenant_settings')
    .select('ingredient_customization_enabled, currency')
    .eq('tenant_id', tenantId)
    .single()

  if (!settings?.ingredient_customization_enabled) redirect('/admin/dashboard')

  const { data: ingredients } = await supabase
    .from('ingredients')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('position')

  return (
    <IngredientsClient
      ingredients={ingredients ?? []}
      tenantId={tenantId}
      currency={settings?.currency ?? 'BRL'}
      canManage={canManage}
    />
  )
}
