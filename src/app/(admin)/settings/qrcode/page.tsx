export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import QRCodeClient from './QRCodeClient'

export default async function QRCodePage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const { tenantId, slug, name } = effective!
  const activeMenu = await getActiveMenuForTenant(tenantId)

  const { data: qrcodes } = await supabase
    .from('qr_codes')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const headersList = await headers()
  const host = headersList.get('host') ?? ''
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${protocol}://${host}`
  const menuPath = `/${slug}${activeMenu && !activeMenu.is_default ? `/${activeMenu.slug}` : ''}`
  const menuUrl = `${baseUrl}${menuPath}`
  const normalizedMenuPath = menuPath.replace(/\/+$/, '') || '/'
  const filteredQRCodes = (qrcodes ?? []).filter((qr) => {
    try {
      const targetPath = new URL(qr.target_url, baseUrl).pathname.replace(/\/+$/, '') || '/'
      return targetPath === normalizedMenuPath
    } catch {
      return false
    }
  })

  return (
    <QRCodeClient
      qrcodes={filteredQRCodes}
      tenantId={tenantId}
      menuUrl={menuUrl}
      tenantName={name}
      activeMenuName={activeMenu?.name ?? null}
    />
  )
}
