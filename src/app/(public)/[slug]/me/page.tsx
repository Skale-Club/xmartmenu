export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sessionPhoneE164 } from '@/lib/phone'
import { log } from '@/lib/observability/log'
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

  // EX-07: orders belong to the verified account, never to a phone suffix.
  // First attach this restaurant's anonymous orders whose full typed number
  // (E.164) is exactly the phone this session just proved it owns; then list
  // the account's orders. Different numbers sharing their last digits no
  // longer see each other's history.
  const phoneE164 = sessionPhoneE164(user.phone)
  if (phoneE164) {
    const { error: linkError } = await service.rpc('link_orders_to_verified_phone', {
      p_tenant_id: tenant.id,
      p_user_id: user.id,
      p_phone_e164: phoneE164,
    })
    if (linkError) log.error('customer.link_orders_error', { err: linkError })
  }

  const { data: orders } = await service
    .from('orders')
    .select('*, order_items(*)')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(25)

  return (
    <PanelClient
      tenant={{
        name: tenant.name,
        slug: tenant.slug,
        settings: {
          primary_color: settings.primary_color ?? '#F52323',
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
