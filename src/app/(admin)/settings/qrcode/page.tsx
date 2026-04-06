export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import QRCodeClient from './QRCodeClient'

export default async function QRCodePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants(slug, name)')
    .eq('id', user!.id)
    .single()

  const { data: qrcodes } = await supabase
    .from('qr_codes')
    .select('*')
    .eq('tenant_id', profile!.tenant_id)
    .order('created_at', { ascending: false })

  const tenant = profile!.tenants as any
  const menuUrl = `${process.env.NEXT_PUBLIC_APP_URL}/${tenant?.slug}`

  return (
    <QRCodeClient
      qrcodes={qrcodes ?? []}
      tenantId={profile!.tenant_id}
      menuUrl={menuUrl}
      tenantName={tenant?.name ?? ''}
    />
  )
}
