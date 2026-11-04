export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import QRCodeClient from './QRCodeClient'
import { redirect } from 'next/navigation'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { readOwnedQrCodes } from '@/lib/data/admin-store-operations-runtime'
import type { QRCode } from '@/types/database'

export default async function QRCodePage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  const { tenantId, slug, name, role } = effective
  const canManage = role !== 'store-staff'
  const activeMenu = await getActiveMenuForTenant(tenantId)

  let qrcodes: QRCode[]
  if (adminMenusOwned()) {
    qrcodes = await readOwnedQrCodes({ tenantId, role })
  } else {
    const supabase = await createClient()
    const { data } = await supabase
      .from('qr_codes')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    qrcodes = (data ?? []) as QRCode[]
  }

  const headersList = await headers()
  const host = headersList.get('host') ?? ''
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${protocol}://${host}`
  const menuPath = `/${slug}${activeMenu && !activeMenu.is_default ? `/${activeMenu.slug}` : ''}`
  const menuUrl = `${baseUrl}${menuPath}`
  const normalizedMenuPath = menuPath.replace(/\/+$/, '') || '/'
  const filteredQRCodes = qrcodes.filter((qr) => {
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
      canManage={canManage}
      ownedSource={adminMenusOwned()}
    />
  )
}
