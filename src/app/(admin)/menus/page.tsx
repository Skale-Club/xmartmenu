export const dynamic = 'force-dynamic'
import { listAdminMenus } from '@/lib/admin/menu-data'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import MenusClient from './MenusClient'
import { notFound } from 'next/navigation'

export default async function MenusPage() {
  const effective = await getEffectiveTenant()
  if (!effective) notFound()
  const { tenantId, slug } = effective
  const activeMenu = await getActiveMenuForTenant(tenantId)
  const menus = await listAdminMenus(tenantId)
  return <MenusClient menus={menus ?? []} tenantSlug={slug} activeMenuId={activeMenu?.id ?? null} />
}
