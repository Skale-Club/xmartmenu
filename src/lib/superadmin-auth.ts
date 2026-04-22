import { createClient, createServiceClient } from '@/lib/supabase/server'
import { normalizeRole, parseSuperadminEmails } from '@/lib/auth/role-utils'

export async function isSuperadminRequest() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (normalizeRole(profile?.role) === 'superadmin') return true

  const userEmail = user.email?.toLowerCase() ?? ''
  const isConfiguredSuperadmin = parseSuperadminEmails().includes(userEmail)
  if (!isConfiguredSuperadmin) return false

  const service = await createServiceClient()
  await service.from('profiles').upsert({
    id: user.id,
    role: 'superadmin',
    full_name: user.user_metadata?.full_name ?? null,
  }, { onConflict: 'id' })

  return true
}
