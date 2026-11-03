import { createClient } from '@/lib/supabase/server'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import type { Menu } from '@/types/database'

/** Server callers must resolve/authorize the effective tenant first. */
export async function listAdminMenus(tenantId: string): Promise<Menu[]> {
  if (adminMenusOwned()) {
    const { listOwnedAdminMenus } = await import('@/lib/data/admin-menus-runtime')
    return listOwnedAdminMenus({ tenantId, role: 'store-staff' })
  }
  const supabase = await createClient()
  const { data } = await supabase.from('menus').select('*').eq('tenant_id', tenantId).order('position')
  return (data ?? []) as Menu[]
}
