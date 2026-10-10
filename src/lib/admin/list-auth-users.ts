/**
 * list-auth-users.ts — paginate through ALL Supabase auth users.
 *
 * `supabase.auth.admin.listUsers({ perPage: 1000 })` returns at most one page:
 * user #1001 silently disappears from admin tooling. This walks every page so
 * callers always see the full set. Service-role client required.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'

const PER_PAGE = 1000
const MAX_PAGES = 100 // 100k-user safety backstop

export async function listAllAuthUsers(service: SupabaseClient): Promise<User[]> {
  const all: User[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) throw error
    const users = data?.users ?? []
    all.push(...users)
    if (users.length < PER_PAGE) break
  }
  return all
}
