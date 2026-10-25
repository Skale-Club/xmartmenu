export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getActiveMenuForTenant } from '@/lib/get-active-menu'
import CategoriesClient from './CategoriesClient'

export default async function CategoriesPage() {
  const supabase = await createClient()
  const effective = await getEffectiveTenant()
  const tenantId = effective!.tenantId
  const canManage = effective!.role !== 'store-staff'
  const activeMenu = await getActiveMenuForTenant(tenantId)

  if (!activeMenu) {
    return <CategoriesClient categories={[]} tenantId={tenantId} menuId={null} activeMenuName={null} canManage={canManage} baseLanguage="en" supportedLanguages={[]} />
  }

  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('menu_id', activeMenu.id)
    .order('position')

  return (
    <CategoriesClient
      categories={categories ?? []}
      tenantId={tenantId}
      menuId={activeMenu.id}
      activeMenuName={activeMenu.name}
      canManage={canManage}
      baseLanguage={activeMenu.language ?? 'en'}
      supportedLanguages={activeMenu.supported_languages ?? []}
    />
  )
}
