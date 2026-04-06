export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import CategoriesClient from './CategoriesClient'

export default async function CategoriesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user!.id)
    .single()

  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .eq('tenant_id', profile!.tenant_id)
    .order('position')

  return <CategoriesClient categories={categories ?? []} tenantId={profile!.tenant_id} />
}
