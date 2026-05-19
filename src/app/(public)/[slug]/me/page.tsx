export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import PanelClient from './PanelClient'
import type { Order, OrderItem } from '@/types/database'

type OrderWithItems = Order & { order_items: OrderItem[] }

interface Props {
  params: Promise<{ slug: string }>
}

export default async function CustomerPanelPage({ params }: Props) {
  const { slug } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Must be logged in via phone OTP
  if (!user?.phone) {
    redirect(`/${slug}/me/login`)
  }

  const service = createServiceClient()

  const { data: tenant } = await service
    .from('tenants')
    .select('id, name, slug, tenant_settings(primary_color, accent_color, address, phone, currency, logo_url)')
    .eq('slug', slug)
    .eq('is_active', true)
    .single()

  if (!tenant) notFound()

  const settings = (tenant.tenant_settings as any) ?? {}

  const { data: orders } = await service
    .from('orders')
    .select('*, order_items(*)')
    .eq('tenant_id', tenant.id)
    .eq('customer_phone', user.phone)
    .order('created_at', { ascending: false })
    .limit(25)

  return (
    <PanelClient
      tenant={{
        name: tenant.name,
        slug: tenant.slug,
        settings: {
          primary_color: settings.primary_color ?? '#EEFF00',
          accent_color: settings.accent_color ?? '#09090b',
          address: settings.address ?? null,
          phone: settings.phone ?? null,
          currency: settings.currency ?? 'USD',
          logo_url: settings.logo_url ?? null,
        },
      }}
      orders={(orders ?? []) as OrderWithItems[]}
      customerPhone={user.phone}
    />
  )
}
