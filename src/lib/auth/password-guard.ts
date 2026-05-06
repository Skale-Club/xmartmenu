import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * SEC-02: Checks whether the currently authenticated user must change their password.
 * Returns a 403 NextResponse if must_change_password=true, or null if the check passes
 * (user can proceed) or if no user is authenticated (caller handles auth separately).
 *
 * Usage in a route handler:
 *   const guard = await checkPasswordChangeRequired()
 *   if (guard) return guard
 */
export async function checkPasswordChangeRequired(): Promise<NextResponse | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('must_change_password')
    .eq('id', user.id)
    .single()

  if (profile?.must_change_password === true) {
    return NextResponse.json(
      { error: 'Password change required before accessing this resource', code: 'MUST_CHANGE_PASSWORD' },
      { status: 403 }
    )
  }
  return null
}
