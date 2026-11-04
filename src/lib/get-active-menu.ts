import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import type { Menu } from '@/types/database'
import { activeAdminMenu, adminMenusOwned } from '@/lib/data/admin-menus'
import { listAdminMenus } from '@/lib/admin/menu-data'

export async function getActiveMenuForTenant(tenantId: string): Promise<Menu | null> {
  const cookieStore = await cookies()
  const selectedMenuId = cookieStore.get('selected_menu_id')?.value
  if (adminMenusOwned()) return activeAdminMenu(await listAdminMenus(tenantId), selectedMenuId)
  const supabase = await createClient()

  if (selectedMenuId) {
    const { data: selectedMenu } = await supabase
      .from('menus')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', selectedMenuId)
      .single()

    if (selectedMenu) return selectedMenu as Menu
  }

  const { data: defaultMenu } = await supabase
    .from('menus')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .single()

  if (defaultMenu) return defaultMenu as Menu

  const { data: firstMenu } = await supabase
    .from('menus')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('position')
    .limit(1)
    .maybeSingle()

  return (firstMenu as Menu | null) ?? null
}
