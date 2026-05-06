export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { notFound } from 'next/navigation'
import type { ProductOptionGroup, ProductOption } from '@/types/database'
import ProductDetailClient from './ProductDetailClient'

export interface GroupWithOptions extends ProductOptionGroup {
  options: ProductOption[]
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  if (!effective) notFound()

  const tenantId = effective.tenantId
  const canManage = effective.role !== 'store-staff'

  const [{ data: product }, { data: groups }, { data: settings }] = await Promise.all([
    supabase
      .from('products')
      .select('*, category:categories(id, name)')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('product_option_groups')
      .select('*, options:product_options(*)')
      .eq('product_id', id)
      .order('position')
      .order('position', { referencedTable: 'product_options' }),
    supabase
      .from('tenant_settings')
      .select('custom_tags, currency')
      .eq('tenant_id', tenantId)
      .single(),
  ])

  if (!product) notFound()

  return (
    <ProductDetailClient
      product={product}
      initialGroups={(groups ?? []) as GroupWithOptions[]}
      tenantId={tenantId}
      currency={settings?.currency ?? 'BRL'}
      canManage={canManage}
    />
  )
}
